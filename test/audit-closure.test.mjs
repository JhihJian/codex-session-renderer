import test from "node:test";
import assert from "node:assert/strict";
import "../public/audit-closure.js";

const { buildClosureReview } = globalThis.AuditClosure;

function node(id, type, extra = {}) {
  return {
    id,
    type,
    riskLevel: "none",
    status: "observed",
    ...extra,
  };
}

function turn(auditNodes, overrides = {}) {
  return {
    key: "turn:1",
    auditNodes,
    executionRows: auditNodes.some((entry) => entry.type === "action") ? [{ id: "exec-1" }] : [],
    stats: {
      verificationStatus: auditNodes.some((entry) => entry.type === "verification") ? "已验证" : "未验证",
      ...overrides.stats,
    },
    ...overrides,
  };
}

test("closure review marks a fully supported turn as closed", () => {
  const review = buildClosureReview(
    turn([
      node("intent", "intent"),
      node("action", "action"),
      node("evidence", "evidence"),
      node("verification", "verification", { status: "completed" }),
      node("final", "final"),
    ]),
  );

  assert.equal(review.status, "closed");
  assert.equal(review.label, "已闭环");
  assert.equal(review.score.label, "6/6");
  assert.equal(review.actions[0].title, "可归档");
});

test("closure review does not ask for verification just because execution has no verification node", () => {
  const review = buildClosureReview(
    turn(
      [node("intent", "intent"), node("action", "action"), node("evidence", "evidence"), node("final", "final")],
      { stats: { verificationStatus: "未验证" } },
    ),
  );

  assert.equal(review.status, "closed");
  assert.equal(review.label, "已闭环");
  assert.equal(review.score.label, "5/5");
  assert.equal(review.headline, "最终回复有证据支撑");
  assert.equal(review.metrics.find((metric) => metric.key === "verification")?.state, "neutral");
  assert.equal(review.actions.some((action) => action.title.includes("验证")), false);
});

test("closure review asks for verification only when audit chain has missing-verification signal", () => {
  const review = buildClosureReview(
    turn(
      [
        node("intent", "intent"),
        node("action", "action"),
        node("evidence", "evidence"),
        node("risk", "risk", { riskLevel: "medium", tags: ["risk", "missing-verification"] }),
        node("final", "final"),
      ],
      { stats: { verificationStatus: "缺少验证" } },
    ),
  );

  assert.equal(review.status, "review");
  assert.equal(review.label, "需复核");
  assert.equal(review.headline, "声明缺少验证证据");
  assert.equal(review.metrics.find((metric) => metric.key === "verification")?.state, "warn");
  assert.equal(review.actions.some((action) => action.title === "补声明验证"), true);
});

test("closure review blocks high risk and missing output gaps", () => {
  const review = buildClosureReview(
    turn(
      [
        node("intent", "intent"),
        node("action", "action"),
        node("risk", "risk", { riskLevel: "high", tags: ["risk", "missing-output"] }),
        node("final", "final"),
      ],
      { stats: { verificationStatus: "缺少验证" } },
    ),
  );

  assert.equal(review.status, "blocked");
  assert.equal(review.label, "未闭环");
  assert.equal(review.metrics.find((metric) => metric.key === "risk")?.state, "block");
  assert.equal(review.actions.some((action) => action.title === "先处理高风险"), true);
});

test("closure review treats medium-risk verification as review instead of failed verification", () => {
  const review = buildClosureReview(
    turn(
      [
        node("intent", "intent"),
        node("action", "action"),
        node("evidence", "evidence"),
        node("verification", "verification", { status: "completed", riskLevel: "medium" }),
        node("final", "final"),
      ],
      { stats: { verificationStatus: "验证不足" } },
    ),
  );

  assert.equal(review.status, "review");
  assert.equal(review.headline, "验证带风险，需要复核");
  assert.equal(review.metrics.find((metric) => metric.key === "verification")?.state, "warn");
  assert.equal(review.actions.some((action) => action.title === "复核验证风险"), true);
});

test("closure review keeps verdict global while lanes honor visible filter", () => {
  const auditNodes = [
    node("intent", "intent"),
    node("action", "action"),
    node("evidence", "evidence"),
    node("verification", "verification", { status: "completed" }),
    node("final", "final"),
  ];
  const review = buildClosureReview(turn(auditNodes), {
    visibleNodes: auditNodes.filter((entry) => entry.type === "final"),
    filtersActive: true,
  });

  assert.equal(review.status, "closed");
  assert.equal(review.visibleNodeCount, 1);
  assert.match(review.countLabel, /显示支撑 0\/2/);
  assert.equal(review.lanes.find((lane) => lane.key === "claim")?.nodes.length, 1);
});
