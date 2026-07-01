(function () {
  const storageKey = "codexSessionRenderer.executionGroupRules.v1";

  const defaultRules = [
    {
      id: "collect-file-dir-info",
      label: "收集文件与目录信息",
      enabled: true,
      tool: "exec_command",
      minItems: 2,
      pattern:
        "\\b(?:exec-read-file-pwsh-raw-utf8|exec-read-file|exec-rg-files|exec-list-dir)\\b|读取文件内容|列出文件|列出目录|\\b(?:Get-Content|gc|cat|type|sed\\s+-n|rg\\s+--files|Get-ChildItem|gci|ls|dir)\\b",
      title: "执行组 · 收集文件与目录信息",
      summary: "{count} 个执行节点 · {titles}",
    },
    {
      id: "search-code-context",
      label: "搜索与定位代码",
      enabled: true,
      tool: "exec_command",
      minItems: 2,
      pattern: "\\bexec-search-text\\b|搜索文本|\\b(?:rg|grep|findstr)\\b",
      title: "执行组 · 搜索与定位代码",
      summary: "{count} 个搜索节点 · {titles}",
    },
    {
      id: "inspect-git-state",
      label: "检查 Git 状态与差异",
      enabled: true,
      tool: "exec_command",
      minItems: 2,
      pattern: "\\b(?:exec-git-status|exec-git-diff)\\b|查看 Git 状态|查看 Git 差异|\\bgit\\s+(?:status|diff|show)\\b",
      title: "执行组 · 检查 Git 状态与差异",
      summary: "{count} 个 Git 检查节点 · {titles}",
    },
  ];

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function firstLine(text, max = 160) {
    const normalized = String(text || "").replace(/\s+/g, " ").trim();
    if (!normalized) return "";
    return normalized.length > max ? `${normalized.slice(0, Math.max(1, max - 1))}…` : normalized;
  }

  function normalizeRules(rules) {
    if (!Array.isArray(rules)) return [];
    return rules
      .map((rule, index) => ({
        id: String(rule?.id || `custom-${Date.now()}-${index}`),
        label: String(rule?.label || rule?.title || "执行聚合规则").trim() || "执行聚合规则",
        enabled: rule?.enabled !== false,
        tool: String(rule?.tool || "").trim(),
        minItems: normalizeMinItems(rule?.minItems),
        pattern: String(rule?.pattern || "").trim(),
        title: String(rule?.title || "").trim(),
        summary: String(rule?.summary || "").trim(),
      }))
      .filter((rule) => rule.pattern && rule.label);
  }

  function normalizeMinItems(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 2;
    return Math.max(2, Math.min(30, Math.floor(number)));
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

  function groupExecutionRows(rows, options = {}) {
    const source = Array.isArray(rows) ? rows : [];
    const rules = options.rules || activeRules(options.customRules);
    const entries = [];
    let index = 0;
    while (index < source.length) {
      const first = matchExecutionRow(source[index], { rules });
      if (!first) {
        entries.push({ kind: "row", id: source[index]?.id || `row-${index}`, row: source[index] });
        index += 1;
        continue;
      }

      const streak = [source[index]];
      let cursor = index + 1;
      while (cursor < source.length) {
        const next = matchExecutionRow(source[cursor], { rules });
        if (!next || next.rule.id !== first.rule.id) break;
        if (first.rule.sameDepth !== false && normalizedDepth(source[cursor]) !== normalizedDepth(source[index])) break;
        streak.push(source[cursor]);
        cursor += 1;
      }

      const minItems = normalizeMinItems(first.rule.minItems);
      if (streak.length >= minItems) {
        entries.push(buildGroupEntry(streak, first.rule));
      } else {
        for (const row of streak) entries.push({ kind: "row", id: row?.id || `row-${entries.length}`, row });
      }
      index += streak.length;
    }
    return entries;
  }

  function matchExecutionRow(row, options = {}) {
    const rules = options.rules || activeRules(options.customRules);
    const context = executionRowContext(row);
    for (const rule of rules) {
      if (!toolMatches(rule.tool, context.toolName)) continue;
      const pattern = compilePattern(rule.pattern);
      if (!pattern) continue;
      const match = pattern.exec(context.text);
      if (match) return { rule, context, match };
    }
    return null;
  }

  function buildGroupEntry(rows, rule) {
    const contexts = rows.map(executionRowContext);
    const vars = groupTemplateVars(rows, contexts, rule);
    const title = cleanTemplateOutput(fillTemplate(rule.title || "执行组 · {label}", vars)) || `执行组 · ${rule.label}`;
    const summary = cleanTemplateOutput(fillTemplate(rule.summary || "{count} 个执行节点", vars)) || `${rows.length} 个执行节点`;
    return {
      kind: "group",
      id: `exec-group:${rule.id}:${rows[0]?.id || "start"}:${rows.at(-1)?.id || "end"}:${rows.length}`,
      ruleId: rule.id,
      ruleLabel: rule.label,
      title: firstLine(title, 120),
      summary: firstLine(summary, 240),
      count: rows.length,
      depth: normalizedDepth(rows[0]),
      childIds: rows.map((row) => row?.id).filter(Boolean),
      rows,
    };
  }

  function groupTemplateVars(rows, contexts, rule) {
    const titles = unique(contexts.map((context) => context.readableTitle || context.title).filter(Boolean));
    const tools = unique(contexts.map((context) => context.toolName).filter(Boolean));
    return {
      label: rule.label,
      ruleId: rule.id,
      count: rows.length,
      firstTitle: titles[0] || "",
      lastTitle: titles.at(-1) || "",
      titles: joinPreview(titles, 4),
      tools: joinPreview(tools, 4),
    };
  }

  function joinPreview(values, max) {
    const shown = values.slice(0, max);
    const suffix = values.length > shown.length ? ` +${values.length - shown.length}` : "";
    return `${shown.join(", ")}${suffix}`;
  }

  function executionRowContext(row = {}) {
    const readable = row.readable || {};
    const auditText = (row.auditNodes || [])
      .map((node) =>
        [
          node.id,
          node.type,
          node.title,
          node.summary,
          node.toolName,
          node.status,
          node.riskLevel,
          ...(node.tags || []),
        ]
          .filter(Boolean)
          .join(" "),
      )
      .join("\n");
    const toolName = String(row.toolName || readable.toolName || firstToolName(row) || row.title || "").trim();
    const text = [
      row.id,
      row.traceNodeId,
      row.itemRef,
      row.type,
      row.label,
      row.title,
      row.subtitle,
      row.status,
      toolName,
      readable.title,
      readable.summary,
      readable.command,
      readable.ruleId,
      readable.ruleLabel,
      auditText,
    ]
      .filter(Boolean)
      .join("\n");
    return {
      row,
      toolName,
      title: row.title || "",
      readableTitle: readable.title || "",
      text,
    };
  }

  function firstToolName(row) {
    const node = (row.auditNodes || []).find((candidate) => candidate.toolName);
    return node?.toolName || "";
  }

  function normalizedDepth(row) {
    const depth = Number(row?.depth);
    return Number.isFinite(depth) ? depth : 0;
  }

  function unique(values) {
    return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
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

  const api = {
    activeRules,
    defaultRules: () => clone(defaultRules),
    groupExecutionRows,
    loadCustomRules,
    matchExecutionRow,
    normalizeRules,
    saveCustomRules,
    storageKey,
  };

  globalThis.ExecutionGrouping = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
