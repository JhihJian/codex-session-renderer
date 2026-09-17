import { promises as fs } from "node:fs";
import path from "node:path";
import { readJsonl, readJsonlWithDiagnostics } from "./jsonl-reader.mjs";
import { deriveSessionStatusFromEvents, extractTitleFromEvents, sessionIdFromFile, sessionStartedFromFile, toIso } from "./session-events.mjs";
import { dedupeSessionFileRecords, sessionFileRoots } from "./session-catalog.mjs";
import { parentSessionIdFromMeta, relativeCodexPath, withFileStat, withSubagentMeta } from "./session-models.mjs";
import { isAbortError } from "./session-detail-coordinator.mjs";
import { stripLongPathPrefix } from "./sqlite-threads.mjs";

const piTaskDirectoryPattern = /^task-[a-z0-9][a-z0-9-]{0,127}$/;

export function createSessionDirectoryQueryService(dependencies) {
  return {
    collectSessionFileRecords: (context, options) => collectSessionFileRecords(dependencies, context, options),
    enrichSessionFromFileMeta: (session, options) => enrichSessionFromFileMeta(dependencies, session, options),
    listFileSessions: (context, bounds, options) => listFileSessions(dependencies, context, bounds, options),
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
  if (context.source.taskSessionsRoot) {
    yield* walkPiTaskSessions(dependencies, context.source.taskSessionsRoot, options);
    return;
  }
  for (const entry of sessionFileRoots(context.codexHome, context.sessionsRoot, true)) {
    if (!await dependencies.sourceSessionRootIsReadable(context, entry.root)) continue;
    for await (const filePath of walkJsonl(dependencies, entry.root, options)) yield { filePath, taskId: null, archived: entry.archived };
  }
}

async function* walkPiTaskSessions(dependencies, tasksRoot, options = {}) {
  let tasks;
  try {
    tasks = await fs.readdir(tasksRoot, { withFileTypes: true });
  } catch {
    return;
  }
  tasks.sort((left, right) => right.name.localeCompare(left.name, "en"));
  for (const task of tasks) {
    dependencies.throwIfRequestAborted(options.signal);
    if (!task.isDirectory() || !piTaskDirectoryPattern.test(task.name)) continue;
    const taskRoot = path.join(tasksRoot, task.name);
    const artifactsRoot = path.join(taskRoot, "artifacts");
    const sessionsRoot = path.join(artifactsRoot, "pi-sessions");
    if (!await isRegularDirectory(taskRoot) || !await isRegularDirectory(artifactsRoot) || !await isRegularDirectory(sessionsRoot)) continue;
    for await (const filePath of walkJsonl(dependencies, sessionsRoot, options)) yield { filePath, taskId: task.name, archived: false };
  }
}

async function isRegularDirectory(directoryPath) {
  try {
    const stat = await fs.lstat(directoryPath);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
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

async function collectSessionFileRecords(dependencies, context, options = {}) {
  const records = [];
  for await (const record of walkSourceSessionFiles(dependencies, context, options)) {
    dependencies.throwIfRequestAborted(options.signal);
    const stat = await dependencies.sessionFileStat(context, record.filePath);
    if (!stat || outsideBounds(stat, options)) continue;
    const sessionId = sessionIdFromFile(record.filePath);
    records.push({ id: record.taskId ? `${record.taskId}:${sessionId}` : sessionId, filePath: record.filePath, archived: record.archived, stat });
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
  const codexMeta = events.find((event) => event.type === "session_meta")?.payload;
  if (codexMeta) return codexMeta;
  const records = piMetadataRecords(events);
  if (!records.some(Boolean)) return {};
  return piMetadata(...records);
}

function piMetadataRecords(events) {
  return [events.find((event) => event.type === "session") || null, events.find((event) => event.type === "session_info") || null, [...events].reverse().find((event) => event.type === "model_change") || null, [...events].reverse().find((event) => event.type === "thinking_level_change") || null];
}

function piMetadata(session, info, model, thinking) {
  return {
    title: firstValue([info?.name]), cwd: firstValue([session?.cwd]), timestamp: firstValue([session?.timestamp]),
    model: firstValue([model?.modelId, model?.model]), model_provider: firstValue([model?.provider]),
    reasoningEffort: firstValue([thinking?.thinkingLevel]), originator: "pi_agent", source: "pi-agent", parent_session: firstValue([session?.parentSession]),
  };
}

async function listFileSessions(dependencies, context, bounds = {}, options = {}) {
  const [index, files] = await Promise.all([readIndex(dependencies, context, options), collectSessionFileRecords(dependencies, context, { ...bounds, ...options })]);
  const recordIdByUuid = new Map(files.map((record) => [sessionIdFromFile(record.filePath), record.id]));
  const sessions = [];
  for (const record of files) {
    dependencies.throwIfRequestAborted(options.signal);
    const events = await readMetaEvents(record.filePath, bounds, options);
    sessions.push(sessionFromFileRecord(context, record, events, index, recordIdByUuid));
  }
  return sessions.sort((left, right) => new Date(right.updatedAt || right.fileModifiedAt) - new Date(left.updatedAt || left.fileModifiedAt));
}

async function readMetaEvents(filePath, bounds, options) {
  return readJsonlWithDiagnostics(filePath, { maxLines: bounds.beforeMs != null ? 1 : 40, maxBytes: 64 * 1024, signal: options.signal }).catch((error) => {
    if (isAbortError(error)) throw error;
    return [];
  });
}

function sessionFromFileRecord(context, record, events, index, recordIdByUuid) {
  const meta = sessionMetaFromEvents(events);
  const indexed = index.get(sessionIdFromFile(record.filePath));
  return withSubagentMeta(sessionFileFields(context, { record, events, meta, indexed, recordIdByUuid }));
}

function sessionFileFields(context, { record, events, meta, indexed, recordIdByUuid }) {
  const parentId = parentSessionIdFromMeta(meta);
  return {
    id: record.id, sourceId: context.source.id, sourceLabel: context.source.label, dataSourceKind: context.source.kind,
    title: firstValue([indexed?.title, meta.title, extractTitleFromEvents(events, path.basename(record.filePath, ".jsonl"))]), cwd: firstValue([stripLongPathPrefix(meta.cwd || "")]),
    originator: firstValue([meta.originator]), model: firstValue([meta.model, meta.modelId, meta.model_provider]),
    reasoningEffort: firstValue([meta.reasoning_effort, meta.reasoningEffort]), source: firstValue([meta.source, context.source.kind === "pi-agent" ? "pi-agent" : null]),
    threadSource: firstValue([meta.thread_source]), modelProvider: firstValue([meta.model_provider, meta.provider]), parentSessionId: firstValue([recordIdByUuid.get(parentId), parentId]),
    archived: record.archived, archivedAt: null, agentNickname: null, agentRole: null, preview: null, status: deriveSessionStatusFromEvents(events),
    path: record.filePath, relativePath: relativeCodexPath(context.codexHome, record.filePath), startedAt: toIso(meta.timestamp) || sessionStartedFromFile(record.filePath),
    updatedAt: indexed?.updatedAt || toIso(record.stat.mtime), sizeBytes: record.stat.size, fileModifiedAt: toIso(record.stat.mtime),
  };
}

async function enrichSessionFromFileMeta(dependencies, session, options = {}) {
  if (!session?.path) return withSubagentMeta(session);
  if (options.context && !await dependencies.sessionFileStat(options.context, session.path, session.id)) return { ...session, path: null, relativePath: null };
  const events = await readJsonl(session.path, { maxLines: 40, maxBytes: 128 * 1024, signal: options.signal }).catch((error) => {
    if (isAbortError(error)) throw error;
    return [];
  });
  const meta = sessionMetaFromEvents(events);
  return enrichSession(session, meta);
}

function enrichSession(session, meta) {
  const source = firstValue([meta.source, session.source]);
  return { ...withSubagentMeta({
    ...session, cwd: firstValue([session.cwd, stripLongPathPrefix(meta.cwd || "")]), originator: firstValue([session.originator, meta.originator]),
    model: firstValue([session.model, meta.model, meta.modelId, meta.model_provider]), reasoningEffort: firstValue([session.reasoningEffort, meta.reasoning_effort, meta.reasoningEffort]),
    source, threadSource: firstValue([session.threadSource, meta.thread_source]), modelProvider: firstValue([session.modelProvider, meta.model_provider, meta.provider]),
    parentSessionId: firstValue([session.parentSessionId, parentSessionIdFromMeta(meta)]), startedAt: firstValue([session.startedAt, toIso(meta.timestamp)]),
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
  return withFileStat(sessionFromFileRecord(context, { id: options.sessionId || sessionIdFromFile(filePath), filePath, archived: options.archived ?? false, stat }, events, new Map(), new Map()), stat);
}