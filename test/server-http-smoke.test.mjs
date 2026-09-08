import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { remoteSourceVersion } from "../src/data-sources.mjs";
import { assertBoundedDiagnosticEndpoints } from "./server-http-smoke-helpers.mjs";
import { piGoalArchivePrefix } from "./helpers/pi-goal-fixture.mjs";

const sessionId = "11111111-1111-1111-1111-111111111111";
const longTitleSessionId = "12121212-1212-4212-8212-121212121212";
const longTitleSuffix = "LONG_TITLE_SUFFIX_SEARCH_TOKEN";
const longTypeSuffix = "LONG_TITLE_ERROR_TOOL_AFTER_DISPLAY_LIMIT";
const longCanonicalTitle = `标题前缀 ${"x".repeat(1000)} ${longTitleSuffix} ${longTypeSuffix}`;
const envKeys = [
  "CODEX_HOME",
  "HOME",
  "USERPROFILE",
  "CODEX_REMOTE_SOURCES",
  "CODEX_REMOTE_PEERS",
  "CODEX_REMOTE_SOURCE_ID",
  "CODEX_REMOTE_SNAPSHOT_URL",
  "CODEX_REMOTE_SNAPSHOT_PATH",
  "CODEX_REMOTE_SNAPSHOT_ROOT",
  "CODEX_REMOTE_REMOTE_A_SNAPSHOT_ROOT",
  "CODEX_REMOTE_REMOTE_A_CODEX_HOME",
  "CODEX_SESSION_DETAIL_MAX_FILE_BYTES",
  "CODEX_SESSION_DETAIL_MAX_EVENTS",
  "CODEX_SESSION_DIAGNOSTIC_MAX_FILE_BYTES",
  "CODEX_SESSION_DIAGNOSTIC_MAX_EVENT_SCAN",
  "PI_AGENT_SESSIONS_ROOT",
  "PI_AGENT_TASKS_ROOT",
];
const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "csr-http-smoke-"));
const codexHome = path.join(tempRoot, ".codex");
const sessionDir = path.join(codexHome, "sessions", "2026", "07", "08");
const sessionPath = path.join(sessionDir, `rollout-2026-07-08T10-00-00-${sessionId}.jsonl`);
const longTitleSessionPath = path.join(sessionDir, `rollout-2026-07-18T10-00-00-${longTitleSessionId}.jsonl`);
const remoteSnapshotRoot = path.join(tempRoot, "remote-a-source");
const remoteCodexHome = path.join(remoteSnapshotRoot, "current");
const remoteSessionDir = path.join(remoteCodexHome, "sessions", "2026", "07", "08");
const remoteSessionPath = path.join(remoteSessionDir, `rollout-2026-07-08T10-00-00-${sessionId}.jsonl`);
const remoteStateDbPath = path.join(remoteCodexHome, "state_5.sqlite");
const remoteOriginalCodexHome = "/remote/.codex";
const outsideSnapshotSecret = "OUTSIDE_SNAPSHOT_SECRET";
const outsideSnapshotJsonlPath = path.join(tempRoot, "outside-snapshot.jsonl");
const outsideSnapshotPlainPath = path.join(tempRoot, "outside-snapshot.txt");
const outsideJsonlId = "44444444-4444-4444-8444-444444444444";
const outsidePlainId = "55555555-5555-4555-8555-555555555555";
const symlinkEscapeId = "66666666-6666-4666-8666-666666666666";
const mismatchedPathId = "77777777-7777-4777-8777-777777777777";
const piSessionId = "22222222-2222-4222-8222-222222222222";
const piLargeSessionId = "99999999-9999-4999-8999-999999999999";
const piLargePrompt = "Pi 大会话前缀中的首个有效任务";
const piTasksRoot = path.join(tempRoot, "runtime-state", "tasks");
const piTaskId = "task-ca67939a-439f-4015-b7a2-3a858b99c0a2";
const piSessionsRoot = path.join(piTasksRoot, piTaskId, "artifacts", "pi-sessions");
const piProjectDir = path.join(piSessionsRoot, "--D--work-pi-web--");
const piSessionPath = path.join(piProjectDir, `2026-07-10T04-51-55-870Z_${piSessionId}.jsonl`);
const piLargeSessionPath = path.join(piProjectDir, `2026-07-18T04-51-55-870Z_${piLargeSessionId}.jsonl`);
const piRecordId = `${piTaskId}:${piSessionId}`;
const piLargeRecordId = `${piTaskId}:${piLargeSessionId}`;

await fs.mkdir(sessionDir, { recursive: true });
await fs.writeFile(
  sessionPath,
  [
    {
      timestamp: "2026-07-08T10:00:00.000Z",
      type: "session_meta",
      payload: {
        cwd: "D:\\github\\codex-session-renderer",
        originator: "codex_cli",
        model: "gpt-5",
      },
    },
    {
      timestamp: "2026-07-08T10:00:01.000Z",
      type: "event_msg",
      payload: { type: "task_started", turn_id: "turn-smoke" },
    },
    {
      timestamp: "2026-07-08T10:00:02.000Z",
      type: "event_msg",
      payload: { type: "user_message", message: "请生成 HTTP smoke 测试" },
    },
    {
      timestamp: "2026-07-08T10:00:03.000Z",
      type: "event_msg",
      payload: { type: "agent_message", message: "我会覆盖主服务入口。" },
    },
    {
      timestamp: "2026-07-08T10:00:04.000Z",
      type: "response_item",
      payload: { type: "function_call", name: "exec_command", call_id: "call-risk", arguments: "{\"cmd\":\"node scripts/run.mjs\"}" },
    },
    {
      timestamp: "2026-07-08T10:00:05.000Z",
      type: "response_item",
      payload: { type: "function_call_output", call_id: "call-risk", output: "failed with stderr" },
    },
    {
      timestamp: "2026-07-08T10:00:06.000Z",
      type: "event_msg",
      payload: { type: "task_complete", last_agent_message: "HTTP smoke 测试已完成。" },
    },
  ].map((event) => JSON.stringify(event)).join("\n") + "\n",
  "utf8",
);
await fs.writeFile(
  longTitleSessionPath,
  `${JSON.stringify({ type: "session_meta", payload: { cwd: "D:\\github\\codex-session-renderer" } })}\n${JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "列表标题后段搜索 HTTP 回归" } })}\n`,
  "utf8",
);
await fs.writeFile(
  path.join(codexHome, "session_index.jsonl"),
  `${JSON.stringify({ id: sessionId, thread_name: "HTTP smoke 会话", updated_at: "2026-07-08T10:00:06.000Z" })}\n${JSON.stringify({ id: longTitleSessionId, thread_name: longCanonicalTitle, updated_at: "2026-07-18T10:00:06.000Z" })}\n`,
  "utf8",
);
execFileSync("sqlite3", [path.join(codexHome, "state_5.sqlite"), [
  "create table threads (id text, title text, rollout_path text, created_at text, updated_at text, created_at_ms integer, updated_at_ms integer, source text, thread_source text, model_provider text, cwd text, archived integer, archived_at text, model text, reasoning_effort text, agent_nickname text, agent_role text, first_user_message text, preview text)",
  "create table thread_spawn_edges (parent_thread_id text, child_thread_id text, status text)",
  `insert into threads (id, title, rollout_path) values ('${sessionId}', 'SQLite 稳定 HTTP smoke 标题', '/unavailable/${sessionId}.jsonl')`,
  `insert into threads (id, title, rollout_path) values ('${longTitleSessionId}', '${longCanonicalTitle}', '/unavailable/${longTitleSessionId}.jsonl')`,
].join(";")]);
await fs.mkdir(remoteSessionDir, { recursive: true });
await fs.copyFile(sessionPath, remoteSessionPath);
await fs.writeFile(
  path.join(remoteCodexHome, "session_index.jsonl"),
  `${JSON.stringify({ id: sessionId, thread_name: "Remote HTTP smoke 会话", updated_at: "2026-07-08T10:00:06.000Z" })}\n`,
  "utf8",
);
await fs.writeFile(outsideSnapshotJsonlPath, `${JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: outsideSnapshotSecret } })}\n`, "utf8");
await fs.writeFile(outsideSnapshotPlainPath, outsideSnapshotSecret, "utf8");
await fs.symlink(outsideSnapshotJsonlPath, path.join(remoteSessionDir, `rollout-2026-07-08T10-00-00-${symlinkEscapeId}.jsonl`));
execFileSync("sqlite3", [remoteStateDbPath, [
  "create table threads (id text, title text, rollout_path text, created_at text, updated_at text, created_at_ms integer, updated_at_ms integer, source text, thread_source text, model_provider text, cwd text, archived integer, archived_at text, model text, reasoning_effort text, agent_nickname text, agent_role text, first_user_message text, preview text)",
  "create table thread_spawn_edges (parent_thread_id text, child_thread_id text, status text)",
  `insert into threads (id, title, rollout_path) values ('${sessionId}', 'Remote HTTP smoke 会话', '${remoteOriginalCodexHome}/sessions/2026/07/08/${path.basename(remoteSessionPath)}')`,
  `insert into threads (id, title, rollout_path) values ('${outsideJsonlId}', 'outside jsonl', '${outsideSnapshotJsonlPath}')`,
  `insert into threads (id, title, rollout_path) values ('${outsidePlainId}', 'outside plain', '${outsideSnapshotPlainPath}')`,
  `insert into threads (id, title, rollout_path) values ('${symlinkEscapeId}', 'symlink escape', '${remoteOriginalCodexHome}/sessions/2026/07/08/rollout-2026-07-08T10-00-00-${symlinkEscapeId}.jsonl')`,
  `insert into threads (id, title, rollout_path) values ('${mismatchedPathId}', 'mismatched file', '${remoteOriginalCodexHome}/sessions/2026/07/08/${path.basename(remoteSessionPath)}')`,
].join(";")]);
await fs.writeFile(
  path.join(remoteSnapshotRoot, ".codex-session-renderer-source.json"),
  `${JSON.stringify({
    status: {
      sourceVersion: remoteSourceVersion({ snapshotUrl: "", snapshotPath: "", remoteCodexHome: remoteOriginalCodexHome }, remoteSnapshotRoot),
      lastRefreshOk: true,
    },
  })}\n`,
  "utf8",
);
await fs.writeFile(path.join(remoteCodexHome, ".codex-session-renderer-snapshot-source.json"), `${JSON.stringify({ schema: "remote-snapshot-source-v1", sourceVersion: remoteSourceVersion({ snapshotUrl: "", snapshotPath: "", remoteCodexHome: remoteOriginalCodexHome }, remoteSnapshotRoot) })}\n`, "utf8");
const oldFileTime = new Date(Date.now() - 48 * 60 * 60 * 1000);
await fs.utimes(sessionPath, oldFileTime, oldFileTime);
await fs.utimes(remoteSessionPath, oldFileTime, oldFileTime);
await fs.mkdir(piProjectDir, { recursive: true });
await fs.writeFile(
  piSessionPath,
  [
    {
      type: "session",
      version: 3,
      id: piSessionId,
      timestamp: "2026-07-10T04:51:55.870Z",
      cwd: "D:\\work\\pi-web",
    },
    {
      type: "model_change",
      id: "pi-model",
      parentId: null,
      timestamp: "2026-07-10T04:51:55.879Z",
      provider: "openai-compatible",
      modelId: "gpt-5.5",
    },
    {
      type: "session_info",
      id: "pi-info",
      parentId: "pi-model",
      timestamp: "2026-07-10T04:52:06.050Z",
      name: "Pi Agent smoke 会话",
    },
    {
      type: "message",
      id: "pi-user",
      parentId: "pi-info",
      timestamp: "2026-07-10T04:52:06.061Z",
      message: { role: "user", content: [{ type: "text", text: "请创建 hello 页面" }] },
    },
    {
      type: "message",
      id: "pi-assistant",
      parentId: "pi-user",
      timestamp: "2026-07-10T04:52:08.142Z",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "我会写入文件。" },
          { type: "toolCall", id: "call-write", name: "write", arguments: { path: "hello.html" } },
        ],
      },
    },
    {
      type: "message",
      id: "pi-tool-result",
      parentId: "pi-assistant",
      timestamp: "2026-07-10T04:52:08.300Z",
      message: {
        role: "toolResult",
        toolCallId: "call-write",
        toolName: "write",
        content: [{ type: "text", text: "Successfully wrote file" }],
        isError: false,
      },
    },
  ].map((event) => JSON.stringify(event)).join("\n") + "\n",
  "utf8",
);

await fs.writeFile(
  piLargeSessionPath,
  [
    ...piGoalArchivePrefix({ sessionId: piLargeSessionId, cwd: "D:\\work\\pi-web", objective: piLargePrompt, timestamp: "2026-07-18T04:51:55.870Z" }),
    {
      type: "message",
      id: "pi-large-assistant",
      parentId: "goal-objective",
      timestamp: "2026-07-18T04:52:08.142Z",
      message: { role: "assistant", content: [{ type: "text", text: "x".repeat(Math.ceil(4.8 * 1024 * 1024)) }] },
    },
  ].map((event) => JSON.stringify(event)).join("\n") + "\n",
  "utf8",
);

await fs.mkdir(path.join(piTasksRoot, piTaskId, "artifacts", "unrelated"), { recursive: true });
await fs.mkdir(path.join(piTasksRoot, "not-a-task", "artifacts", "pi-sessions"), { recursive: true });
await fs.mkdir(path.join(piTasksRoot, "task-symlink-escape", "artifacts"), { recursive: true });
await fs.writeFile(
  path.join(piTasksRoot, piTaskId, "artifacts", "unrelated", "ignored.jsonl"),
  `${JSON.stringify({ type: "session_info", name: "不应读取的其他工件" })}\n`,
  "utf8",
);
await fs.writeFile(
  path.join(piTasksRoot, "not-a-task", "artifacts", "pi-sessions", "ignored.jsonl"),
  `${JSON.stringify({ type: "session_info", name: "不应读取的非任务目录" })}\n`,
  "utf8",
);
await fs.symlink(path.join(piTasksRoot, piTaskId, "artifacts", "unrelated"), path.join(piTasksRoot, "task-symlink-escape", "artifacts", "pi-sessions"));

process.env.CODEX_HOME = codexHome;
process.env.HOME = tempRoot;
process.env.USERPROFILE = tempRoot;
process.env.CODEX_REMOTE_SOURCES = "remote-a";
process.env.CODEX_REMOTE_PEERS = "";
process.env.CODEX_REMOTE_SOURCE_ID = "";
process.env.CODEX_REMOTE_SNAPSHOT_URL = "";
process.env.CODEX_REMOTE_SNAPSHOT_PATH = "";
process.env.CODEX_REMOTE_SNAPSHOT_ROOT = path.join(tempRoot, ".codex-session-renderer", "remote-snapshots");
process.env.CODEX_REMOTE_REMOTE_A_SNAPSHOT_ROOT = remoteSnapshotRoot;
process.env.CODEX_REMOTE_REMOTE_A_CODEX_HOME = remoteOriginalCodexHome;
process.env.CODEX_SESSION_DETAIL_MAX_FILE_BYTES = "64";
process.env.CODEX_SESSION_DETAIL_MAX_EVENTS = "4";
process.env.CODEX_SESSION_DIAGNOSTIC_MAX_EVENT_SCAN = "10001";
delete process.env.PI_AGENT_SESSIONS_ROOT;
process.env.PI_AGENT_TASKS_ROOT = piTasksRoot;

const serverModuleUrl = `${pathToFileURL(path.resolve("server.mjs")).href}?httpSmoke=${Date.now()}`;
const { createRendererServer } = await import(serverModuleUrl);

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address());
    });
  });
}

async function requestJson(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = await response.json();
  return { response, body };
}

async function requestText(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = await response.text();
  return { response, body };
}

function hasErrorOutputRisk(detail) {
  return (detail.audit?.nodes || []).some((node) => node.type === "risk" && (node.tags || []).includes("error-output"));
}

function callRiskEvidenceNode(detail) {
  return (detail.audit?.nodes || []).find(
    (node) =>
      node.type === "evidence" &&
      (node.callId === "call-risk" ||
        node.id?.includes("call-risk") ||
        node.itemRef?.includes("call-risk") ||
        node.outputBody?.includes("failed with stderr") ||
        node.body?.includes("failed with stderr")),
  );
}

test("server module can be imported and serves core HTTP session APIs", async (t) => {
  const server = createRendererServer();
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    for (const key of envKeys) {
      if (previousEnv[key] == null) {
        delete process.env[key];
      } else {
        process.env[key] = previousEnv[key];
      }
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  });
  const address = await listen(server);
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const index = await requestText(baseUrl, "/");
  assert.equal(index.response.status, 200);
  const auditScriptIndex = index.body.indexOf("./audit-view-model.js");
  const appScriptIndex = index.body.indexOf("./app.js");
  assert.notEqual(auditScriptIndex, -1);
  assert.notEqual(appScriptIndex, -1);
  assert.ok(auditScriptIndex < appScriptIndex, "audit-view-model.js loads before app.js");

  const auditViewModel = await requestText(baseUrl, "/audit-view-model.js");
  assert.equal(auditViewModel.response.status, 200);
  assert.match(auditViewModel.body, /AuditViewModel/);

  const appPost = await requestJson(baseUrl, "/app.js", { method: "POST" });
  assert.equal(appPost.response.status, 405);
  assert.equal(appPost.body.error, "请求方法不允许");

  const health = await requestJson(baseUrl, "/api/health");
  assert.equal(health.response.status, 200);
  assert.equal(health.body.ok, true);
  assert.equal(health.body.defaultSourceId, "local");
  assert.equal(health.body.codexHome, codexHome);
  assert.equal(health.body.sources.some((source) => source.id === "local"), true);
  assert.equal(health.body.sources.some((source) => source.id === "pi-agent" && source.kind === "pi-agent"), true);

  const healthPost = await requestJson(baseUrl, "/api/health", { method: "POST" });
  assert.equal(healthPost.response.status, 405);
  assert.equal(healthPost.body.error, "请求方法不允许");

  const list = await requestJson(baseUrl, "/api/sessions");
  assert.equal(list.response.status, 200);
  const listedSession = list.body.sessions.find((session) => session.id === sessionId);
  assert.equal(listedSession.displayTitle, "SQLite 稳定 HTTP smoke 标题");
  assert.equal(listedSession.title, undefined);
  const suffixList = await requestJson(baseUrl, `/api/sessions?scope=all&q=${longTitleSuffix}`);
  assert.equal(suffixList.response.status, 200);
  assert.deepEqual(suffixList.body.sessions.map((session) => session.id), [longTitleSessionId]);
  assert.equal(suffixList.body.sessions[0].title, undefined);
  assert.equal(suffixList.body.sessions[0].titleTruncated, true);
  assert.equal(suffixList.body.sessions[0].displayTitle.length <= 160, true);
  assert.equal(JSON.stringify(suffixList.body).includes(longTitleSuffix), false);
  for (const type of ["error", "tool"]) {
    const typeList = await requestJson(baseUrl, `/api/sessions?scope=all&type=${type}`);
    assert.equal(typeList.response.status, 200);
    assert.deepEqual(typeList.body.sessions.map((session) => session.id), [longTitleSessionId]);
    assert.equal(typeList.body.sessions[0].title, undefined);
    assert.equal(typeList.body.sessions[0].titleTruncated, true);
    assert.equal(JSON.stringify(typeList.body).includes(longTypeSuffix), false);
  }
  const suffixQuery = await requestJson(baseUrl, `/api/query/sessions?q=${longTitleSuffix}&fields=id,title`);
  assert.deepEqual(suffixQuery.body.sessions.map((session) => session.id), [longTitleSessionId]);
  assert.equal(suffixQuery.body.sessions[0].title, longCanonicalTitle);
  const longDetail = await requestJson(baseUrl, `/api/sessions/${longTitleSessionId}`);
  assert.equal(longDetail.body.session.title, longCanonicalTitle);
  await fs.rm(longTitleSessionPath);

  const prompts = await requestJson(baseUrl, "/api/sources/local/prompts?scope=all");
  assert.equal(prompts.response.status, 200);
  assert.equal(prompts.body.scope, "all");
  assert.equal(prompts.body.entries.length, 1);
  assert.equal(prompts.body.entries[0].sessionId, sessionId);
  assert.equal(prompts.body.entries[0].projectLabel, "D:\\github\\codex-session-renderer");
  assert.equal(prompts.body.entries[0].promptState, "found");
  assert.equal(prompts.body.entries[0].promptText, "请生成 HTTP smoke 测试");
  assert.equal(prompts.body.entries[0].promptEventIndex, 2);
  assert.equal(prompts.body.entries[0].id, `local:${sessionId}`);
  const recentPrompts = await requestJson(baseUrl, "/api/sources/local/prompts?scope=recent24h");
  assert.equal(recentPrompts.response.status, 200);
  assert.equal(recentPrompts.body.scope, "recent24h");
  assert.equal(recentPrompts.body.entries.length, 0);
  const historyPrompts = await requestJson(baseUrl, "/api/sources/local/prompts?scope=history");
  assert.equal(historyPrompts.response.status, 200);
  assert.equal(historyPrompts.body.scope, "history");
  assert.equal(historyPrompts.body.entries.length, 1);
  const promptSearch = await requestJson(baseUrl, "/api/sources/local/prompts?scope=all&q=smoke&status=found");
  assert.equal(promptSearch.response.status, 200);
  assert.equal(promptSearch.body.entries.length, 1);
  const promptMiss = await requestJson(baseUrl, "/api/sources/local/prompts?scope=all&q=不存在");
  assert.equal(promptMiss.response.status, 200);
  assert.equal(promptMiss.body.entries.length, 0);

  const promptsPost = await requestJson(baseUrl, "/api/sources/local/prompts", { method: "POST" });
  assert.equal(promptsPost.response.status, 405);
  assert.equal(promptsPost.body.error, "请求方法不允许");

  const recentOnlyList = await requestJson(baseUrl, "/api/sources/local/sessions?scope=recent24h");
  assert.equal(recentOnlyList.response.status, 200);
  assert.equal(recentOnlyList.body.scope, "recent24h");
  assert.equal(recentOnlyList.body.sessions.length, 0);

  const historyOnlyList = await requestJson(baseUrl, "/api/sources/local/sessions?scope=history");
  assert.equal(historyOnlyList.response.status, 200);
  assert.equal(historyOnlyList.body.scope, "history");
  assert.equal(historyOnlyList.body.sessions.length, 1);
  assert.equal(historyOnlyList.body.sessions[0].displayTitle, "SQLite 稳定 HTTP smoke 标题");
  const localQueryAfterHistory = await requestJson(baseUrl, "/api/sources/local/query/sessions?fields=id,title");
  assert.equal(localQueryAfterHistory.response.status, 200);
  assert.equal(localQueryAfterHistory.body.sessions.find((session) => session.id === sessionId).title, "SQLite 稳定 HTTP smoke 标题");

  const promptPageDir = path.join(codexHome, "sessions", "2026", "07", "07");
  await fs.mkdir(promptPageDir, { recursive: true });
  await Promise.all(Array.from({ length: 201 }, async (_, index) => {
    const position = String(index + 1).padStart(3, "0");
    const prompt = position === "002" ? "第201项唯一命中" : `归档候选 ${position}`;
    const filePath = path.join(promptPageDir, `rollout-2026-07-07T10-00-00-page-${position}.jsonl`);
    await fs.writeFile(filePath, `${JSON.stringify({ type: "session_meta", payload: { cwd: "D:\\github\\codex-session-renderer" } })}\n${JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: prompt } })}\n`, "utf8");
    await fs.utimes(filePath, oldFileTime, oldFileTime);
  }));
  const firstPromptPage = await requestJson(baseUrl, "/api/sources/local/prompts?scope=all&q=%E7%AC%AC201%E9%A1%B9%E5%94%AF%E4%B8%80%E5%91%BD%E4%B8%AD");
  assert.equal(firstPromptPage.response.status, 200);
  assert.equal(firstPromptPage.body.entries.length, 0);
  assert.deepEqual(firstPromptPage.body.page.candidateFrom, 1);
  assert.deepEqual(firstPromptPage.body.page.candidateTo, 200);
  assert.equal(firstPromptPage.body.page.candidatesScanned, 200);
  assert.equal(firstPromptPage.body.page.hasMoreCandidates, true);
  assert.match(firstPromptPage.body.page.nextPageToken, /^[0-9a-f-]{36}$/);
  const secondPromptPage = await requestJson(baseUrl, `/api/sources/local/prompts?scope=all&q=%E7%AC%AC201%E9%A1%B9%E5%94%AF%E4%B8%80%E5%91%BD%E4%B8%AD&pageToken=${firstPromptPage.body.page.nextPageToken}`);
  assert.equal(secondPromptPage.response.status, 200);
  assert.equal(secondPromptPage.body.page.candidateFrom, 201);
  assert.equal(secondPromptPage.body.page.hasMoreCandidates, false);
  assert.equal(secondPromptPage.body.entries.length, 1);
  assert.equal(secondPromptPage.body.entries[0].promptText, "第201项唯一命中");
  const expiredPromptPage = await requestJson(baseUrl, `/api/sources/local/prompts?scope=all&pageToken=${firstPromptPage.body.page.nextPageToken}`);
  assert.equal(expiredPromptPage.response.status, 409);
  assert.equal(expiredPromptPage.body.details.code, "prompt_archive_snapshot_changed");
  const changingPromptPage = await requestJson(baseUrl, "/api/sources/local/prompts?scope=all");
  await fs.utimes(sessionPath, new Date(), new Date());
  const changedPromptPage = await requestJson(baseUrl, `/api/sources/local/prompts?scope=all&pageToken=${changingPromptPage.body.page.nextPageToken}`);
  assert.equal(changedPromptPage.response.status, 409);
  assert.equal(changedPromptPage.body.details.code, "prompt_archive_snapshot_changed");
  await fs.rm(promptPageDir, { recursive: true, force: true });
  await fs.utimes(sessionPath, oldFileTime, oldFileTime);

  const piList = await requestJson(baseUrl, "/api/sources/pi-agent/sessions");
  assert.equal(piList.response.status, 200);
  assert.equal(piList.body.sessions.length, 2);
  const piSession = piList.body.sessions.find((entry) => entry.id === piRecordId);
  assert.equal(piSession.displayTitle, "Pi Agent smoke 会话");
  assert.equal(piSession.title, undefined);
  assert.equal(piSession.cwd, "D:\\work\\pi-web");
  assert.equal(piSession.model, "gpt-5.5");
  assert.equal(piSession.dataSourceKind, "pi-agent");

  const piDetail = await requestJson(baseUrl, `/api/sources/pi-agent/sessions/${encodeURIComponent(piRecordId)}`);
  assert.equal(piDetail.response.status, 200);
  assert.equal(piDetail.body.session.title, "Pi Agent smoke 会话");
  assert.equal(piDetail.body.turns[0].items[0].text, "请创建 hello 页面");
  assert.equal(piDetail.body.turns[0].items[2].type, "tool-call");
  assert.equal(piDetail.body.turns[0].items[2].name, "write");
  assert.equal(piDetail.body.turns[0].items[2].output, "Successfully wrote file");

  const piPrompts = await requestJson(baseUrl, `/api/sources/pi-agent/prompts?scope=recent24h&q=${encodeURIComponent(piLargePrompt)}&project=pi-agent%3Ad%3A%2Fwork%2Fpi-web&status=found`);
  assert.equal(piPrompts.response.status, 200);
  assert.equal(piPrompts.body.entries.length, 1);
  assert.equal(piPrompts.body.entries[0].sessionId, piLargeRecordId);
  assert.equal(piPrompts.body.entries[0].promptState, "found");
  assert.equal(piPrompts.body.entries[0].promptText, piLargePrompt);
  assert.equal(piPrompts.body.entries[0].promptEventIndex, 17);
  assert.equal(piPrompts.body.entries[0].sessionTitle, "未命名会话");

  const piGoalDetail = await requestJson(baseUrl, `/api/sources/pi-agent/sessions/${encodeURIComponent(piLargeRecordId)}`);
  assert.equal(piGoalDetail.response.status, 200);
  assert.equal(piGoalDetail.body.turns[0].items.find((item) => item.type === "user-message").text, piLargePrompt);
  assert.equal(JSON.stringify(piGoalDetail.body.turns).includes("goal_id"), false);
  assert.equal(JSON.stringify(piGoalDetail.body.audit).includes("Goal-mode rules:"), false);
  const piGoalMarkdown = await requestText(baseUrl, `/api/sources/pi-agent/sessions/${encodeURIComponent(piLargeRecordId)}/markdown`);
  assert.equal(piGoalMarkdown.response.status, 200);
  assert.match(piGoalMarkdown.body, new RegExp(piLargePrompt));
  assert.doesNotMatch(piGoalMarkdown.body, /goal_id|Goal-mode rules:/);
  const piGoalSearch = await requestJson(baseUrl, `/api/sources/pi-agent/query/sessions/${encodeURIComponent(piLargeRecordId)}/events?q=${encodeURIComponent(piLargePrompt)}`);
  assert.equal(piGoalSearch.response.status, 200);
  assert.deepEqual(piGoalSearch.body.events.map((event) => event.index), [17]);
  const piGoalControlSearch = await requestJson(baseUrl, `/api/sources/pi-agent/query/sessions/${encodeURIComponent(piLargeRecordId)}/events?q=goal_id`);
  assert.equal(piGoalControlSearch.response.status, 200);
  assert.equal(piGoalControlSearch.body.events.length, 0);
  const piGoalRaw = await requestJson(baseUrl, `/api/sources/pi-agent/sessions/${encodeURIComponent(piLargeRecordId)}/events/17`);
  assert.equal(piGoalRaw.response.status, 200);
  assert.match(JSON.stringify(piGoalRaw.body), /goal_id/);

  const sessionsPost = await requestJson(baseUrl, "/api/sessions", { method: "POST" });
  assert.equal(sessionsPost.response.status, 405);
  assert.equal(sessionsPost.body.error, "请求方法不允许");

  const expectedRemoteLinks = {
    detail: `/api/sources/remote-a/sessions/${sessionId}`,
    compactView: `/api/sources/remote-a/query/sessions/${sessionId}/view?view=compact`,
    events: `/api/sources/remote-a/query/sessions/${sessionId}/events`,
    markdown: `/api/sources/remote-a/sessions/${sessionId}/markdown`,
  };

  const sourceQuery = await requestJson(baseUrl, "/api/sources/remote-a/query/sessions?limit=1&fields=id,links");
  assert.equal(sourceQuery.response.status, 200);
  assert.equal(sourceQuery.body.sessions[0].id, sessionId);
  assert.deepEqual(sourceQuery.body.sessions[0].links, expectedRemoteLinks);

  const remoteList = await requestJson(baseUrl, "/api/sources/remote-a/sessions?scope=all");
  assert.equal(remoteList.response.status, 200);
  assert.deepEqual(remoteList.body.sessions.map((session) => session.id), [sessionId]);
  assert.doesNotMatch(JSON.stringify(remoteList.body), new RegExp(outsideSnapshotSecret));
  const remotePrompts = await requestJson(baseUrl, "/api/sources/remote-a/prompts?scope=all");
  assert.equal(remotePrompts.response.status, 200);
  assert.doesNotMatch(JSON.stringify(remotePrompts.body), new RegExp(outsideSnapshotSecret));

  for (const unsafeId of [outsideJsonlId, outsidePlainId, symlinkEscapeId, mismatchedPathId]) {
    for (const pathname of [
      `/api/sources/remote-a/sessions/${unsafeId}`,
      `/api/sources/remote-a/query/sessions/${unsafeId}/view?view=compact`,
      `/api/sources/remote-a/query/sessions/${unsafeId}/events`,
      `/api/sources/remote-a/sessions/${unsafeId}/events/0`,
      `/api/sources/remote-a/sessions/${unsafeId}/markdown`,
    ]) {
      const unsafeResponse = await requestJson(baseUrl, pathname);
      assert.equal(unsafeResponse.response.status, 404, pathname);
      assert.doesNotMatch(JSON.stringify(unsafeResponse.body), new RegExp(outsideSnapshotSecret));
      assert.doesNotMatch(JSON.stringify(unsafeResponse.body), /outside-snapshot/);
    }
  }

  execFileSync("sqlite3", [remoteStateDbPath, `delete from threads where id in ('${outsideJsonlId}', '${outsidePlainId}', '${symlinkEscapeId}', '${mismatchedPathId}')`]);
  const remotePromptPageDir = path.join(remoteCodexHome, "sessions", "2026", "07", "09");
  await fs.mkdir(remotePromptPageDir, { recursive: true });
  const remotePromptRows = [];
  await Promise.all(Array.from({ length: 200 }, async (_, index) => {
    const position = String(index + 1).padStart(3, "0");
    const id = `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    const name = `rollout-2026-07-09T10-00-00-remote-page-${position}-${id}.jsonl`;
    const prompt = `远端归档候选 ${position}`;
    await fs.writeFile(
      path.join(remotePromptPageDir, name),
      `${JSON.stringify({ type: "session_meta", payload: { cwd: "D:\\github\\codex-session-renderer" } })}\n${JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: prompt } })}\n`,
      "utf8",
    );
    remotePromptRows.push(`insert into threads (id, title, rollout_path) values ('${id}', '远端归档 ${position}', '${remoteOriginalCodexHome}/sessions/2026/07/09/${name}')`);
  }));
  execFileSync("sqlite3", [remoteStateDbPath, remotePromptRows.join(";")]);
  const firstRemotePromptPage = await requestJson(baseUrl, "/api/sources/remote-a/prompts?scope=all&q=HTTP%20smoke%20%E6%B5%8B%E8%AF%95");
  assert.equal(firstRemotePromptPage.response.status, 200);
  assert.equal(firstRemotePromptPage.body.entries.length, 0);
  assert.equal(firstRemotePromptPage.body.page.candidateFrom, 1);
  assert.equal(firstRemotePromptPage.body.page.candidateTo, 200);
  assert.equal(firstRemotePromptPage.body.page.hasMoreCandidates, true);
  const secondRemotePromptPage = await requestJson(baseUrl, `/api/sources/remote-a/prompts?scope=all&q=HTTP%20smoke%20%E6%B5%8B%E8%AF%95&pageToken=${firstRemotePromptPage.body.page.nextPageToken}`);
  assert.equal(secondRemotePromptPage.response.status, 200);
  assert.equal(secondRemotePromptPage.body.page.candidateFrom, 201);
  assert.equal(secondRemotePromptPage.body.page.candidateTo, 201);
  assert.equal(secondRemotePromptPage.body.entries.length, 1);
  assert.equal(secondRemotePromptPage.body.entries[0].promptText, "请生成 HTTP smoke 测试");

  const remoteDetail = await requestJson(baseUrl, `/api/sources/remote-a/sessions/${sessionId}`);
  assert.equal(remoteDetail.response.status, 200);
  const remoteMarkdown = await requestText(baseUrl, `/api/sources/remote-a/sessions/${sessionId}/markdown`);
  assert.equal(remoteMarkdown.response.status, 200);
  assert.match(remoteMarkdown.body, /# Remote HTTP smoke 会话/);

  const sourceQueryPost = await requestJson(baseUrl, "/api/sources/remote-a/query/sessions", { method: "POST" });
  assert.equal(sourceQueryPost.response.status, 405);
  assert.equal(sourceQueryPost.body.error, "请求方法不允许");

  const sourceCompactView = await requestJson(baseUrl, `/api/sources/remote-a/query/sessions/${sessionId}/view?view=compact`);
  assert.equal(sourceCompactView.response.status, 200);
  assert.deepEqual(sourceCompactView.body.session.links, expectedRemoteLinks);

  const sourceEvents = await requestJson(baseUrl, `/api/sources/remote-a/query/sessions/${sessionId}/events`);
  assert.equal(sourceEvents.response.status, 200);
  assert.deepEqual(sourceEvents.body.session.links, expectedRemoteLinks);

  const sourceMarkdownPost = await requestJson(baseUrl, `/api/sources/remote-a/sessions/${sessionId}/markdown`, { method: "POST" });
  assert.equal(sourceMarkdownPost.response.status, 405);
  assert.equal(sourceMarkdownPost.body.error, "请求方法不允许");

  const legacyRemoteQuery = await requestJson(baseUrl, `/api/query/sessions?sourceId=remote-a&id=${sessionId}&limit=1&fields=id,links`);
  assert.equal(legacyRemoteQuery.response.status, 200);
  assert.deepEqual(legacyRemoteQuery.body.sessions[0].links, sourceQuery.body.sessions[0].links);

  const queryPost = await requestJson(baseUrl, "/api/query/sessions", { method: "POST" });
  assert.equal(queryPost.response.status, 405);
  assert.equal(queryPost.body.error, "请求方法不允许");

  const explicitLocalQuery = await requestJson(baseUrl, `/api/sources/local/query/sessions?id=${sessionId}&limit=1&fields=id,links`);
  assert.equal(explicitLocalQuery.response.status, 200);
  assert.deepEqual(explicitLocalQuery.body.sessions[0].links, {
    detail: `/api/sources/local/sessions/${sessionId}`,
    compactView: `/api/sources/local/query/sessions/${sessionId}/view?view=compact`,
    events: `/api/sources/local/query/sessions/${sessionId}/events`,
    markdown: `/api/sources/local/sessions/${sessionId}/markdown`,
  });

  const missingSource = await requestJson(baseUrl, "/api/sources/missing-source/sessions");
  assert.equal(missingSource.response.status, 404);
  assert.equal(missingSource.body.error, "数据源不存在");

  const detail = await requestJson(baseUrl, `/api/sessions/${sessionId}`);
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.session.id, sessionId);
  assert.equal(detail.body.session.title, "SQLite 稳定 HTTP smoke 标题");
  for (const key of ["turns", "events", "stats", "audit", "trace", "timing", "compact"]) {
    assert.ok(key in detail.body, `detail includes ${key}`);
  }
  assert.equal(detail.body.events.length, 7);
  assert.equal(detail.body.stats.eventCount, 7);
  assert.equal(detail.body.timing.version, 1);
  assert.ok(detail.body.timing.session);

  const timingView = await requestJson(baseUrl, `/api/sources/local/query/sessions/${sessionId}/view?view=timing`);
  assert.equal(timingView.response.status, 200);
  assert.equal(timingView.body.timing.version, 1);

  const localSourceDetail = await requestJson(baseUrl, `/api/sources/local/sessions/${sessionId}`);
  assert.equal(localSourceDetail.response.status, 200);
  assert.equal(hasErrorOutputRisk(localSourceDetail.body), true);
  assert.equal(callRiskEvidenceNode(localSourceDetail.body)?.riskLevel, "medium");

  const disabledRiskRules = encodeURIComponent(JSON.stringify([{ id: "error-output", enabled: false, kind: "risk-text" }]));
  const localSourceDetailWithoutErrorOutputRisk = await requestJson(
    baseUrl,
    `/api/sources/local/sessions/${sessionId}?evidenceRiskRules=${disabledRiskRules}`,
  );
  assert.equal(localSourceDetailWithoutErrorOutputRisk.response.status, 200);
  assert.equal(hasErrorOutputRisk(localSourceDetailWithoutErrorOutputRisk.body), false);
  assert.equal(callRiskEvidenceNode(localSourceDetailWithoutErrorOutputRisk.body)?.riskLevel, "none");

  const localSourceDetailWithInvalidRiskRules = await requestJson(
    baseUrl,
    `/api/sources/local/sessions/${sessionId}?evidenceRiskRules=%7Bbad-json`,
  );
  assert.equal(localSourceDetailWithInvalidRiskRules.response.status, 400);
  assert.equal(localSourceDetailWithInvalidRiskRules.body.error, "evidenceRiskRules 参数无效");

  const invalidRiskPatternRules = encodeURIComponent(JSON.stringify([{ id: "error-output", enabled: true, kind: "risk-text", riskPattern: "(" }]));
  const localSourceDetailWithInvalidRiskPattern = await requestJson(
    baseUrl,
    `/api/sources/local/sessions/${sessionId}?evidenceRiskRules=${invalidRiskPatternRules}`,
  );
  assert.equal(localSourceDetailWithInvalidRiskPattern.response.status, 400);
  assert.equal(localSourceDetailWithInvalidRiskPattern.body.error, "evidenceRiskRules 参数无效");

  const localSourceDetailAfterCustomRules = await requestJson(baseUrl, `/api/sources/local/sessions/${sessionId}`);
  assert.equal(localSourceDetailAfterCustomRules.response.status, 200);
  assert.equal(hasErrorOutputRisk(localSourceDetailAfterCustomRules.body), true);
  assert.equal(callRiskEvidenceNode(localSourceDetailAfterCustomRules.body)?.riskLevel, "medium");

  const event = await requestJson(baseUrl, `/api/sessions/${sessionId}/events/0`);
  assert.equal(event.response.status, 200);
  assert.equal(event.body.index, 0);
  assert.equal(event.body.payload.type, undefined);
  assert.equal(event.body.raw.type, "session_meta");

  const missingSession = await requestJson(baseUrl, "/api/sources/local/sessions/missing-session");
  assert.equal(missingSession.response.status, 404);
  assert.equal(missingSession.body.error, "会话不存在");

  const missingEvent = await requestJson(baseUrl, `/api/sessions/${sessionId}/events/99`);
  assert.equal(missingEvent.response.status, 404);
  assert.equal(missingEvent.body.error, "事件不存在");

  const markdown = await fetch(`${baseUrl}/api/sessions/${sessionId}/markdown`);
  assert.equal(markdown.status, 200);
  assert.match(await markdown.text(), /# SQLite 稳定 HTTP smoke 标题/);

  const largeDetailId = "33333333-3333-4333-8333-333333333333";
  const largeDetailRows = Array.from({ length: 10_002 }, (_, index) => JSON.stringify({ type: "event_msg", payload: { type: "agent_message", message: `event-${index}` } })).join("\n") + "\n";
  const localLargeDetailPath = path.join(sessionDir, `rollout-2026-07-08T10-00-00-${largeDetailId}.jsonl`);
  const remoteLargeDetailPath = path.join(remoteSessionDir, `rollout-2026-07-08T10-00-00-${largeDetailId}.jsonl`);
  const piLargeDetailPath = path.join(piProjectDir, `2026-07-10T04-51-55-870Z_${largeDetailId}.jsonl`);
  await Promise.all([fs.writeFile(localLargeDetailPath, largeDetailRows, "utf8"), fs.writeFile(remoteLargeDetailPath, largeDetailRows, "utf8"), fs.writeFile(piLargeDetailPath, largeDetailRows, "utf8")]);

  for (const pathname of [
    `/api/sources/local/sessions/${largeDetailId}`,
    `/api/sources/pi-agent/sessions/${encodeURIComponent(`${piTaskId}:${largeDetailId}`)}`,
    `/api/sources/remote-a/sessions/${largeDetailId}`,
  ]) {
    const detail = await requestJson(baseUrl, pathname);
    assert.equal(detail.response.status, 200);
    assert.equal(detail.body.complete, true);
    assert.equal(detail.body.readState.code, "session_read_complete");
    assert.equal(detail.body.events.length, 10_002);
    assert.equal(detail.body.stats.eventCount, 10_002);
    assert.ok(detail.body.turns.length > 0);
  }
  for (const view of ["compact", "turns", "trace", "timing", "audit"]) {
    const externalView = await requestJson(baseUrl, `/api/sources/local/query/sessions/${largeDetailId}/view?view=${view}`);
    assert.equal(externalView.response.status, 200);
    assert.equal(externalView.body.complete, true);
    assert.equal(externalView.body.readState.code, "session_read_complete");
    assert.ok(externalView.body[view]);
  }
  for (const pathname of [
    `/api/sessions/${largeDetailId}/markdown`,
    `/api/sources/local/sessions/${largeDetailId}/markdown`,
  ]) {
    const markdown = await requestText(baseUrl, pathname);
    assert.equal(markdown.response.status, 200);
    assert.match(markdown.body, /event-10001/);
  }
  const diagnosticEvents = await requestJson(baseUrl, `/api/sources/local/query/sessions/${largeDetailId}/events?limit=2`);
  assert.equal(diagnosticEvents.response.status, 200);
  assert.equal(diagnosticEvents.body.events.length, 2);
  await assertBoundedDiagnosticEndpoints({ baseUrl, fs, diagnosticEvents, sessionId: largeDetailId, requestJson, sessionDir });

  const createPeer = await requestJson(baseUrl, "/api/peers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "office", label: "Office A", url: "http://192.168.1.20:4791", token: "office-token" }),
  });
  assert.equal(createPeer.response.status, 200);
  assert.equal(createPeer.body.configuration.result, "source_changed");
  assert.equal(createPeer.body.configuration.snapshotRefreshRequired, true);
  assert.match(createPeer.body.configuration.sourceVersion, /^remote-v1-/);
  assert.doesNotMatch(JSON.stringify(createPeer.body), /office-token/);

  const managedSnapshotRoot = path.join(tempRoot, ".codex-session-renderer", "remote-snapshots", "office");
  const managedCurrent = path.join(managedSnapshotRoot, "current");
  const managedSessionDir = path.join(managedCurrent, "sessions", "2026", "07", "08");
  const managedSessionPath = path.join(managedSessionDir, path.basename(sessionPath));
  await fs.mkdir(managedSessionDir, { recursive: true });
  await fs.copyFile(sessionPath, managedSessionPath);
  await fs.utimes(managedSessionPath, oldFileTime, oldFileTime);
  await fs.writeFile(path.join(managedCurrent, "session_index.jsonl"), await fs.readFile(path.join(codexHome, "session_index.jsonl"), "utf8"), "utf8");
  await fs.writeFile(
    path.join(managedSnapshotRoot, ".codex-session-renderer-source.json"),
    `${JSON.stringify({ status: { sourceVersion: createPeer.body.configuration.sourceVersion, lastRefreshOk: true } })}\n`,
    "utf8",
  );
  await fs.writeFile(path.join(managedCurrent, ".codex-session-renderer-snapshot-source.json"), `${JSON.stringify({ schema: "remote-snapshot-source-v1", sourceVersion: createPeer.body.configuration.sourceVersion })}\n`, "utf8");
  const sameSourceReload = await requestJson(baseUrl, "/api/peers/office", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ label: "Office renamed", url: "http://192.168.1.20:4791" }),
  });
  assert.equal(sameSourceReload.response.status, 200);
  assert.equal(sameSourceReload.body.configuration.result, "source_unchanged");
  assert.equal(sameSourceReload.body.configuration.snapshotRefreshRequired, false);
  const sameSourceSessions = await requestJson(baseUrl, "/api/sources/office/sessions?scope=history");
  assert.equal(sameSourceSessions.response.status, 200);
  assert.equal(sameSourceSessions.body.sessions[0].id, sessionId);

  const changePeer = await requestJson(baseUrl, "/api/peers/office", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ label: "Office B", url: "http://192.168.1.21:4791", token: "rotated-office-token" }),
  });
  assert.equal(changePeer.response.status, 200);
  assert.equal(changePeer.body.configuration.result, "source_changed");
  assert.equal(changePeer.body.configuration.snapshotRefreshRequired, true);
  assert.notEqual(changePeer.body.configuration.sourceVersion, createPeer.body.configuration.sourceVersion);
  assert.doesNotMatch(JSON.stringify(changePeer.body), /rotated-office-token/);
  const changedSourceSessions = await requestJson(baseUrl, "/api/sources/office/sessions?scope=history");
  assert.equal(changedSourceSessions.response.status, 409);
  assert.equal(changedSourceSessions.body.details.code, "source_snapshot_changed");
  const changedSourceMarkdown = await requestJson(baseUrl, `/api/sources/office/sessions/${sessionId}/markdown`);
  assert.equal(changedSourceMarkdown.response.status, 409);
  assert.equal(changedSourceMarkdown.body.details.code, "source_snapshot_changed");

  const removePeer = await requestJson(baseUrl, "/api/peers/office", { method: "DELETE" });
  assert.equal(removePeer.response.status, 200);
  assert.equal(removePeer.body.configuration.result, "source_removed");
  const removedSourceSessions = await requestJson(baseUrl, "/api/sources/office/sessions");
  assert.equal(removedSourceSessions.response.status, 404);

  const peers = await requestJson(baseUrl, "/api/peers");
  assert.equal(peers.response.status, 200);
  assert.deepEqual(peers.body.peers, []);

  const localRefresh = await requestJson(baseUrl, "/api/sources/local/refresh", { method: "POST" });
  assert.equal(localRefresh.response.status, 400);
  assert.equal(localRefresh.body.error.code, "not_refreshable");

  const missing = await requestJson(baseUrl, "/api/__missing_smoke_endpoint__");
  assert.equal(missing.response.status, 404);
  assert.equal(missing.body.error, "未找到资源");
});
