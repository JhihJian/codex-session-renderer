import { createHash, randomUUID } from "node:crypto";

const attemptsPerVariant = 3;

async function runTrustedEpoch(input = {}) {
  const adapter = input.sandboxAdapter;
  const manifest = validateManifest(input.manifest);
  if (!adapter || typeof adapter.execute !== "function") return { status: "blocked", reason: "sandbox_adapter_required" };
  const epochId = input.epochId || `EPOCH-${randomUUID()}`;
  const runs = [];
  for (const variant of ["candidate", "baseline"]) {
    for (let attempt = 0; attempt < attemptsPerVariant; attempt += 1) {
      const response = await adapter.execute({ argv: manifest.variants[variant].argv, environment: manifest.variants[variant].environment, runtime: manifest.runtime });
      if (response.status !== "complete" || response.sandboxReceipt?.enforced !== true) return { status: response.status === "blocked" ? "blocked" : "inconclusive", reason: response.reason || "sandbox_execution_incomplete", epoch: { id: epochId, sandboxReceipt: response.sandboxReceipt, runs } };
      const evaluated = evaluateRawArtifact(manifest.predicate, response.artifact);
      runs.push({ runId: response.artifact.runId, variant, failed: evaluated.failed, actual: evaluated.actual, artifactHash: response.artifactHash });
    }
  }
  return { status: "complete", epoch: { id: epochId, sandboxReceipt: runs.length ? { enforced: true, policyDigest: digest(manifest.sandboxPolicy) } : null, runs } };
}

function evaluateRawArtifact(predicate, artifact) {
  const events = parseEvents(artifact.stdout);
  if (predicate.type === "event_count") {
    const count = events.filter((event) => event?.type === predicate.eventType).length;
    return { failed: count !== predicate.expected, actual: { count, eventType: predicate.eventType, expected: predicate.expected, exitCode: artifact.exitCode } };
  }
  if (predicate.type === "exit_code") return { failed: artifact.exitCode !== predicate.expected, actual: { exitCode: artifact.exitCode, expected: predicate.expected } };
  throw executorError(`不支持的谓词类型：${predicate.type}`);
}

function parseEvents(stdout) {
  const lines = String(stdout || "").split(/\r?\n/).filter(Boolean);
  const events = [];
  for (const line of lines) { try { const parsed = JSON.parse(line); if (Array.isArray(parsed?.events)) events.push(...parsed.events); else events.push(parsed); } catch { /* non-event stdout remains captured raw */ } }
  return events;
}

function validateManifest(value) {
  if (!value || typeof value !== "object") throw executorError("manifest 必须是对象。");
  for (const variant of ["candidate", "baseline"]) if (!Array.isArray(value.variants?.[variant]?.argv) || !value.variants[variant].argv.length) throw executorError(`${variant} argv 缺失。`);
  if (!value.predicate || typeof value.predicate !== "object") throw executorError("predicate 缺失。");
  if (!value.sandboxPolicy || value.sandboxPolicy.enforced !== true) throw executorError("manifest 没有可验证 sandbox policy。");
  return value;
}
function digest(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function executorError(message) { const error = new Error(message); error.code = "trusted_executor_error"; return error; }

export { evaluateRawArtifact, runTrustedEpoch };