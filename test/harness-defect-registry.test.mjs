import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHarnessDefectRegistryReader } from "../src/harness-defect-registry.mjs";

test("Harness 登记簿投影提供面向验证工作的状态、原因和执行关口", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "harness-registry-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const candidate = {
    id: "C-1",
    archiveId: "A-1",
    status: "blocked",
    reason: "verifiable_sandbox_required",
    observation: "被测命令错误地以成功退出。",
    suspectedRule: "错误响应必须以非零状态退出。",
    eventIndex: 8,
    eventType: "response_item",
    createdAt: "2026-08-28T01:00:00.000Z",
    updatedAt: "2026-08-28T02:00:00.000Z",
  };
  await fs.writeFile(path.join(root, "registry.json"), JSON.stringify({
    version: 2,
    archives: [{ id: "A-1", sourceId: "pi-agent", sessionId: "session-1", sha256: "a".repeat(64) }],
    candidates: [candidate],
    reproductions: [{ id: "R-1", candidateId: "C-1", trust: "trusted_executor", epoch: { id: "epoch-1" } }],
    defects: [],
    evidence: [],
    reviews: [],
    timeline: [],
  }), "utf8");

  const reader = createHarnessDefectRegistryReader({ rootDir: root });
  const overview = await reader.readOverview();
  assert.equal(overview.candidates[0].workflow.label, "已阻塞");
  assert.equal(overview.candidates[0].workflow.reason, "verifiable_sandbox_required");

  const detail = await reader.readCandidate("C-1", overview.revision);
  assert.equal(detail.reproductions[0].trust, "trusted_executor");
  assert.equal(detail.reproductions[0].epochId, "epoch-1");
});

test("登记簿概览将同源的旧版 provider error 记录收束为一个待验证线索", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "harness-registry-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const candidates = [4, 8, 12].map((eventIndex) => ({
    id: `C-${eventIndex}`,
    archiveId: "A-1",
    sourceHash: "a".repeat(64),
    detectorId: "provider-error-exit-status",
    detectorVersion: "1",
    status: "candidate",
    observation: "会话记录了 provider 错误，需验证非交互模式的退出状态。",
    suspectedRule: "最终 assistant 为 error 时，非交互输出必须返回非零退出码。",
    eventIndex,
    detection: { errorMessage: "400: Unsupported value: minimal", provider: "local-sub2api", model: "gpt-5.6-sol", exitStatusEvidence: "absent" },
  }));
  await fs.writeFile(path.join(root, "registry.json"), JSON.stringify({
    version: 2,
    archives: [{ id: "A-1", sourceId: "pi-agent", sessionId: "session-1", sha256: "a".repeat(64) }],
    candidates,
    reproductions: [],
    defects: [],
    evidence: [],
    reviews: [],
    timeline: [],
  }), "utf8");

  const reader = createHarnessDefectRegistryReader({ rootDir: root });
  const overview = await reader.readOverview();
  assert.equal(overview.candidates.length, 0);
  assert.equal(overview.externalErrors.length, 1);
  assert.equal(overview.externalErrors[0].memberCount, 3);
  assert.match(overview.externalErrors[0].title, /Unsupported value/);
  assert.equal(overview.externalErrors[0].case.sourceCount, 1);

  const detail = await reader.readCandidate(overview.externalErrors[0].id, overview.revision);
  assert.equal(detail.candidate.memberCount, 3);
  assert.equal(detail.candidate.detection.exitStatusEvidence, "absent");
});