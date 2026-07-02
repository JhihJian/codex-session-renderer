(function () {
  const storageKey = "codexSessionRenderer.evidenceRiskRules.v1";

  const defaultIgnoredReadSearchPattern = "^(?:cat|type|more|less|head|tail|nl|Get-Content|gc|rg|grep|findstr|Select-String|sls|ag|ack)\\b";

  const defaultRules = [
    {
      id: "error-output",
      label: "工具输出风险词",
      enabled: true,
      kind: "risk-text",
      tool: "*",
      level: "medium",
      failedLevel: "high",
      tag: "error-output",
      textFields: ["status", "output", "payloadPreview"],
      riskPattern: "\\b(error|failed|failure|exception|stderr|non-?zero|exit code\\s*[1-9]\\d*)\\b|失败|错误",
      nonZeroFailurePattern:
        "\\bfail(?:ed|ures?)?\\s*[:=]?\\s*[1-9]\\d*\\b|\\b[1-9]\\d*\\s+fail(?:ed|ures?)?\\b|\\berrors?\\s*[:=]?\\s*[1-9]\\d*\\b|\\b[1-9]\\d*\\s+errors?\\b",
      ignoredCommandPattern: defaultIgnoredReadSearchPattern,
      summary: "工具输出或状态包含 error、failed、stderr、失败、错误等风险词。",
    },
    {
      id: "large-payload",
      label: "工具输出过大",
      enabled: true,
      kind: "large-payload",
      tool: "*",
      level: "medium",
      tag: "large-payload",
      textFields: ["output", "payloadPreview"],
      maxLength: 100000,
      summary: "工具输出较大，轻量视图可能不足以完整审计。",
    },
  ];

  const ruleKinds = new Set(["risk-text", "large-payload"]);
  const riskLevels = new Set(["low", "medium", "high"]);

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeRules(rules) {
    if (!Array.isArray(rules)) return [];
    return rules
      .map((rule, index) => {
        const kind = ruleKinds.has(String(rule?.kind || "")) ? String(rule.kind) : "risk-text";
        return {
          id: String(rule?.id || `custom-evidence-risk-${Date.now()}-${index}`),
          label: String(rule?.label || rule?.summary || "Evidence 风险规则").trim() || "Evidence 风险规则",
          enabled: rule?.enabled !== false,
          kind,
          tool: String(rule?.tool || "*").trim() || "*",
          level: normalizeRiskLevel(rule?.level, "medium"),
          failedLevel: normalizeRiskLevel(rule?.failedLevel, normalizeRiskLevel(rule?.level, "medium")),
          tag: String(rule?.tag || (kind === "large-payload" ? "large-payload" : "error-output")).trim(),
          textFields: normalizeTextFields(rule?.textFields, kind === "large-payload" ? ["output", "payloadPreview"] : ["status", "output", "payloadPreview"]),
          maxLength: normalizeMaxLength(rule?.maxLength),
          riskPattern: String(rule?.riskPattern || defaultRules[0].riskPattern).trim(),
          nonZeroFailurePattern: String(rule?.nonZeroFailurePattern || defaultRules[0].nonZeroFailurePattern).trim(),
          ignoredCommandPattern: String(rule?.ignoredCommandPattern || "").trim(),
          summary: String(rule?.summary || "").trim() || (kind === "large-payload" ? "工具输出较大，轻量视图可能不足以完整审计。" : "工具输出或状态包含风险词。"),
        };
      })
      .filter((rule) => rule.id && rule.label && (rule.kind !== "large-payload" || rule.maxLength > 0));
  }

  function mergedRules(customRules) {
    const defaults = defaultRules.map(clone);
    const overrides = normalizeRules(customRules);
    const byId = new Map(defaults.map((rule) => [rule.id, rule]));
    const additions = [];
    for (const rule of overrides) {
      if (byId.has(rule.id)) byId.set(rule.id, { ...byId.get(rule.id), ...rule });
      else additions.push(rule);
    }
    return [...additions, ...defaults.map((rule) => byId.get(rule.id))];
  }

  function activeRules(customRules) {
    return mergedRules(customRules).filter((rule) => rule.enabled !== false);
  }

  function loadCustomRules(storage = globalThis.localStorage) {
    if (!storage) return [];
    try {
      return normalizeRules(JSON.parse(storage.getItem(storageKey) || "[]"));
    } catch {
      return [];
    }
  }

  function saveCustomRules(rules, storage = globalThis.localStorage) {
    const normalized = customRulesFromMerged(rules);
    if (storage) storage.setItem(storageKey, JSON.stringify(normalized));
    return normalized;
  }

  function serializeForQuery(rules) {
    const normalized = customRulesFromMerged(rules);
    return normalized.length ? JSON.stringify(normalized) : "";
  }

  function customRulesFromMerged(rules) {
    const normalized = normalizeRules(rules);
    const defaults = new Map(normalizeRules(defaultRules).map((rule) => [rule.id, rule]));
    return normalized.filter((rule) => {
      const defaultRule = defaults.get(rule.id);
      if (!defaultRule) return true;
      return JSON.stringify(rule) !== JSON.stringify(defaultRule);
    });
  }

  function defaultRuleIds() {
    return defaultRules.map((rule) => rule.id);
  }

  function normalizeTextFields(value, fallback) {
    const fields = Array.isArray(value) ? value : String(value || "").split(",");
    const normalized = fields.map((field) => String(field || "").trim()).filter((field) => field === "status" || field === "output" || field === "payloadPreview");
    return normalized.length ? [...new Set(normalized)] : fallback;
  }

  function normalizeMaxLength(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 100000;
    return Math.max(1, Math.floor(number));
  }

  function normalizeRiskLevel(value, fallback) {
    const level = String(value || "").trim();
    return riskLevels.has(level) ? level : fallback;
  }

  const api = {
    activeRules,
    customRulesFromMerged,
    defaultRuleIds,
    defaultRules: () => clone(defaultRules),
    loadCustomRules,
    mergedRules,
    normalizeRules,
    saveCustomRules,
    serializeForQuery,
    storageKey,
  };

  globalThis.EvidenceRiskRules = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
