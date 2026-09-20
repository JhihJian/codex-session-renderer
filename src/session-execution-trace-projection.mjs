import { contextUsageForAssistantMessage, contextUsageFromTokenInfo, durationMs, toMs } from "./session-projection-shared.mjs";
import { deriveSessionStatusFromTurns } from "./session-turn-projection.mjs";
import {
  compactTraceSession,
  compactTraceTurn,
  findSpawnAgentEvents,
  findSubagentNotifications,
  formatIsoForTrace,
  isDefaultTraceNodeForPayload,
  shortPathServer,
  summarizeTurnForTrace,
  traceNodeFromChildThread,
  traceNodeFromItem,
} from "./session-trace-node-projection.mjs";

// eslint-disable-next-line max-params -- trace projection consumes the raw, normalized, turn, hierarchy, and source metadata layers together.
function buildTrace(session, rawEvents, normalizedEvents, turns, hierarchy, options = {}) {
  const responseIntervals = buildInferredResponseIntervals(turns, session, options);
  const responsesByTurnIndex = groupResponsesByTurnIndex(responseIntervals);
  const rootStartedAt = turns[0]?.startedAt || session.startedAt || normalizedEvents[0]?.timestamp || null;
  const eventEndCandidates = [turns.at(-1)?.completedAt, normalizedEvents.at(-1)?.timestamp]
    .filter(Boolean)
    .sort((left, right) => (toMs(left) ?? 0) - (toMs(right) ?? 0));
  const rootEndedAt = eventEndCandidates.at(-1) || session.updatedAt || session.fileModifiedAt || null;
  const childById = new Map(hierarchy.children.map((child) => [child.childThreadId, child]));
  const spawnByChildId = findSpawnAgentEvents(normalizedEvents, childById);
  const notificationByChildId = findSubagentNotifications(normalizedEvents, childById);

  const root = {
    id: `thread:${session.id}`,
    type: "thread",
    label: session.agentNickname ? `${session.agentNickname} / ${session.agentRole || "代理"}` : "根会话",
    title: session.title || "未命名会话",
    subtitle: session.id,
    timestamp: rootStartedAt,
    completedAt: rootEndedAt,
    durationMs: durationMs(rootStartedAt, rootEndedAt),
    durationEstimated: true,
    status: deriveSessionStatusFromTurns(turns) || "unknown",
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
    const turnEndedAt = turn.completedAt || lastTurnActivityAt(turn);
    const turnNode = {
      id: `turn:${turn.id}:${turnIndex}`,
      index: turnIndex,
      type: "turn",
      label: `第 ${turnIndex + 1} 轮`,
      title: turnSummary.title,
      subtitle: [turnSummary.subtitle, formatIsoForTrace(turn.startedAt), turn.cwd ? shortPathServer(turn.cwd) : ""]
        .filter(Boolean)
        .join(" · "),
      timestamp: turn.startedAt,
      completedAt: turnEndedAt,
      durationMs: durationMs(turn.startedAt, turnEndedAt),
      durationEstimated: !turn.completedAt,
      status: turn.status || "running",
      icon: "turn",
      detail: {
        kind: "turn",
        turn: compactTraceTurn(turn, turnSummary),
      },
      children: [],
    };

    attachTurnChildren(turnNode, turn, turnIndex, {
      hierarchy,
      spawnByChildId,
      notificationByChildId,
      responsesByTurnIndex,
    });

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
  applyExecutionContextMetrics(root);

  return {
    root,
    hierarchy,
    timing: {
      startedAt: rootStartedAt,
      completedAt: rootEndedAt,
      durationMs: root.durationMs,
      estimated: true,
      responses: responseIntervals,
      inputWaits: buildInputWaitIntervals(turns),
    },
  };
}

function groupResponsesByTurnIndex(responseIntervals) {
  const map = new Map();
  for (const interval of responseIntervals) {
    const list = map.get(interval.turnIndex) || [];
    list.push(interval);
    map.set(interval.turnIndex, list);
  }
  return map;
}

// 轮次于项按时长归因：工具/子代理 + 模型回复区间 + 未归因剩余，按开始时间排序。
function attachTurnChildren(turnNode, turn, turnIndex, context) {
  const { hierarchy, spawnByChildId, notificationByChildId, responsesByTurnIndex } = context;
  for (const [itemIndex, item] of turn.items.entries()) {
    const itemNode = traceNodeFromItem(item, turnIndex, itemIndex);
    if (itemNode && isDefaultTraceNodeForPayload(itemNode)) turnNode.children.push(itemNode);
  }
  attachTurnChildThreads(turnNode, turn, hierarchy, spawnByChildId, notificationByChildId);
  attachTurnResponses(turnNode, turn, turnIndex, responsesByTurnIndex);
  appendUnattributedGapNode(turnNode);
  turnNode.children.sort(byStartTimestamp);
}

function attachTurnChildThreads(turnNode, turn, hierarchy, spawnByChildId, notificationByChildId) {
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
}

function attachTurnResponses(turnNode, turn, turnIndex, responsesByTurnIndex) {
  const turnStartMs = toMs(turn.startedAt);
  const turnEndMs = toMs(turnNode.completedAt);
  if (turnStartMs == null || turnEndMs == null || turnEndMs <= turnStartMs) return;
  const occupied = turnNode.children
    .map((node) => ({ startMs: toMs(node.timestamp), endMs: toMs(node.completedAt) }))
    .filter((span) => span.startMs != null && span.endMs != null && span.endMs > span.startMs)
    .sort((left, right) => left.startMs - right.startMs);
  const intervals = responsesByTurnIndex.get(turnIndex) || [];
  let cursor = turnStartMs;
  let segmentIndex = 0;
  for (const span of occupied) {
    if (span.startMs - cursor >= 1_000) {
      turnNode.children.push(llmSegmentTraceNode({ turn, turnIndex, segmentIndex, startMs: cursor, endMs: span.startMs, intervals }));
      segmentIndex += 1;
    }
    cursor = Math.max(cursor, span.endMs);
  }
  if (turnEndMs - cursor >= 1_000) {
    turnNode.children.push(llmSegmentTraceNode({ turn, turnIndex, segmentIndex, startMs: cursor, endMs: turnEndMs, intervals }));
  }
}

function byStartTimestamp(left, right) {
  return (toMs(left.timestamp) ?? Infinity) - (toMs(right.timestamp) ?? Infinity);
}

// 模型回复段：轮次时长扣除工具、子代理等已占用区间后的纯生成间隔，不足 1 秒不展示。
function llmSegmentTraceNode({ turn, turnIndex, segmentIndex, startMs, endMs, intervals }) {
  const overlap = pickOverlappingInterval(intervals, startMs, endMs);
  const usage = overlap?.contextUsage || {};
  const model = overlap?.model || turn.context?.model || null;
  return {
    id: `response:${turnIndex}:${segmentIndex}`,
    type: "response",
    label: "模型回复",
    title: model || "模型生成",
    timestamp: new Date(startMs).toISOString(),
    completedAt: new Date(endMs).toISOString(),
    durationMs: endMs - startMs,
    durationEstimated: true,
    status: null,
    icon: "llm",
    children: [],
    detail: {
      kind: "response",
      response: {
        model,
        responseType: nvl(overlap?.responseType),
        sourceEventIndex: nvl(overlap?.eventIndex),
        startedAt: new Date(startMs).toISOString(),
        completedAt: new Date(endMs).toISOString(),
        durationMs: endMs - startMs,
        generatedTokens: nvl(overlap?.generatedTokens),
        outputTokens: nvl(overlap?.outputTokens),
        reasoningTokens: nvl(overlap?.reasoningTokens),
        ...llmUsageProjection(overlap),
        contextPercent: nvl(usage.percent),
        contextUsed: nvl(usage.used),
        contextLimit: nvl(usage.limit),
        contextSource: overlap?.contextSource || null,
        note: "轮次内扣除工具、子代理等占用区间后的模型生成间隔。",
      },
    },
  };
}

function pickOverlappingInterval(intervals, startMs, endMs) {
  let best = null;
  let bestOverlapMs = 0;
  for (const interval of intervals) {
    const overlapMs = Math.min(endMs, interval.endMs ?? -Infinity) - Math.max(startMs, interval.startMs ?? Infinity);
    if (overlapMs > bestOverlapMs) {
      bestOverlapMs = overlapMs;
      best = interval;
    }
  }
  return best;
}

function nvl(value) {
  return value == null ? null : value;
}

function llmUsageProjection(usage) {
  return {
    inputTokens: nvl(usage?.inputTokens),
    cacheReadTokens: nvl(usage?.cacheReadTokens),
    cacheWriteTokens: nvl(usage?.cacheWriteTokens),
    totalTokens: nvl(usage?.totalTokens),
    cost: nvl(usage?.cost),
  };
}

function applyExecutionContextMetrics(root) {
  const nodes = (root.children || [])
    .flatMap((turn, turnIndex) => (turn.children || []).map((node) => ({ node, turnIndex })))
    .filter(({ node }) => node.type === "response" || node.type === "tool")
    .sort((left, right) => (
      (toMs(left.node.timestamp) ?? Infinity) - (toMs(right.node.timestamp) ?? Infinity)
      || left.turnIndex - right.turnIndex
      || executionNodeOrder(left.node) - executionNodeOrder(right.node)
    ));
  let current = null;
  for (const { node } of nodes) {
    if (node.type === "response") {
      const response = node.detail?.response || {};
      const usage = responseContextUsage(response);
      const metrics = executionContextMetrics({
        previous: current,
        usage,
        source: usage ? response.contextSource || "recorded" : "unavailable",
        resultTokens: response.generatedTokens,
        resultTokenKind: Number.isFinite(response.generatedTokens) ? "recorded" : null,
      });
      node.detail.contextMetrics = metrics;
      current = usableContextBaseline(usage) ? usage : null;
      continue;
    }
    const item = node.detail?.item || {};
    const resultTokens = estimateOutputTokens(item.output);
    const usage = estimateContextUsage(current, resultTokens);
    node.detail.contextMetrics = executionContextMetrics({
      previous: current,
      usage,
      source: usage ? "estimated" : "unavailable",
      resultTokens,
      resultTokenKind: resultTokens == null ? null : "estimated",
    });
    if (usage) current = usage;
  }
}

function executionNodeOrder(node) {
  return node.type === "response" ? 0 : 1;
}

function responseContextUsage(response) {
  if (!Number.isFinite(response.contextPercent)) return null;
  const usage = { percent: response.contextPercent };
  if (Number.isFinite(response.contextUsed)) usage.used = Math.round(response.contextUsed);
  if (Number.isFinite(response.contextLimit)) usage.limit = Math.round(response.contextLimit);
  return usage;
}

function estimateOutputTokens(output) {
  if (output == null || output === "") return null;
  return Math.max(1, Math.ceil(Buffer.byteLength(String(output), "utf8") / 4));
}

function usableContextBaseline(usage) {
  return Number.isFinite(usage?.used) && Number.isFinite(usage?.limit) && usage.limit > 0;
}

function estimateContextUsage(previous, resultTokens) {
  if (!usableContextBaseline(previous) || !Number.isFinite(resultTokens)) return null;
  const used = previous.used + resultTokens;
  return {
    used,
    limit: previous.limit,
    percent: Math.min(100, Math.round((used / previous.limit) * 1000) / 10),
  };
}

function executionContextMetrics({ previous, usage, source, resultTokens, resultTokenKind }) {
  const changePercent = Number.isFinite(usage?.percent) && Number.isFinite(previous?.percent)
    ? Math.round((usage.percent - previous.percent) * 10) / 10
    : null;
  return {
    source,
    usage,
    resultTokens: Number.isFinite(resultTokens) ? resultTokens : null,
    resultTokenKind,
    changePercent,
  };
}

// 工具、子代理与模型回复之外剩余的时间（事件写入、调度等）集中为一个节点，
// 让轮次子项时长之和与轮次执行时长对齐；剩余不足 1 秒时不展示。
function appendUnattributedGapNode(turnNode) {
  if (!Number.isFinite(turnNode.durationMs)) return;
  const accountedMs = turnNode.children.reduce(
    (sum, child) => sum + (Number.isFinite(child.durationMs) ? child.durationMs : 0),
    0,
  );
  const gapMs = turnNode.durationMs - accountedMs;
  if (gapMs < 1_000) return;
  turnNode.children.push({
    id: `gap:${turnNode.id}`,
    type: "gap",
    label: "其他时间",
    title: "事件写入与调度等未归因间隔",
    timestamp: turnNode.completedAt ?? null,
    completedAt: null,
    durationMs: gapMs,
    durationEstimated: false,
    status: null,
    icon: "gap",
    children: [],
    detail: {
      kind: "gap",
      note: "轮次执行时长减去工具、子代理和模型回复等已归因子项后的剩余间隔。",
    },
  });
}

// Pi 会话没有显式的轮次完成事件，turn.completedAt 保持为空时，用轮内最后一个
// 条目的活动时间作为轮次执行时长下界，避免执行视图整列轮次都无法显示耗时。
function lastTurnActivityAt(turn) {
  let latestMs = null;
  for (const item of turn.items || []) {
    const ms = toMs(item.completedAt || item.timestamp);
    if (ms != null && (latestMs == null || ms > latestMs)) latestMs = ms;
  }
  return latestMs == null ? null : new Date(latestMs).toISOString();
}

// Input-start telemetry is unavailable, so only use a completed assistant reply
// followed by the next turn's user message as a waiting-for-input interval.
function buildInputWaitIntervals(turns) {
  return turns.slice(0, -1).flatMap((turn, turnIndex) => {
    const nextTurn = turns[turnIndex + 1];
    const lastAssistant = [...(turn.items || [])].reverse().find((item) => item.type === "assistant-message" && toMs(item.timestamp) != null);
    const nextUser = (nextTurn?.items || []).find((item) => item.type === "user-message" && toMs(item.timestamp) != null);
    const startMs = toMs(lastAssistant?.timestamp);
    const endMs = toMs(nextUser?.timestamp);
    if (startMs == null || endMs == null || endMs <= startMs) return [];
    return [{
      id: `input-wait:${turnIndex}:${turn.id || turnIndex}`,
      turnIndex,
      startedAt: lastAssistant.timestamp,
      completedAt: nextUser.timestamp,
      startMs,
      endMs,
      durationMs: endMs - startMs,
      eventIndex: lastAssistant.sourceIndex ?? null,
      nextEventIndex: nextUser.sourceIndex ?? null,
    }];
  });
}

function buildInferredResponseIntervals(turns, session, options = {}) {
  return turns.flatMap((turn, turnIndex) => {
    const measured = measuredResponseIntervals(turn, turnIndex, session, options);
    if (measured.length) return measured;
    let previousBoundary = turn.startedAt;
    return turn.items.flatMap((item, itemIndex) => {
      if (!["reasoning", "assistant-message"].includes(item.type)) {
        previousBoundary = item.completedAt || item.timestamp || previousBoundary;
        return [];
      }
      const start = previousBoundary;
      const end = item.timestamp;
      const startMs = toMs(start);
      const endMs = toMs(end);
      previousBoundary = end || previousBoundary;
      if (startMs == null || endMs == null || endMs <= startMs) return [];
      const context = item.type === "assistant-message"
        ? assistantContextUsage(turn.items, itemIndex, options.modelContextWindow)
        : recordedContextUsage(latestContextUsage(turn.items, itemIndex));
      return [{
        id: `response:${turnIndex}:${itemIndex}`,
        turnIndex,
        startedAt: start,
        completedAt: end,
        startMs,
        endMs,
        durationMs: endMs - startMs,
        durationKind: "estimated",
        model: turn.context?.model || session.model || null,
        contextUsage: context.usage,
        contextSource: context.source,
        eventIndex: item.sourceIndex ?? null,
        responseType: item.type,
        outputTokens: null,
        reasoningTokens: null,
        generatedTokens: null,
      }];
    });
  });
}

// Codex writes token_count right after tool outputs at write time, so its usage describes the
// response that already ended at the last generated item (reasoning, assistant message, or
// function_call). Measure from the previous tool output (or turn start) to that last generated
// item instead of the token_count write timestamp, which can be milliseconds after the boundary.
function measuredResponseIntervals(turn, turnIndex, session, options = {}) {
  let pendingBoundaryMs = toMs(turn.startedAt);
  let responseStartMs = null;
  let responseEndMs = null;
  const intervals = [];
  const openResponse = (timestampMs) => {
    if (responseEndMs == null) responseStartMs = pendingBoundaryMs;
    responseEndMs = Math.max(responseEndMs ?? timestampMs, timestampMs);
  };
  const closeResponse = (usage, context, responseType, eventIndex) => {
    if (responseStartMs != null && responseEndMs != null && responseEndMs > responseStartMs) {
      intervals.push({
        id: `response:${turnIndex}:${eventIndex}`,
        turnIndex,
        startedAt: new Date(responseStartMs).toISOString(),
        completedAt: new Date(responseEndMs).toISOString(),
        startMs: responseStartMs,
        endMs: responseEndMs,
        durationMs: responseEndMs - responseStartMs,
        durationKind: "estimated",
        model: turn.context?.model || session.model || null,
        contextUsage: context.usage,
        contextSource: context.source,
        eventIndex,
        responseType,
        outputTokens: usage.outputTokens,
        reasoningTokens: usage.reasoningTokens || 0,
        generatedTokens: usage.generatedTokens,
        ...llmUsageProjection(usage),
      });
    }
    if (responseEndMs != null && (pendingBoundaryMs == null || responseEndMs > pendingBoundaryMs)) pendingBoundaryMs = responseEndMs;
    responseStartMs = null;
    responseEndMs = null;
  };
  for (const [itemIndex, item] of turn.items.entries()) {
    if (item.type === "user-message") {
      const ms = toMs(item.timestamp);
      if (ms != null) pendingBoundaryMs = ms;
      responseStartMs = null;
      responseEndMs = null;
      continue;
    }
    if (item.type === "reasoning" || item.type === "assistant-message") {
      const ms = toMs(item.timestamp);
      if (ms != null) {
        openResponse(ms);
        if (item.type === "assistant-message" && item.tokenUsage) {
          closeResponse(item.tokenUsage, assistantContextUsage(turn.items, itemIndex, options.modelContextWindow), "assistant-message", item.sourceIndex ?? null);
        }
      }
      continue;
    }
    if (item.type === "tool-call") {
      const startMs = toMs(item.timestamp);
      if (startMs != null) openResponse(startMs);
      const doneMs = toMs(item.completedAt);
      if (doneMs != null && (pendingBoundaryMs == null || doneMs > pendingBoundaryMs)) pendingBoundaryMs = doneMs;
      continue;
    }
    if (item.type === "token-count" && item.tokenUsage) {
      closeResponse(item.tokenUsage, recordedContextUsage(contextUsageFromTokenInfo(item.info) || latestContextUsage(turn.items, itemIndex)), "token-count", item.sourceIndex ?? null);
    }
  }
  return intervals;
}

function latestContextUsage(items, itemIndex) {
  for (let index = itemIndex - 1; index >= 0; index -= 1) {
    if (items[index].type === "token-count") {
      const usage = contextUsageFromTokenInfo(items[index].info);
      if (usage) return usage;
    }
  }
  return null;
}

function assistantContextUsage(items, itemIndex, modelContextWindow) {
  const recorded = contextUsageForAssistantMessage(items, itemIndex);
  if (recorded) return recordedContextUsage(recorded);
  const inputTokens = items[itemIndex]?.tokenUsage?.inputTokens;
  if (!Number.isFinite(inputTokens) || !Number.isFinite(modelContextWindow) || modelContextWindow <= 0) return { usage: null, source: null };
  const used = Math.round(inputTokens);
  const limit = Math.round(modelContextWindow);
  return {
    source: "model-estimated",
    usage: { used, limit, percent: Math.min(100, Math.round((used / limit) * 1000) / 10) },
  };
}

function recordedContextUsage(usage) {
  return { usage: usage || null, source: usage ? "recorded" : null };
}


export { buildTrace };
