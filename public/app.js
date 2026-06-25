const state = {
  sources: [],
  selectedSourceId: "local",
  sessions: [],
  filteredSessions: [],
  selectedSessionId: null,
  selectedSessionKey: null,
  detail: null,
  selectedItemRef: null,
  selectedEventIndex: null,
  selectedTraceNodeId: null,
  expandedTraceNodeIds: new Set(),
  rawEventCache: new Map(),
  viewMode: "compact",
  sessionTimeFilter: "realtime",
  visibleEvents: 40,
  visibleThreadItems: 140,
};

const {
  compactNumber,
  cssEscape,
  escapeAttr,
  escapeHtml,
  escapeRegExp,
  firstLine,
  formatBytes,
  formatDate,
  formatShortDate,
  highlight,
  highlightHtmlText,
  prettyMaybeJson,
  sanitizeFileName,
  sessionTimeBucket,
  shortPath,
} = window.AppFormat;

const markdownCache = new Map();
const markdownCacheLimit = 700;
const markdownRenderer = window.markdownit?.({
  html: false,
  linkify: true,
  breaks: false,
});
if (markdownRenderer) {
  const defaultLinkOpen =
    markdownRenderer.renderer.rules.link_open ||
    ((tokens, index, options, env, self) => self.renderToken(tokens, index, options));
  markdownRenderer.renderer.rules.link_open = (tokens, index, options, env, self) => {
    const token = tokens[index];
    const hrefIndex = token.attrIndex("href");
    const href = hrefIndex >= 0 ? token.attrs[hrefIndex][1] : "";
    if (/^https?:\/\//i.test(href)) {
      token.attrSet("target", "_blank");
      token.attrSet("rel", "noreferrer");
    }
    return defaultLinkOpen(tokens, index, options, env, self);
  };
}

const els = {
  appShell: document.getElementById("appShell"),
  healthStatus: document.getElementById("healthStatus"),
  sessionCount: document.getElementById("sessionCount"),
  sessionList: document.getElementById("sessionList"),
  sessionSearch: document.getElementById("sessionSearch"),
  sessionTimeFilter: document.getElementById("sessionTimeFilter"),
  sessionTypeFilter: document.getElementById("sessionTypeFilter"),
  itemSearch: document.getElementById("itemSearch"),
  itemTypeFilter: document.getElementById("itemTypeFilter"),
  importantOnly: document.getElementById("importantOnly"),
  sessionMetaLabel: document.getElementById("sessionMetaLabel"),
  sessionTitle: document.getElementById("sessionTitle"),
  statsStrip: document.getElementById("statsStrip"),
  threadContent: document.getElementById("threadContent"),
  compactContent: document.getElementById("compactContent"),
  traceContent: document.getElementById("traceContent"),
  sessionDetails: document.getElementById("sessionDetails"),
  selectionDetails: document.getElementById("selectionDetails"),
  rawEventList: document.getElementById("rawEventList"),
  rawPreview: document.getElementById("rawPreview"),
  inspectorActions: document.getElementById("inspectorActions"),
  eventCount: document.getElementById("eventCount"),
  selectedEventLabel: document.getElementById("selectedEventLabel"),
  showMoreEventsButton: document.getElementById("showMoreEventsButton"),
  toast: document.getElementById("toast"),
  copyRawButton: document.getElementById("copyRawButton"),
  refreshButton: document.getElementById("refreshButton"),
  refreshRemoteButton: document.getElementById("refreshRemoteButton"),
  sourceSelect: document.getElementById("sourceSelect"),
  sourceStatus: document.getElementById("sourceStatus"),
  copyMarkdownButton: document.getElementById("copyMarkdownButton"),
  downloadMarkdownButton: document.getElementById("downloadMarkdownButton"),
  readViewButton: document.getElementById("readViewButton"),
  compactViewButton: document.getElementById("compactViewButton"),
  traceViewButton: document.getElementById("traceViewButton"),
  toggleLeft: document.getElementById("toggleLeft"),
  toggleRight: document.getElementById("toggleRight"),
};

init();

function init() {
  bindEvents();
  loadHealthAndSources();
}

function bindEvents() {
  els.refreshButton.addEventListener("click", () => loadSessions({ keepSelection: true }));
  els.refreshRemoteButton.addEventListener("click", refreshSelectedSource);
  els.sourceSelect.addEventListener("change", () => selectSource(els.sourceSelect.value));
  els.sessionSearch.addEventListener("input", renderSessionList);
  els.sessionTimeFilter.querySelectorAll("[data-session-time]").forEach((button) => {
    button.addEventListener("click", () => {
      state.sessionTimeFilter = button.dataset.sessionTime || "realtime";
      renderSessionList();
      const nextSession = state.filteredSessions[0];
      if (nextSession && !state.filteredSessions.some((session) => sessionKey(session) === state.selectedSessionKey)) {
        selectSession(nextSession.id);
      }
    });
  });
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
  els.compactViewButton.addEventListener("click", () => setViewMode("compact"));
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

async function loadHealthAndSources() {
  try {
    const health = await fetchJson("/api/health");
    state.sources = health.sources || [];
    state.selectedSourceId = health.defaultSourceId || "local";
    renderSourceControls();
    els.healthStatus.textContent = health.sources?.length > 1 ? `数据源 ${health.sources.length} 个` : `只读数据源 ${health.codexHome}`;
    await loadSessions();
  } catch (error) {
    els.healthStatus.textContent = `接口不可用：${error.message}`;
  }
}

function renderSourceControls() {
  if (!state.sources.length) {
    els.sourceSelect.innerHTML = `<option value="local">本机 Codex Home</option>`;
    state.sources = [{ id: "local", label: "本机 Codex Home", kind: "local", status: { refreshable: false } }];
  } else {
    els.sourceSelect.innerHTML = state.sources
      .map((source) => `<option value="${escapeAttr(source.id)}">${escapeHtml(sourceLabel(source))}</option>`)
      .join("");
  }
  els.sourceSelect.value = state.selectedSourceId;
  renderSourceStatus();
}

function renderSourceStatus() {
  const source = selectedSource();
  if (!source) {
    els.sourceStatus.textContent = "数据源不存在";
    els.refreshRemoteButton.hidden = true;
    return;
  }
  const status = source.status || {};
  els.refreshRemoteButton.hidden = !status.refreshable;
  els.refreshRemoteButton.disabled = Boolean(status.refreshing);
  els.refreshRemoteButton.textContent = status.refreshing ? "远程刷新中" : "刷新远程";
  const parts = [source.kind === "remote" ? "远程快照" : "本机"];
  if (status.refreshing) parts.push("刷新中");
  if (status.lastSuccessfulRefreshAt) parts.push(`最近成功 ${formatDate(status.lastSuccessfulRefreshAt)}`);
  if (status.stale) parts.push("正在浏览旧快照");
  if (status.error?.message) parts.push(status.error.message);
  if (source.kind === "remote" && !status.snapshotAvailable) parts.push("尚无可用快照");
  els.sourceStatus.textContent = parts.join(" · ");
}

async function loadSessions({ keepSelection = false } = {}) {
  setBusy(true);
  try {
    const data = await fetchJson(sourceSessionsUrl());
    if (data.source) upsertSource(data.source);
    state.sessions = data.sessions || [];
    renderSessionList();
    const nextSession =
      keepSelection && state.filteredSessions.some((session) => sessionKey(session) === state.selectedSessionKey)
        ? state.filteredSessions.find((session) => sessionKey(session) === state.selectedSessionKey)
        : state.filteredSessions[0] || state.sessions[0];
    if (nextSession) {
      await selectSession(nextSession.id);
    } else {
      clearSelectedSession();
      renderAll();
    }
  } catch (error) {
    showToast(`加载会话失败：${error.message}`);
    clearSelectedSession();
    renderAll();
    els.threadContent.innerHTML = emptyState("无法加载会话数据", "请确认服务仍在运行，或远程快照已成功刷新。");
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
  state.selectedSessionKey = sessionKey({ id, sourceId: state.selectedSourceId });
  state.detail = null;
  state.selectedItemRef = null;
  state.selectedEventIndex = null;
  state.selectedTraceNodeId = null;
  state.expandedTraceNodeIds = new Set();
  state.rawEventCache = new Map();
  state.visibleEvents = 40;
  state.visibleThreadItems = 140;
  renderSessionList();
  els.threadContent.innerHTML = emptyState("正在读取会话", "解析当前数据源中的 JSONL 事件流。");
  try {
    const detail = await fetchJson(sourceSessionUrl(id));
    state.detail = detail;
    state.selectedSourceId = detail.session?.sourceId || state.selectedSourceId;
    state.selectedSessionKey = sessionKey(detail.session || { id, sourceId: state.selectedSourceId });
    primeTraceExpansion(detail);
    els.copyMarkdownButton.disabled = false;
    els.downloadMarkdownButton.disabled = false;
    renderAll();
    els.appShell.dataset.panel = "thread";
  } catch (error) {
    showToast(`读取会话失败：${error.message}`);
  }
}

function clearSelectedSession() {
  state.selectedSessionId = null;
  state.selectedSessionKey = null;
  state.detail = null;
  state.selectedItemRef = null;
  state.selectedEventIndex = null;
  state.selectedTraceNodeId = null;
  state.expandedTraceNodeIds = new Set();
  state.rawEventCache = new Map();
  els.copyMarkdownButton.disabled = true;
  els.downloadMarkdownButton.disabled = true;
}

async function selectSource(sourceId) {
  if (!sourceId || sourceId === state.selectedSourceId) return;
  state.selectedSourceId = sourceId;
  clearSelectedSession();
  renderSourceControls();
  await loadSessions();
}

async function refreshSelectedSource() {
  const source = selectedSource();
  if (!source?.status?.refreshable) return;
  els.refreshRemoteButton.disabled = true;
  els.refreshRemoteButton.textContent = "远程刷新中";
  try {
    const result = await fetchJson(`/api/sources/${encodeURIComponent(source.id)}/refresh`, { method: "POST" });
    if (result.source) upsertSource(result.source);
    renderSourceControls();
    await loadSessions({ keepSelection: true });
    showToast("远程快照已刷新");
  } catch (error) {
    await reloadSources();
    showToast(`远程刷新失败：${error.message}`);
    await loadSessions({ keepSelection: true });
  } finally {
    renderSourceControls();
  }
}

async function reloadSources() {
  const data = await fetchJson("/api/sources").catch(() => null);
  if (!data?.sources) return;
  state.sources = data.sources;
  renderSourceControls();
}

function renderAll() {
  renderSessionList();
  renderThreadHeader();
  renderStats();
  renderMainContent();
  renderDetails();
  renderSelectionDetails();
  renderInspector();
}

function setViewMode(mode) {
  state.viewMode = mode;
  els.readViewButton.classList.toggle("active", mode === "read");
  els.compactViewButton.classList.toggle("active", mode === "compact");
  els.traceViewButton.classList.toggle("active", mode === "trace");
  els.threadContent.hidden = mode !== "read";
  els.compactContent.hidden = mode !== "compact";
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
  syncSessionTimeFilter();
  const sessions = state.sessions.filter((session) => {
    const haystack = [session.title, session.cwd, session.relativePath, session.model, session.agentNickname]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (sessionTimeBucket(session) !== state.sessionTimeFilter) return false;
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
  els.sessionList.innerHTML = renderSessionDirectoryGroups(renderedSessions, query) + overflowHtml;
  els.sessionList.querySelectorAll("[data-session-id]").forEach((row) => {
    row.addEventListener("click", (event) => {
      if (event.target.closest("a")) return;
      selectSession(row.dataset.sessionId);
    });
    row.addEventListener("keydown", (event) => {
      if (event.target.closest("a")) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      selectSession(row.dataset.sessionId);
    });
  });
}

function syncSessionTimeFilter() {
  els.sessionTimeFilter.querySelectorAll("[data-session-time]").forEach((button) => {
    const active = button.dataset.sessionTime === state.sessionTimeFilter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
}

function renderSessionDirectoryGroups(sessions, query) {
  return groupSessionsByDirectory(sessions)
    .map(
      (group) => `
        <section class="session-directory-group">
          <div class="session-directory-head">
            <strong>${escapeHtml(group.label)}</strong>
            <span>${group.sessions.length}</span>
          </div>
          <div class="session-directory-list">
            ${group.sessions.map((session) => renderSessionRow(session, query)).join("")}
          </div>
        </section>
      `,
    )
    .join("");
}

function groupSessionsByDirectory(sessions) {
  const groups = new Map();
  for (const session of sessions) {
    const key = session.cwd || "__projectless__";
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label: session.cwd ? shortPath(session.cwd) : "Projectless",
        latestTime: 0,
        sessions: [],
      });
    }
    const group = groups.get(key);
    group.sessions.push(session);
    group.latestTime = Math.max(group.latestTime, sessionListTimeMs(session));
  }
  return [...groups.values()].sort((a, b) => b.latestTime - a.latestTime || a.label.localeCompare(b.label, "zh-CN"));
}

function renderSessionRow(session, query) {
  const active = sessionKey(session) === state.selectedSessionKey ? " active" : "";
  const cwd = session.cwd ? shortPath(session.cwd) : "Projectless";
  const agent = session.agentNickname ? `${session.agentNickname}/${session.agentRole || "agent"}` : "";
  const source = session.sourceLabel || selectedSource()?.label || "";
  return `
    <div class="session-row${active}" role="button" tabindex="0" data-session-id="${escapeAttr(session.id)}">
      <span class="session-title markdown-inline-title">${renderMarkdownTitle(session.title || "未命名会话", query)}</span>
      <span class="session-date">${formatShortDate(session.updatedAt || session.fileModifiedAt)}</span>
      <span class="session-meta">${escapeHtml([source, agent, cwd, session.model || session.modelProvider || "unknown"].filter(Boolean).join(" · "))}</span>
    </div>
  `;
}

function sessionListTimeMs(session) {
  for (const value of [session.updatedAt, session.fileModifiedAt, session.startedAt]) {
    if (!value) continue;
    const time = new Date(value).getTime();
    if (Number.isFinite(time)) return time;
  }
  return 0;
}

function renderThreadHeader() {
  const session = state.detail?.session;
  if (!session) {
    els.sessionTitle.textContent = "选择一个会话";
    els.sessionMetaLabel.textContent = selectedSource()?.label || "未选择";
    return;
  }
  els.sessionTitle.innerHTML = renderMarkdownTitle(session.title || "未命名会话");
  const parts = [session.sourceLabel || selectedSource()?.label, session.model, session.reasoningEffort, formatDate(session.updatedAt)].filter(Boolean);
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
  els.compactContent.hidden = state.viewMode !== "compact";
  els.traceContent.hidden = state.viewMode !== "trace";
  els.readViewButton.classList.toggle("active", state.viewMode === "read");
  els.compactViewButton.classList.toggle("active", state.viewMode === "compact");
  els.traceViewButton.classList.toggle("active", state.viewMode === "trace");
  if (state.viewMode === "trace") {
    renderTrace();
  } else if (state.viewMode === "compact") {
    renderCompact();
  } else {
    renderThread();
  }
  renderSelectionDetails();
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
  els.threadContent.querySelectorAll("[data-item-ref]").forEach((itemEl) => {
    itemEl.addEventListener("click", (event) => {
      if (event.target.closest("a, button")) return;
      selectItemRef(itemEl.dataset.itemRef);
    });
    itemEl.addEventListener("keydown", (event) => {
      if (event.target.closest("a, button")) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      selectItemRef(itemEl.dataset.itemRef);
    });
  });
  const moreButton = els.threadContent.querySelector("[data-show-more-thread]");
  if (moreButton) {
    moreButton.addEventListener("click", () => {
      state.visibleThreadItems += 160;
      renderThread();
    });
  }
}

function renderCompact() {
  const compact = state.detail?.compact || buildCompactFallback(state.detail);
  if (!compact) {
    els.compactContent.innerHTML = emptyState("选择一个会话", "左侧列表展示本机 Codex 会话。");
    return;
  }
  const query = els.itemSearch.value.trim().toLowerCase();
  const typeFilter = els.itemTypeFilter.value;
  const filtered = filterCompactNode(compact, query, typeFilter, true);
  if (!filtered || (filtered.turns.length === 0 && filtered.children.length === 0)) {
    els.compactContent.innerHTML = emptyState("没有匹配的精简内容", "精简视图只包含用户输入、每轮最后助手消息和子代理层级。");
    return;
  }
  els.compactContent.innerHTML = `
    <div class="compact-shell">
      <div class="compact-layout">
        ${renderCompactOutline(filtered, { depth: 0, root: true, path: "root", query })}
        <div class="compact-main">
          ${renderCompactThread(filtered, { depth: 0, root: true, path: "root", query })}
        </div>
      </div>
    </div>
  `;
  els.compactContent.querySelectorAll("[data-compact-session-id]").forEach((button) => {
    button.addEventListener("click", () => selectSession(button.dataset.compactSessionId));
  });
  els.compactContent.querySelectorAll("[data-compact-nav-target]").forEach((row) => {
    row.addEventListener("click", (event) => {
      if (event.target.closest("a")) return;
      scrollToCompactTarget(row.dataset.compactNavTarget);
    });
    row.addEventListener("keydown", (event) => {
      if (event.target.closest("a")) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      scrollToCompactTarget(row.dataset.compactNavTarget);
    });
  });
}

function buildCompactFallback(detail) {
  if (!detail?.turns) return null;
  return {
    session: detail.session || {},
    turns: detail.turns.map((turn, index) => compactTurnFallback(turn, index)),
    children: [],
  };
}

function compactTurnFallback(turn, index) {
  const items = turn.items || [];
  const userMessages = items
    .filter((item) => item.type === "user-message" && String(item.text || "").trim())
    .map(compactMessageFallback);
  const assistant = [...items]
    .reverse()
    .find((item) => item.type === "assistant-message" && String(item.text || "").trim());
  return {
    id: turn.id || `turn-${index}`,
    turnNumber: turn.turnNumber ?? index + 1,
    status: turn.status,
    startedAt: turn.startedAt,
    completedAt: turn.completedAt,
    userMessages,
    assistantMessage: assistant ? compactMessageFallback(assistant) : null,
    children: [],
  };
}

function compactMessageFallback(item) {
  return {
    text: item.text || "",
    timestamp: item.timestamp,
    phase: item.phase,
    truncated: item.truncated,
    textLength: item.textLength,
  };
}

function filterCompactNode(node, query, typeFilter, isRoot = false) {
  const turns = (node.turns || [])
    .map((turn) => filterCompactTurn(turn, query, typeFilter))
    .filter(Boolean);
  const children = (node.children || [])
    .map((child) => filterCompactNode(child, query, typeFilter, false))
    .filter(Boolean);
  const matchesSelf = compactSearchText(node).includes(query || "") && compactNodeMatchesType(node, typeFilter);
  if (isRoot || matchesSelf || turns.length > 0 || children.length > 0) {
    return { ...node, turns, children };
  }
  return null;
}

function filterCompactTurn(turn, query, typeFilter) {
  const children = (turn.children || [])
    .map((child) => filterCompactNode(child, query, typeFilter, false))
    .filter(Boolean);
  const matchesSelf = compactTurnMatches(turn, query, typeFilter);
  if (matchesSelf || children.length > 0) return { ...turn, children };
  return null;
}

function compactTurnMatches(turn, query, typeFilter) {
  const hasMessage = turn.userMessages?.length || turn.assistantMessage;
  const hasChild = turn.children?.length;
  if (typeFilter === "tool") return Boolean(hasChild);
  if (!["all", "message", "error"].includes(typeFilter)) return false;
  if (typeFilter === "message" && !hasMessage) return false;
  const haystack = compactTurnSearchText(turn);
  if (typeFilter === "error" && !/error|failed|失败|错误/i.test(haystack)) return false;
  return !query || haystack.includes(query);
}

function compactNodeMatchesType(node, typeFilter) {
  if (typeFilter === "all") return true;
  if (typeFilter === "message") return Boolean(node.turns?.some((turn) => turn.userMessages?.length || turn.assistantMessage));
  if (typeFilter === "tool") return !node.session || Boolean(node.edgeStatus || node.spawnEvent || node.notificationEvent);
  if (typeFilter === "error") return /error|failed|失败|错误/i.test(compactSearchText(node));
  return false;
}

function compactSearchText(node) {
  const session = node.session || {};
  const parts = [
    session.id,
    session.title,
    session.agentNickname,
    session.agentRole,
    session.cwd,
    node.edgeStatus,
    node.unavailableReason,
    node.spawnEvent?.preview,
    node.notificationEvent?.preview,
    ...(node.turns || []).map(compactTurnSearchText),
    ...(node.children || []).map(compactSearchText),
  ];
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function compactTurnSearchText(turn) {
  const parts = [
    turn.id,
    turn.status,
    ...(turn.userMessages || []).map((message) => message.text),
    turn.assistantMessage?.text,
    ...(turn.children || []).map(compactSearchText),
  ];
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function renderCompactOutline(node, context) {
  const stats = compactOutlineStats(node);
  return `
    <nav class="compact-outline" aria-label="精简视图层级目录">
      <div class="compact-outline-section">
        <div class="compact-outline-head">
          <strong>执行层级</strong>
          <span>${escapeHtml(`${stats.threads} 线程 · ${stats.turns} turns`)}</span>
        </div>
        <div class="compact-outline-tree">
          ${renderCompactExecutionDirectory(node, { ...context, seen: new Set() })}
        </div>
      </div>
    </nav>
  `;
}

function renderCompactExecutionDirectory(node, context) {
  const session = node.session || {};
  const depth = Math.min(context.depth ?? 0, 7);
  const name = session.agentNickname || session.title || session.id || "当前会话";
  const targetId = compactElementId("thread", context.path);
  const threadId = session.id || targetId;
  const seen = new Set(context.seen || []);
  const repeated = seen.has(threadId);
  seen.add(threadId);
  const turns = (node.turns || [])
    .map((turn, index) =>
      renderCompactOutlineTurn(turn, {
        depth: depth + 1,
        path: `${context.path}-turn-${index}`,
        query: context.query,
        seen,
        allowChildren: !repeated,
      }),
    )
    .join("");
  const unanchoredChildren = repeated
    ? ""
    : (node.children || [])
        .map((child, index) =>
          renderCompactExecutionDirectory(child, {
            depth: depth + 1,
            path: `${context.path}-child-${index}`,
            query: context.query,
            root: false,
            seen,
          }),
        )
        .join("");
  const repeatedNotice = repeated ? `<div class="compact-outline-note" style="--depth:${depth + 1}">已出现过，停止展开</div>` : "";
  const unanchoredTitle =
    unanchoredChildren && (node.turns || []).length
      ? `<div class="compact-outline-note" style="--depth:${depth + 1}">未定位到具体 Turn 的子代理</div>`
      : "";
  return `
    <div class="compact-outline-group">
      <div class="compact-outline-item thread" role="button" tabindex="0" style="--depth:${depth}" data-compact-nav-target="${escapeAttr(targetId)}">
        <span class="compact-outline-indent" aria-hidden="true"></span>
        <span class="compact-outline-icon">${context.root ? "R" : "A"}</span>
        <span class="compact-outline-copy">
          <strong class="markdown-inline-title">${renderMarkdownTitle(name, context.query)}</strong>
          <em>${escapeHtml([session.agentRole, `${(node.turns || []).length} turns`].filter(Boolean).join(" · "))}</em>
        </span>
      </div>
      ${repeatedNotice}
      ${repeated ? "" : turns}
      ${unanchoredTitle}
      ${unanchoredChildren}
    </div>
  `;
}

function renderCompactOutlineThreadUnderTurn(node, context) {
  return renderCompactExecutionDirectory(node, {
    depth: context.depth,
    path: context.path,
    query: context.query,
    root: false,
    seen: context.seen,
  });
}

function renderCompactOutlineTurn(turn, context) {
  const depth = Math.min(context.depth ?? 0, 8);
  const targetId = compactElementId("turn", context.path);
  const children =
    context.allowChildren === false
      ? ""
      : (turn.children || [])
          .map((child, index) =>
            renderCompactOutlineThreadUnderTurn(child, {
              depth: depth + 1,
              path: `${context.path}-child-${index}`,
              query: context.query,
              seen: context.seen,
            }),
          )
          .join("");
  return `
    <div class="compact-outline-group">
      <div class="compact-outline-item turn" role="button" tabindex="0" style="--depth:${depth}" data-compact-nav-target="${escapeAttr(targetId)}">
        <span class="compact-outline-indent" aria-hidden="true"></span>
        <span class="compact-outline-icon">T</span>
        <span class="compact-outline-copy">
          <strong>Turn ${escapeHtml(String(turn.turnNumber || ""))}</strong>
          <em>${highlight(escapeHtml(compactTurnOutlineTitle(turn)), context.query)}</em>
        </span>
      </div>
      ${children}
    </div>
  `;
}

function compactNodeChildren(node) {
  return [
    ...(node.children || []),
    ...(node.turns || []).flatMap((turn) => turn.children || []),
  ];
}

function compactNodeChildEntries(node, basePath) {
  const direct = (node.children || []).map((child, index) => ({ node: child, path: `${basePath}-child-${index}` }));
  const anchored = (node.turns || []).flatMap((turn, turnIndex) =>
    (turn.children || []).map((child, childIndex) => ({ node: child, path: `${basePath}-turn-${turnIndex}-child-${childIndex}` })),
  );
  return [...direct, ...anchored];
}

function compactTurnOutlineTitle(turn) {
  const text = turn.userMessages?.[0]?.text || turn.assistantMessage?.text || turn.status || "";
  return firstLine(text, 72) || "无消息";
}

function compactOutlineStats(node, seen = new Set()) {
  const sessionId = node.session?.id || node.session?.title || "";
  if (sessionId && seen.has(sessionId)) return { turns: 0, threads: 0 };
  const nextSeen = new Set(seen);
  if (sessionId) nextSeen.add(sessionId);
  return compactNodeChildren(node).reduce(
    (stats, child) => {
      const childStats = compactOutlineStats(child, nextSeen);
      stats.turns += childStats.turns;
      stats.threads += childStats.threads;
      return stats;
    },
    { turns: (node.turns || []).length, threads: 1 },
  );
}

function compactElementId(kind, path) {
  return `compact-${kind}-${String(path || "root").replace(/[^a-z0-9_-]/gi, "-")}`;
}

function scrollToCompactTarget(targetId) {
  if (!targetId) return;
  const target = els.compactContent.querySelector(`#${cssEscape(targetId)}`);
  if (!target) return;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  target.classList.remove("compact-jump-highlight");
  window.setTimeout(() => {
    target.classList.add("compact-jump-highlight");
    window.setTimeout(() => target.classList.remove("compact-jump-highlight"), 1400);
  }, 80);
}

function renderCompactThread(node, context) {
  const session = node.session || {};
  const depth = Math.min(context.depth ?? 0, 6);
  const path = context.path || "root";
  const targetId = compactElementId("thread", path);
  const name = session.agentNickname || session.title || session.id || "当前会话";
  const role = [session.agentRole, session.model].filter(Boolean).join(" · ");
  const meta = [role, formatDate(session.updatedAt), node.edgeStatus].filter(Boolean).join(" · ");
  const openButton =
    !context.root && session.id
      ? `<button class="ghost-button small" type="button" data-compact-session-id="${escapeAttr(session.id)}">打开会话</button>`
      : "";
  const unavailable = node.unavailable
    ? `<div class="compact-unavailable">子代理详情未载入：${escapeHtml(node.unavailableReason || "未知原因")}</div>`
    : "";
  const turnHtml = (node.turns || [])
    .map((turn, index) => renderCompactTurn(turn, { depth, path: `${path}-turn-${index}`, query: context.query }))
    .join("");
  const childHtml = (node.children || [])
    .map((child, index) => renderCompactThread(child, { depth: depth + 1, path: `${path}-child-${index}`, query: context.query }))
    .join("");

  return `
    <article class="compact-thread" id="${escapeAttr(targetId)}" tabindex="-1" style="--depth:${depth}">
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
        ${turnHtml || (!childHtml ? `<div class="compact-empty">没有可展示的用户/助手消息。</div>` : "")}
        ${childHtml ? `<div class="compact-orphans">${childHtml}</div>` : ""}
      </div>
    </article>
  `;
}

function renderCompactTurn(turn, context) {
  const path = context.path || `turn-${turn.turnNumber || 0}`;
  const targetId = compactElementId("turn", path);
  const meta = [turn.status, formatDate(turn.startedAt), turn.completedAt ? `结束 ${formatDate(turn.completedAt)}` : ""]
    .filter(Boolean)
    .join(" · ");
  const users = turn.userMessages?.length
    ? turn.userMessages.map((message) => renderCompactMessage("user", "用户", message, context.query)).join("")
    : `<div class="compact-missing">本轮没有可展示的用户输入。</div>`;
  const assistant = turn.assistantMessage
    ? renderCompactMessage("assistant", "助手最后消息", turn.assistantMessage, context.query)
    : `<div class="compact-missing">本轮没有助手最终消息。</div>`;
  const children = (turn.children || [])
    .map((child, index) =>
      renderCompactThread(child, { depth: context.depth + 1, path: `${path}-child-${index}`, query: context.query }),
    )
    .join("");
  return `
    <section class="compact-turn" id="${escapeAttr(targetId)}" tabindex="-1">
      <div class="compact-turn-head">
        <strong>Turn ${escapeHtml(String(turn.turnNumber || ""))}</strong>
        <span>${escapeHtml(meta)}</span>
      </div>
      <div class="compact-message-pair">
        ${users}
        ${assistant}
      </div>
      ${children ? `<div class="compact-child-group">${children}</div>` : ""}
    </section>
  `;
}

function renderCompactMessage(kind, label, message, query) {
  const meta = [formatDate(message.timestamp), message.phase, message.truncated ? `已截断 ${compactNumber(message.textLength || 0)} 字符` : ""]
    .filter(Boolean)
    .join(" · ");
  return `
    <section class="compact-message ${kind}">
      <div class="compact-message-label">
        <span>${escapeHtml(label)}</span>
        <em>${escapeHtml(meta)}</em>
      </div>
      ${renderMarkdownMessage(message.text || "", query)}
    </section>
  `;
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
          <h3 class="markdown-inline-title">${renderMarkdownTitle(detail.session.title || "Root Thread")}</h3>
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
  return `<div class="truncation-notice">已截断 ${escapeHtml(fields)}，完整内容可在右侧调试 JSON 中按需查看。</div>`;
}

function renderDetails() {
  const detail = state.detail;
  if (!detail) {
    els.sessionDetails.innerHTML = emptyInspectorSection("会话概览", "选择会话后显示关键统计。");
    return;
  }
  const session = detail.session;
  const stats = detail.stats || {};
  const tokenUsage = latestTokenUsage(detail.turns || []);
  const toolCount = countItems("tool-call");
  const errorCount = countErrors(detail);
  const startedAt = session.startedAt || detail.turns?.[0]?.startedAt || stats.timing?.startedAt;
  const endedAt = session.updatedAt || session.fileModifiedAt || detail.turns?.at(-1)?.completedAt || stats.timing?.completedAt;
  const duration = durationBetween(startedAt, endedAt);
  const metrics = [
    ["Turns", stats.turnCount ?? detail.turns?.length ?? 0],
    ["工具", toolCount],
    ["错误", errorCount],
    ["子代理", stats.childThreadCount || detail.trace?.hierarchy?.children?.length || 0],
    ["Tokens", tokenUsage ? compactNumber(tokenUsage.total_tokens || tokenUsage.totalTokens || 0) : "n/a"],
    ["大小", formatBytes(stats.sizeBytes || session.sizeBytes)],
  ];
  const rows = [
    ["数据源", session.sourceLabel || selectedSource()?.label || "本机 Codex Home"],
    ["模型", [session.model, session.reasoningEffort].filter(Boolean).join(" / ") || "unknown"],
    ["工作目录", session.cwd || "Projectless"],
    ["时间范围", [formatDate(startedAt), formatDate(endedAt)].filter(Boolean).join(" - ") || "n/a"],
    ["持续时间", duration == null ? "n/a" : formatDuration(duration)],
    ["数据文件", session.relativePath || "n/a"],
  ];
  const childThreads = detail.trace?.hierarchy?.children || [];
  const childHtml = childThreads.length
    ? `<div class="subagent-mini-list inspector-subagents">${childThreads
        .map((child) => {
          const thread = child.thread || {};
          return `<div class="subagent-mini" role="button" tabindex="0" data-subagent-session-id="${escapeAttr(child.childThreadId)}">
            <strong>${escapeHtml(thread.agentNickname || child.childThreadId)}</strong>
            <span>${renderSubagentMiniTitle(thread)}</span>
          </div>`;
        })
        .join("")}</div>`
    : "";
  els.sessionDetails.innerHTML = `
    <div class="section-title-row">
      <h3>会话概览</h3>
      <span class="muted">${escapeHtml(session.dataSourceKind === "remote" ? "远程快照" : "本机")}</span>
    </div>
    <div class="inspector-title markdown-inline-title">${renderMarkdownTitle(session.title || "未命名会话")}</div>
    <div class="inspector-metric-grid">
      ${metrics
        .map(
          ([label, value]) => `
            <div class="inspector-metric">
              <strong>${escapeHtml(String(value))}</strong>
              <span>${escapeHtml(label)}</span>
            </div>
          `,
        )
        .join("")}
    </div>
    <div class="details-grid compact-details">${rows
      .map(([key, value]) => `<div class="detail-row"><strong>${escapeHtml(key)}</strong><span>${renderDetailValue(key, value)}</span></div>`)
      .join("")}</div>
    <div class="overview-actions">
      <button class="ghost-button small" type="button" data-copy-session-id>复制 ID</button>
      <button class="ghost-button small" type="button" data-copy-session-path>复制路径</button>
      <button class="ghost-button small" type="button" data-copy-session-markdown>复制 Markdown</button>
    </div>
    ${childHtml}
  `;
  els.sessionDetails.querySelector("[data-copy-session-id]")?.addEventListener("click", () => copyInspectorText(session.id, "已复制会话 ID"));
  els.sessionDetails
    .querySelector("[data-copy-session-path]")
    ?.addEventListener("click", () => copyInspectorText(detail.stats?.dataPath || session.relativePath || "", "已复制数据路径"));
  els.sessionDetails.querySelector("[data-copy-session-markdown]")?.addEventListener("click", copyMarkdown);
  els.sessionDetails.querySelectorAll("[data-subagent-session-id]").forEach((row) => {
    row.addEventListener("click", (event) => {
      if (event.target.closest("a")) return;
      selectSession(row.dataset.subagentSessionId);
    });
    row.addEventListener("keydown", (event) => {
      if (event.target.closest("a")) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      selectSession(row.dataset.subagentSessionId);
    });
  });
}

function renderInspector() {
  const detail = state.detail;
  if (!detail) {
    els.rawEventList.innerHTML = "";
    els.eventCount.textContent = "0";
    els.rawPreview.textContent = "选择会话后查看调试 JSON";
    els.inspectorActions.innerHTML = "";
    return;
  }
  const query = els.itemSearch.value.trim().toLowerCase();
  const importantOnly = els.importantOnly.checked;
  const events = buildKeyInspectorEvents(detail).filter((event) => {
    if (importantOnly && !event.important) return false;
    if (!query) return true;
    return JSON.stringify(event).toLowerCase().includes(query);
  });
  els.eventCount.textContent = String(events.length);
  const shown = events.slice(0, state.visibleEvents);
  els.showMoreEventsButton.hidden = shown.length >= events.length;
  els.rawEventList.innerHTML = renderKeyEventGroups(shown);
  els.rawEventList.querySelectorAll("[data-event-index]").forEach((button) => {
    button.addEventListener("click", () => selectRawEvent(Number(button.dataset.eventIndex)));
  });
}

function renderKeyEventGroups(events) {
  if (events.length === 0) return `<div class="inspector-empty">没有匹配的关键事件。</div>`;
  const groups = groupEventsByTurn(events);
  return groups
    .map(
      (group) => `
        <div class="timeline-group">
          <div class="timeline-group-title">${escapeHtml(group.label)}</div>
          <div class="timeline-group-events">
            ${group.events
              .map((event) => {
      const active = event.index === state.selectedEventIndex ? " active" : "";
      return `
                  <button class="raw-event${active}" type="button" data-event-index="${event.index}">
          <span class="raw-event-title">${escapeHtml("#" + event.index + " " + humanEventTitle(event))}</span>
          <span class="session-date">${escapeHtml(formatDate(event.timestamp) || event.kind)}</span>
          <span class="raw-event-preview">${escapeHtml(event.preview || formatDate(event.timestamp) || "")}</span>
        </button>
      `;
              })
              .join("")}
          </div>
        </div>
      `,
    )
    .join("");
}

async function selectRawEvent(index, { rerender = true } = {}) {
  state.selectedTraceNodeId = null;
  state.selectedItemRef = null;
  els.inspectorActions.innerHTML = "";
  state.selectedEventIndex = index;
  const event = state.detail?.events.find((candidate) => candidate.index === index);
  if (!event) return;
  els.selectedEventLabel.textContent = `#${event.index} ${event.kind}`;
  els.copyRawButton.disabled = false;
  if (rerender) renderInspector();
  renderSelectionDetails();
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
  const raw = await fetchJson(sourceEventUrl(id, index));
  state.rawEventCache.set(index, raw);
  return raw;
}

function selectTraceNode(id) {
  state.selectedTraceNodeId = id;
  const node = findTraceNode(state.detail?.trace?.root, id);
  if (!node) return;
  state.selectedEventIndex = null;
  state.selectedItemRef = null;
  els.selectedEventLabel.textContent = traceNodeLabel(node);
  els.rawPreview.textContent = JSON.stringify(traceNodePreview(node), null, 2);
  renderTraceActions(node);
  renderSelectionDetails();
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

function selectItemRef(ref) {
  if (!ref) return;
  state.selectedItemRef = ref;
  state.selectedTraceNodeId = null;
  state.selectedEventIndex = null;
  const item = findItemByRef(ref);
  if (!item) return;
  els.selectedEventLabel.textContent = itemTitle(item);
  els.rawPreview.textContent = JSON.stringify(itemDebugPreview(item), null, 2);
  els.inspectorActions.innerHTML = "";
  els.copyRawButton.disabled = false;
  renderSelectionDetails();
  renderThread();
}

function renderSelectionDetails() {
  if (!state.detail) {
    els.selectionDetails.innerHTML = emptyInspectorSection("选中内容", "选择会话后可查看消息、工具、Trace 或关键事件详情。");
    return;
  }
  if (state.selectedTraceNodeId) {
    const node = findTraceNode(state.detail.trace?.root, state.selectedTraceNodeId);
    els.selectionDetails.innerHTML = node ? renderTraceSelection(node) : emptyInspectorSection("选中内容", "Trace 节点不存在。");
    bindSelectionActions();
    return;
  }
  if (state.selectedItemRef) {
    const item = findItemByRef(state.selectedItemRef);
    els.selectionDetails.innerHTML = item ? renderItemSelection(item) : emptyInspectorSection("选中内容", "阅读项不存在。");
    bindSelectionActions();
    return;
  }
  if (state.selectedEventIndex != null) {
    const event = state.detail.events.find((candidate) => candidate.index === state.selectedEventIndex);
    els.selectionDetails.innerHTML = event ? renderEventSelection(event) : emptyInspectorSection("选中内容", "关键事件不存在。");
    bindSelectionActions();
    return;
  }
  els.selectionDetails.innerHTML = `
    <div class="section-title-row">
      <h3>选中内容</h3>
      <span class="muted">未选择</span>
    </div>
    <div class="selection-empty">点击阅读视图中的消息/工具、Trace 节点或下方关键事件查看细节。</div>
  `;
}

function renderTraceSelection(node) {
  const detail = node.detail || {};
  const item = detail.item || {};
  const thread = detail.thread || detail.edge?.thread || {};
  const rows = [
    ["类型", traceTypeLabel(node.type)],
    ["状态", node.status || "n/a"],
    ["时间", [formatDate(node.timestamp), formatDate(node.completedAt)].filter(Boolean).join(" - ") || "n/a"],
    ["耗时", node.durationMs == null ? "n/a" : `${formatDuration(node.durationMs)}${node.durationEstimated ? " 估算" : ""}`],
  ];
  if (item.name) rows.push(["工具", item.name]);
  if (thread.id || node.threadId) rows.push(["线程", thread.agentNickname || thread.title || node.threadId || thread.id]);
  const body = item.output || item.arguments || item.text || node.subtitle || detail.note || "";
  const actions = traceSelectionActions(node, body);
  return renderSelectionCard({
    eyebrow: "Trace 节点",
    title: node.title || node.label || node.id,
    meta: [node.label, node.subtitle].filter(Boolean).join(" · "),
    rows,
    body: body ? firstLine(body, 700) : "",
    actions,
  });
}

function renderItemSelection(item) {
  const rows = [
    ["类型", itemTitle(item)],
    ["Turn", item.turnIndex == null ? "n/a" : String(item.turnIndex + 1)],
    ["时间", formatDate(item.timestamp) || "n/a"],
    ["状态", [item.phase, item.status].filter(Boolean).join(" / ") || "n/a"],
  ];
  if (item.name) rows.push(["工具", item.name]);
  if (item.callId) rows.push(["Call ID", item.callId]);
  const body = item.text || item.output || item.arguments || item.payloadPreview || "";
  const actions = itemSelectionActions(item);
  return renderSelectionCard({
    eyebrow: "阅读项",
    title: itemTitle(item),
    meta: item.name || item.responseType || item.eventType || "",
    rows,
    body: body ? firstLine(body, 900) : "",
    actions,
  });
}

function renderEventSelection(event) {
  const rows = [
    ["事件", `#${event.index}`],
    ["分类", event.kind || "n/a"],
    ["时间", formatDate(event.timestamp) || "n/a"],
    ["Payload", event.payloadSize ? formatBytes(event.payloadSize) : "n/a"],
  ];
  return renderSelectionCard({
    eyebrow: "关键事件",
    title: humanEventTitle(event),
    meta: [event.type, event.payloadType, event.role].filter(Boolean).join(" · "),
    rows,
    body: event.preview || "",
    actions: [
      { label: "复制摘要", copy: event.preview || humanEventTitle(event), toast: "已复制事件摘要" },
      { label: "复制 JSON", action: "copy-debug" },
    ],
  });
}

function renderSelectionCard({ eyebrow, title, meta, rows, body, actions }) {
  return `
    <div class="section-title-row">
      <h3>选中内容</h3>
      <span class="muted">${escapeHtml(eyebrow)}</span>
    </div>
    <div class="selection-card">
      <div class="selection-head">
        <strong>${escapeHtml(title || "未命名")}</strong>
        ${meta ? `<span>${escapeHtml(meta)}</span>` : ""}
      </div>
      <div class="details-grid selection-rows">
        ${rows.map(([key, value]) => `<div class="detail-row"><strong>${escapeHtml(key)}</strong><span>${escapeHtml(value)}</span></div>`).join("")}
      </div>
      ${body ? `<pre class="selection-preview">${escapeHtml(body)}</pre>` : ""}
      ${
        actions?.length
          ? `<div class="selection-actions">${actions
              .map((action, index) => `<button class="ghost-button small" type="button" data-selection-action="${index}">${escapeHtml(action.label)}</button>`)
              .join("")}</div>`
          : ""
      }
    </div>
  `;
}

function bindSelectionActions() {
  const actions = currentSelectionActions();
  els.selectionDetails.querySelectorAll("[data-selection-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = actions[Number(button.dataset.selectionAction)];
      if (!action) return;
      if (action.action === "copy-debug") {
        await copySelectedRawEvent();
        return;
      }
      if (action.action === "open-thread" && action.threadId) {
        selectSession(action.threadId);
        return;
      }
      if (action.copy != null) await copyInspectorText(action.copy, action.toast || "已复制");
    });
  });
}

function currentSelectionActions() {
  if (state.selectedTraceNodeId) {
    const node = findTraceNode(state.detail?.trace?.root, state.selectedTraceNodeId);
    if (!node) return [];
    const detail = node.detail || {};
    const item = detail.item || {};
    const body = item.output || item.arguments || item.text || node.subtitle || detail.note || "";
    return traceSelectionActions(node, body);
  }
  if (state.selectedItemRef) {
    const item = findItemByRef(state.selectedItemRef);
    return item ? itemSelectionActions(item) : [];
  }
  if (state.selectedEventIndex != null) {
    const event = state.detail?.events.find((candidate) => candidate.index === state.selectedEventIndex);
    return event
      ? [
          { label: "复制摘要", copy: event.preview || humanEventTitle(event), toast: "已复制事件摘要" },
          { label: "复制 JSON", action: "copy-debug" },
        ]
      : [];
  }
  return [];
}

function traceSelectionActions(node, body = "") {
  const actions = [{ label: "复制 JSON", action: "copy-debug" }];
  if (body) actions.unshift({ label: "复制摘要", copy: body, toast: "已复制节点摘要" });
  if (node.type === "subagent" && node.threadId) actions.unshift({ label: "打开子会话", action: "open-thread", threadId: node.threadId });
  return actions;
}

function itemSelectionActions(item) {
  const actions = [{ label: "复制 JSON", action: "copy-debug" }];
  const body = item.text || item.output || item.arguments || item.payloadPreview || "";
  if (body) actions.unshift({ label: "复制内容", copy: body, toast: "已复制内容" });
  return actions;
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
  if (state.selectedItemRef) {
    const item = findItemByRef(state.selectedItemRef);
    if (!item) return;
    await copyText(JSON.stringify(itemDebugPreview(item), null, 2));
    showToast("已复制阅读项 JSON");
    return;
  }
  if (state.selectedEventIndex == null) return;
  const event = await loadRawEvent(state.selectedEventIndex);
  await copyText(JSON.stringify(event, null, 2));
    showToast("已复制调试 JSON");
}

async function copyMarkdown() {
  if (!state.detail?.session?.id) return;
  const markdown = await fetchText(sourceMarkdownUrl(state.detail.session.id));
  await copyText(markdown);
  showToast("已复制 Markdown");
}

async function downloadMarkdown() {
  if (!state.detail?.session?.id) return;
  const markdown = await fetchText(sourceMarkdownUrl(state.detail.session.id));
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
    text: truncateText(item.text, 4000),
    arguments: truncateText(item.arguments, 4000),
    output: truncateText(item.output, 8000),
    payloadPreview: truncateText(item.payloadPreview, 4000),
  };
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

function buildKeyInspectorEvents(detail) {
  const byIndex = new Map((detail.events || []).map((event) => [event.index, event]));
  const selected = new Map();

  for (const turn of detail.turns || []) {
    const items = turn.items || [];
    const user = items.find((item) => item.type === "user-message" && isUsefulInspectorText(item.text));
    const finalAssistant = [...items].reverse().find((item) => item.type === "assistant-message" && isUsefulInspectorText(item.text));
    const token = [...items].reverse().find((item) => item.type === "token-count");
    for (const item of [user, finalAssistant, token, ...items.filter(isHighValueInspectorItem)]) {
      const event = eventForItem(item, byIndex);
      if (event) selected.set(event.index, event);
    }
  }

  for (const event of detail.events || []) {
    if (isHighValueRawEvent(event)) selected.set(event.index, event);
  }

  return [...selected.values()].sort((left, right) => left.index - right.index);
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

function isHighValueInspectorItem(item) {
  if (!item) return false;
  if (item.status && /error|fail|failed|失败|错误/i.test(item.status)) return true;
  if (item.type !== "tool-call") {
    return /error|fail|failed|失败|错误/i.test([item.eventType, item.responseType, item.phase, item.status].filter(Boolean).join(" "));
  }
  if (/spawn_agent|wait_agent|handoff/i.test(item.name || "")) return true;
  return false;
}

function isHighValueRawEvent(event) {
  const label = `${event.kind || ""}\n${event.title || ""}\n${event.payloadType || ""}`;
  if (/error|fail|failed|失败|错误/i.test(label)) return true;
  if (/spawn_agent|wait_agent|subagent/i.test(label)) return true;
  return false;
}

function samePreview(preview, text) {
  const left = normalizeInspectorText(preview).slice(0, 80);
  const right = normalizeInspectorText(text).slice(0, 80);
  return Boolean(left && right && (left.includes(right) || right.includes(left)));
}

function isUsefulInspectorText(text) {
  const normalized = normalizeInspectorText(text);
  if (!normalized) return false;
  if (/AGENTS\.md instructions/i.test(normalized)) return false;
  if (/<INSTRUCTIONS>/i.test(normalized)) return false;
  if (/^<permissions instructions>/i.test(normalized)) return false;
  if (/^Continue working toward the active thread goal/i.test(normalized)) return false;
  if (/^<environment_context>/i.test(normalized)) return false;
  return true;
}

function normalizeInspectorText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function groupEventsByTurn(events) {
  const turns = state.detail?.turns || [];
  if (turns.length === 0) return [{ label: "关键事件", events }];
  const groups = turns.map((turn, index) => ({
    label: `Turn ${turn.turnNumber || index + 1}`,
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
  if (kind === "token_count" || event.payloadType === "token_count") return "Token 统计";
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
  if (type === "turn") return "Turn";
  if (type === "tool") return "工具";
  if (type === "handoff") return "委派";
  if (type === "subagent") return "子代理";
  if (type === "message") return "消息";
  if (type === "reasoning") return "推理";
  if (type === "metric") return "指标";
  return type || "节点";
}

function emptyInspectorSection(title, subtitle) {
  return `
    <div class="section-title-row">
      <h3>${escapeHtml(title)}</h3>
    </div>
    <div class="selection-empty">${escapeHtml(subtitle)}</div>
  `;
}

async function copyInspectorText(text, message) {
  if (!text) {
    showToast("没有可复制内容");
    return;
  }
  await copyText(String(text));
  showToast(message);
}

function selectedSource() {
  return state.sources.find((source) => source.id === state.selectedSourceId) || null;
}

function sourceLabel(source) {
  const status = source.status || {};
  const suffix = source.kind === "remote" && status.stale ? "旧快照" : source.kind === "remote" ? "远程" : "本机";
  return `${source.label || source.id} (${suffix})`;
}

function upsertSource(source) {
  const index = state.sources.findIndex((candidate) => candidate.id === source.id);
  if (index >= 0) {
    state.sources.splice(index, 1, source);
  } else {
    state.sources.push(source);
  }
}

function sourceSessionsUrl() {
  return `/api/sources/${encodeURIComponent(state.selectedSourceId)}/sessions`;
}

function sourceSessionUrl(id) {
  return `/api/sources/${encodeURIComponent(state.selectedSourceId)}/sessions/${encodeURIComponent(id)}`;
}

function sourceEventUrl(id, index) {
  return `/api/sources/${encodeURIComponent(state.selectedSourceId)}/sessions/${encodeURIComponent(id)}/events/${index}`;
}

function sourceMarkdownUrl(id) {
  return `/api/sources/${encodeURIComponent(state.selectedSourceId)}/sessions/${encodeURIComponent(id)}/markdown`;
}

function sessionKey(session) {
  return `${session.sourceId || state.selectedSourceId || "local"}:${session.id}`;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { cache: "no-store", ...options });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(errorText(text, response.statusText));
  }
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(errorText(text, response.statusText));
  }
  return response.text();
}

function errorText(text, fallback) {
  try {
    const parsed = JSON.parse(text);
    return parsed.error?.message || parsed.error || parsed.details?.message || fallback;
  } catch {
    return text || fallback;
  }
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

function renderMarkdownMessage(text, query) {
  const html = markdownToHtml(text);
  return `<div class="message-text markdown-body">${highlightHtmlText(html, query)}</div>`;
}

function renderMarkdownTitle(text, query = "") {
  const html = markdownInlineToHtml(text);
  return highlightHtmlText(html, query);
}

function renderDetailValue(key, value) {
  const text = value || "n/a";
  if (key === "标题") return `<span class="markdown-inline-title">${renderMarkdownTitle(text)}</span>`;
  return escapeHtml(text);
}

function renderSubagentMiniTitle(thread) {
  const parts = [];
  if (thread.agentRole) parts.push(escapeHtml(thread.agentRole));
  if (thread.title) parts.push(`<span class="markdown-inline-title">${renderMarkdownTitle(thread.title)}</span>`);
  return parts.join(" · ") || "";
}

function markdownToHtml(value) {
  const text = String(value || "");
  const key = `block:${text}`;
  const cached = markdownCache.get(key);
  if (cached != null) return cached;
  const html = markdownRenderer ? markdownRenderer.render(text) : `<p>${escapeHtml(text).replace(/\n/g, "<br />")}</p>`;
  setMarkdownCache(key, html);
  return html;
}

function markdownInlineToHtml(value) {
  const text = String(value || "");
  const key = `inline:${text}`;
  const cached = markdownCache.get(key);
  if (cached != null) return cached;
  const html = markdownRenderer ? markdownRenderer.renderInline(text) : escapeHtml(text);
  setMarkdownCache(key, html);
  return html;
}

function setMarkdownCache(key, html) {
  markdownCache.set(key, html);
  if (markdownCache.size > markdownCacheLimit) {
    const firstKey = markdownCache.keys().next().value;
    markdownCache.delete(firstKey);
  }
  return html;
}
