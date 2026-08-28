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
      candidates: registry.candidates.map((candidate) => summarizeCandidate(candidate, registry)),
      defects: registry.defects.map(summarizeDefect),
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
      candidate: summarizeCandidate(candidate, loaded.registry),
      archive: archive ? projectArchive(archive) : null,
      reproduction: reproduction ? projectReproduction(reproduction) : null,
      defect: loaded.registry.defects.find((item) => item.candidateId === candidate.id) || null,
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
      defect: projectDefect(defect),
      candidate: candidate ? summarizeCandidate(candidate, loaded.registry) : null,
      archive: archive ? projectArchive(archive) : null,
      reproduction: reproduction ? projectReproduction(reproduction) : null,
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
    source: archive ? { sourceId: archive.sourceId, sessionId: archive.sessionId, sha256: archive.sha256 } : null,
    reproductionId: reproduction?.id || null,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
  };
}

function summarizeDefect(defect) {
  return {
    id: defect.id,
    title: defect.title,
    status: defect.status,
    predicate: defect.predicate,
    candidateId: defect.candidateId,
    createdAt: defect.createdAt,
    runtime: defect.runtime || null,
    review: projectReview(defect.review),
  };
}

function projectDefect(defect) {
  return {
    ...summarizeDefect(defect),
    fixture: defect.fixture,
    command: defect.command,
    expected: defect.expected,
    actual: defect.actual || null,
    comparison: defect.comparison || null,
    versions: defect.versions || {},
    reproductionId: defect.reproductionId,
  };
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
    state: review.state || "pending",
    reviewer: review.reviewer || null,
    reviewedAt: review.reviewedAt || null,
    conclusion: review.conclusion || "尚未登记独立审查结论。",
  };
}

function fingerprint(contents) {
  return createHash("sha256").update(contents).digest("hex").slice(0, 20);
}

export { createHarnessDefectRegistryReader, projectReview };