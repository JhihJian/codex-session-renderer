import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { normalizeState } from "./harness-defect-lab.mjs";
import { readJsonlLine } from "./jsonl-reader.mjs";

function createHarnessDefectRegistryReader(options = {}) {
  const fsApi = options.fsApi || fs;
  const rootDir = path.resolve(options.rootDir || path.join(process.cwd(), ".harness-defects"));
  const registryPath = path.join(rootDir, "registry.json");
  const providerCaseCache = new Map();

  async function readOverview() {
    const loaded = await readRegistry();
    if (loaded.state !== "ready") return loaded;
    const { registry, revision } = loaded;
    return {
      state: "ready",
      revision,
      counts: {
        archives: registry.archives.length,
        candidates: registry.candidates.length,
        reproductions: registry.reproductions.length,
        defects: registry.defects.length,
      },
      candidates: await summarizeOverviewCandidates(registry, revision, providerCaseCache),
      defects: registry.defects.map((defect) => summarizeDefect(defect, registry)),
      timeline: (registry.timeline || []).map(projectTimeline),
    };
  }

  async function readCandidate(id, revision) {
    const loaded = await requireRegistryRevision(revision);
    const cases = await providerErrorCases(loaded.registry, loaded.revision, providerCaseCache);
    const problemCase = cases.find((item) => item.id === id);
    if (problemCase) return problemCase;
    const candidate = loaded.registry.candidates.find((item) => item.id === id);
    if (!candidate) return null;
    const archive = loaded.registry.archives.find((item) => item.id === candidate.archiveId);
    const reproduction = loaded.registry.reproductions.find((item) => item.candidateId === candidate.id) || null;
    return {
      revision: loaded.revision,
      candidate: summarizeCandidateForDetail(candidate, loaded.registry),
      archive: archive ? projectArchive(archive) : null,
      reproduction: reproduction ? projectReproduction(reproduction) : null,
      defect: loaded.registry.defects.find((item) => item.candidateId === candidate.id) || null,
      timeline: (loaded.registry.timeline || []).filter((item) => item.candidateId === candidate.id).map(projectTimeline),
      evidence: (loaded.registry.evidence || []).filter((item) => item.candidateId === candidate.id).map(projectEvidence),
      reviews: (loaded.registry.reviews || []).filter((item) => item.candidateId === candidate.id).map(projectReview),
      reproductions: loaded.registry.reproductions.filter((item) => item.candidateId === candidate.id).map(projectReproduction),
    };
  }

  async function readDefect(id, revision) {
    const loaded = await requireRegistryRevision(revision);
    const defect = loaded.registry.defects.find((item) => item.id === id);
    if (!defect) return null;
    const candidate = loaded.registry.candidates.find((item) => item.id === defect.candidateId) || null;
    const archive = candidate ? loaded.registry.archives.find((item) => item.id === candidate.archiveId) : null;
    const reproduction = loaded.registry.reproductions.find((item) => item.id === defect.reproductionId) || null;
    return {
      revision: loaded.revision,
      defect: projectDefect(defect, loaded.registry),
      candidate: candidate ? summarizeCandidate(candidate, loaded.registry) : null,
      archive: archive ? projectArchive(archive) : null,
      reproduction: reproduction ? projectReproduction(reproduction) : null,
      timeline: (loaded.registry.timeline || []).filter((item) => item.candidateId === defect.candidateId).map(projectTimeline),
      evidence: (loaded.registry.evidence || []).filter((item) => item.candidateId === defect.candidateId).map(projectEvidence),
      reviews: (loaded.registry.reviews || []).filter((item) => item.candidateId === defect.candidateId).map(projectReview),
      reproductions: loaded.registry.reproductions.filter((item) => item.candidateId === defect.candidateId).map(projectReproduction),
    };
  }

  async function readRegistry() {
    let contents;
    try {
      contents = await fsApi.readFile(registryPath);
    } catch (error) {
      if (error?.code === "ENOENT") return { state: "missing" };
      throw error;
    }
    let registry;
    try {
      registry = normalizeState(JSON.parse(contents.toString("utf8")));
    } catch (error) {
      const wrapped = new Error("Harness 登记簿无法读取。");
      wrapped.code = "harness_registry_invalid";
      wrapped.cause = error;
      throw wrapped;
    }
    return { state: "ready", registry, revision: fingerprint(contents) };
  }

  async function requireRegistryRevision(revision) {
    const loaded = await readRegistry();
    if (loaded.state !== "ready") return loaded;
    if (!revision || revision !== loaded.revision) {
      const error = new Error("Harness 登记簿已更新，请重新读取列表。");
      error.status = 409;
      error.code = "harness_registry_changed";
      throw error;
    }
    return loaded;
  }

  return { readCandidate, readDefect, readOverview, registryPath, rootDir };
}

function summarizeCandidate(candidate, registry) {
  const archive = registry.archives.find((item) => item.id === candidate.archiveId);
  const reproduction = registry.reproductions.find((item) => item.candidateId === candidate.id);
  return {
    id: candidate.id,
    status: candidate.status,
    observation: candidate.observation,
    suspectedRule: candidate.suspectedRule,
    eventIndex: candidate.eventIndex,
    eventType: candidate.eventType || "unknown",
    detectorId: candidate.detectorId || null,
    detectorVersion: candidate.detectorVersion || null,
    detection: candidate.detection || null,
    source: archive ? { sourceId: archive.sourceId, sessionId: archive.sessionId, sha256: archive.sha256 } : null,
    reproductionId: reproduction?.id || null,
    reason: candidate.reason || null,
    workflow: projectWorkflow(candidate.status, candidate.reason),
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
  };
}

async function summarizeOverviewCandidates(registry, revision, cache) {
  const ordinary = registry.candidates.filter((candidate) => candidate.detectorId !== "provider-error-exit-status").map((candidate) => summarizeCandidate(candidate, registry));
  const cases = await providerErrorCases(registry, revision, cache);
  return [...cases.map((item) => item.candidate), ...ordinary];
}

async function providerErrorCases(registry, revision, cache) {
  if (cache.has(revision)) return cache.get(revision);
  const work = buildProviderErrorCases(registry);
  cache.set(revision, work);
  return work;
}

async function buildProviderErrorCases(registry) {
  const byArchive = new Map();
  for (const candidate of registry.candidates.filter((item) => item.detectorId === "provider-error-exit-status")) {
    const group = byArchive.get(candidate.archiveId) || [];
    group.push(candidate);
    byArchive.set(candidate.archiveId, group);
  }
  const observations = await Promise.all([...byArchive.values()].map((members) => providerObservation(members, registry)));
  const byError = new Map();
  for (const observation of observations) {
    const group = byError.get(observation.fingerprint) || [];
    group.push(observation);
    byError.set(observation.fingerprint, group);
  }
  return [...byError.entries()]
    .map(([fingerprint, group]) => providerCase(fingerprint, group, registry))
    .sort((left, right) => Number(right.candidate.case.hasErrorDetail) - Number(left.candidate.case.hasErrorDetail) || right.candidate.case.physicalCount - left.candidate.case.physicalCount || left.candidate.title.localeCompare(right.candidate.title, "zh-CN"));
}

// Legacy archives may need a single source event read to recover the user-facing error context.
// eslint-disable-next-line complexity
async function providerObservation(members, registry) {
  const representative = [...members].sort((left, right) => left.eventIndex - right.eventIndex)[0];
  const archive = registry.archives.find((item) => item.id === representative.archiveId);
  let detection = representative.detection || null;
  if (!detection?.errorMessage && archive?.archivePath) {
    try {
      const event = await readJsonlLine(archive.archivePath, representative.eventIndex);
      const message = event?.type === "message" ? event.message : null;
      detection = { ...detection, errorMessage: String(message?.errorMessage || message?.error_message || message?.error?.message || "模型服务返回错误，但归档未保留错误详情。"), provider: message?.provider || null, model: message?.model || null, exitStatusEvidence: "absent" };
    } catch { detection = { ...detection, errorMessage: "模型服务返回错误，但归档未保留错误详情。", exitStatusEvidence: "absent" }; }
  }
  const errorMessage = String(detection?.errorMessage || "模型服务返回错误，但归档未保留错误详情。").trim();
  return { archive, detection, errorMessage, fingerprint: fingerprintError(errorMessage), members, representative };
}

function providerCase(fingerprint, observations, registry) {
  const first = observations[0];
  const physicalCount = observations.reduce((sum, item) => sum + item.members.length, 0);
  const sourceCount = observations.length;
  const providers = [...new Set(observations.map((item) => item.detection?.provider).filter(Boolean))];
  const models = [...new Set(observations.map((item) => item.detection?.model).filter(Boolean))];
  const hasErrorDetail = first.errorMessage !== "模型服务返回错误，但归档未保留错误详情。";
  const headline = `Provider 请求被拒绝：${shortError(first.errorMessage)}`;
  const candidate = {
    ...summarizeCandidate(first.representative, registry),
    id: `P-${fingerprint.slice(0, 16)}`,
    title: headline,
    status: "unassessed",
    observation: "模型服务拒绝了请求，会话没有得到可继续处理的模型响应。",
    suspectedRule: "当前归档没有非交互进程退出码，无法判断 CLI 是否错误地返回成功。",
    detection: { ...first.detection, exitStatusEvidence: "absent", occurrenceCount: physicalCount },
    memberCount: physicalCount,
    workflow: { label: "影响待判定", nextStep: "先确认服务拒绝的原因；退出码行为需要受控非交互执行才能判断。", reason: null },
    case: { errorMessage: first.errorMessage, sourceCount, physicalCount, providers, models, hasErrorDetail, meaning: "模型服务拒绝了请求，因此该次会话未获得模型响应。", impact: `已在 ${sourceCount} 份归档会话中观察到；是否影响脚本、CI 或编排器仍取决于未采集的进程退出码。` },
  };
  return { id: candidate.id, candidate, archive: first.archive ? projectArchive(first.archive) : null, reproduction: null, reproductions: [], evidence: [], reviews: [], timeline: [] };
}

function fingerprintError(value) { return createHash("sha256").update(String(value).replace(/\s+/g, " ").trim()).digest("hex"); }
function shortError(value) { const normalized = String(value).replace(/\s+/g, " ").trim(); return normalized.length > 92 ? `${normalized.slice(0, 89)}...` : normalized; }

function summarizeCandidateForDetail(candidate, registry) {
  const group = legacyProviderErrorGroup(candidate, registry);
  return group ? summarizeLegacyProviderErrorGroup(group, registry) : summarizeCandidate(candidate, registry);
}

function legacyProviderErrorGroup(candidate, registry) {
  if (candidate.detectorId !== "provider-error-exit-status" || candidate.detectorVersion !== "1" || candidate.status !== "candidate") return null;
  const members = registry.candidates
    .filter((item) => item.detectorId === candidate.detectorId && item.detectorVersion === candidate.detectorVersion && item.sourceHash === candidate.sourceHash && item.status === "candidate")
    .sort((left, right) => left.eventIndex - right.eventIndex);
  return members.length > 1 ? members : null;
}

function summarizeLegacyProviderErrorGroup(members, registry) {
  const representative = members[0];
  const firstEventIndex = representative.eventIndex;
  const lastEventIndex = members.at(-1).eventIndex;
  return {
    ...summarizeCandidate(representative, registry),
    observation: `同一归档包含 ${members.length} 条 provider error 历史记录；归档未记录非交互进程退出码。`,
    suspectedRule: "当最终 assistant 为 error 时，受控非交互执行必须返回非零退出码。",
    detection: { firstEventIndex, lastEventIndex, occurrenceCount: members.length, exitStatusEvidence: "absent", legacyGrouped: true },
    memberCount: members.length,
  };
}

function summarizeDefect(defect, registry) {
  const candidate = registry?.candidates.find((item) => item.id === defect.candidateId);
  return {
    id: defect.id,
    title: defect.title,
    status: defect.status,
    predicate: defect.predicate,
    candidateId: defect.candidateId,
    createdAt: defect.createdAt,
    runtime: defect.runtime || null,
    review: projectReview(defect.review),
    workflow: projectWorkflow(defect.status, defect.decision?.reason || candidate?.reason),
  };
}

function projectDefect(defect, registry) {
  return {
    ...summarizeDefect(defect, registry),
    fixture: defect.fixture,
    command: defect.command,
    expected: defect.expected,
    actual: defect.actual || null,
    comparison: defect.comparison || null,
    versions: defect.versions || {},
    reproductionId: defect.reproductionId,
  };
}

function projectWorkflow(status, reason = null) {
  const definitions = {
    candidate: ["待冻结证据", "补充可复核的来源与观察证据。"],
    evidence_ready: ["待形成断言", "将规则转为可机器判定的断言。"],
    assertion_ready: ["待准备复现", "冻结 fixture、谓词与运行时。"],
    fixture_ready: ["待可信复现", "在可信 sandbox 完成 candidate 与 baseline 对照。"],
    reproduced: ["待独立复现", "补齐第二个独立执行 epoch，并登记盲审。"],
    independently_replicated: ["待确认决策", "独立复现已完成，等待确认决策。"],
    confirmed: ["已确认", "双独立执行与盲审已满足确认门槛。"],
    blocked: ["已阻塞", "当前缺少继续验证所需的可信条件。"],
    inconclusive: ["证据不足", "现有证据不足以得出确认结论。"],
    rejected: ["已驳回", "现有证据不支持该缺陷结论。"],
  };
  const [label, nextStep] = definitions[status] || ["待处理", "需要人工核查当前验证状态。"];
  return { label, nextStep, reason: reason || null };
}

function projectArchive(archive) {
  return {
    id: archive.id,
    sourceId: archive.sourceId,
    sessionId: archive.sessionId,
    sha256: archive.sha256,
    createdAt: archive.createdAt,
  };
}

function projectReproduction(reproduction) {
  return {
    id: reproduction.id,
    status: reproduction.status,
    reason: reproduction.reason || null,
    trust: reproduction.trust || null,
    epochId: reproduction.epoch?.id || null,
    createdAt: reproduction.createdAt,
    fixture: reproduction.fixture ? {
      id: reproduction.fixture.id || null,
      path: reproduction.fixture.path,
      command: reproduction.fixture.command || null,
      predicate: reproduction.fixture.predicate || null,
      expected: reproduction.fixture.expected || null,
      versions: reproduction.fixture.versions || {},
      runtime: reproduction.fixture.runtime || null,
    } : null,
    comparison: reproduction.comparison ? {
      candidate: projectRun(reproduction.comparison.candidate),
      baseline: projectRun(reproduction.comparison.baseline),
    } : null,
  };
}

function projectRun(run = {}) {
  return {
    stable: run.stable,
    failed: run.failed,
    actual: run.actual || null,
    runtime: run.runtime || null,
    runs: (run.runs || []).map((item) => ({
      failed: item.failed ?? null,
      actual: item.actual || null,
      trace: item.trace || [],
      runtime: item.runtime || null,
      error: item.error || null,
    })),
  };
}

function projectReview(review) {
  if (!review || typeof review !== "object") return { state: "pending", conclusion: "尚未登记独立审查结论。" };
  return {
    state: review.state || review.decision || "pending",
    reviewer: review.reviewer || null,
    reviewedAt: review.reviewedAt || review.createdAt || null,
    conclusion: review.conclusion || (review.recomputedPredicate ? "已独立重算谓词。" : "尚未登记独立审查结论。"),
  };
}

function projectTimeline(item) {
  return { id: item.id, type: item.type, timestamp: item.timestamp, payloadHash: item.payloadHash };
}

function projectEvidence(item) {
  return { id: item.id, kind: item.kind, sha256: item.sha256, runId: item.runId || null, epochId: item.epochId || null, createdAt: item.createdAt };
}

function fingerprint(contents) {
  return createHash("sha256").update(contents).digest("hex").slice(0, 20);
}

export { createHarnessDefectRegistryReader, projectReview, projectWorkflow };