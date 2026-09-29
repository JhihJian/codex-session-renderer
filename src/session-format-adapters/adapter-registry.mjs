import { adaptClaudeCodeEvent, claudeCodeSessionMetadata, matchesClaudeCodeEvent } from "./claude-code-session-adapter.mjs";
import { adaptPiAgentMessageEvent, matchesPiAgentMessageEvent, piAgentSessionMetadata } from "./pi-agent-session-adapter.mjs";

function adaptSessionEvent(raw) {
  if (matchesPiAgentMessageEvent(raw)) return adaptPiAgentMessageEvent(raw);
  if (matchesClaudeCodeEvent(raw)) return adaptClaudeCodeEvent(raw);
  return { format: "generic", payload: isObject(raw?.payload) ? raw.payload : raw, messageId: null, parentId: null, toolCalls: [], toolResults: [] };
}

function sessionMetadataFromEvents(events) {
  return codexSessionMetadata(events) || piAgentSessionMetadata(events) || claudeCodeSessionMetadata(events) || {};
}

function codexSessionMetadata(events) {
  const payload = events.find((event) => event?.type === "session_meta")?.payload;
  return isObject(payload) ? payload : null;
}

function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export {
  adaptSessionEvent,
  sessionMetadataFromEvents,
};