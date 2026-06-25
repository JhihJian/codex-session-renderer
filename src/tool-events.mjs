function isToolCallStart(type) {
  return type === "function_call" || type === "tool_search_call" || type === "custom_tool_call";
}

function isToolCallOutput(type) {
  return (
    type === "function_call_output" ||
    type === "tool_search_output" ||
    type === "custom_tool_call_output" ||
    type === "mcp_tool_call_end" ||
    type === "patch_apply_end"
  );
}

function isStandaloneToolEvent(type) {
  return isToolCallStart(type) || isToolCallOutput(type);
}

function toolNameFromPayload(payload) {
  if (payload.name) return payload.name;
  if (payload.execution) return payload.execution;
  if (payload.invocation?.server || payload.invocation?.tool) {
    return [payload.invocation.server, payload.invocation.tool].filter(Boolean).join(".");
  }
  if (payload.type === "patch_apply_end") return "apply_patch";
  return payload.type || "tool";
}

function toolArgumentsFromPayload(payload) {
  if (payload.arguments != null) return payload.arguments;
  if (payload.arguments_json != null) return payload.arguments_json;
  if (payload.input != null) return payload.input;
  if (payload.invocation?.arguments != null) return JSON.stringify(payload.invocation.arguments, null, 2);
  if (payload.changes != null) return JSON.stringify({ changes: payload.changes }, null, 2);
  return null;
}

function toolOutputFromPayload(payload) {
  if (payload.output != null) return payload.output;
  if (payload.result != null) return renderMcpResult(payload.result);
  if (payload.stdout || payload.stderr) return [payload.stdout, payload.stderr].filter(Boolean).join("\n");
  if (payload.success != null) return payload.success ? "Success" : "Failed";
  return null;
}

function renderMcpResult(result) {
  if (result?.Ok?.content && Array.isArray(result.Ok.content)) {
    return result.Ok.content
      .map((part) => part?.text ?? JSON.stringify(part))
      .filter(Boolean)
      .join("\n\n");
  }
  if (result?.Err) return JSON.stringify(result.Err, null, 2);
  return JSON.stringify(result ?? null, null, 2);
}

function mergeToolOutput(previous, next) {
  if (next == null || next === "") return previous ?? null;
  if (previous == null || previous === "") return next;
  const left = String(previous).trim();
  const right = String(next).trim();
  if (!right || left === right || left.includes(right)) return previous;
  if (right.includes(left)) return next;
  return `${left}\n\n${right}`;
}

export {
  isStandaloneToolEvent,
  isToolCallOutput,
  isToolCallStart,
  mergeToolOutput,
  renderMcpResult,
  toolArgumentsFromPayload,
  toolNameFromPayload,
  toolOutputFromPayload,
};
