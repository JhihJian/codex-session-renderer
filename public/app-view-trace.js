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
          <span><i class="legend-dot estimated"></i>估算时间</span>
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
  return ["thread", "turn", "tool", "handoff", "subagent", "embedded-subagent", "embedded-subagent-task", "lazy-child"].includes(node.type);
}

function traceNodeMatchesType(node, typeFilter) {
  if (typeFilter === "message") return node.type === "message";
  if (typeFilter === "tool") return node.type === "tool" || node.type === "handoff" || node.type === "subagent" || node.type === "embedded-subagent" || node.type === "embedded-subagent-task";
  if (typeFilter === "output") return Boolean(node.detail?.item?.output);
  if (typeFilter === "reasoning") return node.type === "reasoning";
  if (typeFilter === "system") return node.type === "event" || node.type === "metric" || node.type === "turn" || node.type === "thread";
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
  return `
    <div class="trace-node" style="--depth:${depth}">
      <button class="trace-row${hasDuration ? " has-duration" : ""}${selected}" type="button" data-trace-node-id="${escapeAttr(node.id)}">
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
        </span>
        ${node.status || item?.status ? `<span class="trace-status status-${escapeAttr(traceStatusKind(node.status || item?.status))}" data-overflow-tooltip>${escapeHtml(traceStatusLabel(node.status || item?.status))}</span>` : ""}
        ${hasDuration ? `<span class="trace-duration" data-overflow-tooltip>${escapeHtml(durationLabel)}${node.durationEstimated ? " · 估算" : ""}</span><span class="trace-bar" aria-hidden="true"><i style="width:${width}%"></i></span>` : ""}
      </button>
      ${children.length && expanded ? `<div class="trace-children">${children.map((child) => renderTraceNode(child, { ...context, depth: depth + 1 })).join("")}</div>` : ""}
    </div>
  `;
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
  const isTool = item?.type === "tool-call" || node.type === "tool" || node.type === "handoff";
  const title = item?.name || node.title || node.label || "执行节点";
  const argumentsText = item?.arguments ? prettyMaybeJson(item.arguments) : task?.task || "";
  const outputText = item?.output == null || item.output === "" ? "" : String(item.output);
  const statusValue = node.status || item?.status || task?.status;
  const status = traceStatusLabel(statusValue);
  const metadata = [formatDate(node.timestamp), node.durationMs != null ? formatDuration(node.durationMs) : ""].filter(Boolean).join(" · ");
  els.toolDetailsContent.innerHTML = `
    <div class="tool-details-head">
      <span class="tool-details-icon ${escapeAttr(node.icon || node.type)}">${traceIcon(node)}</span>
      <div><p class="eyebrow">${escapeHtml(node.label || "执行节点")}</p><h3>${escapeHtml(title)}</h3>${status ? `<span class="tool-details-status status-${escapeAttr(traceStatusKind(statusValue))}">${escapeHtml(status)}</span>` : ""}</div>
    </div>
    ${metadata ? `<div class="tool-details-meta">${escapeHtml(metadata)}</div>` : ""}
    ${argumentsText ? `<section class="tool-details-section"><h4>${isTool ? "调用参数" : "节点信息"}</h4><pre>${escapeHtml(argumentsText)}</pre></section>` : ""}
    ${outputText ? `<section class="tool-details-section"><h4>返回结果</h4><pre>${escapeHtml(outputText)}</pre></section>` : ""}
  `;
}

  Object.assign(api, { renderTrace, filterTraceNode, isDefaultTraceNode, traceNodeMatchesType, traceSearchText, renderTraceNode, traceToolTitle, fullTraceItem, traceArgumentPreview, traceStatusKind, traceStatusLabel, renderToolDetails });
}
