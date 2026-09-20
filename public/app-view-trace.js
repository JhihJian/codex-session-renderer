{
  const api = window.SessionWorkbench;
  const { state, els } = api;
  const emptyState = (...args) => api.emptyState(...args);
  const maxNodeDuration = (...args) => api.maxNodeDuration(...args);
  const escapeHtml = (...args) => api.escapeHtml(...args);
  const selectTraceNode = (...args) => api.selectTraceNode(...args);
  const toggleTraceNode = (...args) => api.toggleTraceNode(...args);
  const firstLine = (...args) => api.firstLine(...args);
  const formatDuration = (...args) => api.formatDuration(...args);
  const escapeAttr = (...args) => api.escapeAttr(...args);
  const traceIcon = (...args) => api.traceIcon(...args);
  const readableToolItem = (...args) => api.readableToolItem(...args);
  const prettyMaybeJson = (...args) => api.prettyMaybeJson(...args);
  const formatDate = (...args) => api.formatDate(...args);
function renderTrace() {
  const detail = state.detail;
  if (!detail?.trace?.root) {
    els.traceContent.innerHTML = emptyState("没有执行链路数据", "当前会话没有可展示的执行树。");
    return;
  }
  const query = els.itemSearch.value.trim().toLowerCase();
  const typeFilter = els.itemTypeFilter.value;
  const root = filterTraceNode(detail.trace.root, query, typeFilter);
  if (!root) {
    els.traceContent.innerHTML = emptyState("没有匹配的执行节点", "调整搜索或类型过滤。");
    return;
  }
  const maxDuration = Math.max(1, detail.trace.timing?.durationMs || root.durationMs || maxNodeDuration(root));
  els.traceContent.innerHTML = `
    <div class="trace-shell">
      <div class="trace-head">
        <div>
          <p class="eyebrow">执行过程</p>
          <p class="trace-session-title" data-overflow-tooltip>${escapeHtml(detail.session.title || "未命名会话")}</p>
        </div>
        <div class="trace-legend">
          <span><i class="legend-dot agent"></i>子代理</span>
          <span><i class="legend-dot tool"></i>工具</span>
          <span><i class="legend-dot llm"></i>模型回复</span>
        </div>
      </div>
      <div class="trace-tree">${renderTraceNode(root, { maxDuration, depth: 0 })}</div>
    </div>
  `;
  els.traceContent.querySelectorAll("[data-trace-node-id]").forEach((button) => {
    button.addEventListener("click", () => selectTraceNode(button.dataset.traceNodeId));
  });
  els.traceContent.querySelectorAll("[data-trace-toggle-id]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleTraceNode(button.dataset.traceToggleId);
    });
  });
}

function filterTraceNode(node, query, typeFilter) {
  const children = (node.children || []).map((child) => filterTraceNode(child, query, typeFilter)).filter(Boolean);
  const haystack = traceSearchText(node);
  const matchesQuery = !query || haystack.includes(query);
  const matchesType = traceNodeMatchesType(node, typeFilter);
  const visibleByDefault = query || typeFilter !== "all" || isDefaultTraceNode(node);
  if ((matchesQuery && matchesType && visibleByDefault) || children.length > 0 || node.type === "thread") {
    return { ...node, children };
  }
  return null;
}

function isDefaultTraceNode(node) {
  return ["thread", "turn", "tool", "handoff", "subagent", "embedded-subagent", "embedded-subagent-task", "lazy-child", "response", "gap"].includes(node.type);
}

function traceNodeMatchesType(node, typeFilter) {
  if (typeFilter === "message") return node.type === "message";
  if (typeFilter === "tool") return node.type === "tool" || node.type === "handoff" || node.type === "subagent" || node.type === "embedded-subagent" || node.type === "embedded-subagent-task";
  if (typeFilter === "output") return Boolean(node.detail?.item?.output);
  if (typeFilter === "reasoning") return node.type === "reasoning";
  if (typeFilter === "system") return node.type === "event" || node.type === "metric" || node.type === "turn" || node.type === "thread" || node.type === "response" || node.type === "gap";
  if (typeFilter === "error") return /error|failed|失败|错误/i.test(traceSearchText(node));
  return true;
}

function traceSearchText(node) {
  const detail = node.detail || {};
  const item = detail.item || {};
  const thread = detail.thread || detail.edge?.thread || {};
  const parts = [
    node.id,
    node.type,
    node.label,
    node.title,
    node.subtitle,
    node.status,
    node.threadId,
    item.type,
    item.name,
    item.phase,
    item.status,
    firstLine(item.text || "", 220),
    firstLine(item.arguments || "", 220),
    firstLine(item.output || "", 220),
    thread.id,
    thread.title,
    thread.agentNickname,
    thread.agentRole,
    detail.task?.agent,
    detail.task?.task,
    detail.task?.summary,
  ];
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function renderTraceNode(node, context) {
  const selected = node.id === state.selectedTraceNodeId ? " selected" : "";
  const depth = Math.min(context.depth ?? 0, 8);
  const hasDuration = Number.isFinite(node.durationMs);
  const durationLabel = hasDuration ? formatDuration(node.durationMs) : "";
  const width = hasDuration ? Math.max(2, Math.min(100, (node.durationMs / context.maxDuration) * 100)) : 0;
  const children = node.children || [];
  const expanded = state.expandedTraceNodeIds.has(node.id);
  const item = fullTraceItem(node);
  const isTool = item?.type === "tool-call" || node.type === "tool" || node.type === "handoff";
  const title = isTool ? traceToolTitle(item, node) : node.title || "";
  const argumentPreview = isTool ? traceArgumentPreview(item) : "";
  const contextMetrics = traceContextMetrics(node);
  const contextSummary = renderTraceContextSummary(contextMetrics);
  // 轮次是回放中的容器节点，生命周期状态没有实时含义；右侧固定展示执行耗时。
  const statusValue = node.type === "turn" ? null : node.status || item?.status || null;
  return `
    <div class="trace-node" style="--depth:${depth}">
      <button class="trace-row${hasDuration ? " has-duration" : ""}${contextSummary ? " has-context" : ""}${selected}" type="button" data-trace-node-id="${escapeAttr(node.id)}">
        <span class="trace-indent" aria-hidden="true"></span>
        ${
          children.length
            ? `<span class="trace-expander" role="button" data-trace-toggle-id="${escapeAttr(node.id)}">${expanded ? "⌄" : "›"}</span>`
            : `<span class="trace-expander"></span>`
        }
        <span class="trace-icon ${escapeAttr(node.icon || node.type)}">${traceIcon(node)}</span>
        <span class="trace-main">
          <span class="trace-label" data-overflow-tooltip>${escapeHtml(node.label || node.type)}</span>
          <span class="trace-title" data-overflow-tooltip>${escapeHtml(title)}</span>
          ${argumentPreview ? `<span class="trace-arguments" data-overflow-tooltip title="${escapeAttr(argumentPreview)}">${escapeHtml(argumentPreview)}</span>` : ""}
          ${renderTraceResultMetrics(contextMetrics)}
        </span>
        ${statusValue ? `<span class="trace-status status-${escapeAttr(traceStatusKind(statusValue))}" data-overflow-tooltip>${escapeHtml(traceStatusLabel(statusValue))}</span>` : ""}
        ${hasDuration ? `<span class="trace-duration" data-overflow-tooltip>${escapeHtml(durationLabel)}</span>${contextSummary}<span class="trace-bar" aria-hidden="true"><i style="width:${width}%"></i></span>` : ""}
      </button>
      ${children.length && expanded ? `<div class="trace-children">${children.map((child) => renderTraceNode(child, { ...context, depth: depth + 1 })).join("")}</div>` : ""}
    </div>
  `;
}

function traceContextMetrics(node) {
  const metrics = node.detail?.contextMetrics;
  if (metrics) return metrics;
  const response = node.detail?.response;
  if (!response || !Number.isFinite(response.contextPercent)) return null;
  return {
    source: "recorded",
    usage: {
      percent: response.contextPercent,
      ...(Number.isFinite(response.contextUsed) ? { used: response.contextUsed } : {}),
      ...(Number.isFinite(response.contextLimit) ? { limit: response.contextLimit } : {}),
    },
    resultTokens: response.generatedTokens,
    resultTokenKind: Number.isFinite(response.generatedTokens) ? "recorded" : null,
    changePercent: null,
  };
}

function renderTraceResultMetrics(metrics) {
  if (!metrics || (!Number.isFinite(metrics.resultTokens) && !Number.isFinite(metrics.usage?.percent))) return "";
  const tokens = Number.isFinite(metrics.resultTokens)
    ? `<span title="${escapeAttr(`${metrics.resultTokenKind === "estimated" ? "估算" : "记录"}返回 token`)}">返 ${escapeHtml(formatTraceTokenCount(metrics.resultTokens))} tok</span>`
    : "";
  return tokens ? `<span class="trace-result-metrics">${tokens}</span>` : "";
}

function renderTraceContextSummary(metrics) {
  if (!metrics || !Number.isFinite(metrics.usage?.percent)) return "";
  const usage = Number.isFinite(metrics.usage?.percent)
    ? `<span title="${escapeAttr(traceContextUsageTitle(metrics))}">上下文 ${escapeHtml(formatTraceContextPercent(metrics.usage.percent))}（${escapeHtml(traceContextSourceLabel(metrics.source))}）</span>`
    : "";
  const change = Number.isFinite(metrics.changePercent)
    ? `<span class="trace-context-change ${metrics.changePercent < 0 ? "decrease" : "increase"}">${escapeHtml(formatTraceContextChange(metrics.changePercent))}</span>`
    : "";
  return `<span class="trace-context-summary">${usage}${change}</span>`;
}

function traceContextUsageTitle(metrics) {
  const usage = metrics.usage || {};
  const values = [
    metrics.source === "estimated" ? "基于工具返回 token 的上下文估算" : metrics.source === "model-estimated" ? "基于模型定义窗口与 LLM 输入 token 的上下文估算" : "LLM 结束时记录的上下文快照",
    Number.isFinite(usage.used) && Number.isFinite(usage.limit) ? `${formatTraceTokenCount(usage.used)} / ${formatTraceTokenCount(usage.limit)} tok` : "",
  ].filter(Boolean);
  return values.join(" · ");
}

function traceContextSourceLabel(source) {
  if (source === "estimated") return "估算";
  if (source === "model-estimated") return "模型估算";
  return "记录";
}

function formatTraceTokenCount(value) {
  if (!Number.isFinite(value)) return "";
  if (value >= 1_000_000) return `${Math.round((value / 1_000_000) * 10) / 10}M`;
  if (value >= 1_000) return `${Math.round((value / 1_000) * 10) / 10}K`;
  return String(Math.round(value));
}

function formatTraceContextPercent(value) {
  return `${Math.round(value * 10) / 10}%`;
}

function formatTraceContextChange(value) {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded >= 0 ? "+" : ""}${rounded}%`;
}

function traceToolTitle(item, node) {
  const readable = readableToolItem(item);
  return readable.matched ? readable.title : item?.name || node.title || "工具调用";
}

function fullTraceItem(node) {
  const compact = node?.detail?.item;
  if (!compact) return null;
  const match = String(node.id || "").match(/^item:(\d+):(\d+):/);
  if (!match) return compact;
  return state.detail?.turns?.[Number(match[1])]?.items?.[Number(match[2])] || compact;
}

function traceArgumentPreview(item) {
  if (!item?.arguments) return "";
  const value = prettyMaybeJson(item.arguments).replace(/\s+/g, " ").trim();
  return value.length > 180 ? `${value.slice(0, 180)}...` : value;
}

function traceStatusKind(status) {
  const value = String(status || "").toLowerCase();
  if (["failed", "error", "aborted", "cancelled", "canceled"].includes(value)) return "failed";
  if (["completed", "succeeded", "success", "done"].includes(value)) return "success";
  if (["started", "running", "in_progress"].includes(value)) return "running";
  if (value === "waiting") return "waiting";
  if (value === "pending") return "pending";
  return "unknown";
}

function traceStatusLabel(status) {
  const kind = traceStatusKind(status);
  if (kind === "success") return "执行成功";
  if (kind === "failed") return "执行失败";
  if (kind === "running") return "执行中";
  if (kind === "waiting") return "等待输入";
  if (kind === "pending") return "等待执行";
  if (String(status || "").toLowerCase() === "open") return "记录未闭合";
  return status ? String(status) : "";
}

function renderToolDetails(node = null) {
  if (!els.toolDetailsContent) return;
  if (!node) {
    els.toolDetailsContent.hidden = true;
    els.toolDetailsContent.innerHTML = emptyState("选择一个执行节点", "点击执行过程中的工具调用，查看参数和返回结果。");
    return;
  }
  els.toolDetailsContent.hidden = false;
  const item = fullTraceItem(node);
  const task = node.detail?.task;
  const detail = node.detail || {};
  const isTool = item?.type === "tool-call" || node.type === "tool" || node.type === "handoff";
  const title = item?.name || node.title || node.label || "执行节点";
  const argumentsText = item?.arguments
    ? prettyMaybeJson(item.arguments)
    : detail.response
      ? prettyMaybeJson(detail.response)
      : detail.note || task?.task || "";
  const outputText = item?.output == null || item.output === "" ? "" : String(item.output);
  // 轮次状态多为回放投影产物（如“执行中”），详情面板同样不展示，避免误导。
  const statusValue = node.type === "turn" ? null : node.status || item?.status || task?.status;
  const status = traceStatusLabel(statusValue);
  const metadata = [formatDate(node.timestamp), node.durationMs != null ? formatDuration(node.durationMs) : ""].filter(Boolean).join(" · ");
  const contextMetrics = traceContextMetrics(node);
  els.toolDetailsContent.innerHTML = `
    <div class="tool-details-head">
      <span class="tool-details-icon ${escapeAttr(node.icon || node.type)}">${traceIcon(node)}</span>
      <div><p class="eyebrow">${escapeHtml(node.label || "执行节点")}</p><h3>${escapeHtml(title)}</h3>${status ? `<span class="tool-details-status status-${escapeAttr(traceStatusKind(statusValue))}">${escapeHtml(status)}</span>` : ""}</div>
    </div>
    ${metadata ? `<div class="tool-details-meta">${escapeHtml(metadata)}</div>` : ""}
    ${renderTraceContextDetails(contextMetrics)}
    ${argumentsText ? `<section class="tool-details-section"><h4>${isTool ? "调用参数" : "节点信息"}</h4><pre>${escapeHtml(argumentsText)}</pre></section>` : ""}
    ${outputText ? `<section class="tool-details-section"><h4>返回结果</h4><pre>${escapeHtml(outputText)}</pre></section>` : ""}
  `;
}

function renderTraceContextDetails(metrics) {
  if (!metrics || (!Number.isFinite(metrics.resultTokens) && !Number.isFinite(metrics.usage?.percent))) return "";
  const usage = metrics.usage || {};
  const values = [
    Number.isFinite(metrics.resultTokens) ? ["返回 token", `${metrics.resultTokenKind === "estimated" ? "估算 " : ""}${formatTraceTokenCount(metrics.resultTokens)} tok`] : null,
    Number.isFinite(usage.percent) ? ["上下文占用", `${Number.isFinite(usage.used) && Number.isFinite(usage.limit) ? `${formatTraceTokenCount(usage.used)} / ${formatTraceTokenCount(usage.limit)} · ` : ""}${formatTraceContextPercent(usage.percent)}（${traceContextSourceLabel(metrics.source)}）`] : null,
    Number.isFinite(metrics.changePercent) ? ["上下文变化", formatTraceContextChange(metrics.changePercent)] : null,
  ].filter(Boolean);
  return `<section class="trace-context-details"><h4>上下文指标</h4><div>${values.map(([label, value]) => `<span><em>${escapeHtml(label)}</em><strong>${escapeHtml(value)}</strong></span>`).join("")}</div></section>`;
}

  Object.assign(api, { renderTrace, filterTraceNode, isDefaultTraceNode, traceNodeMatchesType, traceSearchText, renderTraceNode, traceContextMetrics, renderTraceResultMetrics, renderTraceContextSummary, traceContextUsageTitle, traceContextSourceLabel, formatTraceTokenCount, formatTraceContextPercent, formatTraceContextChange, traceToolTitle, fullTraceItem, traceArgumentPreview, traceStatusKind, traceStatusLabel, renderToolDetails, renderTraceContextDetails });
}
