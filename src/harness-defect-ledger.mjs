import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const genesisHash = "0".repeat(64);

function createHarnessLedger(options = {}) {
  const fsApi = options.fsApi || fs;
  const rootDir = path.resolve(options.rootDir || path.join(process.cwd(), ".harness-defects"));
  const ledgerPath = path.join(rootDir, "ledger.jsonl");
  let queue = Promise.resolve();

  async function read() {
    try {
      return verifyLedger(await fsApi.readFile(ledgerPath, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
  }

  function append(input) {
    const work = queue.then(async () => {
      await fsApi.mkdir(rootDir, { recursive: true });
      const entries = await read();
      const entry = createEntry(input, entries.at(-1)?.hash || genesisHash);
      await fsApi.appendFile(ledgerPath, `${JSON.stringify(entry)}\n`, "utf8");
      return entry;
    });
    queue = work.catch(() => {});
    return work;
  }

  return { append, ledgerPath, read, rootDir };
}

function createEntry(input = {}, previousHash = genesisHash) {
  const payload = requireObject(input.payload, "payload");
  const entry = {
    id: input.id || `L-${randomUUID()}`,
    type: requireText(input.type, "type"),
    actor: requireText(input.actor || "controller", "actor"),
    candidateId: input.candidateId || null,
    timestamp: input.timestamp || new Date().toISOString(),
    policyVersion: requireText(input.policyVersion || "harness-verification-v1", "policyVersion"),
    previousHash,
    payload,
  };
  entry.payloadHash = digest(canonical(payload));
  entry.hash = digest(canonical({ ...entry }));
  return entry;
}

function verifyLedger(contents) {
  const lines = String(contents).split(/\r?\n/).filter(Boolean);
  let previousHash = genesisHash;
  return lines.map((line, index) => {
    let entry;
    try { entry = JSON.parse(line); } catch { throw ledgerError(`第 ${index + 1} 行不是 JSON。`); }
    if (!entry || entry.previousHash !== previousHash) throw ledgerError(`第 ${index + 1} 条账本记录哈希链断裂。`);
    if (entry.payloadHash !== digest(canonical(entry.payload))) throw ledgerError(`第 ${index + 1} 条账本记录 payload 哈希不匹配。`);
    const { hash, ...withoutHash } = entry;
    if (hash !== digest(canonical(withoutHash))) throw ledgerError(`第 ${index + 1} 条账本记录哈希不匹配。`);
    previousHash = hash;
    return entry;
  });
}

function projectLedger(entries) {
  const state = { version: 2, archives: [], candidates: [], reproductions: [], defects: [], evidence: [], reviews: [], timeline: [] };
  const candidates = new Map();
  for (const entry of entries) {
    state.timeline.push(projectTimeline(entry));
    const payload = entry.payload;
    if (entry.type === "archive_created") state.archives.push(payload);
    if (entry.type === "candidate_created") { candidates.set(payload.id, payload); state.candidates.push(payload); }
    if (entry.type === "candidate_transition") {
      const candidate = candidates.get(entry.candidateId);
      if (!candidate) throw ledgerError(`候选 ${entry.candidateId} 不存在。`);
      assertTransition(candidate.status, payload.status);
      candidate.status = payload.status;
      candidate.updatedAt = entry.timestamp;
      candidate.reason = payload.reason || null;
    }
    if (entry.type === "evidence_recorded") state.evidence.push(payload);
    if (entry.type === "reproduction_recorded") state.reproductions.push(payload);
    if (entry.type === "blind_review_recorded") state.reviews.push(payload);
    if (entry.type === "defect_confirmed") state.defects.push(payload);
  }
  return state;
}

const transitions = new Map([
  ["candidate", new Set(["evidence_ready", "blocked", "inconclusive", "rejected"])],
  ["evidence_ready", new Set(["assertion_ready", "blocked", "inconclusive", "rejected"])],
  ["assertion_ready", new Set(["fixture_ready", "blocked", "inconclusive"])],
  ["fixture_ready", new Set(["reproduced", "blocked", "inconclusive"])],
  ["reproduced", new Set(["independently_replicated", "blocked", "inconclusive", "rejected"])],
  ["independently_replicated", new Set(["confirmed", "inconclusive", "rejected"])],
]);

function assertTransition(from, to) {
  if (!transitions.get(from)?.has(to)) throw ledgerError(`不允许的状态转换：${from} -> ${to}。`);
}

function projectTimeline(entry) {
  return { id: entry.id, type: entry.type, candidateId: entry.candidateId, timestamp: entry.timestamp, payloadHash: entry.payloadHash };
}
function canonical(value) { return JSON.stringify(sortValue(value)); }
function sortValue(value) { if (Array.isArray(value)) return value.map(sortValue); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])])); return value; }
function digest(value) { return createHash("sha256").update(value).digest("hex"); }
function requireObject(value, field) { if (!value || typeof value !== "object" || Array.isArray(value)) throw ledgerError(`${field} 必须是对象。`); return value; }
function requireText(value, field) { const text = String(value || "").trim(); if (!text) throw ledgerError(`${field} 不能为空。`); return text; }
function ledgerError(message) { const error = new Error(message); error.code = "harness_ledger_invalid"; return error; }

export { assertTransition, createHarnessLedger, digest, projectLedger, verifyLedger };