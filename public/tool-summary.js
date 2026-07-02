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

    if (nodeType === "risk") {
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
        changeSet: context.changeSet,
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
      patchSummary: context.patchSummary,
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
      changeSet: context.changeSet,
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
    const changeSet = extractChangeSet(argumentText, output, toolName);
    const patchFiles = changeSet.files.length ? changeSet.files.map((file) => displayPatchFilePath(file)).slice(0, 4).join(", ") : extractPatchFiles(argumentText, output);
    const patchSummary = formatPatchSummary(changeSet) || patchFiles;
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
      patchSummary,
      changeSet,
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

  function extractChangeSet(argumentsText, outputText, toolName) {
    const patch = parseApplyPatch(argumentsText);
    const outputFiles = parsePatchOutputFiles(outputText);
    const files = mergePatchFiles(patch.files, outputFiles);
    const additions = files.reduce((total, file) => total + (Number(file.additions) || 0), 0);
    const deletions = files.reduce((total, file) => total + (Number(file.deletions) || 0), 0);
    const hunkCount = files.reduce((total, file) => total + (Number(file.hunks) || 0), 0);
    const source = patch.files.length ? "patch" : outputFiles.length ? "output" : /apply_patch/i.test(toolName || "") ? "apply_patch" : "";
    return {
      kind: source ? "file-diff" : "",
      source,
      files,
      fileCount: files.length,
      additions,
      deletions,
      hunkCount,
    };
  }

  function parseApplyPatch(text) {
    const files = [];
    const lines = String(text || "").split(/\r?\n/);
    let current = null;

    const finish = () => {
      if (!current) return;
      const normalized = normalizePatchFile(current);
      if (normalized.path) files.push(normalized);
      current = null;
    };

    for (const line of lines) {
      let match = line.match(/^\*\*\* Add File:\s+(.+)$/);
      if (match) {
        finish();
        current = newPatchFile(match[1], "added");
        continue;
      }
      match = line.match(/^\*\*\* Delete File:\s+(.+)$/);
      if (match) {
        finish();
        current = newPatchFile(match[1], "deleted");
        continue;
      }
      match = line.match(/^\*\*\* Update File:\s+(.+)$/);
      if (match) {
        finish();
        current = newPatchFile(match[1], "modified");
        continue;
      }
      match = line.match(/^\*\*\* Move to:\s+(.+)$/);
      if (match && current) {
        current.oldPath = current.path;
        current.path = match[1];
        current.status = "renamed";
        continue;
      }
      if (!current) continue;
      if (/^@@/.test(line)) {
        current.hunks += 1;
        continue;
      }
      if (/^\+(?!\+\+)/.test(line)) {
        current.additions += 1;
        continue;
      }
      if (/^-(?!--)/.test(line)) current.deletions += 1;
    }
    finish();
    return { files };
  }

  function newPatchFile(path, status) {
    return {
      path: cleanPatchPath(path),
      oldPath: "",
      status,
      additions: 0,
      deletions: 0,
      hunks: 0,
    };
  }

  function parsePatchOutputFiles(outputText) {
    const files = [];
    for (const line of String(outputText || "").split(/\r?\n/)) {
      const match = line.trim().match(/^([AMD])\s+(.+)$/);
      if (!match) continue;
      files.push(newPatchFile(match[2], patchStatusFromShort(match[1])));
    }
    return files;
  }

  function mergePatchFiles(primary, secondary) {
    const byPath = new Map();
    for (const file of [...primary, ...secondary]) {
      const normalized = normalizePatchFile(file);
      if (!normalized.path) continue;
      const key = [normalized.oldPath, normalized.path].join("\0");
      const existing = byPath.get(key);
      if (!existing) {
        byPath.set(key, normalized);
        continue;
      }
      existing.status = existing.status || normalized.status;
      existing.additions = Math.max(existing.additions || 0, normalized.additions || 0);
      existing.deletions = Math.max(existing.deletions || 0, normalized.deletions || 0);
      existing.hunks = Math.max(existing.hunks || 0, normalized.hunks || 0);
      existing.changeCount = existing.additions + existing.deletions;
    }
    return [...byPath.values()];
  }

  function normalizePatchFile(file) {
    const additions = Math.max(0, Number(file?.additions) || 0);
    const deletions = Math.max(0, Number(file?.deletions) || 0);
    return {
      path: cleanPatchPath(file?.path),
      oldPath: cleanPatchPath(file?.oldPath || ""),
      status: file?.status || "modified",
      additions,
      deletions,
      hunks: Math.max(0, Number(file?.hunks) || 0),
      changeCount: additions + deletions,
    };
  }

  function cleanPatchPath(value) {
    return String(value || "")
      .replace(/^["']|["']$/g, "")
      .replace(/^(?:a|b)\//, "")
      .trim();
  }

  function patchStatusFromShort(value) {
    if (value === "A") return "added";
    if (value === "D") return "deleted";
    return "modified";
  }

  function displayPatchFilePath(file) {
    if (!file) return "";
    const path = file.path || "";
    return file.oldPath && file.oldPath !== path ? `${file.oldPath} -> ${path}` : path;
  }

  function formatPatchSummary(changeSet) {
    const files = changeSet?.files || [];
    if (!files.length) return "";
    const fileLabel = `${files.length} 个文件`;
    const stats = changeSet.additions || changeSet.deletions ? `+${changeSet.additions || 0} -${changeSet.deletions || 0}` : "";
    const shown = files.slice(0, 3).map(displayPatchFilePath).filter(Boolean);
    const more = files.length > shown.length ? `+${files.length - shown.length}` : "";
    return [fileLabel, stats, [...shown, more].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
  }

  function patchBodyModel(value, changeSet = null) {
    const raw = String(value || "").trim();
    if (!raw) return null;
    let lines = raw.split(/\r?\n/);
    let command = "apply_patch";
    if (/^\s*apply_patch\s*$/i.test(lines[0] || "")) {
      command = lines.shift().trim();
    }
    const beginIndex = lines.findIndex((line) => line.trim() === "*** Begin Patch");
    const firstFileIndex = lines.findIndex((line) => /^\*\*\*\s+(?:Add|Update|Delete)\s+File:\s+/.test(line));
    if (beginIndex < 0 && firstFileIndex < 0) return null;
    lines = lines.slice(beginIndex >= 0 ? beginIndex + 1 : firstFileIndex);
    const endIndex = lines.findIndex((line) => line.trim() === "*** End Patch");
    if (endIndex >= 0) lines = lines.slice(0, endIndex);

    const files = [];
    let current = null;
    const finish = () => {
      if (!current) return;
      const normalized = normalizePatchFile(current);
      const stats = patchStatsForFile(normalized, changeSet);
      files.push({
        ...normalized,
        additions: Math.max(normalized.additions, stats?.additions || 0),
        deletions: Math.max(normalized.deletions, stats?.deletions || 0),
        hunks: Math.max(normalized.hunks, stats?.hunks || 0),
        lines: current.lines,
      });
      current = null;
    };

    for (const line of lines) {
      let match = line.match(/^\*\*\* Add File:\s+(.+)$/);
      if (match) {
        finish();
        current = patchBodyFile(match[1], "added");
        continue;
      }
      match = line.match(/^\*\*\* Delete File:\s+(.+)$/);
      if (match) {
        finish();
        current = patchBodyFile(match[1], "deleted");
        continue;
      }
      match = line.match(/^\*\*\* Update File:\s+(.+)$/);
      if (match) {
        finish();
        current = patchBodyFile(match[1], "modified");
        continue;
      }
      match = line.match(/^\*\*\* Move to:\s+(.+)$/);
      if (match && current) {
        current.oldPath = current.path;
        current.path = cleanPatchPath(match[1]);
        current.status = "renamed";
        continue;
      }
      if (!current) continue;
      if (/^@@/.test(line)) {
        current.hunks += 1;
        current.lines.push({ kind: "hunk", marker: "@@", text: line });
        continue;
      }
      if (/^\+(?!\+\+)/.test(line)) {
        current.additions += 1;
        current.lines.push({ kind: "added", marker: "+", text: line.slice(1) });
        continue;
      }
      if (/^-(?!--)/.test(line)) {
        current.deletions += 1;
        current.lines.push({ kind: "removed", marker: "-", text: line.slice(1) });
        continue;
      }
      if (/^\*\*\*/.test(line)) continue;
      current.lines.push({ kind: "context", marker: " ", text: line.startsWith(" ") ? line.slice(1) : line });
    }
    finish();
    if (!files.length) return null;
    const normalizedFiles = files.map((file) => ({
      ...file,
      changeCount: (Number(file.additions) || 0) + (Number(file.deletions) || 0),
    }));
    return {
      kind: "apply_patch",
      command,
      files: normalizedFiles,
      fileCount: normalizedFiles.length,
      additions: normalizedFiles.reduce((total, file) => total + (Number(file.additions) || 0), 0),
      deletions: normalizedFiles.reduce((total, file) => total + (Number(file.deletions) || 0), 0),
      hunkCount: normalizedFiles.reduce((total, file) => total + (Number(file.hunks) || 0), 0),
    };
  }

  function patchBodyFile(path, status) {
    return {
      ...newPatchFile(path, status),
      lines: [],
    };
  }

  function patchStatsForFile(file, changeSet) {
    const files = changeSet?.files || [];
    return files.find((entry) => cleanPatchPath(entry.path) === file.path && cleanPatchPath(entry.oldPath || "") === file.oldPath) || files.find((entry) => cleanPatchPath(entry.path) === file.path) || null;
  }

  function commandOutputModel(value, context = {}) {
    const source = normalizeCommandOutputSource(value, context);
    if (!source.command && !source.output) return null;
    return gitStatusOutputModel(source) || searchOutputModel(source) || verificationOutputModel(source);
  }

  function normalizeCommandOutputSource(value, context = {}) {
    const body = String(value || "").trim();
    const argumentText = firstNonEmpty(
      context.arguments,
      context.argumentsBody,
      context.argumentsPreview,
      context.argumentText,
    );
    const parsedArgs = parseMaybeJson(argumentText);
    let command = firstNonEmpty(context.command, extractCommand(parsedArgs, argumentText, context.toolName || context.name || ""), commandFromBody(body));
    command = String(command || "").trim();
    let output = firstNonEmpty(context.output, context.outputBody, context.outputPreview);
    output = output ? String(output).trim() : outputFromBody(body, command);
    output = stripExecOutputScaffold(output);
    const rawForExit = [context.exitCode, context.status, value, output].filter((part) => part != null).join("\n");
    return {
      command,
      output,
      body,
      exitCode: exitCodeFromText(rawForExit),
      status: String(context.status || "").trim(),
      title: String(context.title || "").trim(),
      toolName: String(context.toolName || context.name || "").trim(),
    };
  }

  function firstNonEmpty(...values) {
    for (const value of values) {
      if (String(value ?? "").trim()) return String(value).trim();
    }
    return "";
  }

  function commandFromBody(body) {
    const first = String(body || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (!first) return "";
    return /^(?:git|npm|pnpm|yarn|node|npx|pytest|vitest|jest|playwright|rg|grep|findstr|go|cargo|mvn|gradle|tsc)\b/i.test(first)
      ? first
      : "";
  }

  function outputFromBody(body, command) {
    const text = String(body || "").trim();
    if (!text) return "";
    const lines = text.split(/\r?\n/);
    if (command && lines[0]?.trim() === command.trim()) return lines.slice(1).join("\n").trim();
    const firstCommand = commandFromBody(text);
    if (firstCommand && lines[0]?.trim() === firstCommand) return lines.slice(1).join("\n").trim();
    return text;
  }

  function stripExecOutputScaffold(value) {
    const lines = String(value || "").split(/\r?\n/);
    const cleaned = [];
    for (const line of lines) {
      if (/^(?:Chunk ID|Wall time|Original token count):/i.test(line)) continue;
      if (/^Process exited with code\s+-?\d+/i.test(line)) continue;
      if (/^Output:\s*$/i.test(line)) continue;
      cleaned.push(line);
    }
    return cleaned.join("\n").trim();
  }

  function exitCodeFromText(text) {
    if (typeof text === "number" && Number.isFinite(text)) return text;
    const value = String(text || "");
    const match = value.match(/(?:Process exited with code|exit code|exitCode)\s*[:=]?\s*(-?\d+)/i);
    return match ? Number(match[1]) : null;
  }

  function normalizedPrimaryCommand(command) {
    return stripShellWrapper(primaryCommand(command)).trim();
  }

  function gitStatusOutputModel(source) {
    const command = normalizedPrimaryCommand(source.command);
    const output = source.output;
    const isGitStatus = /^git\s+status\b/i.test(command);
    if (!isGitStatus && !/\b(?:working tree clean|nothing to commit|Changes to be committed|Changes not staged|Untracked files)\b/i.test(output)) return null;

    const parsed = parseGitStatusOutput(output);
    if (!isGitStatus && !parsed.files.length && !parsed.clean) return null;
    const counts = countBy(parsed.files, "status");
    const changed = parsed.files.length;
    const summary = parsed.clean || !changed ? [parsed.branch ? `${parsed.branch} 分支` : "", "工作区干净"].filter(Boolean).join(" · ") : `${changed} 个变更文件`;
    const metrics = [
      parsed.branch ? { label: "分支", value: parsed.branch } : null,
      { label: "文件", value: String(changed), tone: changed ? "warn" : "good" },
      counts.modified ? { label: "修改", value: String(counts.modified) } : null,
      counts.added ? { label: "新增", value: String(counts.added), tone: "good" } : null,
      counts.deleted ? { label: "删除", value: String(counts.deleted), tone: "bad" } : null,
      counts.untracked ? { label: "未跟踪", value: String(counts.untracked), tone: "warn" } : null,
      counts.conflict ? { label: "冲突", value: String(counts.conflict), tone: "bad" } : null,
    ].filter(Boolean);
    const sections = parsed.files.length
      ? [
          {
            title: "文件状态",
            meta: parsed.files.length > 16 ? `显示 16 / ${parsed.files.length}` : `${parsed.files.length} 项`,
            items: parsed.files.slice(0, 16).map((file) => ({
              kind: "file",
              status: file.status,
              label: gitStatusLabel(file.status),
              path: file.path,
              meta: file.scope || file.code || "",
              tone: commandToneForStatus(file.status),
            })),
          },
        ]
      : [{ title: "状态", lines: [{ kind: "success", text: "没有待提交或未跟踪文件。" }] }];
    return {
      kind: "command_output",
      category: "git_status",
      command: source.command || "git status",
      title: "Git 状态",
      status: parsed.files.some((file) => file.status === "conflict") ? "failed" : changed ? "changed" : "passed",
      summary,
      metrics,
      sections,
      lineCount: output ? output.split(/\r?\n/).length : 0,
    };
  }

  function parseGitStatusOutput(output) {
    const files = [];
    let branch = "";
    let section = "";
    let clean = false;
    for (const rawLine of String(output || "").split(/\r?\n/)) {
      const line = rawLine.replace(/\s+$/g, "");
      const trimmed = line.trim();
      if (!trimmed) continue;
      let match = trimmed.match(/^On branch\s+(.+)$/i);
      if (match) {
        branch = match[1].trim();
        continue;
      }
      if (/^(?:nothing to commit|working tree clean)/i.test(trimmed)) {
        clean = true;
        continue;
      }
      if (/^Changes to be committed:/i.test(trimmed)) {
        section = "staged";
        continue;
      }
      if (/^Changes not staged for commit:/i.test(trimmed)) {
        section = "unstaged";
        continue;
      }
      if (/^Untracked files:/i.test(trimmed)) {
        section = "untracked";
        continue;
      }
      if (/^Unmerged paths:/i.test(trimmed)) {
        section = "conflict";
        continue;
      }

      match = line.match(/^([ MADRCU?!]{1,2})\s+(.+)$/);
      if (match && /[MADRCU?!]/.test(match[1])) {
        const code = match[1];
        files.push({ status: gitStatusFromCode(code), code: code.trim() || code, path: cleanPatchPath(match[2]), scope: gitStatusScope(code) });
        continue;
      }

      match = trimmed.match(/^(modified|new file|deleted|renamed|copied|both modified|both deleted|added by us|deleted by them):\s+(.+)$/i);
      if (match) {
        files.push({ status: gitStatusFromLong(match[1], section), code: "", path: cleanPatchPath(match[2]), scope: section });
        continue;
      }

      if (section === "untracked" && /^\S/.test(trimmed) && !/^\(use\s/i.test(trimmed)) {
        files.push({ status: "untracked", code: "??", path: cleanPatchPath(trimmed), scope: section });
      }
    }
    return { branch, clean, files };
  }

  function gitStatusFromCode(code) {
    if (/U/.test(code)) return "conflict";
    if (/\?/.test(code)) return "untracked";
    if (/R/.test(code)) return "renamed";
    if (/C/.test(code)) return "copied";
    if (/A/.test(code)) return "added";
    if (/D/.test(code)) return "deleted";
    if (/M/.test(code)) return "modified";
    return "changed";
  }

  function gitStatusScope(code) {
    if (code.includes("?")) return "未跟踪";
    const index = code[0] && code[0] !== " " ? "暂存" : "";
    const worktree = code[1] && code[1] !== " " ? "工作区" : "";
    return [index, worktree].filter(Boolean).join(" + ");
  }

  function gitStatusFromLong(label, section) {
    const value = String(label || "").toLowerCase();
    if (section === "conflict" || /^both| by /.test(value)) return "conflict";
    if (value.includes("new file")) return "added";
    if (value.includes("deleted")) return "deleted";
    if (value.includes("renamed")) return "renamed";
    if (value.includes("copied")) return "copied";
    if (value.includes("modified")) return "modified";
    return section === "untracked" ? "untracked" : "changed";
  }

  function gitStatusLabel(status) {
    const labels = {
      added: "新增",
      changed: "变更",
      conflict: "冲突",
      copied: "复制",
      deleted: "删除",
      modified: "修改",
      renamed: "重命名",
      untracked: "未跟踪",
    };
    return labels[status] || "变更";
  }

  function commandToneForStatus(status) {
    if (["deleted", "conflict"].includes(status)) return "bad";
    if (["added", "untracked"].includes(status)) return "warn";
    return "info";
  }

  function searchOutputModel(source) {
    const command = normalizedPrimaryCommand(source.command);
    const isSearch = /^(?:rg|grep|findstr)\b/i.test(command) && !/\s--files\b/i.test(command);
    const matches = parseSearchMatches(source.output);
    if (!isSearch && !matches.length) return null;
    const hasError = (source.exitCode != null && source.exitCode > 1) || (source.output && !matches.length && source.exitCode !== 1 && commandLines(source.output).some(isFailureLine));
    const fileCount = new Set(matches.map((match) => match.path)).size;
    const sections = matches.length
      ? [
          {
            title: "搜索命中",
            meta: matches.length > 18 ? `显示 18 / ${matches.length}` : `${matches.length} 条`,
            items: matches.slice(0, 18).map((match) => ({
              kind: "match",
              label: match.line ? `:${match.line}` : "match",
              path: match.path,
              text: firstLine(match.text, 260),
              meta: match.column ? `col ${match.column}` : "",
            })),
          },
        ]
      : [
          {
            title: hasError ? "输出" : "搜索命中",
            lines: commandLines(source.output || "没有命中。", 10).map((line) => ({ kind: hasError ? "error" : "muted", text: line })),
          },
        ];
    return {
      kind: "command_output",
      category: "search",
      command: source.command || command || "search",
      title: "搜索结果",
      status: hasError ? "failed" : matches.length ? "found" : "empty",
      summary: matches.length ? `${matches.length} 条命中 · ${fileCount} 个文件` : "没有命中",
      metrics: [
        { label: "命中", value: String(matches.length), tone: matches.length ? "info" : "muted" },
        { label: "文件", value: String(fileCount) },
        source.exitCode != null ? { label: "退出码", value: String(source.exitCode), tone: hasError ? "bad" : "muted" } : null,
      ].filter(Boolean),
      sections,
      lineCount: source.output ? source.output.split(/\r?\n/).length : 0,
    };
  }

  function parseSearchMatches(output) {
    const matches = [];
    for (const line of String(output || "").split(/\r?\n/)) {
      const match = line.match(/^(.+?)(?::|-)(\d+)(?::(\d+))?[:\-](.*)$/);
      if (!match) continue;
      matches.push({
        path: cleanPatchPath(match[1]),
        line: Number(match[2]),
        column: match[3] ? Number(match[3]) : null,
        text: match[4].trim(),
      });
    }
    return matches;
  }

  function verificationOutputModel(source) {
    const command = normalizedPrimaryCommand(source.command);
    const isVerification = isVerificationCommand(command) || verificationOutputLooksLike(source.output);
    if (!isVerification) return null;
    const counts = verificationCounts(source.output);
    const failureLines = commandLines(source.output, 80).filter(isFailureLine);
    const failed = (source.exitCode != null && source.exitCode !== 0) || (counts.fail || 0) > 0 || (counts.error || 0) > 0 || failureLines.length > 0;
    const passed =
      !failed &&
      (source.exitCode === 0 ||
        (counts.pass || 0) > 0 ||
        /\b(?:all tests? passed|tests? passed|passed)\b|验证通过|检查通过/i.test(source.output) ||
        /completed|success|succeeded/i.test(source.status));
    const keyLines = verificationKeyLines(source.output, failed);
    const metrics = [
      source.exitCode != null ? { label: "退出码", value: String(source.exitCode), tone: source.exitCode === 0 ? "good" : "bad" } : null,
      counts.total != null ? { label: "测试", value: String(counts.total) } : null,
      counts.pass != null ? { label: "通过", value: String(counts.pass), tone: "good" } : null,
      counts.fail != null ? { label: "失败", value: String(counts.fail), tone: counts.fail ? "bad" : "muted" } : null,
      counts.error != null ? { label: "错误", value: String(counts.error), tone: counts.error ? "bad" : "muted" } : null,
      counts.duration ? { label: "耗时", value: counts.duration } : null,
    ].filter(Boolean);
    return {
      kind: "command_output",
      category: "verification",
      command: source.command || command || "verification",
      title: "验证输出",
      status: failed ? "failed" : passed ? "passed" : "info",
      summary: verificationSummary({ failed, passed, counts }),
      metrics,
      sections: [
        {
          title: failed ? "失败线索" : "关键输出",
          meta: keyLines.length > 12 ? "显示前 12 行" : "",
          lines: (keyLines.length ? keyLines : ["命令没有产生可归纳的关键输出。"]).slice(0, 12).map((line) => ({
            kind: isFailureLine(line) ? "error" : isSuccessLine(line) ? "success" : "muted",
            text: firstLine(line, 320),
          })),
        },
      ],
      lineCount: source.output ? source.output.split(/\r?\n/).length : 0,
    };
  }

  function isVerificationCommand(command) {
    return /^(?:npm|pnpm|yarn)\s+(?:run\s+)?(?:test|check|lint|build|typecheck)\b|^node\s+--test\b|^(?:npx\s+)?(?:pytest|vitest|jest)\b|^(?:npx\s+)?playwright\s+test\b|^(?:npx\s+)?tsc\b|^go\s+test\b|^cargo\s+test\b|^mvn\s+test\b|^gradle\s+test\b/i.test(
      command,
    );
  }

  function verificationOutputLooksLike(output) {
    return /\bTAP version\b|#\s*tests\s+\d+|#\s*pass\s+\d+|\bTest Files\b|\bTests?\b[\s\S]{0,80}\b(?:passed|failed)\b|\b(?:PASS|FAIL)\b/i.test(output);
  }

  function verificationCounts(output) {
    const text = String(output || "");
    const durationMs = numberFromPatterns(text, [/#\s*duration_ms\s+([\d.]+)/i]);
    return {
      total: numberFromPatterns(text, [/#\s*tests\s+(\d+)/i, /\btests?\s+(\d+)/i, /\bTests?\s*[:=]\s*(\d+)/i, /\b(\d+)\s+tests?\b/i]),
      pass: numberFromPatterns(text, [/#\s*pass\s+(\d+)/i, /\b(\d+)\s+passed\b/i, /\bpass(?:ed)?\s+(\d+)/i]),
      fail: numberFromPatterns(text, [/#\s*fail\s+(\d+)/i, /\b(\d+)\s+failed\b/i, /\bfail(?:ed)?\s+(\d+)/i]),
      error: numberFromPatterns(text, [/#\s*errors?\s+(\d+)/i, /\b(\d+)\s+errors?\b/i, /\berrors?\s+(\d+)/i]),
      duration: durationMs != null ? formatCommandDuration(durationMs) : durationFromText(text),
    };
  }

  function numberFromPatterns(text, patterns) {
    for (const pattern of patterns) {
      const match = String(text || "").match(pattern);
      if (match) return Number(match[1]);
    }
    return null;
  }

  function durationFromText(text) {
    const match = String(text || "").match(/\b(?:Time|Duration)\s*[:=]?\s*([\d.]+\s*(?:ms|s|m))/i);
    return match ? match[1].replace(/\s+/g, "") : "";
  }

  function formatCommandDuration(ms) {
    const value = Number(ms);
    if (!Number.isFinite(value)) return "";
    if (value < 1000) return `${Math.round(value)}ms`;
    return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}s`;
  }

  function verificationSummary({ failed, passed, counts }) {
    const parts = [];
    if (counts.total != null) parts.push(`${counts.total} tests`);
    if (counts.pass != null) parts.push(`${counts.pass} passed`);
    if (counts.fail != null) parts.push(`${counts.fail} failed`);
    if (failed) return ["验证失败", parts.join(" · ")].filter(Boolean).join(" · ");
    if (passed) return ["验证通过", parts.join(" · ")].filter(Boolean).join(" · ");
    return ["验证输出", parts.join(" · ")].filter(Boolean).join(" · ");
  }

  function verificationKeyLines(output, failed) {
    const lines = commandLines(output, 80);
    const picked = lines.filter((line) => (failed ? isFailureLine(line) : isSuccessLine(line) || /#\s*(?:tests|pass|fail|duration_ms)\b|Test Files|Tests\b|Duration|Time:/i.test(line)));
    return picked.length ? picked : lines.slice(Math.max(0, lines.length - 8));
  }

  function commandLines(output, max = 20) {
    return String(output || "")
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => line.trim())
      .slice(0, max);
  }

  function isFailureLine(line) {
    const value = String(line || "").trim();
    if (!value) return false;
    if (/^(?:✔|✓|ok\s+\d+\s+-|\s*PASS\b)/i.test(value)) return false;
    if (/\b(?:0\s+failed|failed\s+0|fail\s+0|0\s+errors?|errors?\s+0)\b/i.test(value)) return false;
    return /\b(?:not ok|FAIL\b|failed|failures?\s*[:=]?\s*[1-9]\d*|[1-9]\d*\s+failures?|errors?\s*[:=]?\s*[1-9]\d*|[1-9]\d*\s+errors?|error:|exception|ERR!|ELIFECYCLE)\b|失败|错误/i.test(value);
  }

  function isSuccessLine(line) {
    return /\b(?:ok\b|PASS|passed|success|succeeded)\b|通过|成功/i.test(String(line || ""));
  }

  function countBy(items, key) {
    return items.reduce((counts, item) => {
      const value = item?.[key] || "";
      if (value) counts[value] = (counts[value] || 0) + 1;
      return counts;
    }, {});
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
    commandOutputModel,
    loadCustomRules,
    normalizeRules,
    patchBodyModel,
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
