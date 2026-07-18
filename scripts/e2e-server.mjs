import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { sessionEvents, sessionId, sessionTitle } from "../test/e2e/fixture-session.mjs";

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "csr-e2e-"));
const codexHome = path.join(tempRoot, ".codex");
const sessionDir = path.join(codexHome, "sessions", "isolated");
const sessionPath = path.join(sessionDir, `rollout-2025-01-02T03-04-05-${sessionId}.jsonl`);

await mkdir(sessionDir, { recursive: true });
await writeFile(sessionPath, `${sessionEvents.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
await writeFile(path.join(codexHome, "session_index.jsonl"), `${JSON.stringify({ id: sessionId, thread_name: sessionTitle })}\n`, "utf8");
await utimes(sessionPath, new Date(), new Date());

process.env.CODEX_HOME = codexHome;
process.env.HOME = tempRoot;
process.env.USERPROFILE = tempRoot;
process.env.PI_AGENT_SESSIONS_ROOT = path.join(tempRoot, "missing-pi-sessions");
process.env.CODEX_SESSION_DETAIL_MAX_EVENTS = "4";
process.env.HOST = "127.0.0.1";
process.env.PORT = process.env.PORT || "4799";

const { startServer } = await import(`${pathToFileURL(path.resolve("server.mjs")).href}?e2e=${Date.now()}`);
const server = startServer();
let stopped = false;

async function stop() {
  if (stopped) return;
  stopped = true;
  await new Promise((resolve) => server.close(resolve));
  await rm(tempRoot, { recursive: true, force: true });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    void stop().finally(() => process.exit(0));
  });
}