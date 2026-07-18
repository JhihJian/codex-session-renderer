import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { sessionEvents, sessionId, sessionTitle } from "../test/e2e/fixture-session.mjs";
import { createSnapshotShareHandler } from "../src/snapshot-share.mjs";

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "csr-e2e-"));
const codexHome = path.join(tempRoot, ".codex");
const sessionDir = path.join(codexHome, "sessions", "isolated");
const sessionPath = path.join(sessionDir, `rollout-2025-01-02T03-04-05-${sessionId}.jsonl`);
const piSessionsRoot = path.join(tempRoot, ".pi", "agent", "sessions");
const piSessionId = "44444444-4444-4444-8444-444444444444";
const piSessionPath = path.join(piSessionsRoot, "e2e-pi-session.jsonl");
const piLargeSessionId = "55555555-5555-4555-8555-555555555555";
const piLargePrompt = "Pi 大会话前缀任务可被归档";
const piLargeSessionPath = path.join(piSessionsRoot, "e2e-pi-large-session.jsonl");
const remoteCodexHome = path.join(tempRoot, "remote", ".codex");
const remoteSessionDir = path.join(remoteCodexHome, "sessions", "isolated");
const remoteToken = "e2e-remote-index-token";

await mkdir(sessionDir, { recursive: true });
await writeFile(sessionPath, `${sessionEvents.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
await writeFile(path.join(codexHome, "session_index.jsonl"), `${JSON.stringify({ id: sessionId, thread_name: sessionTitle })}\n`, "utf8");
await utimes(sessionPath, new Date(), new Date());
await mkdir(piSessionsRoot, { recursive: true });
await writeFile(
  piSessionPath,
  `${[
    { type: "session", version: 3, id: piSessionId, timestamp: new Date().toISOString(), cwd: "/workspace/pi-agent" },
    { type: "session_info", id: "pi-info", timestamp: new Date().toISOString(), name: "Pi 可切换会话" },
    { type: "message", id: "pi-user", timestamp: new Date().toISOString(), message: { role: "user", content: [{ type: "text", text: "Pi 来源可读会话" }] } },
  ].map((event) => JSON.stringify(event)).join("\n")}\n`,
  "utf8",
);
await writeFile(
  piLargeSessionPath,
  `${[
    { type: "session", version: 3, id: piLargeSessionId, timestamp: new Date().toISOString(), cwd: "/workspace/pi-agent-large" },
    { type: "session_info", id: "pi-large-info", timestamp: new Date().toISOString(), name: "前缀外标题不应显示" },
    { type: "message", id: "pi-large-user", parentId: "pi-large-info", timestamp: new Date().toISOString(), message: { role: "user", content: [{ type: "text", text: piLargePrompt }] } },
    { type: "message", id: "pi-large-assistant", parentId: "pi-large-user", timestamp: new Date().toISOString(), message: { role: "assistant", content: [{ type: "text", text: "x".repeat(Math.ceil(4.8 * 1024 * 1024)) }] } },
  ].map((event) => JSON.stringify(event)).join("\n")}\n`,
  "utf8",
);
await utimes(piLargeSessionPath, new Date(), new Date());
await utimes(piSessionPath, new Date(Date.now() + 1000), new Date(Date.now() + 1000));
await mkdir(remoteSessionDir, { recursive: true });
const remoteIndexRows = [];
for (let index = 1; index <= 101; index += 1) {
  const id = `remote-history-${String(index).padStart(3, "0")}`;
  const filePath = path.join(remoteSessionDir, `rollout-2026-06-27T01-00-00-${id}.jsonl`);
  await writeFile(filePath, "{}\n", "utf8");
  await utimes(filePath, new Date("2026-06-27T01:00:00.000Z"), new Date("2026-06-27T01:00:00.000Z"));
  remoteIndexRows.push(JSON.stringify({ id, thread_name: `远端历史分页任务 ${String(index).padStart(3, "0")}`, updated_at: "2026-06-27T01:00:00.000Z" }));
}
await writeFile(path.join(remoteCodexHome, "session_index.jsonl"), `${remoteIndexRows.join("\n")}\n`, "utf8");

const remoteServer = createServer(createSnapshotShareHandler({
  config: { codexHome: remoteCodexHome, token: remoteToken },
}));
await new Promise((resolve, reject) => {
  remoteServer.once("error", reject);
  remoteServer.listen(0, "127.0.0.1", () => {
    remoteServer.off("error", reject);
    resolve();
  });
});
const remoteAddress = remoteServer.address();

process.env.CODEX_HOME = codexHome;
process.env.HOME = tempRoot;
process.env.USERPROFILE = tempRoot;
process.env.PI_AGENT_SESSIONS_ROOT = piSessionsRoot;
process.env.CODEX_SESSION_DETAIL_MAX_EVENTS = "4";
process.env.CODEX_REMOTE_PEERS = `office|E2E 远端索引=http://127.0.0.1:${remoteAddress.port}`;
process.env.CODEX_REMOTE_TOKEN = remoteToken;
process.env.CODEX_REMOTE_SOURCES = "";
process.env.HOST = "127.0.0.1";
process.env.PORT = process.env.PORT || "4799";

const { startServer } = await import(`${pathToFileURL(path.resolve("server.mjs")).href}?e2e=${Date.now()}`);
const server = startServer();
let stopped = false;

async function stop() {
  if (stopped) return;
  stopped = true;
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => remoteServer.close(resolve));
  await rm(tempRoot, { recursive: true, force: true });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    void stop().finally(() => process.exit(0));
  });
}