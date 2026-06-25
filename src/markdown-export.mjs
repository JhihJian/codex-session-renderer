function renderConversationMarkdown(session, turns) {
  const lines = [`# ${escapeMd(session.title || "Codex session")}`, ""];
  lines.push(`- 会话 ID: \`${session.id}\``);
  if (session.cwd) lines.push(`- 工作目录: \`${session.cwd}\``);
  if (session.startedAt) lines.push(`- 开始时间: ${session.startedAt}`);
  if (session.updatedAt) lines.push(`- 更新时间: ${session.updatedAt}`);
  lines.push("");

  for (const [index, turn] of turns.entries()) {
    lines.push(`## Turn ${index + 1}`);
    if (turn.startedAt || turn.completedAt || turn.status) {
      const meta = [turn.status, turn.startedAt, turn.completedAt].filter(Boolean).join(" · ");
      lines.push("");
      lines.push(`_${meta}_`);
    }
    for (const item of turn.items) {
      lines.push("");
      lines.push(`### ${markdownItemTitle(item)}`);
      lines.push("");
      lines.push(renderItemMarkdown(item));
    }
    lines.push("");
  }
  return lines.join("\n").replace(/\n{4,}/g, "\n\n\n").trimEnd() + "\n";
}

function markdownItemTitle(item) {
  switch (item.type) {
    case "user-message":
      return "用户";
    case "assistant-message":
      return item.phase === "final" ? "助手最终回复" : "助手";
    case "reasoning":
      return "推理摘要";
    case "tool-call":
      return `工具调用: ${item.name || item.callId || "tool"}`;
    case "tool-output":
      return "工具输出";
    case "token-count":
      return "Token 统计";
    default:
      return item.eventType || item.responseType || item.type;
  }
}

function renderItemMarkdown(item) {
  if (item.type === "user-message" || item.type === "assistant-message" || item.type === "reasoning") {
    return String(item.text || (item.encrypted ? "_推理内容已加密存储_" : "")).trim() || "_无文本内容_";
  }
  if (item.type === "tool-call") {
    const parts = [];
    if (item.arguments != null) parts.push(fenced("json", prettyMaybeJson(item.arguments)));
    if (item.output != null) parts.push(fenced("text", String(item.output)));
    return parts.join("\n\n") || "_无参数_";
  }
  if (item.type === "tool-output") return fenced("text", String(item.output ?? ""));
  return fenced("json", JSON.stringify(item.payload ?? item.info ?? item, null, 2));
}

function fenced(lang, body) {
  const text = String(body ?? "").replace(/\s+$/g, "");
  return `\`\`\`${lang}\n${text}\n\`\`\``;
}

function prettyMaybeJson(value) {
  if (typeof value !== "string") return JSON.stringify(value, null, 2);
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function escapeMd(value) {
  return String(value).replaceAll("#", "\\#").trim();
}

export { escapeMd, fenced, markdownItemTitle, prettyMaybeJson, renderConversationMarkdown, renderItemMarkdown };
