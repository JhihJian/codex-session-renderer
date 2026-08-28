import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { normalizeState } from "./harness-defect-lab.mjs";

function createHarnessDefectRegistryReader(options = {}) {
  const fsApi = options.fsApi || fs;
  const rootDir = path.resolve(options.rootDir || path.join(process.cwd(), ".harness-defects"));
  const registryPath = path.join(rootDir, "registry.json");

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
      candidates: summarizeOverviewCandidates(registry),
      defects: registry.defects.map((defect) => summarizeDefect(defect, registry)),
      timeline: (registry.timeline || []).map(projectTimeline),
    };
  }

  async function readCandidate(id, revision) {
    const loaded = await requireRegistryRevision(revision);
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

function summarizeOverviewCandidates(registry) {
  const groupedSources = new Set();
  const summaries = [];
  for (const candidate of registry.candidates) {
    const group = legacyProviderErrorGroup(candidate, registry);
    if (!group) {
      summaries.push(summarizeCandidate(candidate, registry));
      continue;
    }
    const groupKey = group[0].sourceHash;
    if (groupedSources.has(groupKey)) continue;
    groupedSources.add(groupKey);
    summaries.push(summarizeLegacyProviderErrorGroup(group, registry));
  }
  return summaries;
}

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