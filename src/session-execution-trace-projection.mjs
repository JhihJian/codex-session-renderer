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

function buildTrace(session, rawEvents, normalizedEvents, turns, hierarchy) {
  const responseIntervals = buildInferredResponseIntervals(turns, session);
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
        startedAt: new Date(startMs).toISOString(),
        completedAt: new Date(endMs).toISOString(),
        durationMs: endMs - startMs,
        generatedTokens: nvl(overlap?.generatedTokens),
        outputTokens: nvl(overlap?.outputTokens),
        reasoningTokens: nvl(overlap?.reasoningTokens),
        contextPercent: nvl(usage.percent),
        contextUsed: nvl(usage.used),
        contextLimit: nvl(usage.limit),
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

function buildInferredResponseIntervals(turns, session) {
  return turns.flatMap((turn, turnIndex) => {
    const measured = measuredResponseIntervals(turn, turnIndex, session);
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
      const contextUsage = item.type === "assistant-message" ? contextUsageForAssistantMessage(turn.items, itemIndex) : latestContextUsage(turn.items, itemIndex);
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
        contextUsage,
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
function measuredResponseIntervals(turn, turnIndex, session) {
  let pendingBoundaryMs = toMs(turn.startedAt);
  let responseStartMs = null;
  let responseEndMs = null;
  const intervals = [];
  const openResponse = (timestampMs) => {
    if (responseEndMs == null) responseStartMs = pendingBoundaryMs;
    responseEndMs = Math.max(responseEndMs ?? timestampMs, timestampMs);
  };
  const closeResponse = (usage, contextUsage, responseType, eventIndex) => {
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
        contextUsage,
        eventIndex,
        responseType,
        outputTokens: usage.outputTokens,
        reasoningTokens: usage.reasoningTokens || 0,
        generatedTokens: usage.generatedTokens,
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
          closeResponse(item.tokenUsage, contextUsageForAssistantMessage(turn.items, itemIndex), "assistant-message", item.sourceIndex ?? null);
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
      closeResponse(item.tokenUsage, latestContextUsage(turn.items, itemIndex), "token-count", item.sourceIndex ?? null);
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


export { buildTrace };
