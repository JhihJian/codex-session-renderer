function cleanUserMessageText(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const wrappedRequest = extractWrappedCodexRequest(raw);
  const stripped = wrappedRequest == null ? stripLeadingMachineContext(raw) : wrappedRequest;
  const text = stripped.trim();
  return isMachineOnlyUserMessageText(text) ? "" : text;
}

function extractWrappedCodexRequest(raw) {
  if (!looksLikeCodexWrapper(raw)) return null;
  const match = raw.match(/(?:^|\n)## My request for Codex:\s*([\s\S]*)$/i);
  return match?.[1] ?? null;
}

function looksLikeCodexWrapper(raw) {
  return (
    /^#?\s*AGENTS\.md instructions/i.test(raw) ||
    /^# In app browser:/i.test(raw) ||
    /^# Files mentioned by the user:/i.test(raw) ||
    /^<environment_context>/i.test(raw) ||
    /^<permissions instructions>/i.test(raw) ||
    /^Continue working toward the active thread goal/i.test(raw)
  );
}

function stripLeadingMachineContext(raw) {
  let text = String(raw || "").trim();

  if (/^#?\s*AGENTS\.md instructions/i.test(text)) {
    const environmentEnd = text.search(/<\/environment_context>/i);
    if (environmentEnd >= 0) {
      text = text.slice(environmentEnd + "</environment_context>".length).trim();
    } else {
      const request = text.match(/(?:^|\n)## My request for Codex:\s*([\s\S]*)$/i);
      text = request?.[1] || "";
    }
  }

  text = text
    .replace(/^# In app browser:[\s\S]*?(?:\n## My request for Codex:\s*)?/i, "")
    .replace(/^# Files mentioned by the user:[\s\S]*?(?:\n## My request for Codex:\s*)?/i, "")
    .replace(/^<environment_context>[\s\S]*?<\/environment_context>\s*/i, "")
    .trim();

  if (/^Continue working toward the active thread goal/i.test(text)) return "";
  if (/^<permissions instructions>/i.test(text)) return "";
  return text;
}

function isUsefulUserMessageText(value) {
  return !isMachineOnlyUserMessageText(value);
}

function isMachineOnlyUserMessageText(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return true;
  if (/^#?\s*AGENTS\.md instructions/i.test(text)) return true;
  if (/^Continue working toward the active thread goal/i.test(text)) return true;
  if (/^In app browser:/i.test(text)) return true;
  if (/^Files mentioned by the user:/i.test(text)) return true;
  if (/^<environment_context>/i.test(text)) return true;
  if (/^<permissions instructions>/i.test(text)) return true;
  return isSubagentNotificationText(value);
}

function isSubagentNotificationText(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  const wrapped = text.match(/^<subagent_notification>\s*([\s\S]*?)\s*<\/subagent_notification>$/i);
  const jsonText = wrapped ? wrapped[1].trim() : text;
  if (!/^\{[\s\S]*\}$/.test(jsonText)) return false;
  try {
    const parsed = JSON.parse(jsonText);
    return Boolean(parsed?.type === "subagent_notification" || parsed?.agent_path || parsed?.agent_id);
  } catch {
    return false;
  }
}

export {
  cleanUserMessageText,
  isMachineOnlyUserMessageText,
  isUsefulUserMessageText,
};
