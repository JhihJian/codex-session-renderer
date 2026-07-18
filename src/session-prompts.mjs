import { buildTurns, firstLine } from "./session-events.mjs";

const defaultPromptPreviewLimit = 280;
const defaultArchiveTextLimit = null;

function archiveText(value) {
  return String(value || "").trim();
}

function extractFirstPrompt(events, options = {}) {
  const turns = buildTurns(events || []);
  for (const turn of turns) {
    for (const item of turn.items || []) {
      if (item.type !== "user-message") continue;
      const text = String(item.text || "").trim();
      const attachments = Array.isArray(item.attachments) ? item.attachments : [];
      if (!text && attachments.length === 0) continue;
      return {
        state: text ? "found" : "image-only",
        text: text || null,
        preview: firstLine(text, options.previewLimit || defaultPromptPreviewLimit) || null,
        timestamp: item.timestamp || turn.startedAt || null,
        sourceIndex: Number.isInteger(item.sourceIndex) ? item.sourceIndex : null,
        messageId: item.messageId || null,
        turnId: turn.id || null,
        attachments,
      };
    }
  }
  return {
    state: (events || []).some((event) => event?.__jsonlDiagnostic) ? "error" : "empty",
    text: null,
    preview: null,
    timestamp: null,
    sourceIndex: null,
    messageId: null,
    turnId: null,
    attachments: [],
  };
}

function promptProjectKey(cwd) {
  const value = String(cwd || "").trim();
  if (!value) return "__projectless__";
  const normalized = value.replaceAll("\\", "/").replace(/\/+$/, "");
  return process.platform === "win32" || /^[a-z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized;
}

function promptProjectLabel(cwd) {
  return String(cwd || "").trim() || "无项目";
}

function buildPromptArchiveEntry(session, prompt, options = {}) {
  const sourceId = session?.sourceId || options.sourceId || "local";
  const cwd = session?.cwd || null;
  const hideTitle = Boolean(options.hideSessionTitle) || prompt?.state === "too_large" || prompt?.state === "changing";
  return {
    id: `${sourceId}:${session?.id || ""}`,
    sourceId,
    sourceLabel: session?.sourceLabel || options.sourceLabel || null,
    sessionId: session?.id || null,
    sessionTitle: hideTitle ? "未命名会话" : archiveText(session?.title || "未命名会话"),
    cwd,
    projectKey: `${sourceId}:${promptProjectKey(cwd)}`,
    projectLabel: promptProjectLabel(cwd),
    promptState: prompt?.state || "empty",
    promptText: prompt?.text || null,
    promptPreview: prompt?.preview || null,
    promptTruncated: Boolean(prompt?.truncated),
    promptLimitReason: prompt?.limitReason || null,
    promptTimestamp: prompt?.timestamp || null,
    promptEventIndex: prompt?.sourceIndex ?? null,
    promptMessageId: prompt?.messageId || null,
    promptTurnId: prompt?.turnId || null,
    attachments: prompt?.attachments || [],
    startedAt: session?.startedAt || null,
    updatedAt: session?.updatedAt || session?.fileModifiedAt || null,
    status: session?.status || null,
    archived: Boolean(session?.archived),
    available: Boolean(session?.path),
    remoteIndexOnly: Boolean(session?.remoteIndexOnly),
  };
}

export {
  archiveText,
  buildPromptArchiveEntry,
  defaultArchiveTextLimit,
  defaultPromptPreviewLimit,
  extractFirstPrompt,
  promptProjectKey,
  promptProjectLabel,
};