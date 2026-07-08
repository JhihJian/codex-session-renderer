import test from "node:test";
import assert from "node:assert/strict";
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
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

test("parseRemoteDefinitions accepts compact peer URLs", () => {
  const definitions = parseRemoteDefinitions({
    CODEX_REMOTE_PEERS: "office|Office Box=192.168.1.20:4791,lab=https://lab.example.test/share.tar.gz",
    CODEX_REMOTE_TOKEN: "shared-token",
  });

  assert.equal(definitions.length, 2);
  assert.equal(definitions[0].id, "office");
  assert.equal(definitions[0].label, "Office Box");
  assert.equal(definitions[0].snapshotUrl, "http://192.168.1.20:4791/api/codex-snapshot.tar?scope=realtime");
  assert.equal(definitions[0].tokenEnv, "CODEX_REMOTE_TOKEN");
  assert.equal(definitions[0].token, "shared-token");
  assert.equal(definitions[1].id, "lab");
  assert.equal(definitions[1].snapshotUrl, "https://lab.example.test/share.tar.gz");
});

test("createDataSourceRegistry includes peers from persisted renderer config", () => {
  const registry = createDataSourceRegistry({
    env: { CODEX_HOME: "/tmp/codex-home" },
    homeDir: "/home/user",
    config: {
      peers: [
        {
          id: "office",
          label: "Office",
          url: "http://192.168.1.20:4791",
          token: "secret-token",
        },
      ],
    },
  });

  const source = registry.getSource("office");
  assert.equal(source.label, "Office");
  assert.equal(source.definition.snapshotUrl, "http://192.168.1.20:4791/api/codex-snapshot.tar?scope=realtime");
  assert.equal(source.definition.indexUrl, "http://192.168.1.20:4791/api/codex-session-index");
  assert.equal(source.definition.token, "secret-token");
  assert.equal(source.origin.managed, true);
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

test("remote snapshot refresh reuses one in-flight refresh for the same source", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-sources-singleflight-"));
  try {
    const remoteHome = path.join(dir, "remote", ".codex");
    const snapshotRoot = path.join(dir, "snapshots", "remote");
    await mkdir(path.join(remoteHome, "sessions", "2026", "06", "25"), { recursive: true });
    await writeFile(path.join(remoteHome, "session_index.jsonl"), '{"id":"same-id","thread_name":"并发远程会话"}\n', "utf8");
    await writeFile(
      path.join(remoteHome, "sessions", "2026", "06", "25", "concurrent-2026-06-25T01-02-03-same-id.jsonl"),
      '{"type":"session_meta","payload":{"timestamp":"2026-06-25T01:02:03.000Z"}}\n',
      "utf8",
    );

    let copiedFromRemote = 0;
    let currentPublishes = 0;
    let unblockFirstCopy;
    const firstCopyStarted = new Promise((resolve) => {
      unblockFirstCopy = resolve;
    });
    let releaseFirstCopy;
    const firstCopyCanContinue = new Promise((resolve) => {
      releaseFirstCopy = resolve;
    });
    let blockedFirstRemoteCopy = false;
    const fsApi = {
      access,
      mkdir,
      readFile,
      readdir,
      rm,
      writeFile,
      async copyFile(from, to) {
        if (isPathInside(remoteHome, from)) {
          copiedFromRemote += 1;
          if (!blockedFirstRemoteCopy) {
            blockedFirstRemoteCopy = true;
            unblockFirstCopy();
            await firstCopyCanContinue;
          }
        }
        await copyFile(from, to);
      },
      async rename(from, to) {
        if (to === path.join(snapshotRoot, "current")) {
          currentPublishes += 1;
        }
        await rename(from, to);
      },
    };

    const registry = createDataSourceRegistry({
      env: {
        CODEX_HOME: path.join(dir, "local", ".codex"),
        CODEX_REMOTE_SOURCES: "remote",
        CODEX_REMOTE_REMOTE_LABEL: "远程设备",
        CODEX_REMOTE_REMOTE_SNAPSHOT_PATH: remoteHome,
        CODEX_REMOTE_REMOTE_CODEX_HOME: "/root/.codex",
        CODEX_REMOTE_SNAPSHOT_ROOT: path.join(dir, "snapshots"),
      },
      fsApi,
      homeDir: dir,
    });

    const firstRefresh = registry.refreshSource("remote");
    await firstCopyStarted;
    const secondRefresh = registry.refreshSource("remote");
    releaseFirstCopy();
    const [firstResult, secondResult] = await Promise.all([firstRefresh, secondRefresh]);

    assert.equal(firstResult, secondResult);
    assert.equal(firstResult.ok, true);
    assert.equal(secondResult.status, 200);
    assert.equal(copiedFromRemote, 2);
    assert.equal(currentPublishes, 1);
    assert.match(await readFile(path.join(snapshotRoot, "current", "session_index.jsonl"), "utf8"), /并发远程会话/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("remote snapshot refresh clears failed in-flight refresh before later retry", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-sources-singleflight-failure-"));
  try {
    const remoteHome = path.join(dir, "remote", ".codex");
    const snapshotRoot = path.join(dir, "snapshots", "remote");

    let remotePathAccesses = 0;
    let copiedFromRemote = 0;
    let currentPublishes = 0;
    let unblockFirstMissingAccess;
    const firstMissingAccessStarted = new Promise((resolve) => {
      unblockFirstMissingAccess = resolve;
    });
    let releaseFirstMissingAccess;
    const firstMissingAccessCanContinue = new Promise((resolve) => {
      releaseFirstMissingAccess = resolve;
    });
    let blockedFirstMissingAccess = false;
    const fsApi = {
      async access(filePath) {
        if (filePath === remoteHome) {
          remotePathAccesses += 1;
          if (!blockedFirstMissingAccess) {
            blockedFirstMissingAccess = true;
            unblockFirstMissingAccess();
            await firstMissingAccessCanContinue;
          }
        }
        await access(filePath);
      },
      mkdir,
      readFile,
      readdir,
      rm,
      writeFile,
      async copyFile(from, to) {
        if (isPathInside(remoteHome, from)) {
          copiedFromRemote += 1;
        }
        await copyFile(from, to);
      },
      async rename(from, to) {
        if (to === path.join(snapshotRoot, "current")) {
          currentPublishes += 1;
        }
        await rename(from, to);
      },
    };

    const registry = createDataSourceRegistry({
      env: {
        CODEX_HOME: path.join(dir, "local", ".codex"),
        CODEX_REMOTE_SOURCES: "remote",
        CODEX_REMOTE_REMOTE_LABEL: "远程设备",
        CODEX_REMOTE_REMOTE_SNAPSHOT_PATH: remoteHome,
        CODEX_REMOTE_REMOTE_CODEX_HOME: "/root/.codex",
        CODEX_REMOTE_SNAPSHOT_ROOT: path.join(dir, "snapshots"),
      },
      fsApi,
      homeDir: dir,
    });

    const firstRefresh = registry.refreshSource("remote");
    await firstMissingAccessStarted;
    const secondRefresh = registry.refreshSource("remote");
    releaseFirstMissingAccess();
    const [firstResult, secondResult] = await Promise.all([firstRefresh, secondRefresh]);

    assert.equal(firstResult, secondResult);
    assert.equal(firstResult.ok, false);
    assert.equal(firstResult.status, 502);
    assert.equal(firstResult.source.status.lastRefreshOk, false);
    assert.equal(firstResult.source.status.snapshotAvailable, false);
    assert.equal(firstResult.source.status.error.code, "snapshot_failed");
    assert.equal(remotePathAccesses, 1);
    assert.equal(copiedFromRemote, 0);
    assert.equal(currentPublishes, 0);

    await mkdir(path.join(remoteHome, "sessions", "2026", "06", "25"), { recursive: true });
    await writeFile(path.join(remoteHome, "session_index.jsonl"), '{"id":"retry-id","thread_name":"第三次远程会话"}\n', "utf8");
    await writeFile(
      path.join(remoteHome, "sessions", "2026", "06", "25", "retry-2026-06-25T01-02-03-retry-id.jsonl"),
      '{"type":"session_meta","payload":{"timestamp":"2026-06-25T01:02:03.000Z"}}\n',
      "utf8",
    );

    const thirdResult = await registry.refreshSource("remote");

    assert.notEqual(thirdResult, firstResult);
    assert.equal(thirdResult.ok, true);
    assert.equal(thirdResult.status, 200);
    assert.equal(thirdResult.source.status.lastRefreshOk, true);
    assert.equal(thirdResult.source.status.snapshotAvailable, true);
    assert.equal(remotePathAccesses, 2);
    assert.equal(copiedFromRemote, 2);
    assert.equal(currentPublishes, 1);
    assert.match(await readFile(path.join(snapshotRoot, "current", "session_index.jsonl"), "utf8"), /第三次远程会话/);
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

function isPathInside(parentPath, childPath) {
  const relative = path.relative(parentPath, childPath);
  return relative === "" || (relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}
