{
  const text = globalThis.ToolSummaryInternals?.text;
  if (!text) throw new Error("ToolSummary text helpers must load before command output helpers.");
  const { cleanPatchPath, extractCommand, firstLine, parseMaybeJson, primaryCommand, stripShellWrapper } = text;

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
      const match = line.match(/^(.+?)(?::|-)(\d+)(?::(\d+))?[:-](.*)$/);
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

  const parts = globalThis.ToolSummaryInternals || (globalThis.ToolSummaryInternals = {});
  parts.commandOutput = { commandOutputModel };
  if (typeof module !== "undefined" && module.exports) module.exports = parts.commandOutput;
}
