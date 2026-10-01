import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { readJsonl, readJsonlWithDiagnostics } from "./jsonl-reader.mjs";
import { extractTitleFromEvents, readTailSessionStatus, sessionIdFromFile, sessionStartedFromFile, toIso } from "./session-events.mjs";
import { mapWithConcurrency } from "./async-concurrency.mjs";
import { dedupeSessionFileRecords, sessionFileRoots } from "./session-catalog.mjs";
import { parentSessionIdFromMeta, relativeCodexPath, withFileStat, withSubagentMeta } from "./session-models.mjs";
import { isAbortError } from "./session-detail-coordinator.mjs";
import { containsWildcard, expandWildcardDirectories, wildcardStaticPrefix } from "./root-pattern.mjs";
import { stripLongPathPrefix } from "./sqlite-threads.mjs";
import { sessionMetadataFromEvents } from "./session-format-adapters/adapter-registry.mjs";

const listFileConcurrency = 8;
const metadataProbeMaxBytes = 4 * 1024 * 1024;
const execFileAsync = promisify(execFile);

export function createSessionDirectoryQueryService(dependencies) {
  return {
    collectSessionFileRecords: (context, options) => collectSessionFileRecords(dependencies, context, options),
    enrichSessionFromFileMeta: (session, options) => enrichSessionFromFileMeta(dependencies, session, options),
    listFileSessions: (context, bounds, options) => listFileSessions(dependencies, context, bounds, options),
    sessionFileRecordById: (context, id, options) => sessionFileRecordById(dependencies, context, id, options),
    sessionFromFilePath: (context, filePath, options) => sessionFromFilePath(dependencies, context, filePath, options),
  };
}

async function* walkJsonl({ throwIfRequestAborted }, directoryPath, options = {}) {
  throwIfRequestAborted(options.signal);
  let entries;
  try {
    entries = await fs.readdir(directoryPath, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((left, right) => right.name.localeCompare(left.name, "en"));
  for (const entry of entries) {
    throwIfRequestAborted(options.signal);
    const filePath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      if (options.sinceMs != null && datedDirectoryEndsBefore(filePath, options.sinceMs)) continue;
      yield* walkJsonl({ throwIfRequestAborted }, filePath, options);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      yield filePath;
    }
  }
}

async function* walkSourceSessionFiles(dependencies, context, options = {}) {
  for (const entry of sessionFileRoots(context.codexHome, context.sessionsRoot, true)) {
    for (const root of await resolveSessionRootDirectories(dependencies, entry.root, options)) {
      if (!await dependencies.sourceSessionRootIsReadable(context, root)) continue;
      for await (const filePath of walkJsonl(dependencies, root, options)) yield { filePath, archived: entry.archived };
    }
  }
}

async function resolveSessionRootDirectories(dependencies, rootPattern, options = {}) {
  if (!containsWildcard(rootPattern)) return [rootPattern];
  return expandWildcardDirectories(rootPattern, { throwIfRequestAborted: dependencies.throwIfRequestAborted, signal: options.signal });
}

function datedDirectoryEndsBefore(directoryPath, cutoffMs) {
  const parts = path.normalize(directoryPath).split(path.sep);
  for (let index = 0; index <= parts.length - 3; index += 1) {
    if (!isDatedDirectory(parts, index)) continue;
    return Date.UTC(Number(parts[index]), Number(parts[index + 1]) - 1, Number(parts[index + 2]) + 1) <= cutoffMs;
  }
  return false;
}

function isDatedDirectory(parts, index) {
  return /^\d{4}$/.test(parts[index]) && /^\d{2}$/.test(parts[index + 1]) && /^\d{2}$/.test(parts[index + 2]);
}

function legacyScopedSessionId(id) {
  const match = /^([a-z0-9][a-z0-9-]{0,127}):([^/.\\][^/\\]*)$/i.exec(String(id || ""));
  return match ? match[2] : null;
}

async function sessionFileRecordById(dependencies, context, id, options = {}) {
  dependencies.throwIfRequestAborted(options.signal);
  // 兼容旧版 task/evaluation 作用域 ID（前缀:uuid）：仅剥掉不含路径分隔符与点号前缀的安全形式。
  const sessionId = legacyScopedSessionId(id) ?? String(id || "");
  return findRecordFromWalk(dependencies, context, sessionId, options);
}

async function findRecordFromWalk(dependencies, context, sessionId, options) {
  if (context.source.kind === "pi-agent") {
    const record = await findPiSessionFileRecord(dependencies, context, sessionId, options);
    if (record !== undefined) return record;
  }
  // Single-session lookup must not inherit the listing cap: sessions beyond the
  // list window still deserve a resolvable detail endpoint.
  for await (const record of walkSourceSessionFiles(dependencies, context, { signal: options.signal })) {
    dependencies.throwIfRequestAborted(options.signal);
    if (sessionIdFromFile(record.filePath) !== sessionId) continue;
    const stat = await dependencies.sessionFileStat(context, record.filePath);
    if (!stat) continue;
    return { id: sessionId, filePath: record.filePath, archived: record.archived, stat };
  }
  return null;
}

async function findPiSessionFileRecord(dependencies, context, sessionId, options) {
  try {
    const roots = sessionFileRoots(context.codexHome, context.sessionsRoot, true);
    for (const entry of roots) {
      dependencies.throwIfRequestAborted(options.signal);
      const filePath = await findFirstPiSessionFile(entry.root, sessionId, options.signal);
      if (!filePath) continue;
      const stat = await dependencies.sessionFileStat(context, filePath, sessionId);
      if (stat) return { id: sessionId, filePath, archived: entry.archived, stat };
    }
    return null;
  } catch (error) {
    if (isAbortError(error)) throw error;
    return undefined;
  }
}

async function findFirstPiSessionFile(rootPath, sessionId, signal) {
  const searchRoot = containsWildcard(rootPath) ? wildcardStaticPrefix(rootPath) : rootPath;
  const result = await execFileAsync("find", [searchRoot, "-type", "f", "-path", path.join(rootPath, "*"), "-name", `*_${escapeFindPattern(sessionId)}.jsonl`, "-print", "-quit"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024,
    signal,
  });
  return result.stdout.trim() || null;
}

function escapeFindPattern(value) {
  return String(value).replace(/[\\*?[\]]/g, "\\$&");
}

async function collectSessionFileRecords(dependencies, context, options = {}) {
  const records = [];
  for await (const record of walkSourceSessionFiles(dependencies, context, options)) {
    dependencies.throwIfRequestAborted(options.signal);
    const stat = await dependencies.sessionFileStat(context, record.filePath);
    if (!stat || outsideBounds(stat, options)) continue;
    records.push({ id: sessionIdFromFile(record.filePath), filePath: record.filePath, archived: record.archived, stat });
    if (records.length >= (options.maxRecords || dependencies.maxListSessions)) return dedupeSessionFileRecords(records);
  }
  return dedupeSessionFileRecords(records);
}

function outsideBounds(stat, options) {
  return (options.sinceMs != null && stat.mtimeMs < options.sinceMs) || (options.beforeMs != null && stat.mtimeMs >= options.beforeMs);
}

async function readIndex(dependencies, context, options = {}) {
  const byId = new Map();
  try {
    if (!await dependencies.sourceFileStat(context, context.sessionIndexPath)) return byId;
    const readRows = () => readJsonl(context.sessionIndexPath, { maxLines: options.maxRecords || dependencies.maxListSessions, maxBytes: 64 * 1024, signal: options.signal });
    const rows = options.readGate ? await options.readGate.run(readRows, options.signal) : await readRows();
    for (const row of rows) if (row?.id) byId.set(row.id, { id: row.id, title: row.thread_name || row.name || "未命名会话", updatedAt: toIso(row.updated_at) || toIso(row.updatedAt) });
  } catch (error) {
    if (isAbortError(error)) throw error;
  }
  return byId;
}

function sessionMetaFromEvents(events) {
  return sessionMetadataFromEvents(events);
}

async function listFileSessions(dependencies, context, bounds = {}, options = {}) {
  const [index, files] = await Promise.all([readIndex(dependencies, context, options), collectSessionFileRecords(dependencies, context, { ...bounds, ...options })]);
  const sessions = await mapWithConcurrency(files, listFileConcurrency, async (record) => {
    dependencies.throwIfRequestAborted(options.signal);
    const events = await readMetaEvents(record.filePath, bounds, options);
    return sessionFromFileRecord(context, record, events, index);
  });
  return sessions.sort((left, right) => new Date(right.updatedAt || right.fileModifiedAt) - new Date(left.updatedAt || left.fileModifiedAt));
}

async function readMetaEvents(filePath, bounds, options) {
  const maxLines = bounds.beforeMs != null ? 1 : 40;
  const initial = await readJsonlWithDiagnostics(filePath, { maxLines, maxBytes: 64 * 1024, signal: options.signal }).catch((error) => {
    if (isAbortError(error)) throw error;
    return [];
  });
  if (bounds.beforeMs != null || Object.keys(sessionMetadataFromEvents(initial)).length > 0) return initial;
  return readJsonlWithDiagnostics(filePath, { maxLines, maxBytes: metadataProbeMaxBytes, signal: options.signal }).catch((error) => {
    if (isAbortError(error)) throw error;
    return initial;
  });
}

async function readSessionFileStatus(filePath, stat) {
  if (!filePath || !stat) return null;
  try {
    return await readTailSessionStatus(filePath, stat);
  } catch (error) {
    if (isAbortError(error)) throw error;
    return null;
  }
}

async function sessionFromFileRecord(context, record, events, index) {
  const meta = sessionMetaFromEvents(events);
  const indexed = index.get(sessionIdFromFile(record.filePath));
  const status = await readSessionFileStatus(record.filePath, record.stat);
  return withSubagentMeta(sessionFileFields(context, { record, events, meta, indexed, status }));
}

function sessionFileFields(context, { record, events, meta, indexed, status }) {
  return {
    id: record.id, sourceId: context.source.id, sourceLabel: context.source.label, dataSourceKind: context.source.kind,
    title: firstValue([indexed?.title, meta.title, extractTitleFromEvents(events, path.basename(record.filePath, ".jsonl"))]), cwd: firstValue([stripLongPathPrefix(meta.cwd || "")]),
    originator: firstValue([meta.originator]), model: firstValue([meta.model, meta.modelId, meta.model_provider]),
    reasoningEffort: firstValue([meta.reasoning_effort, meta.reasoningEffort]), source: firstValue([meta.source, context.source.kind === "pi-agent" ? "pi-agent" : null]),
    threadSource: firstValue([meta.thread_source]), modelProvider: firstValue([meta.model_provider, meta.provider]), parentSessionId: parentSessionIdFromMeta(meta),
    archived: record.archived, archivedAt: null, agentNickname: null, agentRole: null, preview: null, status,
    path: record.filePath, relativePath: relativeCodexPath(context.codexHome, record.filePath), startedAt: toIso(meta.timestamp) || sessionStartedFromFile(record.filePath),
    updatedAt: indexed?.updatedAt || toIso(record.stat.mtime), sizeBytes: record.stat.size, fileModifiedAt: toIso(record.stat.mtime),
  };
}

async function enrichSessionFromFileMeta(dependencies, session, options = {}) {
  if (!session?.path) return withSubagentMeta(session);
  const stat = options.context ? await dependencies.sessionFileStat(options.context, session.path, session.id) : null;
  if (options.context && !stat) return { ...session, path: null, relativePath: null };
  const events = await readJsonl(session.path, { maxLines: 40, maxBytes: 128 * 1024, signal: options.signal }).catch((error) => {
    if (isAbortError(error)) throw error;
    return [];
  });
  const meta = sessionMetaFromEvents(events);
  const status = await readSessionFileStatus(session.path, stat);
  return enrichSession(session, meta, status);
}

function enrichSession(session, meta, status = null) {
  const source = firstValue([meta.source, session.source]);
  return { ...withSubagentMeta({
    ...session, cwd: firstValue([session.cwd, stripLongPathPrefix(meta.cwd || "")]), originator: firstValue([session.originator, meta.originator]),
    model: firstValue([session.model, meta.model, meta.modelId, meta.model_provider]), reasoningEffort: firstValue([session.reasoningEffort, meta.reasoning_effort, meta.reasoningEffort]),
    source, threadSource: firstValue([session.threadSource, meta.thread_source]), modelProvider: firstValue([session.modelProvider, meta.model_provider, meta.provider]),
    parentSessionId: firstValue([session.parentSessionId, parentSessionIdFromMeta(meta)]), startedAt: firstValue([session.startedAt, toIso(meta.timestamp)]),
    status: status == null ? session.status : status,
  }), source: firstValue([session.source, source]) };
}

function firstValue(values) {
  return values.find(Boolean) ?? null;
}

async function sessionFromFilePath(dependencies, context, filePath, options = {}) {
  const stat = await dependencies.sessionFileStat(context, filePath);
  if (!stat) return null;
  const events = await readJsonlWithDiagnostics(filePath, { maxLines: 40, maxBytes: 128 * 1024, signal: options.signal }).catch((error) => {
    if (isAbortError(error)) throw error;
    return [];
  });
  return withFileStat(await sessionFromFileRecord(context, { id: options.sessionId || sessionIdFromFile(filePath), filePath, archived: options.archived ?? false, stat }, events, new Map()), stat);
}