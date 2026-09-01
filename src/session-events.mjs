import {
  classifyEvent,
  extractProjectedGoalObjective,
  extractTitleFromEvents,
  isImportantEvent,
  summarizeEventPreview,
  summarizeEventTitle,
  summarizeSessionEvents,
} from "./event-summary.mjs";
import {
  eventTime,
  extractContentText,
  fileTimeMs,
  firstLine,
  normalizeSlash,
  normalizeText,
  sessionIdFromFile,
  sessionStartedFromFile,
  toIso,
} from "./text-utils.mjs";
import { coalesceNormalizedEvents, normalizeSessionEvent, safeStringifyRedacted } from "./session-normalizer.mjs";
import { cleanUserMessageText, isUsefulUserMessageText } from "./user-message-cleanup.mjs";
import { classifyPiGoalUserMessages } from "./pi-goal-projection.mjs";
import {
  mergeToolOutput,
  toolArgumentsFromPayload,
  toolNameFromPayload,
  toolOutputFromPayload,
} from "./tool-events.mjs";
export { renderConversationMarkdown } from "./markdown-export.mjs";
export {
  classifyEvent,
  eventTime,
  extractContentText,
  extractProjectedGoalObjective,
  extractTitleFromEvents,
  fileTimeMs,
  firstLine,
  isImportantEvent,
  normalizeSlash,
  normalizeText,
  sessionIdFromFile,
  sessionStartedFromFile,
  summarizeEventPreview,
  summarizeEventTitle,
  summarizeSessionEvents,
  toIso,
  normalizeSessionEvent,
};

const previewLimits = {
  payload: 700,
  traceText: 160,
  traceArguments: 160,
  traceOutput: 160,
  compactMessage: 2400,
  subagentNotification: 5200,
};

function compactTurnsForClient(turns) {
  return turns.map((turn, turnIndex) => ({
    ...turn,
    turnNumber: turnIndex + 1,
    items: turn.items.map((item, itemIndex) =>
      compactItemForClient(item, turnIndex, itemIndex, {
        contextUsage: item.type === "assistant-message" ? contextUsageForAssistantMessage(turn.items, itemIndex) : null,
      }),
    ),
  }));
}

function compactItemForClient(item, turnIndex, itemIndex, options = {}) {
  const base = {
    id: item.id,
    type: item.type,
    turnIndex,
    itemIndex,
  };
  if (item.sourceIndex != null) base.sourceIndex = item.sourceIndex;
  if (item.outputSourceIndex != null) base.outputSourceIndex = item.outputSourceIndex;
  if (item.timestamp) base.timestamp = item.timestamp;
  if (item.completedAt) base.completedAt = item.completedAt;
  if (item.phase) base.phase = item.phase;
  if (item.role) base.role = item.role;
  if (item.name) base.name = item.name;
  if (item.callId) base.callId = item.callId;
  if (item.messageId) base.messageId = item.messageId;
  if (item.status) base.status = item.status;
  if (item.eventType) base.eventType = item.eventType;
  if (item.responseType) base.responseType = item.responseType;
  if (item.encrypted) base.encrypted = true;
  if (item.reasoning) {
    base.reasoning = item.reasoning;
    if (item.reasoning.encrypted) base.encrypted = true;
  }
  if (item.compact) base.compact = item.compact;
  if (item.attachments?.length) base.attachments = item.attachments;
  const info = compactTraceInfo(item.info);
  if (info) base.info = info;
  if (options.contextUsage) base.contextUsage = options.contextUsage;

  if (item.text != null) {
    const text = String(item.text);
    base.text = text;
    base.textLength = text.length;
  }
  if (item.arguments != null) {
    const args = String(item.arguments);
    base.arguments = args;
    base.argumentsLength = args.length;
  }
  if (item.output != null) {
    const output = String(item.output);
    base.output = output;
    base.outputLength = output.length;
  }
  if (item.payload != null || item.info != null) {
    const source = item.payload ?? item.info;
    const limited = limitText(safeStringifyRedacted(source, 2), previewLimits.payload);
    base.payloadPreview = limited.text;
    base.payloadLength = limited.originalLength;
    if (limited.truncated) addTruncatedField(base, "payload");
  }
  if (base.truncatedFields?.length) base.truncated = true;
  return base;
}

function compactTurnForView(turn, turnIndex, children, context = {}) {
  const turnLookup = context.turnLookup || compactReplacementTurnLookup(context.turns);
  const compressionRefsByItem = context.compressionRefsByItem || compactCompressionRefsByItem(context.turns);
  const userMessages = turn.items
    .map((item, itemIndex) =>
      item.type === "user-message" && normalizeText(item.text)
        ? compactUserMessageForView(item, { turnIndex, itemIndex, compressionRefs: compactCompressionRefsForItem(compressionRefsByItem, turnIndex, itemIndex) })
        : null,
    )
    .filter(Boolean);
  const assistantMessages = turn.items
    .map((item, itemIndex) =>
      item.type === "assistant-message" && normalizeText(item.text)
        ? compactMessageForView(item, {
            turnIndex,
            itemIndex,
            contextUsage: contextUsageForAssistantMessage(turn.items, itemIndex),
            compressionRefs: compactCompressionRefsForItem(compressionRefsByItem, turnIndex, itemIndex),
          })
        : null,
    )
    .filter(Boolean);
  const assistant = assistantMessages.at(-1) || null;
  const compactEvents = turn.items
    .filter((item) => item.type === "context-compact")
    .map((item) => compactContextEventForView(item, { turnLookup, turns: context.turns }))
    .filter(Boolean);
  return {
    id: turn.id,
    turnNumber: turnIndex + 1,
    startedAt: turn.startedAt || null,
    completedAt: turn.completedAt || null,
    status: turn.status || null,
    userMessages,
    assistantMessages,
    assistantMessage: assistant,
    compactEvents,
    children,
  };
}

function compactUserMessageForView(item, options = {}) {
  const text = cleanCompactUserText(item.text);
  if (!isUsefulCompactUserText(text)) return null;
  return compactMessageForView({ ...item, text }, options);
}

function compactMessageForView(item, options = {}) {
  const limited = limitText(item.text || "", previewLimits.compactMessage);
  const message = {
    id: item.id,
    type: item.type,
    timestamp: item.timestamp || null,
    phase: item.phase || null,
    role: item.role || null,
    text: limited.text,
    textLength: limited.originalLength,
    truncated: limited.truncated,
  };
  if (item.sourceIndex != null) message.sourceIndex = item.sourceIndex;
  if (Number.isInteger(options.turnIndex)) message.turnIndex = options.turnIndex;
  if (Number.isInteger(options.itemIndex)) message.itemIndex = options.itemIndex;
  if (item.messageId) message.messageId = item.messageId;
  if (options.contextUsage) message.contextUsage = options.contextUsage;
  if (options.compressionRefs?.length) message.compressionRefs = options.compressionRefs;
  return message;
}

function compactContextEventForView(item, context = {}) {
  const compact = item.compact || {};
  const text = item.text || compact.message || "";
  const limited = limitText(text, previewLimits.subagentNotification);
  return {
    id: item.id,
    type: item.type,
    timestamp: item.timestamp || null,
    eventType: item.eventType || compact.kind || null,
    sourceIndex: item.sourceIndex ?? null,
    text: limited.text,
    textLength: limited.originalLength,
    truncated: limited.truncated,
    compact: compactForView(compact, context),
  };
}

function compactForView(compact, context = {}) {
  const replacementHistoryPreview = Array.isArray(compact.replacementHistoryPreview)
    ? compact.replacementHistoryPreview.map((entry) => compactReplacementEntryForView(entry, context))
    : [];
  const roleCounts = compactReplacementRoleCounts(replacementHistoryPreview);
  const turnNumbers = [
    ...new Set(
      replacementHistoryPreview
        .map((entry) => entry.turnNumber)
        .filter((value) => Number.isInteger(value)),
    ),
  ].sort((left, right) => left - right);
  return {
    ...compact,
    message: undefined,
    replacementHistoryPreview,
    replacementRoleCounts: roleCounts,
    replacementTurnNumbers: turnNumbers,
  };
}

function compactReplacementTurnLookup(turns = []) {
  const lookup = new Map();
  for (const [index, turn] of (turns || []).entries()) {
    if (!turn?.id) continue;
    const user = (turn.items || []).find((item) => item.type === "user-message" && normalizeText(item.text));
    const assistant = [...(turn.items || [])].reverse().find((item) => item.type === "assistant-message" && normalizeText(item.text));
    lookup.set(turn.id, {
      turnIndex: index,
      turnNumber: index + 1,
      turnStatus: turn.status || null,
      turnStartedAt: turn.startedAt || null,
      turnCompletedAt: turn.completedAt || null,
      userPreview: user ? firstLine(cleanCompactUserText(user.text || ""), 160) : "",
      assistantPreview: assistant ? firstLine(assistant.text || "", 160) : "",
    });
  }
  return lookup;
}

function compactReplacementEntryForView(entry, context = {}) {
  const turnLookup = context.turnLookup;
  if (!entry || !turnLookup || !entry.turnId) return entry;
  const turn = turnLookup.get(entry.turnId);
  if (!turn) return entry;
  const result = {
    ...entry,
    ...turn,
  };
  const target = compactReplacementTargetForView(context.turns, entry, turn);
  if (target) result.replacementTarget = target;
  return result;
}

function compactReplacementTargetForView(turns = [], entry = {}, turn = null) {
  const target = compactReplacementTargetItem(turns, entry);
  if (!target) {
    return Number.isInteger(turn?.turnIndex)
      ? {
          turnIndex: turn.turnIndex,
          turnNumber: turn.turnNumber,
          itemIndex: null,
          ownerItemIndex: null,
          itemType: null,
          ownerItemType: null,
        }
      : null;
  }
  const ownerItemIndex = compactCompressionOwnerItemIndex(target.turn.items, target.itemIndex);
  const ownerItem = Number.isInteger(ownerItemIndex) ? target.turn.items[ownerItemIndex] : null;
  return {
    turnIndex: target.turnIndex,
    turnNumber: target.turnIndex + 1,
    itemIndex: target.itemIndex,
    ownerItemIndex: Number.isInteger(ownerItemIndex) ? ownerItemIndex : null,
    itemType: target.item?.type || null,
    ownerItemType: ownerItem?.type || null,
  };
}

function compactReplacementRoleCounts(preview) {
  const counts = {};
  for (const entry of preview || []) {
    const key = entry?.role || entry?.type || "item";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function compactCompressionRefsByItem(turns = []) {
  const refs = new Map();
  for (const [compactTurnIndex, turn] of (turns || []).entries()) {
    for (const item of turn?.items || []) {
      const preview = item.compact?.replacementHistoryPreview;
      if (item.type !== "context-compact" || !Array.isArray(preview) || preview.length === 0) continue;
      for (const entry of preview) {
        const target = compactReplacementTargetItem(turns, entry);
        if (!target) continue;
        const ownerIndex = compactCompressionOwnerItemIndex(target.turn.items, target.itemIndex);
        if (!Number.isInteger(ownerIndex)) continue;
        const ref = {
          compactTurnNumber: compactTurnIndex + 1,
          eventIndex: item.sourceIndex ?? null,
          eventType: item.eventType || item.compact?.kind || null,
          replacementIndex: entry.index ?? null,
          replacementRole: entry.role || null,
          replacementType: entry.type || null,
          replacementItemType: target.item?.type || null,
          windowNumber: item.compact?.windowNumber ?? null,
          timestamp: item.timestamp || null,
          summaryPreview: firstLine(item.text || item.compact?.message || "", 140),
          replacementPreview: firstLine(entry.preview || "", 140),
        };
        const key = compactCompressionItemKey(target.turnIndex, ownerIndex);
        const existing = refs.get(key) || [];
        if (!existing.some((candidate) => candidate.eventIndex === ref.eventIndex && candidate.replacementIndex === ref.replacementIndex)) {
          existing.push(ref);
        }
        refs.set(key, existing);
      }
    }
  }
  return refs;
}

function compactCompressionRefsForItem(refsByItem, turnIndex, itemIndex) {
  if (!refsByItem || !Number.isInteger(turnIndex) || !Number.isInteger(itemIndex)) return [];
  return refsByItem.get(compactCompressionItemKey(turnIndex, itemIndex)) || [];
}

function compactCompressionItemKey(turnIndex, itemIndex) {
  return `${turnIndex}:${itemIndex}`;
}

function compactReplacementTargetItem(turns = [], entry = {}) {
  if (!entry?.turnId) return null;
  const turnIndex = turns.findIndex((turn) => turn?.id === entry.turnId);
  if (turnIndex < 0) return null;
  const turn = turns[turnIndex];
  const itemIndex = compactReplacementTargetItemIndex(turn.items || [], entry);
  if (!Number.isInteger(itemIndex)) return null;
  return { turn, turnIndex, itemIndex, item: turn.items[itemIndex] };
}

function compactReplacementTargetItemIndex(items = [], entry = {}) {
  const messageId = normalizeText(entry.messageId);
  if (messageId) {
    const index = items.findIndex((item) => item.messageId === messageId || item.id === messageId);
    if (index >= 0) return index;
  }

  const callId = normalizeText(entry.callId);
  if (callId) {
    const index = items.findIndex((item) => item.callId === callId || item.id === callId);
    if (index >= 0) return index;
  }

  const candidates = compactReplacementCandidateIndexes(items, entry);
  if (!candidates.length) return null;
  const preview = normalizeText(entry.preview).toLowerCase();
  if (preview) {
    const matched = candidates.find((index) => compactReplacementItemSearchText(items[index]).includes(preview) || preview.includes(firstLine(compactReplacementItemSearchText(items[index]), 80)));
    if (Number.isInteger(matched)) return matched;
  }
  if (candidates.length === 1) return candidates[0];

  const timestamp = toMs(entry.timestamp);
  if (timestamp != null) {
    const before = [...candidates].reverse().find((index) => {
      const itemTime = toMs(items[index]?.timestamp);
      return itemTime != null && itemTime <= timestamp;
    });
    if (Number.isInteger(before)) return before;
  }

  const role = String(entry.role || "").toLowerCase();
  if (role === "assistant") return candidates.at(-1);
  return candidates[0];
}

function compactReplacementCandidateIndexes(items = [], entry = {}) {
  const role = String(entry.role || "").toLowerCase();
  const type = String(entry.type || "").toLowerCase();
  const contentKinds = Array.isArray(entry.contentKinds) ? entry.contentKinds.map((kind) => String(kind).toLowerCase()) : [];

  return items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => {
      if (role === "user") return item.type === "user-message";
      if (role === "assistant") return item.type === "assistant-message";
      if (role === "tool") return item.type === "tool-call";
      if (/function|tool|call/.test(type) || contentKinds.some((kind) => /tool|function|call/.test(kind))) return item.type === "tool-call";
      if (/reasoning/.test(type)) return item.type === "reasoning";
      return item.type === "user-message" || item.type === "assistant-message" || item.type === "tool-call" || item.type === "reasoning";
    })
    .map(({ index }) => index);
}

function compactReplacementItemSearchText(item = {}) {
  return [item.text, item.arguments, item.output, item.name, item.callId, item.messageId].filter(Boolean).join(" ").toLowerCase();
}

function compactCompressionOwnerItemIndex(items = [], itemIndex) {
  const item = items[itemIndex];
  if (!item) return null;
  if (item.type === "user-message" || item.type === "assistant-message") return itemIndex;
  const previousAssistant = items
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate, index }) => index <= itemIndex && candidate.type === "assistant-message" && normalizeText(candidate.text))
    .at(-1);
  if (previousAssistant) return previousAssistant.index;
  const nextAssistant = items.findIndex((candidate, index) => index > itemIndex && candidate.type === "assistant-message" && normalizeText(candidate.text));
  return nextAssistant >= 0 ? nextAssistant : null;
}

function contextUsageForAssistantMessage(items = [], assistantIndex) {
  const nextAssistantIndex = items.findIndex((item, index) => index > assistantIndex && item.type === "assistant-message");
  const after = items.find(
    (item, index) =>
      index > assistantIndex &&
      (nextAssistantIndex < 0 || index < nextAssistantIndex) &&
      item.type === "token-count" &&
      contextUsageFromTokenInfo(item.info),
  );
  const source =
    after ||
    [...items]
      .slice(0, assistantIndex)
      .reverse()
      .find((item) => item.type === "token-count" && contextUsageFromTokenInfo(item.info));
  return source ? contextUsageFromTokenInfo(source.info) : null;
}

function contextUsageFromTokenInfo(info) {
  if (!info || typeof info !== "object") return null;
  const sources = tokenInfoSources(info);
  const usageSources = tokenUsageSources(info);
  const directPercent = firstNumericField(sources, [
    "context_percent",
    "contextPercent",
    "context_usage_percent",
    "contextUsagePercent",
    "context_window_percent",
    "contextWindowPercent",
    "percent",
    "percentage",
  ]);
  const used = firstNumericField(sources, [
    "context_used",
    "contextUsed",
  ]) ?? firstNumericField(usageSources, [
    "context_used",
    "contextUsed",
    "used_tokens",
    "usedTokens",
    "tokens_used",
    "tokensUsed",
    "total_tokens",
    "totalTokens",
    "tokens",
  ]) ?? tokenTotalFromSources(usageSources);
  const limit = firstNumericField(sources, [
    "context_window",
    "contextWindow",
    "context_window_tokens",
    "contextWindowTokens",
    "max_context",
    "maxContext",
    "max_context_tokens",
    "maxContextTokens",
    "model_context_window",
    "modelContextWindow",
    "context_length",
    "contextLength",
    "token_limit",
    "tokenLimit",
    "max_tokens",
    "maxTokens",
  ]);
  const percent = normalizeContextPercent(directPercent, used, limit);
  if (percent == null) return null;
  const usage = { percent };
  if (Number.isFinite(used)) usage.used = Math.round(used);
  if (Number.isFinite(limit)) usage.limit = Math.round(limit);
  return usage;
}

function tokenInfoSources(info) {
  return [
    info,
    info.total_token_usage,
    info.totalTokenUsage,
    info.last_token_usage,
    info.lastTokenUsage,
    info.context_usage,
    info.contextUsage,
    info.usage,
    info.token_usage,
    info.tokenUsage,
    info.context,
  ].filter((value) => value && typeof value === "object");
}

function tokenUsageSources(info) {
  return [
    info.last_token_usage,
    info.lastTokenUsage,
    info.context_usage,
    info.contextUsage,
    info.usage,
    info.token_usage,
    info.tokenUsage,
    info.context,
    info,
    info.total_token_usage,
    info.totalTokenUsage,
  ].filter((value) => value && typeof value === "object");
}

function firstNumericField(sources, keys) {
  for (const source of sources) {
    for (const key of keys) {
      const value = numericValue(source[key]);
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
}

function tokenTotalFromSources(sources) {
  for (const source of sources) {
    const input = numericValue(source.input_tokens ?? source.inputTokens ?? source.prompt_tokens ?? source.promptTokens);
    const output = numericValue(source.output_tokens ?? source.outputTokens ?? source.completion_tokens ?? source.completionTokens);
    if (Number.isFinite(input) || Number.isFinite(output)) return (Number.isFinite(input) ? input : 0) + (Number.isFinite(output) ? output : 0);
  }
  return null;
}

function normalizeContextPercent(percent, used, limit) {
  let value = numericValue(percent);
  if (Number.isFinite(value)) {
    if (value > 0 && value <= 1) value *= 100;
    return clampContextPercent(value);
  }
  const usedTokens = numericValue(used);
  const limitTokens = numericValue(limit);
  if (!Number.isFinite(usedTokens) || !Number.isFinite(limitTokens) || limitTokens <= 0) return null;
  return clampContextPercent((usedTokens / limitTokens) * 100);
}

function clampContextPercent(value) {
  if (!Number.isFinite(value)) return null;
  if (value <= 0) return 1;
  return Math.max(1, Math.min(100, Math.round(value)));
}

function numericValue(value) {
  if (value == null || value === "") return null;
  const number = typeof value === "string" ? Number(value.replace(/,/g, "")) : Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanCompactUserText(text) {
  return cleanUserMessageText(text);
}

function isUsefulCompactUserText(text) {
  return isUsefulUserMessageText(text);
}

function compactChildBase(child, context) {
  const thread = child.thread || {};
  return {
    id: child.childThreadId,
    edgeStatus: child.status || null,
    depth: context.depth + 1,
    spawnEvent: compactCompactEvent(context.spawnEvent),
    notificationEvent: compactCompactEvent(context.notificationEvent),
    notificationSummary: compactSubagentNotification(context.notificationEvent),
    session: compactCompactSession(thread),
  };
}

function compactChildPlaceholder(child, context) {
  return {
    ...compactChildBase(child, { ...context, depth: context.depth ?? 0 }),
    unavailable: true,
    unavailableReason: context.reason || "not-loaded",
    turns: [],
    children: [],
  };
}

function compactCompactSession(session) {
  if (!session) return null;
  return {
    id: session.id,
    title: session.title || "未命名会话",
    cwd: session.cwd || null,
    model: session.model || null,
    reasoningEffort: session.reasoningEffort || null,
    agentNickname: session.agentNickname || null,
    agentRole: session.agentRole || null,
    startedAt: session.startedAt || null,
    updatedAt: session.updatedAt || null,
    relativePath: session.relativePath || null,
  };
}

function compactCompactEvent(event) {
  if (!event) return null;
  return {
    index: event.index,
    timestamp: event.timestamp,
    kind: event.kind,
    title: event.title,
    preview: firstLine(event.preview || "", 220),
  };
}

function compactSubagentNotification(event) {
  const payload = subagentNotificationPayload(event);
  if (!payload) return null;
  const status = notificationStatusObject(payload);
  const state = subagentNotificationState(payload, status);
  const body = subagentNotificationBody(payload, status);
  const limited = limitText(body, previewLimits.subagentNotification);
  const summary = {
    state,
    label: subagentNotificationStateLabel(state),
    timestamp: event?.timestamp || null,
    eventIndex: event?.index ?? null,
    agentId: subagentNotificationAgentIds(payload)[0] || null,
    body: limited.text,
    bodyLength: limited.originalLength,
    truncated: limited.truncated,
  };
  return summary;
}

function subagentNotificationPayload(event) {
  if (!event) return null;
  const payload = event.payload && typeof event.payload === "object" ? event.payload : null;
  if (isSubagentNotificationPayload(payload)) return payload;
  const candidates = [
    event.text,
    event.preview,
    payload?.message,
    payload?.text,
    payload?.value,
    typeof payload?.content === "string" ? payload.content : null,
  ];
  for (const candidate of candidates) {
    const parsed = parseSubagentNotificationText(candidate);
    if (parsed) return parsed;
  }
  return null;
}

function parseSubagentNotificationText(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const direct = parseJsonObject(text);
  if (isSubagentNotificationPayload(direct)) return direct;
  const wrapped = text.match(/<subagent_notification>\s*([\s\S]*?)\s*<\/subagent_notification>/i);
  if (!wrapped) return null;
  const parsed = parseJsonObject(wrapped[1].trim());
  return isSubagentNotificationPayload(parsed) ? parsed : null;
}

function isSubagentNotificationPayload(payload) {
  return Boolean(
    payload &&
      typeof payload === "object" &&
      (payload.type === "subagent_notification" ||
        payload.agent_path ||
        payload.agentPath ||
        payload.agent_id ||
        payload.agentId ||
        payload.thread_id ||
        payload.threadId),
  );
}

function notificationStatusObject(payload) {
  const status = payload?.status;
  return status && typeof status === "object" && !Array.isArray(status) ? status : {};
}

function subagentNotificationAgentIds(payload) {
  return [
    payload?.agent_path,
    payload?.agentPath,
    payload?.agent_id,
    payload?.agentId,
    payload?.thread_id,
    payload?.threadId,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function subagentNotificationState(payload, status) {
  const statusText = [
    payload?.status,
    payload?.state,
    payload?.phase,
    status.state,
    status.status,
    status.phase,
  ]
    .filter((value) => value != null && typeof value !== "object")
    .join(" ");
  if (status.completed != null || payload?.completed != null || /completed|done|success|succeeded|完成|成功/i.test(statusText)) return "completed";
  if (
    status.failed != null ||
    status.error != null ||
    payload?.failed != null ||
    payload?.error != null ||
    /failed|failure|error|cancelled|canceled|aborted|失败|错误|取消|中断/i.test(statusText)
  ) {
    return "failed";
  }
  if (/running|pending|started|in[-_ ]?progress|waiting|运行|等待|处理中/i.test(statusText)) return "running";
  return "unknown";
}

function subagentNotificationStateLabel(state) {
  if (state === "completed") return "已完成";
  if (state === "failed") return "失败";
  if (state === "running") return "运行中";
  return "状态通知";
}

function subagentNotificationBody(payload, status) {
  return firstNotificationText(
    status.completed,
    status.failed,
    status.error,
    status.message,
    status.summary,
    payload?.completed,
    payload?.failed,
    payload?.error,
    payload?.message,
    payload?.summary,
    payload?.output,
    payload?.result,
  );
}

function firstNotificationText(...values) {
  for (const value of values) {
    const text = notificationValueText(value);
    if (text) return text;
  }
  return "";
}

function notificationValueText(value) {
  if (value == null || value === false) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") return safeStringifyRedacted(value, 2);
  return "";
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
    },
  };
}

function buildInferredResponseIntervals(turns, session) {
  return turns.flatMap((turn, turnIndex) => {
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
      }];
    });
  });
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

function isDefaultTraceNodeForPayload(node) {
  return ["tool", "handoff", "subagent", "lazy-child"].includes(node.type);
}

function assistantPhaseLabel(phase) {
  switch (phase) {
    case "final":
    case "final_answer":
      return "最终回复";
    case "delta":
      return "增量回复";
    case "message":
      return "消息";
    default:
      return phase ? `阶段：${phase}` : "";
  }
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
      label: "用户消息",
      title: firstLine(item.text || "用户消息", 80),
      subtitle: formatIsoForTrace(item.timestamp),
    };
  }
  if (item.type === "assistant-message") {
    return {
      ...base,
      type: "message",
      icon: "assistant",
      label: item.phase === "final" || item.phase === "final_answer" ? "最终回复" : "助手回复",
      title: firstLine(item.text || "助手消息", 80),
      subtitle: [assistantPhaseLabel(item.phase), formatIsoForTrace(item.timestamp)].filter(Boolean).join(" · "),
    };
  }
  if (item.type === "tool-call") {
    const isHandoff = ["spawn_agent", "wait_agent", "handoff"].includes(item.name);
    return {
      ...base,
      type: isHandoff ? "handoff" : "tool",
      icon: isHandoff ? "handoff" : "tool",
      label: isHandoff ? "委派" : "工具调用",
      title: item.name || item.callId || "未知工具",
      subtitle: [item.status, formatIsoForTrace(item.timestamp)].filter(Boolean).join(" · "),
    };
  }
  if (item.type === "reasoning") {
    return {
      ...base,
      type: "reasoning",
      icon: "reasoning",
      label: "推理",
      title: item.text ? firstLine(item.text, 80) : item.encrypted ? "推理内容已加密存储" : "无明文摘要",
      subtitle: item.encrypted ? "已加密" : "摘要",
    };
  }
  if (item.type === "token-count") {
    return {
      ...base,
      type: "metric",
      icon: "metric",
      label: "上下文占用",
      title: "上下文占用统计",
      subtitle: formatIsoForTrace(item.timestamp),
    };
  }
  if (item.type === "event" || item.type === "response-item") {
    return {
      ...base,
      type: "event",
      icon: "event",
      label: item.eventType || item.responseType || "事件",
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
    label: `子代理：${thread.agentNickname || child.childThreadId}`,
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
        label: "子会话",
        title: "点击子代理节点加载完整会话",
        subtitle: thread.relativePath || "",
        timestamp: null,
        completedAt: null,
        durationMs: null,
        durationEstimated: false,
        status: "按需加载",
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
    title: session.title || "未命名会话",
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
    sourceIndex: item.sourceIndex ?? null,
    outputSourceIndex: item.outputSourceIndex ?? null,
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
  const contextUsage = contextUsageFromTokenInfo(info);
  return { total_token_usage: total, last_token_usage: last, context_usage: contextUsage };
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
    const payload = subagentNotificationPayload(event);
    if (payload) {
      let matched = false;
      for (const childId of subagentNotificationAgentIds(payload)) {
        if (childById.has(childId)) {
          byChild.set(childId, event);
          matched = true;
        }
      }
      if (matched) continue;
    }
    const preview = String(event.preview || "");
    const payloadText = JSON.stringify(event.payload || {});
    const text = `${preview}\n${payloadText}`;
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
  const item = {
    id: callId,
    type: "tool-call",
    sourceIndex,
    timestamp: event.timestamp,
    name: event.toolName || toolNameFromPayload(payload),
    callId,
    status: payload.status || "started",
    arguments: event.toolInput ?? toolArgumentsFromPayload(payload),
    output: null,
  };
  activeCall.set(callId, item);
  turn.items.push(item);
}

function registerEmbeddedToolCall(turn, activeCall, event, toolCall, sourceIndex) {
  const callId = toolCall.callId || `${event.messageId || sourceIndex}:tool-${turn.items.length}`;
  const item = {
    id: callId,
    type: "tool-call",
    sourceIndex,
    timestamp: event.timestamp,
    name: toolCall.name || "tool",
    callId,
    status: "started",
    arguments: toolCall.arguments ?? null,
    output: null,
  };
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
    return;
  }

  turn.items.push({
    id: callId,
    type: "tool-call",
    sourceIndex,
    timestamp: event.timestamp,
    name: event.toolName || toolNameFromPayload(payload),
    callId,
    status: payload.status || (payload.success === false ? "failed" : "completed"),
    arguments: event.toolInput ?? toolArgumentsFromPayload(payload),
    output,
  });
}

export {
  buildTrace,
  buildTurns,
  compactChildBase,
  compactChildPlaceholder,
  compactCompactSession,
  compactTurnsForClient,
  compactTurnForView,
  deriveSessionStatusFromEvents,
  deriveSessionStatusFromTurns,
  findSpawnAgentEvents,
  findSubagentNotifications,
  limitText,
  parseJsonObject,
  toMs,
};
