import { createHash, randomUUID } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { decideVerification } from "./harness-decision-engine.mjs";
import { createHarnessLedger, digest, projectLedger } from "./harness-defect-ledger.mjs";

const schemaVersion = 2;

// This orchestrator serializes ledger mutations; domain operations remain below it.
// eslint-disable-next-line max-lines-per-function
function createHarnessDefectLab(options = {}) {
  const fsApi = options.fsApi || fs;
  const rootDir = path.resolve(options.rootDir || path.join(process.cwd(), ".harness-defects"));
  const archivesDir = path.join(rootDir, "archives");
  const ledger = createHarnessLedger({ fsApi, rootDir });
  const registryPath = path.join(rootDir, "registry.json");
  let queue = Promise.resolve();

  function mutate(work) {
    const result = queue.then(async () => {
      await migrateLegacyRegistry();
      const value = await work(await state());
      await writeProjection();
      return value;
    });
    queue = result.catch(() => {});
    return result;
  }
  async function state() { return projectLedger(await ledger.read()); }
  async function writeProjection() { await writeAtomic(fsApi, registryPath, await state()); }

  async function migrateLegacyRegistry() {
    try { await fsApi.access(ledger.ledgerPath); return; } catch (error) { if (error?.code !== "ENOENT") throw error; }
    let legacy;
    try { legacy = JSON.parse(await fsApi.readFile(registryPath, "utf8")); } catch (error) { if (error?.code === "ENOENT") return; throw error; }
    if (legacy.version === schemaVersion) return;
    for (const archive of legacy.archives || []) await ledger.append({ type: "archive_created", actor: "legacy-migration", payload: archive });
    for (const candidate of legacy.candidates || []) {
      const created = { ...candidate, status: "candidate", updatedAt: candidate.createdAt, legacyStatus: candidate.status };
      await ledger.append({ type: "candidate_created", actor: "legacy-migration", candidateId: candidate.id, payload: created });
      await ledger.append({ type: "evidence_recorded", actor: "legacy-migration", candidateId: candidate.id, payload: { id: `E-legacy-${candidate.id}`, candidateId: candidate.id, kind: "legacy_verification", sha256: digest(JSON.stringify(candidate)), createdAt: new Date().toISOString() } });
      if (candidate.status !== "candidate") await ledger.append({ type: "candidate_transition", actor: "legacy-migration", candidateId: candidate.id, payload: { status: "inconclusive", reason: "legacy_verification_requires_refreeze" } });
    }
    for (const reproduction of legacy.reproductions || []) await ledger.append({ type: "reproduction_recorded", actor: "legacy-migration", candidateId: reproduction.candidateId, payload: { ...reproduction, trust: "legacy_untrusted" } });
    await writeProjection();
  }

  return {
    archiveSession: (input) => mutate(async (current) => archiveSession(input, current)),
    createCandidate: (input) => mutate(async (current) => createCandidate(input, current)),
    createCandidates: (input) => mutate(async (current) => createCandidates(input, current)),
    list: async () => { await migrateLegacyRegistry(); await writeProjection(); return state(); },
    recordEvidence: (input) => mutate(async (current) => recordEvidence(input, current)),
    submitAssertion: (input) => mutate(async (current) => submitAssertion(input, current)),
    submitFixture: (input) => mutate(async (current) => submitFixture(input, current)),
    recordTrustedEpoch: (input) => mutate(async (current) => recordTrustedEpoch(input, current)),
    recordBlindReview: (input) => mutate(async (current) => recordBlindReview(input, current)),
    decideCandidate: (input) => mutate(async (current) => decideCandidate(input, current)),
    recordReproduction: (input) => mutate(async (current) => recordLegacyReproduction(input, current)),
    rejectCandidate: (input) => mutate(async (current) => transition(input.candidateId, "rejected", input.reason, current)),
    audit: async () => ({ ledger: await ledger.read(), projection: await state() }),
    ledgerPath: ledger.ledgerPath,
    rootDir,
  };

  async function archiveSession(input = {}, current) {
    const sourcePath = path.resolve(text(input.sourcePath, "sourcePath"));
    const hash = await hashFile(sourcePath);
    const existing = current.archives.find((archive) => archive.sha256 === hash && archive.sourceId === text(input.sourceId, "sourceId") && archive.sessionId === text(input.sessionId, "sessionId"));
    if (existing) return existing;
    await fsApi.mkdir(archivesDir, { recursive: true });
    const id = `A-${randomUUID()}`;
    const archivePath = path.join(archivesDir, `${id}${path.extname(sourcePath) || ".jsonl"}`);
    await fsApi.copyFile(sourcePath, archivePath);
    const archive = { id, sourceId: text(input.sourceId, "sourceId"), sessionId: text(input.sessionId, "sessionId"), sourcePath, archivePath, sha256: hash, createdAt: new Date().toISOString() };
    await ledger.append({ type: "archive_created", candidateId: null, payload: archive });
    return archive;
  }

  async function createCandidate(input = {}, current) {
    const archive = find(current.archives, input.archiveId, "archiveId", "归档会话不存在。");
    const event = await eventFromArchive(archive, input.eventIndex, fsApi);
    const detectorId = text(input.detectorId || "manual", "detectorId");
    const detectorVersion = text(input.detectorVersion || "1", "detectorVersion");
    const dedupeKey = input.dedupeKey || digest(`${archive.sha256}:${event.index}:${detectorId}:${detectorVersion}`);
    const prior = current.candidates.find((item) => item.dedupeKey === dedupeKey);
    if (prior) return prior;
    const now = new Date().toISOString();
    const candidate = { id: `C-${randomUUID()}`, archiveId: archive.id, eventIndex: event.index, eventType: event.type, observation: text(input.observation, "observation"), suspectedRule: text(input.suspectedRule, "suspectedRule"), detectorId, detectorVersion, dedupeKey, sourceHash: archive.sha256, status: "candidate", createdAt: now, updatedAt: now, supersedes: input.supersedes || null };
    await ledger.append({ type: "candidate_created", candidateId: candidate.id, payload: candidate });
    return candidate;
  }

  async function createCandidates(input = {}, current) {
    const archive = find(current.archives, input.archiveId, "archiveId", "归档会话不存在。");
    const known = new Map(current.candidates.map((candidate) => [candidate.dedupeKey, candidate]));
    const created = []; const candidates = [];
    for (const item of list(input.candidates)) {
      const index = Number(item.eventIndex);
      if (!Number.isSafeInteger(index) || index < 0) throw validationError("eventIndex", "必须是非负整数。");
      if (text(item.sourceHash, "sourceHash") !== archive.sha256) throw validationError("sourceHash", "必须匹配冻结归档。");
      const detectorId = text(item.detectorId, "detectorId");
      const detectorVersion = text(item.detectorVersion, "detectorVersion");
      const dedupeKey = text(item.dedupeKey || digest(`${archive.sha256}:${index}:${detectorId}:${detectorVersion}`), "dedupeKey");
      const prior = known.get(dedupeKey);
      if (prior) { candidates.push(prior); continue; }
      const now = new Date().toISOString();
      const candidate = { id: `C-${randomUUID()}`, archiveId: archive.id, eventIndex: index, eventType: text(item.eventType || "discovered", "eventType"), observation: text(item.observation, "observation"), suspectedRule: text(item.suspectedRule, "suspectedRule"), detectorId, detectorVersion, dedupeKey, sourceHash: archive.sha256, detection: item.evidence || null, status: "candidate", createdAt: now, updatedAt: now, supersedes: null };
      known.set(dedupeKey, candidate); created.push(candidate); candidates.push(candidate);
    }
    await ledger.appendMany(created.map((candidate) => ({ type: "candidate_created", candidateId: candidate.id, payload: candidate })));
    return { candidates, created: created.length, deduped: candidates.length - created.length };
  }

  async function recordEvidence(input = {}, current) {
    const candidate = candidateFor(current, input.candidateId);
    const evidence = { id: input.id || `E-${randomUUID()}`, candidateId: candidate.id, kind: text(input.kind, "kind"), sha256: text(input.sha256, "sha256"), data: input.data || null, createdAt: new Date().toISOString() };
    if (current.evidence.some((item) => item.sha256 === evidence.sha256)) throw validationError("sha256", "原始证据已被登记。");
    await ledger.append({ type: "evidence_recorded", candidateId: candidate.id, payload: evidence });
    if (candidate.status === "candidate") await transition(candidate.id, "evidence_ready", null, current);
    return evidence;
  }

  async function submitAssertion(input = {}, current) {
    const candidate = candidateFor(current, input.candidateId);
    if (input.machineDecidable !== true) return transition(candidate.id, "inconclusive", "assertion_not_machine_decidable", current);
    if (candidate.status !== "evidence_ready") throw validationError("candidateId", "候选尚未完成证据冻结。");
    const assertion = { id: `E-${randomUUID()}`, candidateId: candidate.id, kind: "assertion", contractRef: text(input.contractRef, "contractRef"), predicate: input.predicate, sha256: text(input.sha256 || digest(JSON.stringify(input.predicate)), "sha256"), createdAt: new Date().toISOString() };
    await ledger.append({ type: "evidence_recorded", candidateId: candidate.id, payload: assertion });
    await transition(candidate.id, "assertion_ready", null, current);
    return assertion;
  }

  async function submitFixture(input = {}, current) {
    const candidate = candidateFor(current, input.candidateId);
    if (candidate.status !== "assertion_ready") throw validationError("candidateId", "候选尚未形成机器断言。");
    const manifest = { id: `E-${randomUUID()}`, candidateId: candidate.id, kind: "fixture_manifest", fixtureHash: text(input.fixtureHash, "fixtureHash"), predicateHash: text(input.predicateHash, "predicateHash"), runtimeHash: text(input.runtimeHash, "runtimeHash"), manifest: input.manifest || null, sha256: text(input.sha256 || digest(JSON.stringify(input.manifest || input)), "sha256"), createdAt: new Date().toISOString() };
    await ledger.append({ type: "evidence_recorded", candidateId: candidate.id, payload: manifest });
    await transition(candidate.id, "fixture_ready", null, current);
    return manifest;
  }

  async function recordTrustedEpoch(input = {}, current) {
    const candidate = candidateFor(current, input.candidateId);
    if (!new Set(["fixture_ready", "reproduced"]).has(candidate.status)) throw validationError("candidateId", "候选尚未准备可信执行。");
    const epoch = normalizeEpoch(input.epoch);
    if (current.reproductions.some((item) => item.epoch?.id === epoch.id)) throw validationError("epoch.id", "epoch 已登记。");
    const reproduction = { id: `R-${randomUUID()}`, candidateId: candidate.id, epoch, trust: "trusted_executor", createdAt: new Date().toISOString() };
    await ledger.append({ type: "reproduction_recorded", candidateId: candidate.id, payload: reproduction });
    for (const run of epoch.runs) await ledger.append({ type: "evidence_recorded", candidateId: candidate.id, payload: { id: `E-${run.runId}`, candidateId: candidate.id, kind: "execution_artifact", sha256: run.artifactHash, runId: run.runId, epochId: epoch.id, createdAt: reproduction.createdAt } });
    if (candidate.status === "fixture_ready") await transition(candidate.id, "reproduced", null, current);
    return reproduction;
  }

  async function recordBlindReview(input = {}, current) {
    const candidate = candidateFor(current, input.candidateId);
    const decision = text(input.decision, "decision");
    if (!new Set(["accept", "reject", "inconclusive"]).has(decision)) throw validationError("decision", "必须是 accept、reject 或 inconclusive。");
    const review = { id: `V-${randomUUID()}`, candidateId: candidate.id, decision, blind: input.blind === true, recomputedPredicate: input.recomputedPredicate === true, evidenceHashes: Array.isArray(input.evidenceHashes) ? input.evidenceHashes : [], createdAt: new Date().toISOString() };
    await ledger.append({ type: "blind_review_recorded", candidateId: candidate.id, payload: review });
    if (candidate.status === "reproduced" && decision === "accept" && review.blind && review.recomputedPredicate && current.reproductions.filter((item) => item.candidateId === candidate.id).length >= 2) await transition(candidate.id, "independently_replicated", null, current);
    return review;
  }

  async function decideCandidate(input = {}, current) {
    const candidate = candidateFor(current, input.candidateId);
    const evidence = current.evidence.filter((item) => item.candidateId === candidate.id);
    const fixture = evidence.find((item) => item.kind === "fixture_manifest");
    const assertion = evidence.find((item) => item.kind === "assertion");
    const result = decideVerification({ sourceHash: candidate.sourceHash, contractRef: assertion?.contractRef, predicateHash: fixture?.predicateHash, fixtureHash: fixture?.fixtureHash, runtimeHash: fixture?.runtimeHash, epochs: current.reproductions.filter((item) => item.candidateId === candidate.id).map((item) => item.epoch), reviews: current.reviews.filter((item) => item.candidateId === candidate.id) });
    if (result.status === "confirmed") {
      if (candidate.status !== "independently_replicated") throw validationError("candidateId", "候选尚未完成独立复现。");
      const defect = { id: text(input.defectId, "defectId"), title: text(input.title, "title"), candidateId: candidate.id, predicate: assertion.predicate, status: "confirmed", decision: result, createdAt: new Date().toISOString() };
      await ledger.append({ type: "defect_confirmed", candidateId: candidate.id, payload: defect });
      await transition(candidate.id, "confirmed", result.reason, current);
      return { ...result, defect };
    }
    if (candidate.status !== result.status) await transition(candidate.id, result.status, result.reason, current);
    return result;
  }

  async function recordLegacyReproduction(input = {}, current) {
    const candidate = candidateFor(current, input.candidateId);
    const reproduction = { id: `R-${randomUUID()}`, candidateId: candidate.id, fixture: input.fixture || null, comparison: input.comparison || null, trust: "untrusted_legacy_runner", status: "inconclusive", reason: "trusted_executor_required", createdAt: new Date().toISOString() };
    await ledger.append({ type: "reproduction_recorded", candidateId: candidate.id, payload: reproduction });
    if (candidate.status === "candidate") await transition(candidate.id, "inconclusive", reproduction.reason, current);
    return { candidate: { ...candidate, status: "inconclusive" }, reproduction, defect: null };
  }

  async function transition(candidateId, status, reason, current) {
    const candidate = candidateFor(current, candidateId);
    await ledger.append({ type: "candidate_transition", candidateId: candidate.id, payload: { status, reason: reason || null } });
    return { ...candidate, status, reason: reason || null };
  }
}

function normalizeState(state = {}) {
  if (state.version !== undefined && ![1, schemaVersion].includes(state.version)) throw new Error(`不支持的 Harness 缺陷登记簿版本：${state.version}`);
  return { version: state.version || 1, archives: list(state.archives), candidates: list(state.candidates), reproductions: list(state.reproductions), defects: list(state.defects), evidence: list(state.evidence), reviews: list(state.reviews), timeline: list(state.timeline) };
}
function normalizeEpoch(value) {
  if (!value || typeof value !== "object" || !value.sandboxReceipt || value.sandboxReceipt.enforced !== true) throw validationError("epoch", "缺少可验证 sandbox receipt。");
  const runs = list(value.runs).map((run) => ({ runId: text(run.runId, "runId"), variant: text(run.variant, "variant"), failed: run.failed === true, artifactHash: text(run.artifactHash, "artifactHash") }));
  if (runs.length !== 6 || new Set(runs.map((run) => run.runId)).size !== 6) throw validationError("epoch.runs", "必须包含六个不同 runId 的受控运行。");
  return { id: text(value.id, "epoch.id"), sandboxReceipt: value.sandboxReceipt, runs };
}
async function eventFromArchive(archive, value, fsApi) { const index = Number(value); if (!Number.isSafeInteger(index) || index < 0) throw validationError("eventIndex", "必须是非负整数。"); const lines = (await fsApi.readFile(archive.archivePath, "utf8")).split(/\r?\n/).filter((line) => line.trim()); if (index >= lines.length) throw validationError("eventIndex", "超出归档会话事件范围。"); let event; try { event = JSON.parse(lines[index]); } catch { throw validationError("eventIndex", "指向的归档行不是 JSON 事件。"); } return { index, type: String(event?.type || event?.message?.role || "unknown") }; }
async function writeAtomic(fsApi, file, value) { await fsApi.mkdir(path.dirname(file), { recursive: true }); const temp = `${file}.${randomUUID()}.tmp`; try { await fsApi.writeFile(temp, `${JSON.stringify(normalizeState(value), null, 2)}\n`, "utf8"); await fsApi.rename(temp, file); } finally { await fsApi.rm(temp, { force: true }); } }
function candidateFor(state, id) { return find(state.candidates, id, "candidateId", "候选不存在。"); }
function find(items, id, field, message) { const item = items.find((entry) => entry.id === text(id, field)); if (!item) throw validationError(field, message); return item; }
function text(value, field) { const result = String(value ?? "").trim(); if (!result) throw validationError(field, "不能为空。"); return result; }
function list(value) { return Array.isArray(value) ? value : []; }
async function hashFile(file) { const hash = createHash("sha256"); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest("hex"); }
function validationError(field, message) { const error = new Error(`${field}${message}`); error.code = "validation_error"; error.field = field; return error; }
function emptyState() { return { version: schemaVersion, archives: [], candidates: [], reproductions: [], defects: [], evidence: [], reviews: [], timeline: [] }; }

export { createHarnessDefectLab, emptyState, normalizeState };