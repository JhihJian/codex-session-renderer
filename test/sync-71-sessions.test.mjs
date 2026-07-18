import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { createDataSourceRegistry } from "../src/data-sources.mjs";
import {
  makeBatches,
  normalizeRemotePath,
  parseArgs,
  parseManifest,
  planSync,
  remoteManifestCommand,
  stateFromManifest,
  sync71,
} from "../scripts/sync-71-sessions.mjs";

const execFileAsync = promisify(execFile);

test("parseManifest keeps only supported Codex snapshot paths", () => {
  const entries = parseManifest([
    "12\t1780000000\tstate_5.sqlite",
    "13\t1780000001\tsession_index.jsonl",
    "14\t1780000002\tsessions/2026/06/26/rollout-a.jsonl",
    "15\t1780000003\tsessions/not-json.txt",
    "16\t1780000004\t../escape.jsonl",
    "bad\t1780000005\tsessions/bad.jsonl",
  ].join("\n"));

  assert.deepEqual(entries.map((entry) => entry.relativePath), [
    "state_5.sqlite",
    "session_index.jsonl",
    "sessions/2026/06/26/rollout-a.jsonl",
  ]);
  assert.equal(entries[0].size, 12);
  assert.equal(entries[2].mtime, 1780000002);
});

test("planSync detects changed, deleted, batched and large files", () => {
  const remoteFiles = [
    { relativePath: "state_5.sqlite", size: 100, mtime: 1 },
    { relativePath: "sessions/a.jsonl", size: 300, mtime: 2 },
    { relativePath: "sessions/b.jsonl", size: 300, mtime: 3 },
    { relativePath: "sessions/c.jsonl", size: 900, mtime: 4 },
  ];
  const localState = {
    files: {
      "state_5.sqlite": { size: 100, mtime: 1 },
      "sessions/a.jsonl": { size: 100, mtime: 2 },
      "sessions/old.jsonl": { size: 10, mtime: 1 },
    },
  };

  const plan = planSync(remoteFiles, localState, { maxBatchBytes: 600, deleteMissing: true });

  assert.deepEqual(plan.changed.map((entry) => entry.relativePath), [
    "sessions/a.jsonl",
    "sessions/b.jsonl",
    "sessions/c.jsonl",
  ]);
  assert.deepEqual(plan.deleted, ["sessions/old.jsonl"]);
  assert.deepEqual(plan.batches.map((batch) => batch.map((entry) => entry.relativePath)), [["sessions/a.jsonl", "sessions/b.jsonl"]]);
  assert.deepEqual(plan.largeFiles.map((entry) => entry.relativePath), ["sessions/c.jsonl"]);
});

test("makeBatches preserves order while respecting max raw size", () => {
  const files = [
    { relativePath: "a", size: 200 },
    { relativePath: "b", size: 250 },
    { relativePath: "c", size: 300 },
  ];
  assert.deepEqual(makeBatches(files, 500).map((batch) => batch.map((entry) => entry.relativePath)), [["a", "b"], ["c"]]);
});

test("stateFromManifest stores normalized file metadata", () => {
  const state = stateFromManifest(
    [
      { relativePath: "sessions\\a.jsonl", size: 1, mtime: 2 },
      { relativePath: "state_5.sqlite", size: 3, mtime: 4 },
    ],
    { remoteHome: "/root/.codex" },
  );
  assert.equal(state.version, 1);
  assert.equal(state.remoteHome, "/root/.codex");
  assert.deepEqual(state.files["sessions/a.jsonl"], { size: 1, mtime: 2 });
  assert.deepEqual(state.files["state_5.sqlite"], { size: 3, mtime: 4 });
});

test("parseArgs applies defaults and validates output chunk sizing", () => {
  const options = parseArgs(["--target", "/tmp/dev71", "--limit", "10", "--skip-state-db", "--no-delete"]);
  assert.equal(options.target, path.resolve("/tmp/dev71"));
  assert.equal(options.limit, 10);
  assert.equal(options.includeStateDb, false);
  assert.equal(options.deleteMissing, false);
  assert.throws(() => parseArgs(["--chunk-bytes", "1048576", "--output-cap-bytes", "1048576"]), /too large/);
});

test("remoteManifestCommand quotes remote home and can exclude state db", () => {
  const command = remoteManifestCommand("/root/.codex with space", false);
  assert.match(command, /cd '\/root\/.codex with space'/);
  assert.doesNotMatch(command, /state_5\.sqlite/);
  assert.match(command, /session_index\.jsonl/);
});

test("normalizeRemotePath canonicalizes separators", () => {
  assert.equal(normalizeRemotePath("sessions\\2026\\a.jsonl"), "sessions/2026/a.jsonl");
});

test("first limited sync is marked partial and cannot publish before full recovery", async (t) => {
  const fixture = await createSyncFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));

  await sync71({ ...fixture.options, target: fixture.partialTarget, limit: 1 });
  assert.equal((await readSyncState(fixture.partialTarget)).complete, false);
  assert.deepEqual(await targetSessions(fixture.partialTarget), ["third.jsonl"]);

  const registry = createFixtureRegistry(fixture, fixture.partialTarget);
  const rejected = await registry.refreshSource("dev71");
  assert.equal(rejected.ok, false);
  assert.equal(rejected.source.status.error.code, "partial_sync_snapshot");
  assert.equal(await exists(path.join(fixture.snapshotRoot, "dev71", "current")), false);

  await sync71({ ...fixture.options, target: fixture.partialTarget });
  assert.equal((await readSyncState(fixture.partialTarget)).complete, true);
  assert.deepEqual(await targetSessions(fixture.partialTarget), ["first.jsonl", "second.jsonl", "third.jsonl"]);

  const published = await registry.refreshSource("dev71");
  assert.equal(published.ok, true);
  assert.deepEqual(await targetSessions(path.join(fixture.snapshotRoot, "dev71", "current")), ["first.jsonl", "second.jsonl", "third.jsonl"]);
});

test("limited run preserves a complete target and a later full run deletes confirmed remote removals", async (t) => {
  const fixture = await createSyncFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));

  await sync71(fixture.options);
  const registry = createFixtureRegistry(fixture, fixture.target);
  assert.equal((await registry.refreshSource("dev71")).ok, true);

  await assert.rejects(
    sync71({ ...fixture.options, limit: 1 }),
    /目标已有完整同步状态，拒绝 --limit/,
  );
  assert.equal((await readSyncState(fixture.target)).complete, true);
  assert.deepEqual(await targetSessions(fixture.target), ["first.jsonl", "second.jsonl", "third.jsonl"]);
  assert.deepEqual(await targetSessions(path.join(fixture.snapshotRoot, "dev71", "current")), ["first.jsonl", "second.jsonl", "third.jsonl"]);

  await rm(path.join(fixture.remoteHome, "sessions", "2026", "07", "18", "second.jsonl"));
  await sync71(fixture.options);
  assert.deepEqual(await targetSessions(fixture.target), ["first.jsonl", "third.jsonl"]);
  assert.equal((await registry.refreshSource("dev71")).ok, true);
  assert.deepEqual(await targetSessions(path.join(fixture.snapshotRoot, "dev71", "current")), ["first.jsonl", "third.jsonl"]);
});

test("Linux staging writes never mutate hard-linked published files when publish fails", { skip: process.platform !== "linux" }, async (t) => {
  const fixture = await createSyncFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));

  await sync71(fixture.options);
  const trackedPaths = [
    ".codex-session-renderer-71-sync.json",
    "sessions/2026/07/18/first.jsonl",
    "sessions/2026/07/18/second.jsonl",
  ];
  const before = await Promise.all(trackedPaths.map(async (relativePath) => {
    const targetPath = path.join(fixture.target, relativePath);
    return { relativePath, bytes: await readFile(targetPath), inode: (await stat(targetPath)).ino };
  }));

  const remoteSessionRoot = path.join(fixture.remoteHome, "sessions", "2026", "07", "18");
  await writeFile(path.join(remoteSessionRoot, "first.jsonl"), "new first session\n", "utf8");
  await writeFile(path.join(remoteSessionRoot, "second.jsonl"), "new second session\n", "utf8");
  const changedAt = new Date(Date.now() + 2_000);
  await Promise.all([
    utimes(path.join(remoteSessionRoot, "first.jsonl"), changedAt, changedAt),
    utimes(path.join(remoteSessionRoot, "second.jsonl"), changedAt, changedAt),
  ]);

  await assert.rejects(
    sync71({
      ...fixture.options,
      publishStaging: async () => {
        throw new Error("injected publish failure");
      },
    }),
    /injected publish failure/,
  );

  for (const entry of before) {
    const targetPath = path.join(fixture.target, entry.relativePath);
    assert.deepEqual(await readFile(targetPath), entry.bytes, entry.relativePath);
    assert.equal((await stat(targetPath)).ino, entry.inode, entry.relativePath);
  }
});

async function createSyncFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "csr-sync71-"));
  const remoteHome = path.join(root, "remote", ".codex");
  const target = path.join(root, "target", ".codex");
  const partialTarget = path.join(root, "partial-target", ".codex");
  const snapshotRoot = path.join(root, "snapshots");
  await writeRemoteFixture(remoteHome);
  return {
    root,
    remoteHome,
    target,
    partialTarget,
    snapshotRoot,
    options: syncOptions(target, remoteHome),
  };
}

async function writeRemoteFixture(remoteHome) {
  const sessionRoot = path.join(remoteHome, "sessions", "2026", "07", "18");
  await mkdir(sessionRoot, { recursive: true });
  await writeFile(path.join(remoteHome, "state_5.sqlite"), "state\n", "utf8");
  await writeFile(path.join(remoteHome, "session_index.jsonl"), "{\"id\":\"fixture\"}\n", "utf8");
  await Promise.all(["first", "second", "third"].map((name, index) => writeSession(sessionRoot, name, index)));
}

async function writeSession(sessionRoot, name, index) {
  const sessionPath = path.join(sessionRoot, `${name}.jsonl`);
  const timestamp = new Date(1_700_000_000_000 + index * 1_000);
  await writeFile(sessionPath, `${JSON.stringify({ type: "session_meta", payload: { id: name } })}\n`, "utf8");
  await utimes(sessionPath, timestamp, timestamp);
}

function syncOptions(target, remoteHome) {
  return {
    target,
    remoteHome,
    remoteExec: localRemoteExec,
    includeStateDb: true,
    maxBatchBytes: 600 * 1024,
    outputCapBytes: 1024 * 1024,
    chunkBytes: 512 * 1024,
    limit: null,
    deleteMissing: true,
    dryRun: false,
    refresh: false,
    rendererUrl: "http://127.0.0.1:4789",
    sourceId: "dev71",
    verbose: false,
  };
}

async function localRemoteExec(command) {
  return await execFileAsync("bash", ["-c", command], { maxBuffer: 8 * 1024 * 1024 });
}

function createFixtureRegistry(fixture, snapshotPath) {
  return createDataSourceRegistry({
    homeDir: fixture.root,
    env: {
      CODEX_REMOTE_SOURCES: "dev71",
      CODEX_REMOTE_DEV71_SNAPSHOT_PATH: snapshotPath,
      CODEX_REMOTE_DEV71_CODEX_HOME: "/root/.codex",
      CODEX_REMOTE_SNAPSHOT_ROOT: fixture.snapshotRoot,
    },
  });
}

async function readSyncState(target) {
  return JSON.parse(await readFile(path.join(target, ".codex-session-renderer-71-sync.json"), "utf8"));
}

async function targetSessions(codexHome) {
  const sessionRoot = path.join(codexHome, "sessions", "2026", "07", "18");
  try {
    return (await readdir(sessionRoot)).filter((name) => name.endsWith(".jsonl")).toSorted();
  } catch {
    return [];
  }
}

async function exists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}
