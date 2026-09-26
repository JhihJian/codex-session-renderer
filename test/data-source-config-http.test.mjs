import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const envKeys = ["CODEX_HOME", "HOME", "USERPROFILE", "PI_AGENT_SESSIONS_ROOT", "PI_AGENT_TASKS_ROOT", "PI_AGENT_EVALUATIONS_ROOT", "CODEX_SESSION_RENDERER_CONFIG_PATH"];

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

async function withServerEnv(t, env, run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "csr-ds-http-"));
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const sessionsRoot = path.join(root, ".pi", "agent", "sessions");
  const overrideRoot = path.join(root, "override-sessions");
  const stateDir = path.join(root, "state");
  await mkdir(sessionsRoot, { recursive: true });
  await mkdir(overrideRoot, { recursive: true });
  await mkdir(stateDir, { recursive: true });
  await writeFile(path.join(sessionsRoot, "env-session.jsonl"), `${JSON.stringify({ type: "session", version: 3, id: "11111111-1111-4111-8111-111111111111", cwd: "/env" })}\n`, "utf8");
  await writeFile(path.join(overrideRoot, "override-session.jsonl"), `${JSON.stringify({ type: "session", version: 3, id: "22222222-2222-4222-8222-222222222222", cwd: "/override" })}\n`, "utf8");
  Object.assign(process.env, {
    CODEX_HOME: path.join(root, ".codex"),
    HOME: root,
    USERPROFILE: root,
    PI_AGENT_SESSIONS_ROOT: sessionsRoot,
    CODEX_SESSION_RENDERER_CONFIG_PATH: path.join(stateDir, "data-source-config.json"),
    ...env,
  });
  if (!String(process.env.CODEX_SESSION_RENDERER_CONFIG_PATH || "").trim()) delete process.env.CODEX_SESSION_RENDERER_CONFIG_PATH;
  let server;
  t.after(async () => {
    if (server?.listening) await close(server);
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  });
  const moduleUrl = `${pathToFileURL(path.resolve("server.mjs")).href}?dataSourceHttp=${Date.now()}-${Math.random()}`;
  const { createRendererServer } = await import(moduleUrl);
  server = createRendererServer();
  const address = await listen(server);
  return run({
    baseUrl: `http://127.0.0.1:${address.port}`,
    sessionsRoot,
    overrideRoot,
    configPath: process.env.CODEX_SESSION_RENDERER_CONFIG_PATH || null,
  });
}

async function putJson(baseUrl, body, headers = {}) {
  return fetch(`${baseUrl}/api/data-source-config`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("data source config API reports the effective state and rejects unsupported methods", async (t) => {
  await withServerEnv(t, {}, async ({ baseUrl, configPath, sessionsRoot }) => {
    const initial = await (await fetch(`${baseUrl}/api/data-source-config`)).json();
    assert.equal(initial.configPath, configPath);
    assert.equal(initial.writable, true);
    assert.equal(initial.override, null);
    assert.deepEqual(initial.envDefault, { path: sessionsRoot });
    assert.equal(initial.parseError, null);

    assert.equal((await fetch(`${baseUrl}/api/data-source-config`, { method: "POST", body: "{}" })).status, 405);
    assert.equal((await fetch(`${baseUrl}/api/data-source-config`, { method: "DELETE" })).status, 405);
  });
});

test("data source config PUT validates content type, JSON, size and fields", async (t) => {
  await withServerEnv(t, {}, async ({ baseUrl }) => {
    const unsupported = await putJson(baseUrl, "{}", { "content-type": "text/plain" });
    assert.equal(unsupported.status, 415);
    assert.match((await unsupported.json()).error, /application\/json/);

    const badJson = await putJson(baseUrl, "{ not json");
    assert.equal(badJson.status, 400);
    assert.match((await badJson.json()).error, /有效 JSON/);

    const oversized = await putJson(baseUrl, JSON.stringify({ piAgentRoot: null, padding: "x".repeat(17 * 1024) }));
    assert.equal(oversized.status, 413);

    const missingField = await putJson(baseUrl, {});
    assert.equal(missingField.status, 400);
    assert.match((await missingField.json()).error, /piAgentRoot/);

    const badType = await putJson(baseUrl, { piAgentRoot: { type: "unknown", path: "/tmp" } });
    assert.equal(badType.status, 200);
    assert.deepEqual((await badType.json()).override, { path: "/tmp" });
    await putJson(baseUrl, { piAgentRoot: null });

    const relativePath = await putJson(baseUrl, { piAgentRoot: { path: "relative/path" } });
    assert.equal(relativePath.status, 400);
    assert.match((await relativePath.json()).error, /绝对路径/);

    const missingDirectory = await putJson(baseUrl, { piAgentRoot: { path: "/definitely/missing/root" } });
    assert.equal(missingDirectory.status, 400);
    assert.match((await missingDirectory.json()).error, /无法解析|目录/);

    const badWildcardPrefix = await putJson(baseUrl, { piAgentRoot: { path: "/definitely/missing/*/pi-sessions" } });
    assert.equal(badWildcardPrefix.status, 400);
    assert.match((await badWildcardPrefix.json()).error, /固定前缀必须是已存在的目录/);

    const config = await (await fetch(`${baseUrl}/api/data-source-config`)).json();
    assert.equal(config.override, null);
  });
});

test("data source config PUT saves hot and health reflects the new root immediately", async (t) => {
  await withServerEnv(t, {}, async ({ baseUrl, sessionsRoot, overrideRoot }) => {
    const saved = await putJson(baseUrl, { piAgentRoot: { path: overrideRoot } });
    assert.equal(saved.status, 200);
    const savedBody = await saved.json();
    assert.deepEqual(savedBody.override, { path: overrideRoot });
    assert.ok(savedBody.sources.some((source) => source.id === "pi-agent" && source.isDefault));

    const health = await (await fetch(`${baseUrl}/api/health`)).json();
    assert.equal(health.defaultSourceId, "pi-agent");
    assert.equal(health.sessionsRoot, overrideRoot);
    const sessions = await (await fetch(`${baseUrl}/api/sources/pi-agent/sessions`)).json();
    assert.ok(sessions.sessions.some((session) => session.id === "override-session"));
    assert.ok(!sessions.sessions.some((session) => session.id === "env-session"));

    const cleared = await putJson(baseUrl, { piAgentRoot: null });
    assert.equal(cleared.status, 200);
    assert.equal((await cleared.json()).override, null);
    const restoredHealth = await (await fetch(`${baseUrl}/api/health`)).json();
    assert.equal(restoredHealth.sessionsRoot, sessionsRoot);
  });
});

test("data source config stays disabled without the environment variable", async (t) => {
  await withServerEnv(t, { CODEX_SESSION_RENDERER_CONFIG_PATH: "" }, async ({ baseUrl, sessionsRoot }) => {
    const describe = await (await fetch(`${baseUrl}/api/data-source-config`)).json();
    assert.equal(describe.configPath, null);
    assert.equal(describe.writable, false);
    assert.deepEqual(describe.envDefault, { path: sessionsRoot });

    const update = await putJson(baseUrl, { piAgentRoot: null });
    assert.equal(update.status, 404);
    assert.match((await update.json()).error, /未启用/);
  });
});

test("data source config endpoints require authentication off loopback", async (t) => {
  await withServerEnv(t, {}, async () => {
    const moduleUrl = `${pathToFileURL(path.resolve("server.mjs")).href}?dataSourceAuth=${Date.now()}-${Math.random()}`;
    const { createRendererServer } = await import(moduleUrl);
    const server = createRendererServer({ host: "0.0.0.0", token: "secret-token" });
    t.after(() => close(server));
    const address = await listen(server);
    const baseUrl = `http://127.0.0.1:${address.port}`;

    assert.equal((await fetch(`${baseUrl}/api/data-source-config`)).status, 401);
    assert.equal((await putJson(baseUrl, { piAgentRoot: null })).status, 401);
    const authorized = await fetch(`${baseUrl}/api/data-source-config`, { headers: { authorization: "Bearer secret-token" } });
    assert.equal(authorized.status, 200);
  });
});
