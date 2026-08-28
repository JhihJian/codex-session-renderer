import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const config = JSON.parse(process.env.HARNESS_DEFECT_CONFIG || "{}");
const workdir = process.env.HARNESS_DEFECT_WORKDIR;
if (!workdir) throw new Error("HARNESS_DEFECT_WORKDIR is required");

const provider = await createFailingProvider();
const agentDir = path.join(workdir, "agent");
await fs.mkdir(agentDir, { recursive: true });
await fs.writeFile(path.join(agentDir, "models.json"), JSON.stringify({
  providers: {
    fixture: {
      baseUrl: provider.baseUrl,
      api: "openai-completions",
      apiKey: "fixture-key",
      compat: { supportsDeveloperRole: false, supportsReasoningEffort: false, supportsUsageInStreaming: false },
      models: [{ id: "fixture-model", contextWindow: 4096, maxTokens: 256 }]
    }
  }
}), "utf8");

try {
  const mode = config.mode === "json" ? ["--mode", "json"] : ["-p"];
  const result = await execute("pi", [
    ...mode,
    "--model", "fixture/fixture-model",
    "--api-key", "fixture-key",
    "--no-session",
    "--no-extensions",
    "--no-skills",
    "--no-context-files",
    "Return one word."
  ], {
    cwd: workdir,
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" }
  });
  const errorObserved = config.mode === "json"
    ? parseJsonEvents(result.stdout).some((event) => event.type === "message_end" && event.message?.role === "assistant" && event.message.stopReason === "error")
    : result.stderr.includes("400");
  const trace = errorObserved
    ? [{
      type: result.code === 0 ? "successful_exit_after_provider_error" : "provider_error_with_nonzero_exit",
      exitCode: result.code,
      mode: config.mode
    }]
    : [];
  process.stdout.write(`${JSON.stringify({ trace })}\n`);
} finally {
  await provider.close();
}

function parseJsonEvents(text) {
  return text.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

function createFailingProvider() {
  const server = createServer(async (req, res) => {
    req.resume();
    if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "fixture provider rejects the request", type: "invalid_request_error" } }));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
}

function execute(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}