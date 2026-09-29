function matchesClaudeCodeEvent(raw) {
  return (
    (raw?.type === "user" || raw?.type === "assistant") &&
    isObject(raw.message) &&
    typeof raw.uuid === "string" &&
    typeof raw.sessionId === "string" &&
    Object.hasOwn(raw, "parentUuid")
  );
}

function adaptClaudeCodeEvent(raw) {
  const message = raw.message;
  const role = typeof message.role === "string" ? message.role : raw.type;
  const toolCalls = toolCallsFromContent(message.content);
  const toolResults = toolResultsFromContent(message.content);
  const toolOnly = toolResults.length > 0 && contentHasOnlyToolResults(message.content);
  const firstResult = toolResults[0] || null;
  const payload = {
    ...message,
    type: toolOnly ? "function_call_output" : "message",
    role: toolOnly ? "tool" : role,
    message_id: raw.uuid,
    parent_id: raw.parentUuid,
  };
  if (toolOnly) {
    payload.call_id = firstResult.callId;
    payload.output = firstResult.output;
    payload.success = firstResult.success;
  }

  return {
    format: "claude-code",
    payload,
    messageId: raw.uuid,
    parentId: raw.parentUuid,
    toolCalls,
    toolResults,
  };
}

function claudeCodeSessionMetadata(events) {
  const metadata = { originator: "claude_code", source: "claude-code" };
  for (const raw of events) {
    if (!matchesClaudeCodeEvent(raw)) continue;
    metadata.cwd ??= raw.cwd;
    metadata.model ??= raw.model;
    metadata.timestamp ??= raw.timestamp;
    if (metadata.cwd && metadata.model && metadata.timestamp) break;
  }
  return metadata.timestamp ? compactMetadata(metadata) : null;
}

function toolCallsFromContent(content) {
  if (!Array.isArray(content)) return [];
  return content
    .filter((part) => isObject(part) && part.type === "tool_use")
    .map((part) => compactObject({
      callId: stringOrNull(part.id),
      name: stringOrNull(part.name),
      arguments: stringifyMaybe(part.input),
    }));
}

function toolResultsFromContent(content) {
  if (!Array.isArray(content)) return [];
  return content
    .filter((part) => isObject(part) && part.type === "tool_result")
    .map((part) => compactObject({
      callId: stringOrNull(part.tool_use_id ?? part.toolUseId),
      output: contentText(part.content),
      success: part.is_error === true || part.isError === true ? false : true,
    }));
}

function contentHasOnlyToolResults(content) {
  return Array.isArray(content) && content.every((part) => isObject(part) && part.type === "tool_result");
}

function contentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return stringifyMaybe(content) || "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!isObject(part)) return "";
      return part.text ?? part.value ?? "";
    })
    .filter((part) => part !== "")
    .join("\n\n");
}

function compactMetadata(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item != null && item !== ""));
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item != null && item !== ""));
}

function stringifyMaybe(value) {
  if (value == null) return null;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function stringOrNull(value) {
  return typeof value === "string" && value ? value : null;
}

function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export {
  adaptClaudeCodeEvent,
  claudeCodeSessionMetadata,
  matchesClaudeCodeEvent,
};