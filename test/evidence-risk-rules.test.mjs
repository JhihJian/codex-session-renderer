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
  const noTextSignals = riskSignalsForEvidence(execItem("node scripts/run.mjs", "failed with stderr"), {
    evidenceRiskRules: [{ id: "error-output", enabled: false, kind: "risk-text" }],
  });
  const largeSignals = riskSignalsForEvidence(execItem("node scripts/run.mjs", "abcd"), {
    evidenceRiskRules: [{ id: "large-payload", enabled: true, kind: "large-payload", maxLength: 3 }],
  });

  assert.equal(noTextSignals.length, 0);
  assert.equal(largeSignals.some((signal) => signal.tag === "large-payload"), true);
});

test("browser and server evidence risk defaults expose the same builtin ids", () => {
  const browserIds = globalThis.EvidenceRiskRules.defaultRules().map((rule) => rule.id);
  const serverIds = defaultEvidenceRiskRules.map((rule) => rule.id);

  assert.deepEqual(browserIds, serverIds);
  assert.deepEqual(
    activeEvidenceRiskRules(normalizeEvidenceRiskRules([{ id: "error-output", enabled: false, kind: "risk-text" }])).map((rule) => rule.id),
    ["large-payload"],
  );
});
