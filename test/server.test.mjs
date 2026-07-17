import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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
];

let importCounter = 0;

async function withRemoteServer(t, fetchImpl) {
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
