import assert from "node:assert/strict";
import { appendFile, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applyStaleRunningStatus,
  applyStaleStatusToTurns,
  isStaleRunning,
  readTailSessionStatus,
} from "../src/session-status.mjs";

const minuteMs = 60 * 1000;
const threshold = 30 * minuteMs;

test("applyStaleRunningStatus downgrades only stale running sessions", () => {
  const now = Date.now();
  assert.equal(applyStaleRunningStatus("running", now - 29 * minuteMs, now, threshold), "running");
  assert.equal(applyStaleRunningStatus("running", now - 30 * minuteMs, now, threshold), "stopped");
  assert.equal(applyStaleRunningStatus("running", now - 31 * minuteMs, now, threshold), "stopped");
  assert.equal(applyStaleRunningStatus("waiting", now - 24 * 60 * minuteMs, now, threshold), "waiting");
  assert.equal(applyStaleRunningStatus("completed", now - 24 * 60 * minuteMs, now, threshold), "completed");
  assert.equal(applyStaleRunningStatus(null, now - 24 * 60 * minuteMs, now, threshold), null);
  assert.equal(applyStaleRunningStatus("running", NaN, now, threshold), "running");
});

test("isStaleRunning requires a finite age", () => {
  const now = Date.now();
  assert.equal(isStaleRunning(now - threshold, now, threshold), true);
  assert.equal(isStaleRunning(now - threshold + 1, now, threshold), false);
  assert.equal(isStaleRunning(NaN, now, threshold), false);
});

test("applyStaleStatusToTurns only downgrades the final running turn", () => {
  const now = Date.now();
  const turns = [
    { id: "turn-1", status: "completed" },
    { id: "turn-2", status: "running" },
  ];
  const downgraded = applyStaleStatusToTurns(turns, now - threshold, now, threshold);
  assert.equal(downgraded[0].status, "completed");
  assert.equal(downgraded[1].status, "stopped");
  assert.equal(turns[1].status, "running", "input turns stay untouched");

  const fresh = applyStaleStatusToTurns(turns, now - minuteMs, now, threshold);
  assert.equal(fresh[1].status, "running");
  const waiting = applyStaleStatusToTurns([{ id: "t", status: "waiting" }], now - 24 * 60 * minuteMs, now, threshold);
  assert.equal(waiting[0].status, "waiting");
  assert.deepEqual(applyStaleStatusToTurns([], now, now), []);
});

test("readTailSessionStatus derives status from the file tail, not the head", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "csr-status-tail-"));
  const filePath = path.join(root, "session.jsonl");
  t.after(() => rm(root, { recursive: true, force: true }));

  // Head: an unterminated first turn. Tail: a completed turn.
  const lines = [
    JSON.stringify({ type: "event_msg", timestamp: "2026-01-01T00:00:00.000Z", payload: { type: "task_started", turn_id: "t1" } }),
    JSON.stringify({ type: "event_msg", timestamp: "2026-01-01T00:00:01.000Z", payload: { type: "user_message", message: "hi" } }),
    JSON.stringify({ type: "event_msg", timestamp: "2026-01-01T00:00:02.000Z", payload: { type: "task_complete", last_agent_message: "done" } }),
  ];
  await writeFile(filePath, lines.join("\n") + "\n", "utf8");
  const fileStat = await stat(filePath);

  const status = await readTailSessionStatus(filePath, fileStat);
  assert.equal(status, "completed");

  const stale = await readTailSessionStatus(filePath, { ...fileStat, mtimeMs: Date.now() - 24 * 60 * minuteMs });
  assert.equal(stale, "completed", "terminal statuses never downgrade");
});

test("readTailSessionStatus drops a partial first line cut by the window", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "csr-status-window-"));
  const filePath = path.join(root, "session.jsonl");
  t.after(() => rm(root, { recursive: true, force: true }));

  const filler = JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: {} } });
  const tail = [
    JSON.stringify({ type: "event_msg", payload: { type: "task_started", turn_id: "t9" } }),
    JSON.stringify({ type: "event_msg", payload: { type: "task_complete", last_agent_message: "ok" } }),
  ];
  const padding = Array.from({ length: 200 }, () => filler).join("\n");
  await writeFile(filePath, padding + "\n" + tail.join("\n") + "\n", "utf8");
  const fileStat = await stat(filePath);

  // Force the window to start mid-record by capping the read window.
  const { readCommittedJsonlChunk } = await import("../src/jsonl-tail-reader.mjs");
  const tiny = await readCommittedJsonlChunk(filePath, { startOffset: 1, endOffset: fileStat.size, skipPartialStart: true });
  assert.equal(tiny.events.at(-1).payload.type, "task_complete");
  assert.ok(tiny.events.every((event) => !event.__jsonlDiagnostic));

  const status = await readTailSessionStatus(filePath, fileStat);
  assert.equal(status, "completed");
});

test("readTailSessionStatus downgrades a stale unterminated tail to stopped", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "csr-status-stopped-"));
  const filePath = path.join(root, "session.jsonl");
  t.after(() => rm(root, { recursive: true, force: true }));

  const lines = [
    JSON.stringify({ type: "event_msg", timestamp: "2026-01-01T00:00:00.000Z", payload: { type: "task_started", turn_id: "t1" } }),
    JSON.stringify({ type: "event_msg", timestamp: "2026-01-01T00:00:01.000Z", payload: { type: "user_message", message: "hi" } }),
    JSON.stringify({ type: "event_msg", timestamp: "2026-01-01T00:00:02.000Z", payload: { type: "exec_command_begin", command: "sleep" } }),
  ];
  await writeFile(filePath, lines.join("\n") + "\n", "utf8");
  const fileStat = await stat(filePath);

  assert.equal(await readTailSessionStatus(filePath, fileStat), "running");
  const stale = await readTailSessionStatus(filePath, { ...fileStat, mtimeMs: Date.now() - 31 * minuteMs });
  assert.equal(stale, "stopped");
});

test("readTailSessionStatus ignores an uncommitted half-written tail", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "csr-status-half-"));
  const filePath = path.join(root, "session.jsonl");
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(filePath, '{"type":"message","message":{"role":"user"', "utf8");
  await appendFile(filePath, "", "utf8");
  const fileStat = await stat(filePath);
  assert.equal(await readTailSessionStatus(filePath, fileStat), null);
});
