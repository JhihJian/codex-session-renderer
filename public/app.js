const rawEventCacheLimits = {
  maxEntries: 24,
  maxBytes: 8 * 1024 * 1024,
};

const { createRawEventCache } = window.RawEventCache;

const state = {
  sources: [],
  selectedSourceId: "local",
  sessions: [],
  filteredSessions: [],
  collapsedSessionDirectoryKeys: new Set(),
  sessionsLoading: false,
  sessionsLoadError: "",
  healthLoadError: "",
  sessionsRequestKey: "",
  sessionsRequestSeq: 0,
  sessionsAbortController: null,
  historyLoading: false,
  historyLoadError: "",
  historyLoaded: false,
  historyRequestKey: "",
  historyRequestSeq: 0,
  historyAbortController: null,
  sessionListScopeVersion: 0,

  mobilePanelNavigationVersion: 0,
  sessionLoading: false,
  sessionLoadError: "",
  sessionRequestKey: "",
  pendingSessionTitle: "",
  selectedSessionId: null,
  selectedSessionKey: null,
  detail: null,
  selectedItemRef: null,
  selectedEventIndex: null,
  selectedRawEvent: null,
  selectedDetailsNodeId: null,

  selectedTraceNodeId: null,

  selectedTerminalBlockId: null,
  expandedTraceNodeIds: new Set(),
  rawEventCache: createRawEventCache(rawEventCacheLimits),
  rawDiagnostic: null,
  viewMode: "compact",
  diagnosticMode: "stats",
  toolContextQuery: "",
  toolContextSort: "output-bytes",

  sessionTimeFilter: "realtime",
  visibleEvents: 40,
  visibleThreadItems: 140,

  summaryRules: [],
  settingsView: "summary",
  settingsInitialSnapshot: "",
  settingsValidationErrors: [],
  settingsValidationMessage: "",
  settingsFeedbackMessage: "",
  settingsFeedbackStatus: "",
  settingsDialogOpener: null,


  alternateLocalSource: null,
  alternateLocalSourceLoading: false,
  alternateLocalSourceRequestKey: "",
  alternateLocalSourceScope: "",
  workbenchStatus: { key: "initial", message: "等待首次加载" },
  lastAnnouncement: "",
};

const {
  buildSessionDirectoryTree,
  compactNumber,
  cssEscape,
  escapeAttr,
  escapeHtml,
  firstLine,
  formatBytes,
  formatDate,
  formatShortDate,
  highlight,
  highlightHtmlText,
  nestSessionChains,
  normalizeMarkdownForRendering,
  prettyMaybeJson,
  sessionTimeBucket,
  shortPath,
} = window.AppFormat;
const { buildEvidenceId } = window.EvidenceId;

const markdownCache = new Map();
let sessionAbortController = null;
let rawDiagnosticAbortController = null;
let rawEventAbortController = null;

let alternateLocalSourceAbortController = null;
let sessionSearchTimer = null;
let compactTimelineObserver = null;
let compactTimelineJumpTarget = "";
const markdownCacheLimit = 700;

const visibleViewModes = new Set(["compact", "trace", "diagnostic"]);
let overflowTooltipFrame = 0;
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
  markdownRenderer.renderer.rules.fence = renderMarkdownFence;
}

const localServiceUnavailableMessage = "无法连接本机服务。请确认服务已启动后点击刷新列表重试。";

const clientErrorMessages = new Map([
  ["Bad Request", "请求无效"],
  ["Bad request", "请求无效"],
  ["Data source not found", "数据源不存在"],
  ["Event not found", "事件不存在"],
  ["Forbidden", "禁止访问该资源"],
  ["Internal Server Error", "服务内部错误"],
  ["Internal server error", "服务内部错误"],

  ["Invalid JSON body", "请求体不是有效 JSON"],
  ["Method Not Allowed", "请求方法不允许"],
  ["Method not allowed", "请求方法不允许"],
  ["Not Found", "未找到资源"],
  ["Not found", "未找到资源"],
  ["Request body too large", "请求体过大"],
  ["Session not found", "会话不存在"],
  ["Unauthorized", "未授权访问"],
]);

const statusErrorMessages = new Map([
  [400, "请求无效"],
  [401, "未授权访问"],
  [403, "禁止访问该资源"],
  [404, "未找到资源"],
  [405, "请求方法不允许"],
  [413, "请求体过大"],
  [500, "服务内部错误"],
  [502, "上游服务不可用"],
  [503, "服务暂不可用"],
  [504, "上游服务响应超时"],
]);

const els = {
  appShell: document.getElementById("appShell"),
  healthStatus: document.getElementById("healthStatus"),
  sessionsPanel: document.getElementById("sessionsPanel"),
  threadPanel: document.getElementById("threadPanel"),
  toolDetailsContent: document.getElementById("toolDetailsContent"),




  sessionCount: document.getElementById("sessionCount"),
  sessionList: document.getElementById("sessionList"),
  sessionSearch: document.getElementById("sessionSearch"),
  sessionTimeFilter: document.getElementById("sessionTimeFilter"),
  sessionTypeFilter: document.getElementById("sessionTypeFilter"),

  itemSearch: document.getElementById("itemSearch"),
  itemTypeFilter: document.getElementById("itemTypeFilter"),
  importantOnly: document.getElementById("importantOnly"),
  importantOnlyControl: document.getElementById("importantOnlyControl"),
  importantOnlyLabel: document.getElementById("importantOnlyLabel"),
  sessionMetaLabel: document.getElementById("sessionMetaLabel"),
  sessionTitle: document.getElementById("sessionTitle"),
  sessionLineage: document.getElementById("sessionLineage"),
  sessionHandoff: document.getElementById("sessionHandoff"),
  sessionFilterNotice: document.getElementById("sessionFilterNotice"),
  sessionFilterNoticeText: document.getElementById("sessionFilterNoticeText"),
  clearSessionFiltersButton: document.getElementById("clearSessionFiltersButton"),
  returnRealtimeButton: document.getElementById("returnRealtimeButton"),
  statsStrip: document.getElementById("statsStrip"),

  threadContent: document.getElementById("threadContent"),
  compactContent: document.getElementById("compactContent"),
  terminalContent: document.getElementById("terminalContent"),
  executionWorkspace: document.getElementById("executionWorkspace"),

  statsContent: document.getElementById("statsContent"),
  diagnosticContent: document.getElementById("diagnosticContent"),
  traceContent: document.getElementById("traceContent"),
  rawContent: document.getElementById("rawContent"),

  toast: document.getElementById("toast"),

  refreshButton: document.getElementById("refreshButton"),
  sourceSelect: document.getElementById("sourceSelect"),
  sourceStatus: document.getElementById("sourceStatus"),
  settingsButton: document.getElementById("settingsButton"),
  settingsDialog: document.getElementById("settingsDialog"),
  settingsForm: document.getElementById("settingsForm"),
  closeSettingsDialogButton: document.getElementById("closeSettingsDialogButton"),
  settingsOverview: document.getElementById("settingsOverview"),
  settingsTabs: document.getElementById("settingsTabs"),
  summaryRuleList: document.getElementById("summaryRuleList"),
  defaultSummaryRuleList: document.getElementById("defaultSummaryRuleList"),

  addSummaryRuleButton: document.getElementById("addSummaryRuleButton"),
  resetSummaryRulesButton: document.getElementById("resetSummaryRulesButton"),

  saveSettingsButton: document.getElementById("saveSettingsButton"),
  cancelSettingsButton: document.getElementById("cancelSettingsButton"),
  settingsStatus: document.getElementById("settingsStatus"),

  statusSource: document.getElementById("statusSource"),
  statusSession: document.getElementById("statusSession"),
  statusEvents: document.getElementById("statusEvents"),
  statusUpdated: document.getElementById("statusUpdated"),
  statusbar: document.getElementById("statusbar"),
  workbenchOperationStatus: document.getElementById("workbenchOperationStatus"),
  workbenchAnnouncements: document.getElementById("workbenchAnnouncements"),

  compactViewButton: document.getElementById("compactViewButton"),
  traceViewButton: document.getElementById("traceViewButton"),
  statsViewButton: document.getElementById("statsViewButton"),
  rawViewButton: document.getElementById("rawViewButton"),
  diagnosticViewButton: document.getElementById("diagnosticViewButton"),
  diagnosticSwitch: document.getElementById("diagnosticSwitch"),
  viewSwitch: document.querySelector(".view-switch"),
  toggleLeft: document.getElementById("toggleLeft"),
};

const standardItemTypeOptions = [
  ["all", "全部内容"],
  ["message", "用户/助手消息"],
  ["tool", "工具与命令"],
  ["output", "工具输出"],
  ["reasoning", "推理摘要"],
  ["compact", "上下文压缩"],
  ["system", "系统事件"],
  ["error", "错误事件"],
];

const rawItemTypeOptions = standardItemTypeOptions.map(([value, label]) => [value, value === "all" ? "全部事件" : label]);

const settingsViewOptions = [
  { id: "summary", label: "摘要规则" },
  { id: "structured", label: "结构化展示" },
];
const settingsViewIds = new Set(settingsViewOptions.map((view) => view.id));

init();

function init() {
  state.summaryRules = window.ToolSummary?.loadCustomRules?.() || [];
  initializeOverflowTooltips();
  bindEvents();
  syncPanelToggleLabels();
  syncMobilePanelNavigation();
  loadHealthAndSources();
}

function handleDialogEscapeKey(event) {
  if (event.key !== "Escape") return;
  const dialogs = [...document.querySelectorAll("dialog[open]")];
  dialogs.at(-1)?.close();
}

function bindEvents() {
  els.refreshButton.addEventListener("click", () => {
    if (state.healthLoadError) {
      void loadHealthAndSources({ announce: true });
      return;
    }
    void refreshCurrentSessionList({ announce: true });
  });
  document.addEventListener("click", (event) => {
    void handleMarkdownCodeCopy(event).catch((error) => console.warn("复制代码失败", error));
  });
  document.addEventListener("keydown", handleDialogEscapeKey);
  els.sourceSelect.addEventListener("change", () => selectSource(els.sourceSelect.value));
  els.settingsButton?.addEventListener("click", openSettingsDialog);
  els.closeSettingsDialogButton?.addEventListener("click", requestCloseSettingsDialog);
  els.cancelSettingsButton?.addEventListener("click", requestCloseSettingsDialog);
  els.settingsDialog?.addEventListener("cancel", (event) => {
    event.preventDefault();
    requestCloseSettingsDialog();
  });
  els.settingsForm?.addEventListener("submit", saveSettingsFromForm);
  els.settingsTabs?.addEventListener("click", selectSettingsViewFromEvent);
  els.settingsOverview?.addEventListener("click", selectSettingsViewFromEvent);
  els.addSummaryRuleButton?.addEventListener("click", () => {
    clearSettingsValidationState();
    state.summaryRules.push(newSummaryRule());
    state.settingsView = "summary";
    renderSettingsDialog();
  });
  els.resetSummaryRulesButton?.addEventListener("click", () => {
    clearSettingsValidationState();
    state.summaryRules = [];
    state.settingsView = "summary";
    renderSettingsDialog();
  });

  els.sessionSearch.addEventListener("input", () => {
    invalidateSessionListRequests();
    clearTimeout(sessionSearchTimer);
    sessionSearchTimer = setTimeout(() => {
      if (state.sessionTimeFilter === "earlier") void loadHistoricalSessions({ announce: true });
      else void loadSessions({ announce: true });
    }, 180);
  });
  els.sessionTimeFilter.querySelectorAll("[data-session-time]").forEach((button) => {
    button.addEventListener("click", () => {
      selectSessionTimeFilter(button.dataset.sessionTime || "realtime");
    });
  });
  els.sessionTypeFilter.addEventListener("change", () => {
    invalidateSessionListRequests();
    if (state.sessionTimeFilter === "earlier") {
      state.sessions = state.sessions.filter((session) => sessionTimeBucket(session) !== "earlier");
      state.historyLoaded = false;
      void loadHistoricalSessions({ announce: true });
    }
    else void loadSessions({ announce: true });
  });

  els.clearSessionFiltersButton?.addEventListener("click", clearSessionFiltersForSelectedSession);
  els.returnRealtimeButton?.addEventListener("click", returnToRealtimeSessions);
  els.itemSearch.addEventListener("input", () => {
    state.visibleThreadItems = 140;

    renderMainContent();
  });
  els.itemTypeFilter.addEventListener("change", () => {
    state.visibleThreadItems = 140;
    renderMainContent();
  });
  els.importantOnly?.addEventListener("change", renderMainContent);
  els.compactViewButton.addEventListener("click", () => setViewMode("compact"));
  els.traceViewButton.addEventListener("click", () => setViewMode("trace"));
  els.diagnosticViewButton.addEventListener("click", () => setViewMode("diagnostic"));
  els.statsViewButton.addEventListener("click", () => setDiagnosticMode("stats"));
  els.rawViewButton.addEventListener("click", () => setDiagnosticMode("raw"));

  bindRovingTablist(els.sessionTimeFilter, "[data-session-time]", (button) => selectSessionTimeFilter(button.dataset.sessionTime || "realtime"));
  bindRovingTablist(els.viewSwitch, "[data-view-mode]", (button) => setViewMode(button.dataset.viewMode || "compact"));
  bindRovingTablist(els.diagnosticSwitch, "[data-diagnostic-mode]", (button) => setDiagnosticMode(button.dataset.diagnosticMode || "stats"));

  bindRovingTablist(els.settingsTabs, "[data-settings-view]", (button) => selectSettingsView(button.dataset.settingsView || "summary"));


  els.toggleLeft.addEventListener("click", () => {
    const next = els.appShell.dataset.left === "open" ? "closed" : "open";
    els.appShell.dataset.left = next;
    syncPanelToggleLabels();
  });
  window.addEventListener("resize", () => {
    syncMobilePanelNavigation();
    syncPanelToggleLabels();
    scheduleOverflowTooltipSync();
  });
  document.querySelectorAll("[data-panel-target]").forEach((button) => {
    button.addEventListener("click", () => {
      setMobilePanel(button.dataset.panelTarget, { userInitiated: true });
    });
  });
  bindRovingTablist(document.querySelector(".mobile-tabs"), "[data-panel-target]", (button) => setMobilePanel(button.dataset.panelTarget, { userInitiated: true }));
}

function bindRovingTablist(tablist, selector, activate) {
  if (!tablist) return;
  tablist.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const current = event.target.closest(selector);
    if (!current || !tablist.contains(current)) return;
    const tabs = Array.from(tablist.querySelectorAll(selector)).filter((button) => !button.disabled);
    if (!tabs.length) return;
    const currentIndex = Math.max(0, tabs.indexOf(current));
    let nextIndex = currentIndex;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (currentIndex + 1) % tabs.length;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    const next = tabs[nextIndex];
    if (!next) return;
    event.preventDefault();
    if (next === current) return;
    activate(next);
    next.focus({ preventScroll: true });
  });
}

function createRawDiagnosticState() {
  return {
    sessionKey: "",
    pages: [],
    pageIndex: 0,
    loading: false,
    error: "",
    readState: null,
    requestSeq: 0,
  };
}

function cancelRawDiagnosticRequest({ clear = false } = {}) {
  rawDiagnosticAbortController?.abort();
  rawDiagnosticAbortController = null;
  if (!state.rawDiagnostic) state.rawDiagnostic = createRawDiagnosticState();
  state.rawDiagnostic.loading = false;
  if (clear) {
    state.rawDiagnostic = createRawDiagnosticState();
    clearRawEventCache();
  }
}

function cancelRawEventRequest() {
  rawEventAbortController?.abort();
  rawEventAbortController = null;
}

function clearRawEventCache() {
  state.rawEventCache.clear();
}

function syncPanelToggleLabels() {
  const mobile = mobilePanelLayoutActive();
  const leftOpen = els.appShell.dataset.left !== "closed";
  const leftLabel = leftOpen ? "隐藏会话列表" : "显示会话列表";
  els.toggleLeft.hidden = mobile;
  els.toggleLeft.tabIndex = mobile ? -1 : 0;
  els.toggleLeft.title = leftLabel;
  els.toggleLeft.setAttribute("aria-label", leftLabel);
  els.toggleLeft.setAttribute("aria-expanded", !mobile && leftOpen ? "true" : "false");
  syncPanelVisibilityState();
}

function mobilePanelLayoutActive() {
  return window.matchMedia("(width <= 820px)").matches;
}

function mobilePanelTab(panel) {
  return document.querySelector('[data-panel-target="' + panel + '"]');
}

function setMobilePanel(panel, { userInitiated = false } = {}) {
  const next = ["sessions", "thread"].includes(panel) ? panel : "thread";
  if (userInitiated) state.mobilePanelNavigationVersion += 1;
  els.appShell.dataset.panel = next;
  syncMobilePanelNavigation();
}

function syncMobilePanelNavigation() {
  const mobile = mobilePanelLayoutActive();
  const activePanel = els.appShell.dataset.panel || "thread";
  document.querySelectorAll("[data-panel-target]").forEach((button) => {
    const active = mobile && button.dataset.panelTarget === activePanel;
    button.setAttribute("aria-selected", active ? "true" : "false");
    button.tabIndex = active ? 0 : -1;
  });
  syncPanelVisibilityState();
}

function syncPanelVisibilityState() {
  const mobile = mobilePanelLayoutActive();
  const activePanel = els.appShell.dataset.panel || "thread";
  const panels = [
    [els.sessionsPanel, mobile ? activePanel === "sessions" : els.appShell.dataset.left !== "closed", mobile ? mobilePanelTab("sessions") : els.toggleLeft],
    [els.threadPanel, mobile ? activePanel === "thread" : true, mobile ? mobilePanelTab("thread") : null],
  ];
  panels.forEach(([panel, open, fallback]) => {
    moveFocusBeforeHidingPanel(panel, fallback, open);
    setPanelInteractivity(panel, open);
  });
}

function moveFocusBeforeHidingPanel(panel, fallback, open) {
  if (open || !panel?.contains(document.activeElement)) return;
  fallback?.focus({ preventScroll: true });
}

function setPanelInteractivity(panel, open) {
  if (!panel) return;
  panel.hidden = !open;
  panel.inert = !open;
  panel.setAttribute("aria-hidden", open ? "false" : "true");
}

async function loadHealthAndSources({ announce = false } = {}) {
  state.healthLoadError = "";
  setBusy(true);
  try {
    const health = await fetchJson("/api/health");
    state.sources = health.sources || [];
    state.selectedSourceId = health.defaultSourceId || "local";
    state.sessionsLoadError = "";
    renderSourceControls();
    els.healthStatus.textContent = health.sources?.length > 1 ? `数据源 ${health.sources.length} 个` : `只读数据源 ${health.codexHome}`;
    await loadSessions({ announce });
  } catch (error) {
    const message = healthUnavailableMessage(error);
    state.healthLoadError = message;
    state.sources = [{ id: "local", label: "本机 Codex Home", kind: "local", status: { error: { message } } }];
    state.selectedSourceId = "local";
    state.sessions = [];
    state.filteredSessions = [];
    state.sessionsLoading = false;
    state.sessionsLoadError = message;
    setWorkbenchStatus("health:error", `接口不可用：${message}。点击刷新列表重试。`, { announce: true });
    clearSelectedSession();
    setBusy(false);
    els.healthStatus.textContent = `接口不可用：${message}`;
    renderSourceControls();
    renderAll();
  }
}

function renderSourceControls() {
  if (!state.sources.length) {
    els.sourceSelect.innerHTML = `<option value="local">本机 Codex Home</option>`;
    state.sources = [{ id: "local", label: "本机 Codex Home", kind: "local", status: {} }];
  } else {
    els.sourceSelect.innerHTML = state.sources
      .map((source) => `<option value="${escapeAttr(source.id)}">${escapeHtml(sourceLabel(source))}</option>`)
      .join("");
  }
  els.sourceSelect.value = state.selectedSourceId;
  renderSourceStatus();
}

function renderSourceStatus() {
  if (state.healthLoadError) {
    els.sourceStatus.textContent = `接口不可用：${state.healthLoadError}`;
    els.sourceStatus.hidden = false;
    renderStatusbar();
    return;
  }
  const source = selectedSource();
  if (!source) {
    els.sourceStatus.textContent = "数据源不存在";
    els.sourceStatus.hidden = false;
    renderStatusbar();
    return;
  }
  const status = source.status || {};
  const parts = [source.kind === "pi-agent" ? "Pi Agent 本机目录" : "本机 Codex 目录"];
  if (status.error?.message) parts.push(status.error.message);
  if (state.sessionTimeFilter === "earlier") {
    if (state.historyLoading) parts.push("历史会话读取中");
    else if (state.historyLoadError) parts.push(`历史会话失败：${state.historyLoadError}`);
  }
  els.sourceStatus.textContent = parts.join(" · ");
  els.sourceStatus.hidden = !(status.error?.message || state.historyLoadError);
  renderStatusbar();
}

function selectSessionTimeFilter(bucket) {
  const next = bucket || "realtime";
  const changed = next !== state.sessionTimeFilter;
  if (changed) invalidateSessionListRequests();
  state.sessionTimeFilter = next;
  if (state.sessionTimeFilter === "earlier" && !state.historyLoaded) {
    renderSessionList();
    void loadHistoricalSessions({ announce: true });
  } else {
    renderSessionList();
    selectFirstVisibleSession();
  }
}

async function loadSessions({ announce = false } = {}) {
  cancelAlternateLocalSourceDiscovery();
  const sourceId = state.selectedSourceId;
  const scopeVersion = state.sessionListScopeVersion;
  const controller = new AbortController();
  state.sessionsAbortController?.abort();
  state.sessionsAbortController = controller;
  const requestKey = `sessions:${++state.sessionsRequestSeq}:${sourceId}:recent24h:${scopeVersion}`;
  state.sessionsRequestKey = requestKey;
  state.sessionsLoading = true;
  state.sessionsLoadError = "";
  state.historyAbortController?.abort();
  state.historyAbortController = null;
  state.historyLoading = false;
  state.historyLoadError = "";
  state.historyLoaded = false;
  state.historyRequestKey = `inactive:${++state.historyRequestSeq}`;
  const operationKey = `${requestKey}:status`;
  setWorkbenchStatus(operationKey, `正在加载${selectedSource()?.label || "当前数据源"}会话列表`, { announce });
  setBusy(true);
  renderSessionList();
  try {
    const data = await fetchJson(sourceSessionsUrl(sourceId, "recent24h"), { signal: controller.signal });
    if (!sessionListRequestIsCurrent({ requestKey, sourceId, scopeVersion, kind: "sessions" })) return;
    requireSourceResponse(data, sourceId, "sessions", "recent24h");
    state.healthLoadError = "";
    if (data.source) upsertSource(data.source);
    state.sessions = data.sessions || [];
    state.historyLoaded = false;
    state.sessionsLoading = false;
    state.sessionsLoadError = "";
    setWorkbenchStatus(operationKey, `会话列表已加载：${state.sessions.length} 个会话`, { announce });
    setBusy(false);
    renderSourceStatus();
    renderSessionList();
    void discoverAlternateLocalSource();
    const nextSession = state.selectedSessionKey ? null : state.filteredSessions[0];
    if (!sessionListRequestIsCurrent({ requestKey, sourceId, scopeVersion, kind: "sessions" })) return;
    if (nextSession) {
      await selectSession(nextSession.id, { announce: false });
    } else if (!state.selectedSessionKey) {
      clearSelectedSession();
      renderAll();
    }
    if (!sessionListRequestIsCurrent({ requestKey, sourceId, scopeVersion, kind: "sessions" })) return;
  } catch (error) {
    if (isAbortError(error) || !sessionListRequestIsCurrent({ requestKey, sourceId, scopeVersion, kind: "sessions" })) return;
    showToast(`加载会话失败：${error.message}`);
    if (error.message?.includes("无法连接本机服务")) {
      state.healthLoadError = localServiceUnavailableMessage;
      els.healthStatus.textContent = `接口不可用：${state.healthLoadError}`;
    }
    state.sessions = [];
    state.filteredSessions = [];
    state.sessionsLoading = false;
    state.sessionsLoadError = error.message;
    setWorkbenchStatus(operationKey, `会话列表加载失败：${error.message}。点击刷新列表重试。`, { announce: true });
    if (!state.selectedSessionKey) clearSelectedSession();
    renderAll();
  } finally {
    if (state.sessionsAbortController === controller) state.sessionsAbortController = null;
    if (sessionListRequestIsCurrent({ requestKey, sourceId, scopeVersion, kind: "sessions" })) {
      state.sessionsLoading = false;
      setBusy(false);
      renderSourceStatus();
      renderSessionList();
    }
  }
}

function selectFirstVisibleSession() {
  const nextSession = state.filteredSessions[0];
  if (state.selectedSessionKey || !nextSession) return;
  void selectSession(nextSession.id);
}

function cancelAlternateLocalSourceDiscovery({ clear = true } = {}) {
  alternateLocalSourceAbortController?.abort();
  alternateLocalSourceAbortController = null;
  state.alternateLocalSourceLoading = false;
  state.alternateLocalSourceRequestKey = "";
  if (clear) {
    state.alternateLocalSource = null;
    state.alternateLocalSourceScope = "";
  }
}

function alternateLocalSourceCandidate() {
  return state.sources.find((source) => source.id !== state.selectedSourceId && source.kind === "pi-agent" && !source.status?.error) || null;
}

function canDiscoverAlternateLocalSource() {
  return Boolean(
    state.selectedSourceId === "local" &&
      state.sessionTimeFilter === "realtime" &&
      !els.sessionSearch.value.trim() &&
      els.sessionTypeFilter.value === "all" &&
      !state.sessionsLoading &&
      !state.sessionsLoadError &&
      !state.sessions.some((session) => sessionTimeBucket(session) === state.sessionTimeFilter) &&
      alternateLocalSourceCandidate(),
  );
}

function alternateLocalSourceDiscoveryCurrent(requestKey) {
  return state.alternateLocalSourceRequestKey === requestKey && canDiscoverAlternateLocalSource();
}

function alternateLocalSourceResult(data, source) {
  const visibleCount = (data.sessions || []).filter((session) => sessionTimeBucket(session) === state.sessionTimeFilter).length;
  return visibleCount > 0 ? { id: source.id, label: data.source?.label || source.label || source.id } : null;
}

function alternateLocalSourceDiscoveryFailed(error, requestKey) {
  return !isAbortError(error) && state.alternateLocalSourceRequestKey === requestKey;
}

async function discoverAlternateLocalSource() {
  const source = alternateLocalSourceCandidate();
  const scope = `${state.selectedSourceId}:${state.sessionTimeFilter}`;
  if (!canDiscoverAlternateLocalSource() || state.alternateLocalSourceLoading || state.alternateLocalSourceScope === scope) return;
  cancelAlternateLocalSourceDiscovery({ clear: false });
  state.alternateLocalSourceScope = scope;
  state.alternateLocalSourceLoading = true;
  const controller = new AbortController();
  alternateLocalSourceAbortController = controller;
  const requestKey = `${scope}:${source.id}:${Date.now()}`;
  state.alternateLocalSourceRequestKey = requestKey;
  try {
    const data = await fetchJson(sourceSessionsUrl(source.id, "recent24h"), { signal: controller.signal });
    if (!alternateLocalSourceDiscoveryCurrent(requestKey)) return;
    requireSourceResponse(data, source.id, "sessions", "recent24h");
    if (data.source) upsertSource(data.source);
    state.alternateLocalSource = alternateLocalSourceResult(data, source);
  } catch (error) {
    if (alternateLocalSourceDiscoveryFailed(error, requestKey)) state.alternateLocalSource = null;
  } finally {
    if (alternateLocalSourceAbortController === controller) alternateLocalSourceAbortController = null;
    if (state.alternateLocalSourceRequestKey === requestKey) {
      state.alternateLocalSourceLoading = false;
      renderSessionList();
    }
  }
}

async function loadHistoricalSessions({ announce = false } = {}) {
  const sourceId = state.selectedSourceId;
  const scopeVersion = state.sessionListScopeVersion;
  const controller = new AbortController();
  state.historyAbortController?.abort();
  state.historyAbortController = controller;
  const requestKey = `history:${++state.historyRequestSeq}:${sourceId}:history:${scopeVersion}`;
  state.historyRequestKey = requestKey;
  state.historyLoading = true;
  state.sessionsLoadError = "";
  state.historyLoadError = "";
  const operationKey = `${requestKey}:status`;
  setWorkbenchStatus(operationKey, "正在读取更早会话", { announce });
  setBusy(true);
  renderSourceStatus();
  renderSessionList();
  try {
    const data = await fetchJson(sourceSessionsUrl(sourceId, "history"), { signal: controller.signal });
    if (!sessionListRequestIsCurrent({ requestKey, sourceId, scopeVersion, kind: "history" })) return;
    requireSourceResponse(data, sourceId, "sessions", "history");
    if (data.source) upsertSource(data.source);
    const priorSessions = state.sessions.filter((session) => sessionTimeBucket(session) !== "earlier");
    const byKey = new Map(priorSessions.map((session) => [sessionKey(session), session]));
    for (const session of data.sessions || []) byKey.set(sessionKey(session), session);
    state.sessions = [...byKey.values()];
    state.historyLoaded = true;
    state.historyLoadError = "";
    setWorkbenchStatus(operationKey, `更早会话已加载：${state.sessions.length} 个会话`, { announce });
  } catch (error) {
    if (isAbortError(error) || !sessionListRequestIsCurrent({ requestKey, sourceId, scopeVersion, kind: "history" })) return;
    state.historyLoadError = error.message;
    setWorkbenchStatus(operationKey, `更早会话读取失败：${error.message}。可重试更早会话或刷新列表重试。`, { announce: true });
    showToast(`加载历史会话失败：${error.message}`);
  } finally {
    if (state.historyAbortController === controller) state.historyAbortController = null;
    if (sessionListRequestIsCurrent({ requestKey, sourceId, scopeVersion, kind: "history" })) {
      state.historyLoading = false;
      setBusy(false);
      renderSourceStatus();
      renderSessionList();
      selectFirstVisibleSession();
    }
  }
}

function refreshCurrentSessionList({ announce = false } = {}) {
  cancelRawDiagnosticRequest({ clear: true });
  cancelRawEventRequest();
  if (state.sessionTimeFilter === "earlier") {
    void loadHistoricalSessions({ announce });
    return;
  }
  void loadSessions({ announce });
}

function invalidateSessionListRequests() {
  state.sessionListScopeVersion += 1;
  state.sessionsAbortController?.abort();
  state.sessionsAbortController = null;
  state.historyAbortController?.abort();
  state.historyAbortController = null;
  state.sessionsRequestKey = `inactive:${++state.sessionsRequestSeq}`;
  state.historyRequestKey = `inactive:${++state.historyRequestSeq}`;
  state.sessionsLoading = false;
  state.historyLoading = false;
}

function sessionListRequestIsCurrent({ requestKey, sourceId, scopeVersion, kind }) {
  const expectedRequestKey = kind === "history" ? state.historyRequestKey : state.sessionsRequestKey;
  return expectedRequestKey === requestKey && state.selectedSourceId === sourceId && state.sessionListScopeVersion === scopeVersion;
}

function setBusy(isBusy) {
  els.refreshButton.disabled = isBusy;
  els.refreshButton.textContent = "↻";
  els.refreshButton.title = isBusy ? "正在刷新会话列表" : "刷新会话列表";
  els.refreshButton.setAttribute("aria-label", els.refreshButton.title);
}

function setWorkbenchStatus(key, message, { announce = false } = {}) {
  if (state.workbenchStatus.key === key && state.workbenchStatus.message === message) return;
  state.workbenchStatus = { key, message };
  if (els.workbenchOperationStatus) els.workbenchOperationStatus.textContent = `状态：${message}`;
  if (!announce || !els.workbenchAnnouncements) return;
  const announcement = `${key}\n${message}`;
  if (state.lastAnnouncement === announcement) return;
  state.lastAnnouncement = announcement;
  els.workbenchAnnouncements.textContent = message;
}

function syncAsyncAccessibility() {
  setAriaBusy(els.sessionsPanel, state.sessionsLoading || state.historyLoading);
  setAriaBusy(els.threadPanel, state.sessionLoading);
}

function setAriaBusy(element, busy) {
  if (!element) return;
  element.setAttribute("aria-busy", busy ? "true" : "false");
}

async function selectSession(id, { announce = true, focusMobilePanel = true, immediateMobilePanel = false } = {}) {
  sessionAbortController?.abort();
  cancelRawDiagnosticRequest({ clear: true });
  cancelRawEventRequest();
  sessionAbortController = new AbortController();
  const sourceId = state.selectedSourceId;
  const targetSession = findSessionSummary(id);
  const requestKey = `${sourceId}:${id}:${Date.now()}`;
  const mobilePanelNavigationVersion = state.mobilePanelNavigationVersion;
  if (immediateMobilePanel) setMobilePanel("thread");
  state.selectedSessionId = id;
  state.selectedSessionKey = sessionKey({ id, sourceId });
  state.sessionRequestKey = requestKey;
  const operationKey = `${requestKey}:status`;
  state.sessionLoading = true;
  state.sessionLoadError = "";
  state.pendingSessionTitle = targetSession?.displayTitle || id;
  state.detail = null;
  state.selectedItemRef = null;
  state.selectedEventIndex = null;
  state.selectedTraceNodeId = null;
  state.selectedDetailsNodeId = null;
  state.selectedTerminalBlockId = null;
  state.expandedTraceNodeIds = new Set();
  clearRawEventCache();
  state.visibleEvents = 40;
  state.visibleThreadItems = 140;

  setWorkbenchStatus(operationKey, `正在读取会话：${state.pendingSessionTitle}`, { announce });
  renderAll();
  try {
    const detail = await fetchJson(sourceSessionUrl(id, sourceId), { signal: sessionAbortController.signal });
    if (state.sessionRequestKey !== requestKey || state.selectedSourceId !== sourceId) return;
    requireSourceResponse(detail, sourceId, "detail");
    state.detail = detail;
    state.sessionLoading = false;
    state.sessionLoadError = "";
    state.pendingSessionTitle = "";
    state.selectedSourceId = detail.session?.sourceId || state.selectedSourceId;
    state.selectedSessionKey = sessionKey(detail.session || { id, sourceId: state.selectedSourceId });
    primeTraceExpansion(detail);
    setWorkbenchStatus(operationKey, `会话已加载：${selectedSessionDisplayTitle()}`, { announce });
    renderAll();
    if (focusMobilePanel && state.mobilePanelNavigationVersion === mobilePanelNavigationVersion) setMobilePanel("thread");
  } catch (error) {
    if (state.sessionRequestKey !== requestKey || state.selectedSourceId !== sourceId) return;
    state.detail = null;
    state.sessionLoading = false;
    state.sessionLoadError = error.message;
    setWorkbenchStatus(operationKey, `读取会话失败：${error.message}。可重试或选择其他会话。`, { announce: true });
    renderAll();
    showToast(`读取会话失败：${error.message}`);
  }
}

async function reloadSelectedSessionDetail() {
  if (!state.selectedSessionId) return;
  const sourceId = state.selectedSourceId;
  const sessionId = state.selectedSessionId;
  const requestKey = `${sourceId}:${sessionId}:reload:${Date.now()}`;
  sessionAbortController?.abort();
  cancelRawDiagnosticRequest({ clear: true });
  cancelRawEventRequest();
  sessionAbortController = new AbortController();
  state.sessionRequestKey = requestKey;
  let detail;
  try {
    detail = await fetchJson(sourceSessionUrl(sessionId, sourceId), { signal: sessionAbortController.signal });
  } catch (error) {
    if (state.sessionRequestKey !== requestKey || state.selectedSourceId !== sourceId || state.selectedSessionId !== sessionId) return;
    throw error;
  }
  if (state.sessionRequestKey !== requestKey || state.selectedSourceId !== sourceId || state.selectedSessionId !== sessionId) return;
  requireSourceResponse(detail, sourceId, "detail");
  state.detail = detail;
  state.sessionLoading = false;
  state.sessionLoadError = "";
  state.pendingSessionTitle = "";
  state.selectedSourceId = detail.session?.sourceId || state.selectedSourceId;
  state.selectedSessionKey = sessionKey(detail.session || { id: sessionId, sourceId: state.selectedSourceId });
  primeTraceExpansion(detail);
  renderAll();
}

function clearSelectedSession() {
  sessionAbortController?.abort();
  cancelRawDiagnosticRequest({ clear: true });
  cancelRawEventRequest();
  sessionAbortController = null;
  state.selectedSessionId = null;
  state.selectedSessionKey = null;
  state.sessionLoading = false;
  state.sessionLoadError = "";
  state.sessionRequestKey = "";
  state.pendingSessionTitle = "";
  state.detail = null;
  state.selectedItemRef = null;
  state.selectedEventIndex = null;
  state.selectedTraceNodeId = null;
  state.selectedDetailsNodeId = null;
  state.selectedTerminalBlockId = null;
  state.expandedTraceNodeIds = new Set();
  clearRawEventCache();
}

async function selectSource(sourceId) {
  if (!sourceId || sourceId === state.selectedSourceId) return;
  invalidateSessionListRequests();
  cancelAlternateLocalSourceDiscovery();
  state.selectedSourceId = sourceId;
  state.sessions = [];
  state.filteredSessions = [];
  state.sessionsLoadError = "";
  state.sessionsLoading = true;
  clearSelectedSession();
  renderSourceControls();
  renderAll();
  await loadSessions({ announce: true });
}

function openSettingsDialog() {
  const opener = document.activeElement;
  state.settingsDialogOpener = opener && opener !== document.body ? opener : els.settingsButton;
  clearSettingsValidationState();
  state.summaryRules = window.ToolSummary?.loadCustomRules?.() || [];
  normalizeSettingsView();
  state.settingsInitialSnapshot = settingsSnapshot();
  renderSettingsDialog();
  els.settingsDialog?.showModal();
}

function requestCloseSettingsDialog() {
  if (!els.settingsDialog?.open) return true;
  if (settingsDirty() && !window.confirm("放弃更改？")) {
    syncSettingsDirtyState();
    return false;
  }
  restoreSettingsInitialSnapshot();
  clearSettingsValidationState();
  closeSettingsDialogAndRestoreFocus();
  return true;
}

function closeSettingsDialogAndRestoreFocus() {
  els.settingsDialog?.close();
  restoreSettingsDialogFocus();
}

function restoreSettingsDialogFocus() {
  const opener = state.settingsDialogOpener;
  const target = opener && document.contains(opener) ? opener : els.settingsButton;
  state.settingsDialogOpener = null;
  requestAnimationFrame(() => {
    if (target && document.contains(target) && typeof target.focus === "function") {
      target.focus({ preventScroll: true });
    }
  });
}

function selectSettingsViewFromEvent(event) {
  const button = event.target.closest("[data-settings-view]");
  if (!button) return;
  selectSettingsView(button.dataset.settingsView);
}

function selectSettingsView(view) {
  if (!settingsViewIds.has(view)) return;
  state.settingsView = view;
  renderSettingsDialog();
}

function normalizeSettingsView() {
  if (!settingsViewIds.has(state.settingsView)) state.settingsView = "summary";
}

function renderSettingsDialog() {
  normalizeSettingsView();
  renderSettingsOverview();
  renderSettingsTabs();
  syncSettingsPanelVisibility();
  renderActiveSettingsPanel();
  syncSettingsDirtyState();
}

function settingsSnapshot() {
  return JSON.stringify({ summaryRules: state.summaryRules || [] });
}

function settingsDirty() {
  return Boolean(state.settingsInitialSnapshot && settingsSnapshot() !== state.settingsInitialSnapshot);
}

function stableSettingsJson(value) {
  return JSON.stringify(stableSettingsValue(value));
}

function stableSettingsValue(value) {
  if (Array.isArray(value)) return value.map(stableSettingsValue);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      result[key] = stableSettingsValue(value[key]);
      return result;
    }, {});
}

function restoreSettingsInitialSnapshot() {
  if (!state.settingsInitialSnapshot) return;
  try {
    const snapshot = JSON.parse(state.settingsInitialSnapshot);
    state.summaryRules = Array.isArray(snapshot.summaryRules) ? snapshot.summaryRules : [];
  } catch {
    state.summaryRules = window.ToolSummary?.loadCustomRules?.() || [];
  }
}

function syncSettingsDirtyState() {
  const dirty = settingsDirty();
  if (els.saveSettingsButton) {
    els.saveSettingsButton.disabled = !dirty;
    els.saveSettingsButton.title = dirty ? "保存展示规则更改" : "没有未保存更改";
  }
  if (els.settingsStatus) {
    if (state.settingsValidationMessage) {
      els.settingsStatus.textContent = state.settingsValidationMessage;
      els.settingsStatus.dataset.status = "error";
      els.settingsStatus.setAttribute("role", "alert");
      els.settingsStatus.setAttribute("aria-live", "assertive");
      return;
    }
    if (state.settingsFeedbackMessage) {
      els.settingsStatus.textContent = state.settingsFeedbackMessage;
      els.settingsStatus.dataset.status = state.settingsFeedbackStatus || "info";
      els.settingsStatus.setAttribute("role", state.settingsFeedbackStatus === "error" ? "alert" : "status");
      els.settingsStatus.setAttribute("aria-live", state.settingsFeedbackStatus === "error" ? "assertive" : "polite");
      return;
    }
    delete els.settingsStatus.dataset.status;
    els.settingsStatus.removeAttribute("role");
    els.settingsStatus.removeAttribute("aria-live");
    const currentView = settingsViewOptions.find((view) => view.id === state.settingsView);
    const dirtyLabel = dirty ? "有未保存更改" : "没有未保存更改";
    els.settingsStatus.textContent = `${dirtyLabel} · ${currentView?.label || "展示规则"} · 摘要自定义 ${state.summaryRules.length} 条；配置保存在当前浏览器本地。`;
  }
}

function renderSettingsOverview() {
  if (!els.settingsOverview) return;
  els.settingsOverview.innerHTML = settingsOverviewItems()
    .map(
      (item) => `
        <button class="settings-overview-card ${state.settingsView === item.id ? "active" : ""}" type="button" data-settings-view="${escapeAttr(item.id)}">
          <span>${escapeHtml(item.label)}</span>
          <strong>${escapeHtml(item.value)}</strong>
          <em>${escapeHtml(item.detail)}</em>
        </button>
      `,
    )
    .join("");
}

function settingsOverviewItems() {
  const summaryDefaultCount = window.ToolSummary?.defaultRules?.()?.length || 0;
  const summaryActiveCount = window.ToolSummary?.activeRules?.(state.summaryRules)?.length || summaryDefaultCount;

  return [
    {
      id: "summary",
      label: "摘要规则",
      value: `${summaryActiveCount}`,
      detail: `${state.summaryRules.length} 条自定义 · ${summaryDefaultCount} 条内置`,
    },

    {
      id: "structured",
      label: "结构化展示",
      value: "3",
      detail: "Git、搜索、测试检查结构化视图",
    },
  ];
}

function renderSettingsTabs() {
  if (!els.settingsTabs) return;
  els.settingsTabs.querySelectorAll("[data-settings-view]").forEach((button) => {
    const active = button.dataset.settingsView === state.settingsView;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
    button.tabIndex = active ? 0 : -1;
  });
}

function syncSettingsPanelVisibility() {
  document.querySelectorAll("[data-settings-panel]").forEach((section) => {
    section.hidden = section.dataset.settingsPanel !== state.settingsView;
  });
}

function renderActiveSettingsPanel() {
  if (state.settingsView === "summary") {
    renderSummaryRuleList();
    renderDefaultSummaryRuleList();

  }
}

function clearSettingsValidationState() {
  state.settingsValidationErrors = [];
  state.settingsValidationMessage = "";
  state.settingsFeedbackMessage = "";
  state.settingsFeedbackStatus = "";
}

function clearSettingsValidationFeedback() {
  if (!state.settingsValidationErrors?.length && !state.settingsValidationMessage && !state.settingsFeedbackMessage) return;
  clearSettingsValidationState();
  els.settingsForm?.querySelectorAll("[aria-invalid='true']").forEach((input) => {
    input.removeAttribute("aria-invalid");
    input.removeAttribute("aria-describedby");
  });
  els.settingsForm?.querySelectorAll(".rule-field-error").forEach((error) => error.remove());
}

function settingsFieldError(view, index, field) {
  return (state.settingsValidationErrors || []).find((error) => error.view === view && error.index === index && error.field === field);
}

function settingsFieldErrorId(view, index, field) {
  return `settings-${view}-${index}-${field}-error`;
}

function settingsFieldAttrs(view, index, field) {
  const error = settingsFieldError(view, index, field);
  if (!error) return "";
  return `aria-invalid="true" aria-describedby="${escapeAttr(settingsFieldErrorId(view, index, field))}"`;
}

function renderSettingsFieldError(view, index, field) {
  const error = settingsFieldError(view, index, field);
  if (!error) return "";
  return `<span class="rule-field-error" id="${escapeAttr(settingsFieldErrorId(view, index, field))}" role="alert">${escapeHtml(error.message)}</span>`;
}

function validateSettingsRulesForSave() {
  return [
    ...(window.ToolSummary?.validateRulesForSave?.(state.summaryRules) || []).map((error) => ({ ...error, view: "summary" })),

  ];
}

function settingsValidationMessage(errors) {
  const first = errors[0];
  if (!first) return "";
  const viewLabel = settingsViewOptions.find((view) => view.id === first.view)?.label || "设置";
  return `保存失败：${viewLabel}第 ${Number(first.index) + 1} 条，${first.message} 请修正后再保存。`;
}

function focusSettingsValidationError(error) {
  const input = settingsInputForError(error);
  if (!input) return;
  input.focus({ preventScroll: true });
  input.scrollIntoView({ block: "center", inline: "nearest" });
}

function settingsInputForError(error) {
  if (!error) return null;
  const selectors = {
    summary: `[data-rule-field="${error.field}"][data-rule-index="${error.index}"]`,

  };
  const selector = selectors[error.view];
  return selector ? els.settingsForm?.querySelector(selector) : null;
}

function renderSummaryRuleList() {
  if (!els.summaryRuleList) return;
  if (!state.summaryRules.length) {
    els.summaryRuleList.innerHTML = `<div class="rule-empty">暂无自定义规则。新增后会优先匹配，再回退到内置规则。</div>`;
    return;
  }
  els.summaryRuleList.innerHTML = state.summaryRules.map((rule, index) => renderSummaryRuleEditor(rule, index)).join("");
  els.summaryRuleList.querySelectorAll("[data-rule-field]").forEach((input) => {
    input.addEventListener("input", () => updateSummaryRuleFromInput(input));
    input.addEventListener("change", () => updateSummaryRuleFromInput(input));
  });
  els.summaryRuleList.querySelectorAll("[data-delete-rule]").forEach((button) => {
    button.addEventListener("click", () => {
      clearSettingsValidationState();
      state.summaryRules.splice(Number(button.dataset.deleteRule), 1);
      renderSettingsDialog();
    });
  });
}

function renderSummaryRuleEditor(rule, index) {
  const enabled = rule.enabled !== false;
  return `
    <article class="summary-rule-card">
      <div class="summary-rule-head">
        <label class="toggle-control">
          <input type="checkbox" ${enabled ? "checked" : ""} data-rule-field="enabled" data-rule-index="${escapeAttr(String(index))}" />
          <span>启用</span>
        </label>
        <button class="ghost-button small danger" type="button" data-delete-rule="${escapeAttr(String(index))}">删除</button>
      </div>
      <div class="summary-rule-grid">
        <label>
          <span class="field-label">名称（可选，仅用于管理）</span>
          <input class="text-input" type="text" value="${escapeAttr(rule.label || "")}" data-rule-field="label" data-rule-index="${escapeAttr(String(index))}" placeholder="读取文件" />
        </label>
        <label>
          <span class="field-label">工具</span>
          <input class="text-input" type="text" value="${escapeAttr(rule.tool || "")}" data-rule-field="tool" data-rule-index="${escapeAttr(String(index))}" placeholder="exec_command 或 *" ${settingsFieldAttrs("summary", index, "tool")} />
          ${renderSettingsFieldError("summary", index, "tool")}
        </label>
        <label>
          <span class="field-label">标题模板</span>
          <input class="text-input" type="text" value="${escapeAttr(rule.title || "")}" data-rule-field="title" data-rule-index="${escapeAttr(String(index))}" placeholder="读取文件内容" ${settingsFieldAttrs("summary", index, "title")} />
          ${renderSettingsFieldError("summary", index, "title")}
        </label>
        <label>
          <span class="field-label">摘要模板</span>
          <input class="text-input" type="text" value="${escapeAttr(rule.summary || "")}" data-rule-field="summary" data-rule-index="${escapeAttr(String(index))}" placeholder="{path}" />
        </label>
      </div>
      <label>
        <span class="field-label">匹配正则</span>
        <textarea class="text-input rule-pattern-input" data-rule-field="pattern" data-rule-index="${escapeAttr(String(index))}" spellcheck="false" placeholder="\\bGet-Content\\b" ${settingsFieldAttrs("summary", index, "pattern")}>${escapeHtml(rule.pattern || "")}</textarea>
        ${renderSettingsFieldError("summary", index, "pattern")}
      </label>
    </article>
  `;
}

function renderDefaultSummaryRuleList() {
  if (!els.defaultSummaryRuleList) return;
  const rules = window.ToolSummary?.defaultRules?.() || [];
  els.defaultSummaryRuleList.innerHTML = rules
    .map(
      (rule) => `
        <div class="default-rule-row">
          <strong>${escapeHtml(rule.title || rule.label)}</strong>
          <span>${escapeHtml([rule.tool || "*", rule.label].filter(Boolean).join(" · "))}</span>
          <code>${escapeHtml(rule.pattern || "")}</code>
        </div>
      `,
    )
    .join("");
}

function updateSummaryRuleFromInput(input) {
  clearSettingsValidationFeedback();
  const index = Number(input.dataset.ruleIndex);
  const field = input.dataset.ruleField;
  const rule = state.summaryRules[index];
  if (!rule || !field) return;
  rule[field] = field === "enabled" ? input.checked : input.value;
  syncSettingsDirtyState();
}

async function saveSettingsFromForm(event) {
  event.preventDefault();
  if (!settingsDirty()) {
    syncSettingsDirtyState();
    return;
  }
  const validationErrors = validateSettingsRulesForSave();
  if (validationErrors.length) {
    state.settingsValidationErrors = validationErrors;
    state.settingsValidationMessage = settingsValidationMessage(validationErrors);
    state.settingsView = validationErrors[0].view || state.settingsView;
    renderSettingsDialog();
    requestAnimationFrame(() => focusSettingsValidationError(validationErrors[0]));
    return;
  }
  clearSettingsValidationState();
  let normalized;
  try {
    normalized = window.ToolSummary?.saveCustomRules?.(state.summaryRules) || [];
  } catch (error) {
    const message = `保存展示规则失败：${errorTextFromError(error)}`;
    state.settingsFeedbackMessage = message;
    state.settingsFeedbackStatus = "error";
    syncSettingsDirtyState();
    showToast(message);
    return;
  }

  state.summaryRules = normalized;
  state.settingsInitialSnapshot = settingsSnapshot();
  renderSettingsDialog();
  try {
    if (state.selectedSessionId) {
      await reloadSelectedSessionDetail();
    } else {
      renderMainContent();
    }
  } catch (error) {
    const message = `展示规则已保存，但当前会话重新读取失败：${errorTextFromError(error)}`;
    state.settingsFeedbackMessage = message;
    state.settingsFeedbackStatus = "warning";
    syncSettingsDirtyState();
    showToast(message);
    return;
  }
  showToast("展示规则已保存");
  closeSettingsDialogAndRestoreFocus();
}

function newSummaryRule() {
  return {
    id: `custom-${Date.now()}`,
    label: "自定义规则",
    enabled: true,
    tool: "exec_command",
    pattern: "",
    title: "",
    summary: "{cmd}",
  };
}

function sourceNavigationContext() {
  return JSON.stringify({
    sourceId: state.selectedSourceId,
    sessionTimeFilter: state.sessionTimeFilter,
    viewMode: state.viewMode,
    selectedSessionKey: state.selectedSessionKey || "",
    panel: els.appShell?.dataset.panel || "thread",
  });
}

function sourceNavigationRequestIsCurrent({ requestKey, expectedRequestKey, sourceId, context }) {
  return sourceRequestOwnsState({ requestKey, expectedRequestKey, sourceId }) && sourceNavigationContext() === context;
}

function sourceRequestOwnsState({ requestKey, expectedRequestKey, sourceId }) {
  return requestKey === expectedRequestKey && state.selectedSourceId === sourceId;
}

function sourceRequestState({ requestKey, expectedRequestKey, sourceId, context }) {
  if (!sourceRequestOwnsState({ requestKey, expectedRequestKey, sourceId })) return "stale";
  return sourceNavigationRequestIsCurrent({ requestKey, expectedRequestKey, sourceId, context }) ? "current" : "navigation-changed";
}

function sourceResponseMatches(data, sourceId, responseKind) {
  const expectedScope = arguments[3];
  if (responseKind === "detail") return data?.session?.sourceId === sourceId;
  if (data?.source?.id !== sourceId) return false;
  if (!responseScopeMatches(data, expectedScope)) return false;
  const collectionKey = responseKind === "prompts" ? "entries" : responseKind === "sessions" ? "sessions" : "";
  const entries = collectionKey ? data?.[collectionKey] : null;
  return !Array.isArray(entries) || entries.every((entry) => !entry?.sourceId || entry.sourceId === sourceId);
}

function responseScopeMatches(data, expectedScope) {
  return !expectedScope || data?.scope === expectedScope;
}

function requireSourceResponse(data, sourceId, responseKind, expectedScope = "") {
  if (sourceResponseMatches(data, sourceId, responseKind, expectedScope)) return;
  const error = new Error("来源响应校验失败，请重试。");
  error.code = "source_response_mismatch";
  throw error;
}

function renderAll() {
  renderSessionList();
  renderThreadHeader();
  renderStats();
  renderMainContent();
  renderToolDetails(state.selectedDetailsNodeId ? findTraceNode(state.detail?.trace?.root, state.selectedDetailsNodeId) : null);
  renderStatusbar();
  scheduleOverflowTooltipSync();
}

function initializeOverflowTooltips() {
  const observer = new MutationObserver(() => scheduleOverflowTooltipSync());
  observer.observe(els.appShell, { childList: true, characterData: true, subtree: true });
  scheduleOverflowTooltipSync();
}

function scheduleOverflowTooltipSync() {
  if (overflowTooltipFrame) return;
  overflowTooltipFrame = window.requestAnimationFrame(() => {
    overflowTooltipFrame = 0;
    document.querySelectorAll(".app-shell *").forEach((element) => {
      if (!overflowTooltipCandidate(element)) return;
      syncOverflowTooltip(element);
    });
  });
}

function overflowTooltipCandidate(element) {
  if (element.hasAttribute("data-overflow-tooltip")) return true;
  if (element.children.length || !element.textContent.trim()) return false;
  const style = window.getComputedStyle(element);
  return style.textOverflow === "ellipsis" || Number.parseInt(style.webkitLineClamp, 10) > 0;
}

function syncOverflowTooltip(element) {
  const text = element.textContent.replace(/\s+/g, " ").trim();
  const clipped = element.clientWidth > 0 && element.clientHeight > 0
    && (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1);
  if (clipped && text) {
    if (element.dataset.overflowTooltipOriginalTitle === undefined && element.hasAttribute("title")) {
      element.dataset.overflowTooltipOriginalTitle = element.getAttribute("title") || "";
    }
    element.title = text;
    element.dataset.overflowTooltipVisible = "true";
    return;
  }
  if (element.dataset.overflowTooltipVisible !== "true") return;
  const originalTitle = element.dataset.overflowTooltipOriginalTitle;
  if (originalTitle === undefined || originalTitle === "") element.removeAttribute("title");
  else element.title = originalTitle;
  delete element.dataset.overflowTooltipVisible;
}

function setViewMode(mode) {
  const nextMode = normalizeViewMode(mode);
  const changed = state.viewMode !== nextMode;
  if (state.viewMode === "diagnostic" && state.diagnosticMode === "raw" && nextMode !== "diagnostic") {
    cancelRawDiagnosticRequest();
    cancelRawEventRequest();
  }
  state.viewMode = nextMode;
  if (mobilePanelLayoutActive()) setMobilePanel("thread");
  syncViewControls();
  renderStats();
  renderMainContent();
}

function normalizeViewMode(mode) {
  if (visibleViewModes.has(mode)) return mode;
  if (mode === "raw") {
    state.diagnosticMode = "raw";
    return "diagnostic";
  }
  if (mode === "stats") {
    state.diagnosticMode = "stats";
    return "diagnostic";
  }
  if (mode === "terminal") return "trace";
  return "compact";
}

function setDiagnosticMode(mode) {
  const nextMode = mode === "raw" ? "raw" : "stats";
  const wasRaw = state.viewMode === "diagnostic" && state.diagnosticMode === "raw";
  if (wasRaw && nextMode !== "raw") {
    cancelRawDiagnosticRequest();
    cancelRawEventRequest();
  }
  state.diagnosticMode = nextMode;
  state.viewMode = "diagnostic";
  if (mobilePanelLayoutActive()) setMobilePanel("thread");
  syncViewControls();
  renderStats();
  renderMainContent();
}

function syncViewControls() {
  state.viewMode = normalizeViewMode(state.viewMode);
  els.appShell.dataset.view = state.viewMode;
  const diagnosticVisible = state.viewMode === "diagnostic";
  if (!diagnosticVisible && els.diagnosticSwitch?.contains(document.activeElement)) {
    [els.compactViewButton, els.traceViewButton, els.diagnosticViewButton]
      .find((button) => button?.dataset.viewMode === state.viewMode)
      ?.focus({ preventScroll: true });
  }
  if (els.diagnosticSwitch) {
    els.diagnosticSwitch.hidden = !diagnosticVisible;
    els.diagnosticSwitch.inert = !diagnosticVisible;
    els.diagnosticSwitch.setAttribute("aria-hidden", diagnosticVisible ? "false" : "true");
  }
  syncItemTypeFilterOptions();
  [[els.compactViewButton, "compact"], [els.traceViewButton, "trace"], [els.diagnosticViewButton, "diagnostic"]].forEach(([button, mode]) => {
    const active = state.viewMode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
    button.tabIndex = active ? 0 : -1;
  });
  [[els.statsViewButton, "stats"], [els.rawViewButton, "raw"]].forEach(([button, mode]) => {
    const active = state.viewMode === "diagnostic" && state.diagnosticMode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
    button.tabIndex = active ? 0 : -1;
  });
  els.threadContent.hidden = true;
  els.compactContent.hidden = state.viewMode !== "compact";
  els.terminalContent.hidden = true;
  els.executionWorkspace.hidden = state.viewMode !== "trace";
  els.traceContent.hidden = state.viewMode !== "trace";
  els.diagnosticContent.hidden = state.viewMode !== "diagnostic";
  els.statsContent.hidden = state.viewMode !== "diagnostic" || state.diagnosticMode !== "stats";
  els.rawContent.hidden = state.viewMode !== "diagnostic" || state.diagnosticMode !== "raw";
  if (els.importantOnlyLabel) els.importantOnlyLabel.textContent = "重要事件";
  if (els.importantOnlyControl) els.importantOnlyControl.title = "仅在主内容区突出重要事件";
}

function syncItemTypeFilterOptions() {
  const mode = state.viewMode === "diagnostic" ? "raw" : "standard";
  const previousMode = els.itemTypeFilter.dataset.optionMode || "standard";
  const options = mode === "raw" ? rawItemTypeOptions : standardItemTypeOptions;
  if (previousMode === mode && els.itemTypeFilter.options?.[0]?.textContent === options[0]?.[1]) return;
  const previous = els.itemTypeFilter.value || "all";
  els.itemTypeFilter.innerHTML = options.map(([value, label]) => `<option value="${escapeAttr(value)}">${escapeHtml(label)}</option>`).join("");
  els.itemTypeFilter.value = options.some(([value]) => value === previous) ? previous : "all";
  els.itemTypeFilter.dataset.optionMode = mode;
}

function primeTraceExpansion(detail) {
  const root = detail?.trace?.root;
  state.expandedTraceNodeIds = new Set(root ? [root.id] : []);
}

function renderSessionList() {
  const query = els.sessionSearch.value.trim().toLowerCase();
  const filter = els.sessionTypeFilter.value;
  syncSessionTimeFilter();
  if (state.sessionsLoading && state.sessions.length === 0) {
    state.filteredSessions = [];
    els.sessionCount.textContent = "0";
    els.sessionList.innerHTML = emptyState("正在加载会话列表", (selectedSource()?.label || "当前数据源") + " · 请稍候。");
    renderStatusbar();
    return;
  }
  if (state.healthLoadError && state.sessions.length === 0) {
    state.filteredSessions = [];
    els.sessionCount.textContent = "0";
    els.sessionList.innerHTML = emptyState("接口不可用", state.healthLoadError);
    renderStatusbar();
    return;
  }
  if (state.sessionsLoadError && state.sessions.length === 0) {
    state.filteredSessions = [];
    els.sessionCount.textContent = "0";
    els.sessionList.innerHTML = emptyState("无法加载会话列表", (selectedSource()?.label || "当前数据源") + " · " + state.sessionsLoadError);
    renderStatusbar();
    return;
  }
  const sessions = state.sessions.filter((session) => {
    if (sessionTimeBucket(session) !== state.sessionTimeFilter) return false;
    if (filter === "project" && !session.cwd) return false;
    if (filter === "projectless" && session.cwd) return false;
    return true;
  });
  state.filteredSessions = sessions;
  renderSessionFilterNotice();
  els.sessionCount.textContent = String(sessions.length);
  if (!sessions.length) {
    if (state.sessionTimeFilter === "earlier" && state.historyLoading) {
      els.sessionList.innerHTML = renderSessionListActionEmptyState("正在读取更早会话", "历史会话仅在切换到该分类后读取。", []);
    } else if (state.sessionTimeFilter === "earlier" && state.historyLoadError) {
      els.sessionList.innerHTML = renderSessionListActionEmptyState("历史会话读取失败：" + state.historyLoadError, "可重试更早会话，或点击刷新列表重试。", [{ action: "retry-history", label: "重试更早会话" }]);
      bindSessionListEmptyActions();
    } else {
      els.sessionList.innerHTML = emptyState("没有匹配的会话", "调整搜索或过滤条件。");
    }
    renderStatusbar();
    return;
  }
  els.sessionList.innerHTML = renderSessionDirectoryTree(sessions, query);
  bindSessionDirectoryTree();
  els.sessionList.querySelectorAll("[data-session-id]").forEach((row) => {
    const activate = () => selectSession(row.dataset.sessionId, { immediateMobilePanel: true });
    row.addEventListener("click", (event) => { if (!event.target.closest("a")) activate(); });
    row.addEventListener("keydown", (event) => {
      if (event.target.closest("a") || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      activate();
    });
  });
  renderStatusbar();
}

function renderSessionListActionEmptyState(title, subtitle, actions = []) {
  const actionHtml = actions.length
    ? `<div class="empty-actions">${actions
        .map((action) => `<button class="ghost-button small" type="button" data-session-empty-action="${escapeAttr(action.action)}">${escapeHtml(action.label)}</button>`)
        .join("")}</div>`
    : "";
  return `<div class="empty-state"><div><strong>${escapeHtml(title)}</strong><br /><span>${escapeHtml(subtitle)}</span>${actionHtml}</div></div>`;
}

function bindSessionListEmptyActions(container = els.sessionList) {
  container.querySelectorAll("[data-session-empty-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.sessionEmptyAction;
      if (action === "return-realtime") {
        returnToRealtimeSessions();
      } else if (action === "retry-history") {
        void loadHistoricalSessions({ announce: true });
      } else if (action === "select-alternate-local-source" && state.alternateLocalSource) {
        void selectSource(state.alternateLocalSource.id);
      } else if (action === "clear-session-filters") {
        els.sessionSearch.value = "";
        els.sessionTypeFilter.value = "all";
        reloadCurrentSessionListForFilters();
      }
    });
  });
}

function mergedVisibleSessions() {
  return state.sessions;
}

function findSessionSummary(id, sourceId = state.selectedSourceId) {
  const key = sessionKey({ id, sourceId });
  return state.sessions.find((session) => sessionKey(session) === key) || state.sessions.find((session) => session.id === id) || null;
}

function currentSessionFilteredOut() {
  if (!state.selectedSessionKey) return false;
  return !state.filteredSessions.some((session) => sessionKey(session) === state.selectedSessionKey);
}

function clearSessionFiltersForSelectedSession() {
  invalidateSessionListRequests();
  els.sessionSearch.value = "";
  els.sessionTypeFilter.value = "all";
  const previousTimeFilter = state.sessionTimeFilter;
  if (state.detail?.session) {
    state.sessionTimeFilter = sessionTimeBucket(state.detail.session);
  }
  reloadCurrentSessionListForFilters();
}

function returnToRealtimeSessions() {
  const changed = state.sessionTimeFilter !== "realtime";
  if (changed) invalidateSessionListRequests();
  state.sessionTimeFilter = "realtime";
  reloadCurrentSessionListForFilters();
}

function reloadCurrentSessionListForFilters() {
  if (state.sessionTimeFilter === "earlier") {
    state.sessions = state.sessions.filter((session) => sessionTimeBucket(session) !== "earlier");
    state.historyLoaded = false;
    void loadHistoricalSessions({ announce: true });
    return;
  }
  void loadSessions({ announce: true });
}

function renderSessionFilterNotice(filteredOut = currentSessionFilteredOut()) {
  if (!els.sessionFilterNotice) return;
  els.sessionFilterNotice.hidden = !filteredOut;
  if (!filteredOut) return;
  els.sessionFilterNoticeText.textContent = "左侧列表不再包含当前正文；清除搜索、类型和时间筛选后，可重新对齐左侧索引与中间正文。";
  els.clearSessionFiltersButton.title = "清除搜索和类型筛选，并切回当前会话所属时间分类";
  els.clearSessionFiltersButton.setAttribute("aria-label", els.clearSessionFiltersButton.title);
  els.returnRealtimeButton.hidden = state.sessionTimeFilter === "realtime";
}

function selectedSessionDisplayTitle() {
  const title = state.pendingSessionTitle || findSessionSummary(state.selectedSessionId)?.displayTitle || state.selectedSessionId || "目标会话";
  return title;
}

function sessionPlaceholderState() {
  const target = selectedSessionDisplayTitle();
  if (state.healthLoadError && !state.detail?.session) return { title: "接口不可用", subtitle: state.healthLoadError };
  if (state.sessionLoading) return { title: "正在读取目标会话", subtitle: `${target} · 正在解析当前数据源中的 JSONL 事件流。` };
  if (state.sessionLoadError) return { title: "无法读取目标会话", subtitle: `${target} · ${state.sessionLoadError}` };
  if (state.sessionsLoadError && !state.detail?.session) {
    return { title: "会话列表加载失败", subtitle: `${selectedSource()?.label || "当前数据源"} · ${state.sessionsLoadError}。请确认服务仍在运行后重试。` };
  }
  return null;
}

function renderSessionPlaceholder(title, subtitle) {
  const actions = [];
  if (state.sessionLoadError && state.selectedSessionId) actions.push('<button class="ghost-button" type="button" data-session-placeholder-action="retry-detail">重新读取会话</button>');
  const action = actions.length ? `<div class="empty-state-actions">${actions.join("")}</div>` : "";
  const html = emptyState(title, subtitle, action);
  [els.threadContent, els.compactContent, els.terminalContent, els.statsContent, els.traceContent, els.rawContent]
    .filter(Boolean)
    .forEach((container) => {
      container.innerHTML = html;
      container.querySelectorAll("[data-session-placeholder-action=retry-detail]").forEach((button) => {
        button.addEventListener("click", () => selectSession(state.selectedSessionId));
      });
    });
}

function syncSessionTimeFilter() {
  els.sessionTimeFilter.querySelectorAll("[data-session-time]").forEach((button) => {
    const active = button.dataset.sessionTime === state.sessionTimeFilter;
    const copy = sessionTimeFilterCopy(button.dataset.sessionTime || "realtime");
    button.classList.toggle("active", active);
    button.setAttribute("aria-checked", active ? "true" : "false");
    button.title = copy.title;
    button.setAttribute("aria-label", copy.ariaLabel);
    button.tabIndex = active ? 0 : -1;
  });
}

function sessionTimeFilterCopy(bucket) {
  if (bucket === "realtime") return { title: "最近 3 小时内的本机会话，可直接打开正文", ariaLabel: "本机实时，小于 3 小时，可打开正文" };
  if (bucket === "day") return { title: "3 小时到 1 天内的本机会话，可直接打开正文", ariaLabel: "本机近一天，可打开正文" };
  return { title: "1 天前或未知时间的本机会话，可直接打开正文", ariaLabel: "本机更早，可打开正文" };
}

function renderSessionDirectoryTree(sessions, query) {
  const nodes = buildSessionDirectoryTree(sessions);
  return `<div class="session-directory-tree">${nodes.map((node) => renderSessionDirectoryNode(node, query)).join("")}</div>`;
}

function renderSessionDirectoryNode(node, query) {
  const key = sessionDirectoryKey(node.path);
  const forcedOpen = Boolean(query) || directoryContainsSelectedSession(node);
  const open = forcedOpen || !state.collapsedSessionDirectoryKeys.has(key);
  const directRows = nestSessionChains(node.sessions).map(({ session, depth }) => renderSessionRow(session, query, depth)).join("");
  const children = node.children.map((child) => renderSessionDirectoryNode(child, query)).join("");
  const label = node.projectless ? "无项目" : node.label;
  const countLabel = `${node.sessionCount} 个会话`;
  return `
    <details class="session-directory-node${node.projectless ? " projectless" : ""}" data-directory-key="${escapeAttr(key)}" data-directory-forced="${forcedOpen ? "true" : "false"}" ${open ? "open" : ""}>
      <summary aria-label="${escapeAttr(`${label}，${countLabel}`)}">
        <span class="session-directory-label"><span class="directory-chevron" aria-hidden="true">›</span><strong data-overflow-tooltip>${escapeHtml(label)}</strong></span>
        <span class="session-directory-count" title="${escapeAttr(countLabel)}" aria-label="${escapeAttr(countLabel)}">${node.sessionCount}</span>
      </summary>
      <div class="session-directory-contents">
        ${directRows ? `<div class="session-directory-list">${directRows}</div>` : ""}
        ${children ? `<div class="session-directory-children">${children}</div>` : ""}
      </div>
    </details>
  `;
}

function sessionDirectoryKey(path) {
  return JSON.stringify([state.selectedSourceId, path]);
}

function directoryContainsSelectedSession(node) {
  const selectedKey = state.selectedSessionKey;
  if (!selectedKey) return false;
  if (node.sessions.some((session) => sessionKey(session) === selectedKey)) return true;
  return node.children.some((child) => directoryContainsSelectedSession(child));
}

function bindSessionDirectoryTree() {
  els.sessionList.querySelectorAll("details[data-directory-key]").forEach((directory) => {
    directory.addEventListener("toggle", () => {
      const key = directory.dataset.directoryKey;
      if (!key) return;
      if (directory.dataset.directoryForced === "true") {
        if (!directory.open) directory.open = true;
        return;
      }
      if (directory.open) state.collapsedSessionDirectoryKeys.delete(key);
      else state.collapsedSessionDirectoryKeys.add(key);
    });
  });
}

function renderSessionRow(session, query, chainDepth = 0) {
  const active = sessionKey(session) === state.selectedSessionKey ? " active" : "";
  const chainChild = chainDepth > 0 ? " chain-child chain-depth-" + Math.min(chainDepth, 4) : "";
  const cwd = session.cwd ? shortPath(session.cwd) : "无项目";
  const agentName = session.agentNickname || "Codex";
  const agent = session.agentNickname ? session.agentNickname + "/" + (session.agentRole || "agent") : "Codex";
  const model = session.model || session.modelProvider || "";
  const status = sessionStatusLabel(session.status);
  const chainLabel = chainDepth > 0 ? "分叉链第 " + String(chainDepth + 1) + " 节点" : "";
  const displayTitle = session.displayTitle || "未命名会话";
  const ariaLabel = displayTitle + (chainLabel ? "，" + chainLabel : "") + (active ? "，当前会话" : "");
  const title = chainLabel ? ' title="' + escapeAttr(chainLabel) + '"' : "";
  return '<div class="session-row' + active + chainChild + '" role="button" tabindex="0"' + (active ? ' aria-current="true"' : "") + ' data-session-id="' + escapeAttr(session.id) + '" data-evidence-id="' + escapeAttr(sessionEvidenceId(session)) + '"' + title + ' aria-label="' + escapeAttr(ariaLabel) + '">'
    + '<span class="agent-dot" data-agent="' + escapeAttr(agentName.toLowerCase()) + '" aria-hidden="true"></span>'
    + '<span class="session-title-wrap"><span class="session-title markdown-inline-title" data-overflow-tooltip>' + renderMarkdownTitle(displayTitle, query) + '</span>' + (chainDepth > 0 ? '<span class="session-chain-badge" aria-hidden="true">分叉</span>' : "") + '</span>'
    + '<span class="session-date">' + formatShortDate(session.updatedAt || session.fileModifiedAt) + '</span>'
    + '<span class="session-meta"><span data-overflow-tooltip>' + escapeHtml(agent) + '</span>' + (model ? '<span data-overflow-tooltip>' + escapeHtml(model) + '</span>' : "") + (status ? '<span data-overflow-tooltip>' + escapeHtml(status) + '</span>' : "") + '<span data-overflow-tooltip>' + escapeHtml(cwd) + '</span></span>'
    + '<span class="session-source" data-overflow-tooltip>' + escapeHtml(session.sourceLabel || selectedSource()?.label || "") + '</span></div>';
}

function evidenceScopeForSession(session = {}, inherited = {}) {
  const activeSession = state.detail?.session || {};
  return {
    sourceId: session.sourceId || inherited.sourceId || activeSession.sourceId || state.selectedSourceId,
    sessionId: session.id || inherited.sessionId || activeSession.id || state.selectedSessionId,
  };
}

function sessionEvidenceId(session) {
  return buildEvidenceId({ ...evidenceScopeForSession(session), threadPath: "root", entity: "session" });
}

function rawEventEvidenceId(event) {
  return buildEvidenceId({ ...evidenceScopeForSession(), threadPath: "root", eventIndex: event.index, entity: "event" });
}

function traceNodeEvidenceId(node) {
  const item = node.detail?.item || {};
  return buildEvidenceId({
    ...evidenceScopeForSession(),
    threadNodeId: node.id,
    turnNumber: item.turnIndex == null ? undefined : item.turnIndex + 1,
    eventIndex: item.sourceIndex ?? item.outputSourceIndex,
    entity: "trace-node",
  });
}

function itemEvidenceId(item) {
  return buildEvidenceId({
    ...evidenceScopeForSession(),
    threadPath: "root",
    turnNumber: item.turnIndex == null ? undefined : item.turnIndex + 1,
    eventIndex: item.sourceIndex ?? item.outputSourceIndex,
    entity: "item",
  });
}

function sessionStatusLabel(status) {
  if (status === "completed") return "已完成";
  if (status === "failed") return "失败";
  if (status === "aborted") return "已中断";
  if (status === "waiting") return "等待输入";
  if (status === "running") return "运行中";
  return "";
}

function renderThreadHeader() {
  const session = state.detail?.session;
  if (!session) {
    const placeholder = sessionPlaceholderState();
    els.sessionTitle.textContent = placeholder?.title || "选择一个会话";
    els.sessionMetaLabel.textContent = placeholder?.subtitle || selectedSource()?.label || "未选择";
    renderSessionLineage();
    renderSessionHandoff();
    return;
  }
  els.sessionTitle.innerHTML = renderMarkdownTitle(session.title || "未命名会话");
  const parts = [session.sourceLabel || selectedSource()?.label, session.model, session.reasoningEffort, formatDate(session.updatedAt)].filter(Boolean);
  els.sessionMetaLabel.textContent = parts.join(" · ") || session.id;
  renderSessionLineage();
  renderSessionHandoff();
}

function renderSessionLineage() {
  const container = els.sessionLineage;
  if (!container) return;
  const related = state.detail?.related;
  if (!related || (!related.parentId && !related.children?.length)) {
    container.hidden = true;
    container.innerHTML = "";
    return;
  }
  const segments = [];
  if (related.parentId) {
    const label = related.parent?.title || `${String(related.parentId).slice(0, 8)}…`;
    segments.push(
      related.parent
        ? `<button class="lineage-link" type="button" data-lineage-session="${escapeAttr(related.parent.id)}" title="${escapeAttr(`打开父会话：${label}`)}">⤴ 分叉自 ${escapeHtml(label)}</button>`
        : `<span class="lineage-plain">⤴ 分叉自 ${escapeHtml(label)}（不在当前目录）</span>`,
    );
  }
  if (related.chain?.length > 0) {
    segments.push(`<span class="lineage-plain">链上第 ${related.chain.length + 1} 段</span>`);
  }
  if (related.children?.length) {
    const childLinks = related.children
      .map((child) => `<button class="lineage-link" type="button" data-lineage-session="${escapeAttr(child.id)}" title="${escapeAttr(`打开分叉会话：${child.title}`)}">${escapeHtml(child.title)}</button>`)
      .join("");
    segments.push(`<span class="lineage-plain">分叉出 ${related.children.length} 个会话：</span>${childLinks}`);
  }
  container.hidden = false;
  container.innerHTML = segments.join("");
  container.querySelectorAll("[data-lineage-session]").forEach((button) => {
    button.addEventListener("click", () => {
      selectSession(button.dataset.lineageSession, { immediateMobilePanel: true });
    });
  });
}

function renderStats() {
  if (state.viewMode !== "diagnostic") {
    els.statsStrip.innerHTML = "";
    els.statsStrip.hidden = true;
    return;
  }
  const stats = state.detail?.stats;
  if (!stats) {
    els.statsStrip.innerHTML = "";
    els.statsStrip.hidden = true;
    return;
  }
  els.statsStrip.hidden = false;
  const tokenUsage = latestTokenUsage(state.detail.turns);
  const contextTokens = tokenUsageTotal(tokenUsage);
  const rows = [
    ["事件", stats.eventCount, "事件流"],
    ["工具", countItems("tool-call"), "工具调用"],
    ...(Number.isFinite(contextTokens) ? [["占用", compactNumber(contextTokens), "上下文占用"]] : []),
  ];
  els.statsStrip.innerHTML = rows
    .map(
      ([label, value, hint]) => `
        <div class="stat">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(String(value))}</strong>
          <em>${escapeHtml(hint)}</em>
        </div>
      `,
    )
    .join("");
}

function renderSessionHandoff() {
  if (!els.sessionHandoff) return;
  const detail = state.detail;
  if (!detail) {
    els.sessionHandoff.hidden = true;
    els.sessionHandoff.innerHTML = "";
    return;
  }
  const facts = sessionHandoffFacts(detail);
  els.sessionHandoff.hidden = false;
  els.sessionHandoff.innerHTML = `
    <div class="handoff-head"><span>交接摘要</span><em>基于当前会话派生数据</em></div>
    <div class="handoff-grid">${facts.map((fact, index) => renderHandoffFact(fact, index + 1)).join("")}</div>
  `;
  els.sessionHandoff.querySelectorAll("[data-handoff-target]").forEach((button) => {
    button.addEventListener("click", () => openHandoffFact(button.dataset.handoffTarget));
  });
}

function sessionHandoffFacts(detail) {
  const turns = detail.turns || [];
  const items = turns.flatMap((turn) => turn.items || []);
  const firstUser = items.find((item) => item.type === "user-message" && String(item.text || "").trim());
  const lastAssistant = [...items].reverse().find((item) => item.type === "assistant-message" && String(item.text || "").trim());
  const tools = items.filter((item) => item.type === "tool-call");
  return [
    ...(firstUser ? [handoffFact("目标", firstUser.text, "compact")] : []),
    ...(handoffSessionStatus(detail) ? [handoffFact("当前状态", handoffSessionStatus(detail), "compact")] : []),
    ...(lastAssistant ? [handoffFact("最新回复", lastAssistant.text, "compact")] : []),
    handoffFact("执行", tools.length ? String(tools.length) + " 次工具调用" : "没有工具调用", "trace"),
    handoffFact("轮次", String(turns.length) + " 轮对话", "compact"),
    handoffFact("子代理", handoffChildText(detail), "trace"),
  ];
}

function handoffSessionStatus(detail) {
  const latestTurn = detail.turns?.at(-1) || {};
  return sessionStatusLabel(latestTurn.status || detail.session?.status);
}

function handoffChildText(detail) {
  const childCount = detail.trace?.hierarchy?.children?.length || 0;
  const embeddedCount = (detail.turns || []).flatMap((turn) => turn.items || []).filter((item) => item.embeddedSubagents).length;
  const parts = [childCount ? `${childCount} 个子会话` : "无独立子会话"];
  if (embeddedCount) parts.push(`${embeddedCount} 次内嵌调用`);
  return parts.join(" · ");
}

function handoffFact(label, value, target) {
  return { label, value: String(value || ""), target };
}

function tokenUsageTotal(usage) {
  for (const value of [usage?.total_tokens, usage?.totalTokens]) {
    const total = Number(value);
    if (Number.isFinite(total)) return total;
  }
  return null;
}

function renderHandoffFact(fact, index) {
  const accessibleSummary = fact.label + "：" + fact.value;
  return `<button class="handoff-fact kind-${escapeAttr(fact.target)}" type="button" data-handoff-target="${escapeAttr(fact.target)}" title="${escapeAttr(accessibleSummary)}" aria-label="${escapeAttr(accessibleSummary)}">
    <span class="handoff-index" aria-hidden="true">${index}</span>
    <span class="handoff-copy"><strong>${escapeHtml(fact.label)}</strong><em data-overflow-tooltip>${escapeHtml(fact.value)}</em></span>
  </button>`;
}

function openHandoffFact(target) {
  if (target === "trace") return setViewMode("trace");
  if (state.viewMode !== "compact") setViewMode("compact");
  const targetId = els.compactContent?.querySelector("[data-compact-nav-target]")?.dataset.compactNavTarget;
  if (targetId) scrollToCompactTarget(targetId);
}
function buildEventTypeStats(detail) {
  const groups = new Map();
  for (const event of detail?.events || []) {
    const kind = eventTypeKey(event);
    const current = groups.get(kind) || {
      kind,
      label: eventTypeLabel(kind),
      count: 0,
      approxTokens: 0,
      approxBytes: 0,
    };
    current.count += 1;
    current.approxTokens += estimateEventTokens(event);
    current.approxBytes += estimateEventBytes(event);
    groups.set(kind, current);
  }
  return [...groups.values()].sort(
    (left, right) => right.count - left.count || right.approxTokens - left.approxTokens || left.kind.localeCompare(right.kind),
  );
}

function buildToolContextStats(detail, query, typeFilter, toolQuery, sort) {
  const tools = (detail?.turns || []).flatMap((turn) => turn.items || []).filter((item) => item.type === "tool-call");
  const visibleTools = tools.filter((item) => itemMatches(item, query, typeFilter));
  const normalizedToolQuery = String(toolQuery || "").trim().toLowerCase();
  const contextWindow = latestContextWindow(detail);
  const groups = new Map();
  for (const item of visibleTools) addToolContextItem(groups, item, normalizedToolQuery);
  const values = [...groups.values()].map((group) => ({
    ...group,
    contextWindowShare: ratioPercent(group.contextTokens, contextWindow),
    maxOutputWindowShare: ratioPercent(group.maxOutputTokens, contextWindow),
  }));
  values.sort(toolContextComparator(contextWindow ? sort : sort === "context-share" ? "output-bytes" : sort));
  return {
    outputBytes: values.reduce((count, group) => count + group.outputBytes, 0),
    contextTokens: values.reduce((count, group) => count + group.contextTokens, 0),
    contextWindow,
    groups: values,
  };
}

function addToolContextItem(groups, item, query) {
  const readable = readableToolItem(item);
  if (!readable.matched || !readable.ruleId) return;
  const target = readable.summary || readable.path || readable.command || item.name || "工具调用";
  const key = `${readable.ruleId}\u0000${target}`;
  const argument = String(item.arguments || "");
  const output = String(item.output || "");
  if (!toolContextQueryMatches(query, readable.title, target, output)) return;
  const current = groups.get(key) || createToolContextGroup(key, readable, target);
  const outputBytes = utf8ByteLength(output);
  const outputTokens = approxTokensFromValue(output);
  const rawEventIndex = item.outputSourceIndex ?? item.sourceIndex ?? null;
  current.count += 1;
  current.argumentBytes += utf8ByteLength(argument);
  current.outputBytes += outputBytes;
  current.contextTokens += approxTokensFromValue(argument) + outputTokens;
  if (outputBytes >= current.maxOutputBytes) current.primaryEventIndex = rawEventIndex;
  current.maxOutputBytes = Math.max(current.maxOutputBytes, outputBytes);
  current.maxOutputTokens = Math.max(current.maxOutputTokens, outputTokens);
  addToolContextRawEventIndex(current, rawEventIndex);
  groups.set(key, current);
}

function addToolContextRawEventIndex(group, eventIndex) {
  if (eventIndex != null && !group.rawEventIndexes.includes(eventIndex)) group.rawEventIndexes.push(eventIndex);
}

function toolContextQueryMatches(query, title, target, output) {
  return !query || `${title}\n${target}\n${output}`.toLowerCase().includes(query);
}

function createToolContextGroup(id, readable, target) {
  return {
    id,
    title: readable.title,
    label: readable.ruleLabel,
    target,
    count: 0,
    argumentBytes: 0,
    outputBytes: 0,
    contextTokens: 0,
    maxOutputBytes: 0,
    maxOutputTokens: 0,
    primaryEventIndex: null,
    rawEventIndexes: [],
  };
}

function latestContextWindow(detail) {
  const tokenItems = (detail?.turns || []).flatMap((turn) => turn.items || []).filter((item) => item.type === "token-count");
  for (const item of [...tokenItems].reverse()) {
    const info = item.info || {};
    for (const value of [info.context_window, info.contextWindow, info.contextWindowTokens, info.model_context_window]) {
      const window = Number(value);
      if (Number.isFinite(window) && window > 0) return Math.round(window);
    }
  }
  return 0;
}

function ratioPercent(value, total) {
  if (!total) return null;
  return (Number(value || 0) / total) * 100;
}

function formatContextRatio(value) {
  if (!Number.isFinite(value)) return "";
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)}%`;
}

function toolContextComparator(sort) {
  const comparisons = {
    "context-share": (left, right) => (right.contextWindowShare ?? -1) - (left.contextWindowShare ?? -1),
    "max-output": (left, right) => right.maxOutputBytes - left.maxOutputBytes,
    target: (left, right) => left.target.localeCompare(right.target, "zh-Hans-CN"),
    "output-bytes": (left, right) => right.outputBytes - left.outputBytes,
  };
  const compare = comparisons[sort] || comparisons["output-bytes"];
  return (left, right) => compare(left, right) || right.contextTokens - left.contextTokens || left.target.localeCompare(right.target, "zh-Hans-CN");
}

function eventTypeKey(event) {
  return String(event?.kind || event?.payloadType || event?.type || "event").trim() || "event";
}

function eventTypeLabel(kind) {
  const labels = {
    meta: "会话元信息",
    session_meta: "会话元信息",
    context: "轮次上下文",
    turn_context: "轮次上下文",
    user_message: "用户消息",
    agent_message: "助手消息",
    message: "消息",
    reasoning: "推理",
    function_call: "工具调用",
    custom_tool_call: "工具调用",
    mcp_tool_call: "工具调用",
    tool_search_call: "工具调用",
    function_call_output: "工具输出",
    custom_tool_call_output: "工具输出",
    mcp_tool_call_end: "工具输出",
    tool_search_output: "工具输出",
    token_count: "上下文占用",
    task_started: "任务开始",
    task_complete: "任务完成",
    task_failed: "任务失败",
    turn_aborted: "轮次中断",
    compacted: "压缩摘要",
    context_compacted: "压缩完成",
    jsonl_parse_error: "解析失败",
  };
  return labels[kind] || kind;
}

function estimateEventTokens(event) {
  const explicit = numericEventTokenValue(event);
  if (Number.isFinite(explicit)) return Math.max(0, Math.round(explicit));
  const size = Number(event?.rawSize || event?.payloadSize || 0);
  if (Number.isFinite(size) && size > 0) return Math.max(1, Math.ceil(size / 4));
  return approxTokensFromValue([event?.title, event?.preview, event?.kind, event?.type, event?.payloadType].filter(Boolean).join("\n"));
}

function estimateEventBytes(event) {
  const size = Number(event?.rawSize || event?.payloadSize || 0);
  if (Number.isFinite(size) && size > 0) return Math.round(size);
  return [event?.title, event?.preview, event?.kind, event?.type, event?.payloadType].filter(Boolean).join("\n").length;
}

function numericEventTokenValue(event) {
  const candidates = [
    event?.tokens,
    event?.tokenCount,
    event?.token_count,
    event?.usage?.total_tokens,
    event?.usage?.totalTokens,
    event?.total_token_usage?.total_tokens,
    event?.totalTokenUsage?.totalTokens,
  ];
  for (const value of candidates) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function approxTokensFromValue(value) {
  const length = String(value || "").length;
  return length ? Math.max(1, Math.ceil(length / 4)) : 0;
}

function utf8ByteLength(value) {
  return new TextEncoder().encode(String(value || "")).length;
}

function renderStatsInfoView() {
  const detail = state.detail;
  if (!detail) {
    els.statsContent.innerHTML = emptyState("选择一个会话", "统计信息视图展示事件类型分布和 token 估算。");
    return;
  }
  const query = els.itemSearch.value.trim().toLowerCase();
  const typeFilter = els.itemTypeFilter.value;
  const allEvents = detail.events || [];
  const filteredEvents = allEvents.filter((event) => rawEventMatches(event, query, typeFilter));
  const eventTypeStats = buildEventTypeStats({ events: filteredEvents });
  const totalEventTypeStats = buildEventTypeStats(detail);
  const filtered = filteredEvents.length !== allEvents.length;
  const approxTokens = eventTypeStats.reduce((sum, stat) => sum + stat.approxTokens, 0);
  const approxBytes = eventTypeStats.reduce((sum, stat) => sum + stat.approxBytes, 0);
  const maxCount = Math.max(1, ...eventTypeStats.map((stat) => stat.count));
  const topType = eventTypeStats[0];
  const title = filtered ? `${filteredEvents.length} / ${allEvents.length} 个事件` : `${allEvents.length} 个事件`;
  els.statsContent.innerHTML = `
    <div class="stats-view-shell">
      <div class="stats-view-head">
        <div>
          <p class="eyebrow">统计信息</p>
          <h3>${escapeHtml(title)}</h3>
          <div class="stats-view-note">${escapeHtml(filtered ? "当前统计已应用搜索或类型过滤" : "当前统计覆盖完整会话事件流")}</div>
        </div>
      </div>
      ${renderTimingView(detail.timing)}
      ${renderToolContextStats(detail, query, typeFilter)}
      <div class="stats-view-metrics" aria-label="事件统计概要">
        ${renderStatsMetric("事件类型", eventTypeStats.length, `全部 ${totalEventTypeStats.length} 类`)}
        ${renderStatsMetric("约 token", compactNumber(approxTokens), "按事件体积估算")}
        ${renderStatsMetric("事件体积", formatBytes(approxBytes), "raw / payload 体积")}
        ${renderStatsMetric("最多类型", topType ? topType.label : "无", topType ? `${topType.count} 个事件` : "无事件")}
      </div>
      ${
        eventTypeStats.length
          ? `<div class="stats-event-table" role="table" aria-label="事件类型统计">
              <div class="stats-event-row header" role="row">
                <span role="columnheader">类型</span>
                <span role="columnheader">事件数</span>
                <span role="columnheader">约 token</span>
                <span role="columnheader">平均</span>
                <span role="columnheader">占比</span>
                <span role="columnheader">体积</span>
              </div>
              ${eventTypeStats.map((stat) => renderStatsEventRow(stat, filteredEvents.length, maxCount, query)).join("")}
            </div>`
          : emptyState("没有匹配的事件统计", "调整内容搜索或类型过滤。")
      }
    </div>
  `;
  bindTimingActions();
  bindToolContextControls();
}

function renderToolContextStats(detail, query, typeFilter) {
  const stats = buildToolContextStats(detail, query, typeFilter, state.toolContextQuery, state.toolContextSort);
  const hasContextWindow = stats.contextWindow > 0;
  const totalShare = formatContextRatio(ratioPercent(stats.contextTokens, stats.contextWindow));
  return `
    <section class="tool-context-stats${hasContextWindow ? " has-context-window" : ""}" aria-labelledby="toolContextStatsHeading">
      <div class="tool-context-stats-head">
        <div>
          <p class="eyebrow">工具诊断</p>
          <h3 id="toolContextStatsHeading">工具上下文占用</h3>
        </div>
        <div class="tool-context-controls" aria-label="工具上下文统计筛选和排序">
          <input class="text-input compact" id="toolContextQuery" type="search" autocomplete="off" value="${escapeAttr(state.toolContextQuery)}" placeholder="检索目标或返回结果" />
          <select class="select-input compact" id="toolContextSort" aria-label="工具返回结果排序">
            <option value="output-bytes" ${state.toolContextSort === "output-bytes" ? "selected" : ""}>返回结果大小</option>
            ${hasContextWindow ? `<option value="context-share" ${state.toolContextSort === "context-share" ? "selected" : ""}>上下文占用比例</option>` : ""}
            <option value="max-output" ${state.toolContextSort === "max-output" ? "selected" : ""}>最大单次返回</option>
            <option value="target" ${state.toolContextSort === "target" ? "selected" : ""}>操作与目标</option>
          </select>
        </div>
      </div>
      <div class="tool-context-kpis" aria-label="工具上下文占用概览">
        ${hasContextWindow ? `<span><strong>${escapeHtml(`${compactNumber(stats.contextWindow)} tok`)}</strong>最近上下文窗口</span>` : ""}
        <span><strong>${escapeHtml(formatBytes(stats.outputBytes))}</strong>返回结果</span>
        <span><strong>约 ${escapeHtml(compactNumber(stats.contextTokens))} tok</strong>累计参数与返回</span>
        ${hasContextWindow ? `<span><strong>${escapeHtml(totalShare)}</strong>累计 / 窗口</span>` : ""}
      </div>
      ${
        stats.groups.length
          ? `<div class="tool-context-table" role="table" aria-label="工具上下文占用统计">
              <div class="tool-context-row header" role="row">
                <span role="columnheader">操作与目标</span>
                <span role="columnheader">调用参数</span>
                <span role="columnheader">返回结果</span>
                ${hasContextWindow ? `<span role="columnheader">累计 / 窗口</span><span role="columnheader">最大返回 / 窗口</span>` : ""}
              </div>
              ${stats.groups.slice(0, 30).map((group) => renderToolContextStatRow(group, hasContextWindow)).join("")}
            </div>`
          : `<div class="tool-context-empty">当前筛选范围没有可按规则归类的工具调用。</div>`
      }
    </section>
  `;
}

function renderToolContextStatRow(group, hasContextWindow) {
  const repeated = group.count > 1 ? `同一目标 ${group.count} 次` : group.label;
  const rawCount = group.rawEventIndexes.length;
  const rawAction = group.primaryEventIndex != null
    ? `<button class="ghost-button small tool-context-raw" type="button" data-tool-context-event-index="${escapeAttr(String(group.primaryEventIndex))}">查看 Raw</button>`
    : "";
  return `
    <div class="tool-context-row" role="row">
      <span class="tool-context-target" role="cell"><strong data-overflow-tooltip title="${escapeAttr(group.title)}">${escapeHtml(group.title)}</strong><em data-overflow-tooltip title="${escapeAttr(group.target)}">${escapeHtml(group.target)}</em><span class="tool-context-target-actions"><small>${escapeHtml(rawCount ? `${repeated} · 原始 ${rawCount} 条` : repeated)}</small>${rawAction}</span></span>
      <span class="tool-context-number" role="cell">${escapeHtml(formatBytes(group.argumentBytes))}</span>
      <span class="tool-context-number" role="cell">${escapeHtml(formatBytes(group.outputBytes))}</span>
      ${hasContextWindow ? `<span class="tool-context-number" role="cell">约 ${escapeHtml(compactNumber(group.contextTokens))} tok · ${escapeHtml(formatContextRatio(group.contextWindowShare))}</span><span class="tool-context-number" role="cell">${escapeHtml(formatBytes(group.maxOutputBytes))} · ${escapeHtml(formatContextRatio(group.maxOutputWindowShare))}</span>` : ""}
    </div>
  `;
}

function bindToolContextControls() {
  const queryInput = els.statsContent.querySelector("#toolContextQuery");
  const sortInput = els.statsContent.querySelector("#toolContextSort");
  queryInput?.addEventListener("input", () => {
    const selectionStart = queryInput.selectionStart;
    const selectionEnd = queryInput.selectionEnd;
    state.toolContextQuery = queryInput.value;
    renderStatsInfoView();
    requestAnimationFrame(() => {
      const next = els.statsContent.querySelector("#toolContextQuery");
      next?.focus();
      if (next && selectionStart != null && selectionEnd != null) next.setSelectionRange(selectionStart, selectionEnd);
    });
  });
  sortInput?.addEventListener("change", () => {
    state.toolContextSort = sortInput.value;
    renderStatsInfoView();
  });
  els.statsContent.querySelectorAll("[data-tool-context-event-index]").forEach((button) => {
    button.addEventListener("click", () => openRawEvent(Number(button.dataset.toolContextEventIndex)));
  });
}

function renderTimingView(timing) {
  if (!timing?.session) return `<section class="timing-empty"><strong>暂无会话时间数据</strong><span>当前会话尚未生成可用的时间区间。</span></section>`;
  const session = timing.session;
  const composition = session.executionComposition || [];
  const quality = timing.quality || {};
  const metrics = renderTimingMetrics(session);
  return `
    <section class="timing-section" aria-labelledby="timingHeading">
      <div class="timing-heading"><div><p class="eyebrow">时间投入</p><h3 id="timingHeading">会话时间花在哪里</h3></div><span class="timing-confidence">${escapeHtml(timingKindLabel(session.durationKind))}</span></div>
      ${metrics.length ? `<div class="timing-metrics" aria-label="会话时间概览">${metrics.join("")}</div>` : ""}
      <p class="timing-note">等待输入仅统计助手最后回复到下一次用户消息的间隔。实际运行时长只统计工具与 LLM 的可关联区间；两者并行时按时间并集计一次。</p>
      <div class="timing-composition" aria-label="实际运行时长构成">
        ${composition.length ? renderTimingComposition(composition) : `<div class="timing-empty"><strong>暂无可关联执行时长</strong><span>会话事件中尚未发现具有完整起止时间的工具或 LLM 记录。</span></div>`}
      </div>
      ${renderTimingTurns(timing.turns)}
      <div class="timing-quality"><strong>时间数据质量</strong><span>估算 ${quality.estimatedCount || 0} 项 · 缺少开始 ${quality.missingStartCount || 0} 项 · 缺少结束 ${quality.missingEndCount || 0} 项 · 未关联 ${quality.unlinkedCount || 0} 项</span></div>
    </section>
  `;
}

function renderTimingMetrics(session) {
  return [
    Number.isFinite(session.durationMs) ? renderStatsMetric("总墙钟时长", formatTimingDuration(session.durationMs), "会话开始至最后事件") : "",
    Number.isFinite(session.waitingForInputMs) ? renderStatsMetric("等待输入时长", formatTimingDuration(session.waitingForInputMs), `${session.waitingForInputCount || 0} 段可确认等待`) : "",
    Number.isFinite(session.activeRunMs) ? renderStatsMetric("实际运行时长", formatTimingDuration(session.activeRunMs), "工具与 LLM 时间并集") : "",
    Number.isFinite(session.parallelism?.peak) ? renderStatsMetric("并行峰值", `${session.parallelism.peak} 路`, formatTimingDuration(session.parallelism?.overlapMs, "重叠")) : "",
  ].filter(Boolean);
}

function renderTimingComposition(composition) {
  const segments = composition.map((component) => {
    const refs = component.nodeRefs || [];
    const firstRef = refs[0] || {};
    const bucketClass = component.parallel ? "parallel" : component.bucketIds?.[0] || "unknown";
    const label = `${component.label}，${formatTimingDuration(component.durationMs)}，${component.sharePercent}%`;
    return `<button class="timing-composition-segment timing-composition-${escapeAttr(bucketClass)}" type="button" style="--segment:${Math.max(0, component.durationMs || 0)}" data-timing-node-id="${escapeAttr(firstRef.traceNodeId || "")}" data-timing-event-index="${escapeAttr(firstRef.eventIndex ?? "")}" aria-label="${escapeAttr(label)}" title="${escapeAttr(label)}"></button>`;
  }).join("");
  const legend = composition.map((component) => {
    const refs = component.nodeRefs || [];
    const firstRef = refs[0] || {};
    const bucketClass = component.parallel ? "parallel" : component.bucketIds?.[0] || "unknown";
    return `<button class="timing-composition-legend timing-composition-${escapeAttr(bucketClass)}" type="button" data-timing-node-id="${escapeAttr(firstRef.traceNodeId || "")}" data-timing-event-index="${escapeAttr(firstRef.eventIndex ?? "")}"><i aria-hidden="true"></i><span>${escapeHtml(component.label)}</span><strong>${escapeHtml(`${formatTimingDuration(component.durationMs)} · ${component.sharePercent}%`)}</strong></button>`;
  }).join("");
  return `<div class="timing-composition-bar" role="img" aria-label="执行时长组合条，总长度等于实际运行时长">${segments}</div><div class="timing-composition-legend-list">${legend}</div>`;
}

function renderTimingTurns(turns = []) {
  if (!turns.length) return "";
  return `<div class="timing-turns"><h4>按轮次查看</h4>${turns.map((turn) => {
    const meta = [Number.isFinite(turn.durationMs) ? formatTimingDuration(turn.durationMs) : "", timingKindLabel(turn.confidence)].filter(Boolean).join(" · ");
    return `<div class="timing-turn"><div class="timing-turn-head"><strong>第 ${turn.turnNumber} 轮</strong>${meta ? `<span>${escapeHtml(meta)}</span>` : ""}</div><div class="timing-turn-bars">${(turn.buckets || []).map((bucket) => `<span class="timing-turn-bar timing-${escapeAttr(bucket.id)}" style="--bar:${Math.max(3, Math.min(100, bucket.sharePercent || 0))}%" title="${escapeAttr(`${bucket.label} ${formatTimingDuration(bucket.coverageMs)}`.trim())}"><i></i></span>`).join("")}</div></div>`;
  }).join("")}</div>`;
}

function timingKindLabel(kind) {
  return { observed: "实测", mixed: "混合", estimated: "估算", partial: "部分区间" }[kind] || "";
}

function formatTimingDuration(ms, prefix = "") {
  if (ms == null) return "";
  return `${prefix ? `${prefix} ` : ""}${formatDuration(ms)}`;
}

function bindTimingActions() {
  els.statsContent.querySelectorAll("[data-timing-node-id]").forEach((button) => button.addEventListener("click", () => {
    const nodeId = button.dataset.timingNodeId;
    const eventIndex = button.dataset.timingEventIndex;
    if (nodeId) {
      setViewMode("trace");
      selectTraceNode(nodeId);
    } else if (eventIndex !== "") openRawEvent(Number(eventIndex));
    else showToast("当前分类没有可跳转的来源");
  }));
}

function renderStatsMetric(label, value, hint) {
  return `
    <div class="stats-metric">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
      <em>${escapeHtml(hint || "")}</em>
    </div>
  `;
}

function renderStatsEventRow(stat, totalEvents, maxCount, query) {
  const percent = totalEvents ? Math.round((stat.count / totalEvents) * 1000) / 10 : 0;
  const average = stat.count ? Math.round(stat.approxTokens / stat.count) : 0;
  const bar = Math.max(2, Math.round((stat.count / maxCount) * 100));
  return `
    <div class="stats-event-row" role="row" style="--bar:${escapeAttr(String(bar))}" title="${escapeAttr(`${stat.kind} · ${stat.count} 个事件 · 约 ${compactNumber(stat.approxTokens)} tok`)}">
      <span class="stats-event-type" role="cell">
        <strong data-overflow-tooltip>${highlight(escapeHtml(stat.label), query)}</strong>
        <em data-overflow-tooltip>${highlight(escapeHtml(stat.kind), query)}</em>
      </span>
      <span role="cell" data-overflow-tooltip><strong>${escapeHtml(String(stat.count))}</strong></span>
      <span role="cell" data-overflow-tooltip>${escapeHtml(`约 ${compactNumber(stat.approxTokens)}`)}</span>
      <span role="cell" data-overflow-tooltip>${escapeHtml(`约 ${compactNumber(average)}`)}</span>
      <span class="stats-event-share" role="cell">
        <i aria-hidden="true"></i>
        <em>${escapeHtml(`${percent}%`)}</em>
      </span>
      <span role="cell" data-overflow-tooltip>${escapeHtml(formatBytes(stat.approxBytes))}</span>
    </div>
  `;
}

function renderStatusbar() {
  syncAsyncAccessibility();
  const source = selectedSource();
  const session = state.detail?.session;
  const stats = state.detail?.stats;
  const filteredOut = currentSessionFilteredOut();
  renderSessionFilterNotice(filteredOut);
  syncStatusbarDataStatus(source);
  if (state.healthLoadError) {
    els.statusSource.textContent = "数据源：本机服务 · 接口不可用";
    els.statusSession.textContent = "无法连接本机服务";
    els.statusEvents.textContent = "0 个会话";
    els.statusUpdated.textContent = "点击刷新列表重试";
    return;
  }
  els.statusSource.textContent = "数据源：" + (source?.label || source?.id || "未选择") + " · 本机只读";
  els.statusSession.textContent = state.sessionLoading ? "正在读取：" + selectedSessionDisplayTitle() : state.sessionLoadError ? "读取失败：" + selectedSessionDisplayTitle() : filteredOut ? "当前会话已被筛选隐藏" : session ? "当前：" + selectedSessionDisplayTitle() : "未选择会话";
  els.statusEvents.textContent = String(state.filteredSessions.length || 0) + "/" + String(state.sessions.length || 0) + " 个会话";
  const updated = session?.updatedAt || session?.fileModifiedAt || session?.startedAt;
  els.statusUpdated.textContent = filteredOut ? "清除搜索或筛选后重新对齐" : stats ? String(stats.eventCount || 0) + " 个事件 · " + String(stats.turnCount || 0) + " 轮次 · " + (formatDate(updated) || "未知时间") : "只读浏览";
}

function syncStatusbarDataStatus(source = selectedSource()) {
  if (!els.statusbar) return;
  const status = source?.status || {};
  let value = "local";
  let label = "本机只读";
  if (state.healthLoadError) { value = "error"; label = "接口不可用"; }
  else if (state.sessionsLoading || state.sessionLoading) { value = "loading"; label = "加载中"; }
  else if (state.sessionsLoadError || state.sessionLoadError || status.error?.message) { value = "error"; label = "错误"; }
  els.statusbar.dataset.status = value;
  els.statusbar.title = "数据状态：" + label;
}

function renderMainContent() {
  syncViewControls();
  const placeholder = sessionPlaceholderState();
  if (placeholder) {
    renderSessionPlaceholder(placeholder.title, placeholder.subtitle);
    return;
  }
  renderCompact();
  if (state.viewMode === "diagnostic") {
    if (state.diagnosticMode === "raw") renderRawView();
    else renderStatsInfoView();
  } else if (state.viewMode === "trace") {
    renderTrace();
  }
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
  compactTimelineObserver?.disconnect();
  compactTimelineObserver = null;
  const compact = state.detail?.compact || buildCompactFallback(state.detail);
  if (!compact) {
    els.compactContent.innerHTML = emptyState("选择一个会话", "左侧列表展示本机 Codex 会话。");
    return;
  }
  const query = els.itemSearch.value.trim().toLowerCase();
  const typeFilter = els.itemTypeFilter.value;
  const filtered = filterCompactNode(compact, query, typeFilter, true);
  if (!filtered || (filtered.turns.length === 0 && filtered.children.length === 0)) {
    els.compactContent.innerHTML = emptyState("没有匹配的阅读内容", "阅读视图包含用户输入、全部助手消息和子代理层级。");
    return;
  }
  const timeline = renderCompactTimeline(filtered);
  els.compactContent.innerHTML = `
    <div class="compact-shell">
      <div class="compact-reading-layout${timeline ? " has-timeline" : ""}">
        ${timeline}
        <div class="compact-main">
          ${renderCompactThread(filtered, { depth: 0, root: true, path: "root", query })}
        </div>
      </div>
    </div>
  `;
  els.compactContent.querySelectorAll("[data-compact-session-id]").forEach((button) => {
    button.addEventListener("click", () => selectSession(button.dataset.compactSessionId));
  });
  els.compactContent.querySelectorAll("[data-compact-event-index]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const index = Number(button.dataset.compactEventIndex);
      if (!Number.isFinite(index)) return;
      await openRawEvent(index);
    });
  });
  els.compactContent.querySelectorAll("[data-compact-ref-event-index]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      scrollToCompactEvent(button.dataset.compactRefEventIndex);
    });
  });
  els.compactContent.querySelectorAll("[data-compact-replacement-target]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      scrollToCompactReplacementTarget(button);
    });
  });
  bindCompactTimeline();
  const outlineRows = Array.from(els.compactContent.querySelectorAll("[data-compact-nav-target]"));
  const focusCompactOutlineRow = (index) => {
    if (!outlineRows.length) return;
    const nextIndex = Math.min(outlineRows.length - 1, Math.max(0, index));
    outlineRows.forEach((candidate, candidateIndex) => {
      candidate.tabIndex = candidateIndex === nextIndex ? 0 : -1;
    });
    outlineRows[nextIndex]?.focus();
  };
  outlineRows.forEach((row, index) => {
    row.tabIndex = index === 0 ? 0 : -1;
    row.addEventListener("focus", () => {
      outlineRows.forEach((candidate) => {
        candidate.tabIndex = candidate === row ? 0 : -1;
      });
    });
    row.addEventListener("click", (event) => {
      if (event.target.closest("a")) return;
      scrollToCompactTarget(row.dataset.compactNavTarget);
    });
    row.addEventListener("keydown", (event) => {
      if (event.target.closest("a")) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        focusCompactOutlineRow(index + 1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        focusCompactOutlineRow(index - 1);
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        focusCompactOutlineRow(0);
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        focusCompactOutlineRow(outlineRows.length - 1);
        return;
      }
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      scrollToCompactTarget(row.dataset.compactNavTarget);
    });
  });
}

function renderCompactTimeline(node) {
  const entries = compactTimelineEntries(node);
  if (entries.length < 2) return "";
  return `
    <nav class="compact-timeline" aria-label="正文轮次导航">
      ${entries.map((entry, index) => renderCompactTimelineEntry(entry, index, entries.length)).join("")}
    </nav>
  `;
}

function compactTimelineEntries(node) {
  const timingByTurn = new Map((state.detail?.timing?.turns || []).map((turn) => [turn.turnNumber, turn.durationMs]));
  const entries = (node.turns || []).map((turn, index) => compactTimelineEntry(turn, index, timingByTurn));
  const reduced = entries.length > 24 ? aggregateCompactTimelineEntries(entries) : entries;
  return withCompactTimelineWeights(reduced);
}

function compactTimelineEntry(turn, index, timingByTurn) {
  const contextEvents = contextEventsForTurn(turn);
  const timingDuration = Number(timingByTurn.get(turn.turnNumber));
  return {
    targetId: compactElementId("turn", `root-turn-${index}`),
    startTurn: turn.turnNumber || index + 1,
    endTurn: turn.turnNumber || index + 1,
    durationMs: Number.isFinite(timingDuration) && timingDuration > 0 ? timingDuration : compactTurnDuration(turn),
    hasCompaction: contextEvents.some((event) => event.contextKind === "compaction"),
    subagentCount: (turn.embeddedSubagents?.length || 0) + (turn.children?.length || 0),
  };
}

function compactTurnDuration(turn) {
  const start = new Date(turn.startedAt || "").getTime();
  const end = new Date(turn.completedAt || "").getTime();
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? end - start : null;
}

function aggregateCompactTimelineEntries(entries) {
  const result = [];
  let ordinary = [];
  const flushOrdinary = () => {
    while (ordinary.length) {
      const group = ordinary.splice(0, 5);
      result.push({
        ...group[0],
        endTurn: group.at(-1).endTurn,
        durationMs: group.reduce((total, entry) => total + (entry.durationMs || 0), 0) || null,
        grouped: group.length > 1,
      });
    }
  };
  for (const entry of entries) {
    if (!entry.hasCompaction && entry.subagentCount === 0) {
      ordinary.push(entry);
      continue;
    }
    flushOrdinary();
    result.push(entry);
  }
  flushOrdinary();
  return result;
}

function withCompactTimelineWeights(entries) {
  const known = entries.map((entry) => entry.durationMs).filter((duration) => Number.isFinite(duration) && duration > 0);
  const fallback = known.length ? known.reduce((sum, duration) => sum + duration, 0) / known.length : 1;
  const minimum = Math.max(1, fallback * 0.08);
  return entries.map((entry) => ({ ...entry, timelineWeight: Math.max(minimum, entry.durationMs || fallback) }));
}

function renderCompactTimelineEntry(entry, index, total) {
  const label = entry.startTurn === entry.endTurn ? String(entry.startTurn) : `${entry.startTurn}-${entry.endTurn}`;
  const classes = [
    "compact-timeline-node",
    entry.hasCompaction ? "has-compaction" : "",
    entry.subagentCount ? "has-subagent" : "",
    index === total - 1 ? "is-last" : "",
  ].filter(Boolean).join(" ");
  const signals = [
    entry.hasCompaction ? "含上下文压缩" : "",
    entry.subagentCount ? `含 ${entry.subagentCount} 次子代理调用` : "",
  ].filter(Boolean);
  const range = entry.grouped ? `第 ${entry.startTurn} 至 ${entry.endTurn} 轮，共 ${entry.endTurn - entry.startTurn + 1} 轮` : `第 ${entry.startTurn} 轮`;
  const duration = entry.durationMs ? `记录时长 ${formatTimingDuration(entry.durationMs)}` : "";
  const ariaLabel = [range, duration, ...signals].filter(Boolean).join("，");
  return `
    <button class="${classes}" type="button" style="--timeline-weight:${escapeAttr(String(entry.timelineWeight))}" data-compact-timeline-target="${escapeAttr(entry.targetId)}" aria-label="${escapeAttr(ariaLabel)}" title="${escapeAttr(ariaLabel)}" tabindex="${index === 0 ? "0" : "-1"}">
      <span class="compact-timeline-label">${escapeHtml(label)}</span>
      <span class="compact-timeline-dot" aria-hidden="true"></span>
    </button>
  `;
}

function bindCompactTimeline() {
  const buttons = Array.from(els.compactContent.querySelectorAll("[data-compact-timeline-target]"));
  if (!buttons.length) return;
  setCompactTimelineReadingTarget(buttons[0].dataset.compactTimelineTarget || "");
  buttons.forEach((button, index) => {
    button.addEventListener("click", () => {
      const targetId = button.dataset.compactTimelineTarget || "";
      compactTimelineJumpTarget = targetId;
      setCompactTimelineReadingTarget(targetId);
      scrollToCompactTarget(targetId);
      window.setTimeout(() => {
        if (compactTimelineJumpTarget === targetId) compactTimelineJumpTarget = "";
      }, 700);
    });
    button.addEventListener("keydown", (event) => handleCompactTimelineKeydown(event, buttons, index));
  });
  observeCompactTimelineTargets(buttons);
}

function handleCompactTimelineKeydown(event, buttons, index) {
  if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const nextIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? buttons.length - 1
      : Math.min(buttons.length - 1, Math.max(0, index + (event.key === "ArrowUp" ? -1 : 1)));
  buttons.forEach((button, buttonIndex) => { button.tabIndex = buttonIndex === nextIndex ? 0 : -1; });
  buttons[nextIndex]?.focus({ preventScroll: true });
}

function observeCompactTimelineTargets(buttons) {
  if (typeof IntersectionObserver === "undefined") return;
  compactTimelineObserver = new IntersectionObserver((observations) => {
    if (compactTimelineJumpTarget) return;
    const visible = observations.filter((entry) => entry.isIntersecting);
    if (!visible.length) return;
    visible.sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top);
    setCompactTimelineReadingTarget(visible[0].target.id);
  }, { root: els.compactContent, rootMargin: "0px 0px -62% 0px", threshold: 0.01 });
  buttons.forEach((button) => {
    const target = els.compactContent.querySelector(`#${cssEscape(button.dataset.compactTimelineTarget || "")}`);
    if (target) compactTimelineObserver.observe(target);
  });
}

function setCompactTimelineReadingTarget(targetId) {
  if (!targetId) return;
  const buttons = els.compactContent.querySelectorAll("[data-compact-timeline-target]");
  buttons.forEach((button) => {
    const active = button.dataset.compactTimelineTarget === targetId;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "location" : "false");
    if (!els.compactContent.contains(document.activeElement)) button.tabIndex = active ? 0 : -1;
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
    .map((item, itemIndex) => (item.type === "user-message" && String(item.text || "").trim() ? compactMessageFallback(item, index, itemIndex) : null))
    .filter(Boolean);
  const assistantMessages = items
    .map((item, itemIndex) => (item.type === "assistant-message" && String(item.text || "").trim() ? compactMessageFallback(item, index, itemIndex) : null))
    .filter(Boolean);
  const compactEvents = items.filter((item) => item.type === "context-compact").map(compactEventFallback);
  return {
    id: turn.id || `turn-${index}`,
    turnNumber: turn.turnNumber ?? index + 1,
    status: turn.status,
    startedAt: turn.startedAt,
    completedAt: turn.completedAt,
    userMessages,
    assistantMessages,
    assistantMessage: assistantMessages.at(-1) || null,
    compactEvents,
    children: [],
  };
}

function compactMessageFallback(item, turnIndex = null, itemIndex = null) {
  return {
    id: item.id,
    type: item.type,
    text: item.text || "",
    timestamp: item.timestamp,
    phase: item.phase,
    sourceIndex: item.sourceIndex ?? null,
    turnIndex,
    itemIndex,
    messageId: item.messageId || null,
    truncated: item.truncated,
    textLength: item.textLength,
    contextUsage: item.contextUsage || null,
    compressionRefs: item.compressionRefs || [],
  };
}

function compactEventFallback(item) {
  const text = item.text || item.compact?.message || "";
  return {
    id: item.id,
    type: item.type,
    timestamp: item.timestamp,
    eventType: item.eventType || item.compact?.kind || "",
    sourceIndex: item.sourceIndex ?? null,
    text,
    textLength: item.textLength ?? text.length,
    truncated: item.truncated,
    compact: item.compact || null,
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
  const special = compactSpecialTurnMatch(turn, query, typeFilter);
  return special == null ? compactStandardTurnMatch(turn, query, typeFilter) : special;
}

function compactSpecialTurnMatch(turn, query, typeFilter) {
  if (typeFilter === "tool") return Boolean(turn.children?.length);
  const { hasCompact, hasContext } = compactContextEventFlags(turn);
  if (typeFilter === "compact") return hasCompact && compactTurnQueryMatches(turn, query);
  if (typeFilter === "system") return hasContext && compactTurnQueryMatches(turn, query);
  return null;
}

function compactStandardTurnMatch(turn, query, typeFilter) {
  if (![
    "all",
    "message",
    "error",
  ].includes(typeFilter)) return false;
  const hasMessage = turn.userMessages?.length || compactAssistantMessages(turn).length;
  if (typeFilter === "message" && !hasMessage) return false;
  const haystack = compactTurnSearchText(turn);
  if (typeFilter === "error" && !/error|failed|失败|错误/i.test(haystack)) return false;
  return !query || haystack.includes(query);
}

function compactTurnQueryMatches(turn, query) {
  return !query || compactTurnSearchText(turn).includes(query);
}

function compactContextEventFlags(turn) {
  const events = contextEventsForTurn(turn);
  return { hasCompact: events.some((event) => event.contextKind === "compaction"), hasContext: events.length > 0 };
}

function compactNodeMatchesType(node, typeFilter) {
  if (typeFilter === "all") return true;
  if (typeFilter === "message") return Boolean(node.turns?.some((turn) => turn.userMessages?.length || compactAssistantMessages(turn).length));
  if (typeFilter === "tool") return !node.session || Boolean(node.edgeStatus || node.spawnEvent || node.notificationEvent);
  if (typeFilter === "compact") return Boolean(node.turns?.some((turn) => contextEventsForTurn(turn).some((event) => event.contextKind === "compaction")));
  if (typeFilter === "system") return Boolean(node.turns?.some((turn) => contextEventsForTurn(turn).length > 0));
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
    node.notificationSummary?.label,
    node.notificationSummary?.body,
    ...(node.turns || []).map(compactTurnSearchText),
    ...(node.children || []).map(compactSearchText),
  ];
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function compactTurnSearchText(turn) {
  const parts = [
    turn.id,
    turn.status,
    ...(turn.userMessages || []).flatMap((message) => compactMessageSearchParts(message)),
    ...compactAssistantMessages(turn).flatMap((message) => compactMessageSearchParts(message)),
    ...contextEventsForTurn(turn).flatMap(compactContextEventSearchParts),
    ...(turn.children || []).map(compactSearchText),
  ];
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function compactContextEventSearchParts(event = {}) {
  return [
    event.contextKind,
    event.eventType,
    event.text,
    event.instruction?.text,
    event.userText?.text,
    event.skill?.name,
    event.skill?.sourceFile,
    event.state,
    event.compact?.kind,
    event.compact?.phase,
    event.compact?.windowNumber,
    event.compact?.windowId,
    event.compact?.previousWindowId,
    event.compact?.firstWindowId,
    ...(event.compact?.replacementHistoryPreview || []).flatMap((entry) => [
      entry.type,
      entry.role,
      entry.name,
      entry.turnId,
      entry.messageId,
      entry.preview,
    ]),
  ];
}

// The renderer stays isolated while its interaction model is migrated into analysis.
// eslint-disable-next-line no-unused-vars
function renderCompactOutline(node, context) {
  const stats = compactOutlineStats(node);
  return `
    <nav class="compact-outline" aria-label="阅读视图层级目录">
      <div class="compact-outline-section">
        <div class="compact-outline-head">
          <strong>执行层级</strong>
          <span>${escapeHtml([`${stats.threads} 线程`, `${stats.turns} 轮次`, stats.compacts ? `${stats.compacts} 压缩` : ""].filter(Boolean).join(" · "))}</span>
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
  const evidenceScope = evidenceScopeForSession(session, context.evidenceScope);
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
        evidenceScope,
        threadPath: context.path,
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
            evidenceScope,
          }),
        )
        .join("");
  const repeatedNotice = repeated ? `<div class="compact-outline-note" style="--depth:${depth + 1}">已出现过，停止展开</div>` : "";
  const unanchoredTitle =
    unanchoredChildren && (node.turns || []).length
      ? `<div class="compact-outline-note" style="--depth:${depth + 1}">未定位到具体轮次的子代理</div>`
      : "";
  return `
    <div class="compact-outline-group">
      <button class="compact-outline-item thread" role="button" tabindex="-1" type="button" style="--depth:${depth}" data-compact-nav-target="${escapeAttr(targetId)}" data-evidence-id="${escapeAttr(buildEvidenceId({ ...evidenceScope, threadPath: context.path, entity: "session" }))}" aria-label="${escapeAttr(`${context.root ? "根会话" : "子代理"}：${name}`)}">
        <span class="compact-outline-indent" aria-hidden="true"></span>
        <span class="compact-outline-icon">${context.root ? "R" : "A"}</span>
        <span class="compact-outline-copy">
          <strong class="markdown-inline-title">${renderMarkdownTitle(name, context.query)}</strong>
          <em>${escapeHtml([session.agentRole, node.notificationSummary?.label, `${(node.turns || []).length} 轮次`].filter(Boolean).join(" · "))}</em>
        </span>
      </button>
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
    evidenceScope: context.evidenceScope,
  });
}

function renderCompactOutlineTurn(turn, context) {
  const depth = Math.min(context.depth ?? 0, 8);
  const targetId = compactElementId("turn", context.path);
  const compactEvents = compactEventsForTurn(turn)
    .map((event, index) =>
      renderCompactOutlineContextEvent(event, {
        depth: depth + 1,
        path: `${context.path}-compact-${index}`,
        query: context.query,
        evidenceScope: context.evidenceScope,
        threadPath: context.threadPath,
      }),
    )
    .join("");
  const embeddedSubagents = renderCompactOutlineEmbeddedSubagents(turn.embeddedSubagents || [], {
    depth: depth + 1,
    path: context.path,
    query: context.query,
    evidenceScope: context.evidenceScope,
    threadPath: context.threadPath,
  });
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
              evidenceScope: context.evidenceScope,
            }),
          )
          .join("");
  return `
    <div class="compact-outline-group">
      <button class="compact-outline-item turn" role="button" tabindex="-1" type="button" style="--depth:${depth}" data-compact-nav-target="${escapeAttr(targetId)}" data-evidence-id="${escapeAttr(buildEvidenceId({ ...context.evidenceScope, threadPath: context.threadPath, turnNumber: turn.turnNumber, entity: "turn" }))}" aria-label="${escapeAttr(`第 ${turn.turnNumber || ""} 轮：${compactTurnOutlineTitle(turn)}`)}">
        <span class="compact-outline-indent" aria-hidden="true"></span>
        <span class="compact-outline-icon">T</span>
        <span class="compact-outline-copy">
          <strong>第 ${escapeHtml(String(turn.turnNumber || ""))} 轮</strong>
          <em>${highlight(escapeHtml(compactTurnOutlineTitle(turn)), context.query)}</em>
        </span>
      </button>
      ${compactEvents}
      ${embeddedSubagents}
      ${children}
    </div>
  `;
}

function renderCompactOutlineEmbeddedSubagents(batches, context) {
  if (!batches.length) return "";
  const targetId = compactEmbeddedSubagentTargetId(context.path);
  return batches
    .map((batch, batchIndex) => {
      const status = batch.status || "unknown";
      const tasks = compactEmbeddedTaskViews(batch);
      const eventIndex = batch.outputSourceIndex ?? batch.sourceIndex ?? batchIndex;
      const runLabel = `内嵌调用 ${batchIndex + 1}`;
      const taskNodes = tasks
        .map((task, taskIndex) => {
          const taskStatus = task.status || status;
          const taskLabel = `子代理：${task.agent || "未指定代理"}`;
          const taskMeta = [compactEmbeddedSubagentStatusLabel(taskStatus), compactEmbeddedTaskTitle(task.task)].filter(Boolean).join(" · ");
          return `<button class="compact-outline-item embedded-subagent status-${escapeAttr(taskStatus)}" role="button" tabindex="-1" type="button" style="--depth:${Math.min(context.depth + 1, 9)}" data-compact-nav-target="${escapeAttr(targetId)}" data-evidence-id="${escapeAttr(buildEvidenceId({ ...context.evidenceScope, threadPath: context.threadPath, eventIndex: `${eventIndex}:${taskIndex}`, entity: "embedded-subagent-task" }))}" aria-label="${escapeAttr(`${taskLabel}：${taskMeta}`)}"><span class="compact-outline-indent" aria-hidden="true"></span><span class="compact-outline-icon">A</span><span class="compact-outline-copy"><strong>${highlight(escapeHtml(taskLabel), context.query)}</strong><em>${highlight(escapeHtml(taskMeta), context.query)}</em></span></button>`;
        })
        .join("");
      return `<div class="compact-outline-group"><button class="compact-outline-item embedded-subagent-run status-${escapeAttr(status)}" role="button" tabindex="-1" type="button" style="--depth:${Math.min(context.depth, 8)}" data-compact-nav-target="${escapeAttr(targetId)}" data-evidence-id="${escapeAttr(buildEvidenceId({ ...context.evidenceScope, threadPath: context.threadPath, eventIndex, entity: "embedded-subagent" }))}" aria-label="${escapeAttr(`${runLabel}：${compactEmbeddedSubagentStatusLabel(status)}`)}"><span class="compact-outline-indent" aria-hidden="true"></span><span class="compact-outline-icon">A</span><span class="compact-outline-copy"><strong>${escapeHtml(runLabel)}</strong><em>${escapeHtml(compactEmbeddedSubagentStatusLabel(status))}</em></span></button>${taskNodes}</div>`;
    })
    .join("");
}

function renderCompactOutlineContextEvent(event, context) {
  const compact = event.compact || {};
  const depth = Math.min(context.depth ?? 0, 9);
  const targetId = compactElementId("event", context.path || `event-${event.sourceIndex ?? event.id ?? "compact"}`);
  const isSummary = compact.kind === "compacted" || event.eventType === "compacted";
  const label = isSummary ? "上下文压缩摘要" : "上下文压缩完成";
  const meta = [
    compact.windowNumber != null ? `窗口 ${compact.windowNumber}` : "",
    compact.replacementHistoryCount ? `替换 ${compact.replacementHistoryCount}` : "",
    formatDate(event.timestamp),
  ]
    .filter(Boolean)
    .join(" · ");
  return `
    <button class="compact-outline-item compact-event" role="button" tabindex="-1" type="button" style="--depth:${depth}" data-compact-nav-target="${escapeAttr(targetId)}" data-evidence-id="${escapeAttr(buildEvidenceId({ ...context.evidenceScope, threadPath: context.threadPath, eventIndex: event.sourceIndex ?? event.id, entity: "event" }))}" aria-label="${escapeAttr(label)}">
      <span class="compact-outline-indent" aria-hidden="true"></span>
      <span class="compact-outline-icon">C</span>
      <span class="compact-outline-copy">
        <strong>${highlight(escapeHtml(label), context.query)}</strong>
        <em>${highlight(escapeHtml(meta || "压缩事件"), context.query)}</em>
      </span>
    </button>
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
  const text = turn.userMessages?.[0]?.text || compactAssistantMessages(turn)[0]?.text || turn.status || "";
  return text || "无消息";
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
      stats.compacts += childStats.compacts;
      return stats;
    },
    { turns: (node.turns || []).length, threads: 1, compacts: (node.turns || []).reduce((count, turn) => count + compactEventsForTurn(turn).length, 0) },
  );
}

function compactElementId(kind, path) {
  return `compact-${kind}-${String(path || "root").replace(/[^a-z0-9_-]/gi, "-")}`;
}

function scrollToCompactTarget(targetId) {
  if (!targetId) return;
  const target = els.compactContent.querySelector(`#${cssEscape(targetId)}`);
  if (!target) return;
  setCompactTimelineReadingTarget(targetId);
  target.scrollIntoView({ behavior: preferredScrollBehavior(), block: "start" });
  target.classList.remove("compact-jump-highlight");
  if (prefersReducedMotion()) return;
  window.setTimeout(() => {
    target.classList.add("compact-jump-highlight");
    window.setTimeout(() => target.classList.remove("compact-jump-highlight"), 1400);
  }, 80);
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function preferredScrollBehavior() {
  return prefersReducedMotion() ? "auto" : "smooth";
}

function scrollToCompactEvent(sourceIndex) {
  if (sourceIndex == null || sourceIndex === "") return;
  const target = els.compactContent.querySelector(`[data-compact-source-index="${cssEscape(String(sourceIndex))}"]`);
  if (!target) return;
  scrollToCompactTarget(target.id);
}

function scrollToCompactReplacementTarget(source) {
  if (!source) return;
  const scope = source.closest(".compact-thread") || els.compactContent;
  const turnIndex = source.dataset.compactReplacementTurnIndex;
  const ownerItemIndex = source.dataset.compactReplacementOwnerItemIndex;
  const itemIndex = source.dataset.compactReplacementItemIndex;
  const turnNumber = source.dataset.compactReplacementTurnNumber;
  const target =
    compactReplacementTargetElement(scope, turnIndex, ownerItemIndex) ||
    compactReplacementTargetElement(scope, turnIndex, itemIndex) ||
    (turnNumber ? scope.querySelector(`[data-compact-turn-number="${cssEscape(turnNumber)}"]`) : null);
  if (!target?.id) return;
  scrollToCompactTarget(target.id);
}

function compactReplacementTargetElement(scope, turnIndex, itemIndex) {
  if (!scope || turnIndex == null || turnIndex === "" || itemIndex == null || itemIndex === "") return null;
  return scope.querySelector(`[data-compact-turn-index="${cssEscape(String(turnIndex))}"][data-compact-item-index="${cssEscape(String(itemIndex))}"]`);
}

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

function renderCompactMessage(kind, label, message, query, path) {
  const meta = [formatDate(message.timestamp), message.phase, message.truncated ? `已截断 ${compactNumber(message.textLength || 0)} 字符` : ""]
    .filter(Boolean)
    .join(" · ");
  const targetId = compactElementId("message", path || `${kind}-${message.turnIndex ?? "x"}-${message.itemIndex ?? message.id ?? "message"}`);
  const targetAttrs = [
    Number.isInteger(message.turnIndex) ? `data-compact-turn-index="${escapeAttr(String(message.turnIndex))}"` : "",
    Number.isInteger(message.itemIndex) ? `data-compact-item-index="${escapeAttr(String(message.itemIndex))}"` : "",
    message.sourceIndex != null ? `data-compact-message-source-index="${escapeAttr(String(message.sourceIndex))}"` : "",
    message.messageId ? `data-compact-message-id="${escapeAttr(String(message.messageId))}"` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return `
    <section class="compact-message ${kind}" id="${escapeAttr(targetId)}" tabindex="-1" ${targetAttrs}>
      <div class="compact-message-label">
        <span class="compact-message-role">${escapeHtml(label)}</span>
        ${renderContextUsageBadge(message.contextUsage)}
        ${renderCompressionRefBadge(message.compressionRefs)}
        <em>${escapeHtml(meta)}</em>
      </div>
      ${renderMarkdownMessage(message.text || "", query)}
    </section>
  `;
}

function compactMessageSearchParts(message = {}) {
  return [
    message.text,
    ...(message.compressionRefs || []).flatMap((ref) => [
      ref.compactTurnNumber != null ? `被替换到第 ${ref.compactTurnNumber} 轮` : "",
      ref.eventIndex != null ? `事件 ${ref.eventIndex}` : "",
      ref.replacementIndex != null ? `替换记录 ${ref.replacementIndex}` : "",
      ref.replacementRole,
      ref.replacementType,
      ref.replacementItemType,
      ref.replacementPreview,
      ref.summaryPreview,
    ]),
  ];
}

function renderCompactContextEvent(event, query, path) {
  if (event.contextKind === "skill-declaration" || event.contextKind === "skill-read") {
    return renderCompactSkillContextEvent(event, query, path);
  }
  const compact = event.compact || {};
  const eventPath = path || `event-${event.sourceIndex ?? event.id ?? "compact"}`;
  const targetId = compactElementId("event", eventPath);
  const sourceAttr = event.sourceIndex != null ? ` data-compact-source-index="${escapeAttr(String(event.sourceIndex))}"` : "";
  const isPiCompaction = compact.source === "pi" || compact.kind === "pi_compaction";
  const isSummary = isPiCompaction || compact.kind === "compacted" || event.eventType === "compacted";
  const label = isPiCompaction ? "Pi 上下文压缩" : isSummary ? "上下文压缩摘要" : "上下文压缩完成";
  const meta = [
    formatDate(event.timestamp),
    compact.tokensBefore != null ? `压缩前 ${compactNumber(compact.tokensBefore)} tokens` : "",
    compact.windowNumber != null ? `窗口 ${compact.windowNumber}` : "",
    compact.retainedTailCount != null ? `保留 ${compact.retainedTailCount} 条` : "",
    compact.replacementHistoryCount ? `替换历史 ${compact.replacementHistoryCount}` : "",
    event.truncated ? `已截断 ${compactNumber(event.textLength || 0)} 字符` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const rawButton =
    event.sourceIndex != null
      ? `<button class="ghost-button small" type="button" data-compact-event-index="${escapeAttr(String(event.sourceIndex))}">查看原始事件</button>`
      : "";
  const body = event.text
    ? renderMarkdownMessage(event.text, query)
    : `<div class="compact-missing">压缩完成事件没有携带摘要正文；摘要正文通常在相邻的 compacted 事件里。</div>`;
  return `
    <section class="compact-context-event phase-${escapeAttr(compact.phase || "event")}" id="${escapeAttr(targetId)}" tabindex="-1"${sourceAttr}>
      <div class="compact-context-head">
        <span class="compact-context-icon" aria-hidden="true">C</span>
        <span class="compact-context-title">
          <strong>${escapeHtml(label)}</strong>
          <em>${escapeHtml(meta)}</em>
        </span>
        ${rawButton}
      </div>
      ${renderCompactContextMeta(compact)}
      <div class="compact-context-body">${body}</div>
      ${renderCompactReplacementHistory(compact, query, "compact")}
    </section>
  `;
}

function renderCompactSkillContextEvent(event, query, path) {
  if (event.contextKind === "skill-declaration") return renderCompactSkillDeclaration(event, query, path);
  return renderCompactSkillRead(event, query, path);
}

function renderCompactSkillDeclaration(event, query, path) {
  const targetId = compactElementId("context", path || `${event.contextKind}-${event.sourceIndex ?? "x"}`);
  const sourceAttr = contextSourceAttribute(event.sourceIndex);
  const rawButton = contextRawButton(event.sourceIndex);
  const meta = [formatDate(event.timestamp), event.skill?.sourceFile || "SKILL.md"].filter(Boolean).join(" · ");
  const instruction = event.instruction?.text
    ? `<details class="compact-skill-instruction"><summary>Skill 指令</summary><div>${renderMarkdownMessage(event.instruction.text, query)}</div></details>`
    : "";
  const userText = event.userText?.text ? `<div class="compact-skill-user-text">${renderMarkdownMessage(event.userText.text, query)}</div>` : "";
  return `
    <section class="compact-context-event phase-skill" id="${escapeAttr(targetId)}" tabindex="-1"${sourceAttr}>
      <div class="compact-context-head">
        <span class="compact-context-icon" aria-hidden="true">S</span>
        <span class="compact-context-title"><strong>检测到 Skill 指令块</strong><em>${escapeHtml(meta)}</em></span>
        ${rawButton}
      </div>
      <div class="compact-skill-name">${highlight(escapeHtml(event.skill?.name || "未命名 Skill"), query)}</div>
      ${instruction}
      ${userText}
    </section>
  `;
}

function renderCompactSkillRead(event, query, path) {
  const targetId = compactElementId("context", path || `${event.contextKind}-${event.sourceIndex ?? "x"}`);
  const sourceIndex = event.outputSourceIndex ?? event.sourceIndex;
  const state = skillReadStateLabel(event.state);
  const meta = [formatDate(event.timestamp), event.completedAt ? `结束 ${formatDate(event.completedAt)}` : "", event.skill?.sourceFile || "SKILL.md", skillReadResultLabel(event.state)].filter(Boolean).join(" · ");
  const name = event.skill?.name ? `：${event.skill.name}` : "";
  return `
    <section class="compact-context-event phase-skill-read state-${escapeAttr(event.state || "attempted")}" id="${escapeAttr(targetId)}" tabindex="-1"${contextSourceAttribute(sourceIndex)}>
      <div class="compact-context-head">
        <span class="compact-context-icon" aria-hidden="true">S</span>
        <span class="compact-context-title"><strong>${escapeHtml(state)}</strong><em>${escapeHtml(meta)}</em></span>
        ${contextRawButton(sourceIndex)}
      </div>
      <div class="compact-skill-name">${highlight(escapeHtml(`${event.skill?.sourceFile || "SKILL.md"}${name}`), query)}</div>
    </section>
  `;
}

function contextSourceAttribute(sourceIndex) {
  return sourceIndex != null ? ` data-compact-source-index="${escapeAttr(String(sourceIndex))}"` : "";
}

function contextRawButton(sourceIndex) {
  return sourceIndex != null
    ? `<button class="ghost-button small" type="button" title="查看原始记录" aria-label="查看原始记录" data-compact-event-index="${escapeAttr(String(sourceIndex))}">原始记录</button>`
    : "";
}

function skillReadStateLabel(state) {
  if (state === "confirmed") return "检测到 Skill 定义读取记录";
  if (state === "failed") return "检测到 Skill 定义读取失败记录";
  return "检测到未完成的 Skill 定义读取记录";
}

function skillReadResultLabel(state) {
  if (state === "confirmed") return "工具结果成功";
  if (state === "failed") return "工具结果失败";
  return "未见工具结果";
}

function renderCompactContextMeta(compact = {}) {
  const rows = [
    ["当前窗口", compact.windowId],
    ["上一窗口", compact.previousWindowId],
    ["首个窗口", compact.firstWindowId],
  ].filter(([, value]) => value);
  if (!rows.length) return "";
  return `<div class="compact-context-meta">${rows
    .map(([label, value]) => `<span><strong>${escapeHtml(label)}</strong>${escapeHtml(String(value))}</span>`)
    .join("")}</div>`;
}

function renderCompactReplacementHistory(compact = {}, query = "", variant = "compact") {
  const preview = Array.isArray(compact.replacementHistoryPreview) ? compact.replacementHistoryPreview : [];
  const total = Number.isFinite(Number(compact.replacementHistoryCount)) ? Number(compact.replacementHistoryCount) : preview.length;
  if (!preview.length) {
    return total
      ? `<div class="compact-replacement-empty ${escapeAttr(variant)}">替换历史包含 ${escapeHtml(String(total))} 条记录；当前接口未提供可展示预览，可在原始 JSON 中查看完整原始内容。</div>`
      : "";
  }
  const more = Math.max(0, total - preview.length);
  const countLabel = `${preview.length}${more ? ` / ${total}` : ""}`;
  const coverage = compactReplacementCoverageSummary(compact, preview, total);
  return `
    <details class="compact-replacement ${escapeAttr(variant)}" open>
      <summary>
        <span>被替换的对话</span>
        <strong>${escapeHtml(countLabel)}</strong>
        ${compact.replacementHistoryPreviewTruncated || more ? `<em>还有 ${escapeHtml(String(more))} 条在原始 JSON</em>` : ""}
      </summary>
      ${coverage ? `<div class="compact-replacement-coverage">${coverage.map((item) => `<span><strong>${escapeHtml(item.value)}</strong>${escapeHtml(item.label)}</span>`).join("")}</div>` : ""}
      <div class="compact-replacement-list">
        ${preview.map((entry) => renderCompactReplacementEntry(entry, query)).join("")}
      </div>
    </details>
  `;
}

function compactReplacementCoverageSummary(compact = {}, preview = [], total = preview.length) {
  if (!preview.length) return [];
  const roles = compact.replacementRoleCounts || roleCountsFromReplacementPreview(preview);
  const roleLabel = Object.entries(roles)
    .sort((left, right) => right[1] - left[1])
    .map(([role, count]) => `${compactReplacementRoleLabel(role)} ${count}`)
    .join(" / ");
  const turnNumbers = Array.isArray(compact.replacementTurnNumbers)
    ? compact.replacementTurnNumbers
    : [
        ...new Set(
          preview
            .map((entry) => entry.turnNumber)
            .filter((value) => Number.isInteger(value)),
        ),
      ].sort((left, right) => left - right);
  const turnLabel = compactReplacementTurnRangeLabel(turnNumbers);
  const longest = preview.reduce((current, entry) => (Number(entry.textLength || 0) > Number(current?.textLength || 0) ? entry : current), preview[0]);
  const rows = [
    turnLabel ? { label: "覆盖范围", value: turnLabel } : null,
    roleLabel ? { label: "角色构成", value: roleLabel } : null,
    total ? { label: "替换条目", value: String(total) } : null,
    longest?.textLength ? { label: "最长条目", value: `替换记录 ${longest.index ?? "?"} · ${compactNumber(longest.textLength)} 字符` } : null,
  ].filter(Boolean);
  return rows;
}

function roleCountsFromReplacementPreview(preview = []) {
  const counts = {};
  for (const entry of preview) {
    const key = entry.role || entry.type || "item";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function compactReplacementTurnRangeLabel(turnNumbers = []) {
  if (!turnNumbers.length) return "";
  if (turnNumbers.length === 1) return `第 ${turnNumbers[0]} 轮`;
  const ranges = [];
  let start = turnNumbers[0];
  let previous = turnNumbers[0];
  for (const value of turnNumbers.slice(1)) {
    if (value === previous + 1) {
      previous = value;
      continue;
    }
    ranges.push(start === previous ? `第 ${start} 轮` : `第 ${start}-${previous} 轮`);
    start = value;
    previous = value;
  }
  ranges.push(start === previous ? `第 ${start} 轮` : `第 ${start}-${previous} 轮`);
  return ranges.join(", ");
}

function renderCompactReplacementEntry(entry = {}, query = "") {
  const role = String(entry.role || "unknown").toLowerCase();
  const roleLabel = compactReplacementRoleLabel(entry.role);
  const turnLabel = Number.isInteger(entry.turnNumber) ? `第 ${entry.turnNumber} 轮` : "";
  const typeLabel = [entry.type, ...(entry.contentKinds || [])].filter(Boolean).join(" / ");
  const meta = [
    entry.textLength != null ? `${compactNumber(entry.textLength)} 字符` : "",
    typeLabel,
    entry.truncated ? "已截断" : "",
    entry.turnId ? `轮次 ID ${compactReplacementShortId(entry.turnId)}` : "",
    entry.messageId ? `消息 ID ${compactReplacementShortId(entry.messageId)}` : "",
    formatDate(entry.timestamp),
  ]
    .filter(Boolean)
    .join(" · ");
  const preview = entry.preview || "[无文本内容]";
  const context = [turnLabel, entry.turnStatus, formatDate(entry.turnStartedAt)].filter(Boolean).join(" · ");
  const assistantPreview = entry.assistantPreview && entry.assistantPreview !== preview ? entry.assistantPreview : "";
  const targetAttrs = compactReplacementTargetAttrs(entry);
  const tag = targetAttrs ? "button" : "div";
  return `
    <${tag} class="compact-replacement-row role-${escapeAttr(role)}${targetAttrs ? " actionable" : ""}" ${targetAttrs || ""}>
      <span class="compact-replacement-index">替换记录 ${escapeHtml(String(entry.index ?? ""))}</span>
      <span class="compact-replacement-role">${escapeHtml(roleLabel)}</span>
      <span class="compact-replacement-copy">
        ${context ? `<strong>${escapeHtml(context)}</strong>` : ""}
        <em>${highlight(escapeHtml(preview), query)}</em>
      </span>
      <span class="compact-replacement-meta">${escapeHtml(meta)}</span>
      ${assistantPreview ? `<span class="compact-replacement-outcome"><strong>最后回复</strong>${highlight(escapeHtml(assistantPreview), query)}</span>` : ""}
    </${tag}>
  `;
}

function compactReplacementTargetAttrs(entry = {}) {
  const target = entry.replacementTarget;
  if (!target || !Number.isInteger(target.turnIndex)) return "";
  const attrs = [
    `type="button"`,
    `data-compact-replacement-target="1"`,
    `data-compact-replacement-turn-index="${escapeAttr(String(target.turnIndex))}"`,
    target.turnNumber != null ? `data-compact-replacement-turn-number="${escapeAttr(String(target.turnNumber))}"` : "",
    Number.isInteger(target.itemIndex) ? `data-compact-replacement-item-index="${escapeAttr(String(target.itemIndex))}"` : "",
    Number.isInteger(target.ownerItemIndex) ? `data-compact-replacement-owner-item-index="${escapeAttr(String(target.ownerItemIndex))}"` : "",
    `title="定位到原始消息"`,
  ];
  return attrs.filter(Boolean).join(" ");
}

function compactReplacementRoleLabel(role) {
  const value = String(role || "").toLowerCase();
  if (value === "user") return "User";
  if (value === "assistant") return "Assistant";
  if (value === "system") return "System";
  if (value === "developer") return "Developer";
  if (value === "tool") return "Tool";
  return role ? String(role) : "Item";
}

function compactReplacementShortId(value) {
  const text = String(value || "");
  if (text.length <= 18) return text;
  return `${text.slice(0, 8)}…${text.slice(-6)}`;
}

function renderTerminal() {
  const detail = state.detail;
  if (!detail) {
    els.terminalContent.innerHTML = emptyState("选择一个会话", "Terminal 视图按执行语义展示用户、助手、工具和错误。");
    return;
  }
  const query = els.itemSearch.value.trim().toLowerCase();
  const typeFilter = els.itemTypeFilter.value;
  const blocks = buildTerminalBlocks(detail);
  const filtered = blocks.filter((block) => terminalBlockMatches(block, query, typeFilter));
  if (filtered.length === 0) {
    els.terminalContent.innerHTML = emptyState("没有匹配的 Terminal 块", "调整内容搜索或类型过滤。");
    return;
  }
  const stats = terminalRoleStats(blocks);
  const activeStats = terminalRoleStats(filtered);
  els.terminalContent.innerHTML = `
    <div class="terminal-shell">
      <div class="terminal-head">
        <div>
          <p class="eyebrow">终端会话</p>
          <h3 class="markdown-inline-title">${renderMarkdownTitle(detail.session?.title || "当前会话")}</h3>
        </div>
        <div class="terminal-role-nav" aria-label="Terminal 角色跳转">
          ${renderTerminalRoleNavButton("user", "用户", activeStats.user, stats.user)}
          ${renderTerminalRoleNavButton("assistant", "代理", activeStats.assistant, stats.assistant)}
          ${renderTerminalRoleNavButton("tool", "工具", activeStats.tool, stats.tool)}
          ${renderTerminalRoleNavButton("error", "错误", activeStats.error, stats.error)}
        </div>
      </div>
      <div class="terminal-blocks">
        ${filtered.map((block) => renderTerminalBlock(block, query)).join("")}
      </div>
    </div>
  `;
  els.terminalContent.querySelectorAll("[data-terminal-block-id]").forEach((blockEl) => {
    blockEl.addEventListener("click", (event) => {
      if (event.target.closest("a, button")) return;
      selectTerminalBlock(blockEl.dataset.terminalBlockId);
    });
    blockEl.addEventListener("keydown", (event) => {
      if (event.target.closest("a, button")) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      selectTerminalBlock(blockEl.dataset.terminalBlockId);
    });
  });
  els.terminalContent.querySelectorAll("[data-terminal-role]").forEach((button) => {
    button.addEventListener("click", () => jumpTerminalRole(button.dataset.terminalRole));
  });
}

function buildTerminalBlocks(detail) {
  const blocks = [];
  for (const turn of detail?.turns || []) {
    const turnNumber = turn.turnNumber ?? (blocks.length + 1);
    if (turn.startedAt || turn.status || turn.cwd) {
      blocks.push({
        id: `turn-${turnNumber}-meta`,
        role: "meta",
        title: `第 ${turnNumber} 轮`,
        text: [turn.status, formatDate(turn.startedAt), turn.cwd ? shortPath(turn.cwd) : ""].filter(Boolean).join(" · "),
        turnIndex: turnNumber - 1,
        timestamp: turn.startedAt,
      });
    }
    for (const item of turn.items || []) {
      blocks.push(...terminalBlocksFromItem(item, turnNumber));
    }
  }
  return blocks;
}

function terminalBlocksFromItem(item, turnNumber) {
  const ref = itemRef(item);
  const base = {
    id: ref,
    itemRef: ref,
    turnIndex: turnNumber - 1,
    timestamp: item.timestamp,
    eventIndex: item.sourceIndex ?? item.outputSourceIndex ?? null,
    title: itemTitle(item),
    role: terminalRoleForItem(item),
    text: terminalTextForItem(item),
    item,
  };
  if (!base.text && item.type !== "token-count") return [];
  if (item.type !== "tool-call" || item.output == null) return [base];
  const callText = [`$ ${item.name || "tool"}`, item.arguments == null ? "" : prettyMaybeJson(item.arguments)].filter(Boolean).join("\n");
  return [
    {
      ...base,
      id: `${ref}:call`,
      role: "tool",
      title: item.name ? `工具调用 · ${item.name}` : "工具调用",
      text: callText,
    },
    {
      ...base,
      id: `${ref}:output`,
      role: terminalItemHasError(item) ? "error" : "output",
      title: item.name ? `工具输出 · ${item.name}` : "工具输出",
      text: String(item.output || ""),
      timestamp: item.completedAt || item.timestamp,
      eventIndex: item.outputSourceIndex ?? item.sourceIndex ?? null,
    },
  ];
}

function terminalRoleForItem(item) {
  if (item.type === "user-message") return "user";
  if (item.type === "assistant-message") return "assistant";
  if (item.type === "tool-call" || item.type === "response-item") {
    return terminalItemHasError(item) ? "error" : "tool";
  }
  if (item.type === "tool-output") return terminalItemHasError(item) ? "error" : "output";
  if (item.type === "reasoning" || item.type === "token-count" || item.type === "event") return "meta";
  return "meta";
}

function terminalTextForItem(item) {
  if (item.type === "user-message" || item.type === "assistant-message") return item.text || "";
  if (item.type === "reasoning") return item.text || (item.encrypted ? "推理内容已加密存储，当前没有可展示的明文摘要。" : "");
  if (item.type === "context-compact") return item.text || item.compact?.message || item.payloadPreview || "";
  if (item.type === "token-count") return JSON.stringify(item.info || {}, null, 2);
  if (item.type === "tool-call") {
    const args = item.arguments == null ? "" : prettyMaybeJson(item.arguments);
    const output = item.output == null ? "" : String(item.output);
    return [`$ ${item.name || "tool"}`, args, output ? `\n# output\n${output}` : ""].filter(Boolean).join("\n");
  }
  if (item.type === "tool-output") return String(item.output || "");
  return item.payloadPreview || JSON.stringify(item.info || item.payload || item, null, 2);
}

function terminalItemHasError(item) {
  const text = [item.status, item.phase, item.responseType, item.eventType, item.output, item.payloadPreview].filter(Boolean).join("\n");
  return /error|failed|failure|stderr|失败|错误/i.test(text);
}

function terminalBlockMatches(block, query, typeFilter) {
  if (query && !terminalBlockSearchText(block).includes(query)) return false;
  if (typeFilter === "message") return block.role === "user" || block.role === "assistant";
  if (typeFilter === "tool") return block.role === "tool" || block.role === "output";
  if (typeFilter === "output") return block.role === "output" || (block.role === "tool" && block.item?.output);
  if (typeFilter === "reasoning") return block.item?.type === "reasoning";
  if (typeFilter === "compact") return block.item?.type === "context-compact";
  if (typeFilter === "system") return block.role === "meta";
  if (typeFilter === "error") return block.role === "error";
  return true;
}

function terminalBlockSearchText(block) {
  return [
    block.id,
    block.role,
    block.title,
    block.text,
    block.item?.name,
    block.item?.callId,
    block.item?.status,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function terminalRoleStats(blocks) {
  return blocks.reduce(
    (stats, block) => {
      if (block.role === "user") stats.user += 1;
      if (block.role === "assistant") stats.assistant += 1;
      if (block.role === "tool" || block.role === "output") stats.tool += 1;
      if (block.role === "error") stats.error += 1;
      return stats;
    },
    { user: 0, assistant: 0, tool: 0, error: 0 },
  );
}

function renderTerminalRoleNavButton(role, label, activeCount, totalCount) {
  const disabled = activeCount === 0 ? " disabled" : "";
  return `
    <button class="terminal-role-button ${role}" type="button" data-terminal-role="${escapeAttr(role)}"${disabled} title="跳转到下一处 ${escapeAttr(label)}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(activeCount))}/${escapeHtml(String(totalCount))}</strong>
    </button>
  `;
}

function renderTerminalBlock(block, query) {
  const selected = state.selectedTerminalBlockId === block.id ? " selected" : "";
  const meta = [`第 ${block.turnIndex + 1} 轮`, formatDate(block.timestamp), block.item?.name, block.item?.status]
    .filter(Boolean)
    .join(" · ");
  const body =
    block.role === "user" || block.role === "assistant"
      ? renderMarkdownMessage(block.text, query)
      : `<pre>${highlight(escapeHtml(block.text || ""), query)}</pre>`;
  return `
    <section class="terminal-block role-${escapeAttr(block.role)}${selected}" role="button" tabindex="0" data-terminal-block-id="${escapeAttr(block.id)}">
      <div class="terminal-block-strip" aria-hidden="true"></div>
      <div class="terminal-block-main">
        <div class="terminal-block-head">
          <strong>${escapeHtml(block.title || block.role)}</strong>
          <span>${escapeHtml(meta)}</span>
        </div>
        <div class="terminal-block-body">${body}</div>
        ${block.item?.truncated ? renderTruncationNotice(block.item, terminalVisibleFieldsForBlock(block)) : ""}
      </div>
    </section>
  `;
}

function selectTerminalBlock(id) {
  const block = buildTerminalBlocks(state.detail).find((candidate) => candidate.id === id);
  if (!block) return;
  state.selectedTerminalBlockId = id;
  state.selectedTraceNodeId = null;
  state.selectedEventIndex = null;
  state.selectedItemRef = block.itemRef || null;
  els.terminalContent.querySelectorAll(".terminal-block.selected").forEach((row) => row.classList.remove("selected"));
  const active = els.terminalContent.querySelector(`[data-terminal-block-id="${cssEscape(id)}"]`);
  active?.classList.add("selected");
}

function jumpTerminalRole(role) {
  const candidates = [...els.terminalContent.querySelectorAll(`[data-terminal-block-id].role-${cssEscape(role)}`)];
  if (role === "tool") {
    candidates.push(...els.terminalContent.querySelectorAll("[data-terminal-block-id].role-output"));
  }
  if (candidates.length === 0) return;
  const currentIndex = candidates.findIndex((el) => el.dataset.terminalBlockId === state.selectedTerminalBlockId);
  const next = candidates[(currentIndex + 1) % candidates.length];
  next.scrollIntoView({ behavior: preferredScrollBehavior(), block: "center" });
  selectTerminalBlock(next.dataset.terminalBlockId);
}

function renderRawView() {
  const detail = state.detail;
  if (!detail) {
    els.rawContent.innerHTML = emptyState("选择一个会话", "原始事件诊断按页读取当前会话的事件摘要。");
    return;
  }
  renderRawDiagnostic(detail);
}

function renderRawDiagnostic(detail) {
  const model = rawDiagnosticRenderModel(detail);
  const { diagnostic, currentPage } = model;
  const header = rawDiagnosticHeader(model);
  if (!currentPage) {
    els.rawContent.innerHTML = `${header}${rawDiagnosticEmptyMarkup(diagnostic)}`;
    bindRawDiagnosticActions();
    if (rawDiagnosticAwaitingFirstPage(diagnostic)) void loadRawDiagnosticPage({ restart: true });
    return;
  }
  els.rawContent.innerHTML = rawDiagnosticResultsMarkup(model, header);
  bindRawDiagnosticActions();
}

function rawDiagnosticRenderModel(detail) {
  const diagnostic = state.rawDiagnostic || (state.rawDiagnostic = createRawDiagnosticState());
  const currentPage = diagnostic.pages[diagnostic.pageIndex] || null;
  const query = els.itemSearch.value.trim().toLowerCase();
  const events = (currentPage?.events || []).filter((event) => rawEventMatches(event, query, els.itemTypeFilter.value));
  return {
    diagnostic,
    currentPage,
    events,
    limits: currentPage?.readState?.limits || {},
    query,
    selected: selectedRawViewEvent(events, events),
    selectedRawEvent: state.selectedRawEvent?.index === state.selectedEventIndex ? state.selectedRawEvent : null,
    session: detail.session || {},
  };
}

function rawDiagnosticHeader({ diagnostic, currentPage, limits, session }) {
  const stateNote = rawDiagnosticStateNote(diagnostic, currentPage, limits);
  const header = `
    <div class="raw-view-head raw-diagnostic-head">
      <div>
        <p class="eyebrow">分页原始事件诊断</p>
        <h3>${escapeHtml(session.title || selectedSessionDisplayTitle())}</h3>
        <p>数据源：${escapeHtml(session.sourceLabel || selectedSource()?.label || state.selectedSourceId)} · 独立诊断预算</p>
      </div>
      <div class="raw-view-actions">
        <button class="ghost-button small" type="button" data-retry-raw-diagnostic ${diagnostic.loading ? "disabled" : ""}>重新开始</button>
      </div>
    </div>
    <div class="raw-diagnostic-status" role="status">
      <span>${escapeHtml(diagnostic.loading ? "正在读取当前页摘要" : stateNote)}</span>
      ${currentPage ? `<span>第 ${rawDiagnosticPageNumber(currentPage, diagnostic.pageIndex)} 页 · 扫描 ${currentPage.scanned} 条</span>` : ""}
      ${diagnostic.error ? `<strong>${escapeHtml(`读取失败：${diagnostic.error}`)}</strong>` : ""}
    </div>`;
  return header;
}

function rawDiagnosticStateNote(diagnostic, currentPage, limits) {
  if (currentPage?.stopReason === "raw_event_scan_limit") return `已到达诊断事件索引上限（${compactNumber(limits.maxDiagnosticEventScan || 0)} 条），后续内容未读取。`;
  if (currentPage?.truncated) return `已到达单次诊断字节预算（${formatBytes(limits.diagnosticMaxFileBytes || 0)}），后续内容未读取。`;
  return "仅展示当前服务端分页返回的事件摘要；完整会话仍可在会话和复盘视图查看。";
}

function rawDiagnosticAwaitingFirstPage(diagnostic) {
  return !diagnostic.loading && !diagnostic.error && !diagnostic.readState;
}

function rawDiagnosticEmptyMarkup(diagnostic) {
  if (rawDiagnosticAwaitingFirstPage(diagnostic)) {
    return emptyState("准备读取有界事件摘要", "不会预取完整 JSONL；只读取当前页，选中事件后才可按需读取完整来源。");
  }
  if (diagnostic.error) return emptyState("原始事件诊断未完成", "请重新开始读取。");
  return emptyState("正在读取有界事件摘要", "正在从当前数据源读取第一页摘要。");
}

function rawDiagnosticResultsMarkup({ diagnostic, currentPage, events, selected, selectedRawEvent }, header) {
  const canLoadNext = Boolean(currentPage.hasMore && !diagnostic.loading);
  const canLoadPrevious = diagnostic.pageIndex > 0 && !diagnostic.loading;
  return `
    <div class="raw-view-shell raw-diagnostic-shell">
      ${header}
      <div class="raw-view-layout">
        <div class="raw-view-list">
          ${events.length ? events.map((event) => renderRawViewEventRow(event)).join("") : `<div class="raw-empty">当前页没有匹配的事件摘要。</div>`}
          <div class="raw-diagnostic-pagination">
            <button class="ghost-button small" type="button" data-previous-raw-page ${canLoadPrevious ? "" : "disabled"}>上一页</button>
            <button class="ghost-button small" type="button" data-next-raw-page ${canLoadNext ? "" : "disabled"}>${diagnostic.loading ? "读取中" : currentPage.hasMore ? "下一页" : "已到达边界"}</button>
          </div>
        </div>
        <div class="raw-view-preview${selected && isCompactEvent(selected) ? " has-insight" : ""}">
          <div class="raw-preview-title">
            <strong>${escapeHtml(selected ? `事件 ${selected.index} ${humanEventTitle(selected)}` : "事件摘要")}</strong>
            <span>${escapeHtml(selected ? selected.kind || "" : "未选择")}</span>
          </div>
          ${selected ? renderRawEventInsight(selectedRawEvent || selected, els.itemSearch.value.trim().toLowerCase()) : ""}
          <pre class="raw-preview">${escapeHtml(JSON.stringify(selectedRawEvent?.raw || selected || { page: currentPage.page, readState: diagnostic.readState }, null, 2))}</pre>
        </div>
      </div>
    </div>`;
}

function bindRawDiagnosticActions() {
  els.rawContent.querySelectorAll("[data-raw-event-index]").forEach((button) => {
    button.addEventListener("click", () => selectRawViewEvent(Number(button.dataset.rawEventIndex)));
  });
  els.rawContent.querySelector("[data-retry-raw-diagnostic]")?.addEventListener("click", () => void loadRawDiagnosticPage({ restart: true }));
  els.rawContent.querySelector("[data-previous-raw-page]")?.addEventListener("click", () => {
    state.rawDiagnostic.pageIndex -= 1;
    state.selectedEventIndex = null;
    renderRawView();
    });
  els.rawContent.querySelector("[data-next-raw-page]")?.addEventListener("click", () => void loadRawDiagnosticPage());
}

async function loadRawDiagnosticPage({ restart = false, cursor = null } = {}) {
  if (!restart && showCachedNextRawDiagnosticPage()) return;
  const request = startRawDiagnosticPageRequest(restart, cursor);
  if (!request) return;
  renderRawView();
  try {
    const data = await fetchJson(sourceSessionEventsUrl(request.sessionId, request.sourceId, { cursor: request.cursor }), { signal: request.controller.signal });
    if (!rawDiagnosticRequestIsCurrent(request)) return;
    applyRawDiagnosticPage(request, data);
  } catch (error) {
    if (isAbortError(error)) return;
    failRawDiagnosticPage(request, error);
  } finally {
    if (rawDiagnosticAbortController === request.controller) rawDiagnosticAbortController = null;
    if (rawDiagnosticStillSelected(request)) {
      request.diagnostic.loading = false;
      renderRawView();
        }
  }
}

function startRawDiagnosticPageRequest(restart, initialCursor = null) {
  const detail = state.detail;
  if (!rawDiagnosticDetailAvailable(detail)) return null;
  const sourceId = detail.session.sourceId || state.selectedSourceId;
  const diagnosticSessionKey = sessionKey({ id: detail.session.id, sourceId });
  let diagnostic = state.rawDiagnostic || (state.rawDiagnostic = createRawDiagnosticState());
  if (restart || diagnostic.sessionKey !== diagnosticSessionKey) {
    cancelRawDiagnosticRequest();
    if (restart) cancelRawEventRequest();
    clearRawEventCache();
    diagnostic = createRawDiagnosticState();
    diagnostic.sessionKey = diagnosticSessionKey;
    state.rawDiagnostic = diagnostic;
  } else if (diagnostic.loading) {
    return null;
  }
  const cursor = initialCursor ?? rawDiagnosticRequestCursor(diagnostic, restart);
  if (cursor == null) return null;
  rawDiagnosticAbortController?.abort();
  const controller = new AbortController();
  rawDiagnosticAbortController = controller;
  diagnostic.requestSeq += 1;
  diagnostic.loading = true;
  diagnostic.error = "";
  diagnostic.readState = null;
  if (restart) resetRawDiagnosticPages(diagnostic, { clearSelection: true });
  return { controller, cursor, diagnostic, diagnosticSessionKey, requestSeq: diagnostic.requestSeq, sessionId: detail.session.id, sourceId };
}

function rawDiagnosticDetailAvailable(detail) {
  return state.viewMode === "diagnostic" && state.diagnosticMode === "raw" && Boolean(detail?.session?.id);
}

function rawDiagnosticRequestCursor(diagnostic, restart) {
  if (restart) return 0;
  if (rawDiagnosticCachedNextPage(diagnostic)) return null;
  const currentPage = diagnostic.pages[diagnostic.pageIndex];
  if (!currentPage?.hasMore || currentPage.nextCursor == null) return null;
  return currentPage.nextCursor;
}

function rawDiagnosticCachedNextPage(diagnostic) {
  const currentPage = diagnostic.pages[diagnostic.pageIndex];
  const nextPage = diagnostic.pages[diagnostic.pageIndex + 1];
  return currentPage?.hasMore && nextPage?.cursor === currentPage.nextCursor ? nextPage : null;
}

function showCachedNextRawDiagnosticPage() {
  const diagnostic = state.rawDiagnostic;
  if (!diagnostic || diagnostic.loading || !rawDiagnosticCachedNextPage(diagnostic)) return false;
  diagnostic.pageIndex += 1;
  state.selectedEventIndex = null;
  renderRawView();
  return true;
}

function rawDiagnosticPageNumber(page, fallbackIndex) {
  return Number.isInteger(page?.pageNumber) ? page.pageNumber : fallbackIndex + 1;
}

function resetRawDiagnosticPages(diagnostic, { clearSelection = false, readState = null } = {}) {
  diagnostic.pages = [];
  diagnostic.pageIndex = 0;
  diagnostic.readState = readState;
  clearRawEventCache();
  state.selectedRawEvent = null;
  if (clearSelection) state.selectedEventIndex = null;
}

function rawDiagnosticRequestIsCurrent(request) {
  return !request.controller.signal.aborted && state.viewMode === "diagnostic" && state.diagnosticMode === "raw" && state.selectedSessionKey === request.diagnosticSessionKey && state.rawDiagnostic === request.diagnostic && request.diagnostic.requestSeq === request.requestSeq;
}

function rawDiagnosticStillSelected(request) {
  return state.rawDiagnostic === request.diagnostic && state.selectedSessionKey === request.diagnosticSessionKey;
}

function applyRawDiagnosticPage(request, data) {
  const { diagnostic } = request;
  const page = { ...data.page, events: data.events || [], readState: data.readState || null };
  if (!rawDiagnosticPageMatchesRequest(request, page)) {
    resetRawDiagnosticPages(diagnostic);
    diagnostic.error = "原始事件诊断响应与当前分页不一致，请重新开始读取。";
    return;
  }
  page.pageNumber = rawDiagnosticNextPageNumber(diagnostic);
  diagnostic.readState = page.readState;
  diagnostic.pages.push(page);
  if (diagnostic.pages.length > 6) diagnostic.pages.shift();
  retainRawEventsForDiagnosticPages(diagnostic);
  diagnostic.pageIndex = diagnostic.pages.length - 1;
  state.selectedEventIndex = null;
}

function retainRawEventsForDiagnosticPages(diagnostic) {
  const retainedIndexes = new Set(diagnostic.pages.flatMap((cachedPage) => cachedPage.events || []).map((event) => event.index));
  state.rawEventCache.retain((entry) => (
    entry.sessionKey === diagnostic.sessionKey
    && retainedIndexes.has(entry.index)
  ));
}

function rawDiagnosticPageMatchesRequest(request, page) {
  return Number.isInteger(page.cursor)
    && page.cursor === request.cursor
    && !request.diagnostic.pages.some((cachedPage) => cachedPage.cursor === page.cursor);
}

function rawDiagnosticNextPageNumber(diagnostic) {
  const lastPage = diagnostic.pages.at(-1);
  return lastPage ? rawDiagnosticPageNumber(lastPage, diagnostic.pages.length - 1) + 1 : 1;
}

function failRawDiagnosticPage(request, error) {
  if (!rawDiagnosticRequestIsCurrent(request)) return;
  resetRawDiagnosticPages(request.diagnostic);
  request.diagnostic.error = error.message;
}

function rawEventMatches(event, query, typeFilter) {
  if (query && !JSON.stringify(event).toLowerCase().includes(query)) return false;
  if (typeFilter === "message") return event.kind === "user_message" || event.kind === "agent_message" || event.role === "user" || event.role === "assistant";
  if (typeFilter === "tool") return /tool|call|function|mcp|patch/i.test([event.kind, event.type, event.payloadType].filter(Boolean).join(" "));
  if (typeFilter === "output") return /output|result/i.test([event.kind, event.type, event.payloadType, event.title].filter(Boolean).join(" "));
  if (typeFilter === "reasoning") return /reasoning/i.test([event.kind, event.type, event.payloadType].filter(Boolean).join(" "));
  if (typeFilter === "compact") return isCompactEvent(event);
  if (typeFilter === "system") return event.kind === "system" || event.kind === "token_count" || event.kind === "session_meta" || isCompactEvent(event);
  if (typeFilter === "error") return /error|failed|失败|错误/i.test(JSON.stringify(event));
  return true;
}

function selectedRawViewEvent(shown, events) {
  if (state.selectedEventIndex != null) {
    return events.find((event) => event.index === state.selectedEventIndex) || shown[0] || null;
  }
  return shown[0] || null;
}

function renderRawViewEventRow(event) {
  const active = event.index === state.selectedEventIndex ? " active" : "";
  const compact = isCompactEvent(event) ? " compact-event" : "";
  return `
    <button class="raw-view-row${active}${compact}" type="button" data-raw-event-index="${event.index}" data-evidence-id="${escapeAttr(rawEventEvidenceId(event))}">
      <span class="raw-view-kind" data-overflow-tooltip>${escapeHtml(event.kind || event.type || "event")}</span>
      <strong data-overflow-tooltip>${escapeHtml(`事件 ${event.index} ${humanEventTitle(event)}`)}</strong>
      <em data-overflow-tooltip>${escapeHtml(formatDate(event.timestamp) || event.payloadType || "")}</em>
      <span data-overflow-tooltip>${escapeHtml(event.preview || "")}</span>
    </button>
  `;
}

function isCompactEvent(event) {
  return Boolean(event?.compact || event?.kind === "compacted" || event?.kind === "context_compacted" || event?.type === "compacted" || event?.payloadType === "context_compacted");
}

function renderRawEventInsight(event, query = "") {
  if (!isCompactEvent(event)) return "";
  const compact = event.compact || {};
  const isSummary = compact.kind === "compacted" || event.kind === "compacted";
  const title = isSummary ? "写入下一窗口的替换摘要" : "压缩完成标记";
  const metrics = [
    compact.windowNumber != null ? ["窗口", compact.windowNumber] : null,
    compact.messageLength ? ["摘要字符", compactNumber(compact.messageLength)] : null,
    compact.replacementHistoryCount ? ["替换历史", compact.replacementHistoryCount] : null,
  ].filter(Boolean);
  const ids = [
    ["当前", compact.windowId],
    ["上一窗口", compact.previousWindowId],
    ["首个窗口", compact.firstWindowId],
  ].filter(([, value]) => value);
  const body = compact.message || event.preview || "";
  return `
    <section class="raw-compact-insight">
      <div class="raw-compact-head">
        <span class="raw-compact-icon">C</span>
        <div>
          <strong>${escapeHtml(title)}</strong>
          <em>${escapeHtml([formatDate(event.timestamp), compact.phase].filter(Boolean).join(" · "))}</em>
        </div>
      </div>
      ${metrics.length ? `<div class="raw-compact-metrics">${metrics.map(([label, value]) => `<span><strong>${escapeHtml(String(value))}</strong>${escapeHtml(label)}</span>`).join("")}</div>` : ""}
      ${ids.length ? `<div class="raw-compact-ids">${ids.map(([label, value]) => `<span><strong>${escapeHtml(label)}</strong>${escapeHtml(String(value))}</span>`).join("")}</div>` : ""}
      <div class="raw-compact-body">${body ? renderMarkdownMessage(body, query) : `<p>该事件没有携带摘要正文；相邻 compacted 事件通常保存压缩结果。</p>`}</div>
      ${renderCompactReplacementHistory(compact, query, "raw")}
    </section>
  `;
}

async function openRawEvent(index) {
  const changed = state.viewMode !== "diagnostic" || state.diagnosticMode !== "raw";
  state.viewMode = "diagnostic";
  state.diagnosticMode = "raw";
  if (mobilePanelLayoutActive()) setMobilePanel("thread");
  state.selectedEventIndex = index;
  syncViewControls();
  renderStats();
  await loadRawDiagnosticPage({ restart: true, cursor: index });
  await selectRawViewEvent(index);
  els.rawContent.querySelector('[data-raw-event-index="' + index + '"]')?.scrollIntoView({ behavior: preferredScrollBehavior(), block: "center" });
}

async function selectRawViewEvent(index) {
  await selectRawEvent(index, { rerender: false });
  state.selectedRawEvent = null;
  renderRawView();
  try {
    const raw = await loadRawEvent(index);
    if (raw && state.selectedEventIndex === index) {
      state.selectedRawEvent = raw;
      renderRawView();
    }
  } catch (error) {
    if (!isAbortError(error)) showToast(`读取完整原始事件失败：${error.message}`);
  }
}


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

async function loadRawEvent(index, { cancelPrevious = true } = {}) {
  const id = state.detail?.session?.id;
  if (!id) throw new Error("未选择会话");
  const sourceId = state.detail?.session?.sourceId || state.selectedSourceId;
  const requestSessionKey = sessionKey({ id, sourceId });
  const diagnostic = state.rawDiagnostic;
  const cacheKey = rawEventCacheKey(sourceId, id, index);
  const cached = state.rawEventCache.get(cacheKey);
  if (cached !== undefined) return cached;
  if (cancelPrevious) cancelRawEventRequest();
  const controller = new AbortController();
  rawEventAbortController = controller;
  try {
    const raw = await fetchJson(sourceEventUrl(id, index, sourceId), { signal: controller.signal });
    if (!rawEventRequestIsCurrent({ controller, sourceId, requestSessionKey, diagnostic })) return null;
    if (rawEventStillInDiagnosticPages(diagnostic, index)) {
      state.rawEventCache.remember(cacheKey, raw, { index, sessionKey: requestSessionKey });
    }
    return raw;
  } finally {
    if (rawEventAbortController === controller) rawEventAbortController = null;
  }
}

function rawEventRequestIsCurrent({ controller, sourceId, requestSessionKey, diagnostic }) {
  return !controller.signal.aborted && state.selectedSourceId === sourceId && state.selectedSessionKey === requestSessionKey && state.rawDiagnostic === diagnostic;
}

function rawEventCacheKey(sourceId, id, index) {
  return JSON.stringify([sourceId || "local", id, index]);
}

function rawEventStillInDiagnosticPages(diagnostic, index) {
  return diagnostic?.pages.some((page) => page.events?.some((event) => event.index === index));
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

async function handleMarkdownCodeCopy(event) {
  const button = event.target.closest("[data-markdown-code-copy]");
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  const code = button.closest(".markdown-code-frame")?.querySelector("pre code")?.textContent || "";
  if (!code) {
    showToast("没有可复制代码");
    return;
  }
  const copied = await copyWithToast(code, sensitiveCopyToast("已复制代码"));
  if (!copied) return;
  const originalText = button.textContent;
  button.textContent = "已复制";
  button.disabled = true;
  setTimeout(() => {
    button.textContent = originalText || "复制";
    button.disabled = false;
  }, 1200);
}

function selectedSource() {
  return state.sources.find((source) => source.id === state.selectedSourceId) || null;
}

function sourceLabel(source) {
  const status = source.status || {};
  const suffix = source.kind === "pi-agent" ? "Pi Agent" : "本机";
  return [source.label || source.id, suffix ? `(${suffix})` : ""].filter(Boolean).join(" ");
}

function upsertSource(source) {
  const index = state.sources.findIndex((candidate) => candidate.id === source.id);
  if (index >= 0) {
    state.sources.splice(index, 1, source);
  } else {
    state.sources.push(source);
  }
}

function sourceSessionsUrl(sourceId = state.selectedSourceId, scope = "all") {
  const params = new URLSearchParams();
  if (scope && scope !== "all") params.set("scope", scope);
  const search = els.sessionSearch?.value.trim();
  if (search) params.set("q", search);
  params.set("type", sessionListServerType());
  const query = params.toString();
  return `/api/sources/${encodeURIComponent(sourceId)}/sessions${query ? `?${query}` : ""}`;
}


function sessionListServerType() {
  const type = els.sessionTypeFilter?.value || "all";
  return type === "error" || type === "tool" ? type : "all";
}

function sourceSessionUrl(id, sourceId = state.selectedSourceId) {
  const params = new URLSearchParams();
  const query = params.toString();
  return `/api/sources/${encodeURIComponent(sourceId)}/sessions/${encodeURIComponent(id)}${query ? `?${query}` : ""}`;
}

function sourceEventUrl(id, index, sourceId = state.selectedSourceId) {
  return `/api/sources/${encodeURIComponent(sourceId)}/sessions/${encodeURIComponent(id)}/events/${index}`;
}

function sourceSessionEventsUrl(id, sourceId = state.selectedSourceId, { cursor = 0 } = {}) {
  const params = new URLSearchParams({ limit: "100", cursor: String(cursor) });
  return `/api/sources/${encodeURIComponent(sourceId)}/query/sessions/${encodeURIComponent(id)}/events?${params.toString()}`;
}


function sessionKey(session) {
  return `${session.sourceId || state.selectedSourceId || "local"}:${session.id}`;
}

async function fetchJson(url, options = {}) {
  let response;
  try {
    response = await fetch(url, { cache: "no-store", ...options });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new Error(requestFailedMessage(error));
  }
  if (!response.ok) {
    const text = await response.text();
    throw responseError(text, response.statusText, response.status);
  }
  return response.json();
}

function isAbortError(error) {
  return error?.name === "AbortError";
}

function responseError(text, fallback, status) {
  let code = "";
  try {
    const parsed = JSON.parse(text);
    code = parsed.details?.code || parsed.code || "";
  } catch {
    // The localized message remains the fallback for non-JSON errors.
  }
  const error = new Error(errorText(text, fallback, status));
  error.status = status;
  error.code = code;
  return error;
}

function errorText(text, fallback, status) {
  let message = "";
  try {
    const parsed = JSON.parse(text);
    message = parsed.message || parsed.error?.message || (typeof parsed.error === "string" ? parsed.error : "") || parsed.details?.message || "";
  } catch {
    message = text || "";
  }
  return localizeErrorText(message || fallback, status);
}

function localizeErrorText(message, status) {
  const text = typeof message === "string" ? message.trim() : String(message || "").trim();
  if (clientErrorMessages.has(text)) return clientErrorMessages.get(text);
  if (text && !/^\[object Object\]$/.test(text)) return text;
  return statusErrorMessages.get(status) || "请求失败";
}

function requestFailedMessage(error) {
  const message = errorTextFromError(error);
  if (!message || error?.name === "TypeError" || /failed to fetch|fetch failed|networkerror|load failed/i.test(message)) {
    return localServiceUnavailableMessage;
  }
  return localizeErrorText(message);
}

function healthUnavailableMessage(error) {
  const message = requestFailedMessage(error);
  if (!message || message.includes("无法连接本机服务")) return localServiceUnavailableMessage;
  const normalized = message.replace(/[。.\s]+$/, "");
  return `本机服务健康检查失败：${normalized}。请确认服务已启动后点击刷新列表重试。`;
}

async function copyWithToast(text, successMessage) {
  try {
    await copyText(String(text));
    showToast(successMessage);
    return true;
  } catch (error) {
    console.warn("复制到剪贴板失败", error);
    showToast(`复制失败：${errorTextFromError(error)}`);
    return false;
  }
}

async function copyWithToastWhileCurrent(text, successMessage, isCurrent) {
  try {
    await copyText(String(text));
    if (!isCurrent()) return false;
    showToast(successMessage);
    return true;
  } catch (error) {
    if (!isCurrent()) return false;
    console.warn("复制到剪贴板失败", error);
    showToast(`复制失败：${errorTextFromError(error)}`);
    return false;
  }
}

async function copyText(text) {
  const value = String(text);
  const errors = [];
  if (navigator.clipboard?.writeText) {
    try {
      await clipboardWriteTextWithTimeout(value);
      return;
    } catch (error) {
      errors.push({ method: "navigator.clipboard.writeText", error });
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  try {
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, value.length);
    if (typeof document.execCommand !== "function") {
      throw new Error("document.execCommand 不可用");
    }
    const copied = document.execCommand("copy");
    if (!copied) throw new Error("document.execCommand 返回 false");
  } catch (error) {
    errors.push({ method: "document.execCommand", error });
    console.warn("复制通道均失败", errors);
    throw new Error("请允许浏览器访问剪贴板，或手动选中文本复制。");
  } finally {
    textarea.remove();
  }
}

function clipboardWriteTextWithTimeout(value, timeoutMs = 800) {
  return Promise.race([
    navigator.clipboard.writeText(value),
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error("浏览器剪贴板响应超时")), timeoutMs);
    }),
  ]);
}

function errorTextFromError(error) {
  return localizeErrorText(error?.message || String(error || "未知错误"));
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove("show"), 2200);
}

function emptyState(title, subtitle, action = "") {
  return `<div class="empty-state"><div><strong>${escapeHtml(title)}</strong><br /><span>${escapeHtml(subtitle)}</span>${action}</div></div>`;
}

function renderMarkdownFence(tokens, index, options) {
  const token = tokens[index];
  const info = String(token.info || "").trim();
  const language = markdownFenceLanguage(info);
  const languageClass = language ? ` class="${escapeAttr(`${options?.langPrefix || "language-"}${language}`)}"` : "";
  const label = language || "代码";
  return `
    <div class="markdown-code-frame">
      <div class="markdown-code-head">
        <span>${escapeHtml(label)}</span>
        <button class="markdown-code-copy" type="button" data-markdown-code-copy title="复制代码">复制</button>
      </div>
      <pre><code${languageClass}>${escapeHtml(token.content || "")}</code></pre>
    </div>
  `;
}

function markdownFenceLanguage(info) {
  const firstWord = String(info || "").split(/\s+/)[0] || "";
  return firstWord.replace(/[^\w.+#-]/g, "").slice(0, 40);
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
  const text = value || "";
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
  const text = normalizeMarkdownForRendering(value);
  const key = `block:${text}`;
  const cached = markdownCache.get(key);
  if (cached != null) return cached;
  const html = markdownRenderer ? markdownRenderer.render(text) : `<p>${escapeHtml(text).replace(/\n/g, "<br />")}</p>`;
  setMarkdownCache(key, html);
  return html;
}

function markdownInlineToHtml(value) {
  const text = normalizeMarkdownForRendering(value);
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
