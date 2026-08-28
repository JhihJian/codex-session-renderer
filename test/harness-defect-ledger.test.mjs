import test from "node:test";
import assert from "node:assert/strict";
import { createHarnessLedger, verifyLedger } from "../src/harness-defect-ledger.mjs";
import { decideVerification } from "../src/harness-decision-engine.mjs";
import { createBlindReviewRequest, validateSubagentResult } from "../src/harness-subagent-contracts.mjs";

test("账本检测任何哈希链篡改", async () => {
  const ledger = createHarnessLedger({ rootDir: `/tmp/harness-ledger-${Date.now()}-${Math.random()}` });
  await ledger.append({ type: "archive_created", payload: { id: "A-1" } });
  const [entry] = await ledger.read();
  assert.throws(() => verifyLedger(`${JSON.stringify({ ...entry, previousHash: "bad" })}\n`), /哈希链断裂/);
});

test("账本批量追加保持可验证的连续哈希链", async () => {
  const ledger = createHarnessLedger({ rootDir: `/tmp/harness-ledger-batch-${Date.now()}-${Math.random()}` });
  await ledger.appendMany([
    { type: "archive_created", payload: { id: "A-batch" } },
    { type: "candidate_created", candidateId: "C-batch", payload: { id: "C-batch", status: "candidate" } },
  ]);
  const entries = await ledger.read();
  assert.equal(entries.length, 2);
  assert.equal(entries[1].previousHash, entries[0].hash);
});

test("决策器在缺少强制沙箱时失败关闭", () => {
  const result = decideVerification({ sourceHash: "s", contractRef: "c", predicateHash: "p", fixtureHash: "f", runtimeHash: "r", epochs: [{ id: "one", sandboxReceipt: { enforced: false }, runs: [] }, { id: "two", sandboxReceipt: { enforced: false }, runs: [] }] });
  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "verifiable_sandbox_required");
});

test("决策器仅在双独立 epoch 与盲审齐全时确认", () => {
  const epoch = (id) => ({
    id,
    sandboxReceipt: { enforced: true },
    runs: ["candidate", "candidate", "candidate", "baseline", "baseline", "baseline"].map((variant, index) => ({ variant, failed: variant === "candidate", artifactHash: `${id}-${index}` })),
  });
  const result = decideVerification({
    sourceHash: "s", contractRef: "c", predicateHash: "p", fixtureHash: "f", runtimeHash: "r",
    epochs: [epoch("first"), epoch("second")],
    reviews: [{ decision: "accept", blind: true, recomputedPredicate: true }],
  });
  assert.equal(result.status, "confirmed");
});

test("subagent 契约只允许结构化盲审输入", () => {
  const review = validateSubagentResult({ kind: "review", candidateId: "C-1", decision: "accept", recomputedPredicate: true, evidenceHashes: [] });
  assert.equal(review.decision, "accept");
  const request = createBlindReviewRequest({ candidateId: "C-1", contractRef: "contract", predicate: { id: "p" }, artifacts: [{ artifactHash: "x", runId: "r", variant: "candidate" }] });
  assert.deepEqual(Object.keys(request).sort(), ["artifacts", "candidateId", "contractRef", "kind", "predicate"]);
});