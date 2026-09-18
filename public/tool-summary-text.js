{
  function firstLine(text, max = 160) {
    const normalized = String(text || "").replace(/\s+/g, " ").trim();
    if (!normalized) return "";
    return normalized.length > max ? `${normalized.slice(0, Math.max(1, max - 1))}…` : normalized;
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
    if (!/^[{[]/.test(text)) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function extractCommandPath(command, toolName) {
    const text = commandForSummary(command, toolName);
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

  function extractArgumentPath(parsedArgs) {
    if (!parsedArgs || typeof parsedArgs !== "object" || Array.isArray(parsedArgs)) return "";
    for (const key of ["path", "filePath", "filepath", "targetPath", "outputPath"]) {
      if (typeof parsedArgs[key] === "string" && parsedArgs[key].trim()) return stripOuterQuotes(parsedArgs[key].trim());
    }
    return "";
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

  function extractQuery(command, parsedArgs, summary, toolName) {
    if (parsedArgs && typeof parsedArgs === "object" && !Array.isArray(parsedArgs)) {
      for (const key of ["query", "q", "pattern", "search"]) {
        if (parsedArgs[key]) return firstLine(parsedArgs[key], 120);
      }
    }
    const tokens = shellTokens(stripShellWrapper(commandForSummary(command, toolName)));
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

  function commandForSummary(command, toolName = "") {
    const commands = String(command || "")
      .split(/\s(?:&&|\|\||[|;])\s?/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (/^bash$/i.test(toolName)) return commands.find((part) => /^rg\b/i.test(stripShellWrapper(part))) || commands[0] || "";
    return commands[0] || "";
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

  function cleanPatchPath(value) {
    return String(value || "")
      .replace(/^["']|["']$/g, "")
      .replace(/^(?:a|b)\//, "")
      .trim();
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

  const parts = globalThis.ToolSummaryInternals || (globalThis.ToolSummaryInternals = {});
  parts.text = {
    cleanPatchPath,
    cleanTemplateOutput,
    commandBase,
    commandForSummary,
    extractArgumentPath,
    extractCommand,
    extractCommandPath,
    extractQuery,
    fallbackItemTitle,
    fillTemplate,
    firstLine,
    parseMaybeJson,
    primaryCommand,
    readableOutputSummary,
    shellTokens,
    stripShellWrapper,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = parts.text;
}
