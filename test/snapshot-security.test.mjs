import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDataSourceRegistry } from "../src/data-sources.mjs";
import { createRendererConfigStore } from "../src/renderer-config.mjs";

test("remote snapshots keep default and custom roots private on Unix", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-private-snapshots-"));
  try {
    const remoteHome = path.join(dir, "remote", ".codex");
    await mkdir(path.join(remoteHome, "sessions", "2026", "07", "17"), { recursive: true });
    await writeFile(path.join(remoteHome, "state_5.sqlite"), "sqlite", "utf8");
    await writeFile(path.join(remoteHome, "session_index.jsonl"), "{}\n", "utf8");
    await writeFile(path.join(remoteHome, "sessions", "2026", "07", "17", "session.jsonl"), "{}\n", "utf8");

    for (const [snapshotRoot, customRoot] of [
      [path.join(dir, ".codex-session-renderer", "remote-snapshots"), false],
      [path.join(dir, "custom-snapshots"), true],
    ]) {
      const env = {
        CODEX_HOME: path.join(dir, "local", ".codex"),
        CODEX_REMOTE_SOURCES: "office",
        CODEX_REMOTE_OFFICE_SNAPSHOT_PATH: remoteHome,
      };
      if (customRoot) env.CODEX_REMOTE_SNAPSHOT_ROOT = snapshotRoot;
      const registry = createDataSourceRegistry({ env, homeDir: dir });
      assert.equal((await registry.refreshSource("office")).ok, true);
      if (process.platform === "win32") continue;
      const sourceRoot = path.join(snapshotRoot, "office");
      const entries = [
        [sourceRoot, 0o700],
        [path.join(sourceRoot, "versions"), 0o700],
        [path.join(sourceRoot, ".codex-session-renderer-source.json"), 0o600],
        [path.join(sourceRoot, "current", "state_5.sqlite"), 0o600],
        [path.join(sourceRoot, "current", "session_index.jsonl"), 0o600],
        [path.join(sourceRoot, "current", "sessions"), 0o700],
        [path.join(sourceRoot, "current", "sessions", "2026", "07", "17", "session.jsonl"), 0o600],
        [path.join(sourceRoot, "current", ".codex-session-renderer-snapshot-source.json"), 0o600],
      ];
      for (const [entryPath, mode] of entries) assert.equal((await stat(entryPath)).mode & 0o777, mode, entryPath);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a truncated status recovers only from a complete snapshot with matching provenance", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-status-recovery-"));
  try {
    const remoteHome = path.join(dir, "remote", ".codex");
    const snapshotRoot = path.join(dir, "snapshots");
    await mkdir(path.join(remoteHome, "sessions"), { recursive: true });
    await writeFile(path.join(remoteHome, "sessions", "session.jsonl"), "{}\n", "utf8");
    const env = {
      CODEX_HOME: path.join(dir, "local", ".codex"),
      CODEX_REMOTE_SOURCES: "office",
      CODEX_REMOTE_OFFICE_SNAPSHOT_PATH: remoteHome,
      CODEX_REMOTE_SNAPSHOT_ROOT: snapshotRoot,
    };
    const firstRegistry = createDataSourceRegistry({ env, homeDir: dir });
    assert.equal((await firstRegistry.refreshSource("office")).ok, true);
    const statusPath = path.join(snapshotRoot, "office", ".codex-session-renderer-source.json");
    await writeFile(statusPath, "{\"status\":", "utf8");

    const recovered = createDataSourceRegistry({ env, homeDir: dir }).getSource("office");
    assert.equal(recovered.status.snapshotAvailable, true);
    assert.equal(recovered.status.needsRefresh, false);
    assert.equal(recovered.status.stale, true);
    assert.equal(recovered.status.error.code, "snapshot_status_recovered");

    await writeFile(
      path.join(snapshotRoot, "office", "current", ".codex-session-renderer-snapshot-source.json"),
      `${JSON.stringify({ schema: "remote-snapshot-source-v1", sourceVersion: "remote-v1-wrong-source" })}\n`,
      "utf8",
    );
    const rejected = createDataSourceRegistry({ env, homeDir: dir }).getSource("office");
    assert.equal(rejected.status.snapshotAvailable, false);
    assert.equal(rejected.status.needsRefresh, true);
    assert.equal(rejected.status.error.code, "snapshot_source_changed");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a failed atomic status replacement preserves the prior complete state", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-status-atomic-"));
  try {
    const remoteHome = path.join(dir, "remote", ".codex");
    const snapshotRoot = path.join(dir, "snapshots");
    await mkdir(path.join(remoteHome, "sessions"), { recursive: true });
    await writeFile(path.join(remoteHome, "sessions", "session.jsonl"), "{}\n", "utf8");
    const env = {
      CODEX_HOME: path.join(dir, "local", ".codex"),
      CODEX_REMOTE_SOURCES: "office",
      CODEX_REMOTE_OFFICE_SNAPSHOT_PATH: remoteHome,
      CODEX_REMOTE_SNAPSHOT_ROOT: snapshotRoot,
    };
    const initial = createDataSourceRegistry({ env, homeDir: dir });
    assert.equal((await initial.refreshSource("office")).ok, true);
    const statusPath = path.join(snapshotRoot, "office", ".codex-session-renderer-source.json");
    const previousStatus = await fs.readFile(statusPath, "utf8");
    const failingFs = {
      access: fs.access,
      chmod: fs.chmod,
      copyFile: fs.copyFile,
      mkdir: fs.mkdir,
      readFile: fs.readFile,
      readdir: fs.readdir,
      rm: fs.rm,
      symlink: fs.symlink,
      writeFile: fs.writeFile,
      async rename(from, to) {
        if (to === statusPath) throw new Error("simulated status replacement failure");
        await fs.rename(from, to);
      },
    };
    const retry = createDataSourceRegistry({ env, fsApi: failingFs, homeDir: dir });
    assert.equal((await retry.refreshSource("office")).ok, true);
    assert.equal(await fs.readFile(statusPath, "utf8"), previousStatus);
    assert.equal((await fs.readdir(path.dirname(statusPath))).some((name) => name.includes(".tmp")), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a failed config write leaves the active source fence and refresh semantics intact", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-config-fence-"));
  try {
    const remoteHome = path.join(dir, "remote", ".codex");
    await mkdir(path.join(remoteHome, "sessions"), { recursive: true });
    await writeFile(path.join(remoteHome, "sessions", "session.jsonl"), "{}\n", "utf8");
    const sourceIdentityRegistry = new Map();
    const registry = createDataSourceRegistry({
      env: {
        CODEX_HOME: path.join(dir, "local", ".codex"),
        CODEX_REMOTE_SOURCES: "office",
        CODEX_REMOTE_OFFICE_SNAPSHOT_PATH: remoteHome,
        CODEX_REMOTE_SNAPSHOT_ROOT: path.join(dir, "snapshots"),
      },
      homeDir: dir,
      sourceIdentityRegistry,
    });
    assert.equal((await registry.refreshSource("office")).ok, true);
    const source = registry.getSource("office");
    const configPath = path.join(dir, "config.json");
    await createRendererConfigStore({ configPath }).upsertPeer({ id: "office", url: "192.168.1.20:4791", token: "office-token" });
    const failingStore = createRendererConfigStore({
      configPath,
      fsApi: { ...fs, rename: async () => { throw new Error("simulated config replacement failure"); } },
      onCommittedMutation: () => sourceIdentityRegistry.delete("office"),
    });

    await assert.rejects(
      failingStore.upsertPeer({ id: "office", url: "192.168.1.21:4791", token: "new-office-token" }),
      /simulated config replacement failure/,
    );
    assert.equal(source.isCurrent(), true);
    assert.equal(source.status.snapshotAvailable, true);
    assert.equal((await registry.refreshSource("office")).ok, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});