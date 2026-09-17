import { firstLine } from "./text-utils.mjs";
import { safeStringifyRedacted } from "./session-normalizer.mjs";

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
    preview: firstLine(event.preview || ""),
  };
}

function compactSubagentNotification(event) {
  const payload = subagentNotificationPayload(event);
  if (!payload) return null;
  const status = notificationStatusObject(payload);
  const state = subagentNotificationState(payload, status);
  const body = subagentNotificationBody(payload, status);
  const limited = limitText(body);
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

function limitText(value) {
  if (value == null) return { text: value, originalLength: 0, truncated: false };
  const text = String(value);
  return { text, originalLength: text.length, truncated: false };
}


function compactTraceInfo(info) {
  if (!info) return null;
  const total = info.total_token_usage || info.totalTokenUsage || info.total_tokens || null;
  const last = info.last_token_usage || info.lastTokenUsage || null;
  const contextUsage = contextUsageFromTokenInfo(info);
  return { total_token_usage: total, last_token_usage: last, context_usage: contextUsage };
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


export {
  addTruncatedField,
  compactChildBase,
  compactChildPlaceholder,
  compactCompactSession,
  compactTraceInfo,
  contextUsageForAssistantMessage,
  contextUsageFromTokenInfo,
  durationMs,
  limitText,
  parseJsonObject,
  subagentNotificationAgentIds,
  subagentNotificationPayload,
  toMs,
};
