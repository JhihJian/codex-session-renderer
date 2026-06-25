import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createDataSourceRegistry,
  parseRemoteDefinitions,
  sanitizeErrorMessage,
} from "../src/data-sources.mjs";

test("createDataSourceRegistry keeps local source compatible when remote is not configured", () => {
  const registry = createDataSourceRegistry({
    env: { CODEX_HOME: "/tmp/codex-home" },
    homeDir: "/home/user",
  });

  assert.deepEqual(
    registry.listSources().map((source) => [source.id, source.kind, source.status.refreshable]),
    [["local", "local", false]],
  );
  assert.equal(registry.getDefaultSource().codexHome, path.resolve("/tmp/codex-home"));
});

test("parseRemoteDefinitions builds multiple remote sources from runtime env only", () => {
  const definitions = parseRemoteDefinitions({
    CODEX_REMOTE_SOURCES: "office,lab",
    CODEX_REMOTE_OFFICE_LABEL: "Office Box",
    CODEX_REMOTE_OFFICE_SNAPSHOT_PATH: "/mnt/office/.codex",
    CODEX_REMOTE_OFFICE_CODEX_HOME: "/root/.codex",
    CODEX_REMOTE_LAB_SNAPSHOT_URL: "https://example.invalid/snapshot.tar.gz",
    CODEX_REMOTE_LAB_TOKEN_ENV: "LAB_TOKEN",
    LAB_TOKEN: "secret-token",
  });

  assert.equal(definitions.length, 2);
  assert.equal(definitions[0].id, "office");
  assert.equal(definitions[0].label, "Office Box");
  assert.equal(definitions[0].remoteCodexHome, "/root/.codex");
  assert.equal(definitions[1].tokenEnv, "LAB_TOKEN");
  assert.equal(definitions[1].token, "secret-token");
});

test("remote snapshot refresh publishes current atomically and keeps previous snapshot after failure", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-sources-"));
  try {
    const remoteHome = path.join(dir, "remote", ".codex");
    const snapshotRoot = path.join(dir, "snapshots", "remote");
    await mkdir(path.join(remoteHome, "sessions", "2026", "06", "25"), { recursive: true });
    await writeFile(path.join(remoteHome, "session_index.jsonl"), '{"id":"same-id","thread_name":"远程会话"}\n', "utf8");
    await writeFile(
      path.join(remoteHome, "sessions", "2026", "06", "25", "rollout-2026-06-25T01-02-03-same-id.jsonl"),
      '{"type":"session_meta","payload":{"timestamp":"2026-06-25T01:02:03.000Z"}}\n',
      "utf8",
    );

    const registry = createDataSourceRegistry({
      env: {
        CODEX_HOME: path.join(dir, "local", ".codex"),
        CODEX_REMOTE_SOURCES: "remote",
        CODEX_REMOTE_REMOTE_LABEL: "远程设备",
        CODEX_REMOTE_REMOTE_SNAPSHOT_PATH: remoteHome,
        CODEX_REMOTE_REMOTE_CODEX_HOME: "/root/.codex",
        CODEX_REMOTE_SNAPSHOT_ROOT: path.join(dir, "snapshots"),
      },
      homeDir: dir,
    });
    const source = registry.getSource("remote");

    await registry.refreshSource("remote");

    assert.equal(source.status.lastRefreshOk, true);
    assert.equal(source.status.snapshotAvailable, true);
    assert.equal(source.status.stale, false);
    assert.match(await readFile(path.join(snapshotRoot, "current", "session_index.jsonl"), "utf8"), /远程会话/);
    const successStatus = await readFile(path.join(snapshotRoot, ".codex-session-renderer-source.json"), "utf8");
    assert.match(successStatus, /远程设备/);
    assert.doesNotMatch(successStatus, /secret|authorization|Bearer/i);
    assert.equal(JSON.parse(successStatus).status.refreshing, false);

    source.definition.snapshotPath = path.join(dir, "missing", ".codex");
    await registry.refreshSource("remote");

    assert.equal(source.status.lastRefreshOk, false);
    assert.equal(source.status.snapshotAvailable, true);
    assert.equal(source.status.stale, true);
    assert.equal(source.status.error.code, "snapshot_failed");
    assert.match(await readFile(path.join(snapshotRoot, "current", "session_index.jsonl"), "utf8"), /远程会话/);
    assert.equal(JSON.parse(await readFile(path.join(snapshotRoot, ".codex-session-renderer-source.json"), "utf8")).status.refreshing, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("sanitizeErrorMessage redacts token and authorization fragments", () => {
  assert.equal(
    sanitizeErrorMessage("Authorization=Bearer abc.def token=secret-value\nsecond line"),
    "authorization=Bearer [redacted] token=[redacted]",
  );
});
