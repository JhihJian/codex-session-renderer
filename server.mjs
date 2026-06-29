import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAuditChain } from "./src/audit-chain.mjs";
import { createDataSourceRegistry } from "./src/data-sources.mjs";
import { sendError, sendJson, sendText, serveStaticFile } from "./src/http-response.mjs";
import { readJsonl, readJsonlLine, readJsonlRange } from "./src/jsonl-reader.mjs";
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
import {
  compactSessionForList,
  publicThreadMeta,
  relativeCodexPath,
  rootSessionsOnly,
  sessionFromThread,
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
const dataSources = createDataSourceRegistry();
const sourceContexts = new Map();

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
    const sessions = [...threads.values()]
      .map((thread) => sessionFromThread(thread, context.codexHome, sourceModelOptions(context)))
      .filter((session) => session.path);
    const rootSessions = rootSessionsOnly(sessions, spawnEdges);
    rootSessions.sort((a, b) => new Date(b.updatedAt || b.fileModifiedAt || 0) - new Date(a.updatedAt || a.fileModifiedAt || 0));
    context.sessionCache = rootSessions.slice(0, maxListSessions);
    context.sessionCacheTime = now;
    return context.sessionCache;
  }

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
      sourceId: context.source.id,
      sourceLabel: context.source.label,
      dataSourceKind: context.source.kind,
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
      relativePath: relativeCodexPath(context.codexHome, filePath),
      startedAt,
      updatedAt,
      sizeBytes: stat.size,
      fileModifiedAt: toIso(stat.mtime),
    });
  }

  sessions.sort((a, b) => new Date(b.updatedAt || b.fileModifiedAt) - new Date(a.updatedAt || a.fileModifiedAt));
  context.sessionCache = sessions.slice(0, maxListSessions);
  context.sessionCacheTime = now;
  return context.sessionCache;
}

async function getSessionById(context, id) {
  const cached = context.sessionCache?.find((session) => session.id === id);
  if (cached) return cached;

  const thread = (await context.threadStore.readThreadRowsByIds([id])).get(id);
  if (thread) return sessionFromThread(thread, context.codexHome, sourceModelOptions(context));

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
    const sessions = [...threads.values()]
      .map((thread) => sessionFromThread(thread, context.codexHome, sourceModelOptions(context)))
      .filter((session) => session.path);
    sessions.sort((a, b) => new Date(b.updatedAt || b.fileModifiedAt || 0) - new Date(a.updatedAt || a.fileModifiedAt || 0));
    context.allSessionCache = sessions.slice(0, maxListSessions);
    context.allSessionCacheTime = now;
    return context.allSessionCache;
  }

  const previousCache = context.sessionCache;
  const previousCacheTime = context.sessionCacheTime;
  context.sessionCache = null;
  context.sessionCacheTime = 0;
  const sessions = await listSessions(context);
  context.sessionCache = previousCache;
  context.sessionCacheTime = previousCacheTime;
  context.allSessionCache = sessions;
  context.allSessionCacheTime = now;
  return context.allSessionCache;
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
  const stat = await fs.stat(session.path);
  const sessionWithStat = withFileStat(session, stat);
  const hierarchy = await getThreadHierarchy(context, id);
  const cacheKey = `${id}:maxDepth=${maxDepth}`;
  const cached = context.sessionDetailCache.get(cacheKey);
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
  const compact = await buildCompactView(context, sessionWithStat, analysisEvents, turns, hierarchy, { maxDepth });
  const audit = buildAuditChain({ turns: publicTurns, events: publicEvents, trace });
  const stats = {
    ...summarizeSessionEvents(rawEvents),
    eventCount: rawEvents.length,
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
  const detail = await getSessionDetail(context, id, { maxDepth: query.maxDepth });
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
  const meta = events.find((event) => event.type === "session_meta")?.payload ?? {};
  return withFileStat(
    {
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
    },
    stat,
  );
}

async function getSessionMarkdown(context, id) {
  const session = await getSessionById(context, id);
  if (!session) return null;
  const rawEvents = await readJsonl(session.path);
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
  const threads = await context.threadStore.readThreadRowsByIds([threadId, ...childIds, ...parentIds, ...siblingIds]);
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
      const detail = await getSessionDetail(context, decodeURIComponent(sourceSessionMatch[2]));
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
      const detail = await getSessionDetail(context, decodeURIComponent(sessionMatch[1]));
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

function resolveRequestSource(url) {
  return getSourceContext(url.searchParams.get("sourceId") || "local");
}

createServer(route).listen(port, "127.0.0.1", () => {
  console.log(`Codex session renderer: http://127.0.0.1:${port}/`);
  for (const source of dataSources.listSources()) {
    console.log(`Read-only data source [${source.id}]: ${source.kind === "local" ? source.codexHome : source.snapshotPath}`);
  }
});
