{
  const api = window.SessionWorkbench;
  const compactElementId = (...args) => api.compactElementId(...args);
  const formatDate = (...args) => api.formatDate(...args);
  const escapeAttr = (...args) => api.escapeAttr(...args);
  const escapeHtml = (...args) => api.escapeHtml(...args);
  const renderMarkdownTitle = (...args) => api.renderMarkdownTitle(...args);
  const highlight = (...args) => api.highlight(...args);
  const compactNumber = (...args) => api.compactNumber(...args);
  const renderMarkdownMessage = (...args) => api.renderMarkdownMessage(...args);
  const renderCompactMessage = (...args) => api.renderCompactMessage(...args);
  const renderCompactContextEvent = (...args) => api.renderCompactContextEvent(...args);
  const formatTimingDuration = (...args) => api.formatTimingDuration(...args);
  const timingKindLabel = (...args) => api.timingKindLabel(...args);
function renderCompactThread(node, context) {
  const session = node.session || {};
  const depth = Math.min(context.depth ?? 0, 6);
  const path = context.path || "root";
  const targetId = compactElementId("thread", path);
  const name = session.agentNickname || session.title || session.id || "当前会话";
  const role = [session.agentRole, session.model].filter(Boolean).join(" · ");
  const meta = [role, formatDate(session.updatedAt), node.notificationSummary?.label || node.edgeStatus].filter(Boolean).join(" · ");
  const openButton =
    !context.root && session.id
      ? `<button class="ghost-button small" type="button" data-compact-session-id="${escapeAttr(session.id)}">打开会话</button>`
      : "";
  const unavailable = node.unavailable
    ? `<div class="compact-unavailable">子代理详情未载入：${escapeHtml(node.unavailableReason || "未知原因")}</div>`
    : "";
  const report = renderCompactSubagentReport(node.notificationSummary, context.query);
  const turnHtml = (node.turns || [])
    .map((turn, index) => renderCompactTurn(turn, { depth, path: `${path}-turn-${index}`, query: context.query }))
    .join("");
  const childHtml = (node.children || [])
    .map((child, index) => renderCompactThread(child, { depth: depth + 1, path: `${path}-child-${index}`, query: context.query }))
    .join("");

  return `
    <article class="compact-thread${context.root ? " root" : ""}" id="${escapeAttr(targetId)}" tabindex="-1" style="--depth:${depth}">
      <header class="compact-thread-head">
        <span class="compact-thread-line" aria-hidden="true"></span>
        <span class="compact-agent-mark">${context.root ? "R" : "A"}</span>
        <span class="compact-thread-title">
          <strong class="markdown-inline-title">${renderMarkdownTitle(name, context.query)}</strong>
          <em>${highlight(escapeHtml(meta || session.id || ""), context.query)}</em>
        </span>
        ${openButton}
      </header>
      <div class="compact-thread-body">
        ${unavailable}
        ${report}
        ${turnHtml || (!childHtml ? `<div class="compact-empty">没有可展示的用户/助手消息。</div>` : "")}
        ${childHtml ? `<div class="compact-orphans">${childHtml}</div>` : ""}
      </div>
    </article>
  `;
}

function renderCompactSubagentReport(summary, query) {
  if (!summary) return "";
  const meta = [summary.label, formatDate(summary.timestamp), summary.truncated ? `已截断 ${compactNumber(summary.bodyLength || 0)} 字符` : ""]
    .filter(Boolean)
    .join(" · ");
  const rawButton =
    summary.eventIndex != null
      ? `<button class="ghost-button small" type="button" data-compact-event-index="${escapeAttr(String(summary.eventIndex))}">查看原始事件</button>`
      : "";
  const body = summary.body
    ? renderMarkdownMessage(summary.body, query)
    : `<div class="compact-subagent-empty">收到子代理状态通知，未包含可展示正文。</div>`;
  return `
    <section class="compact-subagent-report status-${escapeAttr(summary.state || "unknown")}">
      <div class="compact-subagent-report-head">
        <span class="compact-subagent-report-icon" aria-hidden="true">A</span>
        <span class="compact-subagent-report-title">
          <strong>子代理回报</strong>
          <em>${escapeHtml(meta)}</em>
        </span>
        ${rawButton}
      </div>
      <div class="compact-subagent-report-body">
        ${body}
      </div>
    </section>
  `;
}

function renderCompactTurn(turn, context) {
  const path = context.path || `turn-${turn.turnNumber || 0}`;
  const targetId = compactElementId("turn", path);
  const meta = [turn.status, formatDate(turn.startedAt), turn.completedAt ? `结束 ${formatDate(turn.completedAt)}` : ""]
    .filter(Boolean)
    .join(" · ");
  const users = turn.userMessages?.length
    ? turn.userMessages.map((message, index) => renderCompactMessage("user", "用户", message, context.query, `${path}-user-${index}`)).join("")
    : `<div class="compact-missing">本轮没有可展示的用户输入。</div>`;
  const assistantMessages = compactAssistantMessages(turn);
  const assistant = assistantMessages.length
    ? assistantMessages.map((message, index) => renderCompactMessage("assistant", compactAssistantMessageLabel(message, index, assistantMessages.length), message, context.query, `${path}-assistant-${index}`)).join("")
    : `<div class="compact-missing">本轮没有助手消息。</div>`;
  const contextEvents = contextEventsForTurn(turn)
    .map((event, index) => renderCompactContextEvent(event, context.query, `${path}-compact-${index}`))
    .join("");
  const embeddedSubagents = renderCompactEmbeddedSubagents(turn.embeddedSubagents || [], context.query, compactEmbeddedSubagentTargetId(path));
  const metrics = renderCompactTurnMetrics(turn.metrics);
  const children = (turn.children || [])
    .map((child, index) =>
      renderCompactThread(child, { depth: context.depth + 1, path: `${path}-child-${index}`, query: context.query }),
    )
    .join("");
  return `
    <section class="compact-turn" id="${escapeAttr(targetId)}" tabindex="-1" data-compact-turn-number="${escapeAttr(String(turn.turnNumber || ""))}">
      <div class="compact-turn-head">
        <strong>第 ${escapeHtml(String(turn.turnNumber || ""))} 轮</strong>
        <span>${escapeHtml(meta)}</span>
      </div>
      <div class="compact-message-pair">
        ${users}
        ${assistant}
      </div>
      ${metrics}
      ${contextEvents ? `<div class="compact-system-group">${contextEvents}</div>` : ""}
      ${embeddedSubagents ? `<div class="compact-embedded-subagents">${embeddedSubagents}</div>` : ""}
      ${children ? `<div class="compact-child-group">${children}</div>` : ""}
    </section>
  `;
}

function renderCompactTurnMetrics(metrics = {}) {
  const usage = metrics.endingContextUsage;
  const usagePercent = contextUsagePercent(usage);
  const runtime = metrics.activeRunMs;
  const rows = [
    Number.isFinite(usagePercent)
      ? `<div><span>轮末上下文</span><strong>${escapeHtml(`${usage?.used != null && usage?.limit != null ? `${compactNumber(usage.used)} / ${compactNumber(usage.limit)} · ` : ""}${usagePercent}%`)}</strong></div>`
      : "",
    Number.isFinite(metrics.generatedTokens)
      ? `<div><span>生成 Token</span><strong>${escapeHtml(compactNumber(metrics.generatedTokens))}</strong></div>`
      : "",
    Number.isFinite(runtime) && metrics.executionConfidence !== "unavailable"
      ? `<div title="工具与 LLM 可关联区间的并集"><span>实际执行</span><strong>${escapeHtml(formatTimingDuration(runtime))}</strong>${metrics.executionConfidence !== "observed" && timingKindLabel(metrics.executionConfidence) ? `<em>${escapeHtml(timingKindLabel(metrics.executionConfidence))}</em>` : ""}</div>`
      : "",
  ].filter(Boolean);
  return rows.length ? `<section class="compact-turn-metrics" aria-label="本轮结束指标">${rows.join("")}</section>` : "";
}

function compactEmbeddedSubagentTargetId(path) {
  return compactElementId("embedded-subagents", path);
}

function renderCompactEmbeddedSubagents(batches, query, targetId) {
  if (!batches.length) return "";
  const summary = compactEmbeddedSubagentGroupSummary(batches);
  return `<section class="compact-embedded-subagent-group" id="${escapeAttr(targetId)}" tabindex="-1" aria-label="子代理执行，${escapeAttr(summary)}"><header class="compact-embedded-group-head"><span><strong>子代理执行</strong><em>${escapeHtml(summary)}</em></span></header><ol class="compact-embedded-run-list">${batches.map((batch, index) => renderCompactEmbeddedRun(batch, index, query)).join("")}</ol></section>`;
}

function renderCompactEmbeddedRun(batch, index, query) {
  const status = batch.status || "unknown";
  const eventIndex = batch.outputSourceIndex ?? batch.sourceIndex;
  const rawButton = eventIndex != null
    ? `<button class="ghost-button small compact-embedded-raw" type="button" data-compact-event-index="${escapeAttr(String(eventIndex))}" aria-label="查看第 ${index + 1} 次子代理调用的原始结果事件">原始记录</button>`
    : "";
  const tasks = compactEmbeddedTaskViews(batch);
  const taskRows = tasks.map((task) => renderCompactEmbeddedTask(task, batch, index, query, tasks.length > 1)).join("");
  return `<li class="compact-embedded-run status-${escapeAttr(status)}"><div class="compact-embedded-run-head"><span class="compact-embedded-run-index">调用 ${index + 1}</span><span class="compact-embedded-status">${escapeHtml(compactEmbeddedSubagentStatusLabel(status))}</span>${rawButton}</div><div class="compact-embedded-task-list">${taskRows || `<div class="compact-embedded-empty">本次调用没有可展示任务。</div>`}</div></li>`;
}

function renderCompactEmbeddedTask(task, batch, runIndex, query, showTaskStatus) {
  const status = task.status || batch.status || "unknown";
  const meta = task.exitCode != null && task.exitCode !== 0 ? `退出 ${task.exitCode}` : "";
  const taskTitle = compactEmbeddedTaskTitle(task.task);
  const reportId = `embedded-report-${batch.turnIndex}-${batch.itemIndex}-${task.index}`;
  const report = task.summary
    ? `<div id="${escapeAttr(reportId)}" class="compact-embedded-report">${renderMarkdownMessage(task.summary, query)}</div>`
    : "";
  return `<article class="compact-embedded-task${showTaskStatus ? "" : " single-task"} status-${escapeAttr(status)}">${showTaskStatus ? `<span class="compact-embedded-task-status">${escapeHtml(compactEmbeddedSubagentStatusLabel(status))}</span>` : ""}<div class="compact-embedded-task-body"><div class="compact-embedded-task-main"><strong>${highlight(escapeHtml(task.agent || "未指定代理"), query)}</strong>${taskTitle ? `<span>${highlight(escapeHtml(taskTitle), query)}</span>` : ""}</div>${meta ? `<em>${escapeHtml(meta)}</em>` : ""}${report}</div></article>`;
}

function compactEmbeddedTaskViews(batch) {
  const requested = Array.isArray(batch.requested) ? batch.requested : [];
  const results = Array.isArray(batch.results) ? batch.results : [];
  const resultsByIndex = new Map(results.map((result) => [result.index, result]));
  const indexes = new Set([...requested.map((task) => task.index), ...results.map((task) => task.index)]);
  return [...indexes].sort((left, right) => left - right).map((index) => {
    const request = requested.find((task) => task.index === index) || {};
    const result = resultsByIndex.get(index) || {};
    return { ...request, ...result, index, agent: result.agent || request.agent || "未指定代理", task: request.task || null };
  });
}

function compactEmbeddedSubagentGroupSummary(batches) {
  const counts = new Map();
  for (const batch of batches) counts.set(batch.status || "unknown", (counts.get(batch.status || "unknown") || 0) + 1);
  const outcomes = [...counts.entries()].map(([status, count]) => `${count} ${compactEmbeddedSubagentStatusLabel(status)}`);
  return [`${batches.length} 次调用`, ...outcomes].join(" · ");
}

function compactEmbeddedTaskTitle(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function compactEmbeddedSubagentStatusLabel(status) {
  return ({ succeeded: "成功", failed: "失败", invalid_request: "请求无效", rate_limited: "限流", partial: "部分完成", pending: "等待中", unknown: "结果未知" })[status] || status;
}

function compactEventsForTurn(turn) {
  return Array.isArray(turn?.compactEvents) ? turn.compactEvents : (turn?.items || []).filter((item) => item.type === "context-compact");
}

function contextEventsForTurn(turn) {
  if (Array.isArray(turn?.contextEvents)) return turn.contextEvents;
  return compactEventsForTurn(turn).map((event) => ({ ...event, contextKind: "compaction" }));
}

function compactAssistantMessages(turn) {
  if (Array.isArray(turn?.assistantMessages)) return turn.assistantMessages.filter((message) => String(message?.text || "").trim());
  return turn?.assistantMessage && String(turn.assistantMessage.text || "").trim() ? [turn.assistantMessage] : [];
}

function compactAssistantMessageLabel(message, index, count) {
  if (message?.phase === "final") return count > 1 ? `助手消息 ${index + 1} · 最终` : "助手最终消息";
  return count > 1 ? `助手消息 ${index + 1}` : "助手消息";
}

function contextUsageLabel(usage) {
  const percent = contextUsagePercent(usage);
  if (!Number.isFinite(percent)) return "";
  return `上下文 ${percent}%`;
}

function contextUsagePercent(usage) {
  const percent = Number(usage?.percent);
  if (!Number.isFinite(percent)) return null;
  return Math.max(1, Math.min(100, Math.round(percent)));
}

function contextUsageLevel(usage) {
  const percent = contextUsagePercent(usage);
  if (!Number.isFinite(percent)) return "";
  return percent > 70 ? "high" : "normal";
}

function renderContextUsageBadge(usage) {
  const label = contextUsageLabel(usage);
  if (!label) return "";
  const level = contextUsageLevel(usage);
  const detail = [usage?.used != null && usage?.limit != null ? `${compactNumber(usage.used)} / ${compactNumber(usage.limit)} tokens` : "", level === "high" ? "超过 70%" : ""]
    .filter(Boolean)
    .join(" · ");
  return `<strong class="context-usage-badge level-${escapeAttr(level)}" title="${escapeAttr(detail || label)}">${escapeHtml(label)}</strong>`;
}

function renderCompressionRefBadge(refs = []) {
  const valid = Array.isArray(refs) ? refs.filter(Boolean) : [];
  if (!valid.length) return "";
  const first = valid[0];
  const eventIndexes = [...new Set(valid.map((ref) => ref.eventIndex).filter((value) => value != null))];
  const label = `被替换 ${valid.length} 条`;
  const suffix = eventIndexes.length === 1 ? ` · 事件 ${eventIndexes[0]}` : eventIndexes.length > 1 ? ` · ${eventIndexes.length} 个事件` : "";
  const detail = [
    `当前消息组被替换 ${valid.length} 条`,
    first.compactTurnNumber ? `压缩发生在第 ${first.compactTurnNumber} 轮` : "",
    eventIndexes.length ? `事件 ${eventIndexes.join(", ")}` : "",
    first.replacementIndex != null ? `替换记录 ${first.replacementIndex}` : "",
    first.windowNumber != null ? `窗口 ${first.windowNumber}` : "",
    first.replacementItemType ? `关联项 ${first.replacementItemType}` : "",
    first.replacementRole ? `角色 ${first.replacementRole}` : "",
    formatDate(first.timestamp),
    first.summaryPreview,
  ]
    .filter(Boolean)
    .join(" · ");
  const content = `${label}${suffix}`;
  if (first.eventIndex != null) {
    return `<button class="compression-ref-badge" type="button" title="${escapeAttr(detail || content)}" data-compact-ref-event-index="${escapeAttr(String(first.eventIndex))}">${escapeHtml(content)}</button>`;
  }
  return `<strong class="compression-ref-badge" title="${escapeAttr(detail || content)}">${escapeHtml(content)}</strong>`;
}

  Object.assign(api, { renderCompactThread, renderCompactSubagentReport, renderCompactTurn, renderCompactTurnMetrics, compactEmbeddedSubagentTargetId, renderCompactEmbeddedSubagents, renderCompactEmbeddedRun, renderCompactEmbeddedTask, compactEmbeddedTaskViews, compactEmbeddedSubagentGroupSummary, compactEmbeddedTaskTitle, compactEmbeddedSubagentStatusLabel, compactEventsForTurn, contextEventsForTurn, compactAssistantMessages, compactAssistantMessageLabel, contextUsageLabel, contextUsagePercent, contextUsageLevel, renderContextUsageBadge, renderCompressionRefBadge });
}
