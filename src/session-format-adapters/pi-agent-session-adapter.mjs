function matchesPiAgentMessageEvent(raw) {
  return raw?.type === "message" && isObject(raw.message);
}

function adaptPiAgentMessageEvent(raw) {
  const message = raw.message;
  const role = normalizeRole(message.role);
  const base = {
    ...message,
    id: message.id ?? raw.id,
    parent_id: message.parent_id ?? raw.parent_id ?? raw.parentId,
    timestamp: message.timestamp ?? raw.timestamp,
    role,
  };
  const payload = message.role === "toolResult" || role === "tool"
    ? {
      ...base,
      type: "function_call_output",
      call_id: message.toolCallId ?? message.call_id ?? message.callId,
      name: message.toolName ?? message.name,
      output: piAgentContentText(message.content),
      success: message.isError == null ? undefined : message.isError === false,
    }
    : {
      ...base,
      type: "message",
      message_id: message.message_id ?? raw.id,
    };

  return {
    format: "pi-agent",
    payload,
    messageId: payload.message_id ?? payload.id ?? null,
    parentId: payload.parent_id ?? null,
  };
}

function piAgentSessionMetadata(events) {
  const session = events.find((event) => event?.type === "session") || null;
  const info = events.find((event) => event?.type === "session_info") || null;
  const model = [...events].reverse().find((event) => event?.type === "model_change") || null;
  const thinking = [...events].reverse().find((event) => event?.type === "thinking_level_change") || null;
  if (![session, info, model, thinking].some(Boolean)) return null;
  return compactMetadata({
    title: info?.name,
    cwd: session?.cwd,
    timestamp: session?.timestamp,
    model: model?.modelId ?? model?.model,
    model_provider: model?.provider,
    reasoningEffort: thinking?.thinkingLevel,
    originator: "pi_agent",
    source: "pi-agent",
    parent_session: session?.parentSession,
  });
}

function piAgentContentText(content) {
  return (Array.isArray(content) ? content : [content])
    .map((part) => {
      if (typeof part === "string") return part;
      if (!isObject(part)) return "";
      return part.text ?? part.value ?? part.output ?? "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function compactMetadata(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item != null && item !== ""));
}

function normalizeRole(value) {
  const role = String(value || "").toLowerCase();
  if (role === "toolresult" || role === "tool") return "tool";
  return role || null;
}

function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export {
  adaptPiAgentMessageEvent,
  matchesPiAgentMessageEvent,
  piAgentSessionMetadata,
};