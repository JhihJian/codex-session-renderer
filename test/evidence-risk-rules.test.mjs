import test from "node:test";
import assert from "node:assert/strict";
import {
  activeEvidenceRiskRules,
  defaultEvidenceRiskRules,
  normalizeEvidenceRiskRules,
  riskSignalsForEvidence,
} from "../src/evidence-risk-rules.mjs";
import "../public/evidence-risk-rules.js";

function execItem(command, output, options = {}) {
  return {
    type: "tool-call",
    name: "exec_command",
    status: options.status || "completed",
    arguments: command,
    output,
  };
}

function comparableRuleFields(rules) {
  return rules.map((rule) => ({
    id: rule.id,
    label: rule.label,
    enabled: rule.enabled,
    kind: rule.kind,
    tool: rule.tool,
    level: rule.level,
    failedLevel: rule.failedLevel,
    tag: rule.tag,
    textFields: rule.textFields,
    maxLength: rule.maxLength,
    riskPattern: rule.riskPattern,
    nonZeroFailurePattern: rule.nonZeroFailurePattern,
    ignoredCommandPattern: rule.ignoredCommandPattern,
    summary: rule.summary,
  }));
}

test("default evidence risk rules flag ordinary command output risk words", () => {
  const signals = riskSignalsForEvidence(execItem("node scripts/run.mjs", "failed with stderr"));

  assert.equal(signals.length, 1);
  assert.equal(signals[0].tag, "error-output");
  assert.equal(signals[0].level, "medium");
});

test("default evidence risk rules ignore risk words from file reads and text searches", () => {
  const fileReadSignals = riskSignalsForEvidence(execItem("cat src/audit-chain.mjs", "const text = 'failed stderr 错误';"));
  const searchSignals = riskSignalsForEvidence(execItem('{"cmd":"rg -n \\"riskTextPattern\\" src"}', "src/audit-chain.mjs:9:error failed stderr"));

  assert.equal(fileReadSignals.length, 0);
  assert.equal(searchSignals.length, 0);
});

test("custom evidence risk rules can override builtin text rule conditions", () => {
  const signals = riskSignalsForEvidence(execItem("cat src/audit-chain.mjs", "const text = 'failed stderr';"), {
    evidenceRiskRules: [
      {
        id: "error-output",
        label: "工具输出风险词",
        enabled: true,
        kind: "risk-text",
        ignoredCommandPattern: "",
      },
    ],
  });

  assert.equal(signals.length, 1);
  assert.equal(signals[0].tag, "error-output");
});

test("custom evidence risk rules can disable builtin text risk and change large output threshold", () => {
  const customRules = [
    { id: "error-output", enabled: false, kind: "risk-text" },
    { id: "large-payload", enabled: true, kind: "large-payload", maxLength: 3 },
  ];
  const noTextSignals = riskSignalsForEvidence(execItem("node scripts/run.mjs", "failed with stderr"), { evidenceRiskRules: customRules });
  const largeSignals = riskSignalsForEvidence(execItem("node scripts/run.mjs", "abcd"), {
    evidenceRiskRules: customRules,
  });

  assert.deepEqual(noTextSignals.map((signal) => signal.tag), ["large-payload"]);
  assert.deepEqual(largeSignals.map((signal) => signal.tag), ["large-payload"]);
});

test("browser and server evidence risk defaults normalize to the same rule contract", () => {
  const browserDefaults = globalThis.EvidenceRiskRules.normalizeRules(globalThis.EvidenceRiskRules.defaultRules());
  const serverDefaults = normalizeEvidenceRiskRules(defaultEvidenceRiskRules);

  assert.deepEqual(comparableRuleFields(browserDefaults), comparableRuleFields(serverDefaults));
});

test("browser and server active rule overrides keep large payload threshold consistent", () => {
  const customRules = [
    { id: "error-output", enabled: false, kind: "risk-text" },
    { id: "large-payload", enabled: true, kind: "large-payload", maxLength: 3 },
  ];
  const browserActive = globalThis.EvidenceRiskRules.activeRules(customRules);
  const serverActive = activeEvidenceRiskRules(normalizeEvidenceRiskRules(customRules));

  assert.deepEqual(comparableRuleFields(browserActive), comparableRuleFields(serverActive));
  assert.deepEqual(
    serverActive.map((rule) => rule.id),
    ["large-payload"],
  );
  assert.deepEqual(
    browserActive.map((rule) => rule.id),
    ["large-payload"],
  );
  assert.equal(serverActive[0].maxLength, 3);
  assert.equal(browserActive[0].maxLength, 3);
});
