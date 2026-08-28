import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const runCount = 3;

async function runHarnessFixture(fixturePath, options = {}) {
  const fsApi = options.fsApi || fs;
  const spawnProcess = options.spawnProcess || spawn;
  const temporaryDirectory = options.mkdtemp || fsApi.mkdtemp.bind(fsApi);
  const removeDirectory = options.rm || fsApi.rm.bind(fsApi);
  const fixtureFile = path.resolve(fixturePath);
  const fixtureDir = path.dirname(fixtureFile);
  const fixture = normalizeFixture(JSON.parse(await fsApi.readFile(fixtureFile, "utf8")), fixtureFile);
  const root = await temporaryDirectory(path.join(os.tmpdir(), "harness-defect-"));
  try {
    const candidate = await runVariant("candidate", fixture, fixtureDir, root, { spawnProcess });
    const baseline = await runVariant("baseline", fixture, fixtureDir, root, { spawnProcess });
    return {
      fixture: {
        id: fixture.id,
        title: fixture.title,
        predicate: fixture.predicate.id,
        path: options.fixtureReference || fixtureFile,
        command: options.command || `${process.execPath} ${fixture.runner}`,
        expected: fixture.expected,
        versions: { candidate: fixture.candidate, baseline: fixture.baseline },
        runtime: fixture.runtime ? { kind: fixture.runtime.kind, candidate: candidate.runtime, baseline: baseline.runtime } : null,
      },
      comparison: { candidate, baseline },
    };
  } finally {
    await removeDirectory(root, { recursive: true, force: true });
  }
}

async function runVariant(variant, fixture, fixtureDir, root, { spawnProcess }) {
  const runs = [];
  for (let index = 0; index < runCount; index += 1) {
    const workdir = path.join(root, variant, String(index + 1));
    await fs.mkdir(workdir, { recursive: true });
    runs.push(await executeRunner({ variant, index, fixture, fixtureDir, workdir, spawnProcess }));
  }
  const successfulRuns = runs.filter((run) => !run.error);
  const stable = successfulRuns.length === runCount && successfulRuns.every((run) => run.failed === successfulRuns[0].failed);
  return {
    runtime: successfulRuns[0]?.runtime ?? null,
    stable,
    failed: stable ? successfulRuns[0].failed : null,
    actual: stable ? successfulRuns[0].actual : null,
    runs,
  };
}

async function executeRunner({ variant, index, fixture, fixtureDir, workdir, spawnProcess }) {
  const scriptPath = path.resolve(fixtureDir, fixture.runner);
  if (!pathIsInside(fixtureDir, scriptPath)) throw reproductionError("runner 必须位于 fixture 目录内。");
  const runtime = await inspectRuntime(fixture.runtime?.[variant], spawnProcess);
  if (runtime?.error) return { error: runtime.error, runtime };
  const result = await spawnNode(spawnProcess, scriptPath, {
    cwd: workdir,
    env: {
      ...process.env,
      HARNESS_DEFECT_VARIANT: variant,
      HARNESS_DEFECT_RUN_INDEX: String(index + 1),
      HARNESS_DEFECT_WORKDIR: workdir,
      HARNESS_DEFECT_FIXTURE: pathToFileURL(fixture.fixturePath).href,
      HARNESS_DEFECT_PREDICATE: fixture.predicate.id,
      HARNESS_DEFECT_CONFIG: JSON.stringify(variant === "candidate" ? fixture.candidate : fixture.baseline),
    },
  });
  if (result.code !== 0) return { error: failureDetails(`${variant} runner 退出码为 ${result.code}。`, result), runtime };
  let output;
  try {
    output = JSON.parse(result.stdout);
  } catch {
    return { error: failureDetails(`${variant} runner 必须只输出一个 JSON 结果。`, result), runtime };
  }
  if (!Array.isArray(output?.trace)) return { error: failureDetails(`${variant} runner 结果缺少 trace 数组。`, result), runtime };
  const evaluated = evaluatePredicate(fixture.predicate, output.trace);
  return { failed: evaluated.failed, actual: evaluated.actual, trace: output.trace, runtime };
}

async function inspectRuntime(runtime, spawnProcess) {
  if (!runtime) return null;
  const result = await spawnCommand(spawnProcess, runtime.command, ["--version"], { cwd: process.cwd(), env: process.env });
  if (result.code !== 0) return { error: failureDetails(`无法读取 ${runtime.command} 的版本。`, result) };
  return { command: runtime.command, version: result.stdout.trim() };
}

function evaluatePredicate(predicate, trace) {
  if (predicate.type !== "event_count") throw reproductionError(`不支持的失败谓词类型：${predicate.type}`);
  const count = trace.filter((event) => event?.type === predicate.eventType).length;
  return {
    failed: count !== predicate.expected,
    actual: { eventType: predicate.eventType, count, expected: predicate.expected },
  };
}

function spawnNode(spawnProcess, scriptPath, options) {
  return spawnCommand(spawnProcess, process.execPath, [scriptPath], options);
}

function spawnCommand(spawnProcess, command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

function normalizeFixture(value, fixturePath) {
  if (!value || typeof value !== "object") throw reproductionError("fixture 必须是 JSON 对象。");
  return {
    id: requireText(value.id, "id"),
    title: requireText(value.title, "title"),
    predicate: normalizePredicate(value.predicate),
    expected: requireText(value.expected, "expected"),
    runner: requireRelativePath(value.runner, "runner"),
    candidate: normalizeVariant(value.candidate, "candidate"),
    baseline: normalizeVariant(value.baseline, "baseline"),
    runtime: normalizeRuntime(value.runtime),
    fixturePath,
  };
}

function normalizeRuntime(value) {
  if (value === undefined) return null;
  if (!value || typeof value !== "object" || value.kind !== "pi") throw reproductionError("runtime 必须声明 kind: pi。");
  return {
    kind: "pi",
    candidate: normalizeRuntimeVariant(value.candidate, "runtime.candidate"),
    baseline: normalizeRuntimeVariant(value.baseline, "runtime.baseline"),
  };
}

function normalizeRuntimeVariant(value, field) {
  if (!value || typeof value !== "object") throw reproductionError(`${field} 必须是对象。`);
  return { command: requireText(value.command, `${field}.command`) };
}

function normalizePredicate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw reproductionError("predicate 必须是对象。");
  const expected = Number(value.expected);
  if (!Number.isSafeInteger(expected) || expected < 0) throw reproductionError("predicate.expected 必须是非负整数。");
  return {
    id: requireText(value.id, "predicate.id"),
    type: requireText(value.type, "predicate.type"),
    eventType: requireText(value.eventType, "predicate.eventType"),
    expected,
  };
}

function normalizeVariant(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw reproductionError(`${field} 必须是对象。`);
  return value;
}

function requireRelativePath(value, field) {
  const text = requireText(value, field);
  if (path.isAbsolute(text) || text.split(/[\\/]/).includes("..")) throw reproductionError(`${field} 必须是 fixture 内的相对路径。`);
  return text;
}

function requireText(value, field) {
  const text = String(value ?? "").trim();
  if (!text) throw reproductionError(`${field} 不能为空。`);
  return text;
}

function pathIsInside(root, target) {
  const relative = path.relative(root, target);
  return relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function failureDetails(message, result) {
  return { message, code: result.code, signal: result.signal, stderr: result.stderr };
}

function reproductionError(message) {
  const error = new Error(message);
  error.code = "reproduction_error";
  return error;
}

export { evaluatePredicate, normalizeFixture, runHarnessFixture };