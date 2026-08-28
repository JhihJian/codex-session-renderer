import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHarnessDefectLab } from "../src/harness-defect-lab.mjs";

async function createTempLab() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "harness-defect-lab-"));
  return { root, lab: createHarnessDefectLab({ rootDir: path.join(root, "lab") }) };
}

function fixtureReference(root) {
  return {
    id: "H-001",
    title: "工具调用重复执行",
    predicate: "no_duplicate_tool_execution",
    path: path.join(root, "fixture.json"),
    command: "node run.mjs",
    expected: "工具调用次数为 0",
    versions: { candidate: "broken", baseline: "fixed" },
    runtime: { kind: "pi", candidate: { command: "pi", version: "candidate" }, baseline: { command: "pi", version: "baseline" } },
  };
}

function comparison({ candidateFailed = true, baselineFailed = false } = {}) {
  return {
    candidate: {
      stable: true,
      failed: candidateFailed,
      actual: { toolCallCount: candidateFailed ? 2 : 1 },
      runs: Array.from({ length: 3 }, () => ({ failed: candidateFailed })),
    },
    baseline: {
      stable: true,
      failed: baselineFailed,
      actual: { toolCallCount: baselineFailed ? 2 : 1 },
      runs: Array.from({ length: 3 }, () => ({ failed: baselineFailed })),
    },
  };
}

test("非可信 runner 输出只能登记为 inconclusive，不能直接确认", async (t) => {
  const { root, lab } = await createTempLab();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, "source.jsonl");
  const source = '{"type":"session"}\n';
  await fs.writeFile(sourcePath, source, "utf8");

  const archive = await lab.archiveSession({ sourcePath, sourceId: "pi-agent", sessionId: "session-1" });
  assert.equal(await fs.readFile(archive.archivePath, "utf8"), source);
  assert.equal(archive.sha256, createHash("sha256").update(source).digest("hex"));

  const candidate = await lab.createCandidate({
    archiveId: archive.id,
    eventIndex: 0,
    observation: "同一工具调用出现两次。",
    suspectedRule: "同一 tool call 只能执行一次。",
  });
  const result = await lab.recordReproduction({
    candidateId: candidate.id,
    fixture: fixtureReference(root),
    comparison: comparison(),
  });

  assert.equal(result.candidate.status, "inconclusive");
  assert.equal(result.reproduction.status, "inconclusive");
  assert.equal(result.defect, null);
  const state = await lab.list();
  assert.equal(state.archives.length, 1);
  assert.equal(state.candidates[0].status, "inconclusive");
  assert.equal(state.defects.length, 0);
});

test("非可信 runner 即使显示基线反证也不产生 rejected", async (t) => {
  const { root, lab } = await createTempLab();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, "source.jsonl");
  await fs.writeFile(sourcePath, '{"type":"session"}\n', "utf8");
  const archive = await lab.archiveSession({ sourcePath, sourceId: "pi-agent", sessionId: "session-2" });
  const candidate = await lab.createCandidate({
    archiveId: archive.id,
    eventIndex: 0,
    observation: "候选异常。",
    suspectedRule: "必须区分基线。",
  });

  const result = await lab.recordReproduction({
    candidateId: candidate.id,
    fixture: fixtureReference(root),
    comparison: comparison({ baselineFailed: true }),
  });
  assert.equal(result.candidate.status, "inconclusive");
  assert.equal(result.defect, null);
  assert.equal((await lab.list()).defects.length, 0);
});

test("不稳定的非可信结果登记为 inconclusive", async (t) => {
  const { root, lab } = await createTempLab();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, "source.jsonl");
  await fs.writeFile(sourcePath, '{"type":"session"}\n', "utf8");
  const archive = await lab.archiveSession({ sourcePath, sourceId: "pi-agent", sessionId: "session-3" });
  const candidate = await lab.createCandidate({ archiveId: archive.id, eventIndex: 0, observation: "不稳定。", suspectedRule: "必须稳定。" });
  const unstable = comparison();
  unstable.candidate.stable = false;
  unstable.candidate.failed = null;
  unstable.candidate.runs[2] = { error: { message: "runner failed" } };
  const result = await lab.recordReproduction({ candidateId: candidate.id, fixture: fixtureReference(root), comparison: unstable });
  assert.equal(result.candidate.status, "inconclusive");
  assert.equal((await lab.list()).candidates[0].status, "inconclusive");
});

test("候选必须指向归档中存在的 JSONL 事件", async (t) => {
  const { root, lab } = await createTempLab();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, "source.jsonl");
  await fs.writeFile(sourcePath, '{"type":"session"}\n', "utf8");
  const archive = await lab.archiveSession({ sourcePath, sourceId: "pi-agent", sessionId: "session-4" });
  await assert.rejects(
    lab.createCandidate({ archiveId: archive.id, eventIndex: 1, observation: "不存在。", suspectedRule: "必须存在。" }),
    /超出归档会话事件范围/,
  );
});

test("批量候选必须绑定同一冻结归档哈希", async (t) => {
  const { root, lab } = await createTempLab();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, "source.jsonl");
  await fs.writeFile(sourcePath, '{"type":"session"}\n', "utf8");
  const archive = await lab.archiveSession({ sourcePath, sourceId: "pi-agent", sessionId: "session-batch" });
  const batch = { archiveId: archive.id, candidates: [{ eventIndex: 0, eventType: "session", sourceHash: "other", detectorId: "provider-error-exit-status", detectorVersion: "1", dedupeKey: "key", observation: "错误。", suspectedRule: "规则。" }] };
  await assert.rejects(lab.createCandidates(batch), /sourceHash必须匹配冻结归档/);
});