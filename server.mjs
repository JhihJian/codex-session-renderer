import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { sendError, sendJson, sendText, serveStaticFile } from "./src/http-response.mjs";
import { readJsonl, readJsonlLine } from "./src/jsonl-reader.mjs";
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
  normalizeSlash,
  renderConversationMarkdown,
  sessionIdFromFile,
  sessionStartedFromFile,
  summarizeEventPreview,
  summarizeEventTitle,
  summarizeSessionEvents,
  toIso,
  toMs,
} from "./src/session-events.mjs";
import { compactSessionForList, publicThreadMeta, rootSessionsOnly, sessionFromThread, withFileStat } from "./src/session-models.mjs";
import { createSqliteThreadStore, stripLongPathPrefix } from "./src/sqlite-threads.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const sessionsRoot = path.join(codexHome, "sessions");
const sessionIndexPath = path.join(codexHome, "session_index.jsonl");
const stateDbPath = path.join(codexHome, "state_5.sqlite");
const maxListSessions = Number(process.env.CODEX_SESSION_RENDERER_LIMIT || 800);
const port = Number(process.env.PORT || 4789);
const threadStore = createSqliteThreadStore({ stateDbPath, maxListSessions });

let sessionCache = null;
let sessionCacheTime = 0;
const sessionDetailCache = new Map();

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

async function listSessions() {
  const now = Date.now();
  if (sessionCache && now - sessionCacheTime < 3000) return sessionCache;

  const threads = await threadStore.readThreads();
  if (threads.size > 0) {
    const spawnEdges = await threadStore.readSpawnEdges();
    const sessions = [...threads.values()]
      .map((thread) => sessionFromThread(thread, codexHome))
      .filter((session) => session.path);
    const rootSessions = rootSessionsOnly(sessions, spawnEdges);
    rootSessions.sort((a, b) => new Date(b.updatedAt || b.fileModifiedAt || 0) - new Date(a.updatedAt || a.fileModifiedAt || 0));
    sessionCache = rootSessions.slice(0, maxListSessions);
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

  const thread = (await threadStore.readThreadRowsByIds([id])).get(id);
  if (thread) return sessionFromThread(thread, codexHome);

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
  const hierarchy = await getThreadHierarchy(id);
  const cached = sessionDetailCache.get(id);
  if (cached && cached.mtimeMs === fileTimeMs(stat) && cached.size === stat.size && hierarchy.children.length === 0) return cached.detail;

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
  const publicTurns = compactTurnsForClient(turns);
  const trace = buildTrace(sessionWithStat, rawEvents, analysisEvents, turns, hierarchy);
  const compact = await buildCompactView(sessionWithStat, analysisEvents, turns, hierarchy);
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
  const detail = { session: sessionWithStat, turns: publicTurns, events: publicEvents, stats, trace, compact };
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

async function buildCompactView(session, normalizedEvents, turns, hierarchy, options = {}) {
  const depth = options.depth ?? 0;
  const maxDepth = options.maxDepth ?? 3;
  const childById = new Map(hierarchy.children.map((child) => [child.childThreadId, child]));
  const spawnByChildId = findSpawnAgentEvents(normalizedEvents, childById);
  const notificationByChildId = findSubagentNotifications(normalizedEvents, childById);
  const childNodes = new Map();

  if (depth < maxDepth) {
    for (const child of hierarchy.children) {
      const childSummary = await buildCompactChildNode(child, {
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

async function buildCompactChildNode(child, context) {
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
    const childSession = await getSessionById(thread.id);
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
    const rawEvents = await readJsonl(childSession.path);
    const normalizedEvents = rawEvents.map((event, index) => ({
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
    const childTurns = buildTurns(rawEvents);
    const childHierarchy = await getThreadHierarchy(thread.id);
    const compact = await buildCompactView(childSessionWithStat, normalizedEvents, childTurns, childHierarchy, {
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

async function getSessionMarkdown(id) {
  const session = await getSessionById(id);
  if (!session) return null;
  const rawEvents = await readJsonl(session.path);
  return renderConversationMarkdown(session, buildTurns(rawEvents));
}

async function getThreadHierarchy(threadId) {
  const edges = await threadStore.readSpawnEdges();
  const directEdges = edges.filter((edge) => edge.parentThreadId === threadId);
  const parentEdges = edges.filter((edge) => edge.childThreadId === threadId);
  const primaryParentEdge = parentEdges[0] || null;
  const siblingEdges = primaryParentEdge
    ? edges.filter((edge) => edge.parentThreadId === primaryParentEdge.parentThreadId)
    : [];
  const childIds = directEdges.map((edge) => edge.childThreadId);
  const parentIds = parentEdges.map((edge) => edge.parentThreadId);
  const siblingIds = siblingEdges.map((edge) => edge.childThreadId);
  const threads = await threadStore.readThreadRowsByIds([threadId, ...childIds, ...parentIds, ...siblingIds]);
  return {
    parent: primaryParentEdge
      ? {
          ...primaryParentEdge,
          thread: publicThreadMeta(threads.get(primaryParentEdge.parentThreadId), codexHome),
        }
      : null,
    children: directEdges.map((edge) => ({
      ...edge,
      thread: publicThreadMeta(threads.get(edge.childThreadId), codexHome),
    })),
    siblings: siblingEdges.map((edge) => ({
      ...edge,
      thread: publicThreadMeta(threads.get(edge.childThreadId), codexHome),
      active: edge.childThreadId === threadId,
    })),
  };
}

async function serveStatic(req, res, pathname) {
  return serveStaticFile(res, publicDir, pathname);
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
      return sendText(res, 200, markdown);
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
