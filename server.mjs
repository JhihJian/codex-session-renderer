import { createServer } from "node:http";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const sessionsRoot = path.join(codexHome, "sessions");
const sessionIndexPath = path.join(codexHome, "session_index.jsonl");
const stateDbPath = path.join(codexHome, "state_5.sqlite");
const maxListSessions = Number(process.env.CODEX_SESSION_RENDERER_LIMIT || 800);
const port = Number(process.env.PORT || 4789);
const execFileAsync = promisify(execFile);
const sqliteCandidates = [
  process.env.SQLITE3_PATH,
  "sqlite3",
  path.join(os.homedir(), "AppData", "Local", "Android", "Sdk", "platform-tools", "sqlite3.exe"),
].filter(Boolean);
const previewLimits = {
  message: 1800,
  toolArguments: 800,
  toolOutput: 800,
  payload: 700,
  traceText: 160,
  traceArguments: 160,
  traceOutput: 160,
};

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

const textHeaders = {
  "content-type": "text/plain; charset=utf-8",
  "cache-control": "no-store",
};

const staticTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".json", "application/json; charset=utf-8"],
]);

let sessionCache = null;
let sessionCacheTime = 0;
const sessionDetailCache = new Map();

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

function sendJson(res, status, body) {
  send(res, status, jsonHeaders, JSON.stringify(body));
}

function sendError(res, status, message, details = null) {
  sendJson(res, status, { error: message, details });
}

function safeJsonParse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function normalizeSlash(value) {
  return value.replaceAll("\\", "/");
}

function toIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function fileTimeMs(file) {
  return file?.mtimeMs ?? 0;
}

function eventTime(event) {
  return toIso(event.timestamp) || toIso(event.payload?.timestamp) || null;
}

function sessionIdFromFile(filePath) {
  const name = path.basename(filePath, ".jsonl");
  const match = name.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  return match?.[1] ?? name;
}

function sessionStartedFromFile(filePath) {
  const name = path.basename(filePath, ".jsonl");
  const match = name.match(/^rollout-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})-/);
  if (!match) return null;
  return `${match[1].replace(/T(\d{2})-(\d{2})-(\d{2})/, "T$1:$2:$3")}.000Z`;
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

async function readJsonl(filePath, { maxLines = Infinity } = {}) {
  const text = await fs.readFile(filePath, "utf8");
  const lines = text.split(/\r?\n/);
  const items = [];
  for (const line of lines) {
    if (items.length >= maxLines) break;
    if (!line.trim()) continue;
    const obj = safeJsonParse(line);
    if (obj) items.push(obj);
  }
  return items;
}

async function readJsonlLine(filePath, targetIndex) {
  if (!Number.isInteger(targetIndex) || targetIndex < 0) return null;
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  let index = 0;
  try {
    for await (const line of reader) {
      if (!line.trim()) continue;
      if (index === targetIndex) {
        reader.close();
        stream.destroy();
        return safeJsonParse(line);
      }
      index += 1;
    }
  } finally {
    stream.destroy();
  }
  return null;
}

async function readIndex() {
  const byId = new Map();
  try {
    const rows = await readJsonl(sessionIndexPath);
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

async function readThreadsFromSqlite() {
  const query = [
    "select",
    "id,title,rollout_path,created_at,updated_at,created_at_ms,updated_at_ms,",
    "source,thread_source,model_provider,cwd,archived,archived_at,",
    "model,reasoning_effort,agent_nickname,agent_role,first_user_message,preview",
    "from threads order by updated_at_ms desc limit",
    String(maxListSessions),
  ].join(" ");

  try {
    const stdout = await runSqliteJson(query, 30 * 1024 * 1024);
    const rows = JSON.parse(stdout || "[]");
    return threadRowsToMap(rows);
  } catch {
    return new Map();
  }
}

async function readThreadRowsByIds(ids) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (uniqueIds.length === 0) return new Map();
  const quotedIds = uniqueIds.map(sqlString).join(",");
  const query = [
    "select",
    "id,title,rollout_path,created_at,updated_at,created_at_ms,updated_at_ms,",
    "source,thread_source,model_provider,cwd,archived,archived_at,",
    "model,reasoning_effort,agent_nickname,agent_role,first_user_message,preview",
    "from threads where id in",
    `(${quotedIds})`,
  ].join(" ");

  try {
    const stdout = await runSqliteJson(query, 10 * 1024 * 1024);
    return threadRowsToMap(JSON.parse(stdout || "[]"));
  } catch {
    return new Map();
  }
}

async function readSpawnEdgesFromSqlite() {
  const query = "select parent_thread_id,child_thread_id,status from thread_spawn_edges";
  try {
    const stdout = await runSqliteJson(query, 10 * 1024 * 1024);
    return JSON.parse(stdout || "[]")
      .filter((row) => row?.parent_thread_id && row?.child_thread_id)
      .map((row) => ({
        parentThreadId: row.parent_thread_id,
        childThreadId: row.child_thread_id,
        status: row.status || "unknown",
      }));
  } catch {
    return [];
  }
}

async function runSqliteJson(query, maxBuffer) {
  const dbUrl = `file:${stateDbPath.replaceAll("\\", "/")}?mode=ro`;
  let lastError = null;
  for (const sqlite of sqliteCandidates) {
    try {
      const { stdout } = await execFileAsync(sqlite, ["-readonly", "-json", dbUrl, query], { maxBuffer });
      return stdout;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("sqlite3 is not available");
}

function threadRowsToMap(rows) {
  return new Map(
    rows
      .filter((row) => row?.id && row?.rollout_path)
      .map((row) => [
        row.id,
        {
          id: row.id,
          title: row.title || row.first_user_message || row.preview || "未命名会话",
          path: stripLongPathPrefix(row.rollout_path),
          cwd: stripLongPathPrefix(row.cwd || ""),
          createdAt: unixMaybeToIso(row.created_at_ms ?? row.created_at),
          updatedAt: unixMaybeToIso(row.updated_at_ms ?? row.updated_at),
          source: row.source || null,
          threadSource: row.thread_source || null,
          modelProvider: row.model_provider || null,
          archived: row.archived === 1,
          archivedAt: unixMaybeToIso(row.archived_at),
          model: row.model || null,
          reasoningEffort: row.reasoning_effort || null,
          agentNickname: row.agent_nickname || null,
          agentRole: row.agent_role || null,
          preview: row.preview || row.first_user_message || null,
        },
      ]),
  );
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function stripLongPathPrefix(value) {
  if (!value) return value;
  return String(value).replace(/^\\\\\?\\/, "");
}

function unixMaybeToIso(value) {
  if (value == null || value === "") return null;
  if (typeof value === "string" && value.includes("T")) return toIso(value);
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const millis = number > 10_000_000_000 ? number : number * 1000;
  return toIso(millis);
}

function extractTitleFromEvents(events, fallback) {
  for (const event of events) {
    if (event.type === "event_msg" && event.payload?.type === "user_message") {
      const message = String(event.payload.message ?? "").trim();
      if (message) return firstLine(message, 90);
    }
    if (event.type === "response_item" && event.payload?.role === "user") {
      const text = extractContentText(event.payload.content).trim();
      if (text) return firstLine(text, 90);
    }
  }
  return fallback || "未命名会话";
}

function firstLine(text, max = 120) {
  const normalized = String(text).replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function extractContentText(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return JSON.stringify(content);
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part?.text != null) return part.text;
      if (part?.type === "input_text" || part?.type === "output_text") return part.text ?? "";
      if (part?.image_url) return `[image] ${part.image_url}`;
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function classifyEvent(event) {
  const payload = event.payload ?? {};
  if (event.type === "session_meta") return "meta";
  if (event.type === "turn_context") return "context";
  if (event.type === "event_msg") return payload.type || "event";
  if (event.type === "response_item") return payload.type || "response";
  return event.type || "unknown";
}

function isImportantEvent(event) {
  const kind = classifyEvent(event);
  return [
    "session_meta",
    "user_message",
    "agent_message",
    "message",
    "function_call",
    "function_call_output",
    "custom_tool_call",
    "custom_tool_call_output",
    "mcp_tool_call_end",
    "patch_apply_end",
    "tool_search_call",
    "tool_search_output",
    "task_started",
    "task_complete",
    "task_failed",
  ].includes(kind);
}

function summarizeSessionEvents(events) {
  const counts = {};
  const roles = {};
  for (const event of events) {
    const kind = classifyEvent(event);
    counts[kind] = (counts[kind] ?? 0) + 1;
    const role = event.payload?.role;
    if (role) roles[role] = (roles[role] ?? 0) + 1;
  }
  return { counts, roles };
}

async function listSessions() {
  const now = Date.now();
  if (sessionCache && now - sessionCacheTime < 3000) return sessionCache;

  const threads = await readThreadsFromSqlite();
  if (threads.size > 0) {
    const sessions = [...threads.values()]
      .map((thread) => sessionFromThread(thread))
      .filter((session) => session.path);
    sessions.sort((a, b) => new Date(b.updatedAt || b.fileModifiedAt || 0) - new Date(a.updatedAt || a.fileModifiedAt || 0));
    sessionCache = sessions.slice(0, maxListSessions);
    sessionCacheTime = now;
    return sessionCache;
  }

  const index = await readIndex();
  const files = [];
  for await (const filePath of walkJsonl(sessionsRoot)) {
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
    const thread = threads.get(id);
    let events = [];
    try {
      events = await readJsonl(filePath, { maxLines: 40 });
    } catch {
      // Keep the unreadable file visible in diagnostics.
    }
    const meta = events.find((event) => event.type === "session_meta")?.payload ?? {};
    const startedAt = thread?.createdAt || toIso(meta.timestamp) || sessionStartedFromFile(filePath);
    const updatedAt = thread?.updatedAt || indexed?.updatedAt || toIso(stat.mtime);
    const title = thread?.title || indexed?.title || extractTitleFromEvents(events, path.basename(filePath, ".jsonl"));
    sessions.push({
      id,
      title,
      cwd: thread?.cwd || stripLongPathPrefix(meta.cwd || "") || null,
      originator: meta.originator || null,
      model: thread?.model || meta.model || meta.model_provider || null,
      reasoningEffort: thread?.reasoningEffort || null,
      source: thread?.source || meta.source || null,
      threadSource: thread?.threadSource || meta.thread_source || null,
      modelProvider: thread?.modelProvider || meta.model_provider || null,
      archived: thread?.archived ?? false,
      archivedAt: thread?.archivedAt || null,
      agentNickname: thread?.agentNickname || null,
      agentRole: thread?.agentRole || null,
      preview: thread?.preview || null,
      path: filePath,
      relativePath: normalizeSlash(path.relative(codexHome, filePath)),
      startedAt,
      updatedAt,
      sizeBytes: stat.size,
      fileModifiedAt: toIso(stat.mtime),
    });
  }

  sessions.sort((a, b) => new Date(b.updatedAt || b.fileModifiedAt) - new Date(a.updatedAt || a.fileModifiedAt));
  sessionCache = sessions.slice(0, maxListSessions);
  sessionCacheTime = now;
  return sessionCache;
}

async function getSessionById(id) {
  const cached = sessionCache?.find((session) => session.id === id);
  if (cached) return cached;

  const thread = (await readThreadRowsByIds([id])).get(id);
  if (thread) return sessionFromThread(thread);

  const sessions = await listSessions();
  const listed = sessions.find((session) => session.id === id);
  if (listed) return listed;

  for await (const filePath of walkJsonl(sessionsRoot)) {
    if (sessionIdFromFile(filePath) === id) return sessionFromFilePath(filePath);
  }
  return null;
}

async function getSessionDetail(id) {
  const session = await getSessionById(id);
  if (!session) return null;
  const stat = await fs.stat(session.path);
  const sessionWithStat = withFileStat(session, stat);
  const cached = sessionDetailCache.get(id);
  if (cached && cached.mtimeMs === fileTimeMs(stat) && cached.size === stat.size) return cached.detail;

  const rawEvents = await readJsonl(session.path);
  const analysisEvents = rawEvents.map((event, index) => ({
    index,
    timestamp: eventTime(event),
    kind: classifyEvent(event),
    important: isImportantEvent(event),
    type: event.type,
    payloadType: event.payload?.type ?? null,
    role: event.payload?.role ?? null,
    title: summarizeEventTitle(event),
    preview: summarizeEventPreview(event),
    payloadSize: event.payload == null ? 0 : JSON.stringify(event.payload).length,
    payload: event.payload,
  }));
  const publicEvents = analysisEvents.map(({ payload, ...event }) => ({
    index: event.index,
    timestamp: event.timestamp,
    kind: event.kind,
    important: event.important,
    role: event.role,
    title: event.title,
    preview: event.preview,
    payloadSize: event.payloadSize,
  }));
  const turns = buildTurns(rawEvents);
  const hierarchy = await getThreadHierarchy(id);
  const publicTurns = compactTurnsForClient(turns);
  const trace = buildTrace(sessionWithStat, rawEvents, analysisEvents, turns, hierarchy);
  const stats = {
    ...summarizeSessionEvents(rawEvents),
    eventCount: rawEvents.length,
    turnCount: turns.length,
    importantEventCount: analysisEvents.filter((event) => event.important).length,
    childThreadCount: hierarchy.children.length,
    sizeBytes: stat.size,
    codexHome,
    dataPath: sessionWithStat.path,
  };
  const detail = { session: sessionWithStat, turns: publicTurns, events: publicEvents, stats, trace };
  sessionDetailCache.set(id, { mtimeMs: fileTimeMs(stat), size: stat.size, detail });
  return detail;
}

async function getSessionEvent(id, index) {
  const session = await getSessionById(id);
  if (!session?.path) return null;
  const event = await readJsonlLine(session.path, index);
  if (!event) return null;
  return {
    index,
    timestamp: eventTime(event),
    kind: classifyEvent(event),
    important: isImportantEvent(event),
    type: event.type,
    payloadType: event.payload?.type ?? null,
    role: event.payload?.role ?? null,
    title: summarizeEventTitle(event),
    preview: summarizeEventPreview(event),
    payload: event.payload ?? null,
    raw: event,
  };
}

function compactTurnsForClient(turns) {
  return turns.map((turn, turnIndex) => ({
    ...turn,
    turnNumber: turnIndex + 1,
    items: turn.items.map((item, itemIndex) => compactItemForClient(item, turnIndex, itemIndex)),
  }));
}

function compactItemForClient(item, turnIndex, itemIndex) {
  const base = {
    id: item.id,
    type: item.type,
    turnIndex,
    itemIndex,
  };
  if (item.timestamp) base.timestamp = item.timestamp;
  if (item.completedAt) base.completedAt = item.completedAt;
  if (item.phase) base.phase = item.phase;
  if (item.role) base.role = item.role;
  if (item.name) base.name = item.name;
  if (item.callId) base.callId = item.callId;
  if (item.status) base.status = item.status;
  if (item.eventType) base.eventType = item.eventType;
  if (item.responseType) base.responseType = item.responseType;
  if (item.encrypted) base.encrypted = true;
  const info = compactTraceInfo(item.info);
  if (info) base.info = info;

  if (item.text != null) {
    const limited = limitText(item.text, previewLimits.message);
    base.text = limited.text;
    base.textLength = limited.originalLength;
    if (limited.truncated) addTruncatedField(base, "text");
  }
  if (item.arguments != null) {
    const limited = limitText(item.arguments, previewLimits.toolArguments);
    base.arguments = limited.text;
    base.argumentsLength = limited.originalLength;
    if (limited.truncated) addTruncatedField(base, "arguments");
  }
  if (item.output != null) {
    const limited = limitText(item.output, previewLimits.toolOutput);
    base.output = limited.text;
    base.outputLength = limited.originalLength;
    if (limited.truncated) addTruncatedField(base, "output");
  }
  if (item.payload != null || item.info != null) {
    const source = item.payload ?? item.info;
    const limited = limitText(JSON.stringify(source, null, 2), previewLimits.payload);
    base.payloadPreview = limited.text;
    base.payloadLength = limited.originalLength;
    if (limited.truncated) addTruncatedField(base, "payload");
  }
  if (base.truncatedFields?.length) base.truncated = true;
  return base;
}

function addTruncatedField(target, field) {
  if (!target.truncatedFields) target.truncatedFields = [];
  target.truncatedFields.push(field);
}

function limitText(value, max) {
  if (value == null) return { text: value, originalLength: 0, truncated: false };
  const text = String(value);
  if (text.length <= max) return { text, originalLength: text.length, truncated: false };
  return {
    text: text.slice(0, max),
    originalLength: text.length,
    truncated: true,
  };
}

function sessionFromThread(thread) {
  const filePath = stripLongPathPrefix(thread.path || "");
  return {
    id: thread.id,
    title: thread.title || "未命名会话",
    cwd: thread.cwd || null,
    originator: null,
    model: thread.model || null,
    reasoningEffort: thread.reasoningEffort || null,
    source: thread.source || null,
    threadSource: thread.threadSource || null,
    modelProvider: thread.modelProvider || null,
    archived: thread.archived ?? false,
    archivedAt: thread.archivedAt || null,
    agentNickname: thread.agentNickname || null,
    agentRole: thread.agentRole || null,
    preview: thread.preview || null,
    path: filePath || null,
    relativePath: filePath ? normalizeSlash(path.relative(codexHome, filePath)) : null,
    startedAt: thread.createdAt || (filePath ? sessionStartedFromFile(filePath) : null),
    updatedAt: thread.updatedAt || null,
    sizeBytes: null,
    fileModifiedAt: null,
  };
}

function compactSessionForList(session) {
  return {
    id: session.id,
    title: firstLine(session.title || "未命名会话", 140),
    cwd: session.cwd || null,
    model: session.model || null,
    reasoningEffort: session.reasoningEffort || null,
    source: session.source || null,
    threadSource: session.threadSource || null,
    modelProvider: session.modelProvider || null,
    archived: session.archived ?? false,
    agentNickname: session.agentNickname || null,
    agentRole: session.agentRole || null,
    preview: firstLine(session.preview || "", 120) || null,
    relativePath: session.relativePath || null,
    startedAt: session.startedAt || null,
    updatedAt: session.updatedAt || null,
    fileModifiedAt: session.fileModifiedAt || null,
    sizeBytes: session.sizeBytes || null,
  };
}

async function sessionFromFilePath(filePath) {
  let stat = null;
  try {
    stat = await fs.stat(filePath);
  } catch {
    // The caller handles unreadable files when it tries to open the detail.
  }
  const id = sessionIdFromFile(filePath);
  const events = await readJsonl(filePath, { maxLines: 40 }).catch(() => []);
  const meta = events.find((event) => event.type === "session_meta")?.payload ?? {};
  return withFileStat(
    {
      id,
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
      relativePath: normalizeSlash(path.relative(codexHome, filePath)),
      startedAt: toIso(meta.timestamp) || sessionStartedFromFile(filePath),
      updatedAt: null,
      sizeBytes: null,
      fileModifiedAt: null,
    },
    stat,
  );
}

function withFileStat(session, stat) {
  if (!stat) return session;
  return {
    ...session,
    sizeBytes: stat.size,
    fileModifiedAt: toIso(stat.mtime),
    updatedAt: session.updatedAt || toIso(stat.mtime),
  };
}

async function getSessionMarkdown(id) {
  const session = await getSessionById(id);
  if (!session) return null;
  const rawEvents = await readJsonl(session.path);
  return renderConversationMarkdown(session, buildTurns(rawEvents));
}

async function getThreadHierarchy(threadId) {
  const edges = await readSpawnEdgesFromSqlite();
  const directEdges = edges.filter((edge) => edge.parentThreadId === threadId);
  const parentEdges = edges.filter((edge) => edge.childThreadId === threadId);
  const primaryParentEdge = parentEdges[0] || null;
  const siblingEdges = primaryParentEdge
    ? edges.filter((edge) => edge.parentThreadId === primaryParentEdge.parentThreadId)
    : [];
  const childIds = directEdges.map((edge) => edge.childThreadId);
  const parentIds = parentEdges.map((edge) => edge.parentThreadId);
  const siblingIds = siblingEdges.map((edge) => edge.childThreadId);
  const threads = await readThreadRowsByIds([threadId, ...childIds, ...parentIds, ...siblingIds]);
  return {
    parent: primaryParentEdge
      ? {
          ...primaryParentEdge,
          thread: publicThreadMeta(threads.get(primaryParentEdge.parentThreadId)),
        }
      : null,
    children: directEdges.map((edge) => ({
      ...edge,
      thread: publicThreadMeta(threads.get(edge.childThreadId)),
    })),
    siblings: siblingEdges.map((edge) => ({
      ...edge,
      thread: publicThreadMeta(threads.get(edge.childThreadId)),
      active: edge.childThreadId === threadId,
    })),
  };
}

function publicThreadMeta(thread) {
  if (!thread) return null;
  return {
    id: thread.id,
    title: thread.title,
    cwd: thread.cwd || null,
    model: thread.model || null,
    reasoningEffort: thread.reasoningEffort || null,
    agentNickname: thread.agentNickname || null,
    agentRole: thread.agentRole || null,
    updatedAt: thread.updatedAt || null,
    path: thread.path || null,
    relativePath: thread.path ? normalizeSlash(path.relative(codexHome, thread.path)) : null,
  };
}

function buildTrace(session, rawEvents, normalizedEvents, turns, hierarchy) {
  const rootStartedAt = turns[0]?.startedAt || session.startedAt || normalizedEvents[0]?.timestamp || null;
  const rootEndedAt =
    turns.at(-1)?.completedAt || normalizedEvents.at(-1)?.timestamp || session.updatedAt || session.fileModifiedAt || null;
  const childById = new Map(hierarchy.children.map((child) => [child.childThreadId, child]));
  const spawnByChildId = findSpawnAgentEvents(normalizedEvents, childById);
  const notificationByChildId = findSubagentNotifications(normalizedEvents, childById);

  const root = {
    id: `thread:${session.id}`,
    type: "thread",
    label: session.agentNickname ? `${session.agentNickname} / ${session.agentRole || "agent"}` : "Root Thread",
    title: session.title || "未命名会话",
    subtitle: session.id,
    timestamp: rootStartedAt,
    completedAt: rootEndedAt,
    durationMs: durationMs(rootStartedAt, rootEndedAt),
    durationEstimated: true,
    status: "open",
    icon: "thread",
    detail: {
      kind: "thread",
      session: compactTraceSession(session),
      hierarchy,
      note: "根线程节点。duration 基于首末事件估算。",
    },
    children: [],
  };

  for (const [turnIndex, turn] of turns.entries()) {
    const turnSummary = summarizeTurnForTrace(turn, hierarchy);
    const turnNode = {
      id: `turn:${turn.id}:${turnIndex}`,
      type: "turn",
      label: `Turn ${turnIndex + 1}`,
      title: turnSummary.title,
      subtitle: [turnSummary.subtitle, formatIsoForTrace(turn.startedAt), turn.cwd ? shortPathServer(turn.cwd) : ""]
        .filter(Boolean)
        .join(" · "),
      timestamp: turn.startedAt,
      completedAt: turn.completedAt,
      durationMs: durationMs(turn.startedAt, turn.completedAt),
      durationEstimated: !turn.completedAt,
      status: turn.status || "running",
      icon: "turn",
      detail: {
        kind: "turn",
        turn: compactTraceTurn(turn, turnSummary),
      },
      children: [],
    };

    for (const [itemIndex, item] of turn.items.entries()) {
      const itemNode = traceNodeFromItem(item, turnIndex, itemIndex);
      if (itemNode && isDefaultTraceNodeForPayload(itemNode)) turnNode.children.push(itemNode);
    }

    const turnStart = toMs(turn.startedAt) ?? -Infinity;
    const turnEnd = toMs(turn.completedAt) ?? Infinity;
    for (const child of hierarchy.children) {
      const spawnEvent = spawnByChildId.get(child.childThreadId);
      const notificationEvent = notificationByChildId.get(child.childThreadId);
      const anchor = spawnEvent || notificationEvent;
      const anchorMs = toMs(anchor?.timestamp);
      if (anchor && anchorMs != null && anchorMs >= turnStart && anchorMs <= turnEnd) {
        turnNode.children.push(traceNodeFromChildThread(child, anchor, notificationEvent));
      }
    }

    root.children.push(turnNode);
  }

  const placedChildIds = new Set(
    root.children.flatMap((turn) => turn.children.filter((node) => node.type === "subagent").map((node) => node.threadId)),
  );
  for (const child of hierarchy.children) {
    if (!placedChildIds.has(child.childThreadId)) {
      root.children.push(traceNodeFromChildThread(child, spawnByChildId.get(child.childThreadId), notificationByChildId.get(child.childThreadId)));
    }
  }

  return {
    root,
    hierarchy,
    timing: {
      startedAt: rootStartedAt,
      completedAt: rootEndedAt,
      durationMs: root.durationMs,
      estimated: true,
    },
  };
}

function isDefaultTraceNodeForPayload(node) {
  return ["tool", "handoff", "subagent", "lazy-child"].includes(node.type);
}

function traceNodeFromItem(item, turnIndex, itemIndex) {
  const base = {
    id: `item:${turnIndex}:${itemIndex}:${item.id || item.type}`,
    timestamp: item.timestamp || null,
    completedAt: item.completedAt || null,
    durationMs: durationMs(item.timestamp, item.completedAt),
    durationEstimated: !item.completedAt,
    status: item.status || null,
    children: [],
    detail: {
      kind: "item",
      item: compactTraceItem(item),
    },
  };

  if (item.type === "user-message") {
    return {
      ...base,
      type: "message",
      icon: "user",
      label: "User message",
      title: firstLine(item.text || "用户消息", 80),
      subtitle: formatIsoForTrace(item.timestamp),
    };
  }
  if (item.type === "assistant-message") {
    return {
      ...base,
      type: "message",
      icon: "assistant",
      label: item.phase === "final" || item.phase === "final_answer" ? "Final answer" : "Assistant response",
      title: firstLine(item.text || "助手消息", 80),
      subtitle: [item.phase, formatIsoForTrace(item.timestamp)].filter(Boolean).join(" · "),
    };
  }
  if (item.type === "tool-call") {
  const isHandoff = ["spawn_agent", "wait_agent", "handoff"].includes(item.name);
    return {
      ...base,
      type: isHandoff ? "handoff" : "tool",
      icon: isHandoff ? "handoff" : "tool",
      label: isHandoff ? "Handoff" : `Tool call`,
      title: item.name || item.callId || "tool",
      subtitle: [item.status, formatIsoForTrace(item.timestamp)].filter(Boolean).join(" · "),
    };
  }
  if (item.type === "reasoning") {
    return {
      ...base,
      type: "reasoning",
      icon: "reasoning",
      label: "Reasoning",
      title: item.text ? firstLine(item.text, 80) : item.encrypted ? "推理内容已加密存储" : "无明文摘要",
      subtitle: item.encrypted ? "encrypted_content" : "summary",
    };
  }
  if (item.type === "token-count") {
    return {
      ...base,
      type: "metric",
      icon: "metric",
      label: "Token usage",
      title: "Token 统计",
      subtitle: formatIsoForTrace(item.timestamp),
    };
  }
  if (item.type === "event" || item.type === "response-item") {
    return {
      ...base,
      type: "event",
      icon: "event",
      label: item.eventType || item.responseType || "Event",
      title: item.eventType || item.responseType || item.type,
      subtitle: formatIsoForTrace(item.timestamp),
    };
  }
  return null;
}

function traceNodeFromChildThread(child, spawnEvent, notificationEvent) {
  const thread = child.thread || {};
  const timestamp = spawnEvent?.timestamp || thread.updatedAt || null;
  const completedAt = notificationEvent?.timestamp || thread.updatedAt || null;
  return {
    id: `subagent:${child.childThreadId}`,
    type: "subagent",
    threadId: child.childThreadId,
    icon: "agent",
    label: `Subagent: ${thread.agentNickname || child.childThreadId}`,
    title: [thread.agentNickname, thread.agentRole].filter(Boolean).join(" / ") || thread.title || child.childThreadId,
    subtitle: thread.title || child.status || "",
    timestamp,
    completedAt,
    durationMs: durationMs(timestamp, completedAt),
    durationEstimated: true,
    status: child.status,
    lazy: true,
    children: [
      {
        id: `subagent:${child.childThreadId}:placeholder`,
        type: "lazy-child",
        icon: "thread",
        label: "Child thread",
        title: "点击子代理节点加载完整会话",
        subtitle: thread.relativePath || "",
        timestamp: null,
        completedAt: null,
        durationMs: null,
        durationEstimated: false,
        status: "lazy",
        children: [],
        detail: {
          kind: "lazy-child",
          thread,
        },
      },
    ],
    detail: {
      kind: "subagent",
      edge: child,
      thread,
      spawnEvent: compactTraceEvent(spawnEvent),
      notificationEvent: compactTraceEvent(notificationEvent),
      note: "子代理正文按需通过会话详情接口加载，不内嵌在父会话响应里。",
    },
  };
}

function compactTraceSession(session) {
  return {
    id: session.id,
    title: session.title,
    cwd: session.cwd,
    model: session.model,
    reasoningEffort: session.reasoningEffort,
    agentNickname: session.agentNickname,
    agentRole: session.agentRole,
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
    relativePath: session.relativePath,
  };
}

function summarizeTurnForTrace(turn, hierarchy) {
  const userSubagentNotice = turn.items
    .filter((item) => item.type === "user-message" && normalizeText(item.text))
    .map((item) => summarizeSubagentNotificationText(item.text, hierarchy))
    .find(Boolean);
  if (userSubagentNotice) {
    return userSubagentNotice;
  }

  const user = turn.items
    .filter((item) => item.type === "user-message" && normalizeText(item.text))
    .map((item) => ({ item, title: cleanTurnTitle(item.text) }))
    .find(({ title }) => isUsefulTurnTitle(title));
  if (user) {
    return {
      title: firstLine(user.title, 96) || "用户请求",
      subtitle: "用户请求",
      source: "user-message",
    };
  }

  const subagentNotice = turn.items
    .filter((item) => item.type === "event" && item.payload)
    .map((item) => summarizeSubagentNotification(item.payload, hierarchy))
    .find(Boolean);
  if (subagentNotice) {
    return subagentNotice;
  }

  const handoff = turn.items.find((item) => item.type === "tool-call" && ["spawn_agent", "wait_agent", "handoff"].includes(item.name));
  if (handoff) {
    return {
      title: firstLine(summarizeHandoffTool(handoff, hierarchy), 96),
      subtitle: "子代理委派",
      source: "handoff",
    };
  }

  const toolNames = [...new Set(turn.items.filter((item) => item.type === "tool-call" && item.name).map((item) => item.name))];
  if (toolNames.length > 0) {
    return {
      title: firstLine(`工具执行：${toolNames.slice(0, 3).join(", ")}${toolNames.length > 3 ? ` +${toolNames.length - 3}` : ""}`, 96),
      subtitle: "工具执行",
      source: "tool-call",
    };
  }

  const assistant = turn.items
    .filter((item) => item.type === "assistant-message" && normalizeText(item.text))
    .map((item) => ({ item, title: cleanTurnTitle(item.text) }))
    .find(({ title }) => isUsefulTurnTitle(title));
  if (assistant) {
    return {
      title: firstLine(assistant.title, 96) || "助手回复",
      subtitle: "助手回复",
      source: "assistant-message",
    };
  }

  return {
    title: turn.status || "turn",
    subtitle: "无可用摘要",
    source: "fallback",
  };
}

function summarizeSubagentNotification(payload, hierarchy) {
  const agentId = payload?.agent_path || payload?.agent_id || payload?.thread_id;
  if (!agentId) return null;
  const child = hierarchy.children.find((candidate) => candidate.childThreadId === agentId) || hierarchy.siblings?.find((candidate) => candidate.childThreadId === agentId);
  const thread = child?.thread || {};
  const name = [thread.agentNickname, thread.agentRole].filter(Boolean).join(" / ") || thread.title || agentId;
  return {
    title: firstLine(`子代理回执：${name}`, 96),
    subtitle: "子代理回执",
    source: "subagent-notification",
  };
}

function summarizeSubagentNotificationText(text, hierarchy) {
  const parsed = parseJsonObject(text);
  if (parsed) return summarizeSubagentNotification(parsed, hierarchy);
  const agentId = String(text || "").match(/"agent_path"\s*:\s*"([^"]+)"/)?.[1];
  return agentId ? summarizeSubagentNotification({ agent_path: agentId }, hierarchy) : null;
}

function summarizeHandoffTool(item, hierarchy) {
  const args = parseJsonObject(item.arguments);
  const explicitId = args?.agent_id || args?.thread_id || args?.target;
  const child = explicitId
    ? hierarchy.children.find((candidate) => candidate.childThreadId === explicitId) || hierarchy.siblings?.find((candidate) => candidate.childThreadId === explicitId)
    : null;
  const thread = child?.thread || {};
  const name = [thread.agentNickname, thread.agentRole].filter(Boolean).join(" / ") || thread.title || explicitId || item.name || "handoff";
  return item.name === "wait_agent" ? `等待子代理：${name}` : `委派子代理：${name}`;
}

function cleanTurnTitle(text) {
  const raw = String(text || "");
  const latestRequest = raw.match(/## My request for Codex:\s*([\s\S]*)$/i)?.[1];
  const withoutGoalWrapper = (latestRequest || raw)
    .replace(/#\s*AGENTS\.md instructions[\s\S]*?(?:<\/environment_context>|$)/i, "")
    .replace(/^Continue working toward the active thread goal\.[\s\S]*?(?=\n#{1,3}\s|\n\S|$)/i, "")
    .replace(/^# In app browser:[\s\S]*?## My request for Codex:\s*/i, "")
    .replace(/^# Files mentioned by the user:[\s\S]*?## My request for Codex:\s*/i, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\[[^\]]+\]\([^)]+\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return withoutGoalWrapper || firstLine(raw, 120);
}

function isUsefulTurnTitle(title) {
  const text = normalizeText(title);
  if (!text) return false;
  if (/^#?\s*AGENTS\.md instructions/i.test(text)) return false;
  if (/^Continue working toward the active thread goal/i.test(text)) return false;
  if (/^In app browser:/i.test(text)) return false;
  if (/^Files mentioned by the user:/i.test(text)) return false;
  return true;
}

function compactTraceTurn(turn, summary) {
  return {
    id: turn.id,
    startedAt: turn.startedAt,
    completedAt: turn.completedAt,
    status: turn.status,
    cwd: turn.cwd,
    context: turn.context,
    itemCount: turn.items.length,
    summary,
  };
}

function compactTraceItem(item) {
  const text = limitText(item.text, previewLimits.traceText);
  const args = limitText(item.arguments, previewLimits.traceArguments);
  const output = limitText(item.output, previewLimits.traceOutput);
  return {
    id: item.id,
    type: item.type,
    timestamp: item.timestamp,
    completedAt: item.completedAt || null,
    phase: item.phase || null,
    role: item.role || null,
    name: item.name || null,
    callId: item.callId || null,
    status: item.status || null,
    eventType: item.eventType || null,
    responseType: item.responseType || null,
    encrypted: item.encrypted || false,
    text: text.text,
    textLength: text.originalLength || null,
    arguments: args.text,
    argumentsLength: args.originalLength || null,
    output: output.text,
    outputLength: output.originalLength || null,
    truncated: text.truncated || args.truncated || output.truncated,
    info: compactTraceInfo(item.info),
  };
}

function compactTraceEvent(event) {
  if (!event) return null;
  return {
    index: event.index,
    timestamp: event.timestamp,
    kind: event.kind,
    important: event.important,
    type: event.type,
    payloadType: event.payloadType,
    role: event.role,
    title: event.title,
    preview: truncateTraceText(event.preview, 1500),
  };
}

function compactTraceInfo(info) {
  if (!info) return null;
  const total = info.total_token_usage || info.totalTokenUsage || info.total_tokens || null;
  const last = info.last_token_usage || info.lastTokenUsage || null;
  return { total_token_usage: total, last_token_usage: last };
}

function truncateTraceText(value, max) {
  return limitText(value, max).text;
}

function findSpawnAgentEvents(events, childById) {
  const byChild = new Map();
  for (const event of events) {
    if (event.kind !== "function_call") continue;
    const payload = event.payload ?? {};
    if (payload.name !== "spawn_agent") continue;
    const args = parseJsonObject(payload.arguments);
    const explicitId = args?.agent_id || args?.thread_id || args?.target;
    if (explicitId && childById.has(explicitId)) {
      byChild.set(explicitId, event);
      continue;
    }
    const message = String(args?.message || args?.prompt || "");
    for (const [childId, child] of childById.entries()) {
      const nickname = child.thread?.agentNickname;
      const role = child.thread?.agentRole;
      const title = child.thread?.title;
      if (
        !byChild.has(childId) &&
        ((nickname && message.includes(nickname)) || (role && message.includes(role)) || (title && message.includes(title)))
      ) {
        byChild.set(childId, event);
        break;
      }
    }
  }
  return byChild;
}

function findSubagentNotifications(events, childById) {
  const byChild = new Map();
  for (const event of events) {
    const text = event.preview || JSON.stringify(event.payload || {});
    if (!/subagent_notification|agent_path/i.test(text)) continue;
    for (const childId of childById.keys()) {
      if (text.includes(childId)) byChild.set(childId, event);
    }
  }
  return byChild;
}

function parseJsonObject(value) {
  if (!value || typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function flattenTrace(root) {
  const nodes = [];
  const walk = (node, depth, parentId) => {
    nodes.push({ ...node, depth, parentId, children: undefined, childCount: node.children?.length || 0 });
    for (const child of node.children || []) walk(child, depth + 1, node.id);
  };
  walk(root, 0, null);
  return nodes;
}

function durationMs(start, end) {
  const startMs = toMs(start);
  const endMs = toMs(end);
  if (startMs == null || endMs == null || endMs < startMs) return null;
  return endMs - startMs;
}

function toMs(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function formatIsoForTrace(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().replace("T", " ").slice(5, 16);
}

function shortPathServer(value) {
  const parts = String(value || "")
    .replace(/^\\\\\?\\/, "")
    .split(/[\\/]+/)
    .filter(Boolean);
  if (parts.length <= 3) return String(value || "");
  return `${parts[0]}/${parts[1]}/…/${parts.at(-1)}`;
}

function summarizeEventTitle(event) {
  const payload = event.payload ?? {};
  if (event.type === "session_meta") return "Session metadata";
  if (event.type === "turn_context") return `Turn context ${payload.turn_id ?? ""}`.trim();
  if (event.type === "event_msg") {
    if (isToolCallStart(payload.type)) return `Call ${toolNameFromPayload(payload)}`;
    if (isToolCallOutput(payload.type)) return `Output ${toolNameFromPayload(payload) || payload.call_id || ""}`.trim();
    return payload.type ?? "Event";
  }
  if (event.type === "response_item") {
    if (payload.type === "message") return `${payload.role || "message"} message`;
    if (isToolCallStart(payload.type)) return `Call ${toolNameFromPayload(payload)}`;
    if (isToolCallOutput(payload.type)) return `Output ${payload.call_id || ""}`.trim();
    return payload.type || "Response item";
  }
  if (isToolCallStart(event.type)) return `Call ${toolNameFromPayload(payload)}`;
  if (isToolCallOutput(event.type)) return `Output ${toolNameFromPayload(payload) || payload.call_id || ""}`.trim();
  return event.type || "Event";
}

function summarizeEventPreview(event) {
  const payload = event.payload ?? {};
  if (payload.message) return firstLine(payload.message, 180);
  if (payload.last_agent_message) return firstLine(payload.last_agent_message, 180);
  if (payload.content) return firstLine(extractContentText(payload.content), 180);
  if (payload.arguments) return firstLine(payload.arguments, 180);
  if (payload.input) return firstLine(payload.input, 180);
  if (payload.output) return firstLine(payload.output, 180);
  if (payload.stdout) return firstLine(payload.stdout, 180);
  if (payload.invocation) return firstLine(`${payload.invocation.server}.${payload.invocation.tool}`, 180);
  if (payload.summary?.length) return firstLine(JSON.stringify(payload.summary), 180);
  return "";
}

function buildTurns(events) {
  const turns = [];
  let current = null;
  let activeCall = new Map();

  function ensureTurn(event) {
    const turnId = event.payload?.turn_id || current?.id || `turn-${turns.length + 1}`;
    if (!current || current.id !== turnId) {
      current = {
        id: turnId,
        startedAt: eventTime(event),
        completedAt: null,
        status: "running",
        cwd: event.payload?.cwd ?? null,
        items: [],
      };
      turns.push(current);
      activeCall = new Map();
    }
    return current;
  }

  for (const event of events) {
    const payload = event.payload ?? {};
    if (event.type === "session_meta") continue;
    if (payload.type === "task_started") {
      current = {
        id: payload.turn_id || `turn-${turns.length + 1}`,
        startedAt: eventTime(event),
        completedAt: null,
        status: "running",
        cwd: null,
        items: [],
      };
      turns.push(current);
      activeCall = new Map();
      continue;
    }
    if (event.type === "turn_context") {
      const turn = ensureTurn(event);
      turn.cwd = payload.cwd ?? turn.cwd;
      turn.context = {
        model: payload.model,
        approvalPolicy: payload.approval_policy,
        sandbox: payload.sandbox_policy?.type,
        timezone: payload.timezone,
      };
      continue;
    }
    if (!current && shouldStartImplicitTurn(event)) ensureTurn(event);
    if (!current) continue;

    if (event.type === "event_msg") {
      if (payload.type === "user_message") {
        if (isDuplicateUserMessage(current, payload.message)) continue;
        current.items.push({
          id: `item-${current.items.length}`,
          type: "user-message",
          timestamp: eventTime(event),
          text: payload.message ?? "",
          attachments: payload.images ?? payload.local_images ?? [],
        });
      } else if (payload.type === "agent_message") {
        if (isDuplicateAssistantMessage(current, payload.message)) continue;
        current.items.push({
          id: `item-${current.items.length}`,
          type: "assistant-message",
          timestamp: eventTime(event),
          phase: payload.phase ?? null,
          text: payload.message ?? "",
        });
      } else if (payload.type === "token_count") {
        current.items.push({
          id: `item-${current.items.length}`,
          type: "token-count",
          timestamp: eventTime(event),
          info: payload.info ?? {},
        });
      } else if (isStandaloneToolEvent(payload.type)) {
        if (isToolCallStart(payload.type)) {
          registerToolCall(current, activeCall, event);
        } else {
          registerToolOutput(current, activeCall, event);
        }
      } else if (payload.type === "task_complete" || payload.type === "task_failed") {
        current.completedAt = eventTime(event);
        current.status = payload.type === "task_failed" ? "failed" : "completed";
        if (payload.last_agent_message && !hasAssistantMessage(current, payload.last_agent_message)) {
          current.items.push({
            id: `item-${current.items.length}`,
            type: "assistant-message",
            timestamp: eventTime(event),
            phase: "final",
            text: payload.last_agent_message,
          });
        }
      } else {
        current.items.push({
          id: `item-${current.items.length}`,
          type: "event",
          timestamp: eventTime(event),
          eventType: payload.type ?? "event",
          payload,
        });
      }
      continue;
    }

    if (event.type === "response_item") {
      if (payload.type === "message") {
        if (payload.role === "developer" || payload.role === "system") continue;
        const text = extractContentText(payload.content);
        if (payload.role === "user" && isDuplicateUserMessage(current, text)) continue;
        if (payload.role === "assistant" && isDuplicateAssistantMessage(current, text)) continue;
        current.items.push({
          id: `item-${current.items.length}`,
          type: payload.role === "user" ? "user-message" : "assistant-message",
          timestamp: eventTime(event),
          role: payload.role,
          text,
        });
      } else if (payload.type === "reasoning") {
        const text = Array.isArray(payload.summary)
          ? payload.summary.map((part) => part?.text ?? JSON.stringify(part)).join("\n")
          : "";
        current.items.push({
          id: `item-${current.items.length}`,
          type: "reasoning",
          timestamp: eventTime(event),
          text,
          encrypted: Boolean(payload.encrypted_content),
        });
      } else if (isToolCallStart(payload.type)) {
        registerToolCall(current, activeCall, event);
      } else if (isToolCallOutput(payload.type)) {
        registerToolOutput(current, activeCall, event);
      } else {
        current.items.push({
          id: `item-${current.items.length}`,
          type: "response-item",
          timestamp: eventTime(event),
          responseType: payload.type ?? "response",
          payload,
        });
      }
      continue;
    }

    if (isStandaloneToolEvent(event.type)) {
      if (isToolCallStart(event.type)) {
        registerToolCall(current, activeCall, event);
      } else {
        registerToolOutput(current, activeCall, event);
      }
    }
  }

  return turns.filter((turn) => turn.items.length > 0 || turn.context);
}

function shouldStartImplicitTurn(event) {
  const payloadType = event.payload?.type;
  return event.type === "event_msg" || event.type === "response_item" || payloadType === "user_message";
}

function hasAssistantMessage(turn, text) {
  const normalized = normalizeText(text);
  return turn.items.some((item) => item.type === "assistant-message" && normalizeText(item.text) === normalized);
}

function isDuplicateAssistantMessage(turn, text) {
  const normalized = normalizeText(text);
  if (!normalized) return true;
  return turn.items.some((item) => item.type === "assistant-message" && normalizeText(item.text) === normalized);
}

function isDuplicateUserMessage(turn, text) {
  const normalized = normalizeText(text);
  if (!normalized) return true;
  return turn.items.some((item) => item.type === "user-message" && normalizeText(item.text) === normalized);
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function isToolCallStart(type) {
  return type === "function_call" || type === "tool_search_call" || type === "custom_tool_call";
}

function isToolCallOutput(type) {
  return (
    type === "function_call_output" ||
    type === "tool_search_output" ||
    type === "custom_tool_call_output" ||
    type === "mcp_tool_call_end" ||
    type === "patch_apply_end"
  );
}

function isStandaloneToolEvent(type) {
  return isToolCallStart(type) || isToolCallOutput(type);
}

function registerToolCall(turn, activeCall, event) {
  const payload = event.payload ?? {};
  const callId = payload.call_id || `item-${turn.items.length}`;
  const item = {
    id: callId,
    type: "tool-call",
    timestamp: eventTime(event),
    name: toolNameFromPayload(payload),
    callId,
    status: payload.status || "started",
    arguments: toolArgumentsFromPayload(payload),
    output: null,
  };
  activeCall.set(callId, item);
  turn.items.push(item);
}

function registerToolOutput(turn, activeCall, event) {
  const payload = event.payload ?? {};
  const callId = payload.call_id || `item-${turn.items.length}`;
  const target = activeCall.get(callId);
  const output = toolOutputFromPayload(payload);
  if (target) {
    target.output = mergeToolOutput(target.output, output);
    target.status = payload.status || (payload.success === false ? "failed" : "completed");
    target.completedAt = eventTime(event);
    return;
  }

  turn.items.push({
    id: callId,
    type: "tool-call",
    timestamp: eventTime(event),
    name: toolNameFromPayload(payload),
    callId,
    status: payload.status || (payload.success === false ? "failed" : "completed"),
    arguments: toolArgumentsFromPayload(payload),
    output,
  });
}

function toolNameFromPayload(payload) {
  if (payload.name) return payload.name;
  if (payload.execution) return payload.execution;
  if (payload.invocation?.server || payload.invocation?.tool) {
    return [payload.invocation.server, payload.invocation.tool].filter(Boolean).join(".");
  }
  if (payload.type === "patch_apply_end") return "apply_patch";
  return payload.type || "tool";
}

function toolArgumentsFromPayload(payload) {
  if (payload.arguments != null) return payload.arguments;
  if (payload.arguments_json != null) return payload.arguments_json;
  if (payload.input != null) return payload.input;
  if (payload.invocation?.arguments != null) return JSON.stringify(payload.invocation.arguments, null, 2);
  if (payload.changes != null) return JSON.stringify({ changes: payload.changes }, null, 2);
  return null;
}

function toolOutputFromPayload(payload) {
  if (payload.output != null) return payload.output;
  if (payload.result != null) return renderMcpResult(payload.result);
  if (payload.stdout || payload.stderr) return [payload.stdout, payload.stderr].filter(Boolean).join("\n");
  if (payload.success != null) return payload.success ? "Success" : "Failed";
  return null;
}

function renderMcpResult(result) {
  if (result?.Ok?.content && Array.isArray(result.Ok.content)) {
    return result.Ok.content
      .map((part) => part?.text ?? JSON.stringify(part))
      .filter(Boolean)
      .join("\n\n");
  }
  if (result?.Err) return JSON.stringify(result.Err, null, 2);
  return JSON.stringify(result ?? null, null, 2);
}

function mergeToolOutput(previous, next) {
  if (next == null || next === "") return previous ?? null;
  if (previous == null || previous === "") return next;
  const left = String(previous).trim();
  const right = String(next).trim();
  if (!right || left === right || left.includes(right)) return previous;
  if (right.includes(left)) return next;
  return `${left}\n\n${right}`;
}

function renderConversationMarkdown(session, turns) {
  const lines = [`# ${escapeMd(session.title || "Codex session")}`, ""];
  lines.push(`- 会话 ID: \`${session.id}\``);
  if (session.cwd) lines.push(`- 工作目录: \`${session.cwd}\``);
  if (session.startedAt) lines.push(`- 开始时间: ${session.startedAt}`);
  if (session.updatedAt) lines.push(`- 更新时间: ${session.updatedAt}`);
  lines.push("");

  for (const [index, turn] of turns.entries()) {
    lines.push(`## Turn ${index + 1}`);
    if (turn.startedAt || turn.completedAt || turn.status) {
      const meta = [turn.status, turn.startedAt, turn.completedAt].filter(Boolean).join(" · ");
      lines.push("");
      lines.push(`_${meta}_`);
    }
    for (const item of turn.items) {
      lines.push("");
      lines.push(`### ${itemTitle(item)}`);
      lines.push("");
      lines.push(renderItemMarkdown(item));
    }
    lines.push("");
  }
  return lines.join("\n").replace(/\n{4,}/g, "\n\n\n").trimEnd() + "\n";
}

function itemTitle(item) {
  switch (item.type) {
    case "user-message":
      return "用户";
    case "assistant-message":
      return item.phase === "final" ? "助手最终回复" : "助手";
    case "reasoning":
      return "推理摘要";
    case "tool-call":
      return `工具调用: ${item.name || item.callId || "tool"}`;
    case "tool-output":
      return "工具输出";
    case "token-count":
      return "Token 统计";
    default:
      return item.eventType || item.responseType || item.type;
  }
}

function renderItemMarkdown(item) {
  if (item.type === "user-message" || item.type === "assistant-message" || item.type === "reasoning") {
    return String(item.text || (item.encrypted ? "_推理内容已加密存储_" : "")).trim() || "_无文本内容_";
  }
  if (item.type === "tool-call") {
    const parts = [];
    if (item.arguments != null) parts.push(fenced("json", prettyMaybeJson(item.arguments)));
    if (item.output != null) parts.push(fenced("text", String(item.output)));
    return parts.join("\n\n") || "_无参数_";
  }
  if (item.type === "tool-output") return fenced("text", String(item.output ?? ""));
  return fenced("json", JSON.stringify(item.payload ?? item.info ?? item, null, 2));
}

function fenced(lang, body) {
  const text = String(body ?? "").replace(/\s+$/g, "");
  return `\`\`\`${lang}\n${text}\n\`\`\``;
}

function prettyMaybeJson(value) {
  if (typeof value !== "string") return JSON.stringify(value, null, 2);
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function escapeMd(value) {
  return String(value).replaceAll("#", "\\#").trim();
}

async function serveStatic(req, res, pathname) {
  const relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  const safeRelative = path.normalize(relative).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, safeRelative);
  if (!filePath.startsWith(publicDir)) return sendError(res, 403, "Forbidden");
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return sendError(res, 404, "Not found");
  }
  if (!stat.isFile()) return sendError(res, 404, "Not found");
  const type = staticTypes.get(path.extname(filePath).toLowerCase()) || "application/octet-stream";
  res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
  createReadStream(filePath).pipe(res);
}

async function route(req, res) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const pathname = url.pathname;
  try {
    if (pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        codexHome,
        sessionsRoot,
        sessionIndexPath,
        time: new Date().toISOString(),
      });
    }
    if (pathname === "/api/sessions") {
      const sessions = (await listSessions()).map(compactSessionForList);
      return sendJson(res, 200, { sessions });
    }
    const markdownMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/markdown$/);
    if (markdownMatch) {
      const markdown = await getSessionMarkdown(decodeURIComponent(markdownMatch[1]));
      if (markdown == null) return sendError(res, 404, "Session not found");
      return send(res, 200, textHeaders, markdown);
    }
    const eventMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/events\/(\d+)$/);
    if (eventMatch) {
      const event = await getSessionEvent(decodeURIComponent(eventMatch[1]), Number(eventMatch[2]));
      if (!event) return sendError(res, 404, "Event not found");
      return sendJson(res, 200, event);
    }
    const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
    if (sessionMatch) {
      const detail = await getSessionDetail(decodeURIComponent(sessionMatch[1]));
      if (!detail) return sendError(res, 404, "Session not found");
      return sendJson(res, 200, detail);
    }
    return serveStatic(req, res, pathname);
  } catch (error) {
    return sendError(res, 500, "Internal server error", {
      name: error?.name,
      message: error?.message,
      stack: process.env.NODE_ENV === "development" ? error?.stack : undefined,
    });
  }
}

createServer(route).listen(port, "127.0.0.1", () => {
  console.log(`Codex session renderer: http://127.0.0.1:${port}/`);
  console.log(`Read-only data source: ${codexHome}`);
});
