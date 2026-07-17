import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDataSourceRegistry } from "../src/data-sources.mjs";

function remoteHttpEnv(dir, extra = {}) {
  return {
    CODEX_HOME: path.join(dir, "local", ".codex"),
    CODEX_REMOTE_SOURCES: "remote",
    CODEX_REMOTE_REMOTE_SNAPSHOT_URL: "http://example.invalid/snapshot.tar",
    CODEX_REMOTE_REMOTE_TOKEN: "token",
    CODEX_REMOTE_SNAPSHOT_ROOT: path.join(dir, "snapshots"),
    ...extra,
  };
}

test("remote HTTP snapshot rejects declared and chunked bodies above the configured cap", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-sources-http-cap-"));
  try {
    let bodyPulled = false;
    const declaredRegistry = createDataSourceRegistry({
      env: remoteHttpEnv(dir, { CODEX_REMOTE_SNAPSHOT_MAX_BYTES: "8" }),
      homeDir: dir,
      fetchImpl: async () => ({
        status: 200,
        ok: true,
        headers: { get: (name) => name === "content-length" ? "20" : null },
        get body() {
          bodyPulled = true;
          return new ReadableStream();
        },
      }),
    });
    const declared = await declaredRegistry.refreshSource("remote");
    assert.equal(declared.ok, false);
    assert.equal(declaredRegistry.getSource("remote").status.error.code, "snapshot_too_large");
    assert.equal(bodyPulled, false);

    const chunkedRegistry = createDataSourceRegistry({
      env: remoteHttpEnv(dir, { CODEX_REMOTE_SNAPSHOT_MAX_BYTES: "8" }),
      homeDir: dir,
      fetchImpl: async () => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("1234"));
          controller.enqueue(new TextEncoder().encode("56789"));
          controller.close();
        },
      }), { status: 200 }),
    });
    const chunked = await chunkedRegistry.refreshSource("remote");
    assert.equal(chunked.ok, false);
    assert.equal(chunkedRegistry.getSource("remote").status.error.code, "snapshot_too_large");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("remote HTTP deadline and final subscriber cancellation stop transport", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-sources-http-cancel-"));
  try {
    let aborted = 0;
    const registry = createDataSourceRegistry({
      env: remoteHttpEnv(dir, { CODEX_REMOTE_HTTP_DEADLINE_MS: "20" }),
      homeDir: dir,
      fetchImpl: async (url, options) => new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          aborted += 1;
          reject(options.signal.reason);
        }, { once: true });
      }),
    });
    const timeout = await registry.refreshSource("remote");
    assert.equal(timeout.ok, false);
    assert.equal(registry.getSource("remote").status.error.code, "snapshot_deadline_exceeded");

    const first = new AbortController();
    const second = new AbortController();
    const one = registry.refreshSource("remote", { signal: first.signal });
    const two = registry.refreshSource("remote", { signal: second.signal });
    await waitFor(() => aborted === 1, 100);
    first.abort();
    await assert.rejects(one, { name: "AbortError" });
    assert.equal(aborted, 1);
    second.abort();
    await assert.rejects(two, { name: "AbortError" });
    await waitFor(() => aborted === 2, 100);
    assert.equal(aborted, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("remote refresh gate limits different sources globally", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-sources-global-gate-"));
  try {
    const started = [];
    let releaseFirst;
    const firstCanFinish = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    const registry = createDataSourceRegistry({
      env: {
        CODEX_HOME: path.join(dir, "local", ".codex"),
        CODEX_REMOTE_SOURCES: "one,two",
        CODEX_REMOTE_ONE_SNAPSHOT_URL: "http://example.invalid/one",
        CODEX_REMOTE_TWO_SNAPSHOT_URL: "http://example.invalid/two",
        CODEX_REMOTE_ONE_TOKEN: "token",
        CODEX_REMOTE_TWO_TOKEN: "token",
        CODEX_REMOTE_SNAPSHOT_ROOT: path.join(dir, "snapshots"),
        CODEX_REMOTE_MAX_CONCURRENT_REFRESHES: "1",
      },
      homeDir: dir,
      fetchImpl: async (url) => {
        started.push(String(url));
        if (String(url).endsWith("/one")) await firstCanFinish;
        return new Response("upstream failure", { status: 500 });
      },
    });
    const one = registry.refreshSource("one");
    const two = registry.refreshSource("two");
    await waitFor(() => started.length === 1, 100);
    assert.equal(started.length, 1);
    releaseFirst();
    await Promise.all([one, two]);
    assert.equal(started.length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("timed out waiting for asynchronous test state");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}
