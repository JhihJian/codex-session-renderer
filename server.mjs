import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAuditChain } from "./src/audit-chain.mjs";
import { assertSecureListenConfig, createAccessControl, requireAuthorizedRequest } from "./src/access-control.mjs";
import { createDataSourceRegistry, sanitizeErrorMessage } from "./src/data-sources.mjs";
import { evidenceRiskRulesFingerprint, normalizeEvidenceRiskRules, validateEvidenceRiskRules } from "./src/evidence-risk-rules.mjs";
import { sendError, sendJson, sendText, serveStaticFile } from "./src/http-response.mjs";
import { createRendererConfigStore } from "./src/renderer-config.mjs";
import { createSnapshotRootCommitCoordinator } from "./src/snapshot-root-commit-coordinator.mjs";
import { createDeadlineSignal, fetchWithDeadline, isAbortError as isRemoteAbortError, readLimitedResponseText } from "./src/remote-http.mjs";
import { createSessionDetailCoordinator } from "./src/session-detail-coordinator.mjs";
import { readJsonl, readJsonlLineWithDiagnostics, readJsonlRange } from "./src/jsonl-reader.mjs";
import {
  buildTrace,
  buildTurns,
  compactChildBase,
  compactChildPlaceholder,
  compactCompactSession,
  compactTurnsForClient,
  compactTurnForView,
  deriveSessionStatusFromEvents,
  deriveSessionStatusFromTurns,
  extractTitleFromEvents,

  findSpawnAgentEvents,
  findSubagentNotifications,
  isImportantEvent,
  renderConversationMarkdown,
  sessionIdFromFile,
  sessionStartedFromFile,
  summarizeEventPreview,
  summarizeEventTitle,
  summarizeSessionEvents,
  toIso,
  toMs,
} from "./src/session-events.mjs";
import { dedupeSessionFileRecords, sessionFileRoots } from "./src/session-catalog.mjs";
import { normalizeSessionEvent } from "./src/session-normalizer.mjs";
import { promptProjectKey } from "./src/session-prompts.mjs";
import { createAbortError, createConcurrencyGate, createPromptArchiveCoordinator, createSharedSubscriptionRegistry, fileSignature, isAbortError } from "./src/prompt-archive-coordinator.mjs";
import {
  compactSessionForList,
  publicThreadMeta,
  relativeCodexPath,
  rootSessionsOnly,
  sessionFromThread,
  spawnEdgesFromSessions,
  withSubagentMeta,
  withFileStat,
} from "./src/session-models.mjs";
import {
  eventMatchesQuery,
  filterSessions,
  paginateSessions,
  parseSessionEventQuery,
  parseSessionListQuery,
  parseSessionViewQuery,
  projectEventForApi,
  projectSessionForApi,
  sessionWatermark,
  sortSessions,
} from "./src/session-query.mjs";
import { createSqliteThreadStore, stripLongPathPrefix } from "./src/sqlite-threads.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const maxListSessions = Number(process.env.CODEX_SESSION_RENDERER_LIMIT || 800);
const recentSessionWindowMs = 24 * 60 * 60 * 1000;
const port = Number(process.env.PORT || 4789);
const host = process.env.HOST || "127.0.0.1";
const accessToken = process.env.CODEX_SESSION_RENDERER_TOKEN || "";
const remoteHttpLimits = {
  deadlineMs: readPositiveEnv("CODEX_REMOTE_HTTP_DEADLINE_MS", 30_000, 300_000),
  indexMaxBytes: readPositiveEnv("CODEX_REMOTE_INDEX_MAX_BYTES", 2 * 1024 * 1024, 32 * 1024 * 1024),
  healthMaxBytes: readPositiveEnv("CODEX_REMOTE_HEALTH_MAX_BYTES", 256 * 1024, 4 * 1024 * 1024),
};
const sessionReadGate = createConcurrencyGate(readPositiveEnv("CODEX_SESSION_DETAIL_MAX_CONCURRENT_READS", 4, 32));
const remoteRefreshGate = createConcurrencyGate(readPositiveEnv("CODEX_REMOTE_MAX_CONCURRENT_REFRESHES", 2, 16));
const remoteRefreshSubscriptions = createSharedSubscriptionRegistry();
const sourceIdentityRegistry = new Map();
const snapshotCommitCoordinator = createSnapshotRootCommitCoordinator();
const configStore = createRendererConfigStore({ onCommittedMutation: invalidateChangedManagedSourceVersions });
let rendererConfig = await configStore.readConfig();
let dataSources = createDataSourceRegistry({
  config: rendererConfig,
  refreshGate: remoteRefreshGate,
  refreshSubscriptions: remoteRefreshSubscriptions,
  sourceIdentityRegistry,
  snapshotCommitCoordinator,
});
const sourceContexts = new Map();

function readPositiveEnv(name, fallback, maximum) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), maximum);
}

function sessionDetailCoordinatorOptions() {
  return {
    maxConcurrentReads: readPositiveEnv("CODEX_SESSION_DETAIL_MAX_CONCURRENT_READS", 4, 32),
    maxFileBytes: readPositiveEnv("CODEX_SESSION_DETAIL_MAX_FILE_BYTES", 8 * 1024 * 1024, 256 * 1024 * 1024),
    maxEvents: readPositiveEnv("CODEX_SESSION_DETAIL_MAX_EVENTS", 10_000, 500_000),
    maxDiagnosticEventScan: readPositiveEnv("CODEX_SESSION_DIAGNOSTIC_MAX_EVENT_SCAN", 100_000, 500_000),
    maxCacheEntries: readPositiveEnv("CODEX_SESSION_DETAIL_MAX_CACHE_ENTRIES", 24, 2_000),
    maxCacheBytes: readPositiveEnv("CODEX_SESSION_DETAIL_MAX_CACHE_BYTES", 48 * 1024 * 1024, 512 * 1024 * 1024),
    readGate: sessionReadGate,
  };
}

async function reloadDataSources() {
  rendererConfig = await configStore.readConfig();
  dataSources = createDataSourceRegistry({
    config: rendererConfig,
    refreshGate: remoteRefreshGate,
    refreshSubscriptions: remoteRefreshSubscriptions,
    sourceIdentityRegistry,
    snapshotCommitCoordinator,
  });
  sourceContexts.clear();
}

function invalidateChangedManagedSourceVersions({ previous = {}, next = {} } = {}) {
  const previousPeers = new Map((previous.peers || []).map((peer) => [peer.id, peer]));
  const nextPeers = new Map((next.peers || []).map((peer) => [peer.id, peer]));
  const sourceIds = new Set([...previousPeers.keys(), ...nextPeers.keys()]);
  for (const sourceId of sourceIds) {
    const before = previousPeers.get(sourceId);
    const after = nextPeers.get(sourceId);
    if (!before || !after || before.url !== after.url || before.enabled !== after.enabled) {
      const source = dataSources.getSource(sourceId);
      const fallbackRoot = path.join(
        process.env.CODEX_REMOTE_SNAPSHOT_ROOT || path.join(os.homedir(), ".codex-session-renderer", "remote-snapshots"),
        sourceId,
      );
      snapshotCommitCoordinator.run(source?.snapshotRoot || fallbackRoot, () => sourceIdentityRegistry.delete(sourceId));
    }
  }
}

function remoteSourceVersions() {
  return new Map(
    dataSources.listSources()
      .filter((source) => source.kind === "remote")
      .map((source) => [source.id, source.status?.sourceVersion || null]),
  );
}

function sourceConfigurationChange(previousVersion, source, { deleted = false } = {}) {
  const sourceVersion = source?.status?.sourceVersion || null;
  const sourceChanged = deleted || previousVersion == null || sourceVersion == null || previousVersion !== sourceVersion;
  return {
    result: deleted ? "source_removed" : sourceChanged ? "source_changed" : "source_unchanged",
    sourceChanged,
    sourceVersion,
    snapshotRefreshRequired: source?.status?.needsRefresh === true,
  };
}

function getSourceContext(sourceId = "local") {
  const source = dataSources.getSource(sourceId || "local");
  if (!source) return null;
  const cached = sourceContexts.get(source.id);
  if (cached) return cached;
  const context = {
    source,
    codexHome: source.codexHome,
    originalCodexHome: source.originalCodexHome || source.codexHome,
    sessionsRoot: source.sessionsRoot,
    sessionIndexPath: source.sessionIndexPath,
    stateDbPath: source.stateDbPath,
    threadStore: createSqliteThreadStore({ stateDbPath: source.stateDbPath, maxListSessions }),
    sessionCache: null,
    sessionCacheTime: 0,
    sessionCacheByScope: new Map(),
    allSessionCache: null,
    allSessionCacheTime: 0,
    sessionDetailCoordinator: createSessionDetailCoordinator(sessionDetailCoordinatorOptions()),
    promptArchiveCoordinator: createPromptArchiveCoordinator({ readGate: sessionReadGate }),
  };
  sourceContexts.set(source.id, context);
  return context;
}

function sourceModelOptions(context) {
  return {
    sourceId: context.source.id,
    sourceLabel: context.source.label,
    dataSourceKind: context.source.kind,
    originalCodexHome: context.originalCodexHome,
  };
}

function assertSourceSnapshotReadable(context) {
  const source = context?.source;
  if (source?.kind !== "remote") return;
  if (source.isCurrent?.() && source.status?.snapshotAvailable) return;
  const sourceChanged = source.isCurrent?.() === false || source.status?.error?.code === "snapshot_source_changed";
  const error = new Error(sourceChanged ? "远端来源已变更，需要拉取新快照。" : "尚未拉取远端快照。");
  error.status = 409;
  error.code = sourceChanged ? "source_snapshot_changed" : "snapshot_refresh_required";
  throw error;
}

function throwIfRequestAborted(signal) {
  if (signal?.aborted) throw createAbortError();
}

function analysisEventFromRaw(event, index) {
  const normalized = normalizeSessionEvent(event, event?.index ?? index);
  const rawPayloadSize = normalized.payloadSize;
  const analysis = {
    index: normalized.index ?? index,
    timestamp: normalized.timestamp,
    kind: normalized.kind,
    semanticKind: normalized.semanticKind,
    important: isImportantEvent(normalized),
    type: normalized.rawType,
    payloadType: normalized.payloadType,
    role: normalized.role,
    messageId: normalized.messageId,
    parentId: normalized.parentId,
    title: summarizeEventTitle(normalized),
    preview: summarizeEventPreview(normalized),
    payloadSize: rawPayloadSize,
    rawSize: normalized.rawSize,
    attachments: normalized.attachments,
    reasoning: normalized.reasoning,
    compact: normalized.compact,
    diagnostic: normalized.diagnostic || null,
    payload: normalized.payload,
  };
  return analysis;
}

function invalidateSourceContext(sourceId) {
  const context = sourceContexts.get(sourceId || "local");
  if (!context) return;
  context.sessionCache = null;
  context.sessionCacheTime = 0;
  context.sessionCacheByScope.clear();
  context.allSessionCache = null;
  context.allSessionCacheTime = 0;
  context.sessionDetailCoordinator.cache.clear();
  context.promptArchiveCoordinator = createPromptArchiveCoordinator({ readGate: sessionReadGate });
}

async function* walkJsonl(dir, options = {}) {
  if (options.signal?.aborted) throw createAbortError();
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (options.signal?.aborted) throw createAbortError();
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (options.sinceMs != null && datedDirectoryEndsBefore(fullPath, options.sinceMs)) continue;
      yield* walkJsonl(fullPath, options);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      yield fullPath;
    }
  }
}

function datedDirectoryEndsBefore(directoryPath, cutoffMs) {
  const parts = path.normalize(directoryPath).split(path.sep);
  for (let index = 0; index <= parts.length - 3; index += 1) {
    if (!/^\d{4}$/.test(parts[index]) || !/^\d{2}$/.test(parts[index + 1]) || !/^\d{2}$/.test(parts[index + 2])) continue;
    const endMs = Date.UTC(Number(parts[index]), Number(parts[index + 1]) - 1, Number(parts[index + 2]) + 1);
    return endMs <= cutoffMs;
  }
  return false;
}

async function collectSessionFileRecords(context, options = {}) {
  const records = [];
  for (const entry of sessionFileRoots(context.codexHome, context.sessionsRoot)) {
    for await (const filePath of walkJsonl(entry.root, options)) {
      if (options.signal?.aborted) throw createAbortError();
      let stat;
      try {
        stat = await fs.stat(filePath);
      } catch {
        continue;
      }
      if (options.sinceMs != null && stat.mtimeMs < options.sinceMs) continue;
      if (options.beforeMs != null && stat.mtimeMs >= options.beforeMs) continue;
      records.push({
        id: sessionIdFromFile(filePath),
        filePath,
        archived: entry.archived,
        stat,
      });
      if (records.length >= (options.maxRecords || maxListSessions)) return dedupeSessionFileRecords(records);
    }
  }
  return dedupeSessionFileRecords(records);
}

async function readIndex(context, options = {}) {
  const byId = new Map();
  try {
    const readRows = () => readJsonl(context.sessionIndexPath, {
      maxLines: options.maxRecords || maxListSessions,
      maxBytes: 64 * 1024,
      signal: options.signal,
    });
    const rows = options.readGate ? await options.readGate.run(readRows, options.signal) : await readRows();
    for (const row of rows) {
      if (!row?.id) continue;
      byId.set(row.id, {
        id: row.id,
        title: row.thread_name || row.name || "未命名会话",
        updatedAt: toIso(row.updated_at) || toIso(row.updatedAt),
      });
    }
  } catch (error) {
    if (isAbortError(error)) throw error;
    // The session files themselves remain authoritative when the index is absent.
  }
  return byId;
}

function sessionCatalogBounds(scope) {
  const cutoffMs = Date.now() - recentSessionWindowMs;
  if (scope === "recent24h") return { sinceMs: cutoffMs };
  if (scope === "history") return { beforeMs: cutoffMs };
  return {};
}

function normalizeSessionCatalogScope(scope) {
  return ["recent24h", "history", "all"].includes(scope) ? scope : "all";
}

function sessionMatchesCatalogBounds(session, bounds) {
  const timestamp = new Date(session.updatedAt || session.fileModifiedAt || session.startedAt || "").getTime();
  if (!Number.isFinite(timestamp)) return bounds.beforeMs != null;
  if (bounds.sinceMs != null && timestamp < bounds.sinceMs) return false;
  if (bounds.beforeMs != null && timestamp >= bounds.beforeMs) return false;
  return true;
}

async function listSessions(context, options = {}) {
  assertSourceSnapshotReadable(context);
  throwIfRequestAborted(options.signal);
  const scope = normalizeSessionCatalogScope(options.scope || "all");
  const bounds = sessionCatalogBounds(scope);
  const now = Date.now();
  const cached = context.sessionCacheByScope.get(scope);
  if (cached && now - cached.time < 3000) return cached.sessions;

  const threads = await context.threadStore.readThreads({
    ...bounds,
    limit: options.maxRecords || maxListSessions,
    signal: options.signal,
  });
  if (threads.size > 0) {
    const sessions = [];
    for (const thread of threads.values()) {
      throwIfRequestAborted(options.signal);
      const session = sessionFromThread(thread, context.codexHome, sourceModelOptions(context));
      if (await sessionFileExists(session, options)) sessions.push(session);
    }
    const rootSessions = rootSessionsOnly(sessions, []);
    rootSessions.sort((a, b) => new Date(b.updatedAt || b.fileModifiedAt || 0) - new Date(a.updatedAt || a.fileModifiedAt || 0));
    const scopedSessions = rootSessions.filter((session) => sessionMatchesCatalogBounds(session, bounds));
    const results = scopedSessions.slice(0, options.maxRecords || maxListSessions);
    if (!options.maxRecords) {
      context.sessionCache = results;
      context.sessionCacheTime = now;
      context.sessionCacheByScope.set(scope, { sessions: context.sessionCache, time: now });
    }
    return results;
  }

  const sessions = await listFileSessions(context, bounds, options);
  const rootSessions = rootSessionsOnly(sessions, spawnEdgesFromSessions(sessions));
  rootSessions.sort((a, b) => new Date(b.updatedAt || b.fileModifiedAt) - new Date(a.updatedAt || a.fileModifiedAt));
  const results = rootSessions.slice(0, options.maxRecords || maxListSessions);
  if (!options.maxRecords) {
    context.sessionCache = results;
    context.sessionCacheTime = now;
    context.sessionCacheByScope.set(scope, { sessions: context.sessionCache, time: now });
  }
  return results;
}

async function listFileSessions(context, bounds = {}, options = {}) {
  const index = bounds.sinceMs == null ? await readIndex(context, options) : new Map();
  const files = await collectSessionFileRecords(context, { ...bounds, ...options });

  const sessions = [];
  for (const record of files) {
    throwIfRequestAborted(options.signal);
    const { filePath, stat } = record;
    const id = sessionIdFromFile(filePath);
    const indexed = index.get(id);
    let events = [];
    try {
      const readMeta = () => readJsonl(filePath, {
        maxLines: bounds.beforeMs != null ? 1 : 40,
        maxBytes: 64 * 1024,
        signal: options.signal,
      });
      events = options.readGate ? await options.readGate.run(readMeta, options.signal) : await readMeta();
    } catch (error) {
      if (isAbortError(error)) throw error;
      // Keep the unreadable file visible in diagnostics.
    }
    const meta = sessionMetaFromEvents(events);
    sessions.push(
      withSubagentMeta({
        id,
        sourceId: context.source.id,
        sourceLabel: context.source.label,
        dataSourceKind: context.source.kind,
        title: indexed?.title || meta.title || extractTitleFromEvents(events, path.basename(filePath, ".jsonl")),
        cwd: stripLongPathPrefix(meta.cwd || "") || null,
        originator: meta.originator || null,
        model: meta.model || meta.modelId || meta.model_provider || null,
        reasoningEffort: meta.reasoning_effort || meta.reasoningEffort || null,
        source: meta.source || (context.source.kind === "pi-agent" ? "pi-agent" : null),
        threadSource: meta.thread_source || null,
        modelProvider: meta.model_provider || meta.provider || null,
        archived: record.archived,
        archivedAt: null,
        agentNickname: null,
        agentRole: null,
        preview: null,
        status: deriveSessionStatusFromEvents(events),
        path: filePath,
        relativePath: relativeCodexPath(context.codexHome, filePath),
        startedAt: toIso(meta.timestamp) || sessionStartedFromFile(filePath),
        updatedAt: indexed?.updatedAt || toIso(stat.mtime),
        sizeBytes: stat.size,
        fileModifiedAt: toIso(stat.mtime),
      }),
    );
  }
  sessions.sort((a, b) => new Date(b.updatedAt || b.fileModifiedAt) - new Date(a.updatedAt || a.fileModifiedAt));
  return sessions;
}

function sessionMetaFromEvents(events) {
  const codexMeta = events.find((event) => event.type === "session_meta")?.payload;
  if (codexMeta) return codexMeta;
  const piSession = events.find((event) => event.type === "session") || null;
  const piInfo = events.find((event) => event.type === "session_info") || null;
  const piModel = [...events].reverse().find((event) => event.type === "model_change") || null;
  const piThinking = [...events].reverse().find((event) => event.type === "thinking_level_change") || null;
  if (!piSession && !piInfo && !piModel && !piThinking) return {};
  return {
    title: piInfo?.name || null,
    cwd: piSession?.cwd || null,
    timestamp: piSession?.timestamp || null,
    model: piModel?.modelId || piModel?.model || null,
    model_provider: piModel?.provider || null,
    reasoningEffort: piThinking?.thinkingLevel || null,
    originator: "pi_agent",
    source: "pi-agent",
  };
}

async function enrichSessionFromFileMeta(session, options = {}) {
  if (!session?.path) return withSubagentMeta(session);
  const events = await readJsonl(session.path, { maxLines: 40, maxBytes: 128 * 1024, signal: options.signal }).catch((error) => {
    if (isAbortError(error)) throw error;
    return [];
  });
  const meta = sessionMetaFromEvents(events);
  const sourceForExtraction = meta.source || session.source || null;
  const enriched = withSubagentMeta({
    ...session,
    cwd: session.cwd || stripLongPathPrefix(meta.cwd || "") || null,
    originator: session.originator || meta.originator || null,
    model: session.model || meta.model || meta.modelId || meta.model_provider || null,
    reasoningEffort: session.reasoningEffort || meta.reasoning_effort || meta.reasoningEffort || null,
    source: sourceForExtraction,
    threadSource: session.threadSource || meta.thread_source || null,
    modelProvider: session.modelProvider || meta.model_provider || meta.provider || null,
    startedAt: session.startedAt || toIso(meta.timestamp) || null,
  });
  return {
    ...enriched,
    source: session.source || sourceForExtraction,
  };
}

async function enrichThreadRowsFromFiles(context, threads, options = {}) {
  const enriched = new Map();
  await Promise.all(
    [...threads.entries()].map(async ([id, thread]) => {
      const session = sessionFromThread(thread, context.codexHome, sourceModelOptions(context));
      const sessionMeta = await enrichSessionFromFileMeta(session, options);
      enriched.set(id, {
        ...thread,
        cwd: thread.cwd || sessionMeta.cwd || null,
        model: thread.model || sessionMeta.model || null,
        threadSource: thread.threadSource || sessionMeta.threadSource || null,
        modelProvider: thread.modelProvider || sessionMeta.modelProvider || null,
        agentNickname: thread.agentNickname || sessionMeta.agentNickname || null,
        agentRole: thread.agentRole || sessionMeta.agentRole || null,
      });
    }),
  );
  return enriched;
}

async function getSessionById(context, id, options = {}) {
  assertSourceSnapshotReadable(context);
  throwIfRequestAborted(options.signal);
  const cached = context.sessionCache?.find((session) => session.id === id);
  if (cached) return cached;

  const thread = (await context.threadStore.readThreadRowsByIds([id])).get(id);
  if (thread) {
    const session = sessionFromThread(thread, context.codexHome, sourceModelOptions(context));
    if (await sessionFileExists(session, options)) return enrichSessionFromFileMeta(session, options);
  }

  const sessions = await listSessions(context, options);
  const listed = sessions.find((session) => session.id === id);
  if (listed) return listed;

  for (const record of await collectSessionFileRecords(context, options)) {
    throwIfRequestAborted(options.signal);
    if (record.id === id) return sessionFromFilePath(context, record.filePath, { archived: record.archived, signal: options.signal });
  }
  return null;
}

async function listAllSessionsForQuery(context) {
  assertSourceSnapshotReadable(context);
  const now = Date.now();
  if (context.allSessionCache && now - context.allSessionCacheTime < 3000) return context.allSessionCache;

  const threads = await context.threadStore.readAllThreads();
  if (threads.size > 0) {
    const sessions = [];
    for (const thread of threads.values()) {
      const session = sessionFromThread(thread, context.codexHome, sourceModelOptions(context));
      if (await sessionFileExists(session)) sessions.push(await enrichSessionFromFileMeta(session));
    }
    sessions.sort((a, b) => new Date(b.updatedAt || b.fileModifiedAt || 0) - new Date(a.updatedAt || a.fileModifiedAt || 0));
    context.allSessionCache = sessions.slice(0, maxListSessions);
    context.allSessionCacheTime = now;
    return context.allSessionCache;
  }

  const sessions = await listFileSessions(context);
  context.allSessionCache = sessions;
  context.allSessionCacheTime = now;
  return context.allSessionCache;
}

async function sessionFileExists(session, options = {}) {
  if (!session?.path) return false;
  if (options.signal?.aborted) throw createAbortError();
  try {
    const stat = await fs.stat(session.path);
    if (options.signal?.aborted) throw createAbortError();
    return stat.isFile();
  } catch {
    return false;
  }
}

async function querySessions(context, params, projectionOptions = {}) {
  const query = parseSessionListQuery(params);
  const [sessions, spawnEdges] = await Promise.all([listAllSessionsForQuery(context), context.threadStore.readSpawnEdges()]);
  const filtered = filterSessions(sessions, query, spawnEdges);
  const sorted = sortSessions(filtered, query);
  const page = paginateSessions(sorted, query);
  return {
    sessions: page.items.map((session) => projectSessionForApi(session, query, projectionOptions)),
    page: {
      offset: page.offset,
      limit: page.limit,
      returned: page.items.length,
      total: page.total,
      nextCursor: page.nextCursor,
    },
    watermark: sessionWatermark(filtered),
    serverTime: new Date().toISOString(),
  };
}

async function listPromptArchive(context, scope = "recent24h", options = {}) {
  const normalizedScope = normalizeSessionCatalogScope(scope);
  const sessions = await listSessions(context, {
    scope: normalizedScope,
    signal: options.signal,
    maxRecords: context.promptArchiveCoordinator.limits.maxSessions,
    readGate: sessionReadGate,
  });
  const result = await context.promptArchiveCoordinator.list(sessions, { signal: options.signal });
  const entries = result.entries;
  entries.sort((left, right) => promptEntryTimeMs(right) - promptEntryTimeMs(left));
  return { entries, truncated: result.truncated };
}

async function queryPromptArchive(context, params, options = {}) {
  const scope = normalizeSessionCatalogScope(params.get("scope") || "recent24h");
  const q = String(params.get("q") || "").trim().toLowerCase();
  const project = String(params.get("project") || "").trim();
  const status = String(params.get("status") || "all").trim();
  const limit = Math.max(1, Math.min(context.promptArchiveCoordinator.limits.maxSessions, Number(params.get("limit")) || context.promptArchiveCoordinator.limits.maxSessions));
  const archive = await listPromptArchive(context, scope, options);
  const entries = archive.entries.filter((entry) => {
    if (project && entry.projectKey !== project && promptProjectKey(entry.cwd) !== project) return false;
    if (status !== "all" && entry.promptState !== status) return false;
    if (!q) return true;
    return [entry.sessionTitle, entry.promptText, entry.promptPreview, entry.cwd, entry.sessionId, entry.sourceLabel, entry.status]
      .filter(Boolean)
      .join("\n")
      .toLowerCase()
      .includes(q);
  });
  return {
    source: dataSources.listSources().find((source) => source.id === context.source.id) || null,
    scope,
    entries: entries.slice(0, limit),
    page: {
      total: entries.length,
      returned: Math.min(entries.length, limit),
      limit,
      truncated: archive.truncated || entries.length > limit,
    },
    projects: projectSummaries(entries),
    serverTime: new Date().toISOString(),
  };
}


function projectSummaries(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const current = groups.get(entry.projectKey) || {
      key: entry.projectKey,
      label: entry.projectLabel,
      cwd: entry.cwd,
      count: 0,
      latestAt: null,
    };
    current.count += 1;
    if (!current.latestAt || promptEntryTimeMs(entry) > promptEntryTimeMs({ updatedAt: current.latestAt })) {
      current.latestAt = entry.updatedAt || entry.startedAt || null;
    }
    groups.set(entry.projectKey, current);
  }
  return [...groups.values()].sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, "zh-CN"));
}

function promptEntryTimeMs(entry) {
  for (const value of [entry?.updatedAt, entry?.startedAt, entry?.promptTimestamp]) {
    const time = value ? new Date(value).getTime() : NaN;
    if (Number.isFinite(time)) return time;
  }
  return 0;
}

async function getSessionDetail(context, id, options = {}) {
  throwIfRequestAborted(options.signal);
  const session = await getSessionById(context, id, { signal: options.signal });
  if (!session) return null;
  const maxDepth = options.maxDepth ?? 3;
  const evidenceRiskRules = normalizeEvidenceRiskRules(options.evidenceRiskRules);
  const evidenceRiskRulesKey = evidenceRiskRulesFingerprint(evidenceRiskRules);
  const cacheKey = `detail:${context.source.id}:${id}:maxDepth=${maxDepth}:evidenceRiskRules=${evidenceRiskRulesKey}`;
  const result = await context.sessionDetailCoordinator.read(session, {
    cacheKey,
    signal: options.signal,
    shouldCache: (detail) => detail.stats?.childThreadCount === 0,
    derive: async (rawEvents, stat, signal) => {
      throwIfRequestAborted(signal);
      const sessionWithStat = withFileStat(session, stat);
      const hierarchy = await getThreadHierarchy(context, id, { signal });
      const analysisEvents = rawEvents.map(analysisEventFromRaw);
      const publicEvents = analysisEvents.map(({ payload, ...event }) => ({
        index: event.index,
        timestamp: event.timestamp,
        kind: event.kind,
        semanticKind: event.semanticKind,
        important: event.important,
        type: event.type,
        role: event.role,
        messageId: event.messageId,
        parentId: event.parentId,
        title: event.title,
        preview: event.preview,
        payloadSize: event.payloadSize,
        rawSize: event.rawSize,
        attachments: event.attachments,
        reasoning: event.reasoning,
        compact: event.compact,
        diagnostic: event.diagnostic,
      }));
      const turns = buildTurns(rawEvents);
      const sessionForDetail = { ...sessionWithStat, status: deriveSessionStatusFromTurns(turns) };
      const trace = buildTrace(sessionForDetail, rawEvents, analysisEvents, turns, hierarchy);
      const compact = await buildCompactView(context, { session: sessionForDetail, normalizedEvents: analysisEvents, turns, hierarchy, options: { maxDepth, signal } });
      const audit = buildAuditChain({ turns, evidenceRiskRules });
      return {
        complete: true,
        readState: { state: "ready", code: "session_read_complete" },
        session: sessionForDetail,
        turns: compactTurnsForClient(turns),
        events: publicEvents,
        stats: sessionDetailStats(context, sessionWithStat, { stat, rawEvents, analysisEvents, turns, hierarchy }),
        trace,
        compact,
        audit,
      };
    },
  });
  if (result.state === "ready") return result.value;
  return limitedSessionDetail(context, session, result.stat, result, id);
}

function sessionDetailStats(context, session, { stat, rawEvents = [], analysisEvents = [], turns = [], hierarchy = { children: [] } } = {}) {
  return {
    ...summarizeSessionEvents(rawEvents),
    eventCount: rawEvents.length,
    diagnosticEventCount: analysisEvents.filter((event) => event.kind === "jsonl_parse_error").length,
    compactEventCount: analysisEvents.filter((event) => event.compact).length,
    turnCount: turns.length,
    importantEventCount: analysisEvents.filter((event) => event.important).length,
    childThreadCount: hierarchy.children.length,
    sizeBytes: stat?.size ?? null,
    source: {
      id: context.source.id,
      label: context.source.label,
      kind: context.source.kind,
      stale: context.source.status?.stale ?? false,
      lastSuccessfulRefreshAt: context.source.status?.lastSuccessfulRefreshAt ?? null,
    },
    codexHome: context.source.kind === "remote" ? null : context.codexHome,
    dataPath: session.path,
  };
}

function limitedSessionDetail(context, session, stat, readState, id) {
  return {
    complete: false,
    readState: {
      ...readState,
      diagnosticUrl: `/api/sources/${encodeURIComponent(context.source.id)}/query/sessions/${encodeURIComponent(id)}/events?limit=100`,
    },
    session: withFileStat(session, stat),
    turns: [],
    events: [],
    stats: sessionDetailStats(context, session, { stat }),
    trace: null,
    compact: null,
    audit: null,
  };
}

function eventDiagnosticSnapshot(context, signature) {
  return createHash("sha256")
    .update([context.source.id, context.source.status?.sourceVersion || "", signature].join("\u0000"))
    .digest("base64url");
}

function diagnosticEventScanLimitError() {
  const error = new Error("事件索引超过单条来源诊断读取上限。");
  error.status = 413;
  error.code = "session_event_scan_limited";
  return error;
}

function assertEventDiagnosticSnapshot(requestSnapshot, snapshot) {
  if (!requestSnapshot || requestSnapshot === snapshot) return;
  const error = new Error("会话诊断快照已变化，请重新开始读取。");
  error.status = 409;
  error.code = "session_snapshot_changed";
  throw error;
}

function diagnosticRangeMaxScan(query, maxDiagnosticEventScan) {
  if (query.cursor >= maxDiagnosticEventScan) throw diagnosticEventScanLimitError();
  return Math.min(query.maxScan, maxDiagnosticEventScan - query.cursor);
}

function diagnosticPageState(range, { query, maxDiagnosticEventScan, maxFileBytes, byteLimited, snapshot }) {
  const eventScanLimited = range.nextCursor >= maxDiagnosticEventScan && !range.exhausted;
  const byteScanLimited = byteLimited && range.exhausted;
  return {
    page: {
      cursor: query.cursor,
      limit: query.limit,
      maxScan: query.maxScan,
      scanned: range.scanned,
      returned: range.items.length,
      nextCursor: range.nextCursor,
      hasMore: !range.exhausted && !eventScanLimited,
      truncated: eventScanLimited || byteScanLimited,
      stopReason: eventScanLimited ? "raw_event_scan_limit" : byteScanLimited ? "raw_scan_byte_limit" : null,
      snapshot,
    },
    readState: eventScanLimited || byteLimited
      ? {
          state: "limited",
          code: "session_read_limited",
          reason: eventScanLimited ? "raw_event_scan_limit" : "raw_scan_byte_limit",
          limits: {
            maxFileBytes,
            maxDiagnosticEventScan,
          },
        }
      : null,
  };
}

async function querySessionEvents(context, id, params, projectionOptions = {}, options = {}) {
  throwIfRequestAborted(options.signal);
  const session = await getSessionById(context, id, { signal: options.signal });
  if (!session?.path) return null;
  const query = parseSessionEventQuery(params);
  const beforeStat = await fs.stat(session.path);
  const beforeSignature = fileSignature(session.path, beforeStat);
  const snapshot = eventDiagnosticSnapshot(context, beforeSignature);
  assertEventDiagnosticSnapshot(query.snapshot, snapshot);
  const maxDiagnosticEventScan = context.sessionDetailCoordinator.limits.maxDiagnosticEventScan;
  const maxScan = diagnosticRangeMaxScan(query, maxDiagnosticEventScan);
  const byteLimited = beforeStat.size > context.sessionDetailCoordinator.limits.maxFileBytes;
  const range = await context.sessionDetailCoordinator.readGate.run(
    () => readJsonlRange(session.path, {
      start: query.cursor,
      limit: query.limit,
      maxScan,
      maxBytes: context.sessionDetailCoordinator.limits.maxFileBytes,
      signal: options.signal,
      // The bounded stream can end in the middle of a JSON record; never turn that tail into a fake parse diagnostic.
      includeInvalid: !byteLimited,
      predicate: (event, index) => {
        const projected = projectEventForApi(event, index, { fields: [] });
        return eventMatchesQuery(projected, event, query);
      },
    }),
    options.signal,
  );
  const stat = await fs.stat(session.path).catch(() => null);
  if (!stat || beforeSignature !== fileSignature(session.path, stat)) {
    return {
      session: projectSessionForApi(withFileStat(session, stat), {}, projectionOptions),
      events: [],
      page: { cursor: query.cursor, limit: query.limit, maxScan: query.maxScan, scanned: 0, returned: 0, nextCursor: query.cursor, hasMore: false, snapshot: null },
      readState: { state: "changing", code: "session_file_changed", reason: "file_changed_during_read" },
      serverTime: new Date().toISOString(),
    };
  }
  const sessionWithStat = withFileStat(session, stat);
  const diagnosticState = diagnosticPageState(range, {
    query,
    maxDiagnosticEventScan,
    maxFileBytes: context.sessionDetailCoordinator.limits.maxFileBytes,
    byteLimited,
    snapshot,
  });
  return {
    session: projectSessionForApi(sessionWithStat, {}, projectionOptions),
    events: range.items.map(({ event, index }) => projectEventForApi(event, index, query)),
    ...diagnosticState,
    serverTime: new Date().toISOString(),
  };
}

async function querySessionView(context, id, params, projectionOptions = {}, options = {}) {
  const query = parseSessionViewQuery(params);
  const detail = await getSessionDetail(context, id, { maxDepth: query.maxDepth, evidenceRiskRules: parseEvidenceRiskRulesParam(params), signal: options.signal });
  if (!detail) return null;
  const base = {
    session: projectSessionForApi(detail.session, {}, projectionOptions),
    view: query.view,
    complete: detail.complete !== false,
    readState: detail.readState || null,
    stats: detail.stats,
    serverTime: new Date().toISOString(),
  };
  if (query.view === "compact") return { ...base, compact: detail.compact };
  if (query.view === "turns") return { ...base, turns: detail.turns };
  if (query.view === "trace") return { ...base, trace: detail.trace };
  if (query.view === "audit") return { ...base, audit: detail.audit };
  return { ...base, detail };
}

async function getSessionEvent(context, id, index, options = {}) {
  throwIfRequestAborted(options.signal);
  const session = await getSessionById(context, id, { signal: options.signal });
  if (!session?.path) return null;
  const beforeStat = await fs.stat(session.path);
  const beforeSignature = fileSignature(session.path, beforeStat);
  const snapshot = eventDiagnosticSnapshot(context, beforeSignature);
  assertEventDiagnosticSnapshot(options.snapshot, snapshot);
  const maxDiagnosticEventScan = context.sessionDetailCoordinator.limits.maxDiagnosticEventScan;
  if (index >= maxDiagnosticEventScan) throw diagnosticEventScanLimitError();
  const event = await context.sessionDetailCoordinator.readGate.run(
    () => readJsonlLineWithDiagnostics(session.path, index, {
      signal: options.signal,
      maxBytes: context.sessionDetailCoordinator.limits.maxFileBytes,
      maxScan: maxDiagnosticEventScan,
    }),
    options.signal,
  );
  const afterStat = await fs.stat(session.path).catch(() => null);
  if (!afterStat || beforeSignature !== fileSignature(session.path, afterStat)) {
    const error = new Error("Session file changed during read");
    error.status = 409;
    error.code = "session_file_changed";
    throw error;
  }
  if (!event && beforeStat.size > context.sessionDetailCoordinator.limits.maxFileBytes) {
    const error = new Error("Session event exceeds the diagnostic scan limit");
    error.status = 413;
    error.code = "session_read_limited";
    throw error;
  }
  if (!event) return null;
  return projectEventForApi(event, index, { includePayload: true, includeRaw: true });
}

function parseEvidenceRiskRulesParam(params) {
  const text = params.get("evidenceRiskRules");
  if (!text) return [];
  try {
    const rules = JSON.parse(text);
    const errors = validateEvidenceRiskRules(rules);
    if (errors.length) throw new Error(errors[0].message);
    return rules;
  } catch {
    const error = new Error("Invalid evidenceRiskRules parameter");
    error.status = 400;
    throw error;
  }
}

function createRemoteServiceError(code, message, status = 502, cause = null) {
  const error = new Error(sanitizeRemoteMessage(message));
  error.name = "RemoteServiceError";
  error.status = status;
  error.code = code;
  error.expose = true;
  if (cause) error.cause = cause;
  return error;
}

function sanitizeRemoteMessage(message) {
  return sanitizeErrorMessage(message || "远端请求失败。");
}

function isRemoteServiceError(error) {
  return error?.expose === true && typeof error?.code === "string";
}

function remoteFailurePayload(error) {
  const message = sanitizeRemoteMessage(error?.message || "远端请求失败。");
  return {
    ok: false,
    status: error?.status || 502,
    code: error?.code || "remote_request_failed",
    error: message,
    message,
  };
}

function remoteHttpFailureStatus(status) {
  return status === 401 || status === 403 || status === 409 ? status : 502;
}

async function readRemoteJson(response, { code, message, status = 502, maxBytes, signal }) {
  try {
    return JSON.parse(await readLimitedResponseText(response, { maxBytes, code, signal }));
  } catch (error) {
    if (isRemoteAbortError(error)) throw error;
    throw createRemoteServiceError(code, message, status, error);
  }
}

async function queryRemoteSessionIndex(source, params, options = {}) {
  if (source.kind !== "remote" || !source.definition?.indexUrl) {
    throw createRemoteServiceError("remote_index_not_configured", "远端索引不可用。", 404);
  }
  if (!source.definition.token) {
    throw createRemoteServiceError("remote_index_missing_token", `缺少 ${source.definition.tokenEnv}。`, 400);
  }
  let indexUrl;
  try {
    indexUrl = new URL(source.definition.indexUrl);
  } catch (error) {
    throw createRemoteServiceError("remote_index_invalid_url", "远端索引地址无效。", 400, error);
  }
  for (const [key, value] of params) indexUrl.searchParams.set(key, value);
  const deadline = createDeadlineSignal(options.signal, remoteHttpLimits.deadlineMs, "remote_index_deadline_exceeded");
  let response;
  try {
    response = await fetchWithDeadline(fetch, indexUrl, {
      headers: {
        authorization: `Bearer ${source.definition.token}`,
      },
    }, { signal: deadline.signal }).catch((error) => {
      if (isRemoteAbortError(error)) throw error;
      if (error?.code === "remote_index_deadline_exceeded") throw createRemoteServiceError(error.code, "远端索引请求超时。", 502, error);
      throw createRemoteServiceError("remote_index_unreachable", `远端索引不可达：${error?.message || "连接失败"}`, 502, error);
    });
  if (response.status === 401 || response.status === 403) {
    throw createRemoteServiceError("remote_index_auth_failed", "远端索引认证失败。", response.status);
  }
  if (response.status === 409) {
    throw createRemoteServiceError("index_snapshot_changed", "远端历史索引已变化，请重新开始定位。", 409);
  }
  if (!response.ok) {
    throw createRemoteServiceError(
      "remote_index_http_failed",
      `远端索引请求失败：HTTP ${response.status}`,
      remoteHttpFailureStatus(response.status),
    );
  }
    const data = await readRemoteJson(response, {
      code: "remote_index_non_json",
      message: "远端索引返回非 JSON。",
      maxBytes: remoteHttpLimits.indexMaxBytes,
      signal: deadline.signal,
    });
    return {
      ok: true,
      status: 200,
      page: data.page,
      sessions: (data.sessions || []).map((session) => ({
        ...session,
        sourceId: source.id,
        sourceLabel: source.label,
        dataSourceKind: "remote",
        remoteIndexOnly: true,
        availableInSnapshot: false,
      })),
    };
  } finally {
    deadline.dispose();
  }
}

async function testRemotePeer(source, options = {}) {
  try {
    return await testRemotePeerOrThrow(source, options);
  } catch (error) {
    if (isRemoteServiceError(error)) return remoteFailurePayload(error);
    throw error;
  }
}

async function testRemotePeerOrThrow(source, options = {}) {
  if (source.kind !== "remote" || !source.definition?.indexUrl) {
    throw createRemoteServiceError("remote_health_not_configured", "远端索引不可用。", 404);
  }
  if (!source.definition.token) {
    throw createRemoteServiceError("remote_health_missing_token", "缺少远端访问令牌。", 400);
  }
  let healthUrl;
  try {
    healthUrl = new URL(source.definition.indexUrl);
  } catch (error) {
    throw createRemoteServiceError("remote_health_invalid_url", "远端健康检查地址无效。", 400, error);
  }
  healthUrl.pathname = healthUrl.pathname.replace(/\/api\/codex-session-index$/, "/api/share-health");
  const deadline = createDeadlineSignal(options.signal, remoteHttpLimits.deadlineMs, "remote_health_deadline_exceeded");
  let response;
  try {
    response = await fetchWithDeadline(fetch, healthUrl, {
      headers: {
        authorization: `Bearer ${source.definition.token}`,
      },
    }, { signal: deadline.signal }).catch((error) => {
      if (isRemoteAbortError(error)) throw error;
      if (error?.code === "remote_health_deadline_exceeded") throw createRemoteServiceError(error.code, "远端健康检查超时。", 502, error);
      throw createRemoteServiceError("remote_health_unreachable", `远端健康检查不可达：${error?.message || "连接失败"}`, 502, error);
    });
  if (response.status === 401 || response.status === 403) {
    throw createRemoteServiceError("remote_health_auth_failed", "远端认证失败。", response.status);
  }
  if (!response.ok) {
    throw createRemoteServiceError(
      "remote_health_http_failed",
      `远端健康检查失败：HTTP ${response.status}`,
      remoteHttpFailureStatus(response.status),
    );
  }
    const data = await readRemoteJson(response, {
      code: "remote_health_non_json",
      message: "远端健康检查返回非 JSON。",
      maxBytes: remoteHttpLimits.healthMaxBytes,
      signal: deadline.signal,
    });
    return {
      ok: true,
      status: response.status,
      remote: {
        codexHome: data.codexHome || null,
        requiresAuth: data.requiresAuth !== false,
        time: data.time || null,
      },
    };
  } finally {
    deadline.dispose();
  }
}

async function buildCompactView(context, { session, normalizedEvents, turns, hierarchy, options = {} }) {
  throwIfRequestAborted(options.signal);
  const depth = options.depth ?? 0;
  const maxDepth = options.maxDepth ?? 3;
  const childById = new Map(hierarchy.children.map((child) => [child.childThreadId, child]));
  const spawnByChildId = findSpawnAgentEvents(normalizedEvents, childById);
  const notificationByChildId = findSubagentNotifications(normalizedEvents, childById);
  const childNodes = new Map();

  if (depth < maxDepth) {
    for (const child of hierarchy.children) {
      const childSummary = await buildCompactChildNode(context, child, {
        depth,
        maxDepth,
        spawnEvent: spawnByChildId.get(child.childThreadId),
        notificationEvent: notificationByChildId.get(child.childThreadId),
        signal: options.signal,
      });
      childNodes.set(child.childThreadId, childSummary);
    }
  } else {
    for (const child of hierarchy.children) {
      childNodes.set(
        child.childThreadId,
        compactChildPlaceholder(child, {
          depth,
          reason: "max-depth",
          spawnEvent: spawnByChildId.get(child.childThreadId),
          notificationEvent: notificationByChildId.get(child.childThreadId),
        }),
      );
    }
  }

  const placedChildIds = new Set();
  const compactTurns = turns.map((turn, turnIndex) => {
    const turnStart = toMs(turn.startedAt) ?? -Infinity;
    const turnEnd = toMs(turn.completedAt) ?? Infinity;
    const children = [];
    for (const child of hierarchy.children) {
      const spawnEvent = spawnByChildId.get(child.childThreadId);
      const notificationEvent = notificationByChildId.get(child.childThreadId);
      const anchor = spawnEvent || notificationEvent;
      const anchorMs = toMs(anchor?.timestamp);
      if (anchor && anchorMs != null && anchorMs >= turnStart && anchorMs <= turnEnd) {
        const childNode = childNodes.get(child.childThreadId);
        if (childNode) {
          children.push(childNode);
          placedChildIds.add(child.childThreadId);
        }
      }
    }

    return compactTurnForView(turn, turnIndex, children, { turns });
  });

  const unplacedChildren = hierarchy.children
    .filter((child) => !placedChildIds.has(child.childThreadId))
    .map((child) => childNodes.get(child.childThreadId))
    .filter(Boolean);

  return {
    session: compactCompactSession(session),
    depth,
    maxDepth,
    turns: compactTurns,
    children: unplacedChildren,
  };
}

async function buildCompactChildNode(sourceContext, child, context) {
  const thread = child.thread || {};
  const base = compactChildBase(child, context);
  if (!thread.id || !thread.path) {
    return { ...base, unavailable: true, unavailableReason: "missing-thread-path", turns: [], children: [] };
  }
  try {
    throwIfRequestAborted(context.signal);
    const childSession = await getSessionById(sourceContext, thread.id, { signal: context.signal });
    if (!childSession?.path) return { ...base, unavailable: true, unavailableReason: "missing-session", turns: [], children: [] };
    const result = await sourceContext.sessionDetailCoordinator.read(childSession, {
      cacheKey: `compact:${sourceContext.source.id}:${thread.id}:depth=${context.depth + 1}:maxDepth=${context.maxDepth}`,
      signal: context.signal,
      derive: async (rawEvents, stat, signal) => {
        const childSessionWithStat = withFileStat(childSession, stat);
        const childHierarchy = await getThreadHierarchy(sourceContext, thread.id, { signal });
        return buildCompactView(sourceContext, {
          session: childSessionWithStat,
          normalizedEvents: rawEvents.map(analysisEventFromRaw),
          turns: buildTurns(rawEvents),
          hierarchy: childHierarchy,
          options: { depth: context.depth + 1, maxDepth: context.maxDepth, signal },
        });
      },
    });
    if (result.state !== "ready") return { ...base, unavailable: true, unavailableReason: result.code || result.reason || "read-limited", turns: [], children: [] };
    return { ...base, session: result.value.session, turns: result.value.turns, children: result.value.children };
  } catch (error) {
    if (isAbortError(error)) throw error;
    return { ...base, unavailable: true, unavailableReason: error?.message || "read-failed", turns: [], children: [] };
  }
}

async function sessionFromFilePath(context, filePath, options = {}) {
  let stat = null;
  try {
    stat = await fs.stat(filePath);
  } catch {
    // The caller handles unreadable files when it tries to open the detail.
  }
  const id = sessionIdFromFile(filePath);
  const events = await readJsonl(filePath, { maxLines: 40, maxBytes: 128 * 1024, signal: options.signal }).catch((error) => {
    if (isAbortError(error)) throw error;
    return [];
  });
  const meta = sessionMetaFromEvents(events);
  return withFileStat(
    withSubagentMeta({
      id,
      sourceId: context.source.id,
      sourceLabel: context.source.label,
      dataSourceKind: context.source.kind,
      title: meta.title || extractTitleFromEvents(events, path.basename(filePath, ".jsonl")),
      cwd: stripLongPathPrefix(meta.cwd || "") || null,
      originator: meta.originator || null,
      model: meta.model || meta.modelId || meta.model_provider || null,
      reasoningEffort: meta.reasoning_effort || meta.reasoningEffort || null,
      source: meta.source || (context.source.kind === "pi-agent" ? "pi-agent" : null),
      threadSource: meta.thread_source || null,
      modelProvider: meta.model_provider || meta.provider || null,
      archived: options.archived ?? false,
      archivedAt: null,
      agentNickname: null,
      agentRole: null,
      preview: null,
      status: deriveSessionStatusFromEvents(events),
      path: filePath,
      relativePath: relativeCodexPath(context.codexHome, filePath),
      startedAt: toIso(meta.timestamp) || sessionStartedFromFile(filePath),
      updatedAt: null,
      sizeBytes: null,
      fileModifiedAt: null,
    }),
    stat,
  );
}

async function getSessionMarkdown(context, id, options = {}) {
  throwIfRequestAborted(options.signal);
  const session = await getSessionById(context, id, { signal: options.signal });
  if (!session) return null;
  const result = await context.sessionDetailCoordinator.read(session, {
    cacheKey: `markdown:${context.source.id}:${id}`,
    signal: options.signal,
    derive: (rawEvents) => renderConversationMarkdown(session, buildTurns(rawEvents)),
  });
  return result.state === "ready" ? { markdown: result.value, readState: null } : { markdown: null, readState: result };
}

async function getThreadHierarchy(context, threadId, options = {}) {
  throwIfRequestAborted(options.signal);
  const edges = await context.threadStore.readSpawnEdges();
  const directEdges = edges.filter((edge) => edge.parentThreadId === threadId);
  const parentEdges = edges.filter((edge) => edge.childThreadId === threadId);
  const primaryParentEdge = parentEdges[0] || null;
  const siblingEdges = primaryParentEdge
    ? edges.filter((edge) => edge.parentThreadId === primaryParentEdge.parentThreadId)
    : [];
  const childIds = directEdges.map((edge) => edge.childThreadId);
  const parentIds = parentEdges.map((edge) => edge.parentThreadId);
  const siblingIds = siblingEdges.map((edge) => edge.childThreadId);
  const threads = await enrichThreadRowsFromFiles(
    context,
    await context.threadStore.readThreadRowsByIds([threadId, ...childIds, ...parentIds, ...siblingIds]),
    options,
  );
  const modelOptions = sourceModelOptions(context);
  return {
    parent: primaryParentEdge
      ? {
          ...primaryParentEdge,
          thread: publicThreadMeta(threads.get(primaryParentEdge.parentThreadId), context.codexHome, modelOptions),
        }
      : null,
    children: directEdges.map((edge) => ({
      ...edge,
      thread: publicThreadMeta(threads.get(edge.childThreadId), context.codexHome, modelOptions),
    })),
    siblings: siblingEdges.map((edge) => ({
      ...edge,
      thread: publicThreadMeta(threads.get(edge.childThreadId), context.codexHome, modelOptions),
      active: edge.childThreadId === threadId,
    })),
  };
}

async function serveStatic(req, res, pathname) {
  if (req.method !== "GET") return sendError(res, 405, "Method not allowed");
  return serveStaticFile(res, publicDir, pathname);
}

async function readJsonBody(req, maxBytes = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const error = new Error("Request body too large");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Invalid JSON body");
    error.status = 400;
    throw error;
  }
}

function allowMethod(req, res, methods) {
  if (methods.includes(req.method)) return true;
  sendError(res, 405, "Method not allowed");
  return false;
}

function requestAbortSubscription(req, res) {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) controller.abort();
  };
  const onResponseClose = () => {
    if (!res.writableEnded) abort();
  };
  req.once("aborted", abort);
  res.once("close", onResponseClose);
  return {
    signal: controller.signal,
    dispose: () => {
      req.removeListener("aborted", abort);
      res.removeListener("close", onResponseClose);
    },
  };
}

function isReadOnlyApiPath(pathname) {
  return (
    pathname === "/api/health" ||
    pathname === "/api/sources" ||
    pathname === "/api/sessions" ||
    pathname.startsWith("/api/sessions/") ||
    pathname.startsWith("/api/query/") ||
    /^\/api\/sources\/[^/]+\/index$/.test(pathname) ||
    /^\/api\/sources\/[^/]+\/prompts$/.test(pathname) ||
    /^\/api\/sources\/[^/]+\/sessions(?:\/.*)?$/.test(pathname) ||
    /^\/api\/sources\/[^/]+\/query\/.*$/.test(pathname)
  );
}

async function route(req, res) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const pathname = url.pathname;
  const requestSubscription = requestAbortSubscription(req, res);
  try {
    if (isReadOnlyApiPath(pathname) && !allowMethod(req, res, ["GET"])) return;

    if (pathname === "/api/health") {
      const localContext = getSourceContext("local");
      return sendJson(res, 200, {
        ok: true,
        codexHome: localContext?.codexHome,
        sessionsRoot: localContext?.sessionsRoot,
        sessionIndexPath: localContext?.sessionIndexPath,
        defaultSourceId: "local",
        sources: dataSources.listSources(),
        time: new Date().toISOString(),
      });
    }
    if (pathname === "/api/sources") {
      return sendJson(res, 200, { sources: dataSources.listSources() });
    }
    if (pathname === "/api/peers") {
      if (req.method === "GET") {
        return sendJson(res, 200, { peers: await configStore.listPeers(), sources: dataSources.listSources() });
      }
      if (req.method === "POST") {
        const previousVersions = remoteSourceVersions();
        const peer = await configStore.upsertPeer(await readJsonBody(req));
        await reloadDataSources();
        const source = dataSources.getSource(peer.id);
        return sendJson(res, 200, {
          peer,
          peers: await configStore.listPeers(),
          sources: dataSources.listSources(),
          configuration: sourceConfigurationChange(previousVersions.get(peer.id), source),
        });
      }
      return sendError(res, 405, "Method not allowed");
    }
    const peerMatch = pathname.match(/^\/api\/peers\/([^/]+)$/);
    if (peerMatch) {
      const peerId = decodeURIComponent(peerMatch[1]);
      if (req.method === "PUT") {
        const previousVersions = remoteSourceVersions();
        const peer = await configStore.upsertPeer({ ...(await readJsonBody(req)), id: peerId });
        await reloadDataSources();
        const source = dataSources.getSource(peer.id);
        return sendJson(res, 200, {
          peer,
          peers: await configStore.listPeers(),
          sources: dataSources.listSources(),
          configuration: sourceConfigurationChange(previousVersions.get(peer.id), source),
        });
      }
      if (req.method === "DELETE") {
        const previousVersions = remoteSourceVersions();
        const deleted = await configStore.deletePeer(peerId);
        await reloadDataSources();
        return sendJson(res, deleted ? 200 : 404, {
          ok: deleted,
          peers: await configStore.listPeers(),
          sources: dataSources.listSources(),
          configuration: deleted ? sourceConfigurationChange(previousVersions.get(peerId), null, { deleted: true }) : null,
        });
      }
      return sendError(res, 405, "Method not allowed");
    }
    const peerTestMatch = pathname.match(/^\/api\/peers\/([^/]+)\/test$/);
    if (peerTestMatch) {
      if (req.method !== "POST") return sendError(res, 405, "Method not allowed");
      const source = dataSources.getSource(decodeURIComponent(peerTestMatch[1]));
      if (!source) return sendError(res, 404, "Peer not found");
      return sendJson(res, 200, await testRemotePeer(source, { signal: requestSubscription.signal }));
    }
    const sourceIndexMatch = pathname.match(/^\/api\/sources\/([^/]+)\/index$/);
    if (sourceIndexMatch) {
      const source = dataSources.getSource(decodeURIComponent(sourceIndexMatch[1]));
      if (!source) return sendError(res, 404, "Data source not found");
      const result = await queryRemoteSessionIndex(source, url.searchParams, { signal: requestSubscription.signal });
      if (!result.ok) return sendError(res, result.status || 502, result.error || "Remote index is not available");
      return sendJson(res, 200, {
        source: dataSources.listSources().find((item) => item.id === source.id),
        page: result.page,
        sessions: result.sessions,
      });
    }
    const sourceRefreshMatch = pathname.match(/^\/api\/sources\/([^/]+)\/refresh$/);
    const sourcePromptsMatch = pathname.match(/^\/api\/sources\/([^/]+)\/prompts$/);
    if (sourcePromptsMatch) {
      const context = getSourceContext(decodeURIComponent(sourcePromptsMatch[1]));
      if (!context) return sendError(res, 404, "Data source not found");
      const subscription = requestAbortSubscription(req, res);
      try {
        const archive = await queryPromptArchive(context, url.searchParams, { signal: subscription.signal });
        if (!subscription.signal.aborted && !res.destroyed) return sendJson(res, 200, archive);
        return undefined;
      } finally {
        subscription.dispose();
      }
    }
    if (sourceRefreshMatch) {
      if (req.method !== "POST") return sendError(res, 405, "Method not allowed");
      const sourceId = decodeURIComponent(sourceRefreshMatch[1]);
      const result = await dataSources.refreshSource(sourceId, { signal: requestSubscription.signal });
      invalidateSourceContext(sourceId);
      if (!result.ok) {
        const status = result.status || 502;
        return sendJson(res, status, {
          ok: false,
          source: result.source,
          error: result.error || result.source?.status?.error || { code: "refresh_failed", message: "刷新失败。" },
        });
      }
      return sendJson(res, 200, { ok: true, source: result.source });
    }
    if (pathname === "/api/sessions") {
      const context = resolveRequestSource(url);
      if (!context) return sendError(res, 404, "Data source not found");
      const scope = normalizeSessionCatalogScope(url.searchParams.get("scope"));
      const sessions = (await listSessions(context, { scope })).map(compactSessionForList);
      return sendJson(res, 200, { scope, sessions });
    }
    const sourceSessionsMatch = pathname.match(/^\/api\/sources\/([^/]+)\/sessions$/);
    if (sourceSessionsMatch) {
      const context = getSourceContext(decodeURIComponent(sourceSessionsMatch[1]));
      if (!context) return sendError(res, 404, "Data source not found");
      const scope = normalizeSessionCatalogScope(url.searchParams.get("scope"));
      const sessions = (await listSessions(context, { scope })).map(compactSessionForList);
      return sendJson(res, 200, { source: dataSources.listSources().find((source) => source.id === context.source.id), scope, sessions });
    }
    const sourceMarkdownMatch = pathname.match(/^\/api\/sources\/([^/]+)\/sessions\/([^/]+)\/markdown$/);
    if (sourceMarkdownMatch) {
      const context = getSourceContext(decodeURIComponent(sourceMarkdownMatch[1]));
      if (!context) return sendError(res, 404, "Data source not found");
      const markdown = await getSessionMarkdown(context, decodeURIComponent(sourceMarkdownMatch[2]), { signal: requestSubscription.signal });
      if (markdown == null) return sendError(res, 404, "Session not found");
      if (markdown.readState) return sendJson(res, 413, { error: "会话详情超过读取上限", code: markdown.readState.code, readState: markdown.readState });
      return sendText(res, 200, markdown.markdown);
    }
    const sourceEventMatch = pathname.match(/^\/api\/sources\/([^/]+)\/sessions\/([^/]+)\/events\/(\d+)$/);
    if (sourceEventMatch) {
      const context = getSourceContext(decodeURIComponent(sourceEventMatch[1]));
      if (!context) return sendError(res, 404, "Data source not found");
      const event = await getSessionEvent(context, decodeURIComponent(sourceEventMatch[2]), Number(sourceEventMatch[3]), { signal: requestSubscription.signal, snapshot: url.searchParams.get("snapshot") || "" });
      if (!event) return sendError(res, 404, "Event not found");
      return sendJson(res, 200, event);
    }
    const sourceSessionMatch = pathname.match(/^\/api\/sources\/([^/]+)\/sessions\/([^/]+)$/);
    if (sourceSessionMatch) {
      const context = getSourceContext(decodeURIComponent(sourceSessionMatch[1]));
      if (!context) return sendError(res, 404, "Data source not found");
      const detail = await getSessionDetail(context, decodeURIComponent(sourceSessionMatch[2]), {
        evidenceRiskRules: parseEvidenceRiskRulesParam(url.searchParams),
        signal: requestSubscription.signal,
      });
      if (!detail) return sendError(res, 404, "Session not found");
      return sendJson(res, 200, detail);
    }
    if (pathname === "/api/query/sessions") {
      const context = resolveRequestSource(url);
      if (!context) return sendError(res, 404, "Data source not found");
      return sendJson(res, 200, await querySessions(context, url.searchParams, queryProjectionOptions(context, url)));
    }
    const queryViewMatch = pathname.match(/^\/api\/query\/sessions\/([^/]+)\/view$/);
    if (queryViewMatch) {
      const context = resolveRequestSource(url);
      if (!context) return sendError(res, 404, "Data source not found");
      const view = await querySessionView(context, decodeURIComponent(queryViewMatch[1]), url.searchParams, queryProjectionOptions(context, url), { signal: requestSubscription.signal });
      if (!view) return sendError(res, 404, "Session not found");
      return sendJson(res, 200, view);
    }
    const queryEventsMatch = pathname.match(/^\/api\/query\/sessions\/([^/]+)\/events$/);
    if (queryEventsMatch) {
      const context = resolveRequestSource(url);
      if (!context) return sendError(res, 404, "Data source not found");
      const events = await querySessionEvents(context, decodeURIComponent(queryEventsMatch[1]), url.searchParams, queryProjectionOptions(context, url), { signal: requestSubscription.signal });
      if (!events) return sendError(res, 404, "Session not found");
      return sendJson(res, 200, events);
    }
    const sourceQuerySessionsMatch = pathname.match(/^\/api\/sources\/([^/]+)\/query\/sessions$/);
    if (sourceQuerySessionsMatch) {
      const context = getSourceContext(decodeURIComponent(sourceQuerySessionsMatch[1]));
      if (!context) return sendError(res, 404, "Data source not found");
      return sendJson(res, 200, await querySessions(context, url.searchParams, { sourceId: context.source.id }));
    }
    const sourceQueryViewMatch = pathname.match(/^\/api\/sources\/([^/]+)\/query\/sessions\/([^/]+)\/view$/);
    if (sourceQueryViewMatch) {
      const context = getSourceContext(decodeURIComponent(sourceQueryViewMatch[1]));
      if (!context) return sendError(res, 404, "Data source not found");
      const view = await querySessionView(context, decodeURIComponent(sourceQueryViewMatch[2]), url.searchParams, { sourceId: context.source.id }, { signal: requestSubscription.signal });
      if (!view) return sendError(res, 404, "Session not found");
      return sendJson(res, 200, view);
    }
    const sourceQueryEventsMatch = pathname.match(/^\/api\/sources\/([^/]+)\/query\/sessions\/([^/]+)\/events$/);
    if (sourceQueryEventsMatch) {
      const context = getSourceContext(decodeURIComponent(sourceQueryEventsMatch[1]));
      if (!context) return sendError(res, 404, "Data source not found");
      const events = await querySessionEvents(context, decodeURIComponent(sourceQueryEventsMatch[2]), url.searchParams, { sourceId: context.source.id }, { signal: requestSubscription.signal });
      if (!events) return sendError(res, 404, "Session not found");
      return sendJson(res, 200, events);
    }
    const markdownMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/markdown$/);
    if (markdownMatch) {
      const context = resolveRequestSource(url);
      if (!context) return sendError(res, 404, "Data source not found");
      const markdown = await getSessionMarkdown(context, decodeURIComponent(markdownMatch[1]), { signal: requestSubscription.signal });
      if (markdown == null) return sendError(res, 404, "Session not found");
      if (markdown.readState) return sendJson(res, 413, { error: "会话详情超过读取上限", code: markdown.readState.code, readState: markdown.readState });
      return sendText(res, 200, markdown.markdown);
    }
    const eventMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/events\/(\d+)$/);
    if (eventMatch) {
      const context = resolveRequestSource(url);
      if (!context) return sendError(res, 404, "Data source not found");
      const event = await getSessionEvent(context, decodeURIComponent(eventMatch[1]), Number(eventMatch[2]), { signal: requestSubscription.signal, snapshot: url.searchParams.get("snapshot") || "" });
      if (!event) return sendError(res, 404, "Event not found");
      return sendJson(res, 200, event);
    }
    const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
    if (sessionMatch) {
      const context = resolveRequestSource(url);
      if (!context) return sendError(res, 404, "Data source not found");
      const detail = await getSessionDetail(context, decodeURIComponent(sessionMatch[1]), {
        evidenceRiskRules: parseEvidenceRiskRulesParam(url.searchParams),
        signal: requestSubscription.signal,
      });
      if (!detail) return sendError(res, 404, "Session not found");
      return sendJson(res, 200, detail);
    }
    return serveStatic(req, res, pathname);
  } catch (error) {
    if (isAbortError(error) || res.destroyed) return undefined;
    const status = error?.status || 500;
    const publicMessage = status >= 500 && !isRemoteServiceError(error) ? "Internal server error" : sanitizeErrorMessage(error?.message || "Bad request");
    return sendError(res, status, publicMessage, {
      name: error?.name,
      code: error?.code,
      status,
      message: publicMessage,
    });
  } finally {
    requestSubscription.dispose();
  }
}

function resolveRequestSource(url) {
  return getSourceContext(url.searchParams.get("sourceId") || "local");
}

function queryProjectionOptions(context, url) {
  if (url.searchParams.has("sourceId") && context.source.id !== "local") {
    return { sourceId: context.source.id };
  }
  return {};
}

function createRendererServer(options = {}) {
  const listenHost = options.host || host;
  const listenToken = options.token ?? accessToken;
  assertSecureListenConfig({ host: listenHost, token: listenToken });
  const requestRoute = options.route || route;
  const accessControl = options.accessControl || createAccessControl({ host: listenHost, token: listenToken });
  return createServer((req, res) => {
    if (!requireAuthorizedRequest(req, res, accessControl)) return;
    return requestRoute(req, res);
  });
}

function startServer(options = {}) {
  const listenPort = options.port ?? port;
  const listenHost = options.host ?? host;
  const listenToken = options.token ?? accessToken;
  const server = createRendererServer({ ...options, host: listenHost, token: listenToken });
  return server.listen(listenPort, listenHost, () => {
    console.log(`Codex session renderer: http://${listenHost}:${listenPort}/`);
    for (const source of dataSources.listSources()) {
      console.log(`Read-only data source [${source.id}]: ${source.kind === "local" ? source.codexHome : source.snapshotPath}`);
    }
  });
}

function isDirectRun() {
  if (!process.argv[1]) return false;
  const currentPath = path.resolve(fileURLToPath(import.meta.url));
  const entryPath = path.resolve(process.argv[1]);
  return process.platform === "win32" ? currentPath.toLowerCase() === entryPath.toLowerCase() : currentPath === entryPath;
}

if (isDirectRun()) {
  try {
    startServer();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

export {
  assertSecureListenConfig,
  createAccessControl,
  createRendererServer,
  route,
  startServer,
};
