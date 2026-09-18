import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertBoundedDiagnosticEndpoints } from "./server-http-smoke-helpers.mjs";

const sessionId = "33333333-3333-4333-8333-333333333333";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address());
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

test("HTTP diagnostic endpoints enforce scan and byte budgets", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "csr-server-http-smoke-"));
  const codexHome = path.join(root, ".codex");
  const sessionDir = path.join(codexHome, "sessions", "2026", "07", "19");
  const sessionPath = path.join(sessionDir, `rollout-2026-07-19T10-00-00-${sessionId}.jsonl`);
  const previous = Object.fromEntries(["CODEX_HOME", "HOME", "USERPROFILE", "PI_AGENT_SESSIONS_ROOT", "CODEX_SESSION_DIAGNOSTIC_MAX_EVENT_SCAN"].map((key) => [key, process.env[key]]));
  let server;
  await mkdir(sessionDir, { recursive: true });
  const events = Array.from({ length: 10_002 }, (_, index) => ({ type: "event_msg", payload: { type: "agent_message", message: `event-${index}` } }));
  await writeFile(sessionPath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
  process.env.CODEX_HOME = codexHome;
  process.env.HOME = root;
  process.env.USERPROFILE = root;
  process.env.CODEX_SESSION_DIAGNOSTIC_MAX_EVENT_SCAN = "10001";
  delete process.env.PI_AGENT_SESSIONS_ROOT;
  t.after(async () => {
    if (server?.listening) await close(server);
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  });

  const moduleUrl = `${pathToFileURL(path.resolve("server.mjs")).href}?serverHttpSmoke=${Date.now()}`;
  const { createRendererServer } = await import(moduleUrl);
  server = createRendererServer();
  const address = await listen(server);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const requestJson = async (originOrPath, pathname = "") => {
    const response = await fetch(pathname ? `${originOrPath}${pathname}` : `${baseUrl}${originOrPath}`);
    return { response, body: await response.json() };
  };
  const diagnosticEvents = await requestJson(`/api/sources/local/query/sessions/${sessionId}/events?limit=2`);
  assert.equal(diagnosticEvents.response.status, 200);
  await assertBoundedDiagnosticEndpoints({ baseUrl, fs: { writeFile }, diagnosticEvents, sessionId, requestJson, sessionDir });
});