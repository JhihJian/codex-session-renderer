const riskTextPattern = /\b(error|failed|failure|exception|stderr|non-?zero|exit code\s*[1-9]\d*)\b|失败|错误/i;
const nonZeroFailurePattern =
  /\bfail(?:ed|ures?)?\s*[:=]?\s*[1-9]\d*\b|\b[1-9]\d*\s+fail(?:ed|ures?)?\b|\berrors?\s*[:=]?\s*[1-9]\d*\b|\b[1-9]\d*\s+errors?\b/i;

const defaultIgnoredReadSearchPattern = "^(?:cat|type|more|less|head|tail|nl|Get-Content|gc|rg|grep|findstr|Select-String|sls|ag|ack)\\b";

const defaultEvidenceRiskRules = [
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
    riskPattern: String.raw`\b(error|failed|failure|exception|stderr|non-?zero|exit code\s*[1-9]\d*)\b|失败|错误`,
    nonZeroFailurePattern: String.raw`\bfail(?:ed|ures?)?\s*[:=]?\s*[1-9]\d*\b|\b[1-9]\d*\s+fail(?:ed|ures?)?\b|\berrors?\s*[:=]?\s*[1-9]\d*\b|\b[1-9]\d*\s+errors?\b`,
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
    maxLength: 100_000,
    summary: "工具输出较大，轻量视图可能不足以完整审计。",
  },
];

const ruleKinds = new Set(["risk-text", "large-payload"]);
const riskLevels = new Set(["low", "medium", "high"]);
const allowedTextFields = new Set(["status", "output", "payloadPreview"]);

function riskSignalsForEvidence(item, options = {}) {
  const rules = options.rules || activeEvidenceRiskRules(options.customRules || options.evidenceRiskRules);
  const signals = [];
  for (const rule of rules) {
    if (!toolMatches(rule.tool, item?.name)) continue;
    if (rule.kind === "risk-text" && evidenceHasRiskText(item, rule)) {
      signals.push({
        level: statusLooksFailed(item?.status) ? rule.failedLevel || rule.level : rule.level,
        tag: rule.tag || "error-output",
        summary: rule.summary || "工具输出或状态包含风险词。",
      });
    } else if (rule.kind === "large-payload" && evidenceHasLargePayload(item, rule)) {
      signals.push({
        level: rule.level || "medium",
        tag: rule.tag || "large-payload",
        summary: rule.summary || "工具输出较大，审计时需要回看原始事件。",
      });
    }
  }
  return signals;
}

function activeEvidenceRiskRules(customRules) {
  const defaults = defaultEvidenceRiskRules.map(cloneRule);
  const overrides = normalizeEvidenceRiskRules(customRules);
  const byId = new Map(defaults.map((rule) => [rule.id, rule]));
  const additions = [];
  for (const rule of overrides) {
    if (byId.has(rule.id)) byId.set(rule.id, { ...byId.get(rule.id), ...rule });
    else additions.push(rule);
  }
  return [...additions, ...defaults.map((rule) => byId.get(rule.id))].filter((rule) => rule.enabled !== false);
}

function normalizeEvidenceRiskRules(rules) {
  if (!Array.isArray(rules)) return [];
  return rules
    .map((rule, index) => {
      const kind = ruleKinds.has(String(rule?.kind || "")) ? String(rule.kind) : "risk-text";
      const normalized = {
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
        riskPattern: String(rule?.riskPattern || riskTextPattern.source).trim(),
        nonZeroFailurePattern: String(rule?.nonZeroFailurePattern || nonZeroFailurePattern.source).trim(),
        ignoredCommandPattern: String(rule?.ignoredCommandPattern || "").trim(),
        summary: String(rule?.summary || "").trim() || (kind === "large-payload" ? "工具输出较大，轻量视图可能不足以完整审计。" : "工具输出或状态包含风险词。"),
      };
      return normalized;
    })
    .filter((rule) => rule.id && rule.label && (rule.kind !== "large-payload" || rule.maxLength > 0));
}

function evidenceRiskRulesFingerprint(rules) {
  const normalized = normalizeEvidenceRiskRules(rules);
  if (!normalized.length) return "default";
  return JSON.stringify(normalized);
}

function validateEvidenceRiskRules(rules) {
  if (!Array.isArray(rules)) {
    return [{ index: -1, field: "rules", message: "证据风险规则必须是数组。" }];
  }
  return rules.flatMap((rule, index) => validateEvidenceRiskRule(rule, index));
}

function validateEvidenceRiskRule(rule, index) {
  const errors = [];
  const kind = ruleKinds.has(String(rule?.kind || "")) ? String(rule.kind) : "risk-text";
  const toolError = validateSlashRegExp(rule?.tool);
  if (toolError) errors.push({ index, field: "tool", message: `工具正则不合法：${toolError}` });
  const textFieldsError = rule?.textFields == null ? "" : validateTextFields(rule.textFields);
  if (textFieldsError) errors.push({ index, field: "textFields", message: textFieldsError });
  const maxLengthError = rule?.maxLength == null && kind !== "large-payload" ? "" : validateMaxLength(rule?.maxLength);
  if (maxLengthError) errors.push({ index, field: "maxLength", message: maxLengthError });
  for (const field of evidencePatternFields(rule)) {
    const value = String(rule?.[field] || "").trim();
    if (!value) continue;
    const patternError = validatePatternRegExp(value);
    if (patternError) errors.push({ index, field, message: `${field} 不合法：${patternError}` });
  }
  return errors;
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

function evidencePatternFields(rule) {
  const fields = ["riskPattern", "nonZeroFailurePattern", "ignoredCommandPattern"];
  for (const field of Object.keys(rule || {})) {
    if (/Pattern$/.test(field) && !fields.includes(field)) fields.push(field);
  }
  return fields;
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

function validatePatternRegExp(pattern) {
  try {
    compilePatternOrThrow(pattern);
    return "";
  } catch (error) {
    return error?.message || "不是合法的 JavaScript RegExp";
  }
}

function evidenceHasRiskText(item, rule) {
  const text = evidenceRiskText(item, rule);
  if (!text) return false;
  const value = String(text).replace(
    /\bfail(?:ed|ures?)?\s*[:=]?\s*0\b|\b0\s+fail(?:ed|ures?)?\b|\berrors?\s*[:=]?\s*0\b|\b0\s+errors?\b/gi,
    "",
  );
  return patternMatches(rule.riskPattern, value) || patternMatches(rule.nonZeroFailurePattern, value);
}

function evidenceRiskText(item, rule) {
  const ignored = commandMatchesIgnoredPattern(item, rule);
  const fields = ignored ? rule.textFields.filter((field) => field === "status") : rule.textFields;
  return fields.map((field) => item?.[field]).filter(Boolean).join("\n");
}

function evidenceHasLargePayload(item, rule) {
  return rule.textFields.some((field) => String(item?.[field] || "").length > rule.maxLength);
}

function commandMatchesIgnoredPattern(item, rule) {
  if (!rule.ignoredCommandPattern || !isShellExecutionTool(item)) return false;
  return shellCommandCandidates(item, item?.arguments).some((command) => shellCommandSegments(command).some((segment) => patternMatches(rule.ignoredCommandPattern, stripShellWrapper(segment))));
}

function patternMatches(pattern, text) {
  const compiled = compilePattern(pattern);
  if (!compiled) return false;
  return compiled.test(String(text || ""));
}

function compilePattern(pattern) {
  const text = String(pattern || "");
  if (!text) return null;
  try {
    return compilePatternOrThrow(text);
  } catch {
    return null;
  }
}

function compilePatternOrThrow(pattern) {
  const text = String(pattern || "");
  const slash = text.match(/^\/([\s\S]+)\/([a-z]*)$/i);
  if (slash) return new RegExp(slash[1], slash[2].includes("i") ? slash[2] : `${slash[2]}i`);
  return new RegExp(text, "is");
}

function toolMatches(ruleTool, toolName) {
  const rule = String(ruleTool || "").trim();
  if (!rule || rule === "*") return true;
  const tool = String(toolName || "").trim();
  const slash = rule.match(/^\/([\s\S]+)\/([a-z]*)$/i);
  if (slash) {
    try {
      return new RegExp(slash[1], slash[2].includes("i") ? slash[2] : `${slash[2]}i`).test(tool);
    } catch {
      return false;
    }
  }
  return rule.toLowerCase() === tool.toLowerCase();
}

function isShellExecutionTool(item) {
  return /(?:exec|shell|command|terminal|bash|powershell|cmd)/i.test(String(item?.name || ""));
}

function shellCommandCandidates(item, fallbackCommand) {
  const raw = String(item?.arguments || "");
  const parsed = parseMaybeJson(raw);
  const candidates = [];
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    for (const key of ["cmd", "command", "script", "shellCommand"]) {
      if (parsed[key]) candidates.push(String(parsed[key]));
    }
  }
  if (!candidates.length && fallbackCommand) candidates.push(String(fallbackCommand));
  return unique(candidates.map((candidate) => candidate.trim()).filter(Boolean));
}

function shellCommandSegments(text) {
  return splitShellSegments(String(text || ""))
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function splitShellSegments(text) {
  const segments = [];
  let segment = "";
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quote) {
      segment += char;
      if (char === quote && text[index - 1] !== "\\") quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      segment += char;
      continue;
    }
    if (char === "\r" || char === "\n" || char === ";" || char === "|") {
      segments.push(segment);
      segment = "";
      if ((char === "|" && next === "|") || (char === "&" && next === "&")) index += 1;
      continue;
    }
    if (char === "&" && next === "&") {
      segments.push(segment);
      segment = "";
      index += 1;
      continue;
    }
    segment += char;
  }
  segments.push(segment);
  return segments;
}

function stripShellWrapper(segment) {
  let text = String(segment || "").trim();
  text = text.replace(/^(?:cmd(?:\.exe)?\s+\/[cs]\s+|powershell(?:\.exe)?\s+(?:-[\w-]+\s+)*|pwsh(?:\.exe)?\s+(?:-[\w-]+\s+)*)/i, "");
  return text.replace(/^["'](.+)["']$/s, "$1").trim();
}

function parseMaybeJson(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed || !/^[{\[]/.test(trimmed)) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function statusLooksFailed(status) {
  return /failed|failure|error|非零|失败|错误/i.test(String(status || ""));
}

function normalizeTextFields(value, fallback) {
  const fields = Array.isArray(value) ? value : String(value || "").split(",");
  const normalized = fields.map((field) => String(field || "").trim()).filter((field) => field === "status" || field === "output" || field === "payloadPreview");
  return normalized.length ? unique(normalized) : fallback;
}

function normalizeMaxLength(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 100_000;
  return Math.max(1, Math.floor(number));
}

function normalizeRiskLevel(value, fallback) {
  const level = String(value || "").trim();
  return riskLevels.has(level) ? level : fallback;
}

function cloneRule(rule) {
  return JSON.parse(JSON.stringify(rule));
}

function unique(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

export {
  activeEvidenceRiskRules,
  defaultEvidenceRiskRules,
  evidenceRiskRulesFingerprint,
  normalizeEvidenceRiskRules,
  validateEvidenceRiskRules,
  riskSignalsForEvidence,
};
