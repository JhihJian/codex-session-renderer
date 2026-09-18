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
      responses: buildInferredResponseIntervals(turns, session),
      inputWaits: buildInputWaitIntervals(turns),
    },
  };
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
