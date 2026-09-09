function piEmbeddedSubagentCall(argumentsValue) {
  const argumentsObject = parseObject(argumentsValue);
  if (!argumentsObject) return null;
  const requested = Array.isArray(argumentsObject.tasks) && argumentsObject.tasks.length
    ? argumentsObject.tasks.map((task, index) => requestedTask(task, index)).filter(Boolean)
    : [requestedTask(argumentsObject, 0)].filter(Boolean);
  if (!requested.length && !stringValue(argumentsObject.mode)) return null;
  return { source: "pi-agent", mode: stringValue(argumentsObject.mode) || "single", agentScope: stringValue(argumentsObject.agentScope), requested, results: [], status: "pending" };
}

function piEmbeddedSubagentResult(batch, rawEvent, output = "") {
  if (!batch || batch.source !== "pi-agent") return batch || null;
  const details = rawEvent?.message?.details ?? rawEvent?.payload?.message?.details;
  const rawResults = Array.isArray(details?.results) ? details.results : [];
  const results = rawResults.length
    ? rawResults.map((result, index) => resultProjection(result, index)).filter(Boolean)
    : resultlessFailure(batch, rawEvent, output);
  return { ...batch, mode: stringValue(details?.mode) || batch.mode, agentScope: stringValue(details?.agentScope) || batch.agentScope, results, status: batchStatus(results) };
}

function resultlessFailure(batch, rawEvent, output) {
  const text = String(output || "").trim();
  const isInvalidRequest = /^Invalid parameters\./i.test(text);
  const isError = rawEvent?.message?.isError === true;
  if (!isInvalidRequest && !isError) return [];
  return [{
    index: 0,
    agent: batch.requested?.[0]?.agent || "未指定代理",
    agentSource: null,
    status: isInvalidRequest ? "invalid_request" : "failed",
    exitCode: null,
    stopReason: null,
    summary: text,
    summaryLength: text.length,
  }];
}

function requestedTask(value, index) {
  if (!value || typeof value !== "object") return null;
  const agent = stringValue(value.agent);
  const task = stringValue(value.task);
  return agent || task ? { index, agent: agent || "未指定代理", task: task || null } : null;
}

function resultProjection(value, index) {
  if (!value || typeof value !== "object") return null;
  const failure = resultFailure(value);
  const stopReason = stringValue(value.stopReason);
  const exitCode = finiteNumber(value.exitCode);
  const status = failure
    ? /(?:^|\D)429(?:\D|$)|rate.?limit/i.test(failure) ? "rate_limited" : "failed"
    : stopReason === "error" || (exitCode != null && exitCode !== 0) ? "failed" : exitCode === 0 || stopReason === "stop" ? "succeeded" : "unknown";
  const summary = failure || resultText(value);
  const agentSource = stringValue(value.agentSource);
  return { index, agent: stringValue(value.agent) || "未指定代理", agentSource: agentSource === "unknown" ? null : agentSource, status, exitCode, stopReason, summary, summaryLength: String(summary || "").length };
}

function resultFailure(result) {
  const direct = stringValue(result.errorMessage) || stringValue(result.error?.message) || stringValue(result.error);
  if (direct) return direct;
  for (const message of [...(Array.isArray(result.messages) ? result.messages : [])].reverse()) {
    const error = stringValue(message?.errorMessage) || stringValue(message?.error?.message) || stringValue(message?.error);
    if (error) return error;
  }
  return "";
}

function resultText(result) {
  for (const message of [...(Array.isArray(result.messages) ? result.messages : [])].reverse()) {
    if (message?.role !== "assistant") continue;
    for (const part of Array.isArray(message.content) ? message.content : []) if (part?.type === "text" && stringValue(part.text)) return String(part.text).trim();
  }
  return "";
}

function batchStatus(results) {
  if (!results.length) return "unknown";
  return new Set(results.map((result) => result.status)).size === 1 ? results[0].status : "partial";
}

function parseObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null; } catch { return null; }
}

function stringValue(value) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function finiteNumber(value) { const number = Number(value); return Number.isFinite(number) ? number : null; }
export { piEmbeddedSubagentCall, piEmbeddedSubagentResult };