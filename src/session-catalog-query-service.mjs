import { readJsonlWithDiagnostics } from "./jsonl-reader.mjs";
import { extractProjectedGoalObjective } from "./event-summary.mjs";
import { isLikelyCodexGoalControlText } from "./pi-goal-projection.mjs";
import { fileSignature, isAbortError } from "./session-detail-coordinator.mjs";
import { compactSessionForList, publicThreadMeta, rootSessionsOnly, sessionFromThread, sessionMatchesListType, spawnEdgesFromSessions } from "./session-models.mjs";
import { filterSessions, paginateSessions, parseSessionListQuery, projectSessionForApi, sessionWatermark, sortSessions } from "./session-query.mjs";

const recentSessionWindowMs = 24 * 60 * 60 * 1000;
const maxSessionLineageDepth = 10;

export function createSessionCatalogQueryService(dependencies) {
  return {
    getSessionById: (context, id, options) => getSessionById(dependencies, context, id, options),
    getSessionLineage: (context, session, options) => getSessionLineage(dependencies, context, session, options),
    getThreadHierarchy: (context, threadId, options) => getThreadHierarchy(dependencies, context, threadId, options),
    listSessionsForDisplay: (context, scope, params) => listSessionsForDisplay(dependencies, context, scope, params),
    normalizeSessionCatalogScope,
    querySessions: (context, params, projectionOptions) => querySessions(dependencies, context, params, projectionOptions),
  };
}

function normalizeSessionCatalogScope(scope) {
  return ["recent24h", "history", "all"].includes(scope) ? scope : "all";
}

function sessionCatalogBounds(scope) {
  const cutoffMs = Date.now() - recentSessionWindowMs;
  if (scope === "recent24h") return { sinceMs: cutoffMs };
  if (scope === "history") return { beforeMs: cutoffMs };
  return {};
}

function sessionMatchesCatalogBounds(session, bounds) {
  const timestamp = new Date(session.updatedAt || session.fileModifiedAt || session.startedAt || "").getTime();
  if (!Number.isFinite(timestamp)) return bounds.beforeMs != null;
  if (bounds.sinceMs != null && timestamp < bounds.sinceMs) return false;
  if (bounds.beforeMs != null && timestamp >= bounds.beforeMs) return false;
  return true;
}

async function supplementVerifiedFileSessionTitles({ maxListSessions }, context, sessions, options = {}) {
  if (context.source.kind === "pi-agent") return sessions;
  const candidates = sessions.filter((session) => session?.id && session?.path).slice(0, maxListSessions);
  if (candidates.length === 0) return sessions;
  const threads = await context.threadStore.readThreadRowsByIds(candidates.map((session) => session.id), { signal: options.signal });
  if (threads.size === 0) return sessions;
  return sessions.map((session) => ({ ...session, title: threads.get(session.id)?.title || session.title }));
}

async function correctControlPacketListTitles(dependencies, context, sessions, options = {}) {
  const candidates = sessions.filter(needsControlTitleCorrection);
  if (candidates.length === 0) return sessions;
  const corrected = await Promise.all(candidates.map((session) => correctControlTitle(dependencies, context, session, options)));
  const byId = new Map(corrected.map((session) => [session.id, session]));
  return sessions.map((session) => byId.get(session.id) || session);
}

function needsControlTitleCorrection(session) {
  return Boolean(session?.path && (isLikelyCodexGoalControlText(session.title) || isLikelyCodexGoalControlText(session.preview)));
}

async function correctControlTitle({ sessionFileStat, throwIfRequestAborted }, context, session, options) {
  throwIfRequestAborted(options.signal);
  const before = await sessionFileStat(context, session.path, session.id);
  if (!before) return session;
  const events = await readTitleProbe(context, session.path, options);
  const after = await sessionFileStat(context, session.path, session.id);
  if (!titleProbeIsUsable(session.path, before, after, events)) return session;
  const objective = extractProjectedGoalObjective(events);
  return objective ? replaceControlTitle(session, objective) : session;
}

async function readTitleProbe(context, filePath, options) {
  return context.sessionDetailCoordinator.readGate.run(
    () => readJsonlWithDiagnostics(filePath, { maxLines: 24, maxBytes: 96 * 1024, signal: options.signal }),
    options.signal,
  ).catch((error) => {
    if (isAbortError(error)) throw error;
    return null;
  });
}

function titleProbeIsUsable(filePath, before, after, events) {
  const confirmedDiagnostic = events?.some((event, index) => event?.__jsonlDiagnostic && (before.size <= 96 * 1024 || index < events.length - 1));
  return Boolean(events && after && fileSignature(filePath, before) === fileSignature(filePath, after) && !confirmedDiagnostic);
}

function replaceControlTitle(session, objective) {
  return {
    ...session,
    title: isLikelyCodexGoalControlText(session.title) ? objective : session.title,
    preview: isLikelyCodexGoalControlText(session.preview) ? objective : session.preview,
  };
}

async function listSessionsFromFiles(dependencies, { context, bounds, options, now, scope }) {
  const sessions = await dependencies.directoryQueries.listFileSessions(context, bounds, options);
  const rootSessions = await correctControlPacketListTitles(dependencies, context, rootSessionsOnly(sessions, spawnEdgesFromSessions(sessions)), options);
  const results = rootSessions.sort(sortByUpdatedAt).slice(0, options.maxRecords || dependencies.maxListSessions);
  cacheSessions(context, scope, options, now, results);
  return results;
}

async function listSessions(dependencies, context, options = {}) {
  dependencies.throwIfRequestAborted(options.signal);
  const scope = normalizeSessionCatalogScope(options.scope || "all");
  const bounds = sessionCatalogBounds(scope);
  const now = Date.now();
  const cached = context.sessionCacheByScope.get(scope);
  if (cached && now - cached.time < 3000) return cached.sessions;
  const threads = await context.threadStore.readThreads({ ...bounds, limit: options.maxRecords || dependencies.maxListSessions, signal: options.signal });
  if (threads.size === 0) return listSessionsFromFiles(dependencies, { context, bounds, options, now, scope });
  const sessions = await sessionsFromThreads(dependencies, context, threads, options);
  if (sessions.length === 0) return listSessionsFromFiles(dependencies, { context, bounds, options, now, scope });
  const results = (await correctControlPacketListTitles(dependencies, context, rootSessionsOnly(sessions, []), options))
    .sort(sortByUpdatedAt)
    .filter((session) => sessionMatchesCatalogBounds(session, bounds))
    .slice(0, options.maxRecords || dependencies.maxListSessions);
  cacheSessions(context, scope, options, now, results);
  return results;
}

async function sessionsFromThreads(dependencies, context, threads, options = {}) {
  const sessions = [];
  for (const thread of threads.values()) {
    dependencies.throwIfRequestAborted(options.signal);
    const session = sessionFromThread(thread, context.codexHome, dependencies.sourceModelOptions(context));
    if (await dependencies.sessionFileExists(context, session, options)) sessions.push(session);
  }
  return sessions;
}

function cacheSessions(context, scope, options, now, sessions) {
  if (options.maxRecords) return;
  context.sessionCache = sessions;
  context.sessionCacheTime = now;
  context.sessionCacheByScope.set(scope, { sessions, time: now });
}

function sortByUpdatedAt(left, right) {
  return new Date(right.updatedAt || right.fileModifiedAt || 0) - new Date(left.updatedAt || left.fileModifiedAt || 0);
}

async function getSessionById(dependencies, context, id, options = {}) {
  dependencies.throwIfRequestAborted(options.signal);
  const thread = (await context.threadStore.readThreadRowsByIds([id], { signal: options.signal })).get(id);
  const fromThread = await getSessionFromThread(dependencies, context, thread, options);
  if (fromThread) return fromThread;
  const listed = (await listSessions(dependencies, context, { ...options, scope: "all" })).find((session) => session.id === id);
  if (listed) return listed;
  return findSessionFileRecord(dependencies, context, id, options);
}

async function getSessionFromThread(dependencies, context, thread, options) {
  if (!thread) return null;
  const session = sessionFromThread(thread, context.codexHome, dependencies.sourceModelOptions(context));
  if (!await dependencies.sessionFileExists(context, session, options)) return null;
  const enriched = await dependencies.directoryQueries.enrichSessionFromFileMeta(session, { ...options, context });
  return (await correctControlPacketListTitles(dependencies, context, [enriched], options))[0];
}

async function findSessionFileRecord(dependencies, context, id, options) {
  for (const record of await dependencies.directoryQueries.collectSessionFileRecords(context, options)) {
    dependencies.throwIfRequestAborted(options.signal);
    if (record.id !== id) continue;
    const session = await dependencies.directoryQueries.sessionFromFilePath(context, record.filePath, { archived: record.archived, sessionId: record.id, signal: options.signal });
    if (!session) return null;
    const titled = await supplementVerifiedFileSessionTitles(dependencies, context, [session], options);
    return (await correctControlPacketListTitles(dependencies, context, titled, options))[0];
  }
  return null;
}

async function listAllSessionsForQuery(dependencies, context) {
  const now = Date.now();
  if (context.allSessionCache && now - context.allSessionCacheTime < 3000) return context.allSessionCache;
  const threads = await context.threadStore.readAllThreads();
  const sessions = await sessionsFromThreads(dependencies, context, threads);
  const enriched = await Promise.all(sessions.map((session) => dependencies.directoryQueries.enrichSessionFromFileMeta(session, { context })));
  const resolved = enriched.length > 0 ? enriched : await dependencies.directoryQueries.listFileSessions(context);
  context.allSessionCache = await correctControlPacketListTitles(dependencies, context, resolved.slice(0, dependencies.maxListSessions), {});
  context.allSessionCacheTime = now;
  return context.allSessionCache;
}

async function listSessionsForDisplay(dependencies, context, scope, params) {
  const query = String(params.get("q") || "").trim().toLowerCase();
  return (await listSessions(dependencies, context, { scope }))
    .filter((session) => sessionMatchesListType(session, params.get("type")))
    .filter((session) => !query || displaySearchText(session).includes(query))
    .map(compactSessionForList);
}

function displaySearchText(session) {
  return [session.id, session.title, session.preview, session.cwd, session.relativePath, session.model, session.agentNickname].filter(Boolean).join("\n").toLowerCase();
}

async function querySessions(dependencies, context, params, projectionOptions = {}) {
  const query = parseSessionListQuery(params);
  const [sessions, spawnEdges] = await Promise.all([listAllSessionsForQuery(dependencies, context), context.threadStore.readSpawnEdges()]);
  const filtered = filterSessions(sessions, query, spawnEdges);
  const page = paginateSessions(sortSessions(filtered, query), query);
  return {
    sessions: page.items.map((session) => projectSessionForApi(session, query, projectionOptions)),
    page: { offset: page.offset, limit: page.limit, returned: page.items.length, total: page.total, nextCursor: page.nextCursor },
    watermark: sessionWatermark(filtered),
    serverTime: new Date().toISOString(),
  };
}

async function getThreadHierarchy(dependencies, context, threadId, options = {}) {
  dependencies.throwIfRequestAborted(options.signal);
  const edges = await context.threadStore.readSpawnEdges();
  const relationships = relatedEdges(edges, threadId);
  const ids = [threadId, ...relationships.direct.map((edge) => edge.childThreadId), ...relationships.parents.map((edge) => edge.parentThreadId), ...relationships.siblings.map((edge) => edge.childThreadId)];
  const threads = await enrichThreadRows(dependencies, context, await context.threadStore.readThreadRowsByIds(ids), options);
  const optionsForModel = dependencies.sourceModelOptions(context);
  return hierarchyFromEdges(context, relationships, threads, optionsForModel, threadId);
}

function relatedEdges(edges, threadId) {
  const direct = edges.filter((edge) => edge.parentThreadId === threadId);
  const parents = edges.filter((edge) => edge.childThreadId === threadId);
  const siblings = parents[0] ? edges.filter((edge) => edge.parentThreadId === parents[0].parentThreadId) : [];
  return { direct, parents, siblings };
}

async function enrichThreadRows(dependencies, context, threads, options) {
  const entries = await Promise.all([...threads.entries()].map(async ([id, thread]) => {
    const session = sessionFromThread(thread, context.codexHome, dependencies.sourceModelOptions(context));
    const meta = await dependencies.directoryQueries.enrichSessionFromFileMeta(session, { ...options, context });
    return [id, { ...thread, path: meta.path ? thread.path : "", cwd: thread.cwd || meta.cwd || null, model: thread.model || meta.model || null, threadSource: thread.threadSource || meta.threadSource || null, modelProvider: thread.modelProvider || meta.modelProvider || null, agentNickname: thread.agentNickname || meta.agentNickname || null, agentRole: thread.agentRole || meta.agentRole || null }];
  }));
  return new Map(entries);
}

function hierarchyFromEdges(context, { direct, parents, siblings }, threads, modelOptions, threadId) {
  const parent = parents[0] || null;
  return {
    parent: parent ? { ...parent, thread: publicThreadMeta(threads.get(parent.parentThreadId), context.codexHome, modelOptions) } : null,
    children: direct.map((edge) => ({ ...edge, thread: publicThreadMeta(threads.get(edge.childThreadId), context.codexHome, modelOptions) })),
    siblings: siblings.map((edge) => ({ ...edge, thread: publicThreadMeta(threads.get(edge.childThreadId), context.codexHome, modelOptions), active: edge.childThreadId === threadId })),
  };
}

async function getSessionLineage(dependencies, context, session, options = {}) {
  if (!session?.id) return null;
  const catalog = await safeSessionCatalog(dependencies, context, options);
  if (!catalog.length) return null;
  return collectSessionLineage(catalog, session);
}

async function safeSessionCatalog(dependencies, context, options) {
  try {
    return await listSessions(dependencies, context, { ...options, scope: "all" });
  } catch (error) {
    if (isAbortError(error)) throw error;
    return [];
  }
}

function collectSessionLineage(catalog, session) {
  const byId = new Map(catalog.map((item) => [item.id, item]));
  const current = byId.get(session.id) || session;
  const parent = current.parentSessionId ? byId.get(current.parentSessionId) || null : null;
  const children = catalog.filter((item) => item.id !== current.id && item.parentSessionId === current.id).sort((left, right) => lineageTimeMs(left) - lineageTimeMs(right));
  if (!parent && children.length === 0) return null;
  return { parentId: current.parentSessionId || null, parent: lineageSummary(parent), children: children.map(lineageSummary), chain: collectAncestors(byId, parent, current.id).map(lineageSummary) };
}

function collectAncestors(byId, parent, currentId) {
  const ancestors = [];
  const visited = new Set([currentId]);
  let ancestor = parent;
  while (ancestor && !visited.has(ancestor.id) && ancestors.length < maxSessionLineageDepth) {
    ancestors.push(ancestor);
    visited.add(ancestor.id);
    ancestor = ancestor.parentSessionId ? byId.get(ancestor.parentSessionId) || null : null;
  }
  return ancestors.reverse();
}

function lineageSummary(session) {
  return session ? { id: session.id, title: session.displayTitle || session.title || "未命名会话", startedAt: session.startedAt || null, updatedAt: session.updatedAt || session.fileModifiedAt || null, archived: Boolean(session.archived) } : null;
}

function lineageTimeMs(session) {
  for (const value of [session?.startedAt, session?.updatedAt, session?.fileModifiedAt]) {
    const milliseconds = value ? new Date(value).getTime() : NaN;
    if (Number.isFinite(milliseconds)) return milliseconds;
  }
  return 0;
}