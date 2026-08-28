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
    { type: "message", message: { role: "assistant", stopReason: "error" } },
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

test("provider error 线索按会话聚合，并明确归档不含退出码证据", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "harness-discovery-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "session.jsonl");
  const rows = [
    { type: "message", message: { role: "assistant", stopReason: "error" } },
    { type: "snapshot", message: { role: "assistant", stopReason: "error" } },
    { type: "message", message: { role: "tool", stopReason: "error" } },
    { type: "message", message: { role: "assistant", stopReason: "error" } },
  ];
  await fs.writeFile(file, `${rows.map(JSON.stringify).join("\n")}\n`, "utf8");

  const result = await discoverHarnessCandidates({ archivePath: file, detectorIds: "provider-error-exit-status" });
  assert.equal(result.detectors[0].version, "2");
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].eventIndex, 0);
  assert.deepEqual(result.matches[0].evidence, { firstEventIndex: 0, lastEventIndex: 3, occurrenceCount: 2, exitStatusEvidence: "absent" });
  assert.match(result.matches[0].observation, /未记录非交互进程退出码/);
});

test("扫描器拒绝未知规则，避免把未覆盖范围伪装为全量", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "harness-discovery-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "session.jsonl");
  await fs.writeFile(file, '{"type":"message"}\n', "utf8");
  await assert.rejects(discoverHarnessCandidates({ archivePath: file, detectorIds: "unknown" }), /未知 detectorId/);
});