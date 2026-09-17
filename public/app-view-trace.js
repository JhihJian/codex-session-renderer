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

function itemMatches(item, query, typeFilter) {
  const haystack = JSON.stringify(item).toLowerCase();
  if (query && !haystack.includes(query)) return false;
  if (typeFilter === "message") return item.type === "user-message" || item.type === "assistant-message";
  if (typeFilter === "tool") return item.type === "tool-call" || item.type === "response-item";
  if (typeFilter === "output") return item.type === "tool-output" || (item.type === "tool-call" && item.output);
  if (typeFilter === "reasoning") return item.type === "reasoning";
  if (typeFilter === "compact") return item.type === "context-compact";
  if (typeFilter === "system") return item.type === "event" || item.type === "token-count" || item.type === "context-compact";
  if (typeFilter === "error") return /error|failed|失败|错误/i.test(haystack);
  return true;
}

function renderTurn(turn, index, query) {
  const meta = [turn.status, formatDate(turn.startedAt), turn.cwd ? shortPath(turn.cwd) : ""].filter(Boolean).join(" · ");
  return `
    <article class="turn">
      <div class="turn-header">
        <strong>第 ${index} 轮</strong>
        <span>${escapeHtml(meta)}</span>
      </div>
      <div class="turn-body">
        ${turn.items.map((item) => renderItem(item, query)).join("")}
      </div>
    </article>
  `;
}

function renderItem(item, query) {
  const title = itemTitle(item);
  const icon = itemIcon(item);
  const meta = [formatDate(item.timestamp), item.phase, item.status].filter(Boolean).join(" · ");
  const ref = itemRef(item);
  const selected = state.selectedItemRef === ref ? " selected" : "";
  return `
    <section class="item ${escapeAttr(item.type)}${selected}" role="button" tabindex="0" data-item-ref="${escapeAttr(ref)}">
      <div class="item-header">
        <div class="item-title">
          <span class="item-icon">${icon}</span>
          <span>${escapeHtml(title)}</span>
        </div>
        <span class="item-meta">${escapeHtml(meta)}</span>
      </div>
      <div class="item-content">
        ${renderItemContent(item, query)}
      </div>
    </section>
  `;
}

function renderItemContent(item, query) {
  if (item.type === "user-message" || item.type === "assistant-message") {
    return renderMarkdownMessage(item.text, query);
  }
  if (item.type === "context-compact") {
    return `
      ${renderCompactContextMeta(item.compact || {})}
      ${item.text ? renderMarkdownMessage(item.text, query) : `<div class="compact-missing">压缩完成事件没有携带摘要正文。</div>`}
      ${renderTruncationNotice(item, ["text", "payload"])}
    `;
  }
  if (item.type === "reasoning") {
    const text = item.text || (item.encrypted ? "推理内容已加密存储，当前没有可展示的明文摘要。" : "无摘要。");
    return renderMarkdownMessage(text, query);
  }
  if (item.type === "tool-call") {
    const args = item.arguments == null ? "" : prettyMaybeJson(item.arguments);
    const output = item.output == null ? "" : String(item.output);
    return `
      <div class="tool-grid">
        <div>
          <p class="tool-label">调用</p>
          <pre class="json-block">${highlight(escapeHtml(args || item.name || ""), query)}</pre>
        </div>
        ${
          output
            ? `<div><p class="tool-label">输出</p><pre class="code-block">${highlight(escapeHtml(output), query)}</pre></div>`
            : ""
        }
      </div>
      ${renderTruncationNotice(item, ["arguments", "output"])}
    `;
  }
  if (item.type === "tool-output") {
    return `<pre class="code-block">${highlight(escapeHtml(String(item.output || "")), query)}</pre>${renderTruncationNotice(item, ["output"])}`;
  }
  const fallback = item.payloadPreview || JSON.stringify(item.info || item, null, 2);
  return `<pre class="json-block">${highlight(escapeHtml(fallback), query)}</pre>${renderTruncationNotice(item, ["payload"])}`;
}

function terminalVisibleFieldsForBlock(block) {
  if (block.role === "user" || block.role === "assistant") return ["text"];
  if (block.role === "tool") return ["arguments"];
  if (block.role === "output" || block.role === "error") return ["output"];
  return ["text", "arguments", "output", "payload"];
}

function renderTruncationNotice(item, visibleFields = null) {
  if (!item.truncated) return "";
  const fields = item.truncatedFields?.filter((field) => !visibleFields || visibleFields.includes(field)) || [];
  if (!fields.length) return "";
  return `<div class="truncation-notice">已截断 ${escapeHtml(fields.join(", "))}，完整内容可在原始事件视图中按需查看。</div>`;
}

async function selectRawEvent(index) {
  state.selectedTraceNodeId = null;
  state.selectedItemRef = null;
  state.selectedTerminalBlockId = null;
  state.selectedEventIndex = index;
}

function selectTraceNode(id) {
  const node = findTraceNode(state.detail?.trace?.root, id);
  if (!node) return;
  state.selectedTraceNodeId = id;
  const showDetails = node.type !== "thread";
  state.selectedDetailsNodeId = showDetails ? id : null;
  state.selectedEventIndex = null;
  state.selectedItemRef = null;
  renderTrace();
  renderToolDetails(showDetails ? node : null);
}

function selectItemRef(ref) {
  if (!findItemByRef(ref)) return;
  state.selectedItemRef = ref;
  state.selectedTraceNodeId = null;
}

function toggleTraceNode(id) {
  if (state.expandedTraceNodeIds.has(id)) {
    state.expandedTraceNodeIds.delete(id);
  } else {
    state.expandedTraceNodeIds.add(id);
  }
  renderTrace();
}

function countItems(type) {
  return state.detail?.turns.reduce((count, turn) => count + turn.items.filter((item) => item.type === type).length, 0) ?? 0;
}

function latestTokenUsage(turns) {
  const tokenItems = turns.flatMap((turn) => turn.items).filter((item) => item.type === "token-count");
  const last = tokenItems.at(-1);
  return last?.info?.total_token_usage || last?.info?.last_token_usage || null;
}

function findTraceNode(node, id) {
  if (!node) return null;
  if (node.id === id) return node;
  for (const child of node.children || []) {
    const found = findTraceNode(child, id);
    if (found) return found;
  }
  return null;
}

function traceNodePreview(node) {
  const detail = node.detail || {};
  const item = detail.item ? compactTraceItem(detail.item) : undefined;
  return {
    id: node.id,
    type: node.type,
    label: node.label,
    title: node.title,
    status: node.status,
    timestamp: node.timestamp,
    completedAt: node.completedAt,
    durationMs: node.durationMs,
    durationEstimated: node.durationEstimated,
    lazy: node.lazy || false,
    threadId: node.threadId || null,
    detail: {
      ...detail,
      item,
    },
  };
}

function sensitiveCopyToast(prefix) {
  return `${prefix}；可能包含会话正文、路径、命令参数、命令输出或原始内容，请谨慎分享`;
}

function compactTraceItem(item) {
  return item;
}

function traceNodeLabel(node) {
  return `${node.type} · ${node.label || node.title || node.id}`;
}

function maxNodeDuration(node) {
  return Math.max(node.durationMs || 0, ...(node.children || []).map(maxNodeDuration));
}

function traceIcon(node) {
  if (node.icon === "agent") return "A";
  if (node.icon === "tool") return "ƒ";
  if (node.icon === "handoff") return "↗";
  if (node.icon === "turn") return "T";
  if (node.icon === "thread") return "R";
  if (node.icon === "user") return "U";
  if (node.icon === "assistant") return "C";
  if (node.icon === "reasoning") return "R";
  if (node.icon === "metric") return "#";
  return "•";
}

function formatDuration(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value)) return "";
  if (value < 1000) return `${Math.round(value)} ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)} s`;
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.round((value % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function summaryRuleOptions() {
  return { customRules: state.summaryRules };
}

function readableToolItem(item) {
  if (!item || !window.ToolSummary) {
    return { matched: false, title: item?.name || item?.type || "", summary: "", body: "", command: "" };
  }
  return window.ToolSummary.summarizeToolItem(item, summaryRuleOptions());
}

function itemTitle(item) {
  if (item.type === "user-message") return "用户消息";
  if (item.type === "assistant-message") return item.phase === "final" ? "助手最终回复" : "助手消息";
  if (item.type === "tool-call") return item.name ? `工具调用 · ${item.name}` : "工具调用";
  if (item.type === "tool-output") return "工具输出";
  if (item.type === "reasoning") return "推理摘要";
  if (item.type === "token-count") return "上下文占用统计";
  if (item.type === "context-compact") return item.compact?.kind === "context_compacted" ? "上下文压缩完成" : "上下文压缩摘要";
  return item.eventType || item.responseType || item.type;
}

function itemRef(item) {
  return `${item.turnIndex ?? "x"}:${item.itemIndex ?? item.id ?? "x"}:${item.type || "item"}`;
}

function findItemByRef(ref) {
  for (const turn of state.detail?.turns || []) {
    for (const item of turn.items || []) {
      if (itemRef(item) === ref) return item;
    }
  }
  return null;
}

function itemDebugPreview(item) {
  return {
    ref: itemRef(item),
    title: itemTitle(item),
    ...item,
    text: item.text,
    arguments: item.arguments,
    output: item.output,
    payloadPreview: item.payloadPreview,
  };
}

function itemIcon(item) {
  if (item.type === "user-message") return "U";
  if (item.type === "assistant-message") return "A";
  if (item.type === "tool-call") return ">";
  if (item.type === "tool-output") return "$";
  if (item.type === "reasoning") return "R";
  if (item.type === "token-count") return "#";
  if (item.type === "context-compact") return "C";
  return "i";
}

function eventForItem(item, byIndex) {
  if (!item) return null;
  const direct = byIndex.get(item.sourceIndex);
  if (direct) return direct;
  for (const event of byIndex.values()) {
    if (item.timestamp && event.timestamp !== item.timestamp) continue;
    if (item.type === "user-message" && ["user_message", "message"].includes(event.kind) && samePreview(event.preview, item.text)) return event;
    if (item.type === "assistant-message" && ["agent_message", "message", "task_complete"].includes(event.kind) && samePreview(event.preview, item.text)) return event;
    if (item.type === "token-count" && event.kind === "token_count") return event;
    if (item.type === "tool-call" && event.kind.includes("call") && item.name && String(event.title || event.preview || "").includes(item.name)) return event;
  }
  return null;
}

function samePreview(preview, text) {
  const left = normalizeDisplayText(preview).slice(0, 80);
  const right = normalizeDisplayText(text).slice(0, 80);
  return Boolean(left && right && (left.includes(right) || right.includes(left)));
}

function isUsefulDisplayText(text) {
  const normalized = normalizeDisplayText(text);
  if (!normalized) return false;
  if (/AGENTS\.md instructions/i.test(normalized)) return false;
  if (/<INSTRUCTIONS>/i.test(normalized)) return false;
  if (/^<permissions instructions>/i.test(normalized)) return false;
  if (/^Continue working toward the active thread goal/i.test(normalized)) return false;
  if (/^<environment_context>/i.test(normalized)) return false;
  return true;
}

function normalizeDisplayText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function groupEventsByTurn(events) {
  const turns = state.detail?.turns || [];
  if (turns.length === 0) return [{ label: "关键事件", events }];
  const groups = turns.map((turn, index) => ({
    label: `第 ${turn.turnNumber || index + 1} 轮`,
    start: dateMs(turn.startedAt),
    end: dateMs(turn.completedAt),
    events: [],
  }));
  const unplaced = [];
  for (const event of events) {
    const time = dateMs(event.timestamp);
    const group = groups.find((candidate, index) => {
      if (time == null) return false;
      const start = candidate.start ?? -Infinity;
      const nextStart = groups[index + 1]?.start ?? Infinity;
      const end = candidate.end ?? nextStart;
      return time >= start && time <= end;
    });
    (group || { events: unplaced }).events.push(event);
  }
  const visible = groups.filter((group) => group.events.length > 0);
  if (unplaced.length) visible.unshift({ label: "未定位", events: unplaced });
  return visible.length ? visible : [{ label: "关键事件", events }];
}

function humanEventTitle(event) {
  const kind = event.kind || event.payloadType || event.type || "event";
  if (kind === "user_message") return "用户消息";
  if (kind === "agent_message") return "助手消息";
  if (kind === "function_call" || kind === "custom_tool_call") return event.title || "工具调用";
  if (kind === "tool_output") return "工具输出";
  if (kind === "token_count" || event.payloadType === "token_count") return "上下文占用统计";
  if (isCompactEvent(event)) return event.compact?.kind === "context_compacted" ? "上下文压缩完成" : "上下文压缩摘要";
  if (/spawn_agent/i.test(event.preview || event.title || "")) return "启动子代理";
  if (/wait_agent/i.test(event.preview || event.title || "")) return "等待子代理";
  return event.title || kind;
}

function countErrors(detail) {
  const fromEvents = (detail?.events || []).filter((event) => /error|failed|失败|错误/i.test(JSON.stringify(event))).length;
  const fromItems = (detail?.turns || []).flatMap((turn) => turn.items || []).filter((item) => /error|failed|失败|错误/i.test(JSON.stringify(item))).length;
  return Math.max(fromEvents, fromItems);
}

function durationBetween(start, end) {
  const startMs = dateMs(start);
  const endMs = dateMs(end);
  if (startMs == null || endMs == null || endMs < startMs) return null;
  return endMs - startMs;
}

function dateMs(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function traceTypeLabel(type) {
  if (type === "thread") return "线程";
  if (type === "turn") return "轮次";
  if (type === "agent_message") return "助手消息";
  if (type === "tool") return "工具";
  if (type === "handoff") return "委派";
  if (type === "subagent") return "子代理";
  if (type === "embedded-subagent") return "内嵌子代理批次";
  if (type === "embedded-subagent-task") return "内嵌子代理";
  if (type === "lazy-child") return "子会话";
  if (type === "message") return "消息";
  if (type === "reasoning") return "推理";
  if (type === "metric") return "指标";
  return type || "节点";
}
