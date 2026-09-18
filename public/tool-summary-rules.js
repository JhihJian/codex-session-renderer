{
  const storageKey = "codexSessionRenderer.toolSummaryRules.v1";

  const defaultRules = [
    {
      id: "pi-read-file",
      label: "Pi 读取文件",
      enabled: true,
      tool: "read",
      pattern: "[\\s\\S]*",
      title: "读取文件内容",
      summary: "{path}",
    },
    {
      id: "pi-write-file",
      label: "Pi 写入文件",
      enabled: true,
      tool: "write",
      pattern: "[\\s\\S]*",
      title: "写入文件",
      summary: "{path}",
    },
    {
      id: "pi-bash-rg-files",
      label: "Pi rg 列出文件",
      enabled: true,
      tool: "bash",
      pattern: "(?:^|\\s(?:&&|\\|\\||[|;])\\s*)rg\\s+--files\\b",
      title: "列出文件",
      summary: "{path}",
    },
    {
      id: "pi-bash-rg-search",
      label: "Pi rg 搜索文本",
      enabled: true,
      tool: "bash",
      pattern: "(?:^|\\s(?:&&|\\|\\||[|;])\\s*)rg\\b",
      title: "搜索文本",
      summary: "{query} {path}",
    },
    {
      id: "exec-read-file-pwsh-raw-utf8",
      label: "PowerShell UTF-8 读取文件",
      enabled: true,
      tool: "exec_command",
      pattern: "\\bGet-Content\\b(?=[\\s\\S]*\\b-Raw\\b)(?=[\\s\\S]*\\b-Encoding\\s+UTF8\\b)",
      title: "读取文件内容",
      summary: "{path}",
    },
    {
      id: "exec-read-file",
      label: "读取文件",
      enabled: true,
      tool: "exec_command",
      pattern: "^(?:Get-Content|gc|cat|type|sed\\s+-n)\\b",
      title: "读取文件内容",
      summary: "{path}",
    },
    {
      id: "exec-rg-files",
      label: "列出项目文件",
      enabled: true,
      tool: "exec_command",
      pattern: "^rg\\s+--files\\b",
      title: "列出文件",
      summary: "{path}",
    },
    {
      id: "exec-search-text",
      label: "搜索文本",
      enabled: true,
      tool: "exec_command",
      pattern: "^(?:rg|grep|findstr)\\b",
      title: "搜索文本",
      summary: "{query} {path}",
    },
    {
      id: "exec-list-dir",
      label: "列出目录",
      enabled: true,
      tool: "exec_command",
      pattern: "^(?:Get-ChildItem|gci|ls|dir)\\b",
      title: "列出目录",
      summary: "{path}",
    },
    {
      id: "exec-verification",
      label: "运行测试或检查",
      enabled: true,
      tool: "exec_command",
      pattern:
        "^(?:npm|pnpm|yarn)\\s+(?:run\\s+)?(?:test|check|lint|typecheck)\\b|^node\\s+--test\\b|^(?:npx\\s+)?(?:pytest|vitest|jest)\\b|^(?:npx\\s+)?playwright\\s+test\\b",
      title: "运行验证",
      summary: "{cmd}",
    },
    {
      id: "exec-build",
      label: "构建或类型检查",
      enabled: true,
      tool: "exec_command",
      pattern: "^(?:npm|pnpm|yarn)\\s+(?:run\\s+)?build\\b|^(?:npx\\s+)?tsc\\b|^cargo\\s+build\\b|^go\\s+test\\b|^mvn\\s+test\\b|^gradle\\s+test\\b",
      title: "构建 / 类型检查",
      summary: "{cmd}",
    },
    {
      id: "exec-git-status",
      label: "查看 Git 状态",
      enabled: true,
      tool: "exec_command",
      pattern: "^git\\s+status\\b",
      title: "查看 Git 状态",
      summary: "{cmd}",
    },
    {
      id: "exec-git-diff",
      label: "查看 Git 差异",
      enabled: true,
      tool: "exec_command",
      pattern: "^git\\s+(?:diff|show)\\b",
      title: "查看 Git 差异",
      summary: "{cmd}",
    },
    {
      id: "apply-patch",
      label: "应用补丁",
      enabled: true,
      tool: "apply_patch",
      pattern: "[\\s\\S]*",
      title: "修改文件",
      summary: "{patchSummary}",
    },
    {
      id: "tool-search",
      label: "搜索可用工具",
      enabled: true,
      tool: "tool_search_tool",
      pattern: "[\\s\\S]*",
      title: "搜索可用工具",
      summary: "{query}",
    },
  ];
  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeRules(rules) {
    if (!Array.isArray(rules)) return [];
    return rules
      .map((rule, index) => ({
        id: String(rule?.id || `custom-${Date.now()}-${index}`),
        label: String(rule?.label || rule?.title || "自定义规则").trim() || "自定义规则",
        enabled: rule?.enabled !== false,
        tool: String(rule?.tool || "").trim(),
        pattern: String(rule?.pattern || "").trim(),
        title: String(rule?.title || "").trim(),
        summary: String(rule?.summary || "").trim(),
      }))
      .filter((rule) => rule.pattern && rule.title);
  }

  function validateRulesForSave(rules) {
    if (!Array.isArray(rules)) return [];
    return rules.flatMap((rule, index) => validateRuleForSave(rule, index));
  }

  function validateRuleForSave(rule, index) {
    const errors = [];
    const title = String(rule?.title || "").trim();
    const pattern = String(rule?.pattern || "").trim();
    const tool = String(rule?.tool || "").trim();
    if (!title) errors.push(ruleValidationError(index, "title", "标题模板必填，保存后才会生成可读摘要。"));
    const toolError = validateSlashRegExp(tool);
    if (toolError) errors.push(ruleValidationError(index, "tool", `工具正则不合法：${toolError}`));
    if (!pattern) {
      errors.push(ruleValidationError(index, "pattern", "匹配正则必填，保存后才会参与展示规则匹配。"));
    } else {
      const patternError = validateRuleRegExp(pattern);
      if (patternError) errors.push(ruleValidationError(index, "pattern", `匹配正则不合法：${patternError}`));
    }
    return errors;
  }

  function ruleValidationError(index, field, message) {
    return { index, field, message };
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

  function loadCustomRules(storage = globalThis.localStorage) {
    if (!storage) return [];
    try {
      return normalizeRules(JSON.parse(storage.getItem(storageKey) || "[]"));
    } catch {
      return [];
    }
  }

  function saveCustomRules(rules, storage = globalThis.localStorage) {
    const normalized = normalizeRules(rules);
    if (storage) storage.setItem(storageKey, JSON.stringify(normalized));
    return normalized;
  }

  function activeRules(customRules) {
    return [...normalizeRules(customRules), ...defaultRules.map((rule) => ({ ...rule }))].filter((rule) => rule.enabled !== false);
  }
  function findRuleMatch(rules, context) {
    const text = [context.command, context.argumentText, context.summary, context.title].filter(Boolean).join("\n");
    for (const rule of rules) {
      if (!toolMatches(rule.tool, context.toolName)) continue;
      const pattern = compilePattern(rule.pattern);
      if (!pattern) continue;
      const match = pattern.exec(text);
      if (match) return { rule, match };
    }
    return null;
  }

  function compilePattern(pattern) {
    const text = String(pattern || "");
    if (!text) return null;
    try {
      const slash = text.match(/^\/([\s\S]+)\/([a-z]*)$/i);
      if (slash) return new RegExp(slash[1], slash[2].includes("i") ? slash[2] : `${slash[2]}i`);
      return new RegExp(text, "is");
    } catch {
      return null;
    }
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

  const parts = globalThis.ToolSummaryInternals || (globalThis.ToolSummaryInternals = {});
  parts.rules = {
    activeRules,
    clone,
    defaultRules,
    findRuleMatch,
    loadCustomRules,
    normalizeRules,
    saveCustomRules,
    storageKey,
    validateRulesForSave,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = parts.rules;
}
