import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import {
  makeBatches,
  normalizeRemotePath,
  parseArgs,
  parseManifest,
  planSync,
  remoteManifestCommand,
  stateFromManifest,
} from "../scripts/sync-71-sessions.mjs";

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
