import { eventTime, normalizeText } from "./text-utils.mjs";
import { coalesceNormalizedEvents } from "./session-normalizer.mjs";
import { cleanUserMessageText, isUsefulUserMessageText } from "./user-message-cleanup.mjs";
import { classifyPiGoalUserMessages } from "./pi-goal-projection.mjs";
import { piEmbeddedSubagentCall, piEmbeddedSubagentResult } from "./embedded-subagents.mjs";
import { piSkillDeclarationFromEvent, piSkillReadFromToolCall } from "./pi-context-events.mjs";
import {
  mergeToolOutput,
  toolArgumentsFromPayload,
  toolNameFromPayload,
  toolOutputFromPayload,
} from "./tool-events.mjs";

function buildTurns(events) {
  const goalProjections = classifyPiGoalUserMessages(events);
  const normalizedEvents = suppressForkReplayPrefix(coalesceNormalizedEvents(events));
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

  for (const [eventIndex, event] of normalizedEvents.entries()) {
    const sourceIndex = event.index ?? eventIndex;
    const payload = event.payload ?? {};
    const isUserMessage = isUserMessageEvent(event);
    const isAssistantMessage = isAssistantMessageEvent(event);
    const goalProjection = goalProjections.get(sourceIndex);
    if (goalProjection?.kind === "suppress-state") continue;
    if (event.kind === "meta" || event.semanticKind === "meta") continue;
    if (isUserMessage && goalProjection?.kind === "suppress") continue;
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
    if (current && isUserMessage && shouldStartNewImplicitUserTurn(current, event)) {
      current = null;
      activeCall = new Map();
    }
    if (event.kind === "context") {
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
    if (!current && payload.type === "turn_aborted") ensureTurn(event);
    if (!current && event.compact) ensureTurn(event);
    if (!current && shouldStartImplicitTurn(event)) ensureTurn(event);
    if (!current) continue;

    if (event.semanticKind === "diagnostic") {
      current.items.push({
        id: `item-${current.items.length}`,
        type: "event",
        sourceIndex,
        timestamp: event.timestamp,
        eventType: event.kind,
        payload,
      });
      continue;
    }

    if (isUserMessage) {
      const projectedGoalObjective = goalProjection?.kind === "objective";
      const text = projectedGoalObjective ? goalProjection.text : cleanUserMessageText(event.text);
      const skillDeclaration = piSkillDeclarationFromEvent(event);
      if (!event.attachments?.length && (projectedGoalObjective ? !String(text).trim() : !isUsefulUserMessageText(text))) continue;
      if (!event.attachments?.length && isKnownUserEcho(current, event, text)) continue;
      current.items.push({
        id: `item-${current.items.length}`,
        type: "user-message",
        sourceIndex,
        timestamp: event.timestamp,
        text,
        attachments: event.attachments,
        messageId: event.messageId,
        eventKind: event.kind,
        rawType: event.rawType,
        projectedGoalObjective,
        skillDeclaration,
      });
      continue;
    }

    if (isAssistantMessage) {
      if (event.attachments?.length || !isDuplicateAssistantMessage(current, event.text)) {
        current.items.push({
          id: `item-${current.items.length}`,
          type: "assistant-message",
          sourceIndex,
          timestamp: event.timestamp,
          phase: payload.phase ?? null,
          text: event.text ?? "",
          attachments: event.attachments,
          messageId: event.messageId,
          tokenUsage: event.tokenUsage,
        });
      }
      for (const toolCall of event.toolCalls || []) registerEmbeddedToolCall(current, activeCall, event, toolCall, sourceIndex);
      continue;
    }

    if (payload.type === "token_count") {
      current.items.push({
        id: `item-${current.items.length}`,
        type: "token-count",
        sourceIndex,
        timestamp: event.timestamp,
        info: payload.info ?? {},
        tokenUsage: event.tokenUsage,
      });
      continue;
    }

    if (event.semanticKind === "tool_call") {
      registerToolCall(current, activeCall, event, sourceIndex);
      continue;
    }

    if (event.semanticKind === "tool_result") {
      registerToolOutput(current, activeCall, event, sourceIndex);
      continue;
    }

    if (payload.type === "task_complete" || payload.type === "task_failed") {
      current.completedAt = event.timestamp;
      current.status = payload.type === "task_failed" ? "failed" : "completed";
      if (payload.last_agent_message && !hasAssistantMessage(current, payload.last_agent_message)) {
        current.items.push({
          id: `item-${current.items.length}`,
          type: "assistant-message",
          sourceIndex,
          timestamp: event.timestamp,
          phase: "final",
          text: payload.last_agent_message,
        });
      }
      continue;
    }

    if (payload.type === "turn_aborted") {
      current.completedAt = event.timestamp;
      current.status = "aborted";
      continue;
    }

    if (event.semanticKind === "reasoning") {
      current.items.push({
        id: `item-${current.items.length}`,
        type: "reasoning",
        sourceIndex,
        timestamp: event.timestamp,
        text: event.reasoning?.summary || event.text || "",
        encrypted: Boolean(event.reasoning?.encrypted),
        reasoning: event.reasoning,
      });
      continue;
    }

    if (event.compact) {
      current.items.push({
        id: `item-${current.items.length}`,
        type: "context-compact",
        sourceIndex,
        timestamp: event.timestamp,
        eventType: event.kind,
        text: event.compact.message || event.text || "",
        compact: event.compact,
        payload,
      });
      continue;
    }

    current.items.push({
      id: `item-${current.items.length}`,
      type: event.rawType === "response_item" ? "response-item" : "event",
      sourceIndex,
      timestamp: event.timestamp,
      eventType: payload.type ?? event.kind ?? "event",
      responseType: payload.type ?? event.kind ?? "response",
      payload,
      attachments: event.attachments,
    });
  }

  for (const turn of turns) inferOpenTurnStatus(turn);
  dedupeAbortedResumeUserPrompts(turns);
  return turns.filter((turn) => turn.items.length > 0 || turn.context || turn.status === "aborted");
}

function shouldStartImplicitTurn(event) {
  const payloadType = event.payload?.type;
  return event.rawType === "event_msg" || event.rawType === "response_item" || payloadType === "user_message" || payloadType === "turn_aborted" || event.compact || event.semanticKind === "message" || event.semanticKind === "tool_call" || event.semanticKind === "tool_result" || event.semanticKind === "diagnostic";
}

function isUserMessageEvent(event) {
  return event.kind === "user_message" || (event.semanticKind === "message" && event.role === "user");
}

function isAssistantMessageEvent(event) {
  return event.kind === "agent_message" || (event.semanticKind === "message" && event.role === "assistant");
}

function shouldStartNewImplicitUserTurn(current, event) {
  if (!current || event.payload?.turn_id) return false;
  if (current.items.length === 0) return false;
  if (current.status !== "running") return true;
  return current.items.some((item) => item.type === "assistant-message" || item.type === "tool-call" || item.type === "reasoning");
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

function isKnownUserEcho(turn, event, text) {
  const normalized = normalizeText(text);
  if (!normalized) return true;
  return turn.items.some((item) => item.type === "user-message" && normalizeText(item.text) === normalized && isUserEchoPair(item, event));
}

function isUserEchoPair(item, event) {
  if (item.messageId && event.messageId && item.messageId === event.messageId) return true;
  const eventRawType = event.rawType || "";
  const itemRawType = item.rawType || "";
  const eventKind = event.kind || "";
  const itemKind = item.eventKind || "";
  if (itemRawType === eventRawType) return false;
  return (
    (itemKind === "user_message" && eventRawType === "response_item") ||
    (eventKind === "user_message" && itemRawType === "response_item") ||
    (itemRawType === "event_msg" && eventRawType === "response_item") ||
    (itemRawType === "response_item" && eventRawType === "event_msg")
  );
}

function inferOpenTurnStatus(turn) {
  if (!turn || turn.status !== "running") return;
  if (hasPendingWaitAgent(turn)) {
    turn.status = "waiting";
    return;
  }
  const last = [...turn.items].reverse().find((item) => !["reasoning", "token-count"].includes(item.type));
  if (last?.type === "assistant-message") turn.status = "waiting";
}

function hasPendingWaitAgent(turn) {
  return turn.items.some(
    (item) =>
      item.type === "tool-call" &&
      ["wait_agent", "handoff"].includes(item.name) &&
      item.output == null &&
      !["completed", "failed"].includes(item.status),
  );
}

function dedupeAbortedResumeUserPrompts(turns) {
  for (let index = 0; index < turns.length - 1; index += 1) {
    const turn = turns[index];
    if (turn.status !== "aborted") continue;
    if (turn.items.some((item) => item.type !== "user-message")) continue;
    const nextUser = turns[index + 1].items.find((item) => item.type === "user-message");
    if (!nextUser) continue;
    turn.items = turn.items.filter((item) => normalizeText(item.text) !== normalizeText(nextUser.text));
  }
}

function suppressForkReplayPrefix(events) {
  const firstTaskStart = events.findIndex((event) => event.payload?.type === "task_started");
  if (firstTaskStart <= 0) return events;
  const prefix = events.slice(0, firstTaskStart).filter((event) => event.kind !== "meta" && event.semanticKind !== "meta" && event.kind !== "context");
  if (prefix.length === 0) return events;
  const userCount = prefix.filter((event) => event.kind === "user_message" || (event.semanticKind === "message" && event.role === "user")).length;
  const hasReplayTranscript = prefix.some(isReplayTranscriptEvent) || userCount > 1;
  return hasReplayTranscript ? events.slice(firstTaskStart) : events;
}

function isReplayTranscriptEvent(event) {
  const payloadType = event.payload?.type;
  return (
    event.role === "assistant" ||
    event.semanticKind === "tool_call" ||
    event.semanticKind === "tool_result" ||
    event.semanticKind === "reasoning" ||
    payloadType === "task_complete" ||
    payloadType === "task_failed" ||
    payloadType === "turn_aborted"
  );
}

function deriveSessionStatusFromTurns(turns) {
  return [...(turns || [])].reverse().find((turn) => turn.status)?.status || null;
}

function deriveSessionStatusFromEvents(events) {
  return deriveSessionStatusFromTurns(buildTurns(events));
}

function registerToolCall(turn, activeCall, event, sourceIndex) {
  const payload = event.payload ?? {};
  const callId = event.callId || payload.call_id || `item-${turn.items.length}`;
  const argumentsText = event.toolInput ?? toolArgumentsFromPayload(payload);
  const item = {
    id: callId,
    type: "tool-call",
    sourceIndex,
    timestamp: event.timestamp,
    name: event.toolName || toolNameFromPayload(payload),
    callId,
    status: payload.status || "started",
    arguments: argumentsText,
    output: null,
  };
  item.skillRead = piSkillReadFromToolCall(item.name, argumentsText);
  activeCall.set(callId, item);
  turn.items.push(item);
}

function registerEmbeddedToolCall(turn, activeCall, event, toolCall, sourceIndex) {
  const callId = toolCall.callId || `${event.messageId || sourceIndex}:tool-${turn.items.length}`;
  const argumentsText = toolCall.arguments ?? null;
  const item = {
    id: callId,
    type: "tool-call",
    sourceIndex,
    timestamp: event.timestamp,
    name: toolCall.name || "tool",
    callId,
    status: "started",
    arguments: argumentsText,
    output: null,
  };
  item.skillRead = piSkillReadFromToolCall(item.name, argumentsText);
  if (item.name === "subagent") item.embeddedSubagents = piEmbeddedSubagentCall(item.arguments);
  activeCall.set(callId, item);
  turn.items.push(item);
}

function registerToolOutput(turn, activeCall, event, sourceIndex) {
  const payload = event.payload ?? {};
  const callId = event.callId || payload.call_id || `item-${turn.items.length}`;
  const target = activeCall.get(callId);
  const output = event.toolOutput ?? toolOutputFromPayload(payload);
  if (target) {
    target.output = mergeToolOutput(target.output, output);
    target.status = payload.status || (payload.success === false ? "failed" : "completed");
    target.completedAt = event.timestamp;
    target.outputSourceIndex = sourceIndex;
    if (target.embeddedSubagents) target.embeddedSubagents = piEmbeddedSubagentResult(target.embeddedSubagents, event.raw, output);
    return;
  }

  const argumentsText = event.toolInput ?? toolArgumentsFromPayload(payload);
  const item = {
    id: callId,
    type: "tool-call",
    sourceIndex,
    timestamp: event.timestamp,
    name: event.toolName || toolNameFromPayload(payload),
    callId,
    status: payload.status || (payload.success === false ? "failed" : "completed"),
    arguments: argumentsText,
    output,
  };
  item.skillRead = piSkillReadFromToolCall(item.name, argumentsText);
  turn.items.push(item);
}


export { buildTurns, deriveSessionStatusFromEvents, deriveSessionStatusFromTurns };
