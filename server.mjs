import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAuditChain } from "./src/audit-chain.mjs";
import { createDataSourceRegistry } from "./src/data-sources.mjs";
import { evidenceRiskRulesFingerprint, normalizeEvidenceRiskRules } from "./src/evidence-risk-rules.mjs";
import { sendError, sendJson, sendText, serveStaticFile } from "./src/http-response.mjs";
import { createRendererConfigStore } from "./src/renderer-config.mjs";
import { readJsonl, readJsonlLineWithDiagnostics, readJsonlRange, readJsonlWithDiagnostics } from "./src/jsonl-reader.mjs";
import {
  buildTrace,
  buildTurns,
  classifyEvent,
  compactChildBase,
  compactChildPlaceholder,
  compactCompactSession,
  compactTurnsForClient,
  compactTurnForView,
  eventTime,
  extractTitleFromEvents,
  fileTimeMs,
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
import { normalizeSessionEvent } from "./src/session-normalizer.mjs";
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
const port = Number(process.env.PORT || 4789);
const configStore = createRendererConfigStore();
let rendererConfig = await configStore.readConfig();
let dataSources = createDataSourceRegistry({ config: rendererConfig });
const sourceContexts = new Map();

async function reloadDataSources() {
  rendererConfig = await configStore.readConfig();
  dataSources = createDataSourceRegistry({ config: rendererConfig });
  sourceContexts.clear();
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
    allSessionCache: null,
    allSessionCacheTime: 0,
    sessionDetailCache: new Map(),
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
  context.allSessionCache = null;
  context.allSessionCacheTime = 0;
  context.sessionDetailCache.clear();
}

async function* walkJsonl(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkJsonl(fullPath);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      yield fullPath;
    }
  }
}

async function readIndex(context) {
  const byId = new Map();
  try {
    const rows = await readJsonl(context.sessionIndexPath);
    for (const row of rows) {
      if (!row?.id) continue;
      byId.set(row.id, {
        id: row.id,
        title: row.thread_name || row.name || "未命名会话",
        updatedAt: toIso(row.updated_at) || toIso(row.updatedAt),
      });
    }
  } catch {
    // The session files themselves remain authoritative when the index is absent.
  }
  return byId;
}

async function listSessions(context) {
  const now = Date.now();
  if (context.sessionCache && now - context.sessionCacheTime < 3000) return context.sessionCache;

  const threads = await context.threadStore.readThreads();
  if (threads.size > 0) {
    const spawnEdges = await context.threadStore.readSpawnEdges();
    const sessions = [];
    for (const thread of threads.values()) {
      const session = sessionFromThread(thread, context.codexHome, sourceModelOptions(context));
      if (await sessionFileExists(session)) sessions.push(session);
    }
    const rootSessions = rootSessionsOnly(sessions, spawnEdges);
    rootSessions.sort((a, b) => new Date(b.updatedAt || b.fileModifiedAt || 0) - new Date(a.updatedAt || a.fileModifiedAt || 0));
    context.sessionCache = rootSessions.slice(0, maxListSessions);
    context.sessionCacheTime = now;
    return context.sessionCache;
  }

  const sessions = await listFileSessions(context);
  const rootSessions = rootSessionsOnly(sessions, spawnEdgesFromSessions(sessions));
  rootSessions.sort((a, b) => new Date(b.updatedAt || b.fileModifiedAt) - new Date(a.updatedAt || a.fileModifiedAt));
  context.sessionCache = rootSessions.slice(0, maxListSessions);
  context.sessionCacheTime = now;
  return context.sessionCache;
}

async function listFileSessions(context) {
  const index = await readIndex(context);
  const files = [];
  for await (const filePath of walkJsonl(context.sessionsRoot)) {
    files.push(filePath);
  }

  const sessions = [];
  for (const filePath of files) {
    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch {
      continue;
    }
    const id = sessionIdFromFile(filePath);
    const indexed = index.get(id);
    let events = [];
    try {
      events = await readJsonl(filePath, { maxLines: 40 });
    } catch {
      // Keep the unreadable file visible in diagnostics.
    }
    const meta = sessionMetaFromEvents(events);
    sessions.push(
      withSubagentMeta({
        id,
        sourceId: context.source.id,
        sourceLabel: context.source.label,
        dataSourceKind: context.source.kind,
        title: indexed?.title || extractTitleFromEvents(events, path.basename(filePath, ".jsonl")),
        cwd: stripLongPathPrefix(meta.cwd || "") || null,
        originator: meta.originator || null,
        model: meta.model || meta.model_provider || null,
        reasoningEffort: null,
        source: meta.source || null,
        threadSource: meta.thread_source || null,
        modelProvider: meta.model_provider || null,
        archived: false,
        archivedAt: null,
        agentNickname: null,
        agentRole: null,
        preview: null,
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
  return events.find((event) => event.type === "session_meta")?.payload ?? {};
}

async function enrichSessionFromFileMeta(session) {
  if (!session?.path) return withSubagentMeta(session);
  const events = await readJsonl(session.path, { maxLines: 40 }).catch(() => []);
  const meta = sessionMetaFromEvents(events);
  const sourceForExtraction = meta.source || session.source || null;
  const enriched = withSubagentMeta({
    ...session,
    cwd: session.cwd || stripLongPathPrefix(meta.cwd || "") || null,
    originator: session.originator || meta.originator || null,
    model: session.model || meta.model || meta.model_provider || null,
    source: sourceForExtraction,
    threadSource: session.threadSource || meta.thread_source || null,
    modelProvider: session.modelProvider || meta.model_provider || null,
    startedAt: session.startedAt || toIso(meta.timestamp) || null,
  });
  return {
    ...enriched,
    source: session.source || sourceForExtraction,
  };
}

async function enrichThreadRowsFromFiles(context, threads) {
  const enriched = new Map();
  await Promise.all(
    [...threads.entries()].map(async ([id, thread]) => {
      const session = sessionFromThread(thread, context.codexHome, sourceModelOptions(context));
      const sessionMeta = await enrichSessionFromFileMeta(session);
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

async function getSessionById(context, id) {
  const cached = context.sessionCache?.find((session) => session.id === id);
  if (cached) return cached;

  const thread = (await context.threadStore.readThreadRowsByIds([id])).get(id);
  if (thread) {
    const session = sessionFromThread(thread, context.codexHome, sourceModelOptions(context));
    if (await sessionFileExists(session)) return enrichSessionFromFileMeta(session);
  }

  const sessions = await listSessions(context);
  const listed = sessions.find((session) => session.id === id);
  if (listed) return listed;

  for await (const filePath of walkJsonl(context.sessionsRoot)) {
    if (sessionIdFromFile(filePath) === id) return sessionFromFilePath(context, filePath);
  }
  return null;
}

async function listAllSessionsForQuery(context) {
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

async function sessionFileExists(session) {
  if (!session?.path) return false;
  try {
    const stat = await fs.stat(session.path);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function querySessions(context, params) {
  const query = parseSessionListQuery(params);
  const [sessions, spawnEdges] = await Promise.all([listAllSessionsForQuery(context), context.threadStore.readSpawnEdges()]);
  const filtered = filterSessions(sessions, query, spawnEdges);
  const sorted = sortSessions(filtered, query);
  const page = paginateSessions(sorted, query);
  return {
    sessions: page.items.map((session) => projectSessionForApi(session, query)),
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

async function getSessionDetail(context, id, options = {}) {
  const session = await getSessionById(context, id);
  if (!session) return null;
  const maxDepth = options.maxDepth ?? 3;
  const evidenceRiskRules = normalizeEvidenceRiskRules(options.evidenceRiskRules);
  const evidenceRiskRulesKey = evidenceRiskRulesFingerprint(evidenceRiskRules);
  const stat = await fs.stat(session.path);
  const sessionWithStat = withFileStat(session, stat);
  const hierarchy = await getThreadHierarchy(context, id);
  const cacheKey = `${id}:maxDepth=${maxDepth}:evidenceRiskRules=${evidenceRiskRulesKey}`;
  const cached = context.sessionDetailCache.get(cacheKey);
  if (cached && cached.mtimeMs === fileTimeMs(stat) && cached.size === stat.size && hierarchy.children.length === 0) return cached.detail;

  const rawEvents = await readJsonlWithDiagnostics(session.path);
  const analysisEvents = rawEvents.map(analysisEventFromRaw);
  const publicEvents = analysisEvents.map(({ payload, ...event }) => ({
    index: event.index,
    timestamp: event.timestamp,
    kind: event.kind,
    semanticKind: event.semanticKind,
    important: event.important,
    role: event.role,
    messageId: event.messageId,
    parentId: event.parentId,
    title: event.title,
    preview: event.preview,
    payloadSize: event.payloadSize,
    rawSize: event.rawSize,
    attachments: event.attachments,
    reasoning: event.reasoning,
    diagnostic: event.diagnostic,
  }));
  const turns = buildTurns(rawEvents);
  const publicTurns = compactTurnsForClient(turns);
  const trace = buildTrace(sessionWithStat, rawEvents, analysisEvents, turns, hierarchy);
  const compact = await buildCompactView(context, sessionWithStat, analysisEvents, turns, hierarchy, { maxDepth });
  const audit = buildAuditChain({ turns, evidenceRiskRules });
  const stats = {
    ...summarizeSessionEvents(rawEvents),
    eventCount: rawEvents.length,
    diagnosticEventCount: analysisEvents.filter((event) => event.kind === "jsonl_parse_error").length,
    turnCount: turns.length,
    importantEventCount: analysisEvents.filter((event) => event.important).length,
    childThreadCount: hierarchy.children.length,
    sizeBytes: stat.size,
    source: {
      id: context.source.id,
      label: context.source.label,
      kind: context.source.kind,
      stale: context.source.status?.stale ?? false,
      lastSuccessfulRefreshAt: context.source.status?.lastSuccessfulRefreshAt ?? null,
    },
    codexHome: context.source.kind === "local" ? context.codexHome : null,
    dataPath: sessionWithStat.path,
  };
  const detail = { session: sessionWithStat, turns: publicTurns, events: publicEvents, stats, trace, compact, audit };
  context.sessionDetailCache.set(cacheKey, { mtimeMs: fileTimeMs(stat), size: stat.size, detail });
  return detail;
}

async function querySessionEvents(context, id, params) {
  const session = await getSessionById(context, id);
  if (!session?.path) return null;
  const query = parseSessionEventQuery(params);
  const range = await readJsonlRange(session.path, {
    start: query.cursor,
    limit: query.limit,
    maxScan: query.maxScan,
    includeInvalid: true,
    predicate: (event, index) => {
      const projected = projectEventForApi(event, index, { fields: [] });
      return eventMatchesQuery(projected, event, query);
    },
  });
  const stat = await fs.stat(session.path).catch(() => null);
  const sessionWithStat = withFileStat(session, stat);
  return {
    session: projectSessionForApi(sessionWithStat, {}),
    events: range.items.map(({ event, index }) => projectEventForApi(event, index, query)),
    page: {
      cursor: query.cursor,
      limit: query.limit,
      maxScan: query.maxScan,
      scanned: range.scanned,
      returned: range.items.length,
      nextCursor: range.nextCursor,
      hasMore: !range.exhausted,
    },
    serverTime: new Date().toISOString(),
  };
}

async function querySessionView(context, id, params) {
  const query = parseSessionViewQuery(params);
  const detail = await getSessionDetail(context, id, { maxDepth: query.maxDepth, evidenceRiskRules: parseEvidenceRiskRulesParam(params) });
  if (!detail) return null;
  const base = {
    session: projectSessionForApi(detail.session, {}),
    view: query.view,
    stats: detail.stats,
    serverTime: new Date().toISOString(),
  };
  if (query.view === "compact") return { ...base, compact: detail.compact };
  if (query.view === "turns") return { ...base, turns: detail.turns };
  if (query.view === "trace") return { ...base, trace: detail.trace };
  if (query.view === "audit") return { ...base, audit: detail.audit };
  return { ...base, detail };
}

async function getSessionEvent(context, id, index) {
  const session = await getSessionById(context, id);
  if (!session?.path) return null;
  const event = await readJsonlLineWithDiagnostics(session.path, index);
  if (!event) return null;
  const projected = projectEventForApi(event, index, { includePayload: true, includeRaw: true });
  return projected;
}

function parseEvidenceRiskRulesParam(params) {
  const text = params.get("evidenceRiskRules");
  if (!text) return [];
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error("Invalid evidenceRiskRules parameter");
    error.status = 400;
    throw error;
  }
}

async function queryRemoteSessionIndex(source, params) {
  if (source.kind !== "remote" || !source.definition?.indexUrl) {
    return {
      ok: false,
      status: 404,
      error: "Remote index is not available",
    };
  }
  if (!source.definition.token) {
    return {
      ok: false,
      status: 400,
      error: `缺少 ${source.definition.tokenEnv}。`,
    };
  }
  const indexUrl = new URL(source.definition.indexUrl);
  for (const [key, value] of params) indexUrl.searchParams.set(key, value);
  const response = await fetch(indexUrl, {
    headers: {
      authorization: `Bearer ${source.definition.token}`,
    },
  }).catch((error) => {
    throw new Error(`远端索引不可达：${error?.message || "连接失败"}`);
  });
  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      status: response.status,
      error: "远端索引认证失败。",
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: `远端索引请求失败：HTTP ${response.status}`,
    };
  }
  const data = await response.json();
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
}

async function testRemotePeer(source) {
  if (source.kind !== "remote" || !source.definition?.indexUrl) {
    return {
      ok: false,
      error: "远端索引不可用。",
    };
  }
  if (!source.definition.token) {
    return {
      ok: false,
      error: "缺少远端 token。",
    };
  }
  const healthUrl = new URL(source.definition.indexUrl);
  healthUrl.pathname = healthUrl.pathname.replace(/\/api\/codex-session-index$/, "/api/share-health");
  const response = await fetch(healthUrl, {
    headers: {
      authorization: `Bearer ${source.definition.token}`,
    },
  }).catch((error) => {
    throw new Error(`远端不可达：${error?.message || "连接失败"}`);
  });
  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      status: response.status,
      error: "远端认证失败。",
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: `远端健康检查失败：HTTP ${response.status}`,
    };
  }
  const data = await response.json();
  return {
    ok: true,
    status: response.status,
    remote: {
      codexHome: data.codexHome || null,
      requiresAuth: data.requiresAuth !== false,
      time: data.time || null,
    },
  };
}

async function buildCompactView(context, session, normalizedEvents, turns, hierarchy, options = {}) {
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

    return compactTurnForView(turn, turnIndex, children);
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
    return {
      ...base,
      unavailable: true,
      unavailableReason: "missing-thread-path",
      turns: [],
      children: [],
    };
  }

  try {
    const childSession = await getSessionById(sourceContext, thread.id);
    if (!childSession?.path) {
      return {
        ...base,
        unavailable: true,
        unavailableReason: "missing-session",
        turns: [],
        children: [],
      };
    }
    const stat = await fs.stat(childSession.path);
    const childSessionWithStat = withFileStat(childSession, stat);
    const rawEvents = await readJsonlWithDiagnostics(childSession.path);
    const normalizedEvents = rawEvents.map(analysisEventFromRaw);
    const childTurns = buildTurns(rawEvents);
    const childHierarchy = await getThreadHierarchy(sourceContext, thread.id);
    const compact = await buildCompactView(sourceContext, childSessionWithStat, normalizedEvents, childTurns, childHierarchy, {
      depth: context.depth + 1,
      maxDepth: context.maxDepth,
    });

    return {
      ...base,
      session: compact.session,
      turns: compact.turns,
      children: compact.children,
    };
  } catch (error) {
    return {
      ...base,
      unavailable: true,
      unavailableReason: error?.message || "read-failed",
      turns: [],
      children: [],
    };
  }
}

async function sessionFromFilePath(context, filePath) {
  let stat = null;
  try {
    stat = await fs.stat(filePath);
  } catch {
    // The caller handles unreadable files when it tries to open the detail.
  }
  const id = sessionIdFromFile(filePath);
  const events = await readJsonl(filePath, { maxLines: 40 }).catch(() => []);
  const meta = sessionMetaFromEvents(events);
  return withFileStat(
    withSubagentMeta({
      id,
      sourceId: context.source.id,
      sourceLabel: context.source.label,
      dataSourceKind: context.source.kind,
      title: extractTitleFromEvents(events, path.basename(filePath, ".jsonl")),
      cwd: stripLongPathPrefix(meta.cwd || "") || null,
      originator: meta.originator || null,
      model: meta.model || meta.model_provider || null,
      reasoningEffort: null,
      source: meta.source || null,
      threadSource: meta.thread_source || null,
      modelProvider: meta.model_provider || null,
      archived: false,
      archivedAt: null,
      agentNickname: null,
      agentRole: null,
      preview: null,
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

async function getSessionMarkdown(context, id) {
  const session = await getSessionById(context, id);
  if (!session) return null;
  const rawEvents = await readJsonlWithDiagnostics(session.path);
  return renderConversationMarkdown(session, buildTurns(rawEvents));
}

async function getThreadHierarchy(context, threadId) {
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

async function route(req, res) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const pathname = url.pathname;
  try {
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
        const peer = await configStore.upsertPeer(await readJsonBody(req));
        await reloadDataSources();
        return sendJson(res, 200, { peer, peers: await configStore.listPeers(), sources: dataSources.listSources() });
      }
      return sendError(res, 405, "Method not allowed");
    }
    const peerMatch = pathname.match(/^\/api\/peers\/([^/]+)$/);
    if (peerMatch) {
      const peerId = decodeURIComponent(peerMatch[1]);
      if (req.method === "PUT") {
        const peer = await configStore.upsertPeer({ ...(await readJsonBody(req)), id: peerId });
        await reloadDataSources();
        return sendJson(res, 200, { peer, peers: await configStore.listPeers(), sources: dataSources.listSources() });
      }
      if (req.method === "DELETE") {
        const deleted = await configStore.deletePeer(peerId);
        await reloadDataSources();
        return sendJson(res, deleted ? 200 : 404, { ok: deleted, peers: await configStore.listPeers(), sources: dataSources.listSources() });
      }
      return sendError(res, 405, "Method not allowed");
    }
    const peerTestMatch = pathname.match(/^\/api\/peers\/([^/]+)\/test$/);
    if (peerTestMatch) {
      if (req.method !== "POST") return sendError(res, 405, "Method not allowed");
      const source = dataSources.getSource(decodeURIComponent(peerTestMatch[1]));
      if (!source) return sendError(res, 404, "Peer not found");
      return sendJson(res, 200, await testRemotePeer(source));
    }
    const sourceIndexMatch = pathname.match(/^\/api\/sources\/([^/]+)\/index$/);
    if (sourceIndexMatch) {
      const source = dataSources.getSource(decodeURIComponent(sourceIndexMatch[1]));
      if (!source) return sendError(res, 404, "Data source not found");
      const result = await queryRemoteSessionIndex(source, url.searchParams);
      if (!result.ok) return sendError(res, result.status || 502, result.error || "Remote index is not available");
      return sendJson(res, 200, {
        source: dataSources.listSources().find((item) => item.id === source.id),
        page: result.page,
        sessions: result.sessions,
      });
    }
    const sourceRefreshMatch = pathname.match(/^\/api\/sources\/([^/]+)\/refresh$/);
    if (sourceRefreshMatch) {
      if (req.method !== "POST") return sendError(res, 405, "Method not allowed");
      const sourceId = decodeURIComponent(sourceRefreshMatch[1]);
      const result = await dataSources.refreshSource(sourceId);
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
      const sessions = (await listSessions(context)).map(compactSessionForList);
      return sendJson(res, 200, { sessions });
    }
    const sourceSessionsMatch = pathname.match(/^\/api\/sources\/([^/]+)\/sessions$/);
    if (sourceSessionsMatch) {
      const context = getSourceContext(decodeURIComponent(sourceSessionsMatch[1]));
      if (!context) return sendError(res, 404, "Data source not found");
      const sessions = (await listSessions(context)).map(compactSessionForList);
      return sendJson(res, 200, { source: dataSources.listSources().find((source) => source.id === context.source.id), sessions });
    }
    const sourceMarkdownMatch = pathname.match(/^\/api\/sources\/([^/]+)\/sessions\/([^/]+)\/markdown$/);
    if (sourceMarkdownMatch) {
      const context = getSourceContext(decodeURIComponent(sourceMarkdownMatch[1]));
      if (!context) return sendError(res, 404, "Data source not found");
      const markdown = await getSessionMarkdown(context, decodeURIComponent(sourceMarkdownMatch[2]));
      if (markdown == null) return sendError(res, 404, "Session not found");
      return sendText(res, 200, markdown);
    }
    const sourceEventMatch = pathname.match(/^\/api\/sources\/([^/]+)\/sessions\/([^/]+)\/events\/(\d+)$/);
    if (sourceEventMatch) {
      const context = getSourceContext(decodeURIComponent(sourceEventMatch[1]));
      if (!context) return sendError(res, 404, "Data source not found");
      const event = await getSessionEvent(context, decodeURIComponent(sourceEventMatch[2]), Number(sourceEventMatch[3]));
      if (!event) return sendError(res, 404, "Event not found");
      return sendJson(res, 200, event);
    }
    const sourceSessionMatch = pathname.match(/^\/api\/sources\/([^/]+)\/sessions\/([^/]+)$/);
    if (sourceSessionMatch) {
      const context = getSourceContext(decodeURIComponent(sourceSessionMatch[1]));
      if (!context) return sendError(res, 404, "Data source not found");
      const detail = await getSessionDetail(context, decodeURIComponent(sourceSessionMatch[2]), {
        evidenceRiskRules: parseEvidenceRiskRulesParam(url.searchParams),
      });
      if (!detail) return sendError(res, 404, "Session not found");
      return sendJson(res, 200, detail);
    }
    if (pathname === "/api/query/sessions") {
      const context = resolveRequestSource(url);
      if (!context) return sendError(res, 404, "Data source not found");
      return sendJson(res, 200, await querySessions(context, url.searchParams));
    }
    const queryViewMatch = pathname.match(/^\/api\/query\/sessions\/([^/]+)\/view$/);
    if (queryViewMatch) {
      const context = resolveRequestSource(url);
      if (!context) return sendError(res, 404, "Data source not found");
      const view = await querySessionView(context, decodeURIComponent(queryViewMatch[1]), url.searchParams);
      if (!view) return sendError(res, 404, "Session not found");
      return sendJson(res, 200, view);
    }
    const queryEventsMatch = pathname.match(/^\/api\/query\/sessions\/([^/]+)\/events$/);
    if (queryEventsMatch) {
      const context = resolveRequestSource(url);
      if (!context) return sendError(res, 404, "Data source not found");
      const events = await querySessionEvents(context, decodeURIComponent(queryEventsMatch[1]), url.searchParams);
      if (!events) return sendError(res, 404, "Session not found");
      return sendJson(res, 200, events);
    }
    const sourceQuerySessionsMatch = pathname.match(/^\/api\/sources\/([^/]+)\/query\/sessions$/);
    if (sourceQuerySessionsMatch) {
      const context = getSourceContext(decodeURIComponent(sourceQuerySessionsMatch[1]));
      if (!context) return sendError(res, 404, "Data source not found");
      return sendJson(res, 200, await querySessions(context, url.searchParams));
    }
    const sourceQueryViewMatch = pathname.match(/^\/api\/sources\/([^/]+)\/query\/sessions\/([^/]+)\/view$/);
    if (sourceQueryViewMatch) {
      const context = getSourceContext(decodeURIComponent(sourceQueryViewMatch[1]));
      if (!context) return sendError(res, 404, "Data source not found");
      const view = await querySessionView(context, decodeURIComponent(sourceQueryViewMatch[2]), url.searchParams);
      if (!view) return sendError(res, 404, "Session not found");
      return sendJson(res, 200, view);
    }
    const sourceQueryEventsMatch = pathname.match(/^\/api\/sources\/([^/]+)\/query\/sessions\/([^/]+)\/events$/);
    if (sourceQueryEventsMatch) {
      const context = getSourceContext(decodeURIComponent(sourceQueryEventsMatch[1]));
      if (!context) return sendError(res, 404, "Data source not found");
      const events = await querySessionEvents(context, decodeURIComponent(sourceQueryEventsMatch[2]), url.searchParams);
      if (!events) return sendError(res, 404, "Session not found");
      return sendJson(res, 200, events);
    }
    const markdownMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/markdown$/);
    if (markdownMatch) {
      const context = resolveRequestSource(url);
      if (!context) return sendError(res, 404, "Data source not found");
      const markdown = await getSessionMarkdown(context, decodeURIComponent(markdownMatch[1]));
      if (markdown == null) return sendError(res, 404, "Session not found");
      return sendText(res, 200, markdown);
    }
    const eventMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/events\/(\d+)$/);
    if (eventMatch) {
      const context = resolveRequestSource(url);
      if (!context) return sendError(res, 404, "Data source not found");
      const event = await getSessionEvent(context, decodeURIComponent(eventMatch[1]), Number(eventMatch[2]));
      if (!event) return sendError(res, 404, "Event not found");
      return sendJson(res, 200, event);
    }
    const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
    if (sessionMatch) {
      const context = resolveRequestSource(url);
      if (!context) return sendError(res, 404, "Data source not found");
      const detail = await getSessionDetail(context, decodeURIComponent(sessionMatch[1]), {
        evidenceRiskRules: parseEvidenceRiskRulesParam(url.searchParams),
      });
      if (!detail) return sendError(res, 404, "Session not found");
      return sendJson(res, 200, detail);
    }
    return serveStatic(req, res, pathname);
  } catch (error) {
    const status = error?.status || 500;
    return sendError(res, status, status >= 500 ? "Internal server error" : error?.message || "Bad request", {
      name: error?.name,
      message: error?.message,
      stack: process.env.NODE_ENV === "development" ? error?.stack : undefined,
    });
  }
}

function resolveRequestSource(url) {
  return getSourceContext(url.searchParams.get("sourceId") || "local");
}

createServer(route).listen(port, "127.0.0.1", () => {
  console.log(`Codex session renderer: http://127.0.0.1:${port}/`);
  for (const source of dataSources.listSources()) {
    console.log(`Read-only data source [${source.id}]: ${source.kind === "local" ? source.codexHome : source.snapshotPath}`);
  }
});
