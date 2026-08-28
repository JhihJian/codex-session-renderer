import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import readline from "node:readline";

const detectorDefinitions = [
  { id: "duplicate-tool-call", version: "1", create: duplicateToolCallDetector },
  { id: "missing-tool-result", version: "1", create: missingToolResultDetector },
  { id: "provider-error-exit-status", version: "1", create: providerErrorExitStatusDetector },
  { id: "cancelled-after-execution", version: "1", create: cancelledAfterExecutionDetector },
  { id: "context-projection-invariant", version: "1", create: contextProjectionInvariantDetector },
];

async function discoverHarnessCandidates(input = {}) {
  const selected = selectDetectors(input.detectorIds);
  const detectors = selected.map((definition) => ({ definition, state: definition.create() }));
  const source = required(input.archivePath, "archivePath");
  const result = input.fsApi ? await scanBuffer(await input.fsApi.readFile(source), detectors) : await scanFile(source, detectors);
  if (input.sourceHash && input.sourceHash !== result.sourceHash) throw discoveryError("归档 SHA-256 与扫描输入不匹配。");
  const matches = detectors.flatMap(({ definition, state }) => state.finish().map((match) => draft(definition, result.sourceHash, match)));
  return { ...result, detectors: selected.map(({ id, version }) => ({ id, version })), matches };
}

async function scanFile(file, detectors) {
  const hash = createHash("sha256");
  const stream = createReadStream(file);
  stream.on("data", (chunk) => hash.update(chunk));
  const lineReader = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let index = 0; let eventsScanned = 0; let invalidLines = 0;
  for await (const line of lineReader) {
    if (!line.trim()) continue;
    try { observe(detectors, index, JSON.parse(line)); eventsScanned += 1; } catch { invalidLines += 1; }
    index += 1;
  }
  return { sourceHash: hash.digest("hex"), eventsScanned, invalidLines };
}

async function scanBuffer(source, detectors) {
  const hash = sha256(source); let index = 0; let eventsScanned = 0; let invalidLines = 0;
  for (const line of source.toString("utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { observe(detectors, index, JSON.parse(line)); eventsScanned += 1; } catch { invalidLines += 1; }
    index += 1;
  }
  return { sourceHash: hash, eventsScanned, invalidLines };
}

function observe(detectors, index, value) { for (const detector of detectors) detector.state.observe(index, value); }
function selectDetectors(ids) {
  if (ids === undefined || ids === "all") return detectorDefinitions;
  const requested = String(ids).split(",").map((item) => item.trim()).filter(Boolean);
  const selected = detectorDefinitions.filter((detector) => requested.includes(detector.id));
  if (selected.length !== requested.length) throw discoveryError("存在未知 detectorId。");
  return selected;
}

function duplicateToolCallDetector() {
  const seen = new Map(); const matches = [];
  return { observe(index, value) { for (const id of toolCallIds(value)) { if (seen.has(id)) matches.push({ eventIndex: index, observation: `工具调用 ${id} 在同一快照中重复出现。`, suspectedRule: "同一 tool call 只能执行一次。", evidence: { toolCallId: id, firstIndex: seen.get(id), duplicateIndex: index } }); else seen.set(id, index); } }, finish: () => matches };
}

function missingToolResultDetector() {
  const calls = new Map();
  return { observe(index, value) { for (const id of toolCallIds(value)) calls.set(id, index); for (const id of toolResultIds(value)) calls.delete(id); }, finish: () => [...calls].map(([id, eventIndex]) => ({ eventIndex, observation: `工具调用 ${id} 未找到对应结果。`, suspectedRule: "每个 tool call 必须有对应 tool result。", evidence: { toolCallId: id } })) };
}

function providerErrorExitStatusDetector() { const matches = []; return { observe(index, value) { if (hasProviderError(value)) matches.push({ eventIndex: index, observation: "会话记录了 provider 错误，需验证非交互模式的退出状态。", suspectedRule: "最终 assistant 为 error 时，非交互输出必须返回非零退出码。", evidence: { stopReason: "error" } }); }, finish: () => matches }; }
function cancelledAfterExecutionDetector() { let cancelledAt = null; const matches = []; return { observe(index, value) { if (cancelledAt !== null && toolCallIds(value).length) matches.push({ eventIndex: index, observation: "取消后仍出现工具执行请求。", suspectedRule: "取消后的会话不得继续执行工具。", evidence: { cancelledAt, executionAt: index } }); if (isCancelled(value)) cancelledAt = index; }, finish: () => matches }; }
function contextProjectionInvariantDetector() { const matches = []; return { observe(index, value) { if (hasContextMismatch(value)) matches.push({ eventIndex: index, observation: "上下文投影声明的消息数量与实际消息数量不一致。", suspectedRule: "上下文投影计数必须与事件中的消息数一致。", evidence: projectionCounts(value) }); }, finish: () => matches }; }

function draft(detector, sourceHash, match) { return { detectorId: detector.id, detectorVersion: detector.version, sourceHash, eventIndex: match.eventIndex, eventType: "discovered", observation: match.observation, suspectedRule: match.suspectedRule, evidence: match.evidence, dedupeKey: sha256(`${sourceHash}:${match.eventIndex}:${detector.id}:${detector.version}`) }; }
function toolCallIds(value) { return ids(value, ["toolCallId", "tool_call_id", "call_id"], ["tool_call", "toolCall", "function_call"]); }
function toolResultIds(value) { return ids(value, ["toolCallId", "tool_call_id", "call_id"], ["tool_result", "toolResult", "function_result"]); }
function ids(value, keys, types) { const found = []; walk(value, (item) => { if (item && typeof item === "object" && types.includes(String(item.type || item.kind || ""))) for (const key of keys) if (typeof item[key] === "string") found.push(item[key]); }); return found; }
function hasProviderError(value) { let found = false; walk(value, (item) => { if (item && typeof item === "object" && String(item.stopReason || item.stop_reason || "") === "error") found = true; }); return found; }
function isCancelled(value) { let found = false; walk(value, (item) => { if (item && typeof item === "object" && ["aborted", "cancelled", "canceled"].includes(String(item.stopReason || item.stop_reason || item.status || "").toLowerCase())) found = true; }); return found; }
function hasContextMismatch(value) { const counts = projectionCounts(value); return Number.isSafeInteger(counts?.projected) && Number.isSafeInteger(counts?.actual) && counts.projected !== counts.actual; }
function projectionCounts(value) { if (!value || typeof value !== "object") return null; const projected = value.contextMessageCount ?? value.context_message_count; const actual = Array.isArray(value.contextMessages) ? value.contextMessages.length : Array.isArray(value.context_messages) ? value.context_messages.length : undefined; return { projected, actual }; }
function walk(value, fn) { if (!value || typeof value !== "object") return; fn(value); for (const child of Array.isArray(value) ? value : Object.values(value)) walk(child, fn); }
function required(value, field) { const text = String(value || "").trim(); if (!text) throw discoveryError(`${field} 不能为空。`); return text; }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function discoveryError(message) { const error = new Error(message); error.code = "harness_discovery_error"; return error; }

export { discoverHarnessCandidates };