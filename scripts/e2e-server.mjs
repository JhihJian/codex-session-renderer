import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { sessionEvents, sessionId, sessionTitle } from "../test/e2e/fixture-session.mjs";
import { piGoalArchivePrefix, piGoalPrompt, piGoalState, piGoalStateEvent, piGoalUserEvent } from "../test/helpers/pi-goal-fixture.mjs";
import { knownCodexGoalControlText } from "../src/pi-goal-projection.mjs";

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "csr-e2e-"));
const codexHome = path.join(tempRoot, ".codex");
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
    { type: "model_change", id: "pi-model", timestamp: new Date().toISOString(), provider: "local-sub2api", modelId: "gpt-5.6-terra" },
    { type: "session_info", id: "pi-info", timestamp: new Date().toISOString(), name: "Pi 可切换会话" },
    { type: "message", id: "pi-user", timestamp: new Date().toISOString(), message: { role: "user", content: [{ type: "text", text: "Pi 来源可读会话" }] } },
    { type: "message", id: "pi-tool-call", parentId: "pi-user", timestamp: new Date().toISOString(), message: { role: "assistant", content: [{ type: "text", text: "开始检查" }, { type: "toolCall", id: "pi-trace-tool", name: "bash", arguments: { command: "pwd" } }] } },
    { type: "message", id: "pi-tool-result", parentId: "pi-tool-call", timestamp: new Date().toISOString(), message: { role: "toolResult", toolCallId: "pi-trace-tool", toolName: "bash", content: [{ type: "text", text: "/workspace/pi-agent" }] } },
    { type: "message", id: "pi-final", parentId: "pi-tool-result", timestamp: new Date().toISOString(), message: { role: "assistant", content: [{ type: "text", text: "检查完成，等待下一次输入。" }], usage: { input: 8000, output: 200, reasoning: 10, totalTokens: 8210 } } },
    { type: "message", id: "pi-skill", parentId: "pi-final", timestamp: new Date().toISOString(), message: { role: "user", content: [{ type: "text", text: '<skill name="release-check" location="/workspace/pi-agent/.agents/skills/release-check/SKILL.md">执行发布检查。</skill>\n\n检查当前分支。' }] } },
    { type: "message", id: "pi-skill-read", parentId: "pi-skill", timestamp: new Date().toISOString(), message: { role: "assistant", content: [{ type: "toolCall", id: "pi-read-skill", name: "read", arguments: { path: "/workspace/pi-agent/.agents/skills/release-check/SKILL.md" } }] } },
    { type: "message", id: "pi-skill-output", parentId: "pi-skill-read", timestamp: new Date().toISOString(), message: { role: "toolResult", toolCallId: "pi-read-skill", toolName: "read", content: [{ type: "text", text: "# release-check" }], isError: false } },
    { type: "message", id: "pi-subagent-call", parentId: "pi-skill-output", timestamp: new Date().toISOString(), message: { role: "assistant", content: [{ type: "toolCall", id: "pi-subagent", name: "subagent", arguments: { mode: "single", agent: "reviewer", task: "审查当前分支" } }] } },
    { type: "message", id: "pi-subagent-result", parentId: "pi-subagent-call", timestamp: new Date().toISOString(), message: { role: "toolResult", toolCallId: "pi-subagent", toolName: "subagent", content: [{ type: "text", text: "审查完成" }], details: { mode: "single", results: [{ agent: "reviewer", exitCode: 0, stopReason: "stop", messages: [{ role: "assistant", content: [{ type: "text", text: "审查完成" }] }] }] }, isError: false } },
    { type: "compaction", id: "pi-compaction", parentId: "pi-subagent-result", timestamp: new Date().toISOString(), summary: "保留当前任务、Skill 读取结果和验证结论。", tokensBefore: 90000, retainedTail: [{ role: "user" }] },
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
process.env.CODEX_HOME = codexHome;
process.env.HOME = tempRoot;
process.env.USERPROFILE = tempRoot;
process.env.PI_AGENT_SESSIONS_ROOT = piSessionsRoot;

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