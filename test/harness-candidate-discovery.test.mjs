import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { discoverHarnessCandidates } from "../src/harness-candidate-discovery.mjs";

test("版本化发现器扫描五类结构规则并保留逻辑事件索引", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "harness-discovery-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "session.jsonl");
  const rows = [
    { type: "tool_call", toolCallId: "call-1" },
    { type: "tool_call", toolCallId: "call-1" },
    { type: "tool_call", toolCallId: "without-result" },
    { message: { stopReason: "error" } },
    { status: "cancelled" },
    { type: "tool_call", toolCallId: "after-cancel" },
    { contextMessageCount: 2, contextMessages: [{}] },
  ];
  await fs.writeFile(file, `${rows.map(JSON.stringify).join("\n")}\ninvalid\n`, "utf8");
  const result = await discoverHarnessCandidates({ archivePath: file });
  assert.equal(result.eventsScanned, 7);
  assert.equal(result.invalidLines, 1);
  assert.deepEqual(new Set(result.matches.map((match) => match.detectorId)), new Set(["duplicate-tool-call", "missing-tool-result", "provider-error-exit-status", "cancelled-after-execution", "context-projection-invariant"]));
  assert.equal(result.matches.every((match) => Number.isSafeInteger(match.eventIndex) && match.dedupeKey.length === 64), true);
});

test("扫描器拒绝未知规则，避免把未覆盖范围伪装为全量", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "harness-discovery-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "session.jsonl");
  await fs.writeFile(file, '{"type":"message"}\n', "utf8");
  await assert.rejects(discoverHarnessCandidates({ archivePath: file, detectorIds: "unknown" }), /未知 detectorId/);
});