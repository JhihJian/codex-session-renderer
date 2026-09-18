{
  const api = window.SessionWorkbench;
  const { state, els } = api;
  const initializeOverflowTooltips = (...args) => api.initializeOverflowTooltips(...args);
  const loadHealthAndSources = (...args) => api.loadHealthAndSources(...args);
  const refreshCurrentSessionList = (...args) => api.refreshCurrentSessionList(...args);
  const handleMarkdownCodeCopy = (...args) => api.handleMarkdownCodeCopy(...args);
  const selectSource = (...args) => api.selectSource(...args);
  const openSettingsDialog = (...args) => api.openSettingsDialog(...args);
  const requestCloseSettingsDialog = (...args) => api.requestCloseSettingsDialog(...args);
  const saveSettingsFromForm = (...args) => api.saveSettingsFromForm(...args);
  const selectSettingsViewFromEvent = (...args) => api.selectSettingsViewFromEvent(...args);
  const clearSettingsValidationState = (...args) => api.clearSettingsValidationState(...args);
  const newSummaryRule = (...args) => api.newSummaryRule(...args);
  const renderSettingsDialog = (...args) => api.renderSettingsDialog(...args);
  const invalidateSessionListRequests = (...args) => api.invalidateSessionListRequests(...args);
  let sessionSearchTimer = api.sessionSearchTimer;
  const loadHistoricalSessions = (...args) => api.loadHistoricalSessions(...args);
  const loadSessions = (...args) => api.loadSessions(...args);
  const selectSessionTimeFilter = (...args) => api.selectSessionTimeFilter(...args);
  const sessionTimeBucket = (...args) => api.sessionTimeBucket(...args);
  const clearSessionFiltersForSelectedSession = (...args) => api.clearSessionFiltersForSelectedSession(...args);
  const returnToRealtimeSessions = (...args) => api.returnToRealtimeSessions(...args);
  const renderMainContent = (...args) => api.renderMainContent(...args);
  const setViewMode = (...args) => api.setViewMode(...args);
  const setDiagnosticMode = (...args) => api.setDiagnosticMode(...args);
  const selectSettingsView = (...args) => api.selectSettingsView(...args);
  const scheduleOverflowTooltipSync = (...args) => api.scheduleOverflowTooltipSync(...args);
  let rawDiagnosticAbortController = api.rawDiagnosticAbortController;
  let rawEventAbortController = api.rawEventAbortController;
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

window.SessionWorkbench.init = init;

  Object.assign(api, { init, handleDialogEscapeKey, bindEvents, bindRovingTablist, createRawDiagnosticState, cancelRawDiagnosticRequest, cancelRawEventRequest, clearRawEventCache, syncPanelToggleLabels, mobilePanelLayoutActive, mobilePanelTab, setMobilePanel, syncMobilePanelNavigation, syncPanelVisibilityState, moveFocusBeforeHidingPanel, setPanelInteractivity });
}
