import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const envKeys = [
  "CODEX_HOME",
  "HOME",
  "USERPROFILE",
  "CODEX_REMOTE_PEERS",
  "CODEX_REMOTE_TOKEN",
  "CODEX_REMOTE_TOKEN_ENV",
  "CODEX_REMOTE_SOURCES",
  "CODEX_REMOTE_SOURCE_ID",
  "CODEX_REMOTE_SNAPSHOT_URL",
  "CODEX_REMOTE_SNAPSHOT_PATH",
  "CODEX_REMOTE_OFFICE_TOKEN",
  "CODEX_REMOTE_OFFICE_TOKEN_ENV",
  "CODEX_REMOTE_OFFICE_LABEL",
  "CODEX_REMOTE_OFFICE_CODEX_HOME",
  "CODEX_REMOTE_OFFICE_SNAPSHOT_ROOT",
  "CODEX_REMOTE_OFFICE_ALLOW_INSECURE_TLS",
  "CODEX_SESSION_RENDERER_PI_AGENT_SESSIONS_ROOT",
  "PI_AGENT_SESSIONS_ROOT",
  "PI_AGENT_SESSIONS",
  "CODEX_SESSION_RENDERER_PI_AGENT_TASKS_ROOT",
  "PI_AGENT_TASKS_ROOT",
  "CODEX_SESSION_RENDERER_PI_AGENT_HOME",
  "PI_AGENT_HOME",
];

let importCounter = 0;

async function withRemoteServer(t, fetchImpl, setup = async () => {}) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "csr-server-"));
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const clientFetch = globalThis.fetch;
  let server = null;

  for (const key of envKeys) delete process.env[key];
  process.env.CODEX_HOME = path.join(tempRoot, ".codex");
  process.env.HOME = tempRoot;
  process.env.USERPROFILE = tempRoot;
  process.env.CODEX_REMOTE_PEERS = "office|Office=http://example.invalid:4791";
  process.env.CODEX_REMOTE_TOKEN = "secret-token";
  await setup(tempRoot);
  globalThis.fetch = async (...args) => fetchImpl(...args);

  t.after(async () => {
    if (server?.listening) await closeServer(server);
    globalThis.fetch = clientFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await rm(tempRoot, { recursive: true, force: true });
  });

  const moduleUrl = `${pathToFileURL(path.resolve("server.mjs")).href}?serverTest=${Date.now()}-${++importCounter}`;
  const { createRendererServer } = await import(moduleUrl);
  server = createRendererServer();
  const address = await listen(server);
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    fetch: clientFetch,
  };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address());
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function requestJson(context, pathname, options = {}) {
  const response = await context.fetch(`${context.baseUrl}${pathname}`, options);
  const text = await response.text();
  return {
    response,
    text,
    body: JSON.parse(text),
  };
}

test("health selects the Pi Agent source when its sessions directory is available", async (t) => {
  let piSessionsRoot = "";
  const context = await withRemoteServer(
    t,
    async () => new Response("not used"),
    async (tempRoot) => {
      piSessionsRoot = path.join(tempRoot, ".pi", "agent", "sessions");
      await mkdir(piSessionsRoot, { recursive: true });
    },
  );

  const { response, body } = await requestJson(context, "/api/health");

  assert.equal(response.status, 200);
  assert.equal(body.defaultSourceId, "pi-agent");
  assert.equal(body.sessionsRoot, piSessionsRoot);
  assert.equal(body.sources.find((source) => source.id === "pi-agent")?.isDefault, true);
  assert.equal(body.sources.find((source) => source.id === "local")?.isDefault, false);
});

function assertRedacted(text) {
  assert.doesNotMatch(text, /secret-token/i);
  assert.doesNotMatch(text, /user:secret/i);
  assert.doesNotMatch(text, /Authorization: Bearer secret/i);
}

test("remote index unreachable returns structured redacted error", async (t) => {
  const context = await withRemoteServer(t, async (url, options) => {
    assert.match(String(url), /\/api\/codex-session-index\?limit=1$/);
    assert.equal(options.headers.authorization, "Bearer secret-token");
    throw new Error("connect ECONNREFUSED http://user:secret@example.invalid/api Authorization: Bearer secret-token token=secret-token");
  });

  const { response, body, text } = await requestJson(context, "/api/sources/office/index?limit=1");

  assert.equal(response.status, 502);
  assert.match(body.error, /远端索引不可达/);
  assert.notEqual(body.error, "Internal server error");
  assert.equal(body.details.code, "remote_index_unreachable");
  assert.equal(body.details.status, 502);
  assertRedacted(text);
});

test("remote index proxy preserves bounded page cursor metadata", async (t) => {
  const upstreamPage = { total: 3, limit: 2, cursor: 2, nextCursor: null };
  const context = await withRemoteServer(t, async (url, options) => {
    const upstream = new URL(url);
    assert.equal(upstream.pathname, "/api/codex-session-index");
    assert.equal(upstream.searchParams.get("bucket"), "earlier");
    assert.equal(upstream.searchParams.get("q"), "old task");
    assert.equal(upstream.searchParams.get("type"), "error");
    assert.equal(upstream.searchParams.get("limit"), "2");
    assert.equal(upstream.searchParams.get("cursor"), "2");
    assert.equal(options.headers.authorization, "Bearer secret-token");
    return new Response(JSON.stringify({
      page: upstreamPage,
      sessions: [{ id: "remote-last", title: "旧任务" }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  });

  const { response, body } = await requestJson(context, "/api/sources/office/index?bucket=earlier&q=old%20task&type=error&limit=2&cursor=2");

  assert.equal(response.status, 200);
  assert.deepEqual(body.page, upstreamPage);
  assert.equal(body.sessions.length, 1);
  assert.equal(body.sessions[0].remoteIndexOnly, true);
  assert.equal(body.sessions[0].availableInSnapshot, false);
  assert.equal(body.sessions[0].sourceId, "office");
});

test("remote index preserves a controlled snapshot-change response", async (t) => {
  const context = await withRemoteServer(t, async () => new Response(JSON.stringify({
    error: "Internal server error",
    details: { code: "index_snapshot_changed" },
  }), { status: 409, headers: { "content-type": "application/json" } }));

  const { response, body, text } = await requestJson(context, "/api/sources/office/index?cursor=100&snapshot=opaque");

  assert.equal(response.status, 409);
  assert.equal(body.error, "远端历史索引已变化，请重新开始定位。");
  assert.equal(body.details.code, "index_snapshot_changed");
  assertRedacted(text);
});

test("remote index non JSON response returns actionable error", async (t) => {
  const context = await withRemoteServer(t, async () => new Response("<html>not json</html>", { status: 200 }));

  const { response, body, text } = await requestJson(context, "/api/sources/office/index");

  assert.equal(response.status, 502);
  assert.equal(body.error, "远端索引返回非 JSON。");
  assert.equal(body.details.code, "remote_index_non_json");
  assert.notEqual(body.error, "Internal server error");
  assertRedacted(text);
});

test("remote index authentication failure preserves 401 semantics", async (t) => {
  const context = await withRemoteServer(
    t,
    async () => new Response(JSON.stringify({ error: "bad secret-token" }), { status: 401, headers: { "content-type": "application/json" } }),
  );

  const { response, body, text } = await requestJson(context, "/api/sources/office/index");

  assert.equal(response.status, 401);
  assert.equal(body.error, "远端索引认证失败。");
  assert.equal(body.details.code, "remote_index_auth_failed");
  assertRedacted(text);
});

test("remote index upstream 500 is reported without Internal server error", async (t) => {
  const context = await withRemoteServer(t, async () => new Response(JSON.stringify({ error: "upstream failed" }), { status: 500 }));

  const { response, body, text } = await requestJson(context, "/api/sources/office/index");

  assert.equal(response.status, 502);
  assert.equal(body.error, "远端索引请求失败：HTTP 500");
  assert.equal(body.details.code, "remote_index_http_failed");
  assert.notEqual(body.error, "Internal server error");
  assertRedacted(text);
});

test("remote index and health reject oversized declared bodies before reading them", async (t) => {
  let bodyReads = 0;
  const context = await withRemoteServer(t, async () => ({
    status: 200,
    ok: true,
    headers: { get: (name) => name === "content-length" ? "99999999" : null },
    get body() {
      bodyReads += 1;
      return new ReadableStream();
    },
  }));

  const index = await requestJson(context, "/api/sources/office/index");
  assert.equal(index.response.status, 502);
  assert.equal(index.body.details.code, "remote_index_non_json");
  const health = await requestJson(context, "/api/peers/office/test", { method: "POST" });
  assert.equal(health.response.status, 200);
  assert.equal(health.body.code, "remote_health_non_json");
  assert.equal(bodyReads, 0);
});

test("remote peer health unreachable returns structured redacted result", async (t) => {
  const context = await withRemoteServer(t, async (url, options) => {
    assert.match(String(url), /\/api\/share-health$/);
    assert.equal(options.headers.authorization, "Bearer secret-token");
    throw new Error("fetch failed http://user:secret@example.invalid/health authorization=Bearer secret-token");
  });

  const { response, body, text } = await requestJson(context, "/api/peers/office/test", { method: "POST" });

  assert.equal(response.status, 200);
  assert.equal(body.ok, false);
  assert.equal(body.status, 502);
  assert.equal(body.code, "remote_health_unreachable");
  assert.match(body.error, /远端健康检查不可达/);
  assert.notEqual(body.error, "Internal server error");
  assertRedacted(text);
});

test("remote peer health non JSON response returns actionable result", async (t) => {
  const context = await withRemoteServer(t, async () => new Response("not json", { status: 200 }));

  const { response, body, text } = await requestJson(context, "/api/peers/office/test", { method: "POST" });

  assert.equal(response.status, 200);
  assert.equal(body.ok, false);
  assert.equal(body.status, 502);
  assert.equal(body.code, "remote_health_non_json");
  assert.equal(body.error, "远端健康检查返回非 JSON。");
  assertRedacted(text);
});

test("remote peer health authentication failure returns clear result", async (t) => {
  const context = await withRemoteServer(t, async () => new Response(JSON.stringify({ error: "forbidden secret-token" }), { status: 403 }));

  const { response, body, text } = await requestJson(context, "/api/peers/office/test", { method: "POST" });

  assert.equal(response.status, 200);
  assert.equal(body.ok, false);
  assert.equal(body.status, 403);
  assert.equal(body.code, "remote_health_auth_failed");
  assert.equal(body.error, "远端认证失败。");
  assertRedacted(text);
});

test("pi session list and detail surface fork chain relationships", async (t) => {
  const context = await withRemoteServer(
    t,
    async () => new Response("not used"),
    async (tempRoot) => {
      const sessionsRoot = path.join(tempRoot, "pi-sessions", "--data-dev-demo--");
      const parentFile = path.join(sessionsRoot, "2026-09-14T01-00-00-000Z_11111111-1111-4111-8111-111111111111.jsonl");
      const childFile = path.join(sessionsRoot, "2026-09-14T02-00-00-000Z_22222222-2222-4222-8222-222222222222.jsonl");
      const grandchildFile = path.join(sessionsRoot, "2026-09-14T03-00-00-000Z_33333333-3333-4333-8333-333333333333.jsonl");
      const header = (id, timestamp, parentSession = null) =>
        `${JSON.stringify({ type: "session", version: 3, id, timestamp, cwd: "/data/dev/demo", ...(parentSession ? { parentSession } : {}) })}\n`;
      await mkdir(sessionsRoot, { recursive: true });
      process.env.CODEX_SESSION_RENDERER_PI_AGENT_SESSIONS_ROOT = sessionsRoot;
      const { writeFile } = await import("node:fs/promises");
      await writeFile(parentFile, header("11111111-1111-4111-8111-111111111111", "2026-09-14T01:00:00.000Z"), "utf8");
      await writeFile(childFile, header("22222222-2222-4222-8222-222222222222", "2026-09-14T02:00:00.000Z", parentFile), "utf8");
      await writeFile(grandchildFile, header("33333333-3333-4333-8333-333333333333", "2026-09-14T03:00:00.000Z", childFile), "utf8");
    },
  );

  const list = await requestJson(context, "/api/sources/pi-agent/sessions");
  assert.equal(list.response.status, 200);
  assert.equal(list.body.sessions.length, 3);
  const parent = list.body.sessions.find((session) => session.id === "11111111-1111-4111-8111-111111111111");
  const child = list.body.sessions.find((session) => session.id === "22222222-2222-4222-8222-222222222222");
  const grandchild = list.body.sessions.find((session) => session.id === "33333333-3333-4333-8333-333333333333");
  assert.equal(parent.parentSessionId, null);
  assert.equal(child.parentSessionId, "11111111-1111-4111-8111-111111111111");
  assert.equal(grandchild.parentSessionId, "22222222-2222-4222-8222-222222222222");

  const detail = await requestJson(context, "/api/sources/pi-agent/sessions/33333333-3333-4333-8333-333333333333");
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.related.parent.id, "22222222-2222-4222-8222-222222222222");
  assert.deepEqual(
    detail.body.related.chain.map((session) => session.id),
    ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"],
  );
  assert.equal(detail.body.related.children.length, 0);

  const rootDetail = await requestJson(context, "/api/sources/pi-agent/sessions/11111111-1111-4111-8111-111111111111");
  assert.equal(rootDetail.body.related.parent, null);
  assert.deepEqual(
    rootDetail.body.related.children.map((session) => session.id),
    ["22222222-2222-4222-8222-222222222222"],
  );
});
