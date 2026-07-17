import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const token = "renderer-access-token";
const envKeys = ["CODEX_HOME", "HOME", "USERPROFILE", "CODEX_SESSION_RENDERER_TOKEN"];

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

function basicAuthorization(value) {
  return `Basic ${Buffer.from(`codex:${value}`, "utf8").toString("base64")}`;
}

function assertSecurityHeaders(response) {
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
}

function assertStartupRules(assertSecureListenConfig, createRendererServer, startServer) {
  assert.doesNotThrow(() => assertSecureListenConfig({ host: "127.0.0.1", token: "" }));
  assert.doesNotThrow(() => assertSecureListenConfig({ host: "::1", token: "" }));
  assert.throws(() => assertSecureListenConfig({ host: "0.0.0.0", token: "" }), /CODEX_SESSION_RENDERER_TOKEN/);
  assert.throws(() => createRendererServer({ host: "0.0.0.0", token: "" }), /CODEX_SESSION_RENDERER_TOKEN/);
  assert.throws(() => startServer({ host: "0.0.0.0", port: 0, token: "" }), /CODEX_SESSION_RENDERER_TOKEN/);
  assert.doesNotThrow(() => assertSecureListenConfig({ host: "192.168.1.20", token }));
}

async function assertProtectedRoutes(baseUrl) {
  const unauthorized = await Promise.all([
    fetch(`${baseUrl}/`),
    fetch(`${baseUrl}/api/health`),
    fetch(`${baseUrl}/api/peers`, { method: "POST", body: "{}" }),
    fetch(`${baseUrl}/api/sources/local/refresh`, { method: "POST" }),
  ]);
  for (const response of unauthorized) assert.equal(response.status, 401);
  const [staticUnauthorized, readUnauthorized] = unauthorized;
  assert.match(staticUnauthorized.headers.get("www-authenticate") || "", /^Basic /);
  assertSecurityHeaders(staticUnauthorized);
  assertSecurityHeaders(readUnauthorized);
  assert.doesNotMatch(await staticUnauthorized.text(), new RegExp(token));

  const wrongCredentials = await fetch(`${baseUrl}/api/health`, { headers: { authorization: basicAuthorization("wrong-token") } });
  assert.equal(wrongCredentials.status, 401);
  const staticAuthorized = await fetch(`${baseUrl}/`, { headers: { authorization: basicAuthorization(token) } });
  assert.equal(staticAuthorized.status, 200);
  assertSecurityHeaders(staticAuthorized);

  const healthAuthorized = await fetch(`${baseUrl}/api/health`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(healthAuthorized.status, 200);
  assert.doesNotMatch(await healthAuthorized.text(), new RegExp(token));
  await assertAuthorizedWriteRoutes(baseUrl);
}

async function assertAuthorizedWriteRoutes(baseUrl) {
  const peerAuthorized = await fetch(`${baseUrl}/api/peers`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ id: "office", label: "Office", url: "127.0.0.1:4791", token: "peer-token" }),
  });
  assert.equal(peerAuthorized.status, 200);
  assert.doesNotMatch(await peerAuthorized.text(), /peer-token/);
  const refreshAuthorized = await fetch(`${baseUrl}/api/sources/local/refresh`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
  assert.equal(refreshAuthorized.status, 400);
  assertSecurityHeaders(refreshAuthorized);
}

test("non-loopback renderer requires credentials for static, read, and write routes", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "csr-access-"));
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  let server;
  try {
    process.env.CODEX_HOME = path.join(tempRoot, ".codex");
    process.env.HOME = tempRoot;
    process.env.USERPROFILE = tempRoot;
    process.env.CODEX_SESSION_RENDERER_TOKEN = token;
    const moduleUrl = `${pathToFileURL(path.resolve("server.mjs")).href}?access=${Date.now()}`;
    const { assertSecureListenConfig, createAccessControl, createRendererServer, startServer } = await import(moduleUrl);

    assertStartupRules(assertSecureListenConfig, createRendererServer, startServer);

    server = createRendererServer({ host: "0.0.0.0", token, accessControl: createAccessControl({ host: "0.0.0.0", token }) });
    const address = await listen(server);
    const baseUrl = `http://127.0.0.1:${address.port}`;

    await assertProtectedRoutes(baseUrl);
  } finally {
    if (server?.listening) await close(server);
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
});