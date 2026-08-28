import { createHash } from "node:crypto";

function createHarnessSandboxAdapter(options = {}) {
  const executeInSandbox = options.executeInSandbox;
  const policy = options.policy || null;

  async function execute(request = {}) {
    validateRequest(request);
    if (typeof executeInSandbox !== "function") {
      return blocked(policy, "external_sandbox_backend_required");
    }
    const response = await executeInSandbox({
      argv: [...request.argv],
      environment: cleanEnvironment(request.environment),
      runtime: request.runtime || null,
      policy,
    });
    if (!response?.artifact || response.sandboxReceipt?.enforced !== true || !text(response.sandboxReceipt.policyDigest)) {
      return blocked(policy, "unverifiable_sandbox_receipt");
    }
    return {
      status: response.status === "complete" ? "complete" : "inconclusive",
      artifact: response.artifact,
      artifactHash: text(response.artifactHash) || digest(response.artifact),
      sandboxReceipt: response.sandboxReceipt,
    };
  }
  return { execute, policy };
}

function blocked(policy, reason) { return { status: "blocked", reason, sandboxReceipt: { enforced: false, policyDigest: policy ? digest(policy) : null } }; }
function cleanEnvironment(allowed = {}) { const result = {}; for (const [key, value] of Object.entries(allowed)) if (/^[A-Z_][A-Z0-9_]*$/.test(key) && typeof value === "string") result[key] = value; return result; }
function validateRequest(request) { if (!Array.isArray(request.argv) || request.argv.length === 0 || request.argv.some((item) => !text(item))) throw sandboxError("argv 必须是非空字符串数组。"); }
function text(value) { return typeof value === "string" && value.trim(); }
function digest(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function sandboxError(message) { const error = new Error(message); error.code = "sandbox_error"; return error; }

export { cleanEnvironment, createHarnessSandboxAdapter };