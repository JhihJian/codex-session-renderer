import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { dedupeSessionFileRecords, sessionFileRoots } from "../src/session-catalog.mjs";

test("sessionFileRoots includes live sessions and archived_sessions fallback", () => {
  assert.deepEqual(sessionFileRoots("/tmp/codex"), [
    { root: path.join("/tmp/codex", "sessions"), archived: false },
    { root: path.join("/tmp/codex", "archived_sessions"), archived: true },
  ]);
});

test("dedupeSessionFileRecords prefers live copies and keeps archived-only sessions", () => {
  const records = dedupeSessionFileRecords([
    {
      id: "same-id",
      filePath: "/tmp/codex/archived_sessions/rollout-2026-07-07T01-00-00-same-id.jsonl",
      archived: true,
      stat: { mtimeMs: 200 },
    },
    {
      id: "same-id",
      filePath: "/tmp/codex/sessions/2026/07/07/rollout-2026-07-07T01-00-00-same-id.jsonl",
      archived: false,
      stat: { mtimeMs: 100 },
    },
    {
      id: "archived-only",
      filePath: "/tmp/codex/archived_sessions/rollout-2026-07-07T02-00-00-archived-only.jsonl",
      archived: true,
      stat: { mtimeMs: 300 },
    },
  ]);

  assert.equal(records.length, 2);
  assert.equal(records.find((record) => record.id === "same-id").archived, false);
  assert.equal(records.find((record) => record.id === "archived-only").archived, true);
});
