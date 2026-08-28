import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { sessionEvents, sessionId, sessionTitle } from "../test/e2e/fixture-session.mjs";
import { piGoalArchivePrefix, piGoalPrompt, piGoalState, piGoalStateEvent, piGoalUserEvent } from "../test/helpers/pi-goal-fixture.mjs";
import { knownCodexGoalControlText } from "../src/pi-goal-projection.mjs";
import { createSnapshotShareHandler } from "../src/snapshot-share.mjs";

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "csr-e2e-"));
const codexHome = path.join(tempRoot, ".codex");
const harnessLabRoot = path.join(tempRoot, "harness-defects");
const sessionDir = path.join(codexHome, "sessions", "isolated");
const sessionPath = path.join(sessionDir, `rollout-2025-01-02T03-04-05-${sessionId}.jsonl`);
const codexGoalSessionId = "77777777-7777-4777-8777-777777777777";
const codexGoalObjective = "Codex Goal 默认阅读只显示这个真实目标";
const longTitleSessionId = "88888888-8888-4888-8888-888888888888";
const longTitleSuffix = "CHROMIUM_LONG_TITLE_SUFFIX";
const longTypeSuffix = "CHROMIUM_LONG_TITLE_ERROR_TOOL_AFTER_DISPLAY_LIMIT";
const longCanonicalTitle = `Chromium 标题前缀 ${"x".repeat(1000)} ${longTitleSuffix} ${longTypeSuffix}`;
const codexGoalControl = knownCodexGoalControlText(codexGoalObjective, 0);
const codexGoalSessionPath = path.join(sessionDir, `rollout-2025-01-02T03-04-06-${codexGoalSessionId}.jsonl`);
const longTitleSessionPath = path.join(sessionDir, `rollout-2025-01-02T03-04-07-${longTitleSessionId}.jsonl`);
const piSessionsRoot = path.join(tempRoot, ".pi", "agent", "sessions");
const piSessionId = "44444444-4444-4444-8444-444444444444";
const piSessionPath = path.join(piSessionsRoot, "e2e-pi-session.jsonl");
const piGoalSessionId = "66666666-6666-4666-8666-666666666666";
const piGoalObjective = "Pi Goal 默认阅读只显示这个目标";
const piGoalSessionPath = path.join(piSessionsRoot, `2026-07-18T00-00-00-000Z_${piGoalSessionId}.jsonl`);
const piLargeSessionId = "55555555-5555-4555-8555-555555555555";
const piLargePrompt = "Pi 大会话前缀任务可被归档";
const piLargeSessionPath = path.join(piSessionsRoot, "e2e-pi-large-session.jsonl");
const remoteCodexHome = path.join(tempRoot, "remote", ".codex");
const remoteSessionDir = path.join(remoteCodexHome, "sessions", "isolated");
const remoteToken = "e2e-remote-index-token";
const remoteLongTitleSuffix = "CHROMIUM_REMOTE_LONG_TITLE_ERROR_TOOL_AFTER_DISPLAY_LIMIT";

await mkdir(sessionDir, { recursive: true });
await writeFile(sessionPath, `${sessionEvents.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
await writeFile(
  codexGoalSessionPath,
  `${[
    { type: "session_meta", payload: { session_id: codexGoalSessionId, id: codexGoalSessionId, cwd: "/workspace/codex-goal" } },
    { type: "event_msg", payload: { type: "thread_goal_updated", threadId: codexGoalSessionId, goal: { threadId: codexGoalSessionId, objective: codexGoalObjective, status: "active", tokensUsed: 0, timeUsedSeconds: 0, createdAt: 1, updatedAt: 1 } } },
    { type: "event_msg", payload: { type: "task_started", turn_id: "codex-goal-turn" } },
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: codexGoalControl }], internal_chat_message_metadata_passthrough: { turn_id: "71ef01e9-6165-44c4-af82-1ebbb0e42a2b" } } },
  ].map((event) => JSON.stringify(event)).join("\n")}\n`,
  "utf8",
);
await writeFile(
  longTitleSessionPath,
  `${JSON.stringify({ type: "session_meta", payload: { cwd: "/workspace/long-title" } })}\n${JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "Chromium 长标题详情" } })}\n`,
  "utf8",
);
await writeFile(path.join(codexHome, "session_index.jsonl"), `${JSON.stringify({ id: sessionId, thread_name: sessionTitle })}\n${JSON.stringify({ id: codexGoalSessionId, thread_name: codexGoalControl })}\n${JSON.stringify({ id: longTitleSessionId, thread_name: longCanonicalTitle })}\n`, "utf8");
await utimes(sessionPath, new Date(), new Date());
await utimes(codexGoalSessionPath, new Date(Date.now() - 1000), new Date(Date.now() - 1000));
await utimes(longTitleSessionPath, new Date(Date.now() - 2000), new Date(Date.now() - 2000));
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
const piGoal = piGoalState(piGoalObjective);
await writeFile(
  piGoalSessionPath,
  `${[
    { type: "session", version: 3, id: piGoalSessionId, timestamp: new Date().toISOString(), cwd: "/workspace/pi-goal" },
    piGoalStateEvent("goal-state", piGoalSessionId, piGoal),
    piGoalUserEvent("goal-user", "goal-state", piGoalPrompt("start", piGoal)),
    { type: "message", id: "goal-assistant", parentId: "goal-user", timestamp: new Date().toISOString(), message: { role: "assistant", content: [{ type: "text", text: "正在处理目标" }] } },
  ].map((event) => JSON.stringify(event)).join("\n")}\n`,
  "utf8",
);
await writeFile(
  piLargeSessionPath,
  `${[
    ...piGoalArchivePrefix({ sessionId: piLargeSessionId, cwd: "/workspace/pi-agent-large", objective: piLargePrompt, timestamp: new Date().toISOString() }),
    { type: "message", id: "pi-large-assistant", parentId: "goal-objective", timestamp: new Date().toISOString(), message: { role: "assistant", content: [{ type: "text", text: "x".repeat(Math.ceil(4.8 * 1024 * 1024)) }] } },
  ].map((event) => JSON.stringify(event)).join("\n")}\n`,
  "utf8",
);
await utimes(piLargeSessionPath, new Date(), new Date());
await utimes(piSessionPath, new Date(Date.now() + 1000), new Date(Date.now() + 1000));
await mkdir(remoteSessionDir, { recursive: true });
const remoteIndexRows = [];
for (let index = 1; index <= 101; index += 1) {
  const id = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  const filePath = path.join(remoteSessionDir, `rollout-2026-06-27T01-00-00-${id}.jsonl`);
  await writeFile(filePath, "{}\n", "utf8");
  await utimes(filePath, new Date("2026-06-27T01:00:00.000Z"), new Date("2026-06-27T01:00:00.000Z"));
  const title = index === 101
    ? `远端标题 ${"x".repeat(1000)} ${remoteLongTitleSuffix}`
    : `远端历史分页任务 ${String(index).padStart(3, "0")}`;
  remoteIndexRows.push(JSON.stringify({ id, thread_name: title, updated_at: "2026-06-27T01:00:00.000Z" }));
}
await writeFile(path.join(remoteCodexHome, "session_index.jsonl"), `${remoteIndexRows.join("\n")}\n`, "utf8");
await mkdir(harnessLabRoot, { recursive: true });
await writeFile(path.join(harnessLabRoot, "registry.json"), `${JSON.stringify({
  version: 2,
  archives: [{ id: "A-harness", sourceId: "pi-agent", sessionId: "harness-session", sha256: "a".repeat(64), createdAt: "2026-08-01T08:00:00.000Z" }],
  candidates: [
    { id: "C-fixture", archiveId: "A-harness", status: "fixture_ready", observation: "JSON 模式在 provider 错误后仍以 0 退出。", suspectedRule: "provider 错误必须以非零状态退出。", eventIndex: 12, eventType: "response_item", createdAt: "2026-08-01T08:00:00.000Z", updatedAt: "2026-08-01T08:00:00.000Z" },
    { id: "C-blocked", archiveId: "A-harness", status: "blocked", reason: "verifiable_sandbox_required", observation: "重复工具调用尚未经过可信复现。", suspectedRule: "同一工具调用只能执行一次。", eventIndex: 24, eventType: "tool_execution_end", createdAt: "2026-08-02T08:00:00.000Z", updatedAt: "2026-08-02T08:00:00.000Z" },
    { id: "C-confirmed", archiveId: "A-harness", status: "confirmed", observation: "确认的事件计数不变量。", suspectedRule: "工具执行次数必须为 0。", eventIndex: 36, eventType: "tool_execution_end", createdAt: "2026-08-03T08:00:00.000Z", updatedAt: "2026-08-03T08:00:00.000Z" },
  ],
  reproductions: [{ id: "R-fixture", candidateId: "C-fixture", trust: "untrusted_legacy_runner", status: "inconclusive", reason: "trusted_executor_required", fixture: { command: "node fixture/run.mjs", predicate: "provider_error_exit", path: "fixture.json" }, comparison: { candidate: { failed: true, runs: [{ failed: true, trace: [{ type: "error" }] }] }, baseline: { failed: false, runs: [{ failed: false, trace: [] }] } } }],
  defects: [{ id: "H-EXIT-001", title: "JSON 模式错误退出码", candidateId: "C-confirmed", predicate: { id: "no_successful_exit_on_error", type: "event_count", eventType: "tool_execution_end", expected: 0 }, status: "confirmed", decision: { reason: "all_confirmation_gates_passed" }, createdAt: "2026-08-03T08:00:00.000Z" }],
  evidence: [{ id: "E-assertion", candidateId: "C-confirmed", kind: "assertion", sha256: "b".repeat(64) }, { id: "E-fixture", candidateId: "C-confirmed", kind: "fixture_manifest", sha256: "c".repeat(64) }],
  reviews: [{ id: "V-1", candidateId: "C-confirmed", decision: "accept", blind: true, recomputedPredicate: true }],
  timeline: [],
})}\n`, "utf8");

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
const slowRemoteServer = createServer((req, res) => {
  if (req.url?.startsWith("/api/codex-snapshot.tar")) {
    res.writeHead(200, { "content-type": "application/x-tar" });
    res.write("slow snapshot response");
    return;
  }
  res.writeHead(404).end();
});
await new Promise((resolve, reject) => {
  slowRemoteServer.once("error", reject);
  slowRemoteServer.listen(0, "127.0.0.1", () => {
    slowRemoteServer.off("error", reject);
    resolve();
  });
});
const slowRemoteAddress = slowRemoteServer.address();

process.env.CODEX_HOME = codexHome;
process.env.HOME = tempRoot;
process.env.USERPROFILE = tempRoot;
process.env.PI_AGENT_SESSIONS_ROOT = piSessionsRoot;

process.env.CODEX_REMOTE_PEERS = `office|E2E 远端索引=http://127.0.0.1:${remoteAddress.port},slow-office|E2E 慢速远端=http://127.0.0.1:${slowRemoteAddress.port}`;
process.env.CODEX_REMOTE_TOKEN = remoteToken;
process.env.CODEX_REMOTE_SOURCES = "";
process.env.HOST = "127.0.0.1";
process.env.PORT = process.env.PORT || "4799";
process.env.HARNESS_DEFECT_LAB_ROOT = harnessLabRoot;

const { startServer } = await import(`${pathToFileURL(path.resolve("server.mjs")).href}?e2e=${Date.now()}`);
const server = startServer();
let stopped = false;

async function stop() {
  if (stopped) return;
  stopped = true;
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => remoteServer.close(resolve));
  await new Promise((resolve) => slowRemoteServer.close(resolve));
  await rm(tempRoot, { recursive: true, force: true });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    void stop().finally(() => process.exit(0));
  });
}