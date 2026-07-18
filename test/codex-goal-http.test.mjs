import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { knownCodexGoalControlText } from "../src/pi-goal-projection.mjs";

const threadId = "019f6171-1263-7e32-a1a1-61edd4bdd777";
const objective = "HTTP 回归只显示 Codex Goal 的真实目标";
const control = knownCodexGoalControlText(objective, 0);

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

test("HTTP surfaces project a verified Codex goal while raw diagnostics retain the packet", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "csr-codex-goal-http-"));
  const codexHome = path.join(root, ".codex");
  const sessionDir = path.join(codexHome, "sessions", "2026", "07", "18");
  const sessionPath = path.join(sessionDir, `rollout-2026-07-18T10-00-00-${threadId}.jsonl`);
  const previous = Object.fromEntries(["CODEX_HOME", "HOME", "USERPROFILE", "PI_AGENT_SESSIONS_ROOT"].map((key) => [key, process.env[key]]));
  let server;
  await mkdir(sessionDir, { recursive: true });
  const events = [
    { type: "session_meta", payload: { session_id: threadId, id: threadId, cwd: "/workspace/codex-goal" } },
    { type: "event_msg", payload: { type: "thread_goal_updated", threadId, goal: { threadId, objective, status: "active", tokensUsed: 0, timeUsedSeconds: 0, createdAt: 1, updatedAt: 1 } } },
    { type: "event_msg", payload: { type: "task_started", turn_id: "goal-turn" } },
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: control }], internal_chat_message_metadata_passthrough: { turn_id: "71ef01e9-6165-44c4-af82-1ebbb0e42a2b" } } },
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: knownCodexGoalControlText(objective, 12) }], internal_chat_message_metadata_passthrough: { turn_id: "81ef01e9-6165-44c4-af82-1ebbb0e42a2b" } } },
    { type: "event_msg", payload: { type: "agent_message", message: "真实目标处理中" } },
    { type: "event_msg", payload: { type: "agent_message", message: "x".repeat(128 * 1024) } },
  ];
  await writeFile(sessionPath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
  await writeFile(path.join(codexHome, "session_index.jsonl"), `${JSON.stringify({ id: threadId, thread_name: control })}\n`, "utf8");
  const escapedControl = control.replaceAll("'", "''");
  execFileSync("sqlite3", [path.join(codexHome, "state_5.sqlite"), [
    "create table threads (id text, title text, rollout_path text, created_at text, updated_at text, created_at_ms integer, updated_at_ms integer, source text, thread_source text, model_provider text, cwd text, archived integer, archived_at text, model text, reasoning_effort text, agent_nickname text, agent_role text, first_user_message text, preview text)",
    "create table thread_spawn_edges (parent_thread_id text, child_thread_id text, status text)",
    `insert into threads (id, title, rollout_path, cwd) values ('${threadId}', '${escapedControl}', '${sessionPath}', '/workspace/codex-goal')`,
  ].join(";")]);
  process.env.CODEX_HOME = codexHome;
  process.env.HOME = root;
  process.env.USERPROFILE = root;
  delete process.env.PI_AGENT_SESSIONS_ROOT;
  t.after(async () => {
    if (server?.listening) await close(server);
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  });

  const moduleUrl = `${pathToFileURL(path.resolve("server.mjs")).href}?codexGoalHttp=${Date.now()}`;
  const { createRendererServer } = await import(moduleUrl);
  server = createRendererServer();
  const address = await listen(server);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const json = async (pathname) => {
    const response = await fetch(`${baseUrl}${pathname}`);
    return { response, body: await response.json() };
  };

  const list = await json("/api/sessions");
  assert.equal(list.response.status, 200);
  assert.equal(list.body.sessions[0].title, objective);
  assert.equal(list.body.sessions[0].title.includes("codex_internal_context"), false);

  const detail = await json(`/api/sessions/${threadId}`);
  assert.equal(detail.body.turns[0].items.filter((item) => item.type === "user-message").length, 1);
  assert.equal(detail.body.turns[0].items.find((item) => item.type === "user-message").text, objective);
  assert.equal(JSON.stringify(detail.body.audit).includes("Tokens remaining: unbounded"), false);

  const [archive, semanticSearch, controlSearch] = await Promise.all([
    json(`/api/sources/local/prompts?scope=all&q=${encodeURIComponent(objective)}`),
    json(`/api/query/sessions/${threadId}/events?q=${encodeURIComponent(objective)}`),
    json(`/api/query/sessions/${threadId}/events?q=Tokens%20remaining`),
  ]);
  assert.equal(archive.body.entries[0].promptText, objective);
  assert.deepEqual(semanticSearch.body.events.map((event) => event.index), [3]);
  assert.equal(controlSearch.body.events.length, 0);

  const [markdown, raw] = await Promise.all([fetch(`${baseUrl}/api/sessions/${threadId}/markdown`), json(`/api/sessions/${threadId}/events/3`)]);
  assert.equal(markdown.status, 200);
  assert.match(await markdown.text(), new RegExp(objective));
  assert.equal(raw.body.raw.payload.content[0].text, control);
  assert.equal(raw.body.payload.content[0].text, control);
});