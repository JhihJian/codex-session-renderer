import { extractContentText, firstLine } from "./text-utils.mjs";
import { isToolCallOutput, isToolCallStart, toolNameFromPayload } from "./tool-events.mjs";
import { normalizeSessionEvent, redactSensitiveText } from "./session-normalizer.mjs";
import { cleanUserMessageText } from "./user-message-cleanup.mjs";

function extractTitleFromEvents(events, fallback) {
  for (const [index, event] of events.entries()) {
    const normalized = normalizeSessionEvent(event, event?.index ?? index);
    if (normalized.kind === "user_message") {
      const message = cleanUserMessageText(normalized.text ?? event.payload?.message ?? "");
      if (message) return firstLine(message, 90);
    }
    if (normalized.rawType === "response_item" && normalized.role === "user") {
      const text = cleanUserMessageText(extractContentText(event.payload.content));
      if (text) return firstLine(text, 90);
    }
  }
  return fallback || "未命名会话";
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

function summarizeEventTitle(event) {
  const normalized = normalizeSessionEvent(event);
  if (normalized.semanticKind === "diagnostic") return "JSONL parse error";
  if (normalized.semanticKind === "tool_call") return `Call ${normalized.toolName || "tool"}`;
  if (normalized.semanticKind === "tool_result") return `Output ${normalized.toolName || normalized.callId || "tool"}`.trim();
  if (normalized.rawType !== "event_msg" && normalized.rawType !== "response_item") {
    if (normalized.kind === "user_message") return "user_message";
    if (normalized.kind === "agent_message") return "agent_message";
  }
  const payload = event.payload ?? {};
  if (event.type === "session_meta") return "Session metadata";
  if (event.type === "turn_context") return `Turn context ${payload.turn_id ?? ""}`.trim();
  if (event.type === "event_msg") {
    if (isToolCallStart(payload.type)) return `Call ${toolNameFromPayload(payload)}`;
    if (isToolCallOutput(payload.type)) return `Output ${toolNameFromPayload(payload) || payload.call_id || ""}`.trim();
    return payload.type ?? "Event";
  }
  if (event.type === "response_item") {
    if (payload.type === "message") return `${payload.role || "message"} message`;
    if (isToolCallStart(payload.type)) return `Call ${toolNameFromPayload(payload)}`;
    if (isToolCallOutput(payload.type)) return `Output ${payload.call_id || ""}`.trim();
    return payload.type || "Response item";
  }
  if (isToolCallStart(event.type)) return `Call ${toolNameFromPayload(payload)}`;
  if (isToolCallOutput(event.type)) return `Output ${toolNameFromPayload(payload) || payload.call_id || ""}`.trim();
  return event.type || "Event";
}

function summarizeEventPreview(event) {
  const normalized = normalizeSessionEvent(event);
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
  if (normalized.reasoning?.encrypted) return `加密 reasoning (${normalized.reasoning.encryptedLength} chars)`;
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
  extractTitleFromEvents,
  isImportantEvent,
  summarizeEventPreview,
  summarizeEventTitle,
  summarizeSessionEvents,
};
