import test from "node:test";
import assert from "node:assert/strict";
import {
  activeEvidenceRiskRules,
  defaultEvidenceRiskRules,
  normalizeEvidenceRiskRules,
  riskSignalsForEvidence,
  validateEvidenceRiskRules,
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

test("browser evidence risk rules validate required risk regexp fields before saving", () => {
  const errors = globalThis.EvidenceRiskRules.validateRulesForSave([
    {
      id: "custom-risk",
      label: "",
      kind: "risk-text",
      tool: "/exec(command/",
      riskPattern: "",
      nonZeroFailurePattern: "(",
      ignoredCommandPattern: "[",
    },
  ]);

  assert.equal(errors.some((error) => error.field === "label"), true);
  assert.equal(errors.some((error) => error.field === "tool"), true);
  assert.equal(errors.some((error) => error.field === "riskPattern"), true);
  assert.equal(errors.some((error) => error.field === "nonZeroFailurePattern"), true);
  assert.equal(errors.some((error) => error.field === "ignoredCommandPattern"), true);
});

test("browser evidence large payload rule only validates nonempty regexp fields", () => {
  const validLargePayload = globalThis.EvidenceRiskRules.validateRulesForSave([
    {
      id: "large-payload",
      label: "工具输出过大",
      kind: "large-payload",
      maxLength: 3,
      riskPattern: "",
    },
  ]);
  const invalidOptionalPattern = globalThis.EvidenceRiskRules.validateRulesForSave([
    {
      id: "large-payload",
      label: "工具输出过大",
      kind: "large-payload",
      maxLength: 3,
      riskPattern: "(",
    },
  ]);

  assert.deepEqual(validLargePayload, []);
  assert.equal(invalidOptionalPattern.some((error) => error.field === "riskPattern"), true);
});

test("browser evidence risk rules validate text fields and max length before saving", () => {
  const errors = globalThis.EvidenceRiskRules.validateRulesForSave([
    {
      id: "large-payload",
      label: "工具输出过大",
      kind: "large-payload",
      textFields: ["output", "badField"],
      maxLength: "0",
    },
  ]);

  assert.equal(errors.some((error) => error.field === "textFields"), true);
  assert.equal(errors.some((error) => error.field === "maxLength"), true);
});

test("browser evidence risk rules do not serialize invalid legacy local overrides", () => {
  const storage = {
    getItem() {
      return JSON.stringify([
        { id: "error-output", enabled: true, kind: "risk-text", riskPattern: "(" },
        { id: "large-payload", enabled: true, kind: "large-payload", maxLength: 3 },
      ]);
    },
  };
  const loaded = globalThis.EvidenceRiskRules.loadCustomRules(storage);
  const serialized = globalThis.EvidenceRiskRules.serializeForQuery(loaded);

  assert.equal(loaded.some((rule) => rule.id === "error-output" && rule.riskPattern === "("), true);
  assert.deepEqual(
    JSON.parse(serialized).map((rule) => rule.id),
    ["large-payload"],
  );
});

test("server evidence risk rules reject invalid regexp overrides", () => {
  const errors = validateEvidenceRiskRules([
    {
      id: "error-output",
      enabled: true,
      kind: "risk-text",
      tool: "/exec(command/",
      riskPattern: "(",
      ignoredCommandPattern: "[",
    },
  ]);

  assert.equal(errors.some((error) => error.field === "tool"), true);
  assert.equal(errors.some((error) => error.field === "riskPattern"), true);
  assert.equal(errors.some((error) => error.field === "ignoredCommandPattern"), true);
  assert.deepEqual(validateEvidenceRiskRules([{ id: "error-output", enabled: false, kind: "risk-text" }]), []);
});

test("server evidence risk rules reject invalid text fields and max length", () => {
  const errors = validateEvidenceRiskRules([
    {
      id: "large-payload",
      enabled: true,
      kind: "large-payload",
      textFields: ["output", "badField"],
      maxLength: "0",
    },
  ]);

  assert.equal(errors.some((error) => error.field === "textFields"), true);
  assert.equal(errors.some((error) => error.field === "maxLength"), true);
});
