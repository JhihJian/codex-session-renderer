const state = {
  sessions: [],
  filteredSessions: [],
  selectedSessionId: null,
  detail: null,
  selectedEventIndex: null,
  selectedTraceNodeId: null,
  expandedTraceNodeIds: new Set(),
  rawEventCache: new Map(),
  viewMode: "read",
  visibleEvents: 40,
  visibleThreadItems: 140,
};

const els = {
  appShell: document.getElementById("appShell"),
  healthStatus: document.getElementById("healthStatus"),
  sessionCount: document.getElementById("sessionCount"),
  sessionList: document.getElementById("sessionList"),
  sessionHierarchy: document.getElementById("sessionHierarchy"),
  sessionSearch: document.getElementById("sessionSearch"),
  sessionTypeFilter: document.getElementById("sessionTypeFilter"),
  itemSearch: document.getElementById("itemSearch"),
  itemTypeFilter: document.getElementById("itemTypeFilter"),
  importantOnly: document.getElementById("importantOnly"),
  sessionMetaLabel: document.getElementById("sessionMetaLabel"),
  sessionTitle: document.getElementById("sessionTitle"),
  statsStrip: document.getElementById("statsStrip"),
  threadContent: document.getElementById("threadContent"),
  traceContent: document.getElementById("traceContent"),
  sessionDetails: document.getElementById("sessionDetails"),
  rawEventList: document.getElementById("rawEventList"),
  rawPreview: document.getElementById("rawPreview"),
  inspectorActions: document.getElementById("inspectorActions"),
  eventCount: document.getElementById("eventCount"),
  selectedEventLabel: document.getElementById("selectedEventLabel"),
  showMoreEventsButton: document.getElementById("showMoreEventsButton"),
  toast: document.getElementById("toast"),
  copyRawButton: document.getElementById("copyRawButton"),
  refreshButton: document.getElementById("refreshButton"),
  copyMarkdownButton: document.getElementById("copyMarkdownButton"),
  downloadMarkdownButton: document.getElementById("downloadMarkdownButton"),
  readViewButton: document.getElementById("readViewButton"),
  traceViewButton: document.getElementById("traceViewButton"),
  toggleLeft: document.getElementById("toggleLeft"),
  toggleRight: document.getElementById("toggleRight"),
};

init();

function init() {
  bindEvents();
  loadHealth();
  loadSessions();
}

function bindEvents() {
  els.refreshButton.addEventListener("click", () => loadSessions({ keepSelection: true }));
  els.sessionSearch.addEventListener("input", renderSessionList);
  els.sessionTypeFilter.addEventListener("change", renderSessionList);
  els.itemSearch.addEventListener("input", () => {
    state.visibleThreadItems = 140;
    renderMainContent();
  });
  els.itemTypeFilter.addEventListener("change", () => {
    state.visibleThreadItems = 140;
    renderMainContent();
  });
  els.importantOnly.addEventListener("change", renderInspector);
  els.readViewButton.addEventListener("click", () => setViewMode("read"));
  els.traceViewButton.addEventListener("click", () => setViewMode("trace"));
  els.showMoreEventsButton.addEventListener("click", () => {
    state.visibleEvents += 80;
    renderInspector();
  });
  els.copyRawButton.addEventListener("click", copySelectedRawEvent);
  els.copyMarkdownButton.addEventListener("click", copyMarkdown);
  els.downloadMarkdownButton.addEventListener("click", downloadMarkdown);
  els.toggleLeft.addEventListener("click", () => {
    const next = els.appShell.dataset.left === "open" ? "closed" : "open";
    els.appShell.dataset.left = next;
  });
  els.toggleRight.addEventListener("click", () => {
    const next = els.appShell.dataset.right === "open" ? "closed" : "open";
    els.appShell.dataset.right = next;
  });
  document.querySelectorAll("[data-panel-target]").forEach((button) => {
    button.addEventListener("click", () => {
      els.appShell.dataset.panel = button.dataset.panelTarget;
    });
  });
}

async function loadHealth() {
  try {
    const health = await fetchJson("/api/health");
    els.healthStatus.textContent = `只读数据源 ${health.codexHome}`;
  } catch (error) {
    els.healthStatus.textContent = `接口不可用：${error.message}`;
  }
}

async function loadSessions({ keepSelection = false } = {}) {
  setBusy(true);
  try {
    const data = await fetchJson("/api/sessions");
    state.sessions = data.sessions || [];
    renderSessionList();
    const nextId =
      keepSelection && state.sessions.some((session) => session.id === state.selectedSessionId)
        ? state.selectedSessionId
        : state.sessions[0]?.id;
    if (nextId) await selectSession(nextId);
  } catch (error) {
    showToast(`加载会话失败：${error.message}`);
    els.threadContent.innerHTML = emptyState("无法加载会话数据", "请确认本地服务仍在运行。");
  } finally {
    setBusy(false);
  }
}

function setBusy(isBusy) {
  els.refreshButton.disabled = isBusy;
  els.refreshButton.textContent = isBusy ? "刷新中" : "刷新";
}

async function selectSession(id) {
  state.selectedSessionId = id;
  state.detail = null;
  state.selectedEventIndex = null;
  state.selectedTraceNodeId = null;
  state.expandedTraceNodeIds = new Set();
  state.rawEventCache = new Map();
  state.visibleEvents = 40;
  state.visibleThreadItems = 140;
  renderSessionList();
  els.threadContent.innerHTML = emptyState("正在读取会话", "解析本地 JSONL 事件流。");
  try {
    const detail = await fetchJson(`/api/sessions/${encodeURIComponent(id)}`);
    state.detail = detail;
    primeTraceExpansion(detail);
    els.copyMarkdownButton.disabled = false;
    els.downloadMarkdownButton.disabled = false;
    renderAll();
    els.appShell.dataset.panel = "thread";
  } catch (error) {
    showToast(`读取会话失败：${error.message}`);
  }
}

function renderAll() {
  renderSessionList();
  renderSessionHierarchy();
  renderThreadHeader();
  renderStats();
  renderMainContent();
  renderDetails();
  renderInspector();
}

function setViewMode(mode) {
  state.viewMode = mode;
  els.readViewButton.classList.toggle("active", mode === "read");
  els.traceViewButton.classList.toggle("active", mode === "trace");
  els.threadContent.hidden = mode !== "read";
  els.traceContent.hidden = mode !== "trace";
  renderMainContent();
}

function primeTraceExpansion(detail) {
  const root = detail?.trace?.root;
  state.expandedTraceNodeIds = new Set(root ? [root.id] : []);
}

function renderSessionList() {
  const query = els.sessionSearch.value.trim().toLowerCase();
  const filter = els.sessionTypeFilter.value;
  const sessions = state.sessions.filter((session) => {
    const haystack = [session.title, session.cwd, session.relativePath, session.model, session.agentNickname]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (query && !haystack.includes(query)) return false;
    if (filter === "project" && !session.cwd) return false;
    if (filter === "projectless" && session.cwd) return false;
    if (filter === "error" && !/error|failed|失败|错误/i.test(haystack)) return false;
    if (filter === "tool" && !/tool|mcp|command|shell|工具|命令/i.test(haystack)) return false;
    return true;
  });
  state.filteredSessions = sessions;
  els.sessionCount.textContent = String(sessions.length);
  if (sessions.length === 0) {
    els.sessionList.innerHTML = emptyState("没有匹配的会话", "调整搜索或过滤条件。");
    return;
  }
  const renderedSessions = sessions.slice(0, 220);
  const overflowHtml =
    sessions.length > renderedSessions.length
      ? `<div class="list-overflow-note">已显示前 ${renderedSessions.length} 条，继续输入关键词可缩小范围。</div>`
      : "";
  els.sessionList.innerHTML =
    renderedSessions
    .map((session) => {
      const active = session.id === state.selectedSessionId ? " active" : "";
      const cwd = session.cwd ? shortPath(session.cwd) : "Projectless";
      const agent = session.agentNickname ? `${session.agentNickname}/${session.agentRole || "agent"}` : "";
      return `
        <button class="session-row${active}" type="button" data-session-id="${escapeAttr(session.id)}">
          <span class="session-title">${highlight(escapeHtml(session.title || "未命名会话"), query)}</span>
          <span class="session-date">${formatShortDate(session.updatedAt || session.fileModifiedAt)}</span>
          <span class="session-meta">${escapeHtml([agent, cwd, session.model || session.modelProvider || "unknown"].filter(Boolean).join(" · "))}</span>
        </button>
      `;
    })
      .join("") + overflowHtml;
  els.sessionList.querySelectorAll("[data-session-id]").forEach((button) => {
    button.addEventListener("click", () => selectSession(button.dataset.sessionId));
  });
}

function renderSessionHierarchy() {
  const detail = state.detail;
  if (!detail?.session) {
    els.sessionHierarchy.innerHTML = "";
    return;
  }
  const hierarchy = detail.trace?.hierarchy || {};
  const children = hierarchy.children || [];
  const siblings = hierarchy.siblings || [];
  const parent = hierarchy.parent;
  const root = detail.session;
  const parentHtml = parent?.thread
    ? `<button class="hierarchy-row parent" type="button" data-hierarchy-session-id="${escapeAttr(parent.thread.id)}">
        <span class="hierarchy-mark">↑</span>
        <span><strong>${escapeHtml(parent.thread.title || "父会话")}</strong><em>Parent Thread</em></span>
      </button>`
    : "";
  const peerNodes = parent ? siblings : children;
  const peerHtml = peerNodes.map((child) => renderHierarchyPeer(child, root.id)).join("");
  const directChildrenHtml =
    parent && children.length
      ? `<div class="hierarchy-subtitle">当前子代理的下级</div>${children.map((child) => renderHierarchyPeer(child, root.id)).join("")}`
      : "";
  els.sessionHierarchy.innerHTML = `
    <div class="hierarchy-title">
      <span>当前层级</span>
      <span class="count-pill">${peerNodes.length}</span>
    </div>
    ${parentHtml}
    ${
      parent
        ? `${peerHtml || `<div class="hierarchy-empty">没有同级子代理</div>`}${directChildrenHtml}`
        : `<button class="hierarchy-row active" type="button" data-hierarchy-session-id="${escapeAttr(root.id)}">
            <span class="hierarchy-mark">●</span>
            <span><strong>${escapeHtml(root.agentNickname || root.title || "Root Thread")}</strong><em>${escapeHtml(root.agentRole || "Root Thread")}</em></span>
          </button>
          ${peerHtml || `<div class="hierarchy-empty">没有直接子代理</div>`}`
    }
  `;
  els.sessionHierarchy.querySelectorAll("[data-hierarchy-session-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.hierarchySessionId;
      if (id && id !== state.selectedSessionId) selectSession(id);
    });
  });
}

function renderHierarchyPeer(child, activeId) {
  const thread = child.thread || {};
  const id = child.childThreadId;
  const active = id === activeId || child.active ? " active" : "";
  const mark = active ? "●" : "↳";
  return `<button class="hierarchy-row child${active}" type="button" data-hierarchy-session-id="${escapeAttr(id)}">
    <span class="hierarchy-mark">${mark}</span>
    <span><strong>${escapeHtml(thread.agentNickname || thread.title || id)}</strong><em>${escapeHtml([thread.agentRole, thread.title].filter(Boolean).join(" · ") || child.status)}</em></span>
  </button>`;
}

function renderThreadHeader() {
  const session = state.detail?.session;
  if (!session) return;
  els.sessionTitle.textContent = session.title || "未命名会话";
  const parts = [session.model, session.reasoningEffort, formatDate(session.updatedAt)].filter(Boolean);
  els.sessionMetaLabel.textContent = parts.join(" · ") || session.id;
}

function renderStats() {
  const stats = state.detail?.stats;
  if (!stats) {
    els.statsStrip.innerHTML = "";
    return;
  }
  const tokenUsage = latestTokenUsage(state.detail.turns);
  const rows = [
    ["Turns", stats.turnCount],
    ["Events", stats.eventCount],
    ["Important", stats.importantEventCount],
    ["Tools", countItems("tool-call")],
    ["Agents", stats.childThreadCount || 0],
    ["Tokens", tokenUsage ? compactNumber(tokenUsage.total_tokens || tokenUsage.totalTokens || 0) : "n/a"],
  ];
  els.statsStrip.innerHTML = rows
    .map(([label, value]) => `<div class="stat"><strong>${escapeHtml(String(value))}</strong><span>${label}</span></div>`)
    .join("");
}

function renderMainContent() {
  els.threadContent.hidden = state.viewMode !== "read";
  els.traceContent.hidden = state.viewMode !== "trace";
  els.readViewButton.classList.toggle("active", state.viewMode === "read");
  els.traceViewButton.classList.toggle("active", state.viewMode === "trace");
  if (state.viewMode === "trace") {
    renderTrace();
  } else {
    renderThread();
  }
  renderInspector();
}

function renderThread() {
  const detail = state.detail;
  if (!detail) {
    els.threadContent.innerHTML = emptyState("选择一个会话", "左侧列表展示本机 Codex 会话。");
    return;
  }
  const query = els.itemSearch.value.trim().toLowerCase();
  const typeFilter = els.itemTypeFilter.value;
  let totalItems = 0;
  let visibleItems = 0;
  const turns = [];
  for (const turn of detail.turns) {
    const matchedItems = turn.items.filter((item) => itemMatches(item, query, typeFilter));
    totalItems += matchedItems.length;
    if (visibleItems >= state.visibleThreadItems) continue;
    const remaining = state.visibleThreadItems - visibleItems;
    const shownItems = matchedItems.slice(0, remaining);
    visibleItems += shownItems.length;
    if (shownItems.length > 0) turns.push({ ...turn, items: shownItems });
  }

  if (turns.length === 0) {
    els.threadContent.innerHTML = emptyState("没有匹配的内容", "调整内容搜索或类型过滤。");
    return;
  }
  const moreHtml =
    totalItems > visibleItems
      ? `<div class="load-more-wrap">
          <button class="ghost-button" type="button" data-show-more-thread>显示更多内容 (${visibleItems}/${totalItems})</button>
        </div>`
      : "";
  els.threadContent.innerHTML = turns.map((turn) => renderTurn(turn, turn.turnNumber ?? 1, query)).join("") + moreHtml;
  const moreButton = els.threadContent.querySelector("[data-show-more-thread]");
  if (moreButton) {
    moreButton.addEventListener("click", () => {
      state.visibleThreadItems += 160;
      renderThread();
    });
  }
}

function renderTrace() {
  const detail = state.detail;
  if (!detail?.trace?.root) {
    els.traceContent.innerHTML = emptyState("没有 Trace 数据", "当前会话没有可审计执行树。");
    return;
  }
  const query = els.itemSearch.value.trim().toLowerCase();
  const typeFilter = els.itemTypeFilter.value;
  const root = filterTraceNode(detail.trace.root, query, typeFilter);
  if (!root) {
    els.traceContent.innerHTML = emptyState("没有匹配的 Trace 节点", "调整搜索或类型过滤。");
    return;
  }
  const maxDuration = Math.max(1, detail.trace.timing?.durationMs || root.durationMs || maxNodeDuration(root));
  els.traceContent.innerHTML = `
    <div class="trace-shell">
      <div class="trace-head">
        <div>
          <p class="eyebrow">Audit Trace</p>
          <h3>${escapeHtml(detail.session.title || "Root Thread")}</h3>
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
  return ["thread", "turn", "tool", "handoff", "subagent", "lazy-child"].includes(node.type);
}

function traceNodeMatchesType(node, typeFilter) {
  if (typeFilter === "message") return node.type === "message";
  if (typeFilter === "tool") return node.type === "tool" || node.type === "handoff" || node.type === "subagent";
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
  ];
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function renderTraceNode(node, context) {
  const selected = node.id === state.selectedTraceNodeId ? " selected" : "";
  const depth = Math.min(context.depth ?? 0, 8);
  const durationLabel = node.durationMs == null ? "n/a" : formatDuration(node.durationMs);
  const width = node.durationMs == null ? 2 : Math.max(2, Math.min(100, (node.durationMs / context.maxDuration) * 100));
  const children = node.children || [];
  const expanded = state.expandedTraceNodeIds.has(node.id);
  return `
    <div class="trace-node" style="--depth:${depth}">
      <button class="trace-row${selected}" type="button" data-trace-node-id="${escapeAttr(node.id)}">
        <span class="trace-indent" aria-hidden="true"></span>
        ${
          children.length
            ? `<span class="trace-expander" role="button" data-trace-toggle-id="${escapeAttr(node.id)}">${expanded ? "⌄" : "›"}</span>`
            : `<span class="trace-expander"></span>`
        }
        <span class="trace-icon ${escapeAttr(node.icon || node.type)}">${traceIcon(node)}</span>
        <span class="trace-main">
          <span class="trace-label">${escapeHtml(node.label || node.type)}</span>
          <span class="trace-title">${escapeHtml(node.title || "")}</span>
        </span>
        <span class="trace-status">${escapeHtml(node.status || "")}</span>
        <span class="trace-duration">${escapeHtml(durationLabel)}${node.durationEstimated ? " est" : ""}</span>
        <span class="trace-bar" aria-hidden="true"><i style="width:${width}%"></i></span>
      </button>
      ${children.length && expanded ? `<div class="trace-children">${children.map((child) => renderTraceNode(child, { ...context, depth: depth + 1 })).join("")}</div>` : ""}
    </div>
  `;
}

function itemMatches(item, query, typeFilter) {
  const haystack = JSON.stringify(item).toLowerCase();
  if (query && !haystack.includes(query)) return false;
  if (typeFilter === "message") return item.type === "user-message" || item.type === "assistant-message";
  if (typeFilter === "tool") return item.type === "tool-call" || item.type === "response-item";
  if (typeFilter === "output") return item.type === "tool-output" || (item.type === "tool-call" && item.output);
  if (typeFilter === "reasoning") return item.type === "reasoning";
  if (typeFilter === "system") return item.type === "event" || item.type === "token-count";
  if (typeFilter === "error") return /error|failed|失败|错误/i.test(haystack);
  return true;
}

function renderTurn(turn, index, query) {
  const meta = [turn.status, formatDate(turn.startedAt), turn.cwd ? shortPath(turn.cwd) : ""].filter(Boolean).join(" · ");
  return `
    <article class="turn">
      <div class="turn-header">
        <strong>Turn ${index}</strong>
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
  return `
    <section class="item ${escapeAttr(item.type)}">
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
    return `<div class="message-text">${highlight(formatMessageText(item.text), query)}</div>`;
  }
  if (item.type === "reasoning") {
    const text = item.text || (item.encrypted ? "推理内容已加密存储，当前没有可展示的明文摘要。" : "无摘要。");
    return `<div class="message-text">${highlight(escapeHtml(text), query)}</div>`;
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
      ${renderTruncationNotice(item)}
    `;
  }
  if (item.type === "tool-output") {
    return `<pre class="code-block">${highlight(escapeHtml(String(item.output || "")), query)}</pre>${renderTruncationNotice(item)}`;
  }
  const fallback = item.payloadPreview || JSON.stringify(item.info || item, null, 2);
  return `<pre class="json-block">${highlight(escapeHtml(fallback), query)}</pre>${renderTruncationNotice(item)}`;
}

function renderTruncationNotice(item) {
  if (!item.truncated) return "";
  const fields = item.truncatedFields?.join(", ") || "content";
  return `<div class="truncation-notice">已截断 ${escapeHtml(fields)}，完整内容可在右侧原始事件中按需查看。</div>`;
}

function renderDetails() {
  const detail = state.detail;
  if (!detail) {
    els.sessionDetails.innerHTML = "";
    return;
  }
  const session = detail.session;
  const rows = [
    ["ID", session.id],
    ["标题", session.title],
    ["工作目录", session.cwd || "Projectless"],
    ["数据文件", session.relativePath],
    ["模型", [session.model, session.reasoningEffort].filter(Boolean).join(" / ")],
    ["子代理", `${detail.trace?.hierarchy?.children?.length || 0}`],
    ["来源", [session.originator, session.source, session.threadSource].filter(Boolean).join(" / ")],
    ["更新时间", formatDate(session.updatedAt || session.fileModifiedAt)],
    ["大小", formatBytes(session.sizeBytes)],
  ];
  const childThreads = detail.trace?.hierarchy?.children || [];
  const childHtml = childThreads.length
    ? `<div class="subagent-mini-list">${childThreads
        .map((child) => {
          const thread = child.thread || {};
          return `<button class="subagent-mini" type="button" data-subagent-session-id="${escapeAttr(child.childThreadId)}">
            <strong>${escapeHtml(thread.agentNickname || child.childThreadId)}</strong>
            <span>${escapeHtml([thread.agentRole, thread.title].filter(Boolean).join(" · "))}</span>
          </button>`;
        })
        .join("")}</div>`
    : "";
  els.sessionDetails.innerHTML = `<div class="details-grid">${rows
    .map(([key, value]) => `<div class="detail-row"><strong>${escapeHtml(key)}</strong><span>${escapeHtml(value || "n/a")}</span></div>`)
    .join("")}</div>${childHtml}`;
  els.sessionDetails.querySelectorAll("[data-subagent-session-id]").forEach((button) => {
    button.addEventListener("click", () => selectSession(button.dataset.subagentSessionId));
  });
}

function renderInspector() {
  const detail = state.detail;
  if (!detail) {
    els.rawEventList.innerHTML = "";
    els.eventCount.textContent = "0";
    els.rawPreview.textContent = "选择会话后查看 JSON";
    els.inspectorActions.innerHTML = "";
    return;
  }
  const query = els.itemSearch.value.trim().toLowerCase();
  const importantOnly = els.importantOnly.checked;
  const events = detail.events.filter((event) => {
    if (importantOnly && !event.important) return false;
    if (!query) return true;
    return JSON.stringify(event).toLowerCase().includes(query);
  });
  els.eventCount.textContent = String(events.length);
  const shown = events.slice(0, state.visibleEvents);
  els.showMoreEventsButton.hidden = shown.length >= events.length;
  els.rawEventList.innerHTML = shown
    .map((event) => {
      const active = event.index === state.selectedEventIndex ? " active" : "";
      return `
        <button class="raw-event${active}" type="button" data-event-index="${event.index}">
          <span class="raw-event-title">${escapeHtml(event.index + ". " + event.title)}</span>
          <span class="session-date">${escapeHtml(event.kind)}</span>
          <span class="raw-event-preview">${escapeHtml(event.preview || formatDate(event.timestamp) || "")}</span>
        </button>
      `;
    })
    .join("");
  els.rawEventList.querySelectorAll("[data-event-index]").forEach((button) => {
    button.addEventListener("click", () => selectRawEvent(Number(button.dataset.eventIndex)));
  });
  if (state.selectedEventIndex == null && events[0]) selectRawEvent(events[0].index, { rerender: false });
}

async function selectRawEvent(index, { rerender = true } = {}) {
  state.selectedTraceNodeId = null;
  els.inspectorActions.innerHTML = "";
  state.selectedEventIndex = index;
  const event = state.detail?.events.find((candidate) => candidate.index === index);
  if (!event) return;
  els.selectedEventLabel.textContent = `#${event.index} ${event.kind}`;
  els.copyRawButton.disabled = false;
  if (rerender) renderInspector();
  els.rawPreview.textContent = JSON.stringify(event, null, 2) + "\n\n正在按需读取完整 payload...";
  try {
    const raw = await loadRawEvent(index);
    if (state.selectedEventIndex === index && !state.selectedTraceNodeId) {
      els.rawPreview.textContent = JSON.stringify(raw, null, 2);
    }
  } catch (error) {
    if (state.selectedEventIndex === index && !state.selectedTraceNodeId) {
      els.rawPreview.textContent = JSON.stringify(event, null, 2) + `\n\n读取完整事件失败：${error.message}`;
    }
  }
}

async function loadRawEvent(index) {
  if (state.rawEventCache.has(index)) return state.rawEventCache.get(index);
  const id = state.detail?.session?.id;
  if (!id) throw new Error("未选择会话");
  const raw = await fetchJson(`/api/sessions/${encodeURIComponent(id)}/events/${index}`);
  state.rawEventCache.set(index, raw);
  return raw;
}

function selectTraceNode(id) {
  state.selectedTraceNodeId = id;
  const node = findTraceNode(state.detail?.trace?.root, id);
  if (!node) return;
  state.selectedEventIndex = null;
  els.selectedEventLabel.textContent = traceNodeLabel(node);
  els.rawPreview.textContent = JSON.stringify(traceNodePreview(node), null, 2);
  renderTraceActions(node);
  els.copyRawButton.disabled = false;
  els.traceContent.querySelectorAll(".trace-row.selected").forEach((row) => row.classList.remove("selected"));
  const active = els.traceContent.querySelector(`[data-trace-node-id="${cssEscape(id)}"]`);
  active?.classList.add("selected");
}

function renderTraceActions(node) {
  if (node.type === "subagent" && node.threadId) {
    els.inspectorActions.innerHTML = `
      <button class="ghost-button small" type="button" data-open-trace-thread="${escapeAttr(node.threadId)}">打开子代理会话</button>
    `;
    els.inspectorActions.querySelector("[data-open-trace-thread]").addEventListener("click", (event) => {
      selectSession(event.currentTarget.dataset.openTraceThread);
    });
    return;
  }
  els.inspectorActions.innerHTML = "";
}

function toggleTraceNode(id) {
  if (state.expandedTraceNodeIds.has(id)) {
    state.expandedTraceNodeIds.delete(id);
  } else {
    state.expandedTraceNodeIds.add(id);
  }
  renderTrace();
}

async function copySelectedRawEvent() {
  if (!state.detail) return;
  if (state.selectedTraceNodeId) {
    const node = findTraceNode(state.detail.trace?.root, state.selectedTraceNodeId);
    if (!node) return;
    await copyText(JSON.stringify(traceNodePreview(node), null, 2));
    showToast("已复制 Trace 节点");
    return;
  }
  if (state.selectedEventIndex == null) return;
  const event = await loadRawEvent(state.selectedEventIndex);
  await copyText(JSON.stringify(event, null, 2));
  showToast("已复制原始事件");
}

async function copyMarkdown() {
  if (!state.detail?.session?.id) return;
  const markdown = await fetchText(`/api/sessions/${encodeURIComponent(state.detail.session.id)}/markdown`);
  await copyText(markdown);
  showToast("已复制 Markdown");
}

async function downloadMarkdown() {
  if (!state.detail?.session?.id) return;
  const markdown = await fetchText(`/api/sessions/${encodeURIComponent(state.detail.session.id)}/markdown`);
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${sanitizeFileName(state.detail.session.title || state.detail.session.id)}.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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

function compactTraceItem(item) {
  if (!item) return item;
  return {
    ...item,
    text: truncateText(item.text, 4000),
    arguments: truncateText(item.arguments, 4000),
    output: truncateText(item.output, 8000),
  };
}

function truncateText(value, max) {
  if (value == null) return value;
  const text = String(value);
  return text.length > max ? `${text.slice(0, max)}\n\n... truncated ${text.length - max} chars for inspector preview ...` : value;
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
  if (!Number.isFinite(value)) return "n/a";
  if (value < 1000) return `${Math.round(value)} ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)} s`;
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.round((value % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function itemTitle(item) {
  if (item.type === "user-message") return "用户消息";
  if (item.type === "assistant-message") return item.phase === "final" ? "助手最终回复" : "助手消息";
  if (item.type === "tool-call") return item.name ? `工具调用 · ${item.name}` : "工具调用";
  if (item.type === "tool-output") return "工具输出";
  if (item.type === "reasoning") return "推理摘要";
  if (item.type === "token-count") return "Token 统计";
  return item.eventType || item.responseType || item.type;
}

function itemIcon(item) {
  if (item.type === "user-message") return "U";
  if (item.type === "assistant-message") return "A";
  if (item.type === "tool-call") return ">";
  if (item.type === "tool-output") return "$";
  if (item.type === "reasoning") return "R";
  if (item.type === "token-count") return "#";
  return "i";
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
  return response.text();
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove("show"), 2200);
}

function emptyState(title, subtitle) {
  return `<div class="empty-state"><div><strong>${escapeHtml(title)}</strong><br /><span>${escapeHtml(subtitle)}</span></div></div>`;
}

function firstLine(text, max = 120) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function formatMessageText(text) {
  return escapeHtml(String(text || "")).replace(/\n{2,}/g, (match) => `${"<br />".repeat(Math.min(2, match.length))}`).replace(/\n/g, "<br />");
}

function highlight(html, query) {
  if (!query) return html;
  const escaped = escapeRegExp(query);
  return html.replace(new RegExp(`(${escaped})`, "gi"), "<mark>$1</mark>");
}

function prettyMaybeJson(value) {
  if (typeof value !== "string") return JSON.stringify(value, null, 2);
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatShortDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function compactNumber(value) {
  const number = Number(value || 0);
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(1)}M`;
  if (number >= 1_000) return `${(number / 1_000).toFixed(1)}K`;
  return String(number);
}

function shortPath(value) {
  const text = String(value || "");
  const parts = text.replace(/^\\\\\?\\/, "").split(/[\\/]+/).filter(Boolean);
  if (parts.length <= 3) return text;
  return `${parts[0]}/${parts[1]}/…/${parts.at(-1)}`;
}

function sanitizeFileName(value) {
  return String(value).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 120);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cssEscape(value) {
  if (window.CSS?.escape) return window.CSS.escape(value);
  return String(value).replace(/["\\]/g, "\\$&");
}
