import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const schemaVersion = 1;

function createHarnessDefectLab(options = {}) {
  const fsApi = options.fsApi || fs;
  const rootDir = path.resolve(options.rootDir || path.join(process.cwd(), ".harness-defects"));
  const archivesDir = path.join(rootDir, "archives");
  const stateStore = createStateStore({ fsApi, rootDir });
  const context = { archivesDir, fsApi };
  return {
    archiveSession: (input) => stateStore.mutate((state) => archiveSessionMutation(state, input, context)),
    createCandidate: (input) => stateStore.mutate((state) => createCandidateMutation(state, input, context)),
    list: () => stateStore.read(),
    recordReproduction: (input) => stateStore.mutate((state) => recordReproductionMutation(state, input)),
    rejectCandidate: (input) => stateStore.mutate((state) => rejectCandidateMutation(state, input)),
    rootDir,
  };
}

function createStateStore({ fsApi, rootDir }) {
  const statePath = path.join(rootDir, "registry.json");
  let mutationQueue = Promise.resolve();
  async function initialize() {
    await fsApi.mkdir(rootDir, { recursive: true });
    try {
      await fsApi.access(statePath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await writeState(emptyState());
    }
  }
  async function read() {
    await initialize();
    return readState();
  }
  function mutate(operation) {
    const result = mutationQueue.then(async () => {
      await initialize();
      const state = await readState();
      const value = await operation(state);
      await writeState(state);
      return value;
    });
    mutationQueue = result.catch(() => {});
    return result;
  }
  async function readState() {
    return normalizeState(JSON.parse(await fsApi.readFile(statePath, "utf8")));
  }
  async function writeState(state) {
    const temporaryPath = `${statePath}.${randomUUID()}.tmp`;
    try {
      await fsApi.writeFile(temporaryPath, `${JSON.stringify(normalizeState(state), null, 2)}\n`, "utf8");
      await fsApi.rename(temporaryPath, statePath);
    } finally {
      await fsApi.rm(temporaryPath, { force: true });
    }
  }
  return { mutate, read };
}

async function archiveSessionMutation(state, input = {}, { archivesDir, fsApi }) {
  const sourcePath = path.resolve(requireText(input.sourcePath, "sourcePath"));
  const sourceId = requireText(input.sourceId, "sourceId");
  const sessionId = requireText(input.sessionId, "sessionId");
  if (!(await fsApi.stat(sourcePath)).isFile()) throw validationError("sourcePath", "必须指向会话文件。");
  await fsApi.mkdir(archivesDir, { recursive: true });
  const archiveId = `A-${randomUUID()}`;
  const archivePath = path.join(archivesDir, `${archiveId}${path.extname(sourcePath) || ".jsonl"}`);
  const contents = await fsApi.readFile(sourcePath);
  await fsApi.writeFile(archivePath, contents);
  const archive = {
    id: archiveId,
    sourceId,
    sessionId,
    sourcePath,
    archivePath,
    sha256: sha256(contents),
    createdAt: new Date().toISOString(),
  };
  state.archives.push(archive);
  return archive;
}

async function createCandidateMutation(state, input = {}, { fsApi }) {
  const archiveId = requireText(input.archiveId, "archiveId");
  const archive = state.archives.find((item) => item.id === archiveId);
  if (!archive) throw validationError("archiveId", "归档会话不存在。");
  const event = await eventFromArchive(archive, input.eventIndex, fsApi);
  const now = new Date().toISOString();
  const candidate = {
    id: `C-${randomUUID()}`,
    archiveId,
    eventIndex: event.index,
    eventType: event.type,
    observation: requireText(input.observation, "observation"),
    suspectedRule: requireText(input.suspectedRule, "suspectedRule"),
    status: "candidate",
    createdAt: now,
    updatedAt: now,
  };
  state.candidates.push(candidate);
  return candidate;
}

function recordReproductionMutation(state, input = {}) {
  const candidate = state.candidates.find((item) => item.id === requireText(input.candidateId, "candidateId"));
  if (!candidate) throw validationError("candidateId", "候选不存在。");
  if (candidate.status !== "candidate") throw validationError("candidateId", "候选已经有复现结论。请新建候选后再次执行。");
  const fixture = normalizeFixtureReference(input.fixture);
  const comparison = normalizeComparison(input.comparison);
  const status = fixture.runtime?.kind === "pi" && comparison.candidate.stable && comparison.baseline.stable && comparison.candidate.failed && !comparison.baseline.failed ? "confirmed" : "rejected";
  if (status === "confirmed" && state.defects.some((defect) => defect.id === fixture.id)) {
    throw validationError("fixture.id", "已经存在相同 ID 的确认缺陷。");
  }
  const createdAt = new Date().toISOString();
  const reproduction = { id: `R-${randomUUID()}`, candidateId: candidate.id, fixture, comparison, status, createdAt };
  candidate.status = status;
  candidate.updatedAt = createdAt;
  state.reproductions.push(reproduction);
  const defect = status === "confirmed" ? createDefect({ candidate, comparison, fixture, reproduction }) : null;
  if (defect) state.defects.push(defect);
  return { candidate: { ...candidate }, reproduction, defect };
}

function createDefect({ candidate, comparison, fixture, reproduction }) {
  return {
    id: fixture.id,
    title: fixture.title,
    predicate: fixture.predicate,
    fixture: fixture.path,
    command: fixture.command,
    expected: fixture.expected,
    actual: { candidate: comparison.candidate.actual, baseline: comparison.baseline.actual },
    comparison: { candidateFailed: comparison.candidate.failed, baselineFailed: comparison.baseline.failed },
    candidateId: candidate.id,
    versions: fixture.versions,
    runtime: fixture.runtime,
    status: "confirmed",
    reproductionId: reproduction.id,
    createdAt: reproduction.createdAt,
  };
}

function emptyState() {
  return { version: schemaVersion, archives: [], candidates: [], reproductions: [], defects: [] };
}

function normalizeState(state = {}) {
  if (state.version !== undefined && state.version !== schemaVersion) {
    throw new Error(`不支持的 Harness 缺陷登记簿版本：${state.version}`);
  }
  return {
    version: schemaVersion,
    archives: Array.isArray(state.archives) ? state.archives : [],
    candidates: Array.isArray(state.candidates) ? state.candidates : [],
    reproductions: Array.isArray(state.reproductions) ? state.reproductions : [],
    defects: Array.isArray(state.defects) ? state.defects : [],
  };
}

function normalizeFixtureReference(fixture = {}) {
  const versions = fixture.versions && typeof fixture.versions === "object" ? fixture.versions : {};
  const runtime = fixture.runtime && typeof fixture.runtime === "object" ? fixture.runtime : null;
  return {
    id: requireText(fixture.id, "fixture.id"),
    title: requireText(fixture.title, "fixture.title"),
    predicate: requireText(fixture.predicate, "fixture.predicate"),
    path: requireText(fixture.path, "fixture.path"),
    command: requireText(fixture.command, "fixture.command"),
    expected: requireText(fixture.expected, "fixture.expected"),
    versions,
    runtime,
  };
}

function normalizeComparison(comparison = {}) {
  return { candidate: normalizeRun(comparison.candidate, "candidate"), baseline: normalizeRun(comparison.baseline, "baseline") };
}

function normalizeRun(run, name) {
  if (!run || typeof run !== "object" || typeof run.stable !== "boolean") {
    throw validationError(`comparison.${name}`, "复现结果缺少 stable 布尔值。");
  }
  if (!Array.isArray(run.runs) || run.runs.length !== 3) {
    throw validationError(`comparison.${name}.runs`, "复现结果必须包含三次运行。");
  }
  if (!run.stable) return { stable: false, failed: null, actual: null, runs: run.runs };
  if (typeof run.failed !== "boolean" || run.runs.some((item) => typeof item?.failed !== "boolean" || item.failed !== run.failed)) {
    throw validationError(`comparison.${name}.runs`, "三次复现结果不一致，不能登记结论。");
  }
  return { stable: true, failed: run.failed, actual: run.actual ?? null, runs: run.runs };
}

function rejectCandidateMutation(state, input = {}) {
  const candidate = state.candidates.find((item) => item.id === requireText(input.candidateId, "candidateId"));
  if (!candidate) throw validationError("candidateId", "候选不存在。");
  if (candidate.status !== "candidate") throw validationError("candidateId", "候选已经有复现结论。请新建候选后再次执行。");
  const createdAt = new Date().toISOString();
  const reproduction = {
    id: `R-${randomUUID()}`,
    candidateId: candidate.id,
    fixture: { path: requireText(input.fixturePath, "fixturePath") },
    comparison: null,
    status: "rejected",
    reason: requireText(input.reason, "reason"),
    createdAt,
  };
  candidate.status = "rejected";
  candidate.updatedAt = createdAt;
  state.reproductions.push(reproduction);
  return { candidate: { ...candidate }, reproduction, defect: null };
}

async function eventFromArchive(archive, eventIndexInput, fsApi) {
  const index = requireEventIndex(eventIndexInput);
  const lines = (await fsApi.readFile(archive.archivePath, "utf8")).split(/\r?\n/).filter((line) => line.trim());
  if (index >= lines.length) throw validationError("eventIndex", "超出归档会话事件范围。");
  let event;
  try {
    event = JSON.parse(lines[index]);
  } catch {
    throw validationError("eventIndex", "指向的归档行不是 JSON 事件。");
  }
  return { index, type: String(event?.type || event?.message?.role || "unknown") };
}

function requireText(value, field) {
  const text = String(value ?? "").trim();
  if (!text) throw validationError(field, "不能为空。");
  return text;
}

function requireEventIndex(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw validationError("eventIndex", "必须是非负整数。");
  return number;
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function validationError(field, message) {
  const error = new Error(`${field}${message}`);
  error.code = "validation_error";
  error.field = field;
  return error;
}

export { createHarnessDefectLab, emptyState, normalizeState };