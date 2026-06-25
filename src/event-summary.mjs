import { extractContentText, firstLine } from "./text-utils.mjs";
import { isToolCallOutput, isToolCallStart, toolNameFromPayload } from "./tool-events.mjs";

function extractTitleFromEvents(events, fallback) {
  for (const event of events) {
    if (event.type === "event_msg" && event.payload?.type === "user_message") {
      const message = String(event.payload.message ?? "").trim();
      if (message) return firstLine(message, 90);
    }
    if (event.type === "response_item" && event.payload?.role === "user") {
      const text = extractContentText(event.payload.content).trim();
      if (text) return firstLine(text, 90);
    }
  }
  return fallback || "未命名会话";
}

function classifyEvent(event) {
  const payload = event.payload ?? {};
  if (event.type === "session_meta") return "meta";
  if (event.type === "turn_context") return "context";
  if (event.type === "event_msg") return payload.type || "event";
  if (event.type === "response_item") return payload.type || "response";
  return event.type || "unknown";
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
  ].includes(kind);
}

function summarizeSessionEvents(events) {
  const counts = {};
  const roles = {};
  for (const event of events) {
    const kind = classifyEvent(event);
    counts[kind] = (counts[kind] ?? 0) + 1;
    const role = event.payload?.role;
    if (role) roles[role] = (roles[role] ?? 0) + 1;
  }
  return { counts, roles };
}

function summarizeEventTitle(event) {
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
  const payload = event.payload ?? {};
  if (payload.message) return firstLine(payload.message, 180);
  if (payload.last_agent_message) return firstLine(payload.last_agent_message, 180);
  if (payload.content) return firstLine(extractContentText(payload.content), 180);
  if (payload.arguments) return firstLine(payload.arguments, 180);
  if (payload.input) return firstLine(payload.input, 180);
  if (payload.output) return firstLine(payload.output, 180);
  if (payload.stdout) return firstLine(payload.stdout, 180);
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
