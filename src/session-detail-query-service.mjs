import { buildTrace, buildTurns, compactChildBase, compactChildPlaceholder, compactCompactSession, compactTurnsForClient, compactTurnForView, deriveSessionStatusFromTurns, findSpawnAgentEvents, findSubagentNotifications, isImportantEvent, summarizeEventPreview, summarizeEventTitle, summarizeSessionEvents, toMs } from "./session-events.mjs";
import { normalizeSessionEvent } from "./session-normalizer.mjs";
import { withFileStat } from "./session-models.mjs";
import { parseSessionViewQuery, projectSessionForApi } from "./session-query.mjs";
import { buildSessionTiming } from "./session-timing.mjs";
import { isAbortError } from "./session-detail-coordinator.mjs";

export function createSessionDetailQueryService(dependencies) {
  return {
    getSessionDetail: (context, id, options) => getSessionDetail(dependencies, context, id, options),
    querySessionView: (context, id, params, projectionOptions, options) => querySessionView(dependencies, context, id, params, { ...options, projectionOptions }),
  };
}

function analysisEventFromRaw(event, index) {
  const normalized = normalizeSessionEvent(event, event?.index ?? index);
  return {
    index: normalized.index ?? index, timestamp: normalized.timestamp, kind: normalized.kind, semanticKind: normalized.semanticKind,
    important: isImportantEvent(normalized), type: normalized.rawType, payloadType: normalized.payloadType, role: normalized.role,
    messageId: normalized.messageId, parentId: normalized.parentId, title: summarizeEventTitle(normalized), preview: summarizeEventPreview(normalized),
    payloadSize: normalized.payloadSize, rawSize: normalized.rawSize, attachments: normalized.attachments, reasoning: normalized.reasoning,
    compact: normalized.compact, diagnostic: normalized.diagnostic || null, payload: normalized.payload,
  };
}

async function getSessionDetail(dependencies, context, id, options = {}) {
  dependencies.throwIfRequestAborted(options.signal);
  const session = await dependencies.getSessionById(context, id, { signal: options.signal });
  if (!session || !await dependencies.sessionFileExists(context, session, options)) return null;
  const maxDepth = options.maxDepth ?? 3;
  const result = await context.sessionDetailCoordinator.read(session, {
    cacheKey: `detail:${context.source.id}:${id}:maxDepth=${maxDepth}`,
    signal: options.signal,
    shouldCache: (detail) => detail.stats?.childThreadCount === 0,
    derive: (rawEvents, stat, signal) => deriveSessionDetail(dependencies, { context, id, session, rawEvents, stat, maxDepth, signal }),
  });
  return { ...result.value, modelWindow: sessionModelWindow(context, result.value.session), related: await dependencies.getSessionLineage(context, session, options) };
}

async function deriveSessionDetail(dependencies, { context, id, session, rawEvents, stat, maxDepth, signal }) {
  dependencies.throwIfRequestAborted(signal);
  const sessionWithStat = withFileStat(session, stat);
  const hierarchy = await dependencies.getThreadHierarchy(context, id, { signal });
  const analysisEvents = rawEvents.map(analysisEventFromRaw);
  const turns = buildTurns(rawEvents);
  const sessionForDetail = { ...sessionWithStat, status: deriveSessionStatusFromTurns(turns) };
  const trace = buildTrace(sessionForDetail, rawEvents, analysisEvents, turns, hierarchy);
  const timing = buildSessionTiming(trace);
  return {
    complete: true,
    readState: { state: "ready", code: "session_read_complete" },
    session: sessionForDetail,
    turns: compactTurnsForClient(turns),
    events: analysisEvents.map(({ payload, ...event }) => event),
    stats: sessionDetailStats(context, sessionWithStat, { stat, rawEvents, analysisEvents, turns, hierarchy }),
    trace,
    timing,
    compact: await buildCompactView(dependencies, context, { session: sessionForDetail, normalizedEvents: analysisEvents, turns, hierarchy, timing, options: { maxDepth, signal } }),
  };
}

function sessionDetailStats(context, session, { stat, rawEvents, analysisEvents, turns, hierarchy }) {
  return {
    ...summarizeSessionEvents(rawEvents), eventCount: rawEvents.length, diagnosticEventCount: analysisEvents.filter((event) => event.kind === "jsonl_parse_error").length,
    compactEventCount: analysisEvents.filter((event) => event.compact).length, turnCount: turns.length, importantEventCount: analysisEvents.filter((event) => event.important).length,
    childThreadCount: hierarchy.children.length, sizeBytes: stat?.size ?? null, source: { id: context.source.id, label: context.source.label, kind: context.source.kind },
    codexHome: context.codexHome, dataPath: session.path,
  };
}

function sessionModelWindow(context, session) {
  const catalog = context?.modelCatalog;
  if (!catalog || !session?.model) return null;
  const found = catalog.lookupWindow(session.modelProvider || "", session.model);
  return found ? { ...found, source: "pi-model-catalog" } : null;
}

async function querySessionView(dependencies, context, id, params, options = {}) {
  const projectionOptions = options.projectionOptions || {};
  const query = parseSessionViewQuery(params);
  const detail = await getSessionDetail(dependencies, context, id, { maxDepth: query.maxDepth, signal: options.signal });
  if (!detail) return null;
  const modelWindow = sessionModelWindow(context, detail.session);
  const base = { session: projectSessionForApi(detail.session, {}, projectionOptions), view: query.view, complete: detail.complete !== false, readState: detail.readState || null, stats: detail.stats, serverTime: new Date().toISOString(), ...(modelWindow ? { modelWindow } : {}) };
  if (query.view === "compact") return { ...base, compact: detail.compact };
  if (query.view === "turns") return { ...base, turns: detail.turns };
  if (query.view === "trace") return { ...base, trace: detail.trace };
  if (query.view === "timing") return { ...base, timing: detail.timing };
  return { ...base, detail };
}

async function buildCompactView(dependencies, sourceContext, { session, normalizedEvents, turns, hierarchy, timing = null, options = {} }) {
  dependencies.throwIfRequestAborted(options.signal);
  const depth = options.depth ?? 0;
  const maxDepth = options.maxDepth ?? 3;
  const childById = new Map(hierarchy.children.map((child) => [child.childThreadId, child]));
  const spawnByChildId = findSpawnAgentEvents(normalizedEvents, childById);
  const notificationByChildId = findSubagentNotifications(normalizedEvents, childById);
  const childNodes = await compactChildNodes(dependencies, sourceContext, hierarchy.children, { depth, maxDepth, spawnByChildId, notificationByChildId, signal: options.signal });
  const placed = new Set();
  const compactTurns = turns.map((turn, index) => compactTurn({ turn, index, children: hierarchy.children, nodes: childNodes, spawns: spawnByChildId, notifications: notificationByChildId, placed, turns, timing }));
  return { session: compactCompactSession(session), depth, maxDepth, turns: compactTurns, children: hierarchy.children.filter((child) => !placed.has(child.childThreadId)).map((child) => childNodes.get(child.childThreadId)).filter(Boolean) };
}

async function compactChildNodes(dependencies, sourceContext, children, state) {
  const nodes = new Map();
  for (const child of children) {
    const context = { depth: state.depth, maxDepth: state.maxDepth, spawnEvent: state.spawnByChildId.get(child.childThreadId), notificationEvent: state.notificationByChildId.get(child.childThreadId), signal: state.signal };
    nodes.set(child.childThreadId, state.depth < state.maxDepth ? await buildCompactChildNode(dependencies, sourceContext, child, context) : compactChildPlaceholder(child, { ...context, reason: "max-depth" }));
  }
  return nodes;
}

function compactTurn({ turn, index, children, nodes, spawns, notifications, placed, turns, timing }) {
  const start = toMs(turn.startedAt) ?? -Infinity;
  const end = toMs(turn.completedAt) ?? Infinity;
  const nested = children.filter((child) => {
    const time = toMs((spawns.get(child.childThreadId) || notifications.get(child.childThreadId))?.timestamp);
    if (time == null || time < start || time > end) return false;
    placed.add(child.childThreadId);
    return true;
  }).map((child) => nodes.get(child.childThreadId)).filter(Boolean);
  return compactTurnForView(turn, index, nested, { turns, timing: timing?.turns?.[index] || null });
}

async function buildCompactChildNode(dependencies, sourceContext, child, context) {
  const base = compactChildBase(child, context);
  const thread = child.thread || {};
  if (!thread.id || !thread.path) return unavailableChild(base, "missing-thread-path");
  try {
    dependencies.throwIfRequestAborted(context.signal);
    const session = await dependencies.getSessionById(sourceContext, thread.id, { signal: context.signal });
    if (!session?.path) return unavailableChild(base, "missing-session");
    const result = await sourceContext.sessionDetailCoordinator.read(session, {
      cacheKey: `compact:${sourceContext.source.id}:${thread.id}:depth=${context.depth + 1}:maxDepth=${context.maxDepth}`,
      signal: context.signal,
      derive: (events, stat, signal) => deriveCompactChild(dependencies, { context: sourceContext, threadId: thread.id, session, events, stat, parentContext: context, signal }),
    });
    return result.state === "ready" ? { ...base, session: result.value.session, turns: result.value.turns, children: result.value.children } : unavailableChild(base, result.code || result.reason || "read-limited");
  } catch (error) {
    if (isAbortError(error)) throw error;
    return unavailableChild(base, error?.message || "read-failed");
  }
}

function unavailableChild(base, unavailableReason) {
  return { ...base, unavailable: true, unavailableReason, turns: [], children: [] };
}

async function deriveCompactChild(dependencies, { context, threadId, session, events, stat, parentContext, signal }) {
  const childSession = withFileStat(session, stat);
  const hierarchy = await dependencies.getThreadHierarchy(context, threadId, { signal });
  const turns = buildTurns(events);
  const normalizedEvents = events.map(analysisEventFromRaw);
  const timing = buildSessionTiming(buildTrace(childSession, events, normalizedEvents, turns, hierarchy));
  return buildCompactView(dependencies, context, { session: childSession, normalizedEvents, turns, hierarchy, timing, options: { depth: parentContext.depth + 1, maxDepth: parentContext.maxDepth, signal } });
}