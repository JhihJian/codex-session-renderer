import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createSnapshotBuildCoordinator } from "../src/snapshot-share.mjs";

test("snapshot build coordinator merges equivalent requests and retains archive until every lease releases", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-share-coordinator-"));
  try {
    const coordinator = createSnapshotBuildCoordinator({ maxConcurrent: 1, maxQueued: 1 });
    let builds = 0;
    const build = async () => {
      builds += 1;
      const workDir = path.join(dir, "work");
      await mkdir(workDir);
      const archivePath = path.join(workDir, "snapshot.tar");
      await writeFile(archivePath, "archive");
      return archivePath;
    };
    const [first, second] = await Promise.all([
      coordinator.acquire("same", build),
      coordinator.acquire("same", build),
    ]);
    assert.equal(builds, 1);
    assert.equal(first.archivePath, second.archivePath);
    await first.release();
    await assert.doesNotReject(writeFile(second.archivePath, "still-readable"));
    await second.release();
    await assert.rejects(writeFile(second.archivePath, "gone"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("snapshot build coordinator enforces a bounded queue and aborts work after the final cancellation", async () => {
  const coordinator = createSnapshotBuildCoordinator({ maxConcurrent: 1, maxQueued: 0 });
  let aborted = false;
  const firstController = new AbortController();
  const first = coordinator.acquire("one", (signal) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => {
      aborted = true;
      const error = new Error("The operation was aborted");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  }), firstController.signal);
  await new Promise((resolve) => setImmediate(resolve));
  assert.throws(() => coordinator.acquire("two", async () => "/tmp/never"), { code: "snapshot_build_queue_full" });
  firstController.abort();
  await assert.rejects(first, { name: "AbortError" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(aborted, true);
});
