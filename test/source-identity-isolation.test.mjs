import test from "node:test";
import assert from "node:assert/strict";
import { renameSync } from "node:fs";
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDataSourceRegistry } from "../src/data-sources.mjs";
import { createSharedSubscriptionRegistry } from "../src/prompt-archive-coordinator.mjs";
import { createSnapshotRootCommitCoordinator } from "../src/snapshot-root-commit-coordinator.mjs";

test("changing a source identity after the old final check cannot overwrite a newer current snapshot", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-source-identity-race-"));
  try {
    const remoteA = path.join(dir, "remote-a", ".codex");
    const remoteB = path.join(dir, "remote-b", ".codex");
    const snapshotRoot = path.join(dir, "snapshots", "office");
    await Promise.all([[remoteA, "old-source"], [remoteB, "new-source"]].map(([home, title]) => writeSource(home, title)));
    let releaseOldPublish;
    const oldPublishCanContinue = new Promise((resolve) => { releaseOldPublish = resolve; });
    let signalOldPublishStarted;
    const oldPublishStarted = new Promise((resolve) => { signalOldPublishStarted = resolve; });
    let oldPublishBlocked = false;
    let oldCurrentRenames = 0;
    const fsApi = { access, copyFile, mkdir, readFile, readdir, rename, rm, symlink, writeFile };
    const sourceIdentityRegistry = new Map();
    const refreshSubscriptions = createSharedSubscriptionRegistry();
    const snapshotCommitCoordinator = createSnapshotRootCommitCoordinator();
    const common = { fsApi, homeDir: dir, refreshSubscriptions, sourceIdentityRegistry, snapshotCommitCoordinator };
    const oldRegistry = createDataSourceRegistry({
      ...common,
      env: sourceEnv(dir, remoteA),
      beforeFinalCurrentPublish: async () => {
        if (oldPublishBlocked) return;
        oldPublishBlocked = true;
        signalOldPublishStarted();
        await oldPublishCanContinue;
      },
      renameCurrent(from, to) {
        oldCurrentRenames += 1;
        renameSync(from, to);
      },
    });
    const oldRefresh = oldRegistry.refreshSource("office");
    await oldPublishStarted;
    const newRegistry = createDataSourceRegistry({ ...common, env: sourceEnv(dir, remoteB) });
    const newSource = newRegistry.getSource("office");
    assert.equal(newSource.status.snapshotAvailable, false);
    assert.equal(newSource.status.needsRefresh, true);
    assert.equal(newSource.status.error.code, "snapshot_required");
    const newResult = await newRegistry.refreshSource("office");
    releaseOldPublish();
    const oldResult = await oldRefresh;

    assert.equal(newResult.ok, true);
    assert.equal(oldResult.ok, false);
    assert.equal(oldResult.status, 409);
    assert.equal(oldResult.source.status.error.code, "source_configuration_changed");
    assert.equal(oldCurrentRenames, 0);
    assert.match(await readFile(path.join(snapshotRoot, "current", "session_index.jsonl"), "utf8"), /new-source/);
    assert.equal(newSource.status.snapshotAvailable, true);
    assert.equal(newSource.status.needsRefresh, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("deleting a source fence at the final publication boundary leaves the prior current snapshot intact", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-source-delete-race-"));
  try {
    const remote = path.join(dir, "remote", ".codex");
    const snapshotRoot = path.join(dir, "snapshots", "office");
    await writeSource(remote, "before-delete");
    const sourceIdentityRegistry = new Map();
    let blockFinalPublish = false;
    let releaseFinalPublish;
    const finalPublishCanContinue = new Promise((resolve) => { releaseFinalPublish = resolve; });
    let signalFinalPublish;
    const finalPublishStarted = new Promise((resolve) => { signalFinalPublish = resolve; });
    const registry = createDataSourceRegistry({
      env: sourceEnv(dir, remote),
      homeDir: dir,
      sourceIdentityRegistry,
      beforeFinalCurrentPublish: async () => {
        if (!blockFinalPublish) return;
        signalFinalPublish();
        await finalPublishCanContinue;
      },
    });
    assert.equal((await registry.refreshSource("office")).ok, true);
    await writeFile(path.join(remote, "session_index.jsonl"), `${JSON.stringify({ id: "after-delete", thread_name: "after-delete" })}\n`, "utf8");

    blockFinalPublish = true;
    const oldRefresh = registry.refreshSource("office");
    await finalPublishStarted;
    sourceIdentityRegistry.delete("office");
    releaseFinalPublish();
    const oldResult = await oldRefresh;

    assert.equal(oldResult.ok, false);
    assert.equal(oldResult.status, 409);
    assert.equal(oldResult.source.status.error.code, "source_configuration_changed");
    assert.match(await readFile(path.join(snapshotRoot, "current", "session_index.jsonl"), "utf8"), /before-delete/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("different snapshot roots can prepare their final publications concurrently", { timeout: 2_000 }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-source-root-parallel-"));
  try {
    const remoteOne = path.join(dir, "remote-one", ".codex");
    const remoteTwo = path.join(dir, "remote-two", ".codex");
    await Promise.all([[remoteOne, "one"], [remoteTwo, "two"]].map(([home, title]) => writeSource(home, title)));
    let arrived = 0;
    let releaseFinalPublishes;
    const finalPublishesCanContinue = new Promise((resolve) => { releaseFinalPublishes = resolve; });
    let signalBothArrived;
    const bothArrived = new Promise((resolve) => { signalBothArrived = resolve; });
    const registry = createDataSourceRegistry({
      env: {
        CODEX_HOME: path.join(dir, "local", ".codex"),
        CODEX_REMOTE_SOURCES: "one,two",
        CODEX_REMOTE_ONE_SNAPSHOT_PATH: remoteOne,
        CODEX_REMOTE_TWO_SNAPSHOT_PATH: remoteTwo,
        CODEX_REMOTE_SNAPSHOT_ROOT: path.join(dir, "snapshots"),
      },
      homeDir: dir,
      beforeFinalCurrentPublish: async () => {
        arrived += 1;
        if (arrived === 2) signalBothArrived();
        await finalPublishesCanContinue;
      },
    });
    const one = registry.refreshSource("one");
    const two = registry.refreshSource("two");
    await bothArrived;
    releaseFinalPublishes();
    const [oneResult, twoResult] = await Promise.all([one, two]);

    assert.equal(oneResult.ok, true);
    assert.equal(twoResult.ok, true);
    assert.equal(arrived, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function sourceEnv(dir, snapshotPath) {
  return {
    CODEX_HOME: path.join(dir, "local", ".codex"),
    CODEX_REMOTE_SOURCES: "office",
    CODEX_REMOTE_OFFICE_SNAPSHOT_PATH: snapshotPath,
    CODEX_REMOTE_SNAPSHOT_ROOT: path.join(dir, "snapshots"),
  };
}

async function writeSource(home, title) {
  const sessions = path.join(home, "sessions", "2026", "07", "17");
  await mkdir(sessions, { recursive: true });
  await writeFile(path.join(home, "session_index.jsonl"), `${JSON.stringify({ id: title, thread_name: title })}\n`, "utf8");
  await writeFile(path.join(sessions, `${title}.jsonl`), "{}\n", "utf8");
}