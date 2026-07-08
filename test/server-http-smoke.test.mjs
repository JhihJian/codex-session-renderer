import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const sessionId = "11111111-1111-1111-1111-111111111111";
const envKeys = [
  "CODEX_HOME",
  "HOME",
  "USERPROFILE",
  "CODEX_REMOTE_SOURCES",
  "CODEX_REMOTE_PEERS",
  "CODEX_REMOTE_SOURCE_ID",
  "CODEX_REMOTE_SNAPSHOT_URL",
  "CODEX_REMOTE_SNAPSHOT_PATH",
  "CODEX_REMOTE_REMOTE_A_SNAPSHOT_ROOT",
];
const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "csr-http-smoke-"));
const codexHome = path.join(tempRoot, ".codex");
const sessionDir = path.join(codexHome, "sessions", "2026", "07", "08");
const sessionPath = path.join(sessionDir, `rollout-2026-07-08T10-00-00-${sessionId}.jsonl`);
const remoteSnapshotRoot = path.join(tempRoot, "remote-a-source");
const remoteCodexHome = path.join(remoteSnapshotRoot, "current");
const remoteSessionDir = path.join(remoteCodexHome, "sessions", "2026", "07", "08");
const remoteSessionPath = path.join(remoteSessionDir, `rollout-2026-07-08T10-00-00-${sessionId}.jsonl`);

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
  path.join(codexHome, "session_index.jsonl"),
  `${JSON.stringify({ id: sessionId, thread_name: "HTTP smoke 会话", updated_at: "2026-07-08T10:00:06.000Z" })}\n`,
  "utf8",
);
await fs.mkdir(remoteSessionDir, { recursive: true });
await fs.copyFile(sessionPath, remoteSessionPath);
await fs.writeFile(
  path.join(remoteCodexHome, "session_index.jsonl"),
  `${JSON.stringify({ id: sessionId, thread_name: "Remote HTTP smoke 会话", updated_at: "2026-07-08T10:00:06.000Z" })}\n`,
  "utf8",
);

process.env.CODEX_HOME = codexHome;
process.env.HOME = tempRoot;
process.env.USERPROFILE = tempRoot;
process.env.CODEX_REMOTE_SOURCES = "remote-a";
process.env.CODEX_REMOTE_PEERS = "";
process.env.CODEX_REMOTE_SOURCE_ID = "";
process.env.CODEX_REMOTE_SNAPSHOT_URL = "";
process.env.CODEX_REMOTE_SNAPSHOT_PATH = "";
process.env.CODEX_REMOTE_REMOTE_A_SNAPSHOT_ROOT = remoteSnapshotRoot;

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
  assert.equal(appPost.body.error, "Method not allowed");

  const health = await requestJson(baseUrl, "/api/health");
  assert.equal(health.response.status, 200);
  assert.equal(health.body.ok, true);
  assert.equal(health.body.defaultSourceId, "local");
  assert.equal(health.body.codexHome, codexHome);
  assert.equal(health.body.sources.some((source) => source.id === "local"), true);

  const healthPost = await requestJson(baseUrl, "/api/health", { method: "POST" });
  assert.equal(healthPost.response.status, 405);
  assert.equal(healthPost.body.error, "Method not allowed");

  const list = await requestJson(baseUrl, "/api/sessions");
  assert.equal(list.response.status, 200);
  assert.equal(list.body.sessions.length, 1);
  assert.equal(list.body.sessions[0].id, sessionId);
  assert.equal(list.body.sessions[0].title, "HTTP smoke 会话");

  const sessionsPost = await requestJson(baseUrl, "/api/sessions", { method: "POST" });
  assert.equal(sessionsPost.response.status, 405);
  assert.equal(sessionsPost.body.error, "Method not allowed");

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

  const sourceQueryPost = await requestJson(baseUrl, "/api/sources/remote-a/query/sessions", { method: "POST" });
  assert.equal(sourceQueryPost.response.status, 405);
  assert.equal(sourceQueryPost.body.error, "Method not allowed");

  const sourceCompactView = await requestJson(baseUrl, `/api/sources/remote-a/query/sessions/${sessionId}/view?view=compact`);
  assert.equal(sourceCompactView.response.status, 200);
  assert.deepEqual(sourceCompactView.body.session.links, expectedRemoteLinks);

  const sourceEvents = await requestJson(baseUrl, `/api/sources/remote-a/query/sessions/${sessionId}/events`);
  assert.equal(sourceEvents.response.status, 200);
  assert.deepEqual(sourceEvents.body.session.links, expectedRemoteLinks);

  const sourceMarkdownPost = await requestJson(baseUrl, `/api/sources/remote-a/sessions/${sessionId}/markdown`, { method: "POST" });
  assert.equal(sourceMarkdownPost.response.status, 405);
  assert.equal(sourceMarkdownPost.body.error, "Method not allowed");

  const legacyRemoteQuery = await requestJson(baseUrl, "/api/query/sessions?sourceId=remote-a&limit=1&fields=id,links");
  assert.equal(legacyRemoteQuery.response.status, 200);
  assert.deepEqual(legacyRemoteQuery.body.sessions[0].links, sourceQuery.body.sessions[0].links);

  const queryPost = await requestJson(baseUrl, "/api/query/sessions", { method: "POST" });
  assert.equal(queryPost.response.status, 405);
  assert.equal(queryPost.body.error, "Method not allowed");

  const explicitLocalQuery = await requestJson(baseUrl, "/api/sources/local/query/sessions?limit=1&fields=id,links");
  assert.equal(explicitLocalQuery.response.status, 200);
  assert.deepEqual(explicitLocalQuery.body.sessions[0].links, {
    detail: `/api/sources/local/sessions/${sessionId}`,
    compactView: `/api/sources/local/query/sessions/${sessionId}/view?view=compact`,
    events: `/api/sources/local/query/sessions/${sessionId}/events`,
    markdown: `/api/sources/local/sessions/${sessionId}/markdown`,
  });

  const detail = await requestJson(baseUrl, `/api/sessions/${sessionId}`);
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.session.id, sessionId);
  for (const key of ["turns", "events", "stats", "audit", "trace", "compact"]) {
    assert.ok(key in detail.body, `detail includes ${key}`);
  }
  assert.equal(detail.body.events.length, 7);
  assert.equal(detail.body.stats.eventCount, 7);

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
  assert.equal(localSourceDetailWithInvalidRiskRules.body.error, "Invalid evidenceRiskRules parameter");

  const localSourceDetailAfterCustomRules = await requestJson(baseUrl, `/api/sources/local/sessions/${sessionId}`);
  assert.equal(localSourceDetailAfterCustomRules.response.status, 200);
  assert.equal(hasErrorOutputRisk(localSourceDetailAfterCustomRules.body), true);
  assert.equal(callRiskEvidenceNode(localSourceDetailAfterCustomRules.body)?.riskLevel, "medium");

  const event = await requestJson(baseUrl, `/api/sessions/${sessionId}/events/0`);
  assert.equal(event.response.status, 200);
  assert.equal(event.body.index, 0);
  assert.equal(event.body.payload.type, undefined);
  assert.equal(event.body.raw.type, "session_meta");

  const markdown = await fetch(`${baseUrl}/api/sessions/${sessionId}/markdown`);
  assert.equal(markdown.status, 200);
  assert.match(await markdown.text(), /# HTTP smoke 会话/);

  const peers = await requestJson(baseUrl, "/api/peers");
  assert.equal(peers.response.status, 200);
  assert.deepEqual(peers.body.peers, []);

  const localRefresh = await requestJson(baseUrl, "/api/sources/local/refresh", { method: "POST" });
  assert.equal(localRefresh.response.status, 400);
  assert.equal(localRefresh.body.error.code, "not_refreshable");

  const missing = await requestJson(baseUrl, "/api/__missing_smoke_endpoint__");
  assert.equal(missing.response.status, 404);
  assert.equal(missing.body.error, "Not found");
});
