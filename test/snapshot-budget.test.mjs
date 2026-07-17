import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import * as tar from "tar";
import { createDataSourceRegistry } from "../src/data-sources.mjs";
import { createSnapshotArchive, snapshotShareConfig } from "../src/snapshot-share.mjs";

const fixedNow = () => new Date("2026-07-17T12:00:00.000Z");

test("snapshot share documents configurable content budgets and applies them to scope=all", async () => {
  const config = snapshotShareConfig({
    env: {
      CODEX_SHARE_SNAPSHOT_MAX_SOURCE_BYTES: "101",
      CODEX_SHARE_SNAPSHOT_MAX_FILES: "7",
      CODEX_SHARE_SNAPSHOT_MAX_ARCHIVE_BYTES: "102",
      CODEX_SHARE_SNAPSHOT_BUILD_DEADLINE_MS: "103",
    },
  });
  assert.deepEqual(
    [config.maxSourceBytes, config.maxFiles, config.maxArchiveBytes, config.buildDeadlineMs],
    [101, 7, 102, 103],
  );

  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-share-budget-"));
  try {
    const codexHome = await createCodexHome(dir, ["old.jsonl", "new.jsonl"]);
    await assert.rejects(
      createSnapshotArchive({
        codexHome,
        scope: "all",
        tempRoot: dir,
        now: fixedNow,
        limits: { maxSourceBytes: 1024 * 1024, maxFiles: 3, maxArchiveBytes: 1024 * 1024, deadlineMs: 1_000 },
      }),
      { code: "snapshot_source_too_many_files" },
    );
    assert.deepEqual((await readdir(dir)).filter((name) => name.startsWith("csr-share-")), []);

    await assert.rejects(
      createSnapshotArchive({
        codexHome,
        scope: "all",
        tempRoot: dir,
        now: fixedNow,
        limits: { maxSourceBytes: 20, maxFiles: 10, maxArchiveBytes: 1024 * 1024, deadlineMs: 1_000 },
      }),
      { code: "snapshot_source_too_large" },
    );

    await assert.rejects(
      createSnapshotArchive({
        codexHome,
        scope: "all",
        tempRoot: dir,
        now: fixedNow,
        limits: { maxSourceBytes: 1024 * 1024, maxFiles: 10, maxArchiveBytes: 64, deadlineMs: 1_000 },
      }),
      { code: "snapshot_archive_too_large" },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("snapshot share cancellation removes its work directory", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-share-cancel-"));
  try {
    const codexHome = await createCodexHome(dir, ["session.jsonl"]);
    const controller = new AbortController();
    const fsApi = {
      ...fs,
      async copyFile(from, to) {
        await fs.copyFile(from, to);
        controller.abort();
      },
    };
    await assert.rejects(
      createSnapshotArchive({
        codexHome,
        tempRoot: dir,
        fsApi,
        signal: controller.signal,
        now: fixedNow,
      }),
      { name: "AbortError" },
    );
    assert.deepEqual((await readdir(dir)).filter((name) => name.startsWith("csr-share-")), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("snapshot share deadline rejects and cleans its work directory", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-share-deadline-"));
  try {
    const codexHome = await createCodexHome(dir, ["session.jsonl"]);
    const fsApi = {
      ...fs,
      async copyFile(from, to) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        await fs.copyFile(from, to);
      },
    };
    await assert.rejects(
      createSnapshotArchive({
        codexHome,
        tempRoot: dir,
        fsApi,
        now: fixedNow,
        limits: { maxSourceBytes: 1024 * 1024, maxFiles: 10, maxArchiveBytes: 1024 * 1024, deadlineMs: 5 },
      }),
      (error) => {
        assert.equal(error.code, "snapshot_build_deadline_exceeded");
        assert.equal(error.status, 504);
        return true;
      },
    );
    assert.deepEqual((await readdir(dir)).filter((name) => name.startsWith("csr-share-")), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("remote unpack accepts a bounded normal archive", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-unpack-normal-"));
  try {
    const remoteHome = await createCodexHome(dir, ["normal.jsonl"]);
    const archive = await archiveCodexHome(dir, remoteHome);
    const registry = createDataSourceRegistry({
      env: remoteEnv(dir, {
        CODEX_REMOTE_REMOTE_SNAPSHOT_URL: "http://example.invalid/snapshot.tar",
        CODEX_REMOTE_REMOTE_TOKEN: "token",
      }),
      homeDir: dir,
      fetchImpl: async () => new Response(await readFile(archive), { status: 200 }),
    });
    assert.equal((await registry.refreshSource("remote")).ok, true);
    assert.equal(await readFile(path.join(dir, "snapshots", "remote", "current", "session_index.jsonl"), "utf8"), '{"id":"old"}\n');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("remote unpack rejects expanded gzip and excess files without replacing current", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-unpack-budget-"));
  try {
    const remoteHome = await createCodexHome(path.join(dir, "source"), ["old.jsonl"]);
    const snapshotRoot = path.join(dir, "snapshots");
    const registry = createDataSourceRegistry({
      env: remoteEnv(dir, { CODEX_REMOTE_REMOTE_SNAPSHOT_PATH: remoteHome }),
      homeDir: dir,
      now: fixedNow,
    });
    assert.equal((await registry.refreshSource("remote")).ok, true);
    const source = registry.getSource("remote");
    assert.equal(await readFile(path.join(snapshotRoot, "remote", "current", "session_index.jsonl"), "utf8"), '{"id":"old"}\n');

    const bombHome = await createCodexHome(path.join(dir, "bomb"), ["large.jsonl"], "x".repeat(20_000));
    const bombArchive = await archiveCodexHome(dir, bombHome, true);
    source.definition.snapshotPath = "";
    source.definition.snapshotUrl = "http://example.invalid/snapshot.tar.gz";
    source.definition.token = "token";
    registry.refreshLimits.snapshotMaxExpandedBytes = 2_000;
    registry.refreshLimits.snapshotMaxFiles = 10;
    const response = await readFile(bombArchive);
    source.definition.snapshotUrl = "http://example.invalid/snapshot.tar.gz";
    const fetchImpl = async () => new Response(response, { status: 200 });
    const bombRegistry = createDataSourceRegistry({
      env: remoteEnv(dir, {
        CODEX_REMOTE_REMOTE_SNAPSHOT_URL: source.definition.snapshotUrl,
        CODEX_REMOTE_REMOTE_TOKEN: "token",
        CODEX_REMOTE_SNAPSHOT_MAX_EXPANDED_BYTES: "2000",
      }),
      homeDir: dir,
      now: fixedNow,
      fetchImpl,
    });
    const bombSource = bombRegistry.getSource("remote");
    const bomb = await bombRegistry.refreshSource("remote");
    assert.equal(bomb.ok, false);
    assert.equal(bombSource.status.error.code, "snapshot_expanded_too_large");
    assert.equal(await readFile(path.join(snapshotRoot, "remote", "current", "session_index.jsonl"), "utf8"), '{"id":"old"}\n');
    assert.equal((await readdir(path.join(snapshotRoot, "remote"))).some((name) => name.startsWith("staging-")), false);

    const manyHome = await createCodexHome(path.join(dir, "many"), []);
    await mkdir(path.join(manyHome, "sessions", "a", "b", "c"), { recursive: true });
    const manyArchive = await archiveCodexHome(dir, manyHome);
    const manyRegistry = createDataSourceRegistry({
      env: remoteEnv(dir, {
        CODEX_REMOTE_REMOTE_SNAPSHOT_URL: "http://example.invalid/snapshot.tar",
        CODEX_REMOTE_REMOTE_TOKEN: "token",
        CODEX_REMOTE_SNAPSHOT_MAX_FILES: "2",
      }),
      homeDir: dir,
      now: fixedNow,
      fetchImpl: async () => new Response(await readFile(manyArchive), { status: 200 }),
    });
    const manySource = manyRegistry.getSource("remote");
    const many = await manyRegistry.refreshSource("remote");
    assert.equal(many.ok, false);
    assert.equal(manySource.status.error.code, "snapshot_too_many_files");
    assert.equal(await readFile(path.join(snapshotRoot, "remote", "current", "session_index.jsonl"), "utf8"), '{"id":"old"}\n');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function createCodexHome(parent, sessionNames, body = "{}\n") {
  const codexHome = path.join(parent, ".codex");
  const sessions = path.join(codexHome, "sessions", "2026", "07", "17");
  await mkdir(sessions, { recursive: true });
  await writeFile(path.join(codexHome, "session_index.jsonl"), '{"id":"old"}\n', "utf8");
  await Promise.all(sessionNames.map((name) => writeFile(path.join(sessions, name), body, "utf8")));
  return codexHome;
}

async function archiveCodexHome(dir, codexHome, gzip = false) {
  const archivePath = path.join(dir, `archive-${gzip ? "gzip" : "plain"}-${Date.now()}-${Math.random()}.tar`);
  await tar.c({ cwd: codexHome, file: archivePath, portable: true }, ["."]);
  if (!gzip) return archivePath;
  const compressedPath = `${archivePath}.gz`;
  await writeFile(compressedPath, gzipSync(await readFile(archivePath)));
  return compressedPath;
}

function remoteEnv(dir, extra = {}) {
  return {
    CODEX_HOME: path.join(dir, "local", ".codex"),
    CODEX_REMOTE_SOURCES: "remote",
    CODEX_REMOTE_SNAPSHOT_ROOT: path.join(dir, "snapshots"),
    ...extra,
  };
}
