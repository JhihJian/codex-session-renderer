import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { once } from "node:events";
import { createConnection } from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const environmentKeys = [
  "CODEX_HOME",
  "HOME",
  "USERPROFILE",
  "CODEX_REMOTE_SOURCES",
  "CODEX_REMOTE_PEERS",
  "CODEX_REMOTE_SOURCE_ID",
  "CODEX_REMOTE_SNAPSHOT_ROOT",
  "CODEX_REMOTE_REMOTE_SNAPSHOT_URL",
  "CODEX_REMOTE_REMOTE_TOKEN",
  "HOST",
];

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address());
    });
  });
}

function waitFor(check, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        if (await check()) return resolve();
        if (Date.now() >= deadline) return reject(new Error("Timed out waiting for condition"));
        return setTimeout(poll, 10);
      } catch (error) {
        reject(error);
      }
    };
    void poll();
  });
}

function restoreEnvironment(previous) {
  for (const [key, value] of Object.entries(previous)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
}

test("客户端中止刷新 POST 会取消服务端订阅、上游下载和未提交 staging", async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "csr-refresh-http-cancel-"));
  const previous = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
  let resolveSnapshotRequest;
  const snapshotRequested = new Promise((resolve) => {
    resolveSnapshotRequest = resolve;
  });
  let upstreamResponse;
  const upstream = createServer((req, res) => {
    if (!req.url?.startsWith("/snapshot.tar")) {
      res.writeHead(404).end();
      return;
    }
    upstreamResponse = res;
    res.writeHead(200, { "content-type": "application/x-tar" });
    res.write("slow snapshot body");
    resolveSnapshotRequest();
  });
  const upstreamAddress = await listen(upstream);
  let client = null;

  const snapshotRoot = path.join(tempRoot, "snapshots", "remote");
  process.env.CODEX_HOME = path.join(tempRoot, ".codex");
  process.env.HOME = tempRoot;
  process.env.USERPROFILE = tempRoot;
  process.env.CODEX_REMOTE_SOURCES = "remote";
  process.env.CODEX_REMOTE_PEERS = "";
  process.env.CODEX_REMOTE_SOURCE_ID = "";
  process.env.CODEX_REMOTE_SNAPSHOT_ROOT = path.join(tempRoot, "snapshots");
  process.env.CODEX_REMOTE_REMOTE_SNAPSHOT_URL = `http://127.0.0.1:${upstreamAddress.port}/snapshot.tar`;
  process.env.CODEX_REMOTE_REMOTE_TOKEN = "test-token";
  process.env.HOST = "127.0.0.1";

  const { createRendererServer } = await import(`${pathToFileURL(path.resolve("server.mjs")).href}?refreshCancellation=${Date.now()}`);

  const renderer = createRendererServer();
  t.after(async () => {
    client?.destroy();
    upstreamResponse?.end();
    await new Promise((resolve) => renderer.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
    restoreEnvironment(previous);
    await rm(tempRoot, { recursive: true, force: true });
  });
  const rendererAddress = await listen(renderer);

  const baseUrl = `http://127.0.0.1:${rendererAddress.port}`;
  const configuredSources = await fetch(`${baseUrl}/api/sources`).then((response) => response.json());
  assert.equal(configuredSources.sources.some((source) => source.id === "remote" && source.kind === "remote"), true);
  client = createConnection({ host: "127.0.0.1", port: rendererAddress.port });
  client.on("error", () => {});
  await once(client, "connect");
  client.write("POST /api/sources/remote/refresh HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 0\r\n\r\n");

  await snapshotRequested;
  client.destroy();
  await waitFor(async () => {
    const sources = await fetch(`${baseUrl}/api/sources`).then((response) => response.json());
    return sources.sources.find((source) => source.id === "remote").status.refreshing === false;
  });
  await waitFor(async () => {
    if (!existsSync(snapshotRoot)) return true;
    return (await readdir(snapshotRoot)).every((entry) => !entry.startsWith("staging-"));
  });
  assert.equal(existsSync(path.join(snapshotRoot, "current")), false);
  const sourceStatus = await fetch(`${baseUrl}/api/sources`).then((response) => response.json());
  assert.equal(sourceStatus.sources.find((source) => source.id === "remote").status.refreshing, false);
});
