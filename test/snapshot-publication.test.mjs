import test from "node:test";
import assert from "node:assert/strict";
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDataSourceRegistry } from "../src/data-sources.mjs";

test("atomic current pointer lets readers observe a complete old or new snapshot", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-snapshot-publication-"));
  try {
    const remoteHome = path.join(dir, "remote", ".codex");
    const snapshotRoot = path.join(dir, "snapshots", "remote");
    const currentIndex = path.join(snapshotRoot, "current", "session_index.jsonl");
    await mkdir(path.join(remoteHome, "sessions", "2026", "07", "17"), { recursive: true });
    await writeFile(path.join(remoteHome, "session_index.jsonl"), "old\n");
    await writeFile(path.join(remoteHome, "sessions", "2026", "07", "17", "old.jsonl"), "{}\n");
    let observeDuringPublish = false;
    const fsApi = {
      access,
      copyFile,
      mkdir,
      readFile,
      readdir,
      rm,
      symlink,
      writeFile,
      async rename(from, to) {
        if (observeDuringPublish && to === path.join(snapshotRoot, "current") && path.basename(from).startsWith(".current-")) {
          assert.equal(await readFile(currentIndex, "utf8"), "old\n");
        }
        await rename(from, to);
      },
    };
    const registry = createDataSourceRegistry({
      env: {
        CODEX_HOME: path.join(dir, "local", ".codex"),
        CODEX_REMOTE_SOURCES: "remote",
        CODEX_REMOTE_REMOTE_SNAPSHOT_PATH: remoteHome,
        CODEX_REMOTE_SNAPSHOT_ROOT: path.join(dir, "snapshots"),
      },
      fsApi,
      homeDir: dir,
    });
    assert.equal((await registry.refreshSource("remote")).ok, true);
    await writeFile(path.join(remoteHome, "session_index.jsonl"), "new\n");
    observeDuringPublish = true;
    assert.equal((await registry.refreshSource("remote")).ok, true);
    assert.equal(await readFile(currentIndex, "utf8"), "new\n");
    const versions = await readdir(path.join(snapshotRoot, "versions"));
    assert.equal(versions.length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
