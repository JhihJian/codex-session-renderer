import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const config = JSON.parse(process.env.HARNESS_DEFECT_CONFIG || "{}");
const workdir = process.env.HARNESS_DEFECT_WORKDIR;
if (!workdir) throw new Error("HARNESS_DEFECT_WORKDIR is required");

const provider = await createFixedProvider();
const agentDir = path.join(workdir, "agent");
const sessionDir = path.join(workdir, "sessions");
await fs.mkdir(agentDir, { recursive: true });
await fs.writeFile(path.join(agentDir, "models.json"), JSON.stringify({
  providers: {
    fixture: {
      baseUrl: provider.baseUrl,
      api: "openai-completions",
      apiKey: "fixture-key",
      compat: { supportsDeveloperRole: false, supportsReasoningEffort: false, supportsUsageInStreaming: false },
      models: [{ id: "fixture-model", contextWindow: 4096, maxTokens: 256 }],
    },
  },
}), "utf8");

try {
  const output = await execute(config.piCommand || "pi", [
    "--mode", "json",
    "--model", "fixture/fixture-model",
    "--api-key", "fixture-key",
    "--no-extensions",
    "--no-skills",
    "--no-context-files",
    "Return a short acknowledgement without using tools.",
  ], {
    cwd: workdir,
    env: {
      ...process.env,
      PI_CODING_AGENT_DIR: agentDir,
      PI_CODING_AGENT_SESSION_DIR: sessionDir,
      PI_OFFLINE: "1",
    },
  });
  if (output.code !== 0) {
    process.stderr.write(output.stderr);
    process.exitCode = output.code || 1;
  } else {
    const trace = output.stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    process.stdout.write(`${JSON.stringify({ trace })}\n`);
  }
} finally {
  await provider.close();
}

function createFixedProvider() {
  const server = createServer(async (req, res) => {
    req.resume();
    if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    res.write(`data: ${JSON.stringify({
      id: "fixture-response",
      object: "chat.completion.chunk",
      created: 0,
      model: "fixture-model",
      choices: [{ index: 0, delta: { role: "assistant", content: "Acknowledged." }, finish_reason: null }],
    })}\n\n`);
    res.write(`data: ${JSON.stringify({
      id: "fixture-response",
      object: "chat.completion.chunk",
      created: 0,
      model: "fixture-model",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        close: () => new Promise((done) => server.close(done)),
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