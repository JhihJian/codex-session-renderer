(function () {
  const storageKey = "codexSessionRenderer.toolSummaryRules.v1";

  const defaultRules = [
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
      summary: "{patchFiles}",
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

  function firstLine(text, max = 160) {
    const normalized = String(text || "").replace(/\s+/g, " ").trim();
    if (!normalized) return "";
    return normalized.length > max ? `${normalized.slice(0, Math.max(1, max - 1))}…` : normalized;
  }

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

  function summarizeToolItem(item, options = {}) {
    return summarizeToolContext(
      {
        type: item?.type,
        toolName: item?.name || item?.toolName,
        title: item?.title,
        status: item?.status,
        arguments: item?.arguments ?? item?.argumentsPreview,
        output: item?.output ?? item?.outputPreview,
        summary: item?.summary || item?.payloadPreview || item?.text,
      },
      {
        ...options,
        fallbackTitle: fallbackItemTitle(item),
      },
    );
  }

  function summarizeAuditNode(node, item, options = {}) {
    const op = summarizeToolContext(
      {
        type: node?.type,
        toolName: node?.toolName || item?.name,
        title: node?.title,
        status: node?.status || item?.status,
        arguments: item?.arguments ?? node?.argumentsPreview,
        output: node?.outputPreview ?? item?.output,
        summary: node?.summary,
      },
      {
        ...options,
        fallbackTitle: node?.title || fallbackItemTitle(item),
      },
    );
    const nodeType = node?.type || "";
    if (!op.matched) {
      return {
        ...op,
        title: node?.title || op.title,
        summary: firstLine(node?.summary || node?.outputPreview || node?.argumentsPreview || op.summary, 220),
        body: firstLine([node?.summary, node?.outputPreview, node?.argumentsPreview].filter(Boolean).join("\n\n"), 700),
      };
    }

    if (nodeType === "evidence") {
      return {
        ...op,
        title: `${op.title} · 输出`,
        summary: readableOutputSummary(node?.outputPreview ?? item?.output, `${op.title}的输出`),
        body: readableOutputSummary(node?.outputPreview ?? item?.output, `${op.title}的输出`, 260),
      };
    }

    if (nodeType === "verification") {
      const output = node?.outputPreview ?? item?.output;
      const parts = [op.summary || op.command, output ? readableOutputSummary(output, "验证输出", 120) : ""].filter(Boolean);
      return {
        ...op,
        title: op.title,
        summary: firstLine(parts.join(" · "), 240),
        body: firstLine(parts.join("\n"), 700),
      };
    }

    if (nodeType === "risk" || nodeType === "incomplete") {
      const prefix = op.title ? `${op.title}：` : "";
      return {
        ...op,
        title: node?.title || op.title,
        summary: firstLine(`${prefix}${node?.summary || op.summary}`, 240),
        body: firstLine(`${prefix}${node?.summary || op.summary}`, 700),
      };
    }

    return {
      ...op,
      title: op.title,
      summary: firstLine(op.summary || op.command || node?.summary, 220),
      body: firstLine([op.summary, op.command && op.command !== op.summary ? op.command : ""].filter(Boolean).join("\n"), 700),
    };
  }

  function summarizeRawEvent(event, options = {}) {
    return summarizeToolContext(
      {
        toolName: event?.toolName || event?.title?.replace(/^Call\s+/i, "") || "",
        title: event?.title,
        arguments: event?.preview,
        output: event?.output,
        summary: event?.preview,
      },
      {
        ...options,
        fallbackTitle: event?.title || event?.kind || event?.type || "Raw event",
      },
    );
  }

  function summarizeToolContext(input, options = {}) {
    const context = extractContext(input);
    const rules = options.rules || activeRules(options.customRules);
    const matched = findRuleMatch(rules, context);
    const fallbackTitle = options.fallbackTitle || context.toolName || "工具调用";
    if (!matched) {
      const summary = firstLine(context.command || context.argumentText || context.summary || context.output, 220);
      return {
        matched: false,
        title: fallbackTitle,
        summary,
        body: summary,
        command: context.command,
        toolName: context.toolName,
        ruleId: null,
        ruleLabel: "",
        path: context.path,
        query: context.query,
      };
    }

    const vars = {
      ...context,
      tool: context.toolName,
      cmd: context.command,
      command: context.command,
      outputChars: context.output ? String(context.output).length : "",
      outputLines: context.output ? String(context.output).split(/\r?\n/).length : "",
      match: matched.match[0] || "",
      patchFiles: context.patchFiles,
    };
    for (const [index, value] of matched.match.entries()) vars[`match${index}`] = value || "";
    if (matched.match.groups) {
      for (const [key, value] of Object.entries(matched.match.groups)) vars[key] = value || "";
    }
    const title = cleanTemplateOutput(fillTemplate(matched.rule.title, vars)) || fallbackTitle;
    const summary =
      cleanTemplateOutput(fillTemplate(matched.rule.summary, { ...vars, title })) ||
      context.path ||
      context.query ||
      firstLine(context.command || context.argumentText || context.summary, 220);
    return {
      matched: true,
      title,
      summary: firstLine(summary, 220),
      body: firstLine([summary, context.command && context.command !== summary ? context.command : ""].filter(Boolean).join("\n"), 700),
      command: context.command,
      toolName: context.toolName,
      ruleId: matched.rule.id,
      ruleLabel: matched.rule.label || matched.rule.id,
      path: context.path,
      query: context.query,
    };
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

  function extractContext(input = {}) {
    const toolName = String(input.toolName || "").trim();
    const args = input.arguments ?? "";
    const parsedArgs = parseMaybeJson(args);
    const argumentText = typeof args === "string" ? args : JSON.stringify(args ?? "");
    const command = extractCommand(parsedArgs, argumentText, toolName);
    const output = input.output == null ? "" : String(input.output);
    const summary = input.summary == null ? "" : String(input.summary);
    const path = extractCommandPath(command, toolName) || "";
    const query = extractQuery(command, parsedArgs, summary) || "";
    const patchFiles = extractPatchFiles(argumentText, output);
    return {
      type: input.type || "",
      toolName,
      title: input.title || "",
      status: input.status || "",
      argumentText,
      command,
      output,
      summary,
      path,
      basename: path ? path.split(/[\\/]+/).filter(Boolean).at(-1) || path : "",
      workdir: parsedArgs && typeof parsedArgs === "object" && !Array.isArray(parsedArgs) ? String(parsedArgs.workdir || parsedArgs.cwd || "") : "",
      query,
      patchFiles,
    };
  }

  function extractCommand(parsedArgs, argumentText, toolName) {
    if (parsedArgs && typeof parsedArgs === "object" && !Array.isArray(parsedArgs)) {
      for (const key of ["cmd", "command", "script", "shellCommand", "code", "query"]) {
        if (parsedArgs[key] != null && typeof parsedArgs[key] !== "object") return String(parsedArgs[key]).trim();
      }
    }
    if (/apply_patch/i.test(toolName)) return firstLine(argumentText, 260);
    return String(argumentText || "").trim();
  }

  function parseMaybeJson(value) {
    if (value && typeof value === "object") return value;
    const text = String(value || "").trim();
    if (!/^[{\[]/.test(text)) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function extractCommandPath(command, toolName) {
    const text = primaryCommand(command);
    const tokens = shellTokens(stripShellWrapper(text));
    if (!tokens.length) return "";
    const commandName = commandBase(tokens[0]);
    if (/^(Get-Content|gc|cat|type)$/i.test(commandName)) return extractPowerShellPath(tokens);
    if (/^(Get-ChildItem|gci|ls|dir)$/i.test(commandName)) return extractLastNonOption(tokens.slice(1), { defaultValue: "." });
    if (/^(rg|grep|findstr)$/i.test(commandName)) return extractSearchPath(tokens);
    if (/^sed$/i.test(commandName)) return extractLastNonOption(tokens.slice(1));
    if (/apply_patch/i.test(toolName)) return "";
    return "";
  }

  function extractPowerShellPath(tokens) {
    for (let index = 1; index < tokens.length; index += 1) {
      if (/^-(?:LiteralPath|Path)$/i.test(tokens[index]) && tokens[index + 1]) return stripOuterQuotes(tokens[index + 1]);
    }
    return extractLastNonOption(tokens.slice(1), {
      valueOptions: new Set(["-encoding", "-filter", "-include", "-exclude", "-totalcount", "-tail"]),
    });
  }

  function extractSearchPath(tokens) {
    const commandName = commandBase(tokens[0]).toLowerCase();
    const rest = tokens.slice(1);
    const valueOptions = new Set(["-g", "--glob", "-t", "--type", "-e", "--regexp", "-m", "--max-count", "-A", "-B", "-C"]);
    const candidates = nonOptionTokens(rest, { valueOptions });
    if (commandName === "rg" && rest.includes("--files")) return candidates.at(-1) || ".";
    if (candidates.length <= 1) return "";
    return candidates.slice(1).join(" ");
  }

  function extractQuery(command, parsedArgs, summary) {
    if (parsedArgs && typeof parsedArgs === "object" && !Array.isArray(parsedArgs)) {
      for (const key of ["query", "q", "pattern", "search"]) {
        if (parsedArgs[key]) return firstLine(parsedArgs[key], 120);
      }
    }
    const tokens = shellTokens(stripShellWrapper(primaryCommand(command)));
    const commandName = commandBase(tokens[0] || "").toLowerCase();
    if (["rg", "grep", "findstr"].includes(commandName)) {
      const candidates = nonOptionTokens(tokens.slice(1), {
        valueOptions: new Set(["-g", "--glob", "-t", "--type", "-e", "--regexp", "-m", "--max-count", "-A", "-B", "-C"]),
      });
      return firstLine(candidates.find((token) => token !== "--files") || "", 120);
    }
    return firstLine(summary, 120);
  }

  function extractLastNonOption(tokens, options = {}) {
    const candidates = nonOptionTokens(tokens, options);
    return stripOuterQuotes(candidates.at(-1) || options.defaultValue || "");
  }

  function nonOptionTokens(tokens, options = {}) {
    const valueOptions = options.valueOptions || new Set();
    const result = [];
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (!token || token === "|" || token === "&&" || token === ";") continue;
      if (token.startsWith("-")) {
        if (valueOptions.has(token.toLowerCase()) && tokens[index + 1]) index += 1;
        continue;
      }
      result.push(stripOuterQuotes(token));
    }
    return result;
  }

  function primaryCommand(command) {
    return String(command || "").split(/\s(?:&&|\|\||[|;])\s?/)[0].trim();
  }

  function stripShellWrapper(command) {
    return String(command || "")
      .trim()
      .replace(/^(?:cmd(?:\.exe)?\s+\/[cs]\s+|powershell(?:\.exe)?\s+(?:-[\w-]+\s+)*|pwsh(?:\.exe)?\s+(?:-[\w-]+\s+)*)/i, "")
      .replace(/^["'](.+)["']$/s, "$1")
      .trim();
  }

  function shellTokens(command) {
    const tokens = [];
    let token = "";
    let quote = null;
    for (let index = 0; index < String(command || "").length; index += 1) {
      const char = command[index];
      if (quote) {
        if (char === quote) {
          quote = null;
          continue;
        }
        token += char;
        continue;
      }
      if (char === "'" || char === '"') {
        quote = char;
        continue;
      }
      if (/\s/.test(char)) {
        if (token) tokens.push(token);
        token = "";
        continue;
      }
      token += char;
    }
    if (token) tokens.push(token);
    return tokens;
  }

  function commandBase(value) {
    return String(value || "").split(/[\\/]+/).at(-1) || "";
  }

  function stripOuterQuotes(value) {
    return String(value || "").replace(/^["'](.+)["']$/s, "$1");
  }

  function extractPatchFiles(argumentsText, outputText) {
    const files = [];
    const text = [argumentsText, outputText].filter(Boolean).join("\n");
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^(?:[AMDR]\s+|[-+]{3}\s+[ab]\/|\+\+\+\s+[ab]\/)(.+)$/);
      if (match) files.push(match[1].trim());
    }
    return [...new Set(files)].slice(0, 4).join(", ");
  }

  function readableOutputSummary(output, label = "工具输出", maxPreview = 160) {
    const text = String(output || "");
    if (!text) return `${label} · 无输出`;
    const lines = text.split(/\r?\n/).length;
    const chars = text.length;
    const preview = firstLine(text, maxPreview);
    return firstLine(`${label} · ${lines} 行 / ${chars} 字符${preview ? ` · ${preview}` : ""}`, Math.max(220, maxPreview + 80));
  }

  function fillTemplate(template, vars) {
    return String(template || "").replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => (vars[key] == null ? "" : String(vars[key])));
  }

  function cleanTemplateOutput(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .replace(/\s+([：:，,。;；])/g, "$1")
      .replace(/([：:，,;；])\s*$/g, "")
      .trim();
  }

  function fallbackItemTitle(item) {
    if (!item) return "工具调用";
    if (item.type === "tool-output") return "工具输出";
    if (item.name) return `工具调用 · ${item.name}`;
    return item.type || "工具调用";
  }

  const api = {
    activeRules,
    defaultRules: () => clone(defaultRules),
    loadCustomRules,
    normalizeRules,
    readableOutputSummary,
    saveCustomRules,
    storageKey,
    summarizeAuditNode,
    summarizeRawEvent,
    summarizeToolContext,
    summarizeToolItem,
  };

  globalThis.ToolSummary = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
