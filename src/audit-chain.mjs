import { riskSignalsForEvidence } from "./evidence-risk-rules.mjs";
import { firstLine, normalizeText } from "./text-utils.mjs";

const previewLimits = {
  title: 96,
  summary: 360,
  body: 900,
};

const riskTextPattern = /\b(error|failed|failure|exception|stderr|non-?zero|exit code\s*[1-9]\d*)\b|失败|错误/i;
const nonZeroFailurePattern =
  /\bfail(?:ed|ures?)?\s*[:=]?\s*[1-9]\d*\b|\b[1-9]\d*\s+fail(?:ed|ures?)?\b|\berrors?\s*[:=]?\s*[1-9]\d*\b|\b[1-9]\d*\s+errors?\b/i;
const dangerousTextPattern =
  /\b(?:rm|del|drop|delete)\b|Remove-Item\b|git\s+(?:reset|clean)\b|rmdir\s+\/s|Remove-Az|Remove-AD|(?:^|[;&|]\s*)(?:format|format\.com)(?:\s|$)|Format-Volume\b/i;
const verificationPackageCommandPattern = /^(?:npm|pnpm|yarn)\s+(?:run\s+)?(?:test|check|lint|build|typecheck)\b/i;
const verificationDirectCommandPattern =
  /^(?:node\s+--test\b|(?:npx\s+)?playwright\s+test\b|(?:npx\s+)?(?:pytest|vitest|jest)\b|cargo\s+test\b|go\s+test\b|mvn\s+test\b|gradle\s+test\b|(?:npx\s+)?tsc\b|(?:lint|build|typecheck)\b)/i;
const verificationHealthCommandPattern = /^(?:curl|wget)\b[\s\S]{0,220}(?:\/(?:health|status|ready|live|ping)\b|\b(?:health|status|ready|live|ping)\b)/i;
const verificationToolPattern = /(?:exec|shell|command|terminal|bash|powershell|cmd|apply_patch|playwright|browser|curl|http|request)/i;
const finalClaimPattern = /已测试|测试通过|验证通过|检查通过|验证完成|完成|已修复|修复完成|tests?\s+passed|verified|validated/i;

const riskRank = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

function buildAuditChain({ turns = [], evidenceRiskRules = [] } = {}) {
  const nodes = [];
  const finalNodes = [];
  const auditOptions = { evidenceRiskRules };

  for (const [turnIndex, turn] of turns.entries()) {
    const assistantItems = (turn.items || []).filter((item) => item.type === "assistant-message" && normalizeText(item.text));
    const finalAssistant = assistantItems.at(-1) || null;

    for (const [itemIndex, item] of (turn.items || []).entries()) {
      if (item.type === "user-message") {
        const text = item.projectedGoalObjective ? String(item.text || "").trim() : cleanAuditUserText(item.text);
        if (!item.projectedGoalObjective && !isUsefulAuditIntent(text)) continue;
        nodes.push(
          auditNode({
            id: auditId("intent", turnIndex, itemIndex, item),
            type: "intent",
            title: "用户意图",
            summary: preview(text),
            body: text,
            status: "observed",
            turn,
            turnIndex,
            item,
            itemIndex,
            tags: ["user"],
          }),
        );
        continue;
      }

      if (item.type === "reasoning") {
        nodes.push(
          auditNode({
            id: auditId("reasoning", turnIndex, itemIndex, item),
            type: "reasoning",
            title: item.encrypted ? "推理摘要 · 加密" : "推理摘要",
            summary: preview(item.text || (item.encrypted ? "推理内容已加密存储，当前没有可展示的明文摘要。" : "无明文摘要。")),
            body: String(item.text || (item.encrypted ? "推理内容已加密存储，当前没有可展示的明文摘要。" : "无明文摘要。")).trim(),
            status: item.encrypted ? "encrypted" : "observed",
            turn,
            turnIndex,
            item,
            itemIndex,
            tags: item.encrypted ? ["reasoning", "encrypted"] : ["reasoning"],
          }),
        );
        continue;
      }

      if (item.type === "assistant-message") {
        const text = normalizeText(item.text);
        if (!text) continue;
        const isFinal = item === finalAssistant;
        const node = auditNode({
          id: auditId(isFinal ? "final" : "reasoning", turnIndex, itemIndex, item),
          type: isFinal ? "final" : "reasoning",
          title: isFinal ? "助手最终回复" : "助手中间说明",
          summary: preview(item.text),
          body: String(item.text || "").trim(),
          status: isFinal ? "final" : "observed",
          turn,
          turnIndex,
          item,
          itemIndex,
          tags: [isFinal ? "final" : "assistant"],
        });
        nodes.push(node);
        if (isFinal) finalNodes.push({ node, item, turn, turnIndex, itemIndex });
        continue;
      }

      if (item.type === "tool-call") {
        const actionNode = buildActionNode(turn, turnIndex, item, itemIndex);
        nodes.push(actionNode);
        pushAuditSignalNodes(nodes, auditSignalNodesFromSignals(actionNode, riskSignalsForAction(item)));

        if (item.output != null && String(item.output) !== "") {
          const evidenceNode = buildEvidenceNode(turn, turnIndex, item, itemIndex, auditOptions);
          nodes.push(evidenceNode);
          pushAuditSignalNodes(nodes, auditSignalNodesFromSignals(evidenceNode, riskSignalsForEvidence(item, auditOptions)));
        }

        if (isVerificationItem(item)) {
          const verificationNode = buildVerificationNode(turn, turnIndex, item, itemIndex);
          nodes.push(verificationNode);
          pushAuditSignalNodes(nodes, auditSignalNodesFromSignals(verificationNode, riskSignalsForVerification(item)));
        }
      }
    }
  }

  const hasVerification = nodes.some((node) => node.type === "verification");
  if (!hasVerification) {
    for (const final of finalNodes) {
      if (!finalClaimPattern.test(final.item.text || "")) continue;
      final.node.riskLevel = maxRiskLevel(final.node.riskLevel, "medium");
      addTags(final.node, ["unverified-claim"]);
      insertAfterNode(
        nodes,
        final.node.id,
        buildRiskNode(final.node, [
          {
            level: "medium",
            tag: "missing-verification",
            summary: "最终回复包含完成、修复或验证类声明，但本会话没有检测到验证节点。",
          },
        ]),
      );
    }
  }

  return {
    nodes,
    counts: countAuditNodes(nodes),
  };
}

function buildActionNode(turn, turnIndex, item, itemIndex) {
  const command = commandTextForItem(item);
  const riskLevel = riskSignalsForAction(item).reduce((level, signal) => maxRiskLevel(level, signal.level), "none");
  const batch = item.embeddedSubagents;
  const taskCount = batch?.results?.length || batch?.requested?.length || 0;
  return auditNode({
    id: auditId("action", turnIndex, itemIndex, item),
    type: "action",
    title: batch ? `内嵌子代理批次 · ${taskCount} 个任务` : item.name ? `工具调用 · ${item.name}` : "工具调用",
    summary: batch ? [batch.mode, batch.agentScope ? `范围：${batch.agentScope}` : "", batch.status].filter(Boolean).join(" · ") : preview(command || item.arguments || item.callId || item.name || ""),
    body: batch ? String(item.arguments || item.callId || item.name || "").trim() : String(command || item.arguments || item.callId || item.name || "").trim(),
    status: batch?.status || item.status || "started",
    turn,
    turnIndex,
    item,
    itemIndex,
    sourceIndex: item.sourceIndex,
    eventIndex: item.sourceIndex,
    traceNodeId: traceItemNodeId(turnIndex, itemIndex, item),
    riskLevel,
    tags: ["tool", item.name].filter(Boolean),
    toolName: item.name || null,
    callId: item.callId || null,
    argumentsPreview: preview(item.arguments || "", previewLimits.body),
    argumentsBody: String(item.arguments || "").trim(),
    truncated: Boolean(item.truncated),
  });
}

function buildEvidenceNode(turn, turnIndex, item, itemIndex, auditOptions = {}) {
  const riskLevel = riskSignalsForEvidence(item, auditOptions).reduce((level, signal) => maxRiskLevel(level, signal.level), "none");
  const sourceIndex = item.outputSourceIndex ?? item.sourceIndex;
  return auditNode({
    id: auditId("evidence", turnIndex, itemIndex, item, "output"),
    type: "evidence",
    title: item.name ? `工具输出 · ${item.name}` : "工具输出",
    summary: preview(item.output || ""),
    body: String(item.output || "").trim(),
    status: evidenceStatus(item),
    turn,
    turnIndex,
    item,
    itemIndex,
    sourceIndex,
    eventIndex: sourceIndex,
    traceNodeId: traceItemNodeId(turnIndex, itemIndex, item),
    riskLevel,
    tags: ["evidence", item.name].filter(Boolean),
    toolName: item.name || null,
    callId: item.callId || null,
    outputPreview: preview(item.output || "", previewLimits.body),
    outputBody: String(item.output || "").trim(),
    truncated: Boolean(item.truncated),
  });
}

function buildVerificationNode(turn, turnIndex, item, itemIndex) {
  const sourceIndex = item.outputSourceIndex ?? item.sourceIndex;
  const text = [commandTextForItem(item), item.output].filter(Boolean).join("\n");
  const riskLevel = riskSignalsForVerification(item).reduce((level, signal) => maxRiskLevel(level, signal.level), "none");
  return auditNode({
    id: auditId("verification", turnIndex, itemIndex, item),
    type: "verification",
    title: item.name ? `验证 · ${item.name}` : "验证动作",
    summary: preview(text),
    body: text.trim(),
    status: evidenceStatus(item),
    turn,
    turnIndex,
    item,
    itemIndex,
    sourceIndex,
    eventIndex: sourceIndex,
    traceNodeId: traceItemNodeId(turnIndex, itemIndex, item),
    riskLevel,
    tags: ["verification", item.name].filter(Boolean),
    toolName: item.name || null,
    callId: item.callId || null,
    argumentsPreview: preview(item.arguments || "", previewLimits.body),
    outputPreview: preview(item.output || "", previewLimits.body),
    argumentsBody: String(item.arguments || "").trim(),
    outputBody: String(item.output || "").trim(),
    truncated: Boolean(item.truncated),
  });
}

function auditNode({
  id,
  type,
  title,
  summary,
  body,
  status,
  turn,
  turnIndex,
  item,
  itemIndex,
  sourceIndex = item?.sourceIndex,
  eventIndex = sourceIndex,
  traceNodeId = null,
  riskLevel = "none",
  tags = [],
  ...extra
}) {
  return {
    id,
    type,
    title,
    summary: summary || "",
    body: body == null ? summary || "" : String(body),
    status: status || "observed",
    timestamp: item?.timestamp || turn?.startedAt || null,
    turnIndex,
    turnNumber: turnIndex + 1,
    eventIndex: eventIndex ?? null,
    sourceIndex: sourceIndex ?? null,
    itemRef: item ? itemRef(turnIndex, itemIndex, item) : null,
    traceNodeId,
    riskLevel,
    tags: uniqueTags(tags),
    ...extra,
  };
}

function auditSignalNodesFromSignals(sourceNode, signals) {
  if (!signals.length) return [];
  const nodes = [];
  nodes.push(buildRiskNode(sourceNode, signals));
  return nodes;
}

function buildRiskNode(sourceNode, signals) {
  const riskLevel = signals.reduce((level, signal) => maxRiskLevel(level, signal.level), "none");
  const tags = uniqueTags(["risk", ...signals.map((signal) => signal.tag).filter(Boolean)]);
  return {
    id: `${sourceNode.id}:risk:${tags.filter((tag) => tag !== "risk").join("-") || "signal"}`,
    type: "risk",
    title: riskTitle(riskLevel),
    summary: signals.map((signal) => signal.summary).filter(Boolean).join("；"),
    body: signals.map((signal) => signal.summary).filter(Boolean).join("；"),
    status: riskLevel === "high" ? "high-risk" : "needs-review",
    timestamp: sourceNode.timestamp || null,
    turnIndex: sourceNode.turnIndex,
    turnNumber: sourceNode.turnNumber,
    eventIndex: sourceNode.eventIndex ?? null,
    sourceIndex: sourceNode.sourceIndex ?? null,
    itemRef: sourceNode.itemRef || null,
    traceNodeId: sourceNode.traceNodeId || null,
    riskLevel,
    tags,
    relatedNodeId: sourceNode.id,
    relatedType: sourceNode.type,
    toolName: sourceNode.toolName || null,
  };
}

function pushAuditSignalNodes(nodes, signalNodes) {
  for (const node of signalNodes || []) nodes.push(node);
}

function insertAfterNode(nodes, targetId, node) {
  const index = nodes.findIndex((candidate) => candidate.id === targetId);
  if (index < 0) {
    nodes.push(node);
    return;
  }
  nodes.splice(index + 1, 0, node);
}

function riskSignalsForAction(item) {
  const signals = [];
  const command = commandTextForItem(item);
  const text = [item.status, command, item.arguments].filter(Boolean).join("\n");
  if (isDangerousExecutableCommand(item, command)) {
    signals.push({
      level: "high",
      tag: "dangerous-command",
      summary: "工具参数疑似执行删除、格式化、git reset/clean 等危险命令。",
    });
  } else if (isPatchLikeTool(item) && hasDangerousText(command)) {
    signals.push({
      level: "low",
      tag: "dangerous-text",
      summary: "补丁或文本中包含危险命令关键词，需要复核它是否只是代码/测试内容。",
    });
  }
  if (hasRiskText(text)) {
    signals.push({
      level: statusLooksFailed(item.status) ? "high" : "medium",
      tag: "error-text",
      summary: "工具调用参数或状态包含 error、failed、stderr、失败、错误等风险词。",
    });
  }
  if (largePayloadLength(item.arguments) || largePayloadLength(item.payloadPreview)) {
    signals.push({
      level: "medium",
      tag: "large-payload",
      summary: "工具参数或 payload 预览较大，审计时需要回看原始事件。",
    });
  }
  if (item.output == null || item.output === "") {
    signals.push({
      level: statusLooksFailed(item.status) ? "medium" : "low",
      tag: "missing-output",
      summary: "检测到工具调用，但当前轻量模型中没有对应输出证据。",
    });
  }
  return signals;
}

function riskSignalsForVerification(item) {
  const signals = [];
  if (verificationLooksFailed(item)) {
    signals.push({
      level: statusLooksFailed(item.status) ? "high" : "medium",
      tag: "verification-failed",
      summary: "验证动作输出或状态显示失败、错误或 stderr。",
    });
  }
  return signals;
}

function isVerificationItem(item) {
  if (!verificationToolPattern.test(String(item?.name || ""))) return false;
  return verificationCommandCandidates(item).some(isVerificationCommand);
}

function isDangerousCommand(text) {
  return shellCommandSegments(text).some((segment) => isDangerousCommandSegment(stripShellWrapper(segment)));
}

function isDangerousExecutableCommand(item, command) {
  if (!isShellExecutionTool(item)) return false;
  return shellCommandCandidates(item, command).some(isDangerousCommand);
}

function isShellExecutionTool(item) {
  return /(?:exec|shell|command|terminal|bash|powershell|cmd)/i.test(String(item?.name || ""));
}

function isPatchLikeTool(item) {
  return /patch|apply_patch|edit|file/i.test(String(item?.name || ""));
}

function hasDangerousText(text) {
  return dangerousTextPattern.test(String(text || ""));
}

function isVerificationText(text) {
  return isVerificationCommand(String(text || ""));
}

function hasFinalVerificationClaim(text) {
  return finalClaimPattern.test(String(text || ""));
}

function commandTextForItem(item) {
  return [item?.name, item?.arguments].filter(Boolean).join("\n");
}

function hasRiskText(text) {
  const value = String(text || "").replace(
    /\bfail(?:ed|ures?)?\s*[:=]?\s*0\b|\b0\s+fail(?:ed|ures?)?\b|\berrors?\s*[:=]?\s*0\b|\b0\s+errors?\b/gi,
    "",
  );
  return riskTextPattern.test(value) || nonZeroFailurePattern.test(value);
}

function verificationLooksFailed(item) {
  if (statusLooksFailed(item.status)) return true;
  const text = [item.status, item.output].filter(Boolean).join("\n");
  return hasRiskText(text);
}

function verificationCommandCandidates(item) {
  return shellCommandCandidates(item, item?.arguments);
}

function shellCommandCandidates(item, fallbackCommand) {
  const raw = String(item?.arguments || "");
  const parsed = parseMaybeJson(raw);
  const candidates = [];
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    for (const key of ["cmd", "command", "script", "shellCommand"]) {
      if (parsed[key]) candidates.push(String(parsed[key]));
    }
  }
  if (!candidates.length && fallbackCommand) candidates.push(String(fallbackCommand));
  return uniqueTags(candidates.map((candidate) => candidate.trim()).filter(Boolean));
}

function isVerificationCommand(text) {
  return shellCommandSegments(text).some((segment) => {
    const normalized = stripShellWrapper(segment);
    return (
      verificationPackageCommandPattern.test(normalized) ||
      verificationDirectCommandPattern.test(normalized) ||
      verificationHealthCommandPattern.test(normalized)
    );
  });
}

function shellCommandSegments(text) {
  return splitShellSegments(String(text || ""))
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function splitShellSegments(text) {
  const segments = [];
  let segment = "";
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quote) {
      segment += char;
      if (char === quote && text[index - 1] !== "\\") quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      segment += char;
      continue;
    }
    if (char === "\r" || char === "\n" || char === ";" || char === "|") {
      segments.push(segment);
      segment = "";
      if ((char === "|" && next === "|") || (char === "&" && next === "&")) index += 1;
      continue;
    }
    if (char === "&" && next === "&") {
      segments.push(segment);
      segment = "";
      index += 1;
      continue;
    }
    segment += char;
  }
  segments.push(segment);
  return segments;
}

function stripShellWrapper(segment) {
  let text = String(segment || "").trim();
  text = text.replace(/^(?:cmd(?:\.exe)?\s+\/[cs]\s+|powershell(?:\.exe)?\s+(?:-[\w-]+\s+)*|pwsh(?:\.exe)?\s+(?:-[\w-]+\s+)*)/i, "");
  return text.replace(/^["'](.+)["']$/s, "$1").trim();
}

function isDangerousCommandSegment(segment) {
  const text = String(segment || "").trim();
  if (!text) return false;
  if (/^git\s+(?:reset|clean)\b/i.test(text)) return true;
  if (/^(?:Remove-Item|Remove-Az|Remove-AD)\b/i.test(text)) return true;
  if (/^rmdir\s+\/s\b/i.test(text)) return true;
  if (/^(?:rm|del|drop|delete)\b/i.test(text)) return true;
  if (/^(?:format|format\.com)(?:\s|$)/i.test(text)) return true;
  if (/^Format-Volume\b/i.test(text)) return true;
  return false;
}

function parseMaybeJson(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed || !/^[{[]/.test(trimmed)) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function evidenceStatus(item) {
  if (statusLooksFailed(item.status)) return "failed";
  return item.status || (item.output == null ? "missing" : "completed");
}

function statusLooksFailed(status) {
  return /failed|failure|error|非零|失败|错误/i.test(String(status || ""));
}

function largePayloadLength(value) {
  return String(value || "").length > 100_000;
}

function riskTitle(level) {
  if (level === "high") return "风险 · 高";
  if (level === "medium") return "风险 · 中";
  if (level === "low") return "风险 · 低";
  return "风险";
}

function itemRef(turnIndex, itemIndex, item) {
  return `${turnIndex ?? "x"}:${itemIndex ?? item?.id ?? "x"}:${item?.type || "item"}`;
}

function auditId(type, turnIndex, itemIndex, item, suffix = "") {
  const source = item?.outputSourceIndex != null && suffix === "output" ? item.outputSourceIndex : item?.sourceIndex;
  return ["audit", type, turnIndex, itemIndex, source ?? item?.id ?? item?.type, suffix].filter((part) => part !== "").join(":");
}

function traceItemNodeId(turnIndex, itemIndex, item) {
  return item?.type === "tool-call" ? `item:${turnIndex}:${itemIndex}:${item.id || item.type}` : null;
}

function countAuditNodes(nodes) {
  const counts = {
    intent: 0,
    reasoning: 0,
    action: 0,
    evidence: 0,
    verification: 0,
    risk: 0,
    final: 0,
    total: nodes.length,
  };
  for (const node of nodes) {
    if (node.type in counts) counts[node.type] += 1;
  }
  counts.highRisk = nodes.filter((node) => node.type === "risk" && node.riskLevel === "high").length;
  counts.mediumRisk = nodes.filter((node) => node.type === "risk" && node.riskLevel === "medium").length;
  counts.lowRisk = nodes.filter((node) => node.type === "risk" && node.riskLevel === "low").length;
  return counts;
}

function cleanAuditUserText(text) {
  const raw = String(text || "").trim();
  const latestRequest = raw.match(/## My request for Codex:\s*([\s\S]*)$/i)?.[1];
  return (latestRequest || raw)
    .replace(/^#?\s*AGENTS\.md instructions[\s\S]*?(?:<\/environment_context>|$)\s*/i, "")
    .replace(/^<environment_context>[\s\S]*?<\/environment_context>\s*/i, "")
    .replace(/^# In app browser:[\s\S]*?## My request for Codex:\s*/i, "")
    .replace(/^# Files mentioned by the user:[\s\S]*?## My request for Codex:\s*/i, "")
    .trim();
}

function isUsefulAuditIntent(text) {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  if (/^#?\s*AGENTS\.md instructions/i.test(normalized)) return false;

  if (/^<environment_context>/i.test(normalized)) return false;
  return true;
}

function preview(value, max = previewLimits.summary) {
  return firstLine(String(value || ""), max);
}

function maxRiskLevel(left = "none", right = "none") {
  return riskRank[right] > riskRank[left] ? right : left;
}

function addTags(node, tags) {
  node.tags = uniqueTags([...(node.tags || []), ...tags]);
}

function uniqueTags(tags) {
  return [...new Set(tags.filter(Boolean).map((tag) => String(tag)))];
}

export {
  buildAuditChain,
  cleanAuditUserText,
  hasFinalVerificationClaim,
  isDangerousCommand,
  isVerificationText,
  riskSignalsForAction,
  riskSignalsForEvidence,
};
