const resultKinds = new Set(["candidate", "assertion", "fixture", "review"]);

function validateSubagentResult(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw contractError("结果必须是对象。");
  const kind = text(value.kind, "kind");
  if (!resultKinds.has(kind)) throw contractError("kind 不受支持。");
  const candidateId = text(value.candidateId, "candidateId");
  if (kind === "review") return validateReview({ ...value, kind, candidateId });
  if (kind === "assertion") return validateAssertion({ ...value, kind, candidateId });
  if (kind === "fixture") return validateFixture({ ...value, kind, candidateId });
  return { kind, candidateId, observation: text(value.observation, "observation"), sourceHash: text(value.sourceHash, "sourceHash") };
}

function createBlindReviewRequest(input = {}) {
  return { kind: "blind_review_request", candidateId: text(input.candidateId, "candidateId"), contractRef: text(input.contractRef, "contractRef"), predicate: object(input.predicate, "predicate"), artifacts: array(input.artifacts, "artifacts").map((item) => ({ artifactHash: text(item.artifactHash, "artifactHash"), runId: text(item.runId, "runId"), variant: text(item.variant, "variant") })) };
}
function validateReview(value) { const decision = text(value.decision, "decision"); if (!new Set(["accept", "reject", "inconclusive"]).has(decision)) throw contractError("review.decision 无效。"); return { kind: value.kind, candidateId: value.candidateId, decision, recomputedPredicate: value.recomputedPredicate === true, evidenceHashes: array(value.evidenceHashes, "evidenceHashes") }; }
function validateAssertion(value) { return { kind: value.kind, candidateId: value.candidateId, contractRef: text(value.contractRef, "contractRef"), predicate: object(value.predicate, "predicate"), machineDecidable: value.machineDecidable === true }; }
function validateFixture(value) { return { kind: value.kind, candidateId: value.candidateId, fixtureHash: text(value.fixtureHash, "fixtureHash"), predicateHash: text(value.predicateHash, "predicateHash"), runtimeHash: text(value.runtimeHash, "runtimeHash"), manifest: object(value.manifest, "manifest") }; }
function text(value, field) { const result = String(value ?? "").trim(); if (!result) throw contractError(`${field} 不能为空。`); return result; }
function object(value, field) { if (!value || typeof value !== "object" || Array.isArray(value)) throw contractError(`${field} 必须是对象。`); return value; }
function array(value, field) { if (!Array.isArray(value)) throw contractError(`${field} 必须是数组。`); return value; }
function contractError(message) { const error = new Error(message); error.code = "subagent_contract_invalid"; return error; }

export { createBlindReviewRequest, validateSubagentResult };