{
  const commonJsParts = typeof module !== "undefined" && module.exports
    ? {
        rules: require("./tool-summary-rules.js"),
        text: require("./tool-summary-text.js"),
        patch: require("./tool-summary-patch.js"),
        commandOutput: require("./tool-summary-command-output.js"),
      }
    : {};
  const parts = globalThis.ToolSummaryInternals || commonJsParts;
  const { rules, text, patch, commandOutput } = parts;
  if (!rules || !text || !patch || !commandOutput) throw new Error("ToolSummary dependencies must load before the facade.");

  const {
    activeRules,
    clone,
    defaultRules,
    findRuleMatch,
    loadCustomRules,
    normalizeRules,
    saveCustomRules,
    storageKey,
    validateRulesForSave,
  } = rules;
  const {
    cleanTemplateOutput,
    extractArgumentPath,
    extractCommand,
    extractCommandPath,
    extractQuery,
    fallbackItemTitle,
    fillTemplate,
    firstLine,
    parseMaybeJson,
    readableOutputSummary,
  } = text;
  const { displayPatchFilePath, extractChangeSet, extractPatchFiles, formatPatchSummary, patchBodyModel } = patch;
  const { commandOutputModel } = commandOutput;

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
      const values = [op.summary || op.command, output ? readableOutputSummary(output, "验证输出", 120) : ""].filter(Boolean);
      return {
        ...op,
        title: op.title,
        summary: firstLine(values.join(" · "), 240),
        body: firstLine(values.join("\n"), 700),
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
        fallbackTitle: event?.title || event?.kind || event?.type || "原始事件",
      },
    );
  }

  function summarizeToolContext(input, options = {}) {
    const context = extractContext(input);
    const matched = findRuleMatch(options.rules || activeRules(options.customRules), context);
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
    };
    for (const [index, value] of matched.match.entries()) vars[`match${index}`] = value || "";
    if (matched.match.groups) {
      for (const [key, value] of Object.entries(matched.match.groups)) vars[key] = value || "";
    }
    const title = cleanTemplateOutput(fillTemplate(matched.rule.title, vars)) || fallbackTitle;
    const summary = cleanTemplateOutput(fillTemplate(matched.rule.summary, { ...vars, title })) || context.path || context.query || firstLine(context.command || context.argumentText || context.summary, 220);
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

  function extractContext(input = {}) {
    const toolName = String(input.toolName || "").trim();
    const args = input.arguments ?? "";
    const parsedArgs = parseMaybeJson(args);
    const argumentText = typeof args === "string" ? args : JSON.stringify(args ?? "");
    const command = extractCommand(parsedArgs, argumentText, toolName);
    const output = input.output == null ? "" : String(input.output);
    const summary = input.summary == null ? "" : String(input.summary);
    const path = extractArgumentPath(parsedArgs) || extractCommandPath(command, toolName) || "";
    const query = extractQuery(command, parsedArgs, summary, toolName) || "";
    const changeSet = extractChangeSet(argumentText, output, toolName);
    const patchFiles = changeSet.files.length ? changeSet.files.map(displayPatchFilePath).slice(0, 4).join(", ") : extractPatchFiles(argumentText, output);
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
      patchSummary: formatPatchSummary(changeSet) || patchFiles,
      changeSet,
    };
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
    validateRulesForSave,
  };

  globalThis.ToolSummary = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
}