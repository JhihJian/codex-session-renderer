import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const commandPath = path.join(projectRoot, "scripts", "harness-defects.mjs");
const fixturePath = path.join(projectRoot, "test", "fixtures", "harness-defect", "fixture.json");

function runCli(args) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [commandPath, ...args], { cwd: projectRoot }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve(JSON.parse(stdout));
    });
  });
}

test("CLI 将普通 replay 结果登记为 inconclusive", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "harness-defect-cli-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, "session.jsonl");
  const labPath = path.join(root, "lab");
  await fs.writeFile(sourcePath, '{"type":"session"}\n', "utf8");

  const archive = await runCli([
    "archive", "--lab", labPath, "--source", sourcePath, "--source-id", "pi-agent", "--session", "session-cli",
  ]);
  const candidate = await runCli([
    "candidate", "--lab", labPath, "--archive", archive.archive.id, "--event", "0", "--observation", "重复调用", "--rule", "不得重复",
  ]);
  const result = await runCli([
    "run", "--lab", labPath, "--candidate", candidate.candidate.id, "--fixture", fixturePath,
  ]);
  const state = await runCli(["list", "--lab", labPath]);
  const replay = await runCli(["replay", "--fixture", fixturePath]);

  assert.equal(result.candidate.status, "inconclusive");
  assert.equal(result.defect, null);
  assert.equal(state.defects.length, 0);
  assert.equal(state.reproductions[0].comparison.candidate.runs.length, 3);
  assert.equal(replay.comparison.candidate.failed, true);
  assert.equal(replay.comparison.baseline.failed, false);
});

test("scan-all 覆盖所有 JSONL、汇总命中并在重复扫描时去重", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "harness-defect-scan-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sessions = path.join(root, "sessions");
  const labPath = path.join(root, "lab");
  await fs.mkdir(path.join(sessions, "nested"), { recursive: true });
  await fs.writeFile(path.join(sessions, "first.jsonl"), '{"message":{"stopReason":"error"}}\n', "utf8");
  await fs.writeFile(path.join(sessions, "nested", "second.jsonl"), '{"message":{"stopReason":"error"}}\ninvalid\n', "utf8");

  const first = await runCli(["scan-all", "--lab", labPath, "--root", sessions, "--detector", "provider-error-exit-status"]);
  const second = await runCli(["scan-all", "--lab", labPath, "--root", sessions, "--detector", "provider-error-exit-status"]);
  const state = await runCli(["list", "--lab", labPath]);

  assert.equal(first.filesDiscovered, 2);
  assert.equal(first.filesScanned, 2);
  assert.equal(first.filesFailed, 0);
  assert.equal(first.eventsScanned, 2);
  assert.equal(first.invalidLines, 1);
  assert.equal(first.matches, 2);
  assert.equal(first.created, 2);
  assert.equal(second.created, 0);
  assert.equal(second.deduped, 2);
  assert.equal(state.candidates.length, 2);
});