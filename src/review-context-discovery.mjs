import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { isLikelyCodexGoalControlText } from "./pi-goal-projection.mjs";
import { normalizeSessionEvent } from "./session-normalizer.mjs";

const correctionPattern = /\b(?:not\s+(?:fixed|working|resolved|done)|still\s+(?:broken|wrong)|are\s+you\s+sure|didn'?t|doesn'?t)\b|不对|不合理|你确定|没有(?:修复|解决|完成)|没(?:有)?(?:修复|解决|完成)|看不出|无意义|重新(?:做|设计|实现)/i;

async function discoverReviewContexts(input = {}) {
  const source = required(input.archivePath, "archivePath");
  const contents = await (input.fsApi || fs).readFile(source, "utf8");
  const sourceHash = createHash("sha256").update(contents).digest("hex");
  if (input.sourceHash && input.sourceHash !== sourceHash) throw reviewContextError("归档 SHA-256 与扫描输入不匹配。");
  const events = String(contents).split(/\r?\n/).filter(Boolean).flatMap((line, index) => {
    try { return [normalizeSessionEvent(JSON.parse(line), index)]; } catch { return []; }
  });
  return { sourceHash, eventsScanned: events.length, matches: findContexts(events, sourceHash) };
}

function findContexts(events, sourceHash) {
  const matches = [];
  let task = null;
  let lastAssistant = null;
  let actions = [];
  for (const event of events) {
    if (isEligibleUser(event)) {
      if (isExplicitCorrection(event.text) && task && lastAssistant) {
        matches.push(draft({ sourceHash, task, correction: event, priorAssistant: lastAssistant, actions }));
      } else {
        task = event;
        actions = [];
      }
      continue;
    }
    if (event.role === "assistant" && event.semanticKind === "message" && event.text) lastAssistant = event;
    if (["tool_call", "tool_result"].includes(event.semanticKind)) actions.push(event);
  }
  return matches;
}

function draft({ sourceHash, task, correction, priorAssistant, actions }) {
  const relatedActions = actions.filter((event) => event.index > task.index && event.index < correction.index).slice(-12).map(projectAction);
  return {
    id: `RC-${createHash("sha256").update(`${sourceHash}:${correction.index}:review-context-v1`).digest("hex").slice(0, 20)}`,
    dedupeKey: createHash("sha256").update(`${sourceHash}:${correction.index}:review-context-v1`).digest("hex"),
    sourceHash,
    status: "pending_review",
    trigger: { kind: "explicit_correction", matchedText: matchedText(correction.text), reason: "用户在此前助手回复后发出了明确纠正。" },
    task: projectMessage(task),
    correction: projectMessage(correction),
    priorAssistant: projectMessage(priorAssistant),
    relatedActions,
    contextComplete: true,
    createdAt: new Date().toISOString(),
  };
}

function projectMessage(event) { return { eventIndex: event.index, timestamp: event.timestamp || null, text: String(event.text || "").trim(), messageId: event.messageId || null }; }
function projectAction(event) { return { eventIndex: event.index, timestamp: event.timestamp || null, kind: event.semanticKind, toolName: event.toolName || null, output: event.toolOutput || null }; }
function isEligibleUser(event) { const text = String(event.text || "").trim(); return event.role === "user" && event.semanticKind === "message" && text && !isLikelyCodexGoalControlText(text); }
function isExplicitCorrection(text) { return correctionPattern.test(String(text || "")); }
function matchedText(text) { const match = String(text).match(correctionPattern); return match?.[0] || ""; }
function required(value, field) { const text = String(value || "").trim(); if (!text) throw reviewContextError(`${field} 不能为空。`); return text; }
function reviewContextError(message) { const error = new Error(message); error.code = "review_context_invalid"; return error; }

export { discoverReviewContexts };