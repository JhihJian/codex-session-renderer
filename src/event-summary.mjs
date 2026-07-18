import { extractContentText, firstLine } from "./text-utils.mjs";
import { isToolCallOutput, isToolCallStart, toolNameFromPayload } from "./tool-events.mjs";
import { normalizeSessionEvent, redactSensitiveText } from "./session-normalizer.mjs";
import { cleanUserMessageText } from "./user-message-cleanup.mjs";
import { classifyPiGoalUserMessages } from "./pi-goal-projection.mjs";

function extractTitleFromEvents(events, fallback) {
  const goalProjections = classifyPiGoalUserMessages(events);
  for (const event of events) {
    if (event?.type === "session_info" && event.name) return firstLine(event.name, 90);
  }
  for (const [index, event] of events.entries()) {
    const normalized = normalizeSessionEvent(event, event?.index ?? index);
    const goalProjection = goalProjections.get(event?.index ?? index);
    if (normalized.kind === "user_message" || (normalized.semanticKind === "message" && normalized.role === "user")) {
      if (goalProjection?.kind === "suppress") continue;
      const message = goalProjection?.kind === "objective" ? goalProjection.text : cleanUserMessageText(normalized.text ?? event.payload?.message ?? "");
      if (message) return firstLine(message, 90);
    }
    if (normalized.rawType === "response_item" && normalized.role === "user") {
      const text = cleanUserMessageText(extractContentText(event.payload.content));
      if (text) return firstLine(text, 90);
    }
  }
  return fallback || "未命名会话";
}

function extractProjectedGoalObjective(events) {
  const projections = classifyPiGoalUserMessages(events);
  for (const projection of projections.values()) {
    if (projection?.kind === "objective" && String(projection.text || "").trim()) return projection.text;
  }
  return null;
}

function classifyEvent(event) {
  return normalizeSessionEvent(event).kind;
}

function isImportantEvent(event) {
  const kind = classifyEvent(event);
  return [
    "session_meta",
    "user_message",
    "agent_message",
    "message",
    "function_call",
    "function_call_output",
    "custom_tool_call",
    "custom_tool_call_output",
    "mcp_tool_call_end",
    "patch_apply_end",
    "tool_search_call",
    "tool_search_output",
    "task_started",
    "task_complete",
    "task_failed",
    "turn_aborted",
    "compacted",
    "context_compacted",
    "jsonl_parse_error",
  ].includes(kind);
}

function summarizeSessionEvents(events) {
  const counts = {};
  const roles = {};
  for (const [index, event] of events.entries()) {
    const normalized = normalizeSessionEvent(event, event?.index ?? index);
    const kind = normalized.kind;
    counts[kind] = (counts[kind] ?? 0) + 1;
    const role = normalized.role;
    if (role) roles[role] = (roles[role] ?? 0) + 1;
  }
  return { counts, roles };
}

function withTitleDetail(title, detail) {
  const text = String(detail ?? "").trim();
  return text ? `${title}：${text}` : title;
}

function summarizeToolCallTitle(toolName) {
  return withTitleDetail("调用工具", toolName || "未知工具");
}

function summarizeToolOutputTitle(toolName) {
  return withTitleDetail("工具输出", toolName || "未知工具");
}

function messageRoleTitle(role) {
  switch (role) {
    case "user":
      return "用户消息";
    case "assistant":
      return "助手消息";
    case "system":
      return "系统消息";
    case "tool":
      return "工具消息";
    default:
      return "消息";
  }
}

function knownKindTitle(kind) {
  switch (kind) {
    case "meta":
    case "session_meta":
      return "会话元信息";
    case "turn_context":
      return "轮次上下文";
    case "user_message":
      return "用户消息";
    case "agent_message":
      return "助手消息";
    case "message":
      return "消息";
    case "token_count":
      return "上下文占用统计";
    case "task_started":
      return "任务开始";
    case "task_complete":
      return "任务完成";
    case "task_failed":
      return "任务失败";
    case "turn_aborted":
      return "轮次已中断";
    case "subagent_notification":
      return "子代理回执";
    case "compacted":
      return "上下文已压缩";
    case "context_compacted":
      return "上下文压缩完成";
    case "jsonl_parse_error":
      return "事件解析失败";
    default:
      return "";
  }
}

function eventMessageTitle(type) {
  return knownKindTitle(type) || withTitleDetail("事件", type);
}

function responseItemTitle(type) {
  switch (type) {
    case "reasoning":
      return "推理项";
    default:
      return withTitleDetail("响应项", type);
  }
}

function summarizeEventTitle(event) {
  const normalized = normalizeSessionEvent(event);
  if (normalized.semanticKind === "diagnostic") return "事件解析失败";
  if (normalized.compact?.kind === "compacted") return "上下文已压缩";
  if (normalized.compact?.kind === "context_compacted") return "上下文压缩完成";
  if (normalized.semanticKind === "tool_call") return summarizeToolCallTitle(normalized.toolName);
  if (normalized.semanticKind === "tool_result") return summarizeToolOutputTitle(normalized.toolName || normalized.callId);
  if (normalized.rawType !== "event_msg" && normalized.rawType !== "response_item") {
    const kindTitle = knownKindTitle(normalized.kind);
    if (kindTitle) return kindTitle;
  }
  const payload = event.payload ?? {};
  if (event.type === "session_meta") return "会话元信息";
  if (event.type === "turn_context") return withTitleDetail("轮次上下文", payload.turn_id);
  if (event.type === "event_msg") {
    if (isToolCallStart(payload.type)) return summarizeToolCallTitle(toolNameFromPayload(payload));
    if (isToolCallOutput(payload.type)) return summarizeToolOutputTitle(toolNameFromPayload(payload) || payload.call_id);
    return eventMessageTitle(payload.type);
  }
  if (event.type === "response_item") {
    if (payload.type === "message") return messageRoleTitle(payload.role);
    if (isToolCallStart(payload.type)) return summarizeToolCallTitle(toolNameFromPayload(payload));
    if (isToolCallOutput(payload.type)) return summarizeToolOutputTitle(payload.call_id);
    return responseItemTitle(payload.type);
  }
  if (isToolCallStart(event.type)) return summarizeToolCallTitle(toolNameFromPayload(payload));
  if (isToolCallOutput(event.type)) return summarizeToolOutputTitle(toolNameFromPayload(payload) || payload.call_id);
  return withTitleDetail("事件", event.type);
}

function summarizeEventPreview(event) {
  const normalized = normalizeSessionEvent(event);
  if (normalized.compact?.kind === "compacted") {
    const prefix = [
      "压缩摘要",
      normalized.compact.windowNumber != null ? `窗口 ${normalized.compact.windowNumber}` : "",
      normalized.compact.replacementHistoryCount ? `${normalized.compact.replacementHistoryCount} 条替换历史` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    return firstLine([prefix, normalized.compact.message].filter(Boolean).join("："), 180);
  }
  if (normalized.compact?.kind === "context_compacted") return "上下文压缩完成，后续轮次将使用已压缩事件写入的替换摘要。";
  if (normalized.role === "user" || normalized.kind === "user_message") {
    const text = cleanUserMessageText(normalized.text);
    if (text) return firstLine(text, 180);
    if (normalized.attachments?.length) return firstLine(normalized.attachments.map((attachment) => attachment.label).join(", "), 180);
    return "";
  }
  if (normalized.text) return firstLine(normalized.text, 180);
  if (normalized.toolInput) return firstLine(normalized.toolInput, 180);
  if (normalized.toolOutput) return firstLine(normalized.toolOutput, 180);
  if (normalized.attachments?.length) return firstLine(normalized.attachments.map((attachment) => attachment.label).join(", "), 180);
  if (normalized.reasoning?.encrypted) return `加密推理内容（${normalized.reasoning.encryptedLength} 字符）`;
  if (normalized.diagnostic?.preview) return firstLine(normalized.diagnostic.preview, 180);
  const payload = event.payload ?? {};
  if (payload.message) return firstLine(redactSensitiveText(payload.message), 180);
  if (payload.last_agent_message) return firstLine(redactSensitiveText(payload.last_agent_message), 180);
  if (payload.content) return firstLine(redactSensitiveText(extractContentText(payload.content)), 180);
  if (payload.arguments) return firstLine(redactSensitiveText(payload.arguments), 180);
  if (payload.input) return firstLine(redactSensitiveText(payload.input), 180);
  if (payload.output) return firstLine(redactSensitiveText(payload.output), 180);
  if (payload.stdout) return firstLine(redactSensitiveText(payload.stdout), 180);
  if (payload.invocation) return firstLine(`${payload.invocation.server}.${payload.invocation.tool}`, 180);
  if (payload.summary?.length) return firstLine(JSON.stringify(payload.summary), 180);
  return "";
}

export {
  classifyEvent,
  extractProjectedGoalObjective,
  extractTitleFromEvents,
  isImportantEvent,
  summarizeEventPreview,
  summarizeEventTitle,
  summarizeSessionEvents,
};
