import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runHarnessFixture } from "../src/harness-reproduction-runner.mjs";

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "harness-defect");
const fixturePath = path.join(fixtureDir, "fixture.json");

test("复现执行器在独立临时目录连续运行 candidate 和 baseline", async () => {
  const result = await runHarnessFixture(fixturePath);
  assert.equal(result.fixture.id, "H-DEMO-001");
  assert.equal(result.fixture.predicate, "no_duplicate_tool_execution");
  assert.equal(result.comparison.candidate.stable, true);
  assert.equal(result.comparison.baseline.stable, true);
  assert.equal(result.comparison.candidate.failed, true);
  assert.equal(result.comparison.baseline.failed, false);
  assert.equal(result.comparison.candidate.runs.length, 3);
  assert.equal(result.comparison.baseline.runs.length, 3);
  assert.deepEqual(result.comparison.candidate.runs.map((run) => run.actual.count), [1, 1, 1]);
  assert.deepEqual(result.comparison.baseline.runs.map((run) => run.actual.count), [0, 0, 0]);
});

test("复现执行器拒绝 fixture 外的 runner", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "harness-repro-invalid-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const fixture = {
    id: "H-INVALID",
    title: "无效 runner",
    predicate: { id: "must_not_run", type: "event_count", eventType: "tool", expected: 0 },
    expected: "不会执行",
    runner: "../outside.mjs",
    candidate: {},
    baseline: {},
  };
  const fixturePath = path.join(root, "fixture.json");
  await fs.writeFile(fixturePath, `${JSON.stringify(fixture)}\n`, "utf8");
  await assert.rejects(runHarnessFixture(fixturePath), /runner 必须是 fixture 内的相对路径/);
});

test("执行器从 trace 计算谓词，不信任 runner 自报 failed", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "harness-repro-trace-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "run.mjs"), 'process.stdout.write(JSON.stringify({ failed: false, trace: [{ type: "tool" }] }));\n', "utf8");
  const fixture = {
    id: "H-TRACE",
    title: "轨迹优先",
    predicate: { id: "no_tool", type: "event_count", eventType: "tool", expected: 0 },
    expected: "没有 tool",
    runner: "run.mjs",
    candidate: {},
    baseline: {},
  };
  const traceFixturePath = path.join(root, "fixture.json");
  await fs.writeFile(traceFixturePath, `${JSON.stringify(fixture)}\n`, "utf8");
  const result = await runHarnessFixture(traceFixturePath);
  assert.equal(result.comparison.candidate.failed, true);
  assert.equal(result.comparison.baseline.failed, true);
});

test("runner 执行失败会形成不稳定的可驳回结果", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "harness-repro-failure-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "run.mjs"), "process.exitCode = 2;\n", "utf8");
  const fixture = {
    id: "H-FAILURE",
    title: "runner 失败",
    predicate: { id: "no_tool", type: "event_count", eventType: "tool", expected: 0 },
    expected: "不会执行",
    runner: "run.mjs",
    candidate: {},
    baseline: {},
  };
  const failureFixturePath = path.join(root, "custom-fixture.json");
  await fs.writeFile(failureFixturePath, `${JSON.stringify(fixture)}\n`, "utf8");
  const result = await runHarnessFixture(failureFixturePath);
  assert.equal(result.comparison.candidate.stable, false);
  assert.equal(result.comparison.baseline.stable, false);
  assert.match(result.comparison.candidate.runs[0].error.message, /退出码为 2/);
});