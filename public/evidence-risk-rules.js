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
  const allowedTextFields = new Set(["status", "output", "payloadPreview"]);

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
          label: String(rule?.label || rule?.summary || "证据风险规则").trim() || "证据风险规则",
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

  function validateRulesForSave(rules) {
    if (!Array.isArray(rules)) return [];
    return rules.flatMap((rule, index) => validateRuleForSave(rule, index));
  }

  function validateRuleForSave(rule, index) {
    const errors = [];
    const kind = ruleKinds.has(String(rule?.kind || "")) ? String(rule.kind) : "risk-text";
    const label = String(rule?.label || rule?.title || "").trim();
    const tool = String(rule?.tool || "").trim();
    if (!label) errors.push(ruleValidationError(index, "label", "名称必填，保存后才会生成证据风险规则。"));
    const toolError = validateSlashRegExp(tool);
    if (toolError) errors.push(ruleValidationError(index, "tool", `工具正则不合法：${toolError}`));
    const textFieldsError = rule?.textFields == null ? "" : validateTextFields(rule.textFields);
    if (textFieldsError) errors.push(ruleValidationError(index, "textFields", textFieldsError));
    const maxLengthError = rule?.maxLength == null && kind !== "large-payload" ? "" : validateMaxLength(rule?.maxLength);
    if (maxLengthError) errors.push(ruleValidationError(index, "maxLength", maxLengthError));
    for (const field of evidencePatternFields(rule)) {
      const value = String(rule?.[field] || "").trim();
      if (field === "riskPattern" && kind === "risk-text" && !value) {
        errors.push(ruleValidationError(index, field, "风险词正则必填，保存后才会参与风险识别。"));
        continue;
      }
      if (!value) continue;
      const patternError = validateRuleRegExp(value);
      if (patternError) errors.push(ruleValidationError(index, field, `${evidencePatternFieldLabel(field)}不合法：${patternError}`));
    }
    return errors;
  }

  function evidencePatternFields(rule) {
    const fields = ["riskPattern", "nonZeroFailurePattern", "ignoredCommandPattern"];
    for (const field of Object.keys(rule || {})) {
      if (/Pattern$/.test(field) && !fields.includes(field)) fields.push(field);
    }
    return fields;
  }

  function evidencePatternFieldLabel(field) {
    const labels = {
      riskPattern: "风险词正则",
      nonZeroFailurePattern: "非零失败正则",
      ignoredCommandPattern: "忽略输出正文的命令正则",
    };
    return labels[field] || field;
  }

  function ruleValidationError(index, field, message) {
    return { index, field, message };
  }

  function validateTextFields(value) {
    const fields = textFieldValues(value);
    if (!fields.length) return "字段至少选择 status、output、payloadPreview 中的一个。";
    const invalid = fields.filter((field) => !allowedTextFields.has(field));
    return invalid.length ? `字段只支持 status、output、payloadPreview；不支持：${invalid.join(", ")}。` : "";
  }

  function textFieldValues(value) {
    const fields = Array.isArray(value) ? value : String(value || "").split(",");
    return fields.map((field) => String(field || "").trim()).filter(Boolean);
  }

  function validateMaxLength(value) {
    const text = String(value ?? "").trim();
    const number = Number(text);
    if (!text || !Number.isFinite(number) || number < 1 || Math.floor(number) !== number) return "大型输出阈值必须是大于 0 的整数。";
    return "";
  }

  function validateRuleRegExp(pattern) {
    try {
      compilePatternForValidation(pattern);
      return "";
    } catch (error) {
      return error?.message || "不是合法的 JavaScript RegExp";
    }
  }

  function validateSlashRegExp(value) {
    const text = String(value || "").trim();
    if (!text || text === "*" || !text.startsWith("/")) return "";
    const slash = text.match(/^\/([\s\S]*)\/([a-z]*)$/i);
    if (!slash) return "请使用 /pattern/flags 完整格式";
    try {
      new RegExp(slash[1], slash[2]);
      return "";
    } catch (error) {
      return error?.message || "不是合法的 JavaScript RegExp";
    }
  }

  function compilePatternForValidation(pattern) {
    const text = String(pattern || "");
    const slash = text.match(/^\/([\s\S]+)\/([a-z]*)$/i);
    if (slash) return new RegExp(slash[1], slash[2].includes("i") ? slash[2] : `${slash[2]}i`);
    return new RegExp(text, "is");
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
    const normalized = serializableCustomRulesFromMerged(rules);
    return normalized.length ? JSON.stringify(normalized) : "";
  }

  function serializableCustomRulesFromMerged(rules) {
    return customRulesFromMerged(rules).filter((rule, index) => validateRuleForSave(rule, index).length === 0);
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
    validateRulesForSave,
  };

  globalThis.EvidenceRiskRules = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
