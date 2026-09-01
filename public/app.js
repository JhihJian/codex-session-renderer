const rawEventCacheLimits = {
  maxEntries: 24,
  maxBytes: 8 * 1024 * 1024,
};

const { createRawEventCache } = window.RawEventCache;

const state = {
  sources: [],
  peers: [],
  selectedPeerId: null,
  selectedSourceId: "local",
  sessions: [],
  remoteIndexSessions: [],
  filteredSessions: [],
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
  remoteIndexLoading: false,
  remoteIndexError: "",
  remoteIndexRequestKey: "",
  remoteIndexRequestSeq: 0,
  remoteIndexAbortController: null,
  remoteIndexFilterKey: "",
  remoteIndexPage: null,
  remoteIndexPages: new Map(),
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
  selectedTraceNodeId: null,
  selectedAuditNodeId: null,
  selectedAuditTurnKey: null,
  selectedTerminalBlockId: null,
  expandedTraceNodeIds: new Set(),
  expandedAuditTurnKeys: new Set(),
  rawEventCache: createRawEventCache(rawEventCacheLimits),
  rawDiagnostic: null,
  viewMode: "compact",
  diagnosticMode: "stats",
  auditMinimalMode: false,
  sessionTimeFilter: "realtime",
  visibleEvents: 40,
  visibleThreadItems: 140,

  reviewTab: "summary",
  summaryRules: [],
  executionGroupRules: [],
  evidenceRiskRules: [],
  settingsView: "summary",
  settingsInitialSnapshot: "",
  settingsValidationErrors: [],
  settingsValidationMessage: "",
  settingsFeedbackMessage: "",
  settingsFeedbackStatus: "",
  settingsDialogOpener: null,
  peerFormSnapshot: null,
  peerLoading: false,
  peerLoadError: "",
  peerLoadRequestSeq: 0,
  peerLoadRequestKey: "",
  peerSaving: false,
  peerTesting: false,
  peerDeleting: false,
  expandedAuditGroupIds: new Set(),
  inspectorWidth: 360,
  resizingInspector: false,
  inspectorResizerFocusPending: false,
  desktopToggleFocusPending: false,
  narrowInspectorActive: false,
  narrowInspectorUserOpened: false,
  desktopRightState: "open",
  sidebarMode: "sessions",
  promptArchive: [],
  promptArchiveProjects: [],
  promptArchiveLoading: false,
  promptArchiveError: "",
  promptArchiveCancelled: false,
  promptArchiveRequestKey: "",
  promptArchiveRequestSeq: 0,
  promptArchiveAbortController: null,
  promptArchiveScope: "",
  promptArchiveLoaded: false,
  promptArchiveProject: "all",
  promptArchivePage: null,
  remoteRefreshLoading: false,
  remoteRefreshCancelled: false,
  remoteRefreshError: "",
  remoteRefreshRequestKey: "",
  remoteRefreshAbortController: null,
  alternateLocalSource: null,
  alternateLocalSourceLoading: false,
  alternateLocalSourceRequestKey: "",
  alternateLocalSourceScope: "",
  workbenchStatus: { key: "initial", message: "等待首次加载" },
  lastAnnouncement: "",
};

const {
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
  normalizeMarkdownForRendering,
  prettyMaybeJson,
  sanitizeFileName,
  sessionTimeBucket,
  shortPath,
} = window.AppFormat;
const { buildEvidenceId } = window.EvidenceId;

const markdownCache = new Map();
let sessionAbortController = null;
let markdownAbortController = null;
let rawDiagnosticAbortController = null;
let rawEventAbortController = null;
let reviewSourceRequestSeq = 0;
let alternateLocalSourceAbortController = null;
let sessionSearchTimer = null;
const markdownCacheLimit = 700;
const remoteIndexPageCacheLimit = 6;
const remoteIndexPageLimit = 100;
const inspectorWidthStorageKey = "codexSessionRenderer.inspectorWidth.v1";
const inspectorSideDockMedia = "(min-width: 1281px)";
const inspectorWidthDefaults = {
  min: 310,
  max: 680,
  step: 24,
  contentMin: 360,
};
const visibleViewModes = new Set(["compact", "audit", "diagnostic"]);
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
  ["Invalid evidenceRiskRules parameter", "evidenceRiskRules 参数无效"],
  ["Invalid JSON body", "请求体不是有效 JSON"],
  ["Method Not Allowed", "请求方法不允许"],
  ["Method not allowed", "请求方法不允许"],
  ["Not Found", "未找到资源"],
  ["Not found", "未找到资源"],
  ["Peer not found", "远端数据源不存在"],
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
  inspectorPanel: document.getElementById("inspectorPanel"),
  sessionCount: document.getElementById("sessionCount"),
  sessionList: document.getElementById("sessionList"),
  sessionSearch: document.getElementById("sessionSearch"),
  sessionTimeFilter: document.getElementById("sessionTimeFilter"),
  sessionTypeFilter: document.getElementById("sessionTypeFilter"),
  sessionsModeButton: document.getElementById("sessionsModeButton"),
  promptsModeButton: document.getElementById("promptsModeButton"),
  promptArchiveControls: document.getElementById("promptArchiveControls"),
  promptArchiveSearch: document.getElementById("promptArchiveSearch"),
  promptArchiveStatus: document.getElementById("promptArchiveStatus"),
  itemSearch: document.getElementById("itemSearch"),
  itemTypeFilter: document.getElementById("itemTypeFilter"),
  importantOnly: document.getElementById("importantOnly"),
  importantOnlyControl: document.getElementById("importantOnlyControl"),
  importantOnlyLabel: document.getElementById("importantOnlyLabel"),
  sessionMetaLabel: document.getElementById("sessionMetaLabel"),
  sessionTitle: document.getElementById("sessionTitle"),
  sessionHandoff: document.getElementById("sessionHandoff"),
  sessionFilterNotice: document.getElementById("sessionFilterNotice"),
  sessionFilterNoticeText: document.getElementById("sessionFilterNoticeText"),
  clearSessionFiltersButton: document.getElementById("clearSessionFiltersButton"),
  returnRealtimeButton: document.getElementById("returnRealtimeButton"),
  statsStrip: document.getElementById("statsStrip"),
  promptArchiveContent: document.getElementById("promptArchiveContent"),
  threadContent: document.getElementById("threadContent"),
  compactContent: document.getElementById("compactContent"),
  terminalContent: document.getElementById("terminalContent"),
  auditContent: document.getElementById("auditContent"),
  statsContent: document.getElementById("statsContent"),
  diagnosticContent: document.getElementById("diagnosticContent"),
  traceContent: document.getElementById("traceContent"),
  rawContent: document.getElementById("rawContent"),
  sessionDetails: document.getElementById("sessionDetails"),
  selectionDetails: document.getElementById("selectionDetails"),
  rawEventList: document.getElementById("rawEventList"),
  rawPreview: document.getElementById("rawPreview"),
  inspectorActions: document.getElementById("inspectorActions"),
  reviewTabs: document.getElementById("reviewTabs"),
  inspectorResizer: document.getElementById("inspectorResizer"),
  eventCount: document.getElementById("eventCount"),
  keyEventsTitle: document.getElementById("keyEventsTitle"),
  selectedEventLabel: document.getElementById("selectedEventLabel"),
  showMoreEventsButton: document.getElementById("showMoreEventsButton"),
  toast: document.getElementById("toast"),
  copyRawButton: document.getElementById("copyRawButton"),
  refreshButton: document.getElementById("refreshButton"),
  refreshRemoteButton: document.getElementById("refreshRemoteButton"),
  sourceSelect: document.getElementById("sourceSelect"),
  sourceStatus: document.getElementById("sourceStatus"),
  managePeersButton: document.getElementById("managePeersButton"),
  settingsButton: document.getElementById("settingsButton"),
  settingsDialog: document.getElementById("settingsDialog"),
  settingsForm: document.getElementById("settingsForm"),
  closeSettingsDialogButton: document.getElementById("closeSettingsDialogButton"),
  settingsOverview: document.getElementById("settingsOverview"),
  settingsTabs: document.getElementById("settingsTabs"),
  summaryRuleList: document.getElementById("summaryRuleList"),
  defaultSummaryRuleList: document.getElementById("defaultSummaryRuleList"),
  executionGroupRuleList: document.getElementById("executionGroupRuleList"),
  defaultExecutionGroupRuleList: document.getElementById("defaultExecutionGroupRuleList"),
  evidenceRiskRuleList: document.getElementById("evidenceRiskRuleList"),
  defaultEvidenceRiskRuleList: document.getElementById("defaultEvidenceRiskRuleList"),
  addSummaryRuleButton: document.getElementById("addSummaryRuleButton"),
  resetSummaryRulesButton: document.getElementById("resetSummaryRulesButton"),
  addExecutionGroupRuleButton: document.getElementById("addExecutionGroupRuleButton"),
  resetExecutionGroupRulesButton: document.getElementById("resetExecutionGroupRulesButton"),
  addEvidenceRiskRuleButton: document.getElementById("addEvidenceRiskRuleButton"),
  resetEvidenceRiskRulesButton: document.getElementById("resetEvidenceRiskRulesButton"),
  saveSettingsButton: document.getElementById("saveSettingsButton"),
  cancelSettingsButton: document.getElementById("cancelSettingsButton"),
  settingsStatus: document.getElementById("settingsStatus"),
  peerDialog: document.getElementById("peerDialog"),
  peerForm: document.getElementById("peerForm"),
  peerList: document.getElementById("peerList"),
  peerId: document.getElementById("peerId"),
  peerLabel: document.getElementById("peerLabel"),
  peerUrl: document.getElementById("peerUrl"),
  peerToken: document.getElementById("peerToken"),
  peerEnabled: document.getElementById("peerEnabled"),
  peerEditorStatus: document.getElementById("peerEditorStatus"),
  savePeerButton: document.getElementById("savePeerButton"),
  newPeerButton: document.getElementById("newPeerButton"),
  testPeerButton: document.getElementById("testPeerButton"),
  deletePeerButton: document.getElementById("deletePeerButton"),
  closePeerDialogButton: document.getElementById("closePeerDialogButton"),
  statusSource: document.getElementById("statusSource"),
  statusSession: document.getElementById("statusSession"),
  statusEvents: document.getElementById("statusEvents"),
  statusUpdated: document.getElementById("statusUpdated"),
  statusbar: document.getElementById("statusbar"),
  workbenchOperationStatus: document.getElementById("workbenchOperationStatus"),
  workbenchAnnouncements: document.getElementById("workbenchAnnouncements"),
  copyMarkdownButton: document.getElementById("copyMarkdownButton"),
  downloadMarkdownButton: document.getElementById("downloadMarkdownButton"),
  compactViewButton: document.getElementById("compactViewButton"),
  auditViewButton: document.getElementById("auditViewButton"),
  statsViewButton: document.getElementById("statsViewButton"),
  rawViewButton: document.getElementById("rawViewButton"),
  diagnosticViewButton: document.getElementById("diagnosticViewButton"),
  diagnosticSwitch: document.getElementById("diagnosticSwitch"),
  viewSwitch: document.querySelector(".view-switch"),
  toggleLeft: document.getElementById("toggleLeft"),
  toggleRight: document.getElementById("toggleRight"),
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

const auditItemTypeOptions = [
  ["all", "全部节点"],
  ["intent", "意图"],
  ["reasoning", "推理"],
  ["action", "行动"],
  ["evidence", "证据"],
  ["verification", "验证"],
  ["risk", "风险"],
  ["final", "最终回复"],
];

const standardToAuditType = {
  all: "all",
  message: "intent",
  tool: "action",
  output: "evidence",
  reasoning: "reasoning",
  compact: "evidence",
  system: "verification",
  error: "risk",
};

const auditToStandardType = {
  all: "all",
  intent: "message",
  reasoning: "reasoning",
  action: "tool",
  evidence: "output",
  verification: "system",
  risk: "error",
  final: "message",
};

const settingsViewOptions = [
  { id: "summary", label: "摘要规则" },
  { id: "execution", label: "执行聚合" },
  { id: "evidence", label: "证据风险" },
  { id: "structured", label: "结构化展示" },
];
const settingsViewIds = new Set(settingsViewOptions.map((view) => view.id));

init();

function init() {
  state.summaryRules = window.ToolSummary?.loadCustomRules?.() || [];
  state.executionGroupRules = window.ExecutionGrouping?.loadCustomRules?.() || [];
  state.evidenceRiskRules = window.EvidenceRiskRules?.loadCustomRules?.() || [];
  loadInspectorWidth();
  bindEvents();
  syncResponsiveInspectorLayout();
  syncPanelToggleLabels();
  syncMobilePanelNavigation();
  applyInspectorWidth(state.inspectorWidth);
  loadHealthAndSources();
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
    void handleMarkdownCodeCopy(event).catch(reportReviewActionFailure);
  });
  document.addEventListener("keydown", handleDialogEscapeKey);
  els.refreshRemoteButton.addEventListener("click", refreshSelectedSource);
  els.sourceSelect.addEventListener("change", () => selectSource(els.sourceSelect.value));
  els.managePeersButton.addEventListener("click", openPeerDialog);
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
  els.addExecutionGroupRuleButton?.addEventListener("click", () => {
    clearSettingsValidationState();
    state.executionGroupRules.push(newExecutionGroupRule());
    state.settingsView = "execution";
    renderSettingsDialog();
  });
  els.resetExecutionGroupRulesButton?.addEventListener("click", () => {
    clearSettingsValidationState();
    state.executionGroupRules = [];
    state.settingsView = "execution";
    renderSettingsDialog();
  });
  els.addEvidenceRiskRuleButton?.addEventListener("click", () => {
    clearSettingsValidationState();
    ensureEvidenceRiskEditorRules();
    state.evidenceRiskRules.unshift(newEvidenceRiskRule());
    state.settingsView = "evidence";
    renderSettingsDialog();
  });
  els.resetEvidenceRiskRulesButton?.addEventListener("click", () => {
    clearSettingsValidationState();
    state.evidenceRiskRules = [];
    state.settingsView = "evidence";
    renderSettingsDialog();
  });
  els.closePeerDialogButton.addEventListener("click", requestClosePeerDialog);
  els.peerDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    requestClosePeerDialog();
  });
  els.newPeerButton.addEventListener("click", () => requestSelectPeerForEdit(null, { force: true }));
  els.peerForm.addEventListener("submit", savePeerFromForm);
  els.testPeerButton.addEventListener("click", testSelectedPeer);
  els.deletePeerButton.addEventListener("click", deleteSelectedPeer);
  [els.peerLabel, els.peerUrl, els.peerToken, els.peerEnabled].forEach((input) => {
    input?.addEventListener("input", handlePeerFormInput);
    input?.addEventListener("change", handlePeerFormInput);
  });
  els.sessionSearch.addEventListener("input", () => {
    invalidateSessionListRequests();
    cancelRemoteRefreshForNavigation();
    void loadRemoteIndexForCurrentFilter();
    if (isRemoteHistoryIndexMode()) return;
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
    cancelRemoteRefreshForNavigation();
    if (isRemoteHistoryIndexMode()) {
      void loadRemoteIndexForCurrentFilter({ reset: true, announce: true });
      return;
    }
    if (state.sessionTimeFilter === "earlier") {
      state.sessions = state.sessions.filter((session) => sessionTimeBucket(session) !== "earlier");
      state.historyLoaded = false;
      void loadHistoricalSessions({ announce: true });
    }
    else void loadSessions({ announce: true });
  });
  [els.sessionsModeButton, els.promptsModeButton].forEach((button) => {
    button?.addEventListener("click", () => selectSidebarMode(button.dataset.sidebarMode || "sessions"));
  });
  els.promptArchiveSearch?.addEventListener("input", renderPromptArchive);
  els.promptArchiveStatus?.addEventListener("change", renderPromptArchive);
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
  els.importantOnly.addEventListener("change", renderMainContent);
  els.compactViewButton.addEventListener("click", () => setViewMode("compact"));
  els.auditViewButton.addEventListener("click", () => setViewMode("audit"));
  els.diagnosticViewButton.addEventListener("click", () => setViewMode("diagnostic"));
  els.statsViewButton.addEventListener("click", () => setDiagnosticMode("stats"));
  els.rawViewButton.addEventListener("click", () => setDiagnosticMode("raw"));
  els.reviewTabs?.querySelectorAll("[data-review-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      setReviewTab(button.dataset.reviewTab || "summary");
    });
  });
  bindRovingTablist(els.sessionTimeFilter, "[data-session-time]", (button) => selectSessionTimeFilter(button.dataset.sessionTime || "realtime"));
  bindRovingTablist(document.querySelector(".sidebar-mode-switch"), "[data-sidebar-mode]", (button) => selectSidebarMode(button.dataset.sidebarMode || "sessions"));
  bindRovingTablist(els.viewSwitch, "[data-view-mode]", (button) => setViewMode(button.dataset.viewMode || "compact"));
  bindRovingTablist(els.diagnosticSwitch, "[data-diagnostic-mode]", (button) => setDiagnosticMode(button.dataset.diagnosticMode || "stats"));
  bindRovingTablist(els.reviewTabs, "[data-review-tab]", (button) => setReviewTab(button.dataset.reviewTab || "summary"));
  bindRovingTablist(els.settingsTabs, "[data-settings-view]", (button) => selectSettingsView(button.dataset.settingsView || "summary"));
  els.showMoreEventsButton.addEventListener("click", renderInspector);
  els.copyRawButton.addEventListener("click", () => {
    void copyReviewReference().catch(reportReviewActionFailure);
  });
  els.copyMarkdownButton.addEventListener("click", copyMarkdown);
  els.downloadMarkdownButton.addEventListener("click", downloadMarkdown);
  els.toggleLeft.addEventListener("click", () => {
    const next = els.appShell.dataset.left === "open" ? "closed" : "open";
    els.appShell.dataset.left = next;
    syncPanelToggleLabels();
  });
  els.toggleRight.addEventListener("click", (event) => {
    if (desktopPromptArchiveInspectorHidden()) return;
    const next = els.appShell.dataset.right === "open" ? "closed" : "open";
    els.appShell.dataset.right = next;
    if (narrowDesktopInspectorLayoutActive()) state.narrowInspectorUserOpened = next === "open";
    else state.desktopRightState = next;
    syncPanelToggleLabels();
    if (event.detail === 0 && narrowDesktopInspectorLayoutActive() && next === "open") {
      queueMicrotask(() => els.selectionDetails?.focus({ preventScroll: true }));
    }
  });
  bindInspectorResize();
  bindDesktopToggleFocusTracking();
  window.addEventListener("resize", () => {
    syncResponsiveInspectorLayout();
    applyInspectorWidth(state.inspectorWidth);
    syncMobilePanelNavigation();
    syncPanelToggleLabels();
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
    snapshot: "",
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

function cancelRawEventRequest({ invalidateReviewSource = true } = {}) {
  if (invalidateReviewSource) reviewSourceRequestSeq += 1;
  rawEventAbortController?.abort();
  rawEventAbortController = null;
}

function clearRawEventCache() {
  state.rawEventCache.clear();
}

function syncPanelToggleLabels() {
  const mobile = mobilePanelLayoutActive();
  moveFocusFromHiddenDesktopToggles();
  const leftOpen = els.appShell.dataset.left !== "closed";
  const rightOpen = els.appShell.dataset.right !== "closed";
  const archiveHidesInspector = desktopPromptArchiveInspectorHidden();
  const leftLabel = leftOpen ? "隐藏会话列表" : "显示会话列表";
  const rightLabel = archiveHidesInspector ? "任务归档中复核台不可用" : rightOpen ? "隐藏复核台" : "显示复核台";
  [els.toggleLeft, els.toggleRight].forEach((button) => {
    button.hidden = mobile;
    button.tabIndex = mobile ? -1 : 0;
  });
  els.toggleLeft.title = leftLabel;
  els.toggleLeft.setAttribute("aria-label", leftLabel);
  els.toggleLeft.setAttribute("aria-expanded", !mobile && leftOpen ? "true" : "false");
  els.toggleRight.title = rightLabel;
  els.toggleRight.setAttribute("aria-label", rightLabel);
  els.toggleRight.setAttribute("aria-expanded", !mobile && !archiveHidesInspector && rightOpen ? "true" : "false");
  els.toggleRight.disabled = mobile || archiveHidesInspector;
  els.toggleRight.setAttribute("aria-disabled", mobile || archiveHidesInspector ? "true" : "false");
  syncPanelVisibilityState();
  syncInspectorResizerState();
}

function moveFocusFromHiddenDesktopToggles() {
  if (!mobilePanelLayoutActive()) return;
  if (![els.toggleLeft, els.toggleRight].includes(document.activeElement) && !state.desktopToggleFocusPending) return;
  state.desktopToggleFocusPending = false;
  mobilePanelTab(els.appShell.dataset.panel || "thread")?.focus({ preventScroll: true });
}

function bindDesktopToggleFocusTracking() {
  [els.toggleLeft, els.toggleRight].forEach((button) => {
    button.addEventListener("focus", () => { state.desktopToggleFocusPending = true; });
    button.addEventListener("blur", () => {
      queueMicrotask(() => {
        if (document.activeElement !== document.body) state.desktopToggleFocusPending = false;
      });
    });
  });
}

function syncPanelVisibilityState() {
  const mobile = mobilePanelLayoutActive();
  const activePanel = els.appShell.dataset.panel || "thread";
  const inspectorOpen = mobile ? activePanel === "inspector" : !desktopPromptArchiveInspectorHidden() && els.appShell.dataset.right !== "closed";
  const panels = [
    [els.sessionsPanel, mobile ? activePanel === "sessions" : els.appShell.dataset.left !== "closed", mobile ? mobilePanelTab("sessions") : els.toggleLeft],
    [els.threadPanel, mobile ? activePanel === "thread" : true, mobile ? mobilePanelTab("thread") : null],
    [els.inspectorPanel, inspectorOpen, mobile ? mobilePanelTab("inspector") : els.toggleRight],
  ];
  panels.forEach(([panel, open, fallback]) => {
    moveFocusBeforeHidingPanel(panel, fallback, open);
    setPanelInteractivity(panel, open);
  });
  const rightOpen = panels[2][1];
  if (!rightOpen && document.activeElement === els.inspectorResizer) {
    els.toggleRight.focus({ preventScroll: true });
  }
}

function mobilePanelLayoutActive() {
  return window.matchMedia("(width <= 820px)").matches;
}

function narrowDesktopInspectorLayoutActive() {
  return window.matchMedia("(width > 820px) and (max-width: 1280px)").matches;
}

function syncResponsiveInspectorLayout() {
  if (mobilePanelLayoutActive()) return;
  if (narrowDesktopInspectorLayoutActive()) {
    if (!state.narrowInspectorActive) {
      state.desktopRightState = els.appShell.dataset.right || "open";
      state.narrowInspectorActive = true;
      if (!state.narrowInspectorUserOpened) els.appShell.dataset.right = "closed";
    }
    return;
  }
  if (state.narrowInspectorActive) {
    els.appShell.dataset.right = state.desktopRightState;
    state.narrowInspectorActive = false;
    state.narrowInspectorUserOpened = false;
  }
}

function desktopPromptArchiveInspectorHidden() {
  return !mobilePanelLayoutActive() && state.sidebarMode === "prompts";
}

function mobilePanelTab(panel) {
  return document.querySelector(`[data-panel-target="${cssEscape(panel)}"]`);
}

function setMobilePanel(panel, { userInitiated = false } = {}) {
  const next = ["sessions", "thread", "inspector"].includes(panel) ? panel : "thread";
  const changed = els.appShell.dataset.panel !== next;
  if (userInitiated && changed) state.mobilePanelNavigationVersion += 1;
  if (mobilePanelLayoutActive() && changed && next !== "inspector") cancelRawEventRequest();
  els.appShell.dataset.panel = next;
  if (changed) cancelRemoteRefreshForNavigation();
  syncMobilePanelNavigation();
}

function syncMobilePanelNavigation() {
  const activePanel = els.appShell?.dataset.panel || "thread";
  const mobile = mobilePanelLayoutActive();
  document.querySelectorAll("[data-panel-target]").forEach((button) => {
    const active = button.dataset.panelTarget === activePanel;
    button.setAttribute("aria-selected", active ? "true" : "false");
    button.tabIndex = active ? 0 : -1;
  });
  [
    [els.sessionsPanel, "mobileSessionsTab"],
    [els.threadPanel, "mobileThreadTab"],
    [els.inspectorPanel, "mobileInspectorTab"],
  ].forEach(([panel, tabId]) => {
    if (mobile) {
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", tabId);
    } else {
      panel.removeAttribute("role");
      panel.removeAttribute("aria-labelledby");
    }
  });
  syncPanelVisibilityState();
}

function moveFocusBeforeHidingPanel(panel, fallback, open) {
  if (open || !panel?.contains(document.activeElement)) return;
  fallback?.focus({ preventScroll: true });
}

function setPanelInteractivity(panel, open) {
  if (!panel) return;
  panel.inert = !open;
  if (open) {
    panel.removeAttribute("aria-hidden");
  } else {
    panel.setAttribute("aria-hidden", "true");
  }
}

function handleDialogEscapeKey(event) {
  if (event.key !== "Escape") return;
  if (els.settingsDialog?.open) {
    event.preventDefault();
    requestCloseSettingsDialog();
    return;
  }
  if (els.peerDialog?.open) {
    event.preventDefault();
    requestClosePeerDialog();
  }
}

function bindInspectorResize() {
  if (!els.inspectorResizer) return;
  els.inspectorResizer.addEventListener("focus", () => { state.inspectorResizerFocusPending = true; });
  els.inspectorResizer.addEventListener("blur", () => {
    queueMicrotask(() => {
      if (document.activeElement !== document.body) state.inspectorResizerFocusPending = false;
    });
  });
  els.inspectorResizer.addEventListener("pointerdown", (event) => {
    if (!inspectorResizeEnabled()) return;
    event.preventDefault();
    state.resizingInspector = true;
    els.appShell.classList.add("resizing-inspector");
    els.inspectorResizer.setPointerCapture?.(event.pointerId);
    applyInspectorWidth(widthFromPointer(event.clientX));
  });
  els.inspectorResizer.addEventListener("pointermove", (event) => {
    if (!state.resizingInspector) return;
    event.preventDefault();
    applyInspectorWidth(widthFromPointer(event.clientX));
  });
  els.inspectorResizer.addEventListener("pointerup", (event) => finishInspectorResize(event));
  els.inspectorResizer.addEventListener("pointercancel", (event) => finishInspectorResize(event));
  window.addEventListener("pointermove", (event) => {
    if (!state.resizingInspector) return;
    event.preventDefault();
    applyInspectorWidth(widthFromPointer(event.clientX));
  });
  window.addEventListener("pointerup", (event) => finishInspectorResize(event));
  window.addEventListener("pointercancel", (event) => finishInspectorResize(event));
  els.inspectorResizer.addEventListener("keydown", (event) => {
    if (!inspectorResizeEnabled()) return;
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const bounds = inspectorWidthBounds();
    if (!bounds) return;
    let next = state.inspectorWidth;
    if (event.key === "ArrowLeft") next += inspectorWidthDefaults.step;
    if (event.key === "ArrowRight") next -= inspectorWidthDefaults.step;
    if (event.key === "Home") next = bounds.min;
    if (event.key === "End") next = bounds.max;
    applyInspectorWidth(next, { persist: true });
  });
}

function finishInspectorResize(event) {
  if (!state.resizingInspector) return;
  state.resizingInspector = false;
  els.appShell.classList.remove("resizing-inspector");
  try {
    if (els.inspectorResizer?.hasPointerCapture?.(event.pointerId)) els.inspectorResizer.releasePointerCapture(event.pointerId);
  } catch {
    // Pointer capture can already be released by the browser.
  }
  saveInspectorWidth(state.inspectorWidth);
}

function loadInspectorWidth(storage = globalThis.localStorage) {
  const saved = Number(storage?.getItem(inspectorWidthStorageKey));
  state.inspectorWidth = Number.isFinite(saved) && saved > 0 ? saved : state.inspectorWidth;
}

function saveInspectorWidth(width, storage = globalThis.localStorage) {
  if (!storage) return;
  try {
    storage.setItem(inspectorWidthStorageKey, String(Math.round(width)));
  } catch {
    // Ignore private-mode or quota failures; resizing still works for this page session.
  }
}

function applyInspectorWidth(width, options = {}) {
  const bounds = inspectorWidthBounds();
  const fallback = Number.isFinite(Number(width)) ? Number(width) : state.inspectorWidth;
  const next = bounds ? clamp(fallback, bounds.min, bounds.max) : Math.max(inspectorWidthDefaults.min, fallback);
  state.inspectorWidth = Math.round(next);
  els.appShell.style.setProperty("--inspector-width", `${state.inspectorWidth}px`);
  if (els.inspectorResizer) {
    const resizeEnabled = inspectorResizeEnabled();
    const moveFocusedResizer = resizerNeedsFocusMigration(resizeEnabled);
    const min = bounds?.min ?? inspectorWidthDefaults.min;
    const max = bounds?.max ?? inspectorWidthDefaults.max;
    els.inspectorResizer.setAttribute("aria-valuemin", String(min));
    els.inspectorResizer.setAttribute("aria-valuemax", String(max));
    els.inspectorResizer.setAttribute("aria-valuenow", String(state.inspectorWidth));
    els.inspectorResizer.setAttribute("aria-disabled", resizeEnabled ? "false" : "true");
    els.inspectorResizer.tabIndex = resizeEnabled ? 0 : -1;
    if (resizeEnabled) {
      els.inspectorResizer.removeAttribute("aria-hidden");
    } else {
      els.inspectorResizer.setAttribute("aria-hidden", "true");
    }
    if (moveFocusedResizer) {
      state.inspectorResizerFocusPending = false;
      focusResizerFallback();
    }
  }
  if (options.persist) saveInspectorWidth(state.inspectorWidth);
}

function resizerNeedsFocusMigration(resizeEnabled) {
  return !resizeEnabled && (document.activeElement === els.inspectorResizer || state.inspectorResizerFocusPending);
}

function focusResizerFallback() {
  const fallback = mobilePanelLayoutActive()
    ? mobilePanelTab(els.appShell?.dataset.panel || "thread") || mobilePanelTab("inspector")
    : els.toggleRight;
  if (!fallback || fallback.hidden || fallback.disabled || fallback.inert || fallback.getAttribute("aria-hidden") === "true") return;
  fallback.focus({ preventScroll: true });
}

function widthFromPointer(clientX) {
  const rect = els.appShell.getBoundingClientRect();
  return rect.right - Number(clientX || 0);
}

function inspectorWidthBounds() {
  if (!els.appShell || !inspectorResizeEnabled()) return null;
  const shellWidth = els.appShell.getBoundingClientRect().width || window.innerWidth || 0;
  const leftMin = els.appShell.dataset.left === "closed" ? 0 : 286;
  const max = Math.min(inspectorWidthDefaults.max, Math.max(inspectorWidthDefaults.min, shellWidth - leftMin - inspectorWidthDefaults.contentMin));
  return {
    min: inspectorWidthDefaults.min,
    max,
  };
}

function inspectorResizeEnabled() {
  return Boolean(!desktopPromptArchiveInspectorHidden() && els.appShell?.dataset.right !== "closed" && window.matchMedia(inspectorSideDockMedia).matches);
}

function syncInspectorResizerState() {
  applyInspectorWidth(state.inspectorWidth);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || min));
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
    await reloadPeers();
    await loadSessions({ announce });
  } catch (error) {
    const message = healthUnavailableMessage(error);
    state.healthLoadError = message;
    state.sources = [{ id: "local", label: "本机 Codex Home", kind: "local", status: { refreshable: false, error: { message } } }];
    state.selectedSourceId = "local";
    state.sessions = [];
    state.filteredSessions = [];
    resetRemoteIndexState();
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
  if (state.healthLoadError) {
    els.sourceStatus.textContent = `接口不可用：${state.healthLoadError}`;
    els.refreshRemoteButton.hidden = true;
    renderStatusbar();
    return;
  }
  const source = selectedSource();
  if (!source) {
    els.sourceStatus.textContent = "数据源不存在";
    els.refreshRemoteButton.hidden = true;
    renderStatusbar();
    return;
  }
  const status = source.status || {};
  els.refreshRemoteButton.hidden = !status.refreshable;
  els.refreshRemoteButton.disabled = Boolean(status.refreshing);
  const refreshLabel = status.refreshing ? "正在拉取快照" : "拉取远端快照";
  els.refreshRemoteButton.textContent = refreshLabel;
  els.refreshRemoteButton.title = "拉取远端实时快照到本机缓存；默认只补最近 3 小时，不修改远端";
  els.refreshRemoteButton.setAttribute("aria-label", `${refreshLabel}（默认只补最近 3 小时，写入本机缓存，不修改远端）`);
  const parts = [source.kind === "remote" ? "远端快照（本机缓存）" : "本机"];
  if (source.kind === "remote") parts.push("实时快照默认只补最近 3 小时，拉取会写入本机缓存");
  if (status.refreshing) parts.push("正在拉取远端快照");
  if (status.lastSuccessfulRefreshAt) parts.push(`最近成功 ${formatDate(status.lastSuccessfulRefreshAt)}`);
  if (source.kind === "remote" && status.needsRefresh) parts.push("需要拉取新快照；旧快照不会用于当前来源");
  if (status.stale) parts.push("正在浏览旧快照");
  if (status.error?.message) parts.push(status.error.message);
  if (state.remoteRefreshCancelled && source.kind === "remote") parts.push("拉取已取消，可再次拉取");
  if (state.remoteRefreshError && source.kind === "remote") parts.push(`拉取失败：${state.remoteRefreshError.replace(/[。.]$/, "")}。可再次拉取`);
  if (source.kind === "remote" && !status.snapshotAvailable) parts.push("尚无可用快照");
  if (source.kind === "remote" && state.sessionTimeFilter !== "realtime") {
    const bucket = state.sessionTimeFilter === "day" ? "近一天" : "更早";
    parts.push(state.remoteIndexLoading ? `${bucket}历史索引检索中` : `${bucket}为历史索引，不含正文；历史正文需扩大共享窗口或额外同步`);
    if (state.remoteIndexError) parts.push(`历史索引失败：${state.remoteIndexError}`);
  }
  if (source.kind !== "remote" && state.sessionTimeFilter === "earlier") {
    if (state.historyLoading) parts.push("历史会话读取中");
    else if (state.historyLoadError) parts.push(`历史会话失败：${state.historyLoadError}`);
  }
  els.sourceStatus.textContent = parts.join(" · ");
  renderStatusbar();
}

function selectSessionTimeFilter(bucket) {
  const next = bucket || "realtime";
  const changed = next !== state.sessionTimeFilter;
  if (changed) invalidateSessionListRequests();
  state.sessionTimeFilter = next;
  if (changed) cancelRemoteRefreshForNavigation();
  if (state.sidebarMode === "prompts") {
    void loadPromptArchive({ announce: true });
    return;
  }
  if (selectedSource()?.kind === "remote") {
    if (state.sessionTimeFilter === "realtime") void loadSessions({ announce: true });
    else void loadRemoteIndexForCurrentFilter({ announce: true });
  } else if (state.sessionTimeFilter === "earlier" && !state.historyLoaded) {
    renderSessionList();
    void loadHistoricalSessions({ announce: true });
  } else {
    renderSessionList();
    selectFirstVisibleSession();
  }
}

function selectSidebarMode(mode) {
  const next = mode === "prompts" ? "prompts" : "sessions";
  if (next === state.sidebarMode) {
    renderAll();
    return;
  }
  if (next !== "prompts") cancelPromptArchiveRequest();
  state.sidebarMode = next;
  cancelRemoteRefreshForNavigation();
  els.appShell.dataset.mode = next;
  setMobilePanel(next === "prompts" ? "thread" : "sessions");
  if (els.promptArchiveControls) els.promptArchiveControls.hidden = next !== "prompts";
  [els.sessionsModeButton, els.promptsModeButton].forEach((button) => {
    if (!button) return;
    const active = button.dataset.sidebarMode === next;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
  if (next === "prompts") void loadPromptArchive({ announce: true });
  syncPanelToggleLabels();
  renderAll();
  if (next === "prompts") els.promptArchiveContent?.focus({ preventScroll: true });
}

async function loadPromptArchive({ force = false, pageToken = "", restarted = false, announce = false } = {}) {
  const sourceId = state.selectedSourceId;
  const scope = promptArchiveScope();
  const archiveContext = sourceNavigationContext();
  const archiveCacheKey = promptArchiveCacheKey(sourceId, scope);
  if (!force && !pageToken && state.promptArchiveScope === archiveCacheKey && state.promptArchiveLoaded && !state.promptArchiveError && !state.promptArchiveCancelled) {
    renderAll();
    return;
  }
  cancelPromptArchiveRequest();
  const controller = new AbortController();
  state.promptArchiveAbortController = controller;
  const request = promptArchiveRequestDetails(sourceId, scope, pageToken);
  const requestKey = request.key;
  state.promptArchiveRequestKey = requestKey;
  state.promptArchiveLoading = true;
  state.promptArchiveLoaded = false;
  state.promptArchiveError = "";
  state.promptArchiveCancelled = false;
  state.promptArchiveScope = archiveCacheKey;
  if (!pageToken) resetPromptArchivePage();
  const operationKey = `${requestKey}:status`;
  let requestState = "current";
  setWorkbenchStatus(operationKey, request.loadingMessage, { announce });
  renderAll();
  try {
    const response = await requestPromptArchive({ sourceId, scope, pageToken, controller, requestKey, archiveContext });
    requestState = response.requestState;
    if (requestState !== "current") return;
    applyPromptArchiveResponse(response.data);
    setWorkbenchStatus(operationKey, `任务归档已更新：本批 ${state.promptArchive.length} 条`, { announce });
  } catch (error) {
    requestState = await handlePromptArchiveFailure({ error, sourceId, requestKey, archiveContext, pageToken, restarted, operationKey, announce });
  } finally {
    finishPromptArchiveRequest({ controller, sourceId, requestKey, operationKey, requestState });
  }
}

function promptArchiveRequestDetails(sourceId, scope, pageToken) {
  return {
    key: `prompts:${++state.promptArchiveRequestSeq}:${sourceId}:${scope}:${pageToken || "first"}`,
    loadingMessage: pageToken ? "正在定位更早任务" : "正在整理当前批任务归档",
  };
}

function resetPromptArchivePage() {
  state.promptArchive = [];
  state.promptArchiveProjects = [];
  state.promptArchivePage = null;
  state.promptArchiveProject = "all";
}

async function requestPromptArchive({ sourceId, scope, pageToken, controller, requestKey, archiveContext }) {
  const data = await fetchJson(promptArchiveUrl(sourceId, scope, pageToken), { signal: controller.signal });
  const requestState = sourceRequestState({ requestKey, expectedRequestKey: state.promptArchiveRequestKey, sourceId, context: archiveContext });
  if (requestState === "current") requireSourceResponse(data, sourceId, "prompts", scope);
  return { data, requestState };
}

function applyPromptArchiveResponse(data) {
  state.promptArchive = data.entries || [];
  state.promptArchiveProjects = data.projects || [];
  state.promptArchivePage = data.page || null;
  state.promptArchiveProject = "all";
  state.promptArchiveLoaded = true;
  state.promptArchiveError = "";
}

async function handlePromptArchiveFailure({ error, sourceId, requestKey, archiveContext, pageToken, restarted, operationKey, announce }) {
  if (isAbortError(error)) return "stale";
  const requestState = sourceRequestState({ requestKey, expectedRequestKey: state.promptArchiveRequestKey, sourceId, context: archiveContext });
  if (requestState !== "current") return requestState;
  if (error.code === "prompt_archive_snapshot_changed" && pageToken && !restarted) {
    resetPromptArchivePage();
    showToast("任务范围已变化，已从最近任务重新开始定位");
    state.promptArchiveLoading = false;
    setWorkbenchStatus(operationKey, "任务归档范围已变化，正在从最近任务重新开始定位", { announce });
    await loadPromptArchive({ force: true, restarted: true, announce });
    return "restarted";
  }
  resetPromptArchivePage();
  state.promptArchiveError = error.message;
  setWorkbenchStatus(operationKey, `任务归档读取失败：${error.message}。可重试。`, { announce: true });
  return "current";
}

function finishPromptArchiveRequest({ controller, sourceId, requestKey, operationKey, requestState }) {
  if (state.promptArchiveAbortController === controller) state.promptArchiveAbortController = null;
  if (!sourceRequestOwnsState({ requestKey, expectedRequestKey: state.promptArchiveRequestKey, sourceId })) return;
  state.promptArchiveLoading = false;
  if (requestState === "navigation-changed") {
    state.promptArchiveCancelled = true;
    if (state.workbenchStatus.key === operationKey) setWorkbenchStatus(operationKey, "任务归档读取已取消，可重新整理");
  }
  renderAll();
}

function cancelPromptArchiveRequest() {
  const wasLoading = Boolean(state.promptArchiveAbortController && state.promptArchiveLoading);
  state.promptArchiveAbortController?.abort();
  state.promptArchiveAbortController = null;
  if (wasLoading) {
    state.promptArchiveLoading = false;
    state.promptArchiveCancelled = true;
    state.promptArchiveRequestKey = `inactive:${++state.promptArchiveRequestSeq}`;
    setWorkbenchStatus("prompts:cancelled", "已取消任务归档读取");
  }
}

function promptArchiveScope() {
  return state.sessionTimeFilter === "earlier" ? "history" : "recent24h";
}

function promptArchiveCacheKey(sourceId, scope) {
  return `${sourceId}:${scope}`;
}

function invalidatePromptArchiveCache(sourceId, scope) {
  if (state.promptArchiveScope !== promptArchiveCacheKey(sourceId, scope)) return false;
  state.promptArchiveAbortController?.abort();
  state.promptArchiveAbortController = null;
  state.promptArchiveRequestKey = `invalidated:${++state.promptArchiveRequestSeq}`;
  state.promptArchiveLoading = false;
  state.promptArchiveError = "";
  state.promptArchiveCancelled = false;
  state.promptArchiveLoaded = false;
  state.promptArchiveScope = "";
  resetPromptArchivePage();
  return true;
}

function reloadInvalidatedPromptArchive(invalidated, sourceId) {
  if (!invalidated || state.sidebarMode !== "prompts" || state.selectedSourceId !== sourceId) return;
  void loadPromptArchive({ force: true, announce: true });
}

async function loadSessions({ announce = false } = {}) {
  cancelAlternateLocalSourceDiscovery();
  const sourceId = state.selectedSourceId;
  const scopeVersion = state.sessionListScopeVersion;
  const controller = new AbortController();
  state.sessionsAbortController?.abort();
  state.sessionsAbortController = controller;
  resetRemoteIndexState();
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
    const promptArchiveInvalidated = invalidatePromptArchiveCache(sourceId, "recent24h");
    state.healthLoadError = "";
    if (data.source) upsertSource(data.source);
    state.sessions = data.sessions || [];
    state.historyLoaded = false;
    state.remoteIndexSessions = [];
    state.remoteIndexError = "";
    state.remoteIndexLoading = false;
    state.sessionsLoading = false;
    state.sessionsLoadError = "";
    setWorkbenchStatus(operationKey, `会话列表已加载：${state.sessions.length} 个会话`, { announce });
    setBusy(false);
    renderSourceStatus();
    renderSessionList();
    void discoverAlternateLocalSource();
    const nextSession = state.selectedSessionKey ? null : state.filteredSessions[0];
    if (!sessionListRequestIsCurrent({ requestKey, sourceId, scopeVersion, kind: "sessions" })) return;
    if (nextSession && !nextSession.remoteIndexOnly) {
      await selectSession(nextSession.id, { announce: false });
    } else if (!state.selectedSessionKey) {
      clearSelectedSession();
      renderAll();
    }
    if (!sessionListRequestIsCurrent({ requestKey, sourceId, scopeVersion, kind: "sessions" })) return;
    await loadRemoteIndexForCurrentFilter();
    reloadInvalidatedPromptArchive(promptArchiveInvalidated, sourceId);
  } catch (error) {
    if (isAbortError(error) || !sessionListRequestIsCurrent({ requestKey, sourceId, scopeVersion, kind: "sessions" })) return;
    showToast(`加载会话失败：${error.message}`);
    if (error.message?.includes("无法连接本机服务")) {
      state.healthLoadError = localServiceUnavailableMessage;
      els.healthStatus.textContent = `接口不可用：${state.healthLoadError}`;
    }
    state.sessions = [];
    state.filteredSessions = [];
    state.remoteIndexSessions = [];
    state.remoteIndexLoading = false;
    state.remoteIndexError = "";
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
  if (state.selectedSessionKey || !nextSession || nextSession.remoteIndexOnly) return;
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
  return state.sources.find((source) => source.id !== state.selectedSourceId && source.kind === "pi-agent" && source.status?.snapshotAvailable !== false) || null;
}

function canDiscoverAlternateLocalSource() {
  return Boolean(
    state.sidebarMode === "sessions" &&
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
    const promptArchiveInvalidated = invalidatePromptArchiveCache(sourceId, "history");
    if (data.source) upsertSource(data.source);
    const priorSessions = state.sessions.filter((session) => sessionTimeBucket(session) !== "earlier");
    const byKey = new Map(priorSessions.map((session) => [sessionKey(session), session]));
    for (const session of data.sessions || []) byKey.set(sessionKey(session), session);
    state.sessions = [...byKey.values()];
    state.historyLoaded = true;
    state.historyLoadError = "";
    setWorkbenchStatus(operationKey, `更早会话已加载：${state.sessions.length} 个会话`, { announce });
    reloadInvalidatedPromptArchive(promptArchiveInvalidated, sourceId);
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
  if (selectedSource()?.kind === "remote" && state.sessionTimeFilter !== "realtime") {
    void loadRemoteIndexForCurrentFilter({ reset: true, force: true, preserve: true, announce });
    return;
  }
  if (selectedSource()?.kind !== "remote" && state.sessionTimeFilter === "earlier") {
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
  els.refreshButton.textContent = isBusy ? "刷新列表中" : "刷新列表";
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
  const promptLoading = state.sidebarMode === "prompts" && state.promptArchiveLoading;
  setAriaBusy(els.sessionsPanel, state.sessionsLoading || state.historyLoading || state.remoteIndexLoading || promptLoading || state.remoteRefreshLoading);
  setAriaBusy(els.threadPanel, state.sessionLoading || promptLoading);
  setAriaBusy(els.promptArchiveContent, promptLoading);
}

function setAriaBusy(element, busy) {
  if (!element) return;
  element.setAttribute("aria-busy", busy ? "true" : "false");
}

async function selectSession(id, { announce = true, focusMobilePanel = true, immediateMobilePanel = false } = {}) {
  sessionAbortController?.abort();
  markdownAbortController?.abort();
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
  cancelRemoteRefreshForNavigation();
  state.sessionRequestKey = requestKey;
  const operationKey = `${requestKey}:status`;
  state.sessionLoading = true;
  state.sessionLoadError = "";
  state.pendingSessionTitle = targetSession?.displayTitle || id;
  state.detail = null;
  state.selectedItemRef = null;
  state.selectedEventIndex = null;
  state.selectedTraceNodeId = null;
  state.selectedAuditNodeId = null;
  state.selectedAuditTurnKey = null;
  state.selectedTerminalBlockId = null;
  state.expandedTraceNodeIds = new Set();
  state.expandedAuditTurnKeys = new Set();
  state.expandedAuditGroupIds = new Set();
  clearRawEventCache();
  state.visibleEvents = 40;
  state.visibleThreadItems = 140;

  syncExportButtons();
  setWorkbenchStatus(operationKey, `正在读取会话：${firstLine(state.pendingSessionTitle, 54)}`, { announce });
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
    syncExportButtons();
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
  markdownAbortController?.abort();
  cancelRawDiagnosticRequest({ clear: true });
  cancelRawEventRequest();
  sessionAbortController = null;
  markdownAbortController = null;
  state.selectedSessionId = null;
  state.selectedSessionKey = null;
  cancelRemoteRefreshForNavigation();
  state.sessionLoading = false;
  state.sessionLoadError = "";
  state.sessionRequestKey = "";
  state.pendingSessionTitle = "";
  state.detail = null;
  state.selectedItemRef = null;
  state.selectedEventIndex = null;
  state.selectedTraceNodeId = null;
  state.selectedAuditNodeId = null;
  state.selectedAuditTurnKey = null;
  state.selectedTerminalBlockId = null;
  state.expandedTraceNodeIds = new Set();
  state.expandedAuditTurnKeys = new Set();
  state.expandedAuditGroupIds = new Set();
  clearRawEventCache();
  syncExportButtons();
}

async function selectSource(sourceId) {
  if (!sourceId || sourceId === state.selectedSourceId) return;
  cancelPromptArchiveRequest();
  invalidateSessionListRequests();
  cancelAlternateLocalSourceDiscovery();
  state.selectedSourceId = sourceId;
  cancelRemoteRefreshForNavigation();
  state.remoteRefreshLoading = false;
  state.remoteRefreshCancelled = false;
  state.remoteRefreshError = "";
  state.remoteRefreshRequestKey = `inactive:${Date.now()}`;
  state.sessions = [];
  state.filteredSessions = [];
  state.sessionsLoadError = "";
  state.sessionsLoading = true;
  resetRemoteIndexState();
  state.promptArchive = [];
  state.promptArchiveProjects = [];
  state.promptArchiveLoaded = false;
  state.promptArchiveError = "";
  state.promptArchiveCancelled = false;
  state.promptArchiveProject = "all";
  state.promptArchivePage = null;
  clearSelectedSession();
  renderSourceControls();
  renderAll();
  await loadSessions({ announce: true });
  if (state.sidebarMode === "prompts") await loadPromptArchive({ announce: true });
}

async function refreshSelectedSource() {
  const source = selectedSource();
  if (!source?.status?.refreshable) return;
  const sourceId = source.id;
  cancelPromptArchiveRequest();
  cancelRawDiagnosticRequest({ clear: true });
  cancelRawEventRequest();
  state.remoteRefreshAbortController?.abort();
  const controller = new AbortController();
  const refreshContext = selectedSourceRefreshContext(sourceId, controller);
  state.remoteRefreshAbortController = controller;
  const operationKey = `refresh:${sourceId}:${Date.now()}`;
  state.remoteRefreshRequestKey = operationKey;
  state.remoteRefreshLoading = true;
  state.remoteRefreshCancelled = false;
  state.remoteRefreshError = "";
  let requestState = "current";
  setWorkbenchStatus(operationKey, `正在拉取${source.label || "远端"}快照`, { announce: true });
  els.refreshRemoteButton.disabled = true;
  els.refreshRemoteButton.textContent = "正在拉取快照";
  try {
    const result = await fetchJson(`/api/sources/${encodeURIComponent(sourceId)}/refresh`, { method: "POST", signal: controller.signal });
    requestState = selectedSourceRefreshRequestState({ sourceId, operationKey, refreshContext });
    if (requestState !== "current") return;
    await applySelectedSourceRefresh(result, { sourceId, operationKey, refreshContext });
    requestState = selectedSourceRefreshRequestState({ sourceId, operationKey, refreshContext });
  } catch (error) {
    requestState = selectedSourceRefreshRequestState({ sourceId, operationKey, refreshContext });
    if (requestState !== "current") return;
    await handleSelectedSourceRefreshFailure(error, { sourceId, operationKey, refreshContext });
    requestState = selectedSourceRefreshRequestState({ sourceId, operationKey, refreshContext });
  } finally {
    finishSelectedSourceRefresh({ controller, sourceId, operationKey, requestState });
  }
}

function selectedSourceRefreshContext(sourceId, controller) {
  return {
    navigation: sourceNavigationContext(),
    remoteIndexFilterKey: remoteIndexFilterKey(sourceId),
    remoteHistoryIndex: isRemoteHistoryIndexMode(),
    sidebarMode: state.sidebarMode,
    controller,
  };
}

function selectedSourceRefreshRequestState({ sourceId, operationKey, refreshContext }) {
  const requestState = sourceRequestState({
    requestKey: operationKey,
    expectedRequestKey: state.remoteRefreshRequestKey,
    sourceId,
    context: refreshContext.navigation,
  });
  if (requestState !== "current") return requestState;
  if (refreshContext.controller.signal.aborted || remoteIndexFilterKey(sourceId) !== refreshContext.remoteIndexFilterKey) return "navigation-changed";
  return "current";
}

function selectedSourceRefreshIsCurrent(options) {
  return selectedSourceRefreshRequestState(options) === "current";
}

async function applySelectedSourceRefresh(result, { sourceId, operationKey, refreshContext }) {
  requireSourceResponse(result, sourceId, "refresh");
  invalidatePromptArchiveCache(sourceId, promptArchiveScope());
  state.remoteRefreshError = "";
  if (result.source) upsertSource(result.source);
  renderSourceControls();
  const refreshIsCurrent = () => selectedSourceRefreshIsCurrent({ sourceId, operationKey, refreshContext });
  if (refreshContext.sidebarMode === "sessions" && refreshContext.remoteHistoryIndex) {
    const entry = await loadRemoteIndexForCurrentFilter({
      reset: true,
      force: true,
      preserve: true,
      announce: false,
      signal: refreshContext.controller.signal,
      isCurrent: refreshIsCurrent,
    });
    if (!entry || !refreshIsCurrent()) return;
  } else {
    await loadSessions();
    if (!refreshIsCurrent()) return;
  }
  if (state.sidebarMode === "prompts") await loadPromptArchive({ force: true });
  if (!refreshIsCurrent()) return;
  setWorkbenchStatus(operationKey, "远端快照已拉取到本机缓存；未修改远端", { announce: true });
  showToast("远端快照已拉取到本机缓存；未修改远端");
}

async function handleSelectedSourceRefreshFailure(error, { sourceId, operationKey, refreshContext }) {
  state.remoteRefreshError = error.message;
  const refreshIsCurrent = () => selectedSourceRefreshIsCurrent({ sourceId, operationKey, refreshContext });
  await reloadSources({ isCurrent: refreshIsCurrent });
  if (!refreshIsCurrent()) return;
  setWorkbenchStatus(operationKey, `拉取远端快照失败：${error.message}。可再次拉取。`, { announce: true });
  showToast(`拉取远端快照失败：${error.message}；远端未修改`);
  if (!refreshContext.remoteHistoryIndex) await loadSessions();
  if (state.sidebarMode === "prompts") await loadPromptArchive({ force: true });
}

function finishSelectedSourceRefresh({ controller, sourceId, operationKey, requestState }) {
  if (state.remoteRefreshAbortController === controller) state.remoteRefreshAbortController = null;
  if (!sourceRequestOwnsState({ requestKey: operationKey, expectedRequestKey: state.remoteRefreshRequestKey, sourceId })) return;
  state.remoteRefreshLoading = false;
  if (requestState === "navigation-changed") {
    state.remoteRefreshCancelled = true;
    if (state.workbenchStatus.key === operationKey) setWorkbenchStatus(operationKey, "远端快照拉取已取消，可再次拉取");
  }
  renderSourceControls();
  renderAll();
}

function cancelRemoteRefreshForNavigation() {
  if (!state.remoteRefreshAbortController || state.remoteRefreshAbortController.signal.aborted) return;
  state.remoteRefreshAbortController.abort();
}

async function reloadSources({ isCurrent = () => true } = {}) {
  const data = await fetchJson("/api/sources").catch(() => null);
  if (!data?.sources || !isCurrent()) return;
  state.sources = data.sources;
  renderSourceControls();
}

async function reloadPeers({ showLoading = false } = {}) {
  const requestKey = `peers:${++state.peerLoadRequestSeq}`;
  state.peerLoadRequestKey = requestKey;
  const preserveDraftAtStart = peerDraftShouldBePreserved();
  if (showLoading || els.peerDialog?.open) {
    state.peerLoading = true;
    state.peerLoadError = "";
    if (els.peerEditorStatus) els.peerEditorStatus.dataset.sticky = "false";
    renderPeerManager({ preserveDraft: preserveDraftAtStart });
  }
  let data;
  try {
    data = await fetchJson("/api/peers");
  } catch (error) {
    if (state.peerLoadRequestKey !== requestKey) return;
    state.peerLoading = false;
    state.peerLoadError = error.message;
    if (els.peerEditorStatus) els.peerEditorStatus.dataset.sticky = "false";
    renderPeerManager({ preserveDraft: true });
    return;
  }
  if (state.peerLoadRequestKey !== requestKey) return;
  if (!data?.peers) {
    state.peerLoading = false;
    state.peerLoadError = "远端数据源响应缺少 peers 字段";
    if (els.peerEditorStatus) els.peerEditorStatus.dataset.sticky = "false";
    renderPeerManager({ preserveDraft: true });
    return;
  }
  const preserveDraft = preserveDraftAtStart || peerDraftShouldBePreserved();
  state.peers = data.peers;
  if (data.sources) state.sources = data.sources;
  state.peerLoading = false;
  state.peerLoadError = "";
  if (!preserveDraft) {
    if (!state.selectedPeerId && state.peers.length > 0) state.selectedPeerId = state.peers[0].id;
    if (state.selectedPeerId && !state.peers.some((peer) => peer.id === state.selectedPeerId)) {
      state.selectedPeerId = state.peers[0]?.id || null;
    }
  }
  renderSourceControls();
  renderPeerManager({ preserveDraft });
}

function openPeerDialog() {
  if (!els.peerDialog.open) els.peerDialog.showModal();
  void reloadPeers({ showLoading: true });
}

function renderPeerManager(options = {}) {
  if (!els.peerList) return;
  const selected = state.peers.find((peer) => peer.id === state.selectedPeerId) || null;
  if (state.peerLoading) {
    els.peerList.innerHTML = `<div class="peer-empty">读取远端数据源中</div>`;
  } else if (state.peerLoadError) {
    els.peerList.innerHTML = `<div class="peer-empty">读取远端数据源失败：${escapeHtml(state.peerLoadError)}</div>`;
  } else if (state.peers.length === 0) {
    els.peerList.innerHTML = `<div class="peer-empty">暂无远端数据源</div>`;
  } else {
    els.peerList.innerHTML = state.peers.map(renderPeerRow).join("");
  }
  els.peerList.querySelectorAll("[data-peer-id]").forEach((row) => {
    row.addEventListener("click", () => requestSelectPeerForEdit(row.dataset.peerId));
  });
  if (options.preserveDraft && peerDraftShouldBePreserved()) {
    syncPeerEditorState();
    return;
  }
  fillPeerForm(selected);
}

function renderPeerRow(peer) {
  const active = peer.id === state.selectedPeerId ? " active" : "";
  const status = peer.enabled ? (peer.hasToken ? "已配置" : "缺访问令牌") : "停用";
  return `
    <button class="peer-row${active}" type="button" data-peer-id="${escapeAttr(peer.id)}">
      <span>
        <strong>${escapeHtml(peer.label || peer.id)}</strong>
        <em>${escapeHtml(peer.url || "")}</em>
      </span>
      <small>${escapeHtml(status)}</small>
    </button>
  `;
}

function selectPeerForEdit(id) {
  state.selectedPeerId = id;
  renderPeerManager();
}

function confirmDiscardPeerChanges() {
  if (!peerFormDirty()) return true;
  const confirmed = window.confirm("放弃远端数据源未保存更改？");
  if (!confirmed) syncPeerEditorState();
  return confirmed;
}

function requestClosePeerDialog() {
  if (!els.peerDialog?.open) return true;
  if (!confirmDiscardPeerChanges()) return false;
  els.peerDialog.close();
  return true;
}

function requestSelectPeerForEdit(id, { force = false } = {}) {
  if (!force && id === state.selectedPeerId) return;
  if (!confirmDiscardPeerChanges()) return;
  selectPeerForEdit(id);
}

function fillPeerForm(peer) {
  els.peerId.value = peer?.id || "";
  els.peerLabel.value = peer?.label || "";
  els.peerUrl.value = peer?.url || "";
  els.peerToken.value = "";
  els.peerToken.placeholder = peer?.hasToken ? "已保存；留空表示保留原访问令牌" : "粘贴远端访问令牌";
  els.peerEnabled.checked = peer?.enabled !== false;
  state.peerFormSnapshot = peerSnapshotFromPeer(peer);
  els.peerEditorStatus.dataset.sticky = "false";
  syncPeerEditorState();
}

function peerDraftShouldBePreserved() {
  return Boolean(els.peerDialog?.open && peerFormDirty());
}

async function savePeerFromForm(event) {
  event.preventDefault();
  const blockedReason = peerSaveBlockedReason();
  if (blockedReason) {
    setPeerStatus(blockedReason);
    syncPeerEditorState();
    return;
  }
  const existingId = els.peerId.value.trim();
  const token = els.peerToken.value.trim();
  const body = {
    id: existingId || undefined,
    label: els.peerLabel.value.trim(),
    url: els.peerUrl.value.trim(),
    token,
    enabled: els.peerEnabled.checked,
  };
  if (existingId && !token) delete body.token;
  state.peerSaving = true;
  setPeerStatus("保存中...");
  syncPeerEditorState();
  try {
    const url = existingId ? `/api/peers/${encodeURIComponent(existingId)}` : "/api/peers";
    const method = existingId ? "PUT" : "POST";
    const data = await fetchJson(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    state.peers = data.peers || [];
    state.sources = data.sources || state.sources;
    state.peerLoadError = "";
    state.peerLoading = false;
    state.selectedPeerId = data.peer?.id || existingId || null;
    renderSourceControls();
    renderPeerManager();
    await finishPeerSave(data);
  } catch (error) {
    setPeerStatus(`保存失败：${error.message}`);
  } finally {
    state.peerSaving = false;
    syncPeerEditorState();
  }
}

async function finishPeerSave(data) {
  const sourceChanged = data.configuration?.sourceChanged === true;
  const selectedSourceChanged = sourceChanged && state.selectedSourceId === state.selectedPeerId;
  if (selectedSourceChanged) {
    state.sessions = [];
    state.filteredSessions = [];
    resetRemoteIndexState();
    clearSelectedSession();
  }
  if (!sourceChanged) {
    setPeerStatus("已保存；实际来源未变更，现有快照可继续使用");
    showToast("远端数据源配置已保存；实际来源未变更，访问令牌只保存在本机");
    return;
  }
  setPeerStatus("来源已变更；旧快照已隔离，需要拉取新快照");
  showToast("远端来源已变更，旧快照已隔离；请拉取新快照");
  if (selectedSourceChanged) await loadSessions();
}

async function testSelectedPeer() {
  const blockedReason = peerTestBlockedReason();
  if (blockedReason) {
    setPeerStatus(blockedReason);
    syncPeerEditorState();
    return;
  }
  const id = els.peerId.value.trim();
  if (!id) return;
  state.peerTesting = true;
  setPeerStatus("测试已保存连接中：正在使用已保存配置向远端发起只读健康检查；表单草稿不会被测试，不保存配置、不拉取快照。");
  syncPeerEditorState();
  try {
    const result = await fetchJson(`/api/peers/${encodeURIComponent(id)}/test`, { method: "POST" });
    setPeerStatus(result.ok ? `已保存连接正常 · ${formatDate(result.remote?.time) || "远端已响应"}` : `已保存连接失败：${result.error || "未知错误"}`);
  } catch (error) {
    setPeerStatus(`已保存连接失败：${error.message}`);
  } finally {
    state.peerTesting = false;
    syncPeerEditorState();
  }
}

async function deleteSelectedPeer() {
  const blockedReason = peerDeleteBlockedReason();
  if (blockedReason) {
    setPeerStatus(blockedReason);
    syncPeerEditorState();
    return;
  }
  const peer = currentSavedPeer();
  const id = peer.id;
  const label = peerDeleteLabel(peer);
  const confirmed = window.confirm(
    `移除本机配置「${label}」？\n\n这只会移除本机保存的远端数据源配置和访问令牌，不会删除远端会话或远端快照，也不会修改远端数据源；本机已拉取的缓存快照不会随此操作删除。`,
  );
  if (!confirmed) {
    setPeerStatus("已取消移除本机配置");
    return;
  }
  state.peerDeleting = true;
  setPeerStatus("移除本机配置中...");
  syncPeerEditorState();
  try {
    const data = await fetchJson(`/api/peers/${encodeURIComponent(id)}`, { method: "DELETE" });
    state.peers = data.peers || [];
    state.sources = data.sources || state.sources.filter((source) => source.id !== id);
    state.peerLoadError = "";
    state.peerLoading = false;
    if (state.selectedSourceId === id) {
      state.selectedSourceId = "local";
      cancelRemoteRefreshForNavigation();
      clearSelectedSession();
    }
    state.selectedPeerId = state.peers[0]?.id || null;
    renderSourceControls();
    renderPeerManager();
    await loadSessions();
    showToast("已移除本机保存的远端配置和访问令牌；未删除远端会话、远端快照或本机已拉取的缓存快照");
  } catch (error) {
    setPeerStatus(`移除本机配置失败：${error.message}`);
  } finally {
    state.peerDeleting = false;
    syncPeerEditorState();
  }
}

function setPeerStatus(message) {
  els.peerEditorStatus.textContent = message;
  els.peerEditorStatus.dataset.sticky = "true";
}

function handlePeerFormInput() {
  els.peerEditorStatus.dataset.sticky = "false";
  syncPeerEditorState();
}

function currentSavedPeer() {
  const id = els.peerId.value.trim();
  return id ? state.peers.find((peer) => peer.id === id) || null : null;
}

function peerSnapshotFromPeer(peer) {
  return {
    id: peer?.id || "",
    label: peer?.label || "",
    url: peer?.url || "",
    enabled: peer?.enabled !== false,
    hasToken: Boolean(peer?.hasToken),
  };
}

function peerFormModel() {
  return {
    id: els.peerId.value.trim(),
    label: els.peerLabel.value.trim(),
    url: els.peerUrl.value.trim(),
    token: els.peerToken.value.trim(),
    enabled: els.peerEnabled.checked,
  };
}

function peerFormDirty() {
  const model = peerFormModel();
  const snapshot = state.peerFormSnapshot || peerSnapshotFromPeer(null);
  if (!model.id) return Boolean(model.label || model.url || model.token || model.enabled !== snapshot.enabled);
  return model.label !== snapshot.label || model.url !== snapshot.url || model.enabled !== snapshot.enabled || Boolean(model.token);
}

function peerSaveBlockedReason() {
  const model = peerFormModel();
  const saved = currentSavedPeer();
  if (state.peerSaving) return "正在保存远端数据源配置";
  if (state.peerDeleting) return "正在移除本机配置";
  if (!model.id) {
    if (!model.url || !model.token) return "新建远端数据源需要填写地址和访问令牌";
    return "";
  }
  if (!saved) return "请选择已保存的远端数据源";
  if (!model.url) return "地址不能为空";
  if (model.enabled && !saved.hasToken && !model.token) return "该数据源尚未保存访问令牌，需要填写访问令牌";
  if (!peerFormDirty()) return "没有未保存更改";
  return "";
}

function peerTestBlockedReason() {
  const saved = currentSavedPeer();
  if (state.peerTesting) return "正在测试已保存连接";
  if (state.peerSaving) return "正在保存，保存完成后再测试";
  if (state.peerDeleting) return "正在移除本机配置";
  if (!saved) return "请先保存该远端数据源后再测试";
  if (peerFormDirty()) return "当前表单有未保存更改；测试只使用已保存配置，请先保存后再测试";
  if (!saved.enabled) return "该数据源已停用，启用并保存后再测试";
  if (!saved.hasToken) return "该数据源缺少已保存访问令牌，填写并保存后再测试";
  return "";
}

function peerDeleteBlockedReason() {
  if (state.peerDeleting) return "正在移除本机配置";
  if (state.peerSaving) return "正在保存，保存完成后再移除";
  if (!currentSavedPeer()) return "请选择已保存的远端数据源";
  return "";
}

function peerDeleteLabel(peer) {
  return [peer.label || peer.id, peer.id && peer.label ? peer.id : "", peer.url].filter(Boolean).join(" · ");
}

function syncPeerEditorState() {
  const saveReason = peerSaveBlockedReason();
  const testReason = peerTestBlockedReason();
  const deleteReason = peerDeleteBlockedReason();
  const model = peerFormModel();
  const saved = currentSavedPeer();
  els.savePeerButton.disabled = Boolean(saveReason);
  els.savePeerButton.title = saveReason || (model.id ? "保存远端数据源更改" : "保存新远端数据源");
  els.testPeerButton.disabled = Boolean(testReason);
  els.testPeerButton.title = testReason || "使用已保存配置和访问令牌向远端发起只读健康检查；当前表单草稿不会被测试，不保存配置，不拉取快照";
  els.testPeerButton.setAttribute("aria-label", els.testPeerButton.title);
  els.deletePeerButton.disabled = Boolean(deleteReason);
  els.deletePeerButton.title = deleteReason || `移除本机保存的配置：${peerDeleteLabel(saved)}；不会删除远端会话、远端快照或本机已拉取的缓存快照`;
  if (els.peerEditorStatus.dataset.sticky === "true") return;
  if (state.peerLoading) {
    els.peerEditorStatus.textContent = "读取远端数据源中...";
    return;
  }
  if (state.peerLoadError) {
    els.peerEditorStatus.textContent = `读取远端数据源失败：${state.peerLoadError}`;
    return;
  }
  if (testReason && (!saveReason || saveReason === "没有未保存更改")) {
    els.peerEditorStatus.textContent = `测试不可用：${testReason}`;
  } else if (saveReason) {
    els.peerEditorStatus.textContent = saveReason;
  } else if (model.id) {
    els.peerEditorStatus.textContent = model.token
      ? "输入的新访问令牌只有保存后才会用于测试已保存连接，并会替换已保存访问令牌。"
      : "测试已保存连接只使用已保存配置；访问令牌留空会保留已保存访问令牌，输入新值需保存后生效。";
  } else {
    els.peerEditorStatus.textContent = "可保存新远端数据源；保存后才能测试已保存连接；访问令牌只保存在本机配置文件。";
  }
}

function openSettingsDialog() {
  const opener = document.activeElement;
  state.settingsDialogOpener = opener && opener !== document.body ? opener : els.settingsButton;
  clearSettingsValidationState();
  state.summaryRules = window.ToolSummary?.loadCustomRules?.() || [];
  state.executionGroupRules = window.ExecutionGrouping?.loadCustomRules?.() || [];
  state.evidenceRiskRules = window.EvidenceRiskRules?.loadCustomRules?.() || [];
  normalizeSettingsView();
  ensureEvidenceRiskEditorRules();
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
  return JSON.stringify({
    summaryRules: state.summaryRules || [],
    executionGroupRules: state.executionGroupRules || [],
    evidenceRiskRules: settingsEvidenceRiskSnapshotRules(),
  });
}

function settingsDirty() {
  return Boolean(state.settingsInitialSnapshot && settingsSnapshot() !== state.settingsInitialSnapshot);
}

function settingsEvidenceRiskSnapshotRules() {
  const rules = Array.isArray(state.evidenceRiskRules) ? state.evidenceRiskRules : [];
  if (window.EvidenceRiskRules?.customRulesFromMerged) {
    return window.EvidenceRiskRules.customRulesFromMerged(rules);
  }
  const defaults = window.EvidenceRiskRules?.normalizeRules?.(window.EvidenceRiskRules?.defaultRules?.() || []) || [];
  if (!defaults.length) return rules;
  const defaultById = new Map(defaults.map((rule) => [String(rule?.id || ""), rule]));
  return rules.filter((rule) => {
    const defaultRule = defaultById.get(String(rule?.id || ""));
    return !defaultRule || stableSettingsJson(rule) !== stableSettingsJson(defaultRule);
  });
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
    state.executionGroupRules = Array.isArray(snapshot.executionGroupRules) ? snapshot.executionGroupRules : [];
    state.evidenceRiskRules = Array.isArray(snapshot.evidenceRiskRules) ? snapshot.evidenceRiskRules : [];
  } catch {
    state.summaryRules = window.ToolSummary?.loadCustomRules?.() || [];
    state.executionGroupRules = window.ExecutionGrouping?.loadCustomRules?.() || [];
    state.evidenceRiskRules = window.EvidenceRiskRules?.loadCustomRules?.() || [];
    ensureEvidenceRiskEditorRules();
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
    const evidenceCount = window.EvidenceRiskRules?.activeRules?.(state.evidenceRiskRules)?.length || 0;
    const currentView = settingsViewOptions.find((view) => view.id === state.settingsView);
    const dirtyLabel = dirty ? "有未保存更改" : "没有未保存更改";
    els.settingsStatus.textContent = `${dirtyLabel} · ${currentView?.label || "展示规则"} · 摘要自定义 ${state.summaryRules.length} 条；执行聚合自定义 ${state.executionGroupRules.length} 条；证据生效 ${evidenceCount} 条；配置保存在当前浏览器本地。`;
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
  const executionDefaultCount = window.ExecutionGrouping?.defaultRules?.()?.length || 0;
  const executionActiveCount = window.ExecutionGrouping?.activeRules?.(state.executionGroupRules)?.length || executionDefaultCount;
  const evidenceDefaultCount = window.EvidenceRiskRules?.defaultRules?.()?.length || 0;
  const evidenceActiveCount = window.EvidenceRiskRules?.activeRules?.(state.evidenceRiskRules)?.length || evidenceDefaultCount;
  const evidenceLocalCount = window.EvidenceRiskRules?.customRulesFromMerged?.(state.evidenceRiskRules)?.length ?? state.evidenceRiskRules.length;
  return [
    {
      id: "summary",
      label: "摘要规则",
      value: `${summaryActiveCount}`,
      detail: `${state.summaryRules.length} 条自定义 · ${summaryDefaultCount} 条内置`,
    },
    {
      id: "execution",
      label: "执行聚合",
      value: `${executionActiveCount}`,
      detail: `${state.executionGroupRules.length} 条自定义 · ${executionDefaultCount} 条内置`,
    },
    {
      id: "evidence",
      label: "证据风险",
      value: `${evidenceActiveCount}`,
      detail: `${evidenceLocalCount} 条本地覆盖 · ${evidenceDefaultCount} 条内置`,
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
  } else if (state.settingsView === "execution") {
    renderExecutionGroupRuleList();
    renderDefaultExecutionGroupRuleList();
  } else if (state.settingsView === "evidence") {
    renderEvidenceRiskRuleList();
    renderDefaultEvidenceRiskRuleList();
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
    ...(window.ExecutionGrouping?.validateRulesForSave?.(state.executionGroupRules) || []).map((error) => ({ ...error, view: "execution" })),
    ...(window.EvidenceRiskRules?.validateRulesForSave?.(state.evidenceRiskRules) || []).map((error) => ({ ...error, view: "evidence" })),
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
    execution: `[data-group-rule-field="${error.field}"][data-group-rule-index="${error.index}"]`,
    evidence: `[data-evidence-rule-field="${error.field}"][data-evidence-rule-index="${error.index}"]`,
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

function renderExecutionGroupRuleList() {
  if (!els.executionGroupRuleList) return;
  if (!state.executionGroupRules.length) {
    els.executionGroupRuleList.innerHTML = `<div class="rule-empty">暂无自定义执行聚合规则。审计链会先使用自定义规则，再回退到内置规则。</div>`;
    return;
  }
  els.executionGroupRuleList.innerHTML = state.executionGroupRules.map((rule, index) => renderExecutionGroupRuleEditor(rule, index)).join("");
  els.executionGroupRuleList.querySelectorAll("[data-group-rule-field]").forEach((input) => {
    input.addEventListener("input", () => updateExecutionGroupRuleFromInput(input));
    input.addEventListener("change", () => updateExecutionGroupRuleFromInput(input));
  });
  els.executionGroupRuleList.querySelectorAll("[data-delete-group-rule]").forEach((button) => {
    button.addEventListener("click", () => {
      clearSettingsValidationState();
      state.executionGroupRules.splice(Number(button.dataset.deleteGroupRule), 1);
      renderSettingsDialog();
    });
  });
}

function renderExecutionGroupRuleEditor(rule, index) {
  const enabled = rule.enabled !== false;
  return `
    <article class="summary-rule-card">
      <div class="summary-rule-head">
        <label class="toggle-control">
          <input type="checkbox" ${enabled ? "checked" : ""} data-group-rule-field="enabled" data-group-rule-index="${escapeAttr(String(index))}" />
          <span>启用</span>
        </label>
        <button class="ghost-button small danger" type="button" data-delete-group-rule="${escapeAttr(String(index))}">删除</button>
      </div>
      <div class="summary-rule-grid">
        <label>
          <span class="field-label">名称</span>
          <input class="text-input" type="text" value="${escapeAttr(rule.label || "")}" data-group-rule-field="label" data-group-rule-index="${escapeAttr(String(index))}" placeholder="收集文件与目录信息" ${settingsFieldAttrs("execution", index, "label")} />
          ${renderSettingsFieldError("execution", index, "label")}
        </label>
        <label>
          <span class="field-label">工具</span>
          <input class="text-input" type="text" value="${escapeAttr(rule.tool || "")}" data-group-rule-field="tool" data-group-rule-index="${escapeAttr(String(index))}" placeholder="exec_command 或 *" ${settingsFieldAttrs("execution", index, "tool")} />
          ${renderSettingsFieldError("execution", index, "tool")}
        </label>
        <label>
          <span class="field-label">组标题模板</span>
          <input class="text-input" type="text" value="${escapeAttr(rule.title || "")}" data-group-rule-field="title" data-group-rule-index="${escapeAttr(String(index))}" placeholder="执行组 · 收集信息" />
        </label>
        <label>
          <span class="field-label">最少连续节点</span>
          <input class="text-input" type="number" min="2" max="30" step="1" value="${escapeAttr(String(rule.minItems || 2))}" data-group-rule-field="minItems" data-group-rule-index="${escapeAttr(String(index))}" />
        </label>
        <label class="summary-rule-grid-wide">
          <span class="field-label">组摘要模板</span>
          <input class="text-input" type="text" value="${escapeAttr(rule.summary || "")}" data-group-rule-field="summary" data-group-rule-index="${escapeAttr(String(index))}" placeholder="{count} 个执行节点 · {titles}" />
        </label>
      </div>
      <label>
        <span class="field-label">匹配正则</span>
        <textarea class="text-input rule-pattern-input" data-group-rule-field="pattern" data-group-rule-index="${escapeAttr(String(index))}" spellcheck="false" placeholder="读取文件内容|列出目录" ${settingsFieldAttrs("execution", index, "pattern")}>${escapeHtml(rule.pattern || "")}</textarea>
        ${renderSettingsFieldError("execution", index, "pattern")}
      </label>
    </article>
  `;
}

function renderDefaultExecutionGroupRuleList() {
  if (!els.defaultExecutionGroupRuleList) return;
  const rules = window.ExecutionGrouping?.defaultRules?.() || [];
  els.defaultExecutionGroupRuleList.innerHTML = rules
    .map(
      (rule) => `
        <div class="default-rule-row">
          <strong>${escapeHtml(rule.title || rule.label)}</strong>
          <span>${escapeHtml([rule.tool || "*", `${rule.minItems || 2}+ 连续`, rule.label].filter(Boolean).join(" · "))}</span>
          <code>${escapeHtml(rule.pattern || "")}</code>
        </div>
      `,
    )
    .join("");
}

function renderEvidenceRiskRuleList() {
  if (!els.evidenceRiskRuleList) return;
  ensureEvidenceRiskEditorRules();
  if (!state.evidenceRiskRules.length) {
    els.evidenceRiskRuleList.innerHTML = `<div class="rule-empty">暂无证据风险规则。审计链会回退到内置规则。</div>`;
    return;
  }
  const defaultIds = new Set(window.EvidenceRiskRules?.defaultRuleIds?.() || []);
  els.evidenceRiskRuleList.innerHTML = state.evidenceRiskRules.map((rule, index) => renderEvidenceRiskRuleEditor(rule, index, defaultIds.has(rule.id))).join("");
  els.evidenceRiskRuleList.querySelectorAll("[data-evidence-rule-field]").forEach((input) => {
    input.addEventListener("input", () => updateEvidenceRiskRuleFromInput(input));
    input.addEventListener("change", () => updateEvidenceRiskRuleFromInput(input));
  });
  els.evidenceRiskRuleList.querySelectorAll("[data-delete-evidence-rule]").forEach((button) => {
    button.addEventListener("click", () => {
      clearSettingsValidationState();
      state.evidenceRiskRules.splice(Number(button.dataset.deleteEvidenceRule), 1);
      renderSettingsDialog();
    });
  });
}

function renderEvidenceRiskRuleEditor(rule, index, isDefaultRule) {
  const enabled = rule.enabled !== false;
  const fieldText = Array.isArray(rule.textFields) ? rule.textFields.join(",") : rule.textFields || "";
  return `
    <article class="summary-rule-card">
      <div class="summary-rule-head">
        <label class="toggle-control">
          <input type="checkbox" ${enabled ? "checked" : ""} data-evidence-rule-field="enabled" data-evidence-rule-index="${escapeAttr(String(index))}" />
          <span>${isDefaultRule ? "启用内置规则" : "启用自定义规则"}</span>
        </label>
        ${isDefaultRule ? `<span class="muted">内置规则的本地覆盖</span>` : `<button class="ghost-button small danger" type="button" data-delete-evidence-rule="${escapeAttr(String(index))}">删除</button>`}
      </div>
      <div class="summary-rule-grid">
        <label>
          <span class="field-label">名称</span>
          <input class="text-input" type="text" value="${escapeAttr(rule.label || "")}" data-evidence-rule-field="label" data-evidence-rule-index="${escapeAttr(String(index))}" placeholder="工具输出风险词" ${settingsFieldAttrs("evidence", index, "label")} />
          ${renderSettingsFieldError("evidence", index, "label")}
        </label>
        <label>
          <span class="field-label">类型</span>
          <select class="text-input" data-evidence-rule-field="kind" data-evidence-rule-index="${escapeAttr(String(index))}">
            <option value="risk-text" ${rule.kind === "risk-text" ? "selected" : ""}>风险词</option>
            <option value="large-payload" ${rule.kind === "large-payload" ? "selected" : ""}>大型输出</option>
          </select>
        </label>
        <label>
          <span class="field-label">工具</span>
          <input class="text-input" type="text" value="${escapeAttr(rule.tool || "*")}" data-evidence-rule-field="tool" data-evidence-rule-index="${escapeAttr(String(index))}" placeholder="exec_command 或 *" ${settingsFieldAttrs("evidence", index, "tool")} />
          ${renderSettingsFieldError("evidence", index, "tool")}
        </label>
        <label>
          <span class="field-label">Tag</span>
          <input class="text-input" type="text" value="${escapeAttr(rule.tag || "")}" data-evidence-rule-field="tag" data-evidence-rule-index="${escapeAttr(String(index))}" placeholder="error-output" />
        </label>
        <label>
          <span class="field-label">风险等级</span>
          <select class="text-input" data-evidence-rule-field="level" data-evidence-rule-index="${escapeAttr(String(index))}">
            ${renderRiskLevelOptions(rule.level || "medium")}
          </select>
        </label>
        <label>
          <span class="field-label">状态失败等级</span>
          <select class="text-input" data-evidence-rule-field="failedLevel" data-evidence-rule-index="${escapeAttr(String(index))}">
            ${renderRiskLevelOptions(rule.failedLevel || rule.level || "medium")}
          </select>
        </label>
        <label>
          <span class="field-label">字段</span>
          <input class="text-input" type="text" value="${escapeAttr(fieldText)}" data-evidence-rule-field="textFields" data-evidence-rule-index="${escapeAttr(String(index))}" placeholder="status,output,payloadPreview" ${settingsFieldAttrs("evidence", index, "textFields")} />
          ${renderSettingsFieldError("evidence", index, "textFields")}
        </label>
        <label>
          <span class="field-label">大型输出阈值</span>
          <input class="text-input" type="number" min="1" step="1" value="${escapeAttr(String(rule.maxLength ?? 100000))}" data-evidence-rule-field="maxLength" data-evidence-rule-index="${escapeAttr(String(index))}" ${settingsFieldAttrs("evidence", index, "maxLength")} />
          ${renderSettingsFieldError("evidence", index, "maxLength")}
        </label>
        <label class="summary-rule-grid-wide">
          <span class="field-label">提示文案</span>
          <input class="text-input" type="text" value="${escapeAttr(rule.summary || "")}" data-evidence-rule-field="summary" data-evidence-rule-index="${escapeAttr(String(index))}" placeholder="工具输出或状态包含风险词。" />
        </label>
      </div>
      <label>
        <span class="field-label">风险词正则</span>
        <textarea class="text-input rule-pattern-input" data-evidence-rule-field="riskPattern" data-evidence-rule-index="${escapeAttr(String(index))}" spellcheck="false" ${settingsFieldAttrs("evidence", index, "riskPattern")}>${escapeHtml(rule.riskPattern || "")}</textarea>
        ${renderSettingsFieldError("evidence", index, "riskPattern")}
      </label>
      <label>
        <span class="field-label">非零失败正则</span>
        <textarea class="text-input rule-pattern-input" data-evidence-rule-field="nonZeroFailurePattern" data-evidence-rule-index="${escapeAttr(String(index))}" spellcheck="false" ${settingsFieldAttrs("evidence", index, "nonZeroFailurePattern")}>${escapeHtml(rule.nonZeroFailurePattern || "")}</textarea>
        ${renderSettingsFieldError("evidence", index, "nonZeroFailurePattern")}
      </label>
      <label>
        <span class="field-label">忽略输出正文的命令正则</span>
        <textarea class="text-input rule-pattern-input" data-evidence-rule-field="ignoredCommandPattern" data-evidence-rule-index="${escapeAttr(String(index))}" spellcheck="false" placeholder="读取文件或搜索文本命令" ${settingsFieldAttrs("evidence", index, "ignoredCommandPattern")}>${escapeHtml(rule.ignoredCommandPattern || "")}</textarea>
        ${renderSettingsFieldError("evidence", index, "ignoredCommandPattern")}
      </label>
    </article>
  `;
}

function renderRiskLevelOptions(selected) {
  return ["low", "medium", "high"]
    .map((level) => `<option value="${level}" ${selected === level ? "selected" : ""}>${escapeHtml(auditRiskLabel(level))}</option>`)
    .join("");
}

function renderDefaultEvidenceRiskRuleList() {
  if (!els.defaultEvidenceRiskRuleList) return;
  const rules = window.EvidenceRiskRules?.defaultRules?.() || [];
  els.defaultEvidenceRiskRuleList.innerHTML = rules
    .map(
      (rule) => `
        <div class="default-rule-row">
          <strong>${escapeHtml(rule.label || rule.id)}</strong>
          <span>${escapeHtml([rule.kind, rule.tool || "*", rule.tag].filter(Boolean).join(" · "))}</span>
          <code>${escapeHtml(rule.kind === "large-payload" ? `maxLength>${rule.maxLength}` : rule.riskPattern || "")}</code>
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

function updateExecutionGroupRuleFromInput(input) {
  clearSettingsValidationFeedback();
  const index = Number(input.dataset.groupRuleIndex);
  const field = input.dataset.groupRuleField;
  const rule = state.executionGroupRules[index];
  if (!rule || !field) return;
  if (field === "enabled") {
    rule[field] = input.checked;
  } else if (field === "minItems") {
    rule[field] = input.valueAsNumber || Number(input.value) || 2;
  } else {
    rule[field] = input.value;
  }
  syncSettingsDirtyState();
}

function updateEvidenceRiskRuleFromInput(input) {
  clearSettingsValidationFeedback();
  const index = Number(input.dataset.evidenceRuleIndex);
  const field = input.dataset.evidenceRuleField;
  const rule = state.evidenceRiskRules[index];
  if (!rule || !field) return;
  if (field === "enabled") {
    rule[field] = input.checked;
  } else if (field === "maxLength") {
    rule[field] = input.value;
  } else if (field === "textFields") {
    rule[field] = input.value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  } else {
    rule[field] = input.value;
  }
  syncSettingsDirtyState();
}

function ensureEvidenceRiskEditorRules() {
  state.evidenceRiskRules = window.EvidenceRiskRules?.mergedRules?.(state.evidenceRiskRules) || state.evidenceRiskRules || [];
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
  let normalizedGroupRules;
  let normalizedEvidenceRiskRules;
  try {
    normalized = window.ToolSummary?.saveCustomRules?.(state.summaryRules) || [];
    normalizedGroupRules = window.ExecutionGrouping?.saveCustomRules?.(state.executionGroupRules) || [];
    normalizedEvidenceRiskRules = window.EvidenceRiskRules?.saveCustomRules?.(state.evidenceRiskRules) || [];
  } catch (error) {
    const message = `保存展示规则失败：${errorTextFromError(error)}`;
    state.settingsFeedbackMessage = message;
    state.settingsFeedbackStatus = "error";
    syncSettingsDirtyState();
    showToast(message);
    return;
  }

  state.summaryRules = normalized;
  state.executionGroupRules = normalizedGroupRules;
  state.evidenceRiskRules = normalizedEvidenceRiskRules;
  ensureEvidenceRiskEditorRules();
  state.settingsInitialSnapshot = settingsSnapshot();
  renderSettingsDialog();
  try {
    if (state.selectedSessionId) {
      await reloadSelectedSessionDetail();
    } else {
      renderMainContent();
      renderInspector();
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

function newExecutionGroupRule() {
  return {
    id: `custom-group-${Date.now()}`,
    label: "自定义执行组",
    enabled: true,
    tool: "exec_command",
    minItems: 2,
    pattern: "",
    title: "执行组 · {label}",
    summary: "{count} 个执行节点 · {titles}",
  };
}

function newEvidenceRiskRule() {
  return {
    id: `custom-evidence-risk-${Date.now()}`,
    label: "自定义证据风险",
    enabled: true,
    kind: "risk-text",
    tool: "*",
    level: "medium",
    failedLevel: "high",
    tag: "error-output",
    textFields: ["status", "output", "payloadPreview"],
    maxLength: 100000,
    riskPattern: "\\b(error|failed|failure|exception|stderr)\\b|失败|错误",
    nonZeroFailurePattern: "\\bfail(?:ed|ures?)?\\s*[:=]?\\s*[1-9]\\d*\\b|\\berrors?\\s*[:=]?\\s*[1-9]\\d*\\b",
    ignoredCommandPattern: "",
    summary: "工具输出或状态包含风险词。",
  };
}

async function loadRemoteIndexForCurrentFilter(options = {}) {
  const source = selectedSource();
  if (source?.kind !== "remote" || state.sessionTimeFilter === "realtime") {
    return deactivateRemoteIndex();
  }
  if (options.isCurrent && !options.isCurrent()) return null;
  const request = prepareRemoteIndexRequest(options);
  if (request.cached) return showCachedRemoteIndexPage(request.cursor, request.cached, request.options.announce === true);
  return requestRemoteIndexPage(request);
}

function deactivateRemoteIndex() {
  const changed = state.remoteIndexLoading || state.remoteIndexSessions.length || state.remoteIndexError || state.remoteIndexPage;
  resetRemoteIndexState();
  renderSourceStatus();
  if (changed) renderSessionList();
}

function prepareRemoteIndexRequest(options) {
  const sourceId = state.selectedSourceId;
  const filterKey = remoteIndexFilterKey(sourceId);
  if (options.reset || state.remoteIndexFilterKey !== filterKey) {
    resetRemoteIndexState({ preserve: options.preserve === true });
    state.remoteIndexFilterKey = filterKey;
  }
  const cursor = String(options.cursor ?? "0");
  return { sourceId, filterKey, cursor, options, cached: options.force ? null : state.remoteIndexPages.get(cursor) };
}

function showCachedRemoteIndexPage(cursor, entry, announce = false) {
  if (entry.sourceId !== state.selectedSourceId) return loadRemoteIndexForCurrentFilter({ cursor, force: true, announce });
  state.remoteIndexPages.delete(cursor);
  state.remoteIndexPages.set(cursor, entry);
  state.remoteIndexPage = entry;
  state.remoteIndexSessions = entry.sessions;
  state.remoteIndexError = "";
  state.remoteIndexLoading = false;
  setWorkbenchStatus(`remote-index:cached:${cursor}`, `${remoteHistoryBucketLabel()}已加载：${entry.page?.total || 0} 条`, { announce });
  renderSourceStatus();
  renderSessionList();
}

async function requestRemoteIndexPage({ sourceId, filterKey, cursor, options }) {
  state.remoteIndexAbortController?.abort();
  const controller = new AbortController();
  const abortFromRefresh = () => controller.abort();
  options.signal?.addEventListener("abort", abortFromRefresh, { once: true });
  if (options.signal?.aborted || (options.isCurrent && !options.isCurrent())) {
    options.signal?.removeEventListener("abort", abortFromRefresh);
    return null;
  }
  const requestKey = startRemoteIndexRequest({ filterKey, cursor, options, controller });
  const operationKey = `${requestKey}:status`;
  setWorkbenchStatus(operationKey, `正在检索${remoteHistoryBucketLabel()}`, { announce: options.announce === true });
  renderSourceStatus();
  renderSessionList();
  try {
    return await fetchRemoteIndexPage({ sourceId, filterKey, cursor, options, controller, requestKey, operationKey });
  } finally {
    finishRemoteIndexRequest({ sourceId, filterKey, options, controller, abortFromRefresh, requestKey });
  }
}

function startRemoteIndexRequest({ filterKey, cursor, options, controller }) {
  state.remoteIndexAbortController = controller;
  const requestKey = [++state.remoteIndexRequestSeq, filterKey, cursor].join("\n");
  state.remoteIndexRequestKey = requestKey;
  state.remoteIndexLoading = true;
  if (!options.preserve) {
    state.remoteIndexSessions = [];
    state.remoteIndexPage = null;
  }
  state.remoteIndexError = "";
  return requestKey;
}

function finishRemoteIndexRequest({ sourceId, filterKey, options, controller, abortFromRefresh, requestKey }) {
  options.signal?.removeEventListener("abort", abortFromRefresh);
  if (state.remoteIndexAbortController === controller) state.remoteIndexAbortController = null;
  if (!remoteIndexRequestOwnsState({ requestKey, sourceId, filterKey })) return;
  state.remoteIndexLoading = false;
  renderSourceStatus();
  renderSessionList();
}

async function fetchRemoteIndexPage({ sourceId, filterKey, cursor, options, controller, requestKey, operationKey }) {
  try {
    const data = await fetchJson(remoteIndexUrl(sourceId, cursor, options.snapshot || ""), { signal: controller.signal });
    if (!remoteIndexRequestIsCurrent({ requestKey, sourceId, filterKey, isCurrent: options.isCurrent })) return null;
    requireSourceResponse(data, sourceId, "remote-index");
    const entry = applyRemoteIndexResponse({ data, sourceId, cursor, options });
    setWorkbenchStatus(operationKey, `${remoteHistoryBucketLabel()}已加载：${entry.page.total || 0} 条`, { announce: options.announce === true });
    return entry;
  } catch (error) {
    return handleRemoteIndexPageFailure({ error, sourceId, filterKey, options, requestKey, operationKey });
  }
}

async function handleRemoteIndexPageFailure({ error, sourceId, filterKey, options, requestKey, operationKey }) {
  if (isAbortError(error) || !remoteIndexRequestIsCurrent({ requestKey, sourceId, filterKey, isCurrent: options.isCurrent })) return null;
  if (error.status === 409 && error.code === "index_snapshot_changed") {
    resetRemoteIndexState();
    showToast("远端历史索引已更新，已从第一页重新开始定位。");
    setWorkbenchStatus(operationKey, "远端历史索引已变化，正在从第一页重新开始定位", { announce: true });
    return loadRemoteIndexForCurrentFilter({ reset: true, signal: options.signal, isCurrent: options.isCurrent });
  }
  restoreRemoteIndexAfterFailedRequest(options);
  state.remoteIndexError = error.message;
  setWorkbenchStatus(operationKey, `远端历史索引失败：${error.message}。可重试或返回实时。`, { announce: true });
  showToast(`远端索引检索失败：${error.message}`);
  return null;
}

function remoteIndexRequestIsCurrent({ requestKey, sourceId, filterKey, isCurrent }) {
  return remoteIndexRequestOwnsState({ requestKey, sourceId, filterKey }) && (!isCurrent || isCurrent());
}

function remoteIndexRequestOwnsState({ requestKey, sourceId, filterKey }) {
  return state.remoteIndexRequestKey === requestKey && state.remoteIndexFilterKey === filterKey && state.selectedSourceId === sourceId;
}

function applyRemoteIndexResponse({ data, sourceId, cursor, options }) {
  if (data.source) upsertSource(data.source);
  const entry = {
    sourceId,
    cursor,
    previousCursor: options.previousCursor ?? null,
    pageNumber: options.pageNumber || 1,
    page: data.page || { total: 0, limit: remoteIndexPageLimit, cursor, nextCursor: null },
    sessions: (data.sessions || []).map((session) => ({ ...session, remoteIndexOnly: true, availableInSnapshot: false })),
  };
  cacheRemoteIndexPage(entry);
  state.remoteIndexPage = entry;
  state.remoteIndexSessions = entry.sessions;
  state.remoteIndexError = "";
  return entry;
}

function restoreRemoteIndexAfterFailedRequest(options) {
  if (options.preserve && state.remoteIndexPage) {
    state.remoteIndexSessions = state.remoteIndexPage.sessions;
    return;
  }
  state.remoteIndexSessions = [];
  state.remoteIndexPage = null;
}

function resetRemoteIndexState({ preserve = false } = {}) {
  const preservedEntry = preserve ? state.remoteIndexPage : null;
  const preservedSessions = preserve ? state.remoteIndexSessions : [];
  state.remoteIndexAbortController?.abort();
  state.remoteIndexAbortController = null;
  state.remoteIndexRequestKey = `inactive:${++state.remoteIndexRequestSeq}`;
  state.remoteIndexFilterKey = "";
  state.remoteIndexSessions = preservedSessions;
  state.remoteIndexLoading = false;
  state.remoteIndexError = "";
  state.remoteIndexPage = preservedEntry;
  state.remoteIndexPages = new Map();
}

function remoteIndexFilterKey(sourceId) {
  return [sourceId, state.sessionTimeFilter, els.sessionSearch.value.trim(), els.sessionTypeFilter.value].join("\n");
}

function sourceNavigationContext() {
  return JSON.stringify({
    sourceId: state.selectedSourceId,
    sidebarMode: state.sidebarMode,
    sessionTimeFilter: state.sessionTimeFilter,
    viewMode: state.viewMode,
    reviewTab: state.reviewTab,
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
  const collectionKey = responseKind === "prompts" ? "entries" : responseKind === "sessions" || responseKind === "remote-index" ? "sessions" : "";
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

function cacheRemoteIndexPage(entry) {
  state.remoteIndexPages.delete(entry.cursor);
  state.remoteIndexPages.set(entry.cursor, entry);
  while (state.remoteIndexPages.size > remoteIndexPageCacheLimit) {
    const oldestCursor = state.remoteIndexPages.keys().next().value;
    state.remoteIndexPages.delete(oldestCursor);
  }
}

function renderAll() {
  renderSessionList();
  renderThreadHeader();
  renderStats();
  renderMainContent();
  renderInspector();
  renderStatusbar();
  syncExportButtons();
}

function setViewMode(mode) {
  const nextMode = normalizeViewMode(mode);
  const changed = state.viewMode !== nextMode;
  if (state.viewMode === "diagnostic" && state.diagnosticMode === "raw" && nextMode !== "diagnostic") {
    cancelRawDiagnosticRequest();
    cancelRawEventRequest();
  }
  state.viewMode = nextMode;
  if (changed) cancelRemoteRefreshForNavigation();
  syncViewControls();
  renderStats();
  renderMainContent();
  if (changed) renderInspector();
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
  if (mode === "trace" || mode === "terminal") return "audit";
  return "compact";
}

function setDiagnosticMode(mode) {
  const nextMode = mode === "raw" ? "raw" : "stats";
  const wasRaw = state.viewMode === "diagnostic" && state.diagnosticMode === "raw";
  const changed = state.viewMode !== "diagnostic" || state.diagnosticMode !== nextMode;
  if (wasRaw && nextMode !== "raw") {
    cancelRawDiagnosticRequest();
    cancelRawEventRequest();
  }
  state.diagnosticMode = nextMode;
  state.viewMode = "diagnostic";
  if (changed) cancelRemoteRefreshForNavigation();
  syncViewControls();
  renderStats();
  renderMainContent();
  if (changed) renderInspector();
}

function syncViewControls() {
  state.viewMode = normalizeViewMode(state.viewMode);
  const diagnosticVisible = state.viewMode === "diagnostic";
  if (!diagnosticVisible && els.diagnosticSwitch?.contains(document.activeElement)) {
    const activePrimaryView = [els.compactViewButton, els.auditViewButton, els.diagnosticViewButton]
      .find((button) => button?.dataset.viewMode === state.viewMode);
    activePrimaryView?.focus({ preventScroll: true });
  }
  if (els.diagnosticSwitch) {
    els.diagnosticSwitch.hidden = !diagnosticVisible;
    els.diagnosticSwitch.inert = !diagnosticVisible;
    if (diagnosticVisible) els.diagnosticSwitch.removeAttribute("aria-hidden");
    else els.diagnosticSwitch.setAttribute("aria-hidden", "true");
  }
  syncItemTypeFilterOptions();
  [
    [els.compactViewButton, "compact"],
    [els.auditViewButton, "audit"],
    [els.diagnosticViewButton, "diagnostic"],
  ].forEach(([button, mode]) => {
    const active = state.viewMode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
    button.tabIndex = active ? 0 : -1;
  });
  [
    [els.statsViewButton, "stats"],
    [els.rawViewButton, "raw"],
  ].forEach(([button, mode]) => {
    const active = state.viewMode === "diagnostic" && state.diagnosticMode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
    button.tabIndex = active ? 0 : -1;
  });
  els.threadContent.hidden = true;
  els.compactContent.hidden = state.viewMode !== "compact";
  els.terminalContent.hidden = true;
  els.auditContent.hidden = state.viewMode !== "audit";
  els.diagnosticContent.hidden = state.viewMode !== "diagnostic";
  els.statsContent.hidden = state.viewMode !== "diagnostic" || state.diagnosticMode !== "stats";
  els.traceContent.hidden = true;
  els.rawContent.hidden = state.viewMode !== "diagnostic" || state.diagnosticMode !== "raw";
  if (els.importantOnlyLabel) {
    els.importantOnlyLabel.textContent = "复核优先";
  }
  if (els.keyEventsTitle) {
    els.keyEventsTitle.textContent = "复核台";
  }
  if (els.importantOnlyControl) {
    els.importantOnlyControl.title = "仅在主内容区突出重要或复核优先内容";
  }
}

function syncItemTypeFilterOptions() {
  // Legacy view state `state.viewMode === "stats"` now maps to diagnosticMode.
  const mode = state.viewMode === "audit" ? "audit" : state.viewMode === "diagnostic" ? "raw" : "standard";
  const previousMode = els.itemTypeFilter.dataset.optionMode || "standard";
  const options = mode === "audit" ? auditItemTypeOptions : mode === "raw" ? rawItemTypeOptions : standardItemTypeOptions;
  const currentFirstLabel = els.itemTypeFilter.options?.[0]?.textContent || "";
  if (previousMode === mode && currentFirstLabel === options[0]?.[1]) return;
  const previous = els.itemTypeFilter.value || "all";
  let mapped = previous;
  if (mode === "audit") {
    mapped = standardToAuditType[previous] || "all";
  } else if (previousMode === "audit") {
    mapped = auditToStandardType[previous] || "all";
  }
  els.itemTypeFilter.innerHTML = options
    .map(([value, label]) => `<option value="${escapeAttr(value)}">${escapeHtml(label)}</option>`)
    .join("");
  els.itemTypeFilter.value = options.some(([value]) => value === mapped) ? mapped : "all";
  els.itemTypeFilter.dataset.optionMode = mode;
}

function primeTraceExpansion(detail) {
  const root = detail?.trace?.root;
  state.expandedTraceNodeIds = new Set(root ? [root.id] : []);
  const firstTurn = detail?.turns?.[0];
  state.expandedAuditTurnKeys = new Set(firstTurn ? [auditTurnKey(firstTurn, 0)] : []);
  state.expandedAuditGroupIds = new Set();
}

function renderPromptArchiveSidebar() {
  const projects = state.promptArchiveProjects || [];
  const page = state.promptArchivePage || {};
  els.sessionCount.textContent = String(page.candidatesScanned || state.promptArchive.length || 0);
  if (state.promptArchiveLoading && !state.promptArchive.length) {
    els.sessionList.innerHTML = emptyState("正在整理任务归档", "按项目读取每个会话的首个用户提示词。", []);
    return;
  }
  if (state.promptArchiveCancelled) {
    els.sessionList.innerHTML = renderSessionListActionEmptyState("任务归档读取已取消", "当前导航已变化，未采用旧结果。可以重新整理。", [{ action: "retry-prompts", label: "重新整理" }]);
    bindSessionListEmptyActions();
    return;
  }
  if (state.promptArchiveError) {
    els.sessionList.innerHTML = renderSessionListActionEmptyState("任务归档读取失败", state.promptArchiveError, [{ action: "retry-prompts", label: "重试" }]);
    bindSessionListEmptyActions();
    return;
  }
  if (!projects.length) {
    const message = isRemoteHistoryIndexMode()
      ? "远端历史只返回索引元数据，未同步正文，无法提取首个提示词。"
      : promptArchiveRangeNote("当前批没有可显示的任务归档。", page);
    els.sessionList.innerHTML = emptyState("暂无任务归档", message, []);
    return;
  }
  const active = state.promptArchiveProject;
  els.sessionList.innerHTML = `
    <button class="prompt-project-row${active === "all" ? " active" : ""}" type="button" data-prompt-project="all">
      <span><strong>当前批全部项目</strong><em>${escapeHtml(promptArchiveRangeLabel(page))}</em></span><small>${state.promptArchive.length}</small>
    </button>
    ${projects
      .map(
        (project) => `
          <button class="prompt-project-row${active === project.key ? " active" : ""}" type="button" data-prompt-project="${escapeAttr(project.key)}">
            <span><strong>${escapeHtml(project.label)}</strong><em>${escapeHtml(project.cwd || "无工作目录")}</em></span><small>${project.count}</small>
          </button>
        `,
      )
      .join("")}
  `;
  els.sessionList.querySelectorAll("[data-prompt-project]").forEach((button) => {
    button.addEventListener("click", () => {
      state.promptArchiveProject = button.dataset.promptProject || "all";
      renderAll();
      els.promptArchiveContent?.focus({ preventScroll: true });
    });
  });
}

function renderPromptArchive() {
  if (!els.promptArchiveContent) return;
  if (state.sidebarMode !== "prompts") {
    els.promptArchiveContent.hidden = true;
    return;
  }
  els.promptArchiveContent.hidden = false;
  const query = els.promptArchiveSearch?.value.trim().toLowerCase() || "";
  const status = els.promptArchiveStatus?.value || "all";
  const entries = state.promptArchive.filter((entry) => {
    if (state.promptArchiveProject !== "all" && entry.projectKey !== state.promptArchiveProject) return false;
    if (status !== "all" && entry.promptState !== status) return false;
    if (!query) return true;
    return [entry.sessionTitle, entry.promptText, entry.cwd, entry.sessionId, entry.sourceLabel, entry.status]
      .filter(Boolean)
      .join("\n")
      .toLowerCase()
      .includes(query);
  });
  if (state.promptArchiveLoading && !state.promptArchive.length) {
    els.promptArchiveContent.innerHTML = emptyState("正在整理任务归档", "按项目读取每个会话的首个用户提示词。", []);
    return;
  }
  if (state.promptArchiveCancelled) {
    els.promptArchiveContent.innerHTML = renderSessionListActionEmptyState("任务归档读取已取消", "当前导航已变化，未采用旧结果。可以重新整理。", [{ action: "retry-prompts", label: "重新整理" }]);
    bindSessionListEmptyActions(els.promptArchiveContent);
    return;
  }
  if (state.promptArchiveError) {
    els.promptArchiveContent.innerHTML = renderSessionListActionEmptyState("任务归档读取失败", state.promptArchiveError, [{ action: "retry-prompts", label: "重试" }]);
    bindSessionListEmptyActions(els.promptArchiveContent);
    return;
  }
  const page = state.promptArchivePage || {};
  if (!entries.length && isRemoteHistoryIndexMode()) {
    els.promptArchiveContent.innerHTML = emptyState("历史正文未同步", "远端历史时间分类只有索引元数据，不含正文；切回实时或先扩大远端快照范围后再归档。", []);
    return;
  }
  const groups = groupPromptArchiveEntries(entries);
  const empty = !entries.length;
  const emptyMessage = query || status !== "all" || state.promptArchiveProject !== "all"
    ? promptArchiveRangeNote("当前已扫描范围没有符合搜索或筛选条件的任务。", page)
    : promptArchiveRangeNote("当前批没有可显示的任务归档。", page);
  els.promptArchiveContent.innerHTML = `
    <div class="prompt-archive-shell">
      <header class="prompt-archive-header">
        <div>
          <p class="eyebrow">任务归档</p>
          <h2>${escapeHtml(empty ? "当前批没有匹配任务" : `${entries.length} 条当前批任务`)}</h2>
          <p class="prompt-archive-note">${escapeHtml(promptArchiveRangeNote("按工作目录整理。提示词来自会话正文，标题仅作为会话元信息。", page))}</p>
        </div>
        <div class="prompt-archive-summary" aria-label="当前批任务归档统计">
          <strong>${groups.length}</strong><span>个项目</span>
        </div>
      </header>
      ${empty ? emptyState("没有匹配的任务", emptyMessage, []) : groups.map(renderPromptArchiveGroup).join("")}
      ${renderPromptArchivePagination(page)}
    </div>
  `;
  els.promptArchiveContent.querySelectorAll("[data-prompt-session-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const entry = state.promptArchive.find((candidate) => candidate.sessionId === button.dataset.promptSessionId);
      openPromptArchiveSession(entry);
    });
  });
  bindPromptArchivePagination();
}

function promptArchiveRangeLabel(page = {}) {
  const from = Number(page.candidateFrom) || 0;
  const to = Number(page.candidateTo) || 0;
  return from && to ? `已扫描候选第 ${from}-${to} 个` : "等待扫描候选会话";
}

function promptArchiveRangeNote(prefix, page = {}) {
  if (!page.candidatesScanned) return prefix;
  const range = promptArchiveRangeLabel(page);
  return page.hasMoreCandidates ? `${prefix} ${range}；更早候选尚未扫描。` : `${prefix} ${range}；已扫描到当前时间范围最早任务。`;
}

function renderPromptArchivePagination(page = {}) {
  if (!page.candidatesScanned && !state.promptArchiveLoading) return "";
  const hasMore = page.hasMoreCandidates === true && Boolean(page.nextPageToken);
  const completion = hasMore ? "更早候选尚未扫描" : "已扫描到当前时间范围最早任务";
  return `
    <nav class="remote-index-pagination prompt-archive-pagination" aria-label="任务归档候选分页">
      <span class="remote-index-page-info" data-prompt-archive-page-info>${escapeHtml(promptArchiveRangeLabel(page))} · 本批 ${Number(page.entriesReturned) || 0} 条归档</span>
      <span class="remote-index-page-status" data-prompt-archive-page-status>${escapeHtml(completion)}</span>
      <div class="remote-index-page-actions">
        <button class="ghost-button small" type="button" data-prompt-archive-page-action="next" ${hasMore && !state.promptArchiveLoading ? "" : "disabled"}>${state.promptArchiveLoading ? "正在定位更早任务" : "继续定位更早任务"}</button>
      </div>
    </nav>
  `;
}

function bindPromptArchivePagination() {
  els.promptArchiveContent?.querySelectorAll("[data-prompt-archive-page-action=next]").forEach((button) => {
    button.addEventListener("click", () => {
      const token = state.promptArchivePage?.nextPageToken;
      if (!token || state.promptArchiveLoading) return;
      void loadPromptArchive({ pageToken: token, announce: true });
    });
  });
}

function groupPromptArchiveEntries(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const group = groups.get(entry.projectKey) || { key: entry.projectKey, label: entry.projectLabel, cwd: entry.cwd, entries: [] };
    group.entries.push(entry);
    groups.set(entry.projectKey, group);
  }
  return [...groups.values()];
}

function renderPromptArchiveGroup(group) {
  return `
    <section class="prompt-archive-group">
      <div class="prompt-archive-group-head"><div><strong>${escapeHtml(group.label)}</strong><span>${escapeHtml(group.cwd || "无工作目录")}</span></div><small>${group.entries.length}</small></div>
      <div class="prompt-archive-list">${group.entries.map(renderPromptArchiveEntry).join("")}</div>
    </section>
  `;
}

function renderPromptArchiveEntry(entry) {
  const stateLabel = promptArchiveStateLabel(entry.promptState);
  const promptBody = entry.promptText || stateLabel;
  const attachmentLabel = entry.attachments?.length ? ` · ${entry.attachments.length} 个附件` : "";
  const eventAnchor = Number.isInteger(entry.promptEventIndex) ? `事件 #${entry.promptEventIndex}` : "未定位事件";
  return `
    <article class="prompt-archive-entry${entry.promptState !== "found" ? " is-muted" : ""}">
      <div class="prompt-archive-entry-head">
        <div><strong>${escapeHtml(entry.sessionTitle)}</strong><span>${escapeHtml(formatDate(entry.updatedAt || entry.startedAt) || "未知时间")}</span></div>
        <span class="prompt-archive-status" data-state="${escapeAttr(entry.promptState)}">${escapeHtml(stateLabel + attachmentLabel)}</span>
      </div>
      <details class="prompt-archive-text"${entry.promptState === "found" ? " open" : ""}>
        <summary>${escapeHtml(entry.promptPreview || promptBody)}</summary>
        ${entry.promptText ? `<div class="prompt-archive-full-text">${escapeHtml(entry.promptText)}</div>` : `<div class="prompt-archive-empty-text">${escapeHtml(promptBody)}</div>`}
      </details>
      <div class="prompt-archive-entry-meta"><span>${escapeHtml(entry.sourceLabel || "当前数据源")}</span><span>${escapeHtml(entry.cwd || "无项目")}</span><span>${escapeHtml(eventAnchor)}</span><button class="ghost-button small" type="button" data-prompt-session-id="${escapeAttr(entry.sessionId)}">打开原会话</button></div>
    </article>
  `;
}

function promptArchiveStateLabel(value) {
  if (value === "found") return "已找到首个任务";
  if (value === "image-only") return "仅图片附件";
  if (value === "unavailable") return "正文不可用";
  if (value === "too_large") return "内容超过归档读取上限";
  if (value === "changing") return "文件读取时仍在变化";
  if (value === "error") return "读取失败";
  return "未找到明确任务";
}

function openPromptArchiveSession(entry) {
  if (!entry?.sessionId) return;
  cancelPromptArchiveRequest();
  state.sidebarMode = "sessions";
  cancelRemoteRefreshForNavigation();
  state.promptArchiveProject = entry.projectKey || "all";
  els.appShell.dataset.mode = "sessions";
  if (els.promptArchiveControls) els.promptArchiveControls.hidden = true;
  syncSidebarModeTabs();
  setMobilePanel("thread");
  syncPanelToggleLabels();
  renderAll();
  if (entry.sourceId && entry.sourceId !== state.selectedSourceId) {
    void selectSource(entry.sourceId).then(() => selectSession(entry.sessionId, { focusMobilePanel: false }));
    return;
  }
  void selectSession(entry.sessionId, { focusMobilePanel: false });
}

function syncSidebarModeTabs() {
  [els.sessionsModeButton, els.promptsModeButton].forEach((button) => {
    if (!button) return;
    const active = button.dataset.sidebarMode === state.sidebarMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function renderSessionList() {
  if (state.sidebarMode === "prompts") {
    renderPromptArchiveSidebar();
    renderStatusbar();
    syncExportButtons();
    return;
  }
  const query = els.sessionSearch.value.trim().toLowerCase();
  const filter = els.sessionTypeFilter.value;
  syncSessionTimeFilter();
  const remoteHistory = isRemoteHistoryIndexMode();
  const source = selectedSource();
  if (source?.kind === "remote" && source.status?.needsRefresh && !remoteHistory) {
    state.filteredSessions = [];
    els.sessionCount.textContent = "0";
    els.sessionList.innerHTML = renderSessionListActionEmptyState(
      "需要拉取新快照",
      "远端来源已变更或尚未完成首次拉取。旧来源的会话、归档和导出不会用于当前来源。",
      [{ action: "refresh-remote", label: "拉取远端快照" }],
    );
    bindSessionListEmptyActions();
    renderStatusbar();
    syncExportButtons();
    return;
  }
  if (!remoteHistory && state.sessionsLoading && state.sessions.length === 0 && state.remoteIndexSessions.length === 0) {
    state.filteredSessions = [];
    els.sessionCount.textContent = "0";
    els.sessionList.innerHTML = emptyState("正在加载会话列表", `${selectedSource()?.label || "当前数据源"} · 请稍候。`);
    renderStatusbar();
    syncExportButtons();
    return;
  }
  if (!remoteHistory && state.healthLoadError && state.sessions.length === 0 && state.remoteIndexSessions.length === 0) {
    state.filteredSessions = [];
    els.sessionCount.textContent = "0";
    els.sessionList.innerHTML = emptyState("接口不可用", state.healthLoadError);
    renderStatusbar();
    syncExportButtons();
    return;
  }
  if (!remoteHistory && state.sessionsLoadError && state.sessions.length === 0 && state.remoteIndexSessions.length === 0) {
    state.filteredSessions = [];
    els.sessionCount.textContent = "0";
    els.sessionList.innerHTML = emptyState("无法加载会话列表", `${selectedSource()?.label || "当前数据源"} · ${state.sessionsLoadError}`);
    renderStatusbar();
    syncExportButtons();
    return;
  }
  const sessions = (remoteHistory ? state.remoteIndexSessions : mergedVisibleSessions()).filter((session) => {
    if (sessionTimeBucket(session) !== state.sessionTimeFilter) return false;
    if (filter === "project" && !session.cwd) return false;
    if (filter === "projectless" && session.cwd) return false;
    return true;
  });
  state.filteredSessions = sessions;
  renderSessionFilterNotice();
  els.sessionCount.textContent = String(remoteHistory && state.remoteIndexPage ? state.remoteIndexPage.page.total : sessions.length);
  if (sessions.length === 0) {
    if (!remoteHistory && state.sessionTimeFilter === "earlier" && state.historyLoading) {
      els.sessionList.innerHTML = renderSessionListActionEmptyState("正在读取更早会话", "历史会话仅在切换到该分类后读取。", []);
      renderStatusbar();
      syncExportButtons();
      return;
    }
    if (!remoteHistory && state.sessionTimeFilter === "earlier" && state.historyLoadError) {
      els.sessionList.innerHTML = renderSessionListActionEmptyState(
        `历史会话读取失败：${state.historyLoadError}`,
        "可重试更早会话，或点击刷新列表重试。",
        [{ action: "retry-history", label: "重试更早会话" }],
      );
      bindSessionListEmptyActions();
      renderStatusbar();
      syncExportButtons();
      return;
    }
    if (remoteHistory && state.remoteIndexLoading) {
      els.sessionList.innerHTML = renderSessionListActionEmptyState(
        "正在检索远端历史索引",
        `${remoteHistoryBucketLabel()}只返回标题、时间、路径等索引元数据，正文不会随历史索引同步。`,
        [{ action: "return-realtime", label: "返回实时" }],
      );
      bindSessionListEmptyActions();
      renderStatusbar();
      syncExportButtons();
      return;
    }
    if (remoteHistory && state.remoteIndexError) {
      els.sessionList.innerHTML = renderSessionListActionEmptyState(
        `历史索引失败：${state.remoteIndexError}`,
        "可以重试远端历史索引，或返回实时查看已同步到本机快照的会话正文。",
        [
          { action: "retry-remote-index", label: "重试历史索引" },
          { action: "return-realtime", label: "返回实时" },
        ],
      );
      bindSessionListEmptyActions();
      renderStatusbar();
      syncExportButtons();
      return;
    }
    const hint =
      remoteHistory
        ? "近一天/更早为远端历史索引，不含正文；实时快照默认只补最近 3 小时，历史正文需远端扩大共享窗口/额外同步，或切回已有本地快照。"
        : "调整搜索或过滤条件。";
    const actions = [];
    if (canDiscoverAlternateLocalSource() && state.alternateLocalSource) {
      actions.push({ action: "select-alternate-local-source", label: `切换查看 ${state.alternateLocalSource.label}` });
    }
    const emptyStateHtml = actions.length
      ? renderSessionListActionEmptyState("没有匹配的会话", `当前本机 Codex 来源没有可显示会话。检测到 ${state.alternateLocalSource.label} 有可读会话，可切换查看。`, actions)
      : emptyState("没有匹配的会话", hint);
    els.sessionList.innerHTML = emptyStateHtml + renderRemoteIndexPagination();
    bindSessionListEmptyActions();
    bindRemoteIndexPagination();
    renderStatusbar();
    syncExportButtons();
    return;
  }
  const renderedSessions = sessions.slice(0, 220);
  const overflowHtml =
    sessions.length > renderedSessions.length
      ? `<div class="list-overflow-note">已显示前 ${renderedSessions.length} 条，继续输入关键词可缩小范围。</div>`
      : "";
  els.sessionList.innerHTML = renderSessionDirectoryGroups(renderedSessions, query) + overflowHtml + renderRemoteIndexPagination();
  const activateSessionRow = (row) => {
    const rowSessionId = row.dataset.sessionId;
    const rowSessionKey = sessionKey({ id: rowSessionId, sourceId: state.selectedSourceId });
    const loadedSessionKey = state.detail?.session ? sessionKey(state.detail.session) : "";
    if (rowSessionKey === state.selectedSessionKey && loadedSessionKey === rowSessionKey && !state.sessionLoading) {
      row.focus();
      return;
    }
    selectSession(rowSessionId, { immediateMobilePanel: true });
  };
  els.sessionList.querySelectorAll('[data-session-id]:not([data-remote-index-only="true"])').forEach((row) => {
    row.addEventListener("click", (event) => {
      if (event.target.closest("a")) return;
      activateSessionRow(row);
    });
    row.addEventListener("keydown", (event) => {
      if (event.target.closest("a")) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      activateSessionRow(row);
    });
  });
  bindRemoteIndexPagination();
  renderStatusbar();
  syncExportButtons();
}

function isRemoteHistoryIndexMode() {
  return selectedSource()?.kind === "remote" && state.sessionTimeFilter !== "realtime";
}

function remoteHistoryBucketLabel() {
  if (state.sessionTimeFilter === "day") return "近一天历史索引";
  if (state.sessionTimeFilter === "earlier") return "更早历史索引";
  return "历史索引";
}

function renderRemoteIndexPagination() {
  const entry = state.remoteIndexPage;
  if (!isRemoteHistoryIndexMode() || !entry) return "";
  const page = entry.page || {};
  const total = Math.max(0, Number(page.total) || 0);
  const cursor = Math.max(0, Number(page.cursor));
  const start = total === 0 ? 0 : cursor + 1;
  const end = total === 0 ? 0 : Math.min(total, start + entry.sessions.length - 1);
  const hasPrevious = entry.previousCursor != null;
  const hasNext = page.nextCursor != null;
  const range = total === 0 ? "当前范围 0 条" : `当前范围第 ${start}-${end} 条`;
  const completion = hasNext ? "可继续定位更早结果" : "已到末页，无更多索引结果";
  return `
    <nav class="remote-index-pagination" aria-label="远端历史索引分页">
      <span class="remote-index-page-info" data-remote-index-page-info>第 ${entry.pageNumber} 页 · ${range} / 共 ${total} 条</span>
      <span class="remote-index-page-status" data-remote-index-page-status>${completion}</span>
      <div class="remote-index-page-actions">
        <button class="ghost-button small" type="button" data-remote-index-page-action="previous" title="上一页" aria-label="上一页" ${hasPrevious && !state.remoteIndexLoading ? "" : "disabled"}>←</button>
        <button class="ghost-button small" type="button" data-remote-index-page-action="next" title="下一页" aria-label="下一页" ${hasNext && !state.remoteIndexLoading ? "" : "disabled"}>→</button>
      </div>
    </nav>
  `;
}

function bindRemoteIndexPagination(container = els.sessionList) {
  container.querySelectorAll("[data-remote-index-page-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const entry = state.remoteIndexPage;
      if (!entry || state.remoteIndexLoading) return;
      if (button.dataset.remoteIndexPageAction === "previous" && entry.previousCursor != null) {
        void loadRemoteIndexForCurrentFilter({
          cursor: entry.previousCursor,
          pageNumber: Math.max(1, entry.pageNumber - 1),
          announce: true,
        });
      }
      if (button.dataset.remoteIndexPageAction === "next" && entry.page.nextCursor != null) {
        void loadRemoteIndexForCurrentFilter({
          cursor: entry.page.nextCursor,
          previousCursor: entry.cursor,
          pageNumber: entry.pageNumber + 1,
          snapshot: entry.page.snapshot || "",
          announce: true,
        });
      }
    });
  });
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
      } else if (action === "retry-remote-index") {
        void loadRemoteIndexForCurrentFilter();
      } else if (action === "retry-history") {
        void loadHistoricalSessions({ announce: true });
      } else if (action === "refresh-remote") {
        void refreshSelectedSource();
      } else if (action === "retry-prompts") {
        void loadPromptArchive();
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
  const byKey = new Map();
  for (const session of state.sessions) byKey.set(sessionKey(session), session);
  for (const session of state.remoteIndexSessions) {
    const key = sessionKey(session);
    if (!byKey.has(key)) byKey.set(key, session);
  }
  return [...byKey.values()];
}

function findSessionSummary(id, sourceId = state.selectedSourceId) {
  const key = sessionKey({ id, sourceId });
  return (
    mergedVisibleSessions().find((session) => sessionKey(session) === key) ||
    state.sessions.find((session) => session.id === id) ||
    state.remoteIndexSessions.find((session) => session.id === id) ||
    null
  );
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
  if (state.sessionTimeFilter !== previousTimeFilter) cancelRemoteRefreshForNavigation();
  reloadCurrentSessionListForFilters();
}

function returnToRealtimeSessions() {
  const changed = state.sessionTimeFilter !== "realtime";
  if (changed) invalidateSessionListRequests();
  state.sessionTimeFilter = "realtime";
  if (changed) cancelRemoteRefreshForNavigation();
  reloadCurrentSessionListForFilters();
}

function reloadCurrentSessionListForFilters() {
  if (isRemoteHistoryIndexMode()) {
    void loadRemoteIndexForCurrentFilter({ reset: true, announce: true });
    return;
  }
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
  const source = selectedSource();
  const remoteHistory = source?.kind === "remote" && state.sessionTimeFilter !== "realtime";
  els.sessionFilterNoticeText.textContent = remoteHistory
    ? "左侧正在显示远端历史索引，索引不含正文；中间仍是当前已打开正文。可清除筛选回到当前会话，或返回实时查看已同步快照。"
    : "左侧列表不再包含当前正文；清除搜索、类型和时间筛选后，可重新对齐左侧索引与中间正文。";
  els.clearSessionFiltersButton.title = "清除搜索和类型筛选，并切回当前会话所属时间分类";
  els.clearSessionFiltersButton.setAttribute("aria-label", els.clearSessionFiltersButton.title);
  const showRealtime = state.sessionTimeFilter !== "realtime";
  els.returnRealtimeButton.hidden = !showRealtime;
  els.returnRealtimeButton.title = "切回实时 <3h 分类";
  els.returnRealtimeButton.setAttribute("aria-label", els.returnRealtimeButton.title);
}

function markdownExportBlockedReason() {
  if (state.sessionLoading) return "正在读取目标会话，暂不能导出";
  if (state.sessionLoadError) return "目标会话读取失败，无法导出";
  if (state.healthLoadError) return "接口不可用，无法导出会话";
  if (state.sessionsLoadError && !state.detail?.session?.id) return "会话列表加载失败，未选择可导出会话";
  if (!state.detail?.session?.id) return "未选择可导出的会话";
  if (currentSessionFilteredOut()) return "当前会话已被筛选隐藏，清除搜索或筛选后可导出";
  return "";
}

function syncExportButtons() {
  const reason = markdownExportBlockedReason();
  const disabled = Boolean(reason);
  const copyLabel = disabled ? reason : "复制完整会话 Markdown";
  const downloadLabel = disabled ? reason : "下载完整会话 Markdown";
  els.copyMarkdownButton.disabled = disabled;
  els.downloadMarkdownButton.disabled = disabled;
  els.copyMarkdownButton.title = copyLabel;
  els.downloadMarkdownButton.title = downloadLabel;
  els.copyMarkdownButton.setAttribute("aria-label", copyLabel);
  els.downloadMarkdownButton.setAttribute("aria-label", downloadLabel);
  syncReviewMarkdownActionButtons(reason);
}

function syncReviewMarkdownActionButtons(reason = markdownExportBlockedReason()) {
  const disabled = Boolean(reason);
  els.inspectorActions?.querySelectorAll('[data-review-action-type="copy-markdown"]').forEach((button) => {
    button.disabled = disabled;
    button.title = disabled ? reason : "复制完整会话 Markdown";
  });
}

function selectedSessionDisplayTitle() {
  const title = state.pendingSessionTitle || findSessionSummary(state.selectedSessionId)?.displayTitle || state.selectedSessionId || "目标会话";
  return firstLine(title, 80);
}

function sessionPlaceholderState() {
  const target = selectedSessionDisplayTitle();
  const changing = changingSessionPlaceholder(target, state.detail);
  if (changing) return changing;
  if (state.healthLoadError && !state.detail?.session) return { title: "接口不可用", subtitle: state.healthLoadError };
  if (state.sessionLoading) return { title: "正在读取目标会话", subtitle: `${target} · 正在解析当前数据源中的 JSONL 事件流。` };
  if (state.sessionLoadError) return { title: "无法读取目标会话", subtitle: `${target} · ${state.sessionLoadError}` };
  if (state.sessionsLoadError && !state.detail?.session) {
    return { title: "会话列表加载失败", subtitle: `${selectedSource()?.label || "当前数据源"} · ${state.sessionsLoadError}。请确认服务仍在运行，或远端快照已成功拉取。` };
  }
  return null;
}

function changingSessionPlaceholder(target, detail) {
  const readState = detail?.readState;
  if (readState?.state !== "changing") return null;
  const fileSize = readState.fileSizeBytes ? `文件 ${formatBytes(readState.fileSizeBytes)}；` : "";
  return {
    title: "会话文件正在变化",
    subtitle: `${target} · ${fileSize}读取期间文件发生变化，未展示可能过期的内容。请重新读取会话。`,
  };
}

function renderSessionPlaceholder(title, subtitle) {
  const actions = [];
  if ((state.sessionLoadError || state.detail?.readState?.state === "changing") && state.selectedSessionId) actions.push('<button class="ghost-button" type="button" data-session-placeholder-action="retry-detail">重新读取会话</button>');
  const action = actions.length ? `<div class="empty-state-actions">${actions.join("")}</div>` : "";
  const html = emptyState(title, subtitle, action);
  [els.threadContent, els.compactContent, els.terminalContent, els.auditContent, els.statsContent, els.traceContent, els.rawContent]
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
  const isRemote = selectedSource()?.kind === "remote";
  if (isRemote) {
    if (bucket === "realtime") {
      return {
        title: "远端数据源：已同步到本机实时快照的最近 3 小时会话，可打开正文；拉取实时快照默认只补最近 3 小时",
        ariaLabel: "远端实时，小于 3 小时，已同步正文",
      };
    }
    const label = bucket === "day" ? "近一天" : "更早";
    return {
      title: `远端数据源：${label}为历史索引入口，只含标题、时间、路径等元数据，不含正文`,
      ariaLabel: `远端${label}，历史索引，不含正文`,
    };
  }
  if (bucket === "realtime") {
    return {
      title: "本机数据源：最近 3 小时内的本机会话，可直接打开正文",
      ariaLabel: "本机实时，小于 3 小时，可打开正文",
    };
  }
  if (bucket === "day") {
    return {
      title: "本机数据源：3 小时到 1 天内的本机会话，可直接打开正文",
      ariaLabel: "本机近一天，可打开正文",
    };
  }
  return {
    title: "本机数据源：1 天前或未知时间的本机会话，可直接打开正文",
    ariaLabel: "本机更早，可打开正文",
  };
}

function renderSessionDirectoryGroups(sessions, query) {
  return groupSessionsByDirectory(sessions)
    .map(
      (group) => `
        <section class="session-directory-group" role="group" aria-label="${escapeAttr(group.label)}">
          <div class="session-directory-head">
            <strong>${escapeHtml(group.label)}</strong>
            <span>${group.sessions.length}</span>
          </div>
          <div class="session-directory-list" role="list">
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
        label: session.cwd ? shortPath(session.cwd) : "无项目",
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
  const indexOnly = session.remoteIndexOnly ? " index-only" : "";
  const cwd = session.cwd ? shortPath(session.cwd) : "无项目";
  const agentName = session.agentNickname || "Codex";
  const agent = session.agentNickname ? `${session.agentNickname}/${session.agentRole || "agent"}` : "Codex";
  const source = session.remoteIndexOnly ? `${session.sourceLabel || selectedSource()?.label || ""} · 仅索引` : session.sourceLabel || selectedSource()?.label || "";
  const model = session.model || session.modelProvider || "未记录";
  const status = sessionStatusLabel(session.status);
  const indexLabel = session.remoteIndexOnly ? "仅索引/未同步正文" : "";
  const title = session.remoteIndexOnly ? remoteIndexOnlyMessage() : "";
  const displayTitle = session.displayTitle || "未命名会话";
  const truncation = session.titleTruncated ? "，标题已截断" : "";
  const ariaLabel = session.remoteIndexOnly
    ? `${displayTitle}${truncation}，仅索引，未同步正文，无法直接打开`
    : `${displayTitle}${truncation}${active ? "，当前会话" : ""}`;
  const rowSemantics = session.remoteIndexOnly
    ? 'role="listitem"'
    : `role="button" tabindex="0" ${active ? 'aria-current="true"' : ""}`;
  return `
    <div class="session-row${active}${indexOnly}" ${rowSemantics} data-session-id="${escapeAttr(session.id)}" data-evidence-id="${escapeAttr(sessionEvidenceId(session))}" data-remote-index-only="${session.remoteIndexOnly ? "true" : "false"}" ${title ? `title="${escapeAttr(title)}"` : ""} aria-label="${escapeAttr(ariaLabel)}">
      <span class="agent-dot" data-agent="${escapeAttr(agentName.toLowerCase())}" aria-hidden="true"></span>
      <span class="session-title markdown-inline-title">${renderMarkdownTitle(displayTitle, query)}</span>
      <span class="session-date">${formatShortDate(session.updatedAt || session.fileModifiedAt)}</span>
      <span class="session-meta">
        <span>${escapeHtml(agent)}</span>
        <span>${escapeHtml(model)}</span>
        ${indexLabel ? `<span>${escapeHtml(indexLabel)}</span>` : ""}
        ${status ? `<span>${escapeHtml(status)}</span>` : ""}
        <span>${escapeHtml(cwd)}</span>
      </span>
      <span class="session-source">${escapeHtml(source)}</span>
    </div>
  `;
}

function remoteIndexOnlyMessage() {
  return "这是远端历史索引结果，仅含标题、时间、路径等元数据，未同步正文。拉取远端实时快照默认只补最近 3 小时；历史正文需要远端扩大共享窗口或额外同步后再拉取，或切回已有本地快照查看已同步会话。";
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

function auditTurnEvidenceId(turn) {
  return buildEvidenceId({ ...evidenceScopeForSession(), threadPath: "root", turnNumber: turn.turnNumber, entity: "turn" });
}

function rawEventEvidenceId(event) {
  return buildEvidenceId({ ...evidenceScopeForSession(), threadPath: "root", eventIndex: event.index, entity: "event" });
}

function auditNodeEvidenceId(node) {
  return buildEvidenceId({
    ...evidenceScopeForSession(),
    threadPath: node.traceNodeId || "root",
    turnNumber: node.turnNumber,
    eventIndex: node.eventIndex ?? node.sourceIndex,
    nodeId: node.id,
    entity: "audit-node",
  });
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

function sessionListTimeMs(session) {
  for (const value of [session.updatedAt, session.fileModifiedAt, session.startedAt]) {
    if (!value) continue;
    const time = new Date(value).getTime();
    if (Number.isFinite(time)) return time;
  }
  return 0;
}

function renderThreadHeader() {
  if (state.sidebarMode === "prompts") {
    els.sessionTitle.textContent = "任务归档";
    els.sessionMetaLabel.textContent = `${selectedSource()?.label || "当前数据源"} · 只读派生索引`;
    renderSessionHandoff();
    return;
  }
  const session = state.detail?.session;
  if (!session) {
    const placeholder = sessionPlaceholderState();
    els.sessionTitle.textContent = placeholder?.title || "选择一个会话";
    els.sessionMetaLabel.textContent = placeholder?.subtitle ? firstLine(placeholder.subtitle, 96) : selectedSource()?.label || "未选择";
    renderSessionHandoff();
    return;
  }
  els.sessionTitle.innerHTML = renderMarkdownTitle(session.title || "未命名会话");
  const parts = [session.sourceLabel || selectedSource()?.label, session.model, session.reasoningEffort, formatDate(session.updatedAt)].filter(Boolean);
  els.sessionMetaLabel.textContent = parts.join(" · ") || session.id;
  renderSessionHandoff();
}

function renderStats() {
  if (state.sidebarMode === "prompts" || state.viewMode !== "diagnostic") {
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
  const rows = [
    ["事件", stats.eventCount, "事件流"],
    ["工具", countItems("tool-call"), "工具调用"],
    ["占用", tokenUsage ? compactNumber(tokenUsage.total_tokens || tokenUsage.totalTokens || 0) : "未记录", "上下文占用"],
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
  if (!detail || state.sidebarMode === "prompts") {
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
  els.sessionHandoff.querySelectorAll("[data-handoff-kind]").forEach((button) => {
    button.addEventListener("click", () => openHandoffFact(button.dataset.handoffKind, button.dataset.handoffNodeId || ""));
  });
}

function sessionHandoffFacts(detail) {
  const nodes = (detail.audit || buildAuditFallback(detail) || { nodes: [] }).nodes || [];
  const intent = nodes.find((node) => node.type === "intent");
  const final = [...nodes].reverse().find((node) => node.type === "final");
  const verification = nodes.filter((node) => node.type === "verification");
  const risks = nodes.filter((node) => node.type === "risk" || (node.riskLevel && node.riskLevel !== "none"));
  return [
    handoffFact("目标", handoffNodeText(intent, "未检测到明确目标"), intent, "intent"),
    handoffFact("当前状态", handoffSessionStatus(detail), null, "status"),
    handoffFact("结果", handoffNodeText(final, "尚无最终回复，可能仍待继续"), final, "final"),
    handoffFact("验证", handoffVerificationText(verification), verification[0], "verification"),
    handoffFact("风险 / 缺口", handoffRiskText(risks), risks[0], "risk"),
    handoffFact("改动范围", handoffChangeText(nodes), null, "changes"),
    handoffFact("子代理", handoffChildText(detail), null, "children"),
  ];
}


function handoffNodeText(node, fallback) {
  return auditNodeFullBody(node) || node?.summary || fallback;
}

function handoffSessionStatus(detail) {
  const latestTurn = detail.turns?.at(-1) || {};
  return sessionStatusLabel(latestTurn.status || detail.session?.status) || "状态未记录";
}

function handoffVerificationText(nodes) {
  return nodes.length ? `已检测到 ${nodes.length} 项验证` : "未检测到验证证据";
}

function handoffRiskText(nodes) {
  return nodes.length ? `${auditRiskLabel(highestRiskLevel(nodes))} · ${nodes.length} 项待复核` : "未检测到风险或缺口";
}

function handoffChangeText(nodes) {
  const files = nodes.flatMap((node) => readableAuditNode(node)?.changeSet?.files || []);
  const count = new Set(files.map((file) => file.path).filter(Boolean)).size;
  return count ? `${count} 个文件` : "未从现有派生数据检测到文件改动";
}

function handoffChildText(detail) {
  const count = detail.trace?.hierarchy?.children?.length || 0;
  return count ? `${count} 个子代理` : "未检测到子代理";
}

function handoffFact(label, value, node, kind) {
  return { label, value: firstLine(value, 180), nodeId: node?.id || "", kind };
}

function renderHandoffFact(fact, index) {
  const target = fact.nodeId ? ` data-handoff-node-id="${escapeAttr(fact.nodeId)}"` : "";
  const accessibleSummary = `${fact.label}：${fact.value}`;
  return `<button class="handoff-fact kind-${escapeAttr(fact.kind)}" type="button" data-handoff-kind="${escapeAttr(fact.kind)}"${target} title="${escapeAttr(accessibleSummary)}" aria-label="${escapeAttr(accessibleSummary)}">
    <span class="handoff-index" aria-hidden="true">${index}</span>
    <span class="handoff-copy"><strong>${escapeHtml(fact.label)}</strong><em>${escapeHtml(fact.value)}</em></span>
  </button>`;
}

function openHandoffFact(kind, nodeId) {
  const node = nodeId ? findAuditNode(nodeId) : null;
  if (node) {
    setViewMode("audit");
    selectAuditNode(node.id);
    return;
  }
  if (kind === "intent" || kind === "status") {
    if (state.viewMode !== "compact") setViewMode("compact");
    const targetId = els.compactContent?.querySelector("[data-compact-nav-target]")?.dataset.compactNavTarget;
    if (targetId) scrollToCompactTarget(targetId);
    return;
  }
  if (kind === "children") {
    setViewMode("audit");
    return;
  }
  showToast("当前会话没有可跳转的对应证据");
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
}

function renderTimingView(timing) {
  if (!timing?.session) return `<section class="timing-empty"><strong>暂无会话时间数据</strong><span>当前会话尚未生成可用的时间区间。</span></section>`;
  const session = timing.session;
  const buckets = (timing.buckets || []).filter((bucket) => bucket.coverageMs > 0 || bucket.count > 0);
  const max = Math.max(1, ...buckets.map((bucket) => bucket.coverageMs || 0));
  const quality = timing.quality || {};
  return `
    <section class="timing-section" aria-labelledby="timingHeading">
      <div class="timing-heading"><div><p class="eyebrow">时间投入</p><h3 id="timingHeading">会话时间花在哪里</h3></div><span class="timing-confidence">${escapeHtml(timingKindLabel(session.durationKind))}</span></div>
      <div class="timing-metrics" aria-label="会话时间概览">
        ${renderStatsMetric("总墙钟时长", formatTimingDuration(session.durationMs), "完整会话口径")}
        ${renderStatsMetric("可解释执行", formatTimingDuration(session.coverageMs), "时间区间覆盖")}
        ${renderStatsMetric("时间覆盖率", `${session.coveragePercent || 0}%`, "执行覆盖 / 总时长")}
        ${renderStatsMetric("并行峰值", `${session.parallelism?.peak || 0} 路`, formatTimingDuration(session.parallelism?.overlapMs, "重叠"))}
      </div>
      <p class="timing-note">分类按时间区间覆盖计算。并行执行会产生重叠，分类时长总和可以大于总墙钟时长。</p>
      <div class="timing-buckets" aria-label="时间投入分类">
        ${buckets.length ? buckets.map((bucket) => {
          const refs = bucket.nodeRefs || [];
          const groups = bucket.groups || [];
          const firstRef = refs[0] || {};
          const bar = Math.max(2, Math.round(((bucket.coverageMs || 0) / max) * 100));
          const details = groups.length > 0 ? renderTimingGroups(groups) : "";
          return `<div class="timing-bucket-wrap"><button class="timing-bucket timing-${escapeAttr(bucket.id)}" type="button" data-timing-node-id="${escapeAttr(firstRef.traceNodeId || "")}" data-timing-event-index="${escapeAttr(firstRef.eventIndex ?? "")}" aria-label="${escapeAttr(`${bucket.label}，${formatTimingDuration(bucket.coverageMs)}，${bucket.sharePercent}%`)}"><span class="timing-bucket-main"><strong>${escapeHtml(bucket.label)}</strong><em>${escapeHtml(`${formatTimingDuration(bucket.coverageMs)} · ${bucket.sharePercent}% · ${bucket.count} ${bucket.id === "unattributed" ? "个区间" : bucket.id === "llm_response" ? "个响应区间" : "次调用"}`)}</em></span><span class="timing-bar" aria-hidden="true"><i style="width:${bar}%"></i></span><span class="timing-bucket-status">${escapeHtml(timingKindLabel(bucket.confidence))}${bucket.overlapMs ? ` · 重叠 ${escapeHtml(formatTimingDuration(bucket.overlapMs))}` : ""}</span></button>${details}</div>`;
        }).join("") : `<div class="timing-empty"><strong>暂无可解释时间区间</strong><span>会话事件中尚未发现可关联的起止时间。</span></div>`}
      </div>
      ${renderTimingTurns(timing.turns)}
      <div class="timing-quality"><strong>时间数据质量</strong><span>估算 ${quality.estimatedCount || 0} 项 · 缺少开始 ${quality.missingStartCount || 0} 项 · 缺少结束 ${quality.missingEndCount || 0} 项 · 未关联 ${quality.unlinkedCount || 0} 项</span></div>
    </section>
  `;
}

function renderTimingTurns(turns = []) {
  if (!turns.length) return "";
  return `<div class="timing-turns"><h4>按轮次查看</h4>${turns.map((turn) => `<div class="timing-turn"><div class="timing-turn-head"><strong>第 ${turn.turnNumber} 轮</strong><span>${escapeHtml(formatTimingDuration(turn.durationMs))} · ${escapeHtml(timingKindLabel(turn.confidence))}</span></div><div class="timing-turn-bars">${(turn.buckets || []).map((bucket) => `<span class="timing-turn-bar timing-${escapeAttr(bucket.id)}" style="--bar:${Math.max(3, Math.min(100, bucket.sharePercent || 0))}%" title="${escapeAttr(`${bucket.label} ${formatTimingDuration(bucket.coverageMs)}`)}"><i></i></span>`).join("")}</div></div>`).join("")}</div>`;
}

function renderTimingGroups(groups) {
  return `<div class="timing-detail-list">${groups.slice(0, 8).map((group) => {
    const ref = group.refs[0] || {};
    const failed = group.failedCount ? ` · 失败 ${group.failedCount}` : "";
    const incomplete = group.incompleteCount ? ` · 未完成 ${group.incompleteCount}` : "";
    const gap = ref.actionable === false;
    const context = timingContextLabel(ref.contextUsage);
    const value = `${formatTimingDuration(group.coverageMs)} · 平均 ${formatTimingDuration(group.averageDurationMs)} · 最长 ${formatTimingDuration(group.maxDurationMs)}${context ? ` · ${context}` : ""}${failed}${incomplete}${gap ? " · 无原始事件" : ""}`;
    const content = `<strong>${escapeHtml(group.label)} <small>${group.count} 次</small></strong><span>${escapeHtml(value)}</span>`;
    return gap ? `<div class="timing-detail-row timing-gap-row">${content}</div>` : `<button class="timing-detail-row" type="button" data-timing-node-id="${escapeAttr(ref.traceNodeId || "")}" data-timing-event-index="${escapeAttr(ref.eventIndex ?? "")}">${content}</button>`;
  }).join("")}${groups.length > 8 ? `<span class="timing-more">还有 ${groups.length - 8} 个时间区间</span>` : ""}</div>`;
}

function timingContextLabel(usage) {
  if (!usage) return "";
  const used = usage.used != null ? compactNumber(usage.used) : "?";
  const limit = usage.limit != null ? compactNumber(usage.limit) : "?";
  const percent = usage.percent != null ? ` (${usage.percent}%)` : "";
  return `context ${used} / ${limit}${percent}`;
}

function timingKindLabel(kind) {
  return { observed: "实测", mixed: "混合", estimated: "估算", partial: "部分区间", unavailable: "未记录" }[kind] || "未记录";
}

function formatTimingDuration(ms, prefix = "") {
  if (ms == null) return "未记录";
  return `${prefix ? `${prefix} ` : ""}${formatDuration(ms)}`;
}

function bindTimingActions() {
  els.statsContent.querySelectorAll("[data-timing-node-id]").forEach((button) => button.addEventListener("click", () => {
    const nodeId = button.dataset.timingNodeId;
    const eventIndex = button.dataset.timingEventIndex;
    if (nodeId) {
      setViewMode("audit");
      selectAuditNode(nodeId);
    } else if (eventIndex !== "") openRawEventFromAudit(Number(eventIndex));
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
        <strong>${highlight(escapeHtml(stat.label), query)}</strong>
        <em>${highlight(escapeHtml(stat.kind), query)}</em>
      </span>
      <span role="cell"><strong>${escapeHtml(String(stat.count))}</strong></span>
      <span role="cell">${escapeHtml(`约 ${compactNumber(stat.approxTokens)}`)}</span>
      <span role="cell">${escapeHtml(`约 ${compactNumber(average)}`)}</span>
      <span class="stats-event-share" role="cell">
        <i aria-hidden="true"></i>
        <em>${escapeHtml(`${percent}%`)}</em>
      </span>
      <span role="cell">${escapeHtml(formatBytes(stat.approxBytes))}</span>
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
    syncExportButtons();
    return;
  }
  if (state.sidebarMode === "prompts") {
    els.statusSource.textContent = `数据源：${source?.label || source?.id || "未选择"} · 任务归档`;
    const page = state.promptArchivePage || {};
    els.statusSession.textContent = state.promptArchiveLoading ? "正在整理当前批首个任务提示词" : "首个任务提示词只读归档";
    els.statusEvents.textContent = `${promptArchiveRangeLabel(page)} · 本批 ${state.promptArchive.length || 0} 条归档`;
    els.statusUpdated.textContent = state.promptArchiveCancelled
      ? "归档读取已取消，可重新整理"
      : state.promptArchiveError
        ? "归档读取失败，可重试"
        : page.hasMoreCandidates ? "更早候选尚未扫描，可继续定位" : "已扫描到当前时间范围最早任务";
    syncExportButtons();
    return;
  }
  const sourceKind = source?.kind === "remote" ? "远端快照" : "本机只读";
  const sourceLabelText = source?.label || source?.id || "未选择";
  els.statusSource.textContent = `数据源：${sourceLabelText} · ${sourceKind}`;
  if (state.sessionLoading) {
    els.statusSession.textContent = `正在读取：${selectedSessionDisplayTitle()}`;
  } else if (state.sessionLoadError) {
    els.statusSession.textContent = `读取失败：${selectedSessionDisplayTitle()}`;
  } else if (state.sessionsLoadError && !session) {
    els.statusSession.textContent = "会话列表加载失败";
  } else if (filteredOut) {
    els.statusSession.textContent = "当前会话已被筛选隐藏";
  } else {
    els.statusSession.textContent = session ? `当前：${selectedSessionDisplayTitle()}` : "未选择会话";
  }
  if (isRemoteHistoryIndexMode()) {
    if (state.remoteIndexLoading) {
      els.statusEvents.textContent = "正在检索远端历史索引";
    } else if (state.remoteIndexError) {
      els.statusEvents.textContent = `历史索引失败：${state.remoteIndexError}`;
    } else {
      const page = state.remoteIndexPage?.page;
      const total = page ? Math.max(0, Number(page.total) || 0) : 0;
      const pageLabel = state.remoteIndexPage ? `第 ${state.remoteIndexPage.pageNumber} 页` : "未加载";
      els.statusEvents.textContent = `历史索引 ${total} 条 · ${pageLabel} · 正文未同步`;
    }
  } else {
    els.statusEvents.textContent = `${state.filteredSessions.length || 0}/${state.sessions.length || 0} 个会话`;
  }
  const updated = session?.updatedAt || session?.fileModifiedAt || session?.startedAt;
  if (filteredOut) {
    els.statusUpdated.textContent = "清除搜索或筛选后可复制/下载";
  } else if (state.sessionsLoadError && !session) {
    els.statusUpdated.textContent = "刷新列表或检查数据源后再导出";
  } else {
    els.statusUpdated.textContent = stats
      ? `${stats.eventCount || 0} 个事件 · ${stats.turnCount || 0} 轮次 · ${formatDate(updated) || "未知时间"}`
      : "只读浏览";
  }
  syncExportButtons();
}

function syncStatusbarDataStatus(source = selectedSource()) {
  if (!els.statusbar) return;
  const status = source?.status || {};
  let value = source?.kind === "remote" ? "remote" : "local";
  let label = source?.kind === "remote" ? "远端快照" : "本机只读";
  if (state.healthLoadError) {
    value = "error";
    label = "接口不可用";
  } else if (state.sessionsLoading || state.sessionLoading || state.remoteIndexLoading || state.promptArchiveLoading || state.remoteRefreshLoading || status.refreshing) {
    value = "loading";
    label = "加载中";
  } else if (state.sessionsLoadError || state.sessionLoadError || state.remoteIndexError || state.promptArchiveError || state.remoteRefreshError || status.error?.message) {
    value = "error";
    label = "错误";
  } else if (source?.kind === "remote" && status.stale) {
    value = "stale";
    label = "旧远端快照";
  }
  els.statusbar.dataset.status = value;
  els.statusbar.title = `数据状态：${label}`;
}

function renderMainContent() {
  if (state.sidebarMode === "prompts") {
    els.promptArchiveContent.hidden = false;
    renderPromptArchive();
    [els.threadContent, els.compactContent, els.terminalContent, els.auditContent, els.diagnosticContent, els.statsContent, els.traceContent, els.rawContent].forEach((container) => {
      if (container) container.hidden = true;
    });
    renderInspector();
    return;
  }
  els.promptArchiveContent.hidden = true;
  syncViewControls();
  const placeholder = sessionPlaceholderState();
  if (placeholder) {
    renderSessionPlaceholder(placeholder.title, placeholder.subtitle);
    renderInspector();
    return;
  }
  if (state.viewMode === "diagnostic") {
    if (state.diagnosticMode === "raw") renderRawView();
    else renderStatsInfoView();
  } else if (state.viewMode === "audit") {
    renderAudit();
  } else {
    renderCompact();
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
    els.compactContent.innerHTML = emptyState("没有匹配的阅读内容", "阅读视图包含用户输入、全部助手消息和子代理层级。");
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
  els.compactContent.querySelectorAll("[data-compact-event-index]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const index = Number(button.dataset.compactEventIndex);
      if (!Number.isFinite(index)) return;
      await openRawEventFromAudit(index);
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
  const hasMessage = turn.userMessages?.length || compactAssistantMessages(turn).length;
  const hasChild = turn.children?.length;
  const hasCompact = compactEventsForTurn(turn).length > 0;
  if (typeFilter === "tool") return Boolean(hasChild);
  if (typeFilter === "compact") return hasCompact && (!query || compactTurnSearchText(turn).includes(query));
  if (typeFilter === "system") return hasCompact && (!query || compactTurnSearchText(turn).includes(query));
  if (!["all", "message", "error"].includes(typeFilter)) return false;
  if (typeFilter === "message" && !hasMessage) return false;
  const haystack = compactTurnSearchText(turn);
  if (typeFilter === "error" && !/error|failed|失败|错误/i.test(haystack)) return false;
  return !query || haystack.includes(query);
}

function compactNodeMatchesType(node, typeFilter) {
  if (typeFilter === "all") return true;
  if (typeFilter === "message") return Boolean(node.turns?.some((turn) => turn.userMessages?.length || compactAssistantMessages(turn).length));
  if (typeFilter === "tool") return !node.session || Boolean(node.edgeStatus || node.spawnEvent || node.notificationEvent);
  if (typeFilter === "compact") return Boolean(node.turns?.some((turn) => compactEventsForTurn(turn).length > 0));
  if (typeFilter === "system") return Boolean(node.turns?.some((turn) => compactEventsForTurn(turn).length > 0));
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
    ...compactEventsForTurn(turn).flatMap((event) => [
      event.eventType,
      event.text,
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
    ]),
    ...(turn.children || []).map(compactSearchText),
  ];
  return parts.filter(Boolean).join(" ").toLowerCase();
}

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
      ${children}
    </div>
  `;
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
  const compactEvents = compactEventsForTurn(turn)
    .map((event, index) => renderCompactContextEvent(event, context.query, `${path}-compact-${index}`))
    .join("");
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
      ${compactEvents ? `<div class="compact-system-group">${compactEvents}</div>` : ""}
      ${children ? `<div class="compact-child-group">${children}</div>` : ""}
    </section>
  `;
}

function compactEventsForTurn(turn) {
  return Array.isArray(turn?.compactEvents) ? turn.compactEvents : (turn?.items || []).filter((item) => item.type === "context-compact");
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
  const compact = event.compact || {};
  const eventPath = path || `event-${event.sourceIndex ?? event.id ?? "compact"}`;
  const targetId = compactElementId("event", eventPath);
  const sourceAttr = event.sourceIndex != null ? ` data-compact-source-index="${escapeAttr(String(event.sourceIndex))}"` : "";
  const isSummary = compact.kind === "compacted" || event.eventType === "compacted";
  const label = isSummary ? "上下文压缩摘要" : "上下文压缩完成";
  const meta = [
    formatDate(event.timestamp),
    compact.windowNumber != null ? `窗口 ${compact.windowNumber}` : "",
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
  state.selectedAuditNodeId = null;
  state.selectedAuditTurnKey = null;
  state.selectedEventIndex = null;
  state.selectedItemRef = block.itemRef || null;
  renderInspector();
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

function renderAudit() {
  const detail = state.detail;
  if (!detail) {
    els.auditContent.innerHTML = emptyState("选择一个会话", "审计链视图按轮次聚合目标、执行链、证据、验证、风险和最终回复。");
    return;
  }
  const model = buildAuditTurnModel(detail);
  const nodes = model.auditNodes;
  if (nodes.length === 0 && model.turns.length === 0) {
    els.auditContent.innerHTML = emptyState("当前没有可展示审计链节点", "审计链依赖用户消息、工具调用、工具输出、验证动作和最终回复。");
    return;
  }
  const query = els.itemSearch.value.trim().toLowerCase();
  const typeFilter = els.itemTypeFilter.value;
  const filters = { query, typeFilter };
  const filteredTurns = model.turns.map((turn) => filterAuditTurnModel(turn, filters)).filter(Boolean);
  const filteredUnplaced = model.unplacedAuditNodes.filter((node) => auditNodeMatches(node, query, typeFilter));
  const filteredCounts = auditNodeCounts(nodes.filter((node) => auditNodeMatches(node, query, typeFilter)));
  const counts = model.counts;
  model.filteredTurnCount = filteredTurns.length;
  const hasVisibleContent = filteredTurns.length > 0 || filteredUnplaced.length > 0;
  if (!hasVisibleContent) {
    els.auditContent.innerHTML = `
      <div class="audit-shell">
        ${renderAuditHead(model, counts, filteredCounts, { query, typeFilter })}
        ${emptyState("没有匹配的轮次审计单元", "调整内容搜索或类型过滤；审计链会保留轮次上下文，不显示孤立风险列表。")}
      </div>
    `;
    bindAuditInteractions();
    return;
  }
  els.auditContent.innerHTML = `
    <div class="audit-shell">
      ${renderAuditHead(model, counts, filteredCounts, { query, typeFilter })}
      ${
        state.auditMinimalMode
          ? renderAuditMinimalTimeline(filteredTurns, filteredUnplaced, { query, typeFilter, filtersActive: auditFiltersActive(filters) })
          : `<div class="audit-turn-list" role="list">
              ${filteredTurns.map((turn) => renderAuditTurn(turn, { query, filtersActive: auditFiltersActive(filters) })).join("")}
              ${filteredUnplaced.length ? renderAuditUnplacedSection(filteredUnplaced, query) : ""}
            </div>`
      }
    </div>
  `;
  bindAuditInteractions();
}

function renderAuditHead(model, counts, filteredCounts, filters = {}) {
  const filtered = Boolean(filters.query || (filters.typeFilter && filters.typeFilter !== "all"));
  const metrics = [
    ["turn", "轮次", model.turns.length, model.filteredTurnCount ?? 0],
    ["intent", "意图", counts.intent || 0, filteredCounts.intent || 0],
    ["reasoning", "推理", counts.reasoning || 0, filteredCounts.reasoning || 0],
    ["action", "行动", counts.action || 0, filteredCounts.action || 0],
    ["evidence", "证据", counts.evidence || 0, filteredCounts.evidence || 0],
    ["verification", "验证", counts.verification || 0, filteredCounts.verification || 0],
    ["risk", "风险信号", counts.risk || 0, filteredCounts.risk || 0],
    ["final", "最终回复", counts.final || 0, filteredCounts.final || 0],
  ];
  return `
    <div class="audit-head">
      <div>
        <p class="eyebrow">轮次审计链</p>
        <h3 class="markdown-inline-title">${renderMarkdownTitle(model.detail.session?.title || "当前会话")}</h3>
        <div class="audit-head-note">
          ${model.hasTraceRoot ? "以 trace.root 投影执行链" : "缺少 trace.root，按轮次项目提供有限执行复核"}
          ${model.unplacedAuditNodes.length ? ` · ${model.unplacedAuditNodes.length} 个节点未关联` : ""}
        </div>
      </div>
      <div class="audit-head-tools">
        <button class="ghost-button small audit-minimal-toggle${state.auditMinimalMode ? " active" : ""}" type="button" data-audit-minimal-toggle aria-pressed="${state.auditMinimalMode ? "true" : "false"}" title="${state.auditMinimalMode ? "关闭极简时间线" : "开启极简时间线"}">
          ${state.auditMinimalMode ? "标准模式" : "极简模式"}
        </button>
        <div class="audit-summary" aria-label="审计链概览">
          ${metrics
            .map(
              ([type, label, total, active]) => `
                <div class="audit-summary-item type-${escapeAttr(type)}" title="${escapeAttr(filtered ? `显示 ${active} / 全部 ${total}` : `全部 ${total}`)}">
                  <span>${escapeHtml(label)}</span>
                  <strong>${escapeHtml(filtered ? `显示 ${active} / 全部 ${total}` : String(total))}</strong>
                </div>
              `,
            )
            .join("")}
        </div>
      </div>
    </div>
  `;
}

function renderAuditMinimalTimeline(turns, unplacedNodes, context = {}) {
  const turnHtml = (turns || []).map((turn) => renderAuditMinimalTurn(turn, context)).filter(Boolean).join("");
  const unplacedHtml = unplacedNodes?.length ? renderAuditMinimalUnplaced(unplacedNodes, context) : "";
  return `
    <div class="audit-minimal-shell">
      ${renderAuditMinimalLegend()}
      <div class="audit-minimal-list" role="list" aria-label="审计链极简纵向上下文占用条">
        ${turnHtml || (!unplacedHtml ? `<div class="audit-section-empty">当前筛选下没有可展示的操作条。</div>` : "")}
        ${unplacedHtml}
      </div>
    </div>
  `;
}

function renderAuditMinimalTurn(turn, context = {}) {
  const entries = auditMinimalLayoutEntries(auditMinimalEntriesForTurn(turn, context));
  if (!entries.length) return "";
  const totalTokens = entries.reduce((sum, entry) => sum + entry.tokenAmount, 0);
  const usageLabel = auditMinimalTurnUsageLabel(entries);
  const trackHeight = auditMinimalTrackHeight(entries);
  return `
    <section class="audit-minimal-turn" role="listitem" style="--track-height:${escapeAttr(String(trackHeight))}px">
      <div class="audit-minimal-turn-head">
        <strong>第 ${escapeHtml(String(turn.turnNumber))} 轮</strong>
        <span>${escapeHtml(`${entries.length} 操作 · 约 ${compactNumber(totalTokens)} tok`)}</span>
        <em>${escapeHtml(usageLabel)}</em>
      </div>
      <div class="audit-minimal-column">
        <div class="audit-minimal-axis" aria-hidden="true">
          <span>100%</span>
          <span>50%</span>
          <span>0%</span>
        </div>
        <div class="audit-minimal-track" aria-label="${escapeAttr(`第 ${turn.turnNumber} 轮上下文占用条`)}">
          ${entries.map((entry) => renderAuditMinimalEntry(entry)).join("")}
        </div>
      </div>
      ${renderAuditMinimalSidePanel({ turn, entries, totalTokens, usageLabel, context })}
    </section>
  `;
}

function renderAuditMinimalUnplaced(nodes, context = {}) {
  const entries = auditMinimalLayoutEntries((nodes || [])
    .map((node) => auditMinimalEntryFromNode(node, null))
    .sort((left, right) => left.sort - right.sort));
  const trackHeight = auditMinimalTrackHeight(entries);
  return `
    <section class="audit-minimal-turn unplaced" role="listitem" style="--track-height:${escapeAttr(String(trackHeight))}px">
      <div class="audit-minimal-turn-head">
        <strong>未定位</strong>
        <span>${escapeHtml(`${entries.length} 操作`)}</span>
        <em>无轮次上下文</em>
      </div>
      <div class="audit-minimal-column">
        <div class="audit-minimal-axis" aria-hidden="true">
          <span>100%</span>
          <span>50%</span>
          <span>0%</span>
        </div>
        <div class="audit-minimal-track" aria-label="未定位操作占用条">
          ${entries.map((entry) => renderAuditMinimalEntry(entry)).join("")}
        </div>
      </div>
      ${renderAuditMinimalSidePanel({ turn: null, entries, totalTokens: entries.reduce((sum, entry) => sum + entry.tokenAmount, 0), usageLabel: "无轮次上下文", context, unplaced: true })}
    </section>
  `;
}

function renderAuditMinimalSidePanel({ turn, entries = [], totalTokens = 0, usageLabel = "", context = {}, unplaced = false } = {}) {
  const selectedEntry = auditMinimalSelectedEntry(entries);
  if (selectedEntry) return renderAuditMinimalEntryDetail(selectedEntry, { turn, usageLabel, context, unplaced });
  return renderAuditMinimalTurnSummary({ turn, entries, totalTokens, usageLabel, context, unplaced });
}

function auditMinimalSelectedEntry(entries = []) {
  return entries.find(auditMinimalEntryIsSelected) || null;
}

function auditMinimalEntryIsSelected(entry) {
  if (!entry) return false;
  if (entry.kind === "node") return state.selectedAuditNodeId === entry.id;
  if (entry.row && auditExecutionRowIsSelected(entry.row)) return true;
  if (entry.row?.auditNodes?.some((node) => node.id === state.selectedAuditNodeId)) return true;
  return false;
}

function renderAuditMinimalTurnSummary({ turn, entries = [], totalTokens = 0, usageLabel = "", unplaced = false } = {}) {
  const stats = turn?.stats || {};
  const riskNodes = turn?.auditNodes?.filter((node) => node.type === "risk" || (node.riskLevel && node.riskLevel !== "none")) || [];
  const gapCount = Number(stats.gapCount) || riskNodes.filter(auditNodeIsGap).length;
  const subagentCount = Number(stats.subagentCount) || entries.filter((entry) => entry.type === "subagent" || entry.type === "lazy-child").length;
  const verification = stats.verificationStatus || (unplaced ? "未定位" : "未验证");
  const riskLabel = stats.riskLabel || (riskNodes.length ? `${auditRiskLabel(highestRiskLevel(riskNodes))} · ${riskNodes.length}` : "无风险信号");
  const signals = [
    riskNodes.length ? { label: riskLabel, type: "risk" } : null,
    gapCount ? { label: `缺口 ${gapCount}`, type: "gap" } : null,
    verification && verification !== "已验证" ? { label: verification, type: "verification" } : null,
    subagentCount ? { label: `子代理 ${subagentCount}`, type: "subagent" } : null,
  ].filter(Boolean);
  return `
    <aside class="audit-minimal-side" aria-label="${escapeAttr(unplaced ? "未定位操作摘要" : `第 ${turn?.turnNumber ?? ""} 轮摘要`)}">
      <div class="audit-minimal-side-head">
        <strong>${escapeHtml(unplaced ? "未定位摘要" : "轮次摘要")}</strong>
        <span>${escapeHtml(usageLabel || "上下文未记录")}</span>
      </div>
      <div class="audit-minimal-kpis" aria-label="轮次极简指标">
        ${renderAuditMinimalKpi("操作", entries.length)}
        ${renderAuditMinimalKpi("约 token", `${compactNumber(totalTokens)} tok`)}
        ${renderAuditMinimalKpi("风险", riskLabel)}
        ${renderAuditMinimalKpi("验证", verification)}
      </div>
      ${renderAuditMinimalTypeDistribution(entries)}
      ${
        signals.length
          ? `<div class="audit-minimal-signals">${signals
              .slice(0, 5)
              .map((signal) => `<span class="type-${escapeAttr(signal.type)}">${escapeHtml(signal.label)}</span>`)
              .join("")}</div>`
          : `<div class="audit-minimal-muted">没有优先风险或缺口信号。</div>`
      }
    </aside>
  `;
}

function renderAuditMinimalKpi(label, value) {
  return `
    <span class="audit-minimal-kpi">
      <em>${escapeHtml(label)}</em>
      <strong>${escapeHtml(String(value ?? "未记录"))}</strong>
    </span>
  `;
}

function renderAuditMinimalTypeDistribution(entries = []) {
  const totals = auditMinimalTypeTokenTotals(entries);
  if (!totals.length) return "";
  const total = totals.reduce((sum, entry) => sum + entry.tokens, 0) || 1;
  const shown = totals.slice(0, 6);
  return `
    <div class="audit-minimal-distribution" aria-label="操作类型 token 分布">
      <div class="audit-minimal-type-bar" aria-hidden="true">
        ${shown
          .map((entry) => `<span class="type-${escapeAttr(entry.type)}" style="--share:${escapeAttr(String(Math.max(2, Math.round((entry.tokens / total) * 100))))}"></span>`)
          .join("")}
      </div>
      <div class="audit-minimal-type-list">
        ${shown
          .map(
            (entry) => `
              <span class="type-${escapeAttr(entry.type)}">
                <i aria-hidden="true"></i>
                <strong>${escapeHtml(auditMinimalTypeLabel(entry.type))}</strong>
                <em>${escapeHtml(`${entry.count} 次 · ${compactNumber(entry.tokens)} tok`)}</em>
              </span>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
}

function auditMinimalTypeTokenTotals(entries = []) {
  const totals = new Map();
  for (const entry of entries) {
    const type = entry.type || "action";
    const current = totals.get(type) || { type, count: 0, tokens: 0 };
    current.count += 1;
    current.tokens += Math.max(1, Number(entry.tokenAmount) || 1);
    totals.set(type, current);
  }
  return [...totals.values()].sort((left, right) => right.tokens - left.tokens || right.count - left.count || auditMinimalTypeLabel(left.type).localeCompare(auditMinimalTypeLabel(right.type)));
}

function renderAuditMinimalEntryDetail(entry, { turn, unplaced = false } = {}) {
  const detail = auditMinimalEntryDetail(entry, turn);
  const rows = [
    ["类型", auditMinimalTypeLabel(entry.type)],
    ["约 token", `${compactNumber(entry.tokenAmount || 0)} tok`],
    ["上下文", detail.usageLabel],
    ["状态", detail.status || "未记录"],
    ["来源", detail.source || (unplaced ? "未定位" : turn ? `第 ${turn.turnNumber} 轮` : "未记录")],
  ];
  return `
    <aside class="audit-minimal-side selected type-${escapeAttr(entry.type)}" aria-label="选中操作详情">
      <div class="audit-minimal-side-head">
        <strong>选中操作</strong>
        <span>${escapeHtml(detail.kindLabel)}</span>
      </div>
      <div class="audit-minimal-detail-title">
        <i aria-hidden="true"></i>
        <strong>${escapeHtml(firstLine(detail.title || detail.kindLabel, 90))}</strong>
      </div>
      ${detail.summary ? `<p class="audit-minimal-detail-summary">${escapeHtml(firstLine(detail.summary, 180))}</p>` : ""}
      <div class="audit-minimal-detail-rows">
        ${rows
          .map(
            ([label, value]) => `
              <span>
                <em>${escapeHtml(label)}</em>
                <strong>${escapeHtml(value || "未记录")}</strong>
              </span>
            `,
          )
          .join("")}
      </div>
      ${detail.badges.length ? `<div class="audit-minimal-signals">${detail.badges.slice(0, 5).map((badge) => `<span>${escapeHtml(badge)}</span>`).join("")}</div>` : ""}
    </aside>
  `;
}

function auditMinimalEntryDetail(entry, turn) {
  const percent = contextUsagePercent(entry.contextUsage);
  const usageLabel = Number.isFinite(percent) ? `上下文 ${percent}%` : "上下文占用未记录";
  if (entry.kind === "node") {
    const node = entry.node || findAuditNode(entry.id);
    const item = node?.itemRef ? findItemByRef(node.itemRef) : null;
    const readable = node ? readableAuditNode(node, item) : {};
    return {
      kindLabel: "审计节点",
      title: readable.title || node?.title || auditMinimalTypeLabel(entry.type),
      summary: readable.summary || node?.summary || "",
      status: node?.status || "",
      source: auditEventIndexLabel(node) || (node?.turnNumber ? `第 ${node.turnNumber} 轮` : ""),
      usageLabel,
      badges: [node?.riskLevel && node.riskLevel !== "none" ? auditRiskLabel(node.riskLevel) : "", node?.toolName ? `工具 ${node.toolName}` : ""].filter(Boolean),
    };
  }
  const row = entry.row || findAuditExecutionRow(entry.id);
  const readable = row ? readableExecutionRow(row) : {};
  const riskLevel = highestRiskLevel(row?.auditNodes || []);
  return {
    kindLabel: "执行节点",
    title: readable.title || row?.title || row?.label || auditMinimalTypeLabel(entry.type),
    summary: readable.summary || row?.subtitle || "",
    status: row?.status || "",
    source: [row?.itemRef ? "关联项" : "", row?.traceNodeId ? "执行链" : "", turn?.turnNumber ? `第 ${turn.turnNumber} 轮` : ""].filter(Boolean).join(" · "),
    usageLabel,
    badges: [
      riskLevel !== "none" ? auditRiskLabel(riskLevel) : "",
      row?.auditNodes?.some((node) => node.type === "verification") ? "包含验证" : "",
      row?.auditNodes?.length ? `${row.auditNodes.length} 个审计节点` : "",
    ].filter(Boolean),
  };
}

function auditMinimalEntriesForTurn(turn, context = {}) {
  const filtersActive = Boolean(context.filtersActive);
  const typeFilter = context.typeFilter || "all";
  const query = context.query || "";
  const nodes = filtersActive ? turn.auditNodes.filter((node) => auditNodeMatches(node, query, typeFilter)) : turn.auditNodes;
  const rows = filtersActive ? turn.visibleExecutionRows || [] : turn.executionRows || turn.visibleExecutionRows || [];
  const rowNodeIds = new Set(rows.flatMap((row) => (row.auditNodes || []).map((node) => node.id)));
  const entries = rows.map((row, index) => auditMinimalEntryFromRow(row, turn, index));
  const unmountedNodes = nodes.filter((node) => !rowNodeIds.has(node.id));
  entries.push(...unmountedNodes.map((node, index) => auditMinimalEntryFromNode(node, turn, rows.length + index)));
  if (!entries.length) entries.push(...nodes.map((node, index) => auditMinimalEntryFromNode(node, turn, index)));
  return entries.sort((left, right) => left.sort - right.sort || left.order - right.order || left.label.localeCompare(right.label));
}

function auditMinimalEntryFromNode(node, turn, order = 0) {
  const usage = auditMinimalContextUsageForNode(node, turn);
  const item = node?.itemRef ? findItemByRef(node.itemRef) : null;
  const tokenAmount = auditMinimalTokenAmountForNode(node, item, usage);
  return {
    kind: "node",
    id: node.id,
    type: node.type || "node",
    label: auditTypeLabel(node.type),
    sort: auditMinimalSortValue(node),
    order,
    node,
    contextUsage: usage,
    tokenAmount,
    tokenEstimated: true,
  };
}

function auditMinimalEntryFromRow(row, turn, order = 0) {
  const usage = auditMinimalContextUsageForRow(row, turn);
  const type = auditMinimalTypeForRow(row);
  const tokenAmount = auditMinimalTokenAmountForRow(row, usage);
  return {
    kind: "row",
    id: row.id,
    type,
    label: auditMinimalLabelForRow(row, type),
    sort: auditMinimalSortValue(row),
    order,
    row,
    contextUsage: usage,
    tokenAmount,
    tokenEstimated: true,
  };
}

function renderAuditMinimalEntry(entry) {
  const selected = auditMinimalEntryIsSelected(entry);
  const percent = contextUsagePercent(entry.contextUsage);
  const usageLabel = Number.isFinite(percent) ? `上下文 ${percent}%` : "上下文占用未记录";
  const tokenLabel = `约 ${compactNumber(entry.tokenAmount || 0)} tok`;
  const dataAttr =
    entry.kind === "node"
      ? `data-audit-node-id="${escapeAttr(entry.id)}"`
      : `data-audit-exec-node-id="${escapeAttr(entry.id)}"`;
  return `
    <button class="audit-minimal-entry type-${escapeAttr(entry.type)}${selected ? " selected" : ""}${Number.isFinite(percent) ? "" : " usage-unknown"}" type="button" ${dataAttr} style="--segment-height:${escapeAttr(String(entry.segmentHeight || 1))}" title="${escapeAttr(`${entry.label} · ${tokenLabel} · ${usageLabel}`)}" aria-label="${escapeAttr(`${entry.label}，${tokenLabel}，${usageLabel}`)}"></button>
  `;
}

function renderAuditMinimalLegend() {
  const types = ["intent", "reasoning", "agent_message", "action", "handoff", "subagent", "evidence", "verification", "risk", "final"];
  return `
    <div class="audit-minimal-legend" aria-label="极简审计链颜色图例">
      ${types
        .map(
          (type) => `
            <span class="audit-minimal-legend-item type-${escapeAttr(type)}">
              <i aria-hidden="true"></i>${escapeHtml(auditMinimalShortLabel(type, auditMinimalTypeLabel(type)))}
            </span>
          `,
        )
        .join("")}
    </div>
  `;
}

function auditMinimalLayoutEntries(entries = []) {
  const ordered = (entries || []).map((entry, index) => ({ ...entry, order: entry.order ?? index }));
  const withDeltas = auditMinimalApplyContextDeltas(ordered);
  const shares = auditMinimalSegmentHeightShares(withDeltas);
  return withDeltas.map((entry, index) => ({ ...entry, segmentHeight: shares[index] || 1 }));
}

function auditMinimalTrackHeight(entries = []) {
  const count = entries.length || 1;
  return Math.max(360, Math.min(2200, count * 10));
}

function auditMinimalApplyContextDeltas(entries) {
  let previousUsed = null;
  return entries.map((entry) => {
    const used = auditMinimalContextUsedTokens(entry.contextUsage);
    if (Number.isFinite(used) && Number.isFinite(previousUsed) && used > previousUsed) {
      const delta = Math.round(used - previousUsed);
      previousUsed = used;
      return { ...entry, tokenAmount: Math.max(1, delta), tokenEstimated: false };
    }
    if (Number.isFinite(used)) previousUsed = used;
    return { ...entry, tokenAmount: Math.max(1, Math.round(entry.tokenAmount || 1)) };
  });
}

function auditMinimalSegmentHeightShares(entries) {
  const count = entries.length;
  if (!count) return [];
  const raw = entries.map((entry) => Math.max(1, Number(entry.tokenAmount) || 1));
  const total = raw.reduce((sum, value) => sum + value, 0) || count;
  const base = raw.map((value) => (value / total) * 100);
  let minShare = Math.min(5, Math.max(0.7, 28 / count));
  if (minShare * count > 92) minShare = 92 / count;
  const fixed = base.map((share) => (share < minShare ? minShare : 0));
  const fixedTotal = fixed.reduce((sum, value) => sum + value, 0);
  const flexibleTotal = base.reduce((sum, share, index) => sum + (fixed[index] ? 0 : share), 0);
  const remaining = Math.max(0, 100 - fixedTotal);
  return base.map((share, index) => {
    if (fixed[index]) return roundSegmentShare(fixed[index]);
    if (!flexibleTotal) return roundSegmentShare(remaining / count);
    return roundSegmentShare((share / flexibleTotal) * remaining);
  });
}

function roundSegmentShare(value) {
  return Math.max(0.2, Math.round(value * 10) / 10);
}

function auditMinimalTurnUsageLabel(entries = []) {
  const percents = entries.map((entry) => contextUsagePercent(entry.contextUsage)).filter(Number.isFinite);
  if (!percents.length) return "上下文未记录";
  return `最高 ${Math.max(...percents)}%`;
}

function auditMinimalTypeForRow(row = {}) {
  const nodes = row.auditNodes || [];
  if (nodes.some((node) => node.type === "risk" || (node.riskLevel && node.riskLevel !== "none"))) return "risk";
  if (nodes.some((node) => node.type === "verification")) return "verification";
  if (nodes.some((node) => node.type === "evidence")) return "evidence";
  if (nodes.some((node) => node.type === "final")) return "final";
  if (nodes.some((node) => node.type === "reasoning")) return "reasoning";
  if (row.type === "agent_message") return "agent_message";
  if (row.type === "handoff") return "handoff";
  if (row.type === "subagent" || row.type === "lazy-child") return "subagent";
  return "action";
}

function auditMinimalLabelForRow(row, type) {
  if (type === "agent_message") return "助手消息";
  if (type === "handoff") return "委派";
  if (type === "subagent") return "子代理";
  return auditMinimalTypeLabel(type);
}

function auditMinimalTypeLabel(type) {
  if (type === "agent_message") return "助手";
  if (type === "handoff") return "委派";
  if (type === "subagent" || type === "lazy-child") return "子代理";
  if (type === "tool") return "行动";
  return auditTypeLabel(type);
}

function auditMinimalShortLabel(type, label) {
  const labels = {
    intent: "意",
    reasoning: "推",
    action: "行",
    tool: "行",
    evidence: "证",
    verification: "验",
    risk: "险",
    final: "终",
    agent_message: "助",
    handoff: "委",
    subagent: "代",
    "lazy-child": "代",
  };
  return labels[type] || String(label || type || "事").slice(0, 1);
}

function auditMinimalTokenAmountForNode(node, item, usage) {
  const explicit = auditMinimalNumericTokenValue(node);
  if (Number.isFinite(explicit)) return Math.max(1, Math.round(explicit));
  const used = auditMinimalContextUsedTokens(usage);
  const body = auditNodeFullBody(node, readableAuditNode(node, item), item);
  const text = [
    body,
    node?.summary,
    node?.title,
    node?.argumentsPreview,
    node?.outputPreview,
    item?.text,
    item?.arguments,
    item?.output,
    item?.payloadPreview,
  ]
    .filter(Boolean)
    .join("\n");
  return Math.max(1, approxTokensFromValue(text) || Math.round((Number.isFinite(used) ? used : 0) * 0.01) || auditMinimalTokenFallbackForType(node?.type));
}

function auditMinimalTokenAmountForRow(row, usage) {
  const explicit = auditMinimalNumericTokenValue(row);
  if (Number.isFinite(explicit)) return Math.max(1, Math.round(explicit));
  const item = row?.itemRef ? findItemByRef(row.itemRef) : null;
  const readable = readableExecutionRow(row);
  const used = auditMinimalContextUsedTokens(usage);
  const text = [
    readable.body,
    readable.summary,
    readable.title,
    row?.title,
    row?.subtitle,
    item?.text,
    item?.arguments,
    item?.output,
    item?.payloadPreview,
    ...(row?.auditNodes || []).map((node) => auditNodeFullBody(node) || node.summary || node.title || ""),
  ]
    .filter(Boolean)
    .join("\n");
  return Math.max(1, approxTokensFromValue(text) || Math.round((Number.isFinite(used) ? used : 0) * 0.01) || auditMinimalTokenFallbackForType(row?.type));
}

function auditMinimalNumericTokenValue(source = {}) {
  const candidates = [
    source.tokens,
    source.tokenCount,
    source.token_count,
    source.usage?.total_tokens,
    source.usage?.totalTokens,
    source.total_token_usage?.total_tokens,
    source.totalTokenUsage?.totalTokens,
  ];
  for (const value of candidates) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function auditMinimalContextUsedTokens(usage) {
  const used = Number(usage?.used ?? usage?.usedTokens ?? usage?.context_used ?? usage?.contextUsed);
  if (Number.isFinite(used)) return used;
  const percent = contextUsagePercent(usage);
  const limit = Number(usage?.limit ?? usage?.context_window ?? usage?.contextWindow);
  if (Number.isFinite(percent) && Number.isFinite(limit) && limit > 0) return Math.round((percent / 100) * limit);
  return null;
}

function auditMinimalTokenFallbackForType(type) {
  if (type === "agent_message" || type === "final") return 120;
  if (type === "tool" || type === "action" || type === "handoff") return 80;
  if (type === "subagent" || type === "lazy-child") return 70;
  if (type === "reasoning") return 60;
  return 24;
}

function auditMinimalContextUsageForNode(node, turn) {
  const rows = turn?.executionRows || turn?.visibleExecutionRows || [];
  const row =
    rows.find((candidate) => (candidate.auditNodes || []).some((auditNode) => auditNode.id === node.id)) ||
    rows.find((candidate) => node.traceNodeId && candidate.traceNodeId === node.traceNodeId) ||
    rows.find((candidate) => node.itemRef && candidate.itemRef === node.itemRef);
  return (
    auditMinimalContextUsageForRow(row, turn) ||
    auditMinimalContextUsageForItem(node?.itemRef ? findItemByRef(node.itemRef) : null) ||
    auditMinimalTurnContextUsage(turn, node)
  );
}

function auditMinimalContextUsageForRow(row, turn) {
  if (!row) return null;
  if (row.contextUsage) return row.contextUsage;
  const rowById = new Map((turn?.executionRows || turn?.visibleExecutionRows || []).map((candidate) => [candidate.id, candidate]));
  const parent = row.parentRowId ? rowById.get(row.parentRowId) : null;
  if (parent?.contextUsage) return parent.contextUsage;
  const agentItem = row.agentMessageItemRef ? findItemByRef(row.agentMessageItemRef) : null;
  const item = row.itemRef ? findItemByRef(row.itemRef) : null;
  return auditMinimalContextUsageForItem(agentItem) || auditMinimalContextUsageForItem(item) || auditMinimalTurnContextUsage(turn, row);
}

function auditMinimalContextUsageForItem(item) {
  if (!item) return null;
  if (item.contextUsage) return item.contextUsage;
  if (item.type === "token-count") return tokenItemContextUsage(item);
  return null;
}

function auditMinimalTurnContextUsage(turn, anchor = {}) {
  const items = turn?.turn?.items || turn?.items || [];
  const tokenItems = items
    .map((item, index) => ({ item, index, usage: tokenItemContextUsage(item) }))
    .filter((entry) => entry.usage);
  if (!tokenItems.length) return null;
  const anchorIndex = Number.isInteger(anchor.itemIndex) ? anchor.itemIndex : window.AuditViewModel?.itemIndexFromItemRef?.(anchor.itemRef);
  if (Number.isInteger(anchorIndex)) {
    return tokenItems.find((entry) => entry.index >= anchorIndex)?.usage || [...tokenItems].reverse().find((entry) => entry.index <= anchorIndex)?.usage || tokenItems.at(-1)?.usage || null;
  }
  return tokenItems.at(-1)?.usage || null;
}

function tokenItemContextUsage(item) {
  return item?.info?.context_usage || item?.info?.contextUsage || item?.contextUsage || null;
}

function auditMinimalSortValue(source = {}) {
  const direct = Number(source.eventIndex ?? source.sourceIndex ?? source.itemIndex);
  if (Number.isFinite(direct)) return direct;
  const time = dateMs(source.timestamp);
  if (time != null) return 1_000_000_000 + time;
  return Number.MAX_SAFE_INTEGER;
}

function renderAuditTurn(turn, context = {}) {
  const expanded = context.filtersActive || state.expandedAuditTurnKeys.has(turn.key);
  const selected = state.selectedAuditTurnKey === turn.key ? " selected" : "";
  const stats = turn.stats;
  const verificationClass = auditVerificationClass(stats.verificationStatus);
  const riskClass = stats.highestRisk === "none" ? "none" : stats.highestRisk;
  const meta = [turn.turn?.status, formatDate(turn.turn?.startedAt), turn.turn?.cwd ? shortPath(turn.turn.cwd) : ""]
    .filter(Boolean)
    .join(" · ");
  return `
    <article class="audit-turn${selected}${expanded ? " expanded" : ""}" role="listitem" data-audit-turn-root="${escapeAttr(turn.key)}" data-evidence-id="${escapeAttr(auditTurnEvidenceId(turn))}">
      <div class="audit-turn-header">
        <button class="audit-turn-toggle" type="button" data-audit-turn-toggle="${escapeAttr(turn.key)}" title="${expanded ? "收起轮次" : "展开轮次"}">
          ${expanded ? "⌄" : "›"}
        </button>
        <button class="audit-turn-summary-button" type="button" data-audit-turn-key="${escapeAttr(turn.key)}">
          <span class="audit-turn-main">
            <span class="audit-turn-title">
              <strong>第 ${escapeHtml(String(turn.turnNumber))} 轮</strong>
              <span>${highlight(escapeHtml(turn.intentSummary), context.query)}</span>
            </span>
            <span class="audit-turn-result">${highlight(escapeHtml(turn.finalSummary), context.query)}</span>
            <span class="audit-turn-meta">${escapeHtml(meta || "无时间元数据")}</span>
          </span>
          <span class="audit-turn-state">
            <span class="audit-state-pill ${escapeAttr(verificationClass)}">${escapeHtml(stats.verificationStatus)}</span>
            <span class="audit-state-pill risk-${escapeAttr(riskClass)}">${escapeHtml(stats.riskLabel)}</span>
          </span>
          <span class="audit-turn-metrics" aria-label="轮次审计指标">
            ${renderAuditTurnMetric("工具", stats.toolCount)}
            ${renderAuditTurnMetric("子代理", stats.subagentCount)}
            ${renderAuditTurnMetric("证据", stats.evidenceCount)}
            ${renderAuditTurnMetric("缺口", stats.gapCount)}
          </span>
        </button>
      </div>
      ${
        expanded
          ? `<div class="audit-turn-expanded">
              ${renderAuditExecutionSection(turn, context)}
              ${turn.visibleUnlinkedAuditNodes.length ? renderAuditUnlinkedSection(turn.visibleUnlinkedAuditNodes, context.query) : ""}
            </div>`
          : ""
      }
    </article>
  `;
}

function renderAuditTurnMetric(label, value) {
  return `<span><strong>${escapeHtml(String(value ?? 0))}</strong><em>${escapeHtml(label)}</em></span>`;
}

function renderAuditExecutionSection(turn, context = {}) {
  const rows = turn.visibleExecutionRows;
  const entries = auditGroupedExecutionEntries(rows);
  const groupCount = entries.filter((entry) => entry.kind === "group").length;
  const emptyText = auditExecutionEmptyText(turn, context);
  const countLabel = rows.length
    ? [`${rows.length} 个执行节点`, groupCount ? `${groupCount} 个执行组` : ""].filter(Boolean).join(" · ")
    : emptyText;
  return `
    <section class="audit-turn-section execution">
      <div class="audit-section-title">
        <strong>执行链</strong>
        <span>${escapeHtml(countLabel)}</span>
      </div>
      ${
        rows.length
          ? `<div class="audit-execution-list">${entries.map((entry) => renderAuditExecutionEntry(entry, context)).join("")}</div>`
          : `<div class="audit-section-empty">${escapeHtml(emptyText)}</div>`
      }
    </section>
  `;
}

function renderAuditUnlinkedSection(nodes, query) {
  return `
    <section class="audit-turn-section unlinked">
      <div class="audit-section-title">
        <strong>未关联 / 原始事件复核</strong>
        <span>${escapeHtml(`${nodes.length} 个节点无法可靠挂载到执行链`)}</span>
      </div>
      <div class="audit-evidence-list">${nodes.map((node) => renderAuditEvidenceNode(node, query)).join("")}</div>
    </section>
  `;
}

function renderAuditUnplacedSection(nodes, query) {
  return `
    <section class="audit-global-unlinked">
      ${renderAuditUnlinkedSection(nodes, query)}
    </section>
  `;
}

function renderAuditExecutionRow(row, query) {
  const selected = auditExecutionRowIsSelected(row) ? " selected" : "";
  const depth = Math.min(row.depth || 0, 5);
  const duration = row.durationMs == null ? "" : `${formatDuration(row.durationMs)}${row.durationEstimated ? " est" : ""}`;
  const meta = [traceTypeLabel(row.type), row.status, duration, formatDate(row.timestamp)].filter(Boolean).join(" · ");
  const riskLevel = highestRiskLevel(row.auditNodes || []);
  const statusNodes = auditExecutionStatusNodes(row.auditNodes || []);
  const childGroups = auditExecutionChildGroups(statusNodes);
  const rowReadable = readableExecutionRow(row);
  const subSummary = statusNodes
    .filter((node) => node.type !== "action")
    .slice(0, 2)
    .map((node) => {
      const readable = readableAuditNode(node);
      return `${auditTypeLabel(node.type)}: ${readable.summary || readable.title || ""}`;
    })
    .filter(Boolean)
    .join("；");
  return `
    <div class="audit-exec-row type-${escapeAttr(row.type)} risk-${escapeAttr(riskLevel)}${selected}" role="button" tabindex="0" data-audit-exec-node-id="${escapeAttr(row.id)}" style="--depth:${depth}">
      <span class="audit-exec-indent" aria-hidden="true"></span>
      <span class="trace-icon ${escapeAttr(row.icon || row.type)}">${traceIcon(row)}</span>
      <span class="audit-exec-main">
        <span class="audit-exec-title">
          <strong>${highlight(escapeHtml(rowReadable.title || row.title || row.label || row.id), query)}</strong>
          ${renderContextUsageBadge(row.contextUsage)}
          <em>${escapeHtml(meta)}</em>
        </span>
        ${
          rowReadable.summary || subSummary
            ? `<span class="audit-exec-sub">${highlight(escapeHtml(firstLine([rowReadable.summary, subSummary].filter(Boolean).join("；"), 220)), query)}</span>`
            : ""
        }
        ${renderChangeSetSummary(rowReadable.changeSet, { query, compact: true })}
        ${statusNodes.length ? `<span class="audit-exec-badges">${statusNodes.slice(0, 6).map((node) => renderAuditNodeChip(node, query)).join("")}</span>` : ""}
        ${childGroups.length ? `<div class="audit-exec-nested">${childGroups.map((group) => renderAuditExecutionChildGroup(group, query)).join("")}</div>` : ""}
      </span>
    </div>
  `;
}

function renderAuditExecutionEntry(entry, context = {}) {
  if (entry.kind === "group") return renderAuditExecutionGroup(entry, context);
  return renderAuditExecutionRow(entry.row, context.query);
}

function renderChangeSetSummary(changeSet, options = {}) {
  const files = (changeSet?.files || []).filter((file) => file?.path);
  if (!files.length) return "";
  const compact = Boolean(options.compact);
  const maxFiles = options.maxFiles ?? (compact ? 3 : 7);
  const shown = files.slice(0, maxFiles);
  const more = files.length - shown.length;
  const additions = Number(changeSet.additions) || 0;
  const deletions = Number(changeSet.deletions) || 0;
  const hasLineStats = Boolean(additions || deletions);
  const stat = hasLineStats ? `+${additions} -${deletions}` : "文件列表";
  return `
    <div class="tool-diff-summary ${compact ? "compact" : "expanded"}">
      <div class="tool-diff-head">
        <span>${escapeHtml(`${files.length} 个文件`)}</span>
        ${hasLineStats ? `<strong><span class="tool-diff-add">+${escapeHtml(String(additions))}</span> <span class="tool-diff-del">-${escapeHtml(String(deletions))}</span></strong>` : ""}
        <em>${escapeHtml(stat)}</em>
      </div>
      <div class="tool-diff-files">
        ${shown.map((file) => renderChangeSetFile(file, changeSet, options.query)).join("")}
        ${more > 0 ? `<div class="tool-diff-more">还有 ${escapeHtml(String(more))} 个文件</div>` : ""}
      </div>
    </div>
  `;
}

function renderChangeSetFile(file, changeSet, query) {
  const additions = Number(file.additions) || 0;
  const deletions = Number(file.deletions) || 0;
  const maxChanges = Math.max(1, ...(changeSet?.files || []).map((entry) => Number(entry.changeCount) || Number(entry.additions) + Number(entry.deletions) || 0));
  const addWidth = Math.round((additions / maxChanges) * 100);
  const delWidth = Math.round((deletions / maxChanges) * 100);
  const status = changeStatusLabel(file.status);
  const path = displayChangeFilePath(file);
  return `
    <div class="tool-diff-file status-${escapeAttr(file.status || "modified")}" style="--add:${addWidth};--del:${delWidth}">
      <span class="tool-diff-status">${escapeHtml(status)}</span>
      <span class="tool-diff-path">${highlight(escapeHtml(path), query)}</span>
      <span class="tool-diff-counts">
        ${additions ? `<span class="tool-diff-add">+${escapeHtml(String(additions))}</span>` : ""}
        ${deletions ? `<span class="tool-diff-del">-${escapeHtml(String(deletions))}</span>` : ""}
      </span>
      <span class="tool-diff-bars" aria-hidden="true"><i class="add"></i><i class="del"></i></span>
    </div>
  `;
}

function changeStatusLabel(status) {
  if (status === "added") return "A";
  if (status === "deleted") return "D";
  if (status === "renamed") return "R";
  return "M";
}

function displayChangeFilePath(file) {
  if (!file) return "";
  return file.oldPath && file.oldPath !== file.path ? `${file.oldPath} -> ${file.path}` : file.path || "";
}

function renderAuditExecutionGroup(group, context = {}) {
  const expanded = context.filtersActive || auditExecutionGroupContainsSelection(group) || state.expandedAuditGroupIds.has(group.id);
  const selected = auditExecutionGroupContainsSelection(group) ? " selected" : "";
  const riskLevel = highestRiskLevel(group.rows.flatMap((row) => row.auditNodes || []));
  const depth = Math.min(group.depth || 0, 5);
  const childIds = group.childIds.join(" ");
  return `
    <div class="audit-exec-group risk-${escapeAttr(riskLevel)}${selected}" style="--depth:${depth}" data-audit-exec-group-child-ids="${escapeAttr(childIds)}">
      <button class="audit-exec-group-head" type="button" data-audit-exec-group-id="${escapeAttr(group.id)}" title="${escapeAttr(expanded ? "收起执行组" : "展开执行组")}">
        <span class="audit-exec-indent" aria-hidden="true"></span>
        <span class="audit-exec-group-expander">${expanded ? "⌄" : "›"}</span>
        <span class="trace-icon tool">#</span>
        <span class="audit-exec-main">
          <span class="audit-exec-title">
            <strong>${highlight(escapeHtml(group.title), context.query)}</strong>
            <em>${escapeHtml([group.ruleLabel, `${group.count} 个节点`].filter(Boolean).join(" · "))}</em>
          </span>
          <span class="audit-exec-sub">${highlight(escapeHtml(group.summary), context.query)}</span>
        </span>
      </button>
      ${
        expanded
          ? `<div class="audit-exec-group-children">${group.rows
              .map((row) => renderAuditExecutionRow({ ...row, depth: Math.min((row.depth || 0) + 1, 6) }, context.query))
              .join("")}</div>`
          : ""
      }
    </div>
  `;
}

function renderAuditExecutionChildGroup(group, query) {
  const shown = group.nodes.slice(0, 3);
  const more = group.nodes.length - shown.length;
  return `
    <div class="audit-exec-child-group type-${escapeAttr(group.key)}">
      <span class="audit-exec-child-label">
        <strong>${escapeHtml(group.label)}</strong>
        <em>${escapeHtml(String(group.nodes.length))}</em>
      </span>
      <span class="audit-exec-child-nodes">
        ${shown.map((node) => renderAuditMiniNode(node, query)).join("")}
        ${more > 0 ? `<span class="audit-more-node">+${escapeHtml(String(more))}</span>` : ""}
      </span>
    </div>
  `;
}

function renderAuditMiniNode(node, query) {
  const selected = state.selectedAuditNodeId === node.id ? " selected" : "";
  const readable = readableAuditNode(node);
  const title = node.type === "risk" ? auditRiskLabel(node.riskLevel || "none") : readable.title || auditTypeLabel(node.type);
  const summary = firstLine(readable.summary || "", 150);
  return `
    <button class="audit-mini-node type-${escapeAttr(node.type)} risk-${escapeAttr(node.riskLevel || "none")}${selected}" type="button" data-audit-node-id="${escapeAttr(node.id)}" title="${escapeAttr(summary || title)}">
      <strong>${highlight(escapeHtml(firstLine(title, 42)), query)}</strong>
      ${summary ? `<span>${highlight(escapeHtml(summary), query)}</span>` : ""}
    </button>
  `;
}

function renderAuditNodeChip(node, query) {
  const selected = state.selectedAuditNodeId === node.id ? " selected" : "";
  const readable = readableAuditNode(node);
  const label = node.type === "risk" ? auditRiskLabel(node.riskLevel || "none") : readable.title || auditTypeLabel(node.type);
  return `
    <button class="audit-node-chip type-${escapeAttr(node.type)} risk-${escapeAttr(node.riskLevel || "none")}${selected}" type="button" data-audit-node-id="${escapeAttr(node.id)}" title="${escapeAttr(node.title || label)}">
      <span>${escapeHtml(auditNodeGlyph(node.type))}</span>
      ${highlight(escapeHtml(firstLine(label, 28)), query)}
    </button>
  `;
}

function renderAuditEvidenceNode(node, query) {
  const selected = state.selectedAuditNodeId === node.id ? " selected" : "";
  const readable = readableAuditNode(node);
  const meta = [
    auditTypeLabel(node.type),
    node.status || "未记录",
    auditRiskMetaLabel(node.riskLevel),
    node.turnNumber ? `第 ${node.turnNumber} 轮` : "",
    auditEventIndexLabel(node),
    auditRelatedLabel(node),
    formatDate(node.timestamp),
  ]
    .filter(Boolean)
    .join(" · ");
  const tags = (node.tags || []).slice(0, 4);
  return `
    <button class="audit-evidence-node type-${escapeAttr(node.type)} risk-${escapeAttr(node.riskLevel || "none")}${selected}" type="button" data-audit-node-id="${escapeAttr(node.id)}">
      <span class="audit-evidence-kind">${escapeHtml(auditNodeGlyph(node.type))}</span>
      <span class="audit-evidence-main">
        <span class="audit-evidence-title">
          <strong>${highlight(escapeHtml(readable.title || auditTypeLabel(node.type)), query)}</strong>
          ${node.riskLevel && node.riskLevel !== "none" ? `<em>${escapeHtml(auditRiskLabel(node.riskLevel))}</em>` : ""}
        </span>
        <span class="audit-evidence-summary">${highlight(escapeHtml(readable.summary || ""), query)}</span>
        <span class="audit-evidence-tags">
          ${tags.map((tag) => `<span>${highlight(escapeHtml(tag), query)}</span>`).join("")}
        </span>
      </span>
      <span class="audit-evidence-meta">${escapeHtml(meta)}</span>
    </button>
  `;
}

function buildAuditTurnModel(detail) {
  const audit = detail.audit || buildAuditFallback(detail);
  const auditNodes = audit.nodes || [];
  const turnModels = (detail.turns || []).map((turn, index) => buildAuditTurnProjection(detail, turn, index, auditNodes));
  const knownTurnIndexes = new Set(turnModels.map((turn) => turn.turnIndex));
  const unplacedAuditNodes = auditNodes.filter((node) => !knownTurnIndexes.has(auditNodeTurnIndex(node)));
  const model = {
    detail,
    audit,
    auditNodes,
    counts: audit.counts || auditNodeCounts(auditNodes),
    turns: turnModels,
    unplacedAuditNodes,
    hasTraceRoot: Boolean(detail.trace?.root),
    filteredTurnCount: turnModels.length,
  };
  return model;
}

function buildAuditTurnProjection(detail, turn, turnIndex, auditNodes) {
  const key = auditTurnKey(turn, turnIndex);
  const turnNumber = turn.turnNumber ?? turnIndex + 1;
  const turnAuditNodes = auditNodes.filter((node) => auditNodeTurnIndex(node) === turnIndex);
  const executionRows = buildAuditExecutionRows(detail, turn, turnIndex);
  const rowByTraceId = new Map(executionRows.filter((row) => row.traceNodeId).map((row) => [row.traceNodeId, row]));
  const rowByItemRef = new Map(executionRows.filter((row) => row.itemRef).map((row) => [row.itemRef, row]));
  const linkedNodeIds = new Set();
  const unlinkedAuditNodes = [];

  for (const node of turnAuditNodes) {
    const row = (node.traceNodeId && rowByTraceId.get(node.traceNodeId)) || (node.itemRef && rowByItemRef.get(node.itemRef));
    if (row && auditNodeCanAttachToExecution(node)) {
      row.auditNodes.push(node);
      linkedNodeIds.add(node.id);
    } else if (auditNodeNeedsExecutionMount(node)) {
      unlinkedAuditNodes.push(node);
    }
  }

  const intentSummary = auditTurnIntentSummary(turn, turnAuditNodes);
  const finalSummary = auditTurnFinalSummary(turn, turnAuditNodes);
  const stats = auditTurnStats(turn, executionRows, turnAuditNodes, unlinkedAuditNodes);

  return {
    key,
    turn,
    turnIndex,
    turnNumber,
    intentSummary,
    finalSummary,
    auditNodes: turnAuditNodes,
    unlinkedAuditNodes,
    executionRows,
    linkedNodeIds,
    stats,
    visibleExecutionRows: executionRows,
    visibleUnlinkedAuditNodes: unlinkedAuditNodes,
  };
}

function buildAuditExecutionRows(detail, turn, turnIndex) {
  const rows = [];
  const seen = new Set();
  const traceTurn = traceTurnNodeForIndex(detail.trace?.root, turnIndex);
  if (traceTurn) {
    for (const row of window.AuditViewModel.flattenAuditExecutionRows(traceTurn.children || [], 0)) {
      const key = row.traceNodeId || row.itemRef || row.id;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
  }
  if (!rows.length) {
    for (const item of turn.items || []) {
      if (item.type !== "tool-call") continue;
      const row = auditExecutionRowFromItem(item, turnIndex);
      const key = row.traceNodeId || row.itemRef || row.id;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
  }
  return attachAuditRowsToAgentMessages(rows, turn, turnIndex);
}

function auditExecutionRowFromItem(item, turnIndex) {
  return window.AuditViewModel.auditExecutionRowFromItem(item, turnIndex, { itemRef, formatDate, durationBetween });
}

function attachAuditRowsToAgentMessages(rows, turn, turnIndex) {
  return window.AuditViewModel.attachAuditRowsToAgentMessages(rows, turn, turnIndex, { itemRef, firstLine });
}

function traceTurnNodeForIndex(root, turnIndex) {
  if (!root) return null;
  const turns = (root.children || []).filter((node) => node.type === "turn");
  return turns[turnIndex] || null;
}

function itemRefFromTraceNode(node) {
  return window.AuditViewModel.itemRefFromTraceNode(node);
}

function auditTurnKey(turn, index) {
  return `turn:${turn?.id || index}:${index}`;
}

function auditNodeTurnIndex(node) {
  if (Number.isInteger(node?.turnIndex)) return node.turnIndex;
  if (Number.isInteger(node?.turnNumber)) return node.turnNumber - 1;
  return null;
}

function auditNodeCanAttachToExecution(node) {
  return ["reasoning", "action", "evidence", "verification", "risk", "final"].includes(node?.type);
}

function auditNodeNeedsExecutionMount(node) {
  if (!auditNodeCanAttachToExecution(node)) return false;
  if (node.type === "reasoning" || node.type === "final") return false;
  return Boolean(node.traceNodeId || node.itemRef || node.toolName || node.callId || node.type === "action");
}

function auditTurnIntentSummary(turn, nodes) {
  const intent = nodes.find((node) => node.type === "intent" && node.summary);
  if (intent) return firstLine(intent.summary, 180);
  const user = (turn.items || []).find((item) => item.type === "user-message" && String(item.text || "").trim());
  return user ? firstLine(user.text, 180) : "无明确用户意图";
}

function auditTurnFinalSummary(turn, nodes) {
  const final = [...nodes].reverse().find((node) => node.type === "final" && node.summary);
  if (final) return firstLine(final.summary, 190);
  const assistant = [...(turn.items || [])].reverse().find((item) => item.type === "assistant-message" && String(item.text || "").trim());
  return assistant ? firstLine(assistant.text, 190) : "尚无最终回复";
}

function auditTurnIntentBody(turn) {
  const intent = turn.auditNodes.find((node) => node.type === "intent" && (node.body || node.summary));
  if (intent) return auditNodeFullBody(intent) || intent.summary;
  const user = (turn.turn?.items || []).find((item) => item.type === "user-message" && String(item.text || "").trim());
  return user ? String(user.text || "").trim() : turn.intentSummary || "无明确用户意图";
}

function auditTurnFinalBody(turn) {
  const final = [...turn.auditNodes].reverse().find((node) => node.type === "final" && (node.body || node.summary));
  if (final) return auditNodeFullBody(final) || final.summary;
  const assistant = [...(turn.turn?.items || [])].reverse().find((item) => item.type === "assistant-message" && String(item.text || "").trim());
  return assistant ? String(assistant.text || "").trim() : turn.finalSummary || "尚无最终回复";
}

function auditTurnStats(turn, executionRows, nodes, unlinkedAuditNodes) {
  const highestRisk = highestRiskLevel(nodes);
  const riskCount = nodes.filter((node) => node.type === "risk" || (node.riskLevel && node.riskLevel !== "none")).length;
  const verificationNodes = nodes.filter((node) => node.type === "verification");
  const gapCount = nodes.filter(auditNodeIsGap).length + unlinkedAuditNodes.filter((node) => !auditNodeIsGap(node)).length;
  return {
    toolCount: executionRows.filter((row) => row.type === "tool" || row.type === "handoff").length,
    subagentCount: executionRows.filter((row) => row.type === "subagent").length,
    evidenceCount: nodes.filter((node) => node.type === "evidence").length,
    gapCount,
    highestRisk,
    riskCount,
    riskLabel: riskCount ? `${auditRiskLabel(highestRisk)} · ${riskCount}` : "无风险信号",
    verificationStatus: auditVerificationStatus(verificationNodes, nodes),
  };
}

function auditNodeIsGap(node) {
  const tags = node.tags || [];
  return tags.includes("missing-output") || tags.includes("missing-verification");
}

function auditVerificationStatus(verificationNodes, nodes) {
  if (!verificationNodes.length) {
    return nodes.some((node) => (node.tags || []).includes("missing-verification")) ? "缺少验证" : "未验证";
  }
  if (verificationNodes.some((node) => node.status === "failed" || (node.riskLevel && node.riskLevel !== "none"))) return "验证不足";
  return "已验证";
}

function auditVerificationClass(status) {
  if (status === "已验证") return "verified";
  if (status === "验证不足" || status === "缺少验证") return "failed";
  return "none";
}

function highestRiskLevel(nodes) {
  return (nodes || []).reduce((level, node) => maxAuditRisk(level, node.riskLevel || (node.type === "risk" ? "low" : "none")), "none");
}

function maxAuditRisk(left, right) {
  const rank = { none: 0, low: 1, medium: 2, high: 3 };
  return (rank[right] || 0) > (rank[left] || 0) ? right : left;
}

function auditExecutionStatusNodes(nodes) {
  const order = { action: 0, evidence: 1, verification: 2, risk: 3 };
  return [...(nodes || [])].sort((left, right) => (order[left.type] ?? 9) - (order[right.type] ?? 9));
}

function auditExecutionChildGroups(nodes) {
  const specs = [
    ["action", "行动"],
    ["evidence", "输出证据"],
    ["verification", "验证"],
    ["risk", "风险"],
  ];
  return specs
    .map(([key, label]) => ({
      key,
      label,
      nodes: (nodes || []).filter((node) => node.type === key),
    }))
    .filter((group) => group.nodes.length > 0);
}

function auditExecutionEmptyText(turn, context = {}) {
  if (context.filtersActive && turn.executionRows.length) return "当前搜索或类型过滤没有匹配执行节点";
  return "此轮次没有工具、handoff、子代理调用或助手消息";
}

function auditFiltersActive(filters = {}) {
  return Boolean(filters.query || (filters.typeFilter && filters.typeFilter !== "all"));
}

function filterAuditTurnModel(turn, filters = {}) {
  if (!auditFiltersActive(filters)) return turn;
  const query = filters.query || "";
  const typeFilter = filters.typeFilter || "all";
  const matchingRows = turn.executionRows.filter((row) => auditExecutionRowMatches(row, query, typeFilter));
  const matchingNodes = turn.auditNodes.filter((node) => auditNodeMatches(node, query, typeFilter));
  const matchingUnlinked = turn.unlinkedAuditNodes.filter((node) => auditNodeMatches(node, query, typeFilter));
  const rowContextIds = new Set(matchingRows.map((row) => row.id));
  const rowById = new Map(turn.executionRows.map((row) => [row.id, row]));
  for (const row of matchingRows) {
    addAuditExecutionAncestors(row, rowById, rowContextIds);
    addAuditExecutionDescendants(row, rowById, rowContextIds);
  }
  for (const node of [...matchingNodes, ...matchingUnlinked]) {
    const row = turn.executionRows.find((candidate) => candidate.auditNodes.some((auditNode) => auditNode.id === node.id));
    if (row) {
      rowContextIds.add(row.id);
      addAuditExecutionAncestors(row, rowById, rowContextIds);
      addAuditExecutionDescendants(row, rowById, rowContextIds);
    }
  }
  const visibleExecutionRows = turn.executionRows.filter((row) => rowContextIds.has(row.id));
  const summaryMatches = auditTurnSearchText(turn).includes(query) && auditTurnMatchesType(turn, typeFilter);
  if (!summaryMatches && !visibleExecutionRows.length && !matchingNodes.length && !matchingUnlinked.length) return null;
  return {
    ...turn,
    visibleExecutionRows: summaryMatches && typeFilter === "all" ? turn.executionRows : visibleExecutionRows,
    visibleUnlinkedAuditNodes: matchingUnlinked,
  };
}

function auditExecutionRowMatches(row, query, typeFilter) {
  const haystack = auditExecutionSearchText(row);
  const queryMatches = !query || haystack.includes(query);
  const typeMatches =
    typeFilter === "all" ||
    (typeFilter === "action" && (row.type === "tool" || row.type === "handoff")) ||
    row.auditNodes.some((node) => auditNodeMatches(node, "", typeFilter));
  return queryMatches && typeMatches;
}

function addAuditExecutionAncestors(row, rowById, ids) {
  let current = row;
  while (current?.parentRowId) {
    const parent = rowById.get(current.parentRowId);
    if (!parent || ids.has(parent.id)) break;
    ids.add(parent.id);
    current = parent;
  }
}

function addAuditExecutionDescendants(row, rowById, ids) {
  for (const childId of row.childRowIds || []) {
    const child = rowById.get(childId);
    if (!child || ids.has(child.id)) continue;
    ids.add(child.id);
    addAuditExecutionDescendants(child, rowById, ids);
  }
}

function auditExecutionSearchText(row) {
  const readable = readableExecutionRow(row);
  return [
    row.id,
    row.traceNodeId,
    row.itemRef,
    row.type,
    row.label,
    row.title,
    row.subtitle,
    contextUsageLabel(row.contextUsage),
    readable.title,
    readable.summary,
    readable.command,
    row.status,
    ...(row.auditNodes || []).map(auditNodeSearchText),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function auditGroupedExecutionEntries(rows) {
  const preparedRows = (rows || []).map((row) => ({ ...row, readable: readableExecutionRow(row) }));
  if (!window.ExecutionGrouping) return preparedRows.map((row) => ({ kind: "row", id: row.id, row }));
  return window.ExecutionGrouping.groupExecutionRows(preparedRows, { customRules: state.executionGroupRules });
}

function auditExecutionGroupContainsSelection(group) {
  return (group?.rows || []).some((row) => auditExecutionRowIsSelected(row));
}

function auditExecutionRowIsSelected(row) {
  if (!row) return false;
  if (row.traceNodeId && state.selectedTraceNodeId === row.traceNodeId) return true;
  if (!row.traceNodeId && row.itemRef && state.selectedItemRef === row.itemRef) return true;
  if (row.itemRef && state.selectedItemRef === row.itemRef) return true;
  return false;
}

function auditTurnMatchesType(turn, typeFilter) {
  if (typeFilter === "all") return true;
  if (typeFilter === "action") return turn.executionRows.length > 0;
  return turn.auditNodes.some((node) => node.type === typeFilter);
}

function auditTurnSearchText(turn) {
  return [
    turn.key,
    turn.turnNumber,
    turn.intentSummary,
    turn.finalSummary,
    turn.turn?.status,
    turn.turn?.cwd,
    turn.stats?.verificationStatus,
    turn.stats?.riskLabel,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function bindAuditInteractions() {
  els.auditContent.querySelector("[data-audit-minimal-toggle]")?.addEventListener("click", () => {
    state.auditMinimalMode = !state.auditMinimalMode;
    renderAudit();
  });
  els.auditContent.querySelectorAll("[data-audit-turn-toggle]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleAuditTurn(button.dataset.auditTurnToggle);
    });
  });
  els.auditContent.querySelectorAll("[data-audit-turn-key]").forEach((button) => {
    button.addEventListener("click", () => selectAuditTurn(button.dataset.auditTurnKey));
  });
  els.auditContent.querySelectorAll("[data-audit-exec-node-id]").forEach((row) => {
    row.addEventListener("click", (event) => {
      if (event.target.closest("[data-audit-node-id]")) return;
      selectAuditExecutionNode(row.dataset.auditExecNodeId);
    });
    row.addEventListener("keydown", (event) => {
      if (event.target.closest("[data-audit-node-id]")) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      selectAuditExecutionNode(row.dataset.auditExecNodeId);
    });
  });
  els.auditContent.querySelectorAll("[data-audit-exec-group-id]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleAuditExecutionGroup(button.dataset.auditExecGroupId);
    });
  });
  els.auditContent.querySelectorAll("[data-audit-node-id]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      selectAuditNode(button.dataset.auditNodeId);
    });
    button.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      selectAuditNode(button.dataset.auditNodeId);
    });
  });
}

function toggleAuditTurn(key) {
  if (!key) return;
  if (state.expandedAuditTurnKeys.has(key)) {
    state.expandedAuditTurnKeys.delete(key);
  } else {
    state.expandedAuditTurnKeys.add(key);
  }
  renderAudit();
}

function toggleAuditExecutionGroup(id) {
  if (!id) return;
  if (state.expandedAuditGroupIds.has(id)) {
    state.expandedAuditGroupIds.delete(id);
  } else {
    state.expandedAuditGroupIds.add(id);
  }
  renderAudit();
}

function selectAuditTurn(key) {
  const turn = findAuditTurn(key);
  if (!turn) return;
  state.selectedAuditTurnKey = key;
  state.selectedTraceNodeId = null;
  state.selectedAuditNodeId = null;
  state.selectedItemRef = null;
  state.selectedEventIndex = null;
  state.selectedTerminalBlockId = null;
  renderInspector();
  refreshAuditSelectionSurface();
}

function selectAuditExecutionNode(id) {
  const row = findAuditExecutionRow(id);
  if (!row) return;
  state.selectedAuditTurnKey = null;
  if (row.traceNodeId && findTraceNode(state.detail?.trace?.root, row.traceNodeId)) {
    selectTraceNode(row.traceNodeId);
  } else if (row.itemRef) {
    selectItemRef(row.itemRef);
  }
  markAuditSelection();
}

function findAuditTurn(key) {
  return buildAuditTurnModel(state.detail).turns.find((turn) => turn.key === key) || null;
}

function findAuditExecutionRow(id) {
  for (const turn of buildAuditTurnModel(state.detail).turns) {
    const row = turn.executionRows.find((candidate) => candidate.id === id);
    if (row) return row;
  }
  return null;
}

function auditTurnDebugPreview(turn) {
  return {
    turn: {
      key: turn.key,
      turnNumber: turn.turnNumber,
      status: turn.turn?.status || null,
      startedAt: turn.turn?.startedAt || null,
      completedAt: turn.turn?.completedAt || null,
      cwd: turn.turn?.cwd || null,
    },
    intentSummary: turn.intentSummary,
    finalSummary: turn.finalSummary,
    stats: turn.stats,
    executionRows: turn.executionRows.map((row) => ({
      id: row.id,
      traceNodeId: row.traceNodeId,
      itemRef: row.itemRef,
      type: row.type,
      title: row.title,
      status: row.status,
      auditNodeIds: row.auditNodes.map((node) => node.id),
    })),
    auditNodes: turn.auditNodes.map((node) => ({
      id: node.id,
      type: node.type,
      title: node.title,
      status: node.status,
      riskLevel: node.riskLevel,
      traceNodeId: node.traceNodeId,
      itemRef: node.itemRef,
    })),
    unlinkedAuditNodeIds: turn.unlinkedAuditNodes.map((node) => node.id),
  };
}

function markAuditSelection() {
  if (!els.auditContent) return;
  els.auditContent.querySelectorAll(".audit-turn.selected").forEach((row) => row.classList.remove("selected"));
  els.auditContent.querySelectorAll(".audit-exec-group.selected").forEach((row) => row.classList.remove("selected"));
  els.auditContent.querySelectorAll(".audit-exec-row.selected").forEach((row) => row.classList.remove("selected"));
  els.auditContent.querySelectorAll(".audit-evidence-node.selected, .audit-node-chip.selected").forEach((row) => row.classList.remove("selected"));
  els.auditContent.querySelectorAll(".audit-minimal-entry.selected").forEach((row) => row.classList.remove("selected"));
  if (state.selectedAuditTurnKey) {
    els.auditContent.querySelector(`[data-audit-turn-root="${cssEscape(state.selectedAuditTurnKey)}"]`)?.classList.add("selected");
  }
  if (state.selectedTraceNodeId) {
    els.auditContent.querySelector(`[data-audit-exec-node-id="${cssEscape(state.selectedTraceNodeId)}"]`)?.classList.add("selected");
    markAuditGroupForExecutionRow(state.selectedTraceNodeId);
  }
  if (state.selectedItemRef) {
    const row = findAuditExecutionRowByItemRef(state.selectedItemRef);
    if (row) {
      els.auditContent.querySelector(`[data-audit-exec-node-id="${cssEscape(row.id)}"]`)?.classList.add("selected");
      markAuditGroupForExecutionRow(row.id);
    }
  }
  if (state.selectedAuditNodeId) {
    els.auditContent.querySelectorAll(`[data-audit-node-id="${cssEscape(state.selectedAuditNodeId)}"]`).forEach((row) => row.classList.add("selected"));
  }
}

function markAuditGroupForExecutionRow(id) {
  if (!id) return;
  els.auditContent
    .querySelectorAll(`[data-audit-exec-group-child-ids~="${cssEscape(id)}"]`)
    .forEach((row) => row.classList.add("selected"));
}

function findAuditExecutionRowByItemRef(ref) {
  for (const turn of buildAuditTurnModel(state.detail).turns) {
    const row = turn.executionRows.find((candidate) => candidate.itemRef === ref);
    if (row) return row;
  }
  return null;
}

function selectAuditNode(id) {
  const node = findAuditNode(id);
  if (!node) return;
  state.selectedAuditNodeId = id;
  state.selectedAuditTurnKey = null;
  state.selectedTraceNodeId = null;
  state.selectedTerminalBlockId = null;
  state.selectedItemRef = null;
  state.selectedEventIndex = node.eventIndex ?? node.sourceIndex ?? null;
  renderInspector();
  refreshAuditSelectionSurface();
}

function refreshAuditSelectionSurface() {
  if (state.viewMode === "audit" && state.auditMinimalMode) {
    renderAudit();
    return;
  }
  markAuditSelection();
}

function renderAuditActions(node) {
  const actions = [];
  if (node.eventIndex != null || node.sourceIndex != null) actions.push(`<button class="ghost-button small" type="button" data-open-audit-raw>打开原始事件</button>`);
  if (node.itemRef) actions.push(`<button class="ghost-button small" type="button" data-open-audit-item>查看关联项</button>`);
  if (node.traceNodeId) actions.push(`<button class="ghost-button small" type="button" data-open-audit-trace>查看执行节点</button>`);
  if (node.relatedNodeId) actions.push(`<button class="ghost-button small" type="button" data-open-audit-related>定位关联节点</button>`);
  els.inspectorActions.innerHTML = actions.join("");
  els.inspectorActions.querySelector("[data-open-audit-raw]")?.addEventListener("click", () => {
    const index = node.eventIndex ?? node.sourceIndex;
    if (index == null) return;
    openRawEventFromAudit(index);
  });
  els.inspectorActions.querySelector("[data-open-audit-item]")?.addEventListener("click", () => {
    if (!node.itemRef) return;
    locateItemRef(node.itemRef);
  });
  els.inspectorActions.querySelector("[data-open-audit-trace]")?.addEventListener("click", () => {
    locateTraceNode(node.traceNodeId);
  });
  els.inspectorActions.querySelector("[data-open-audit-related]")?.addEventListener("click", () => {
    locateRelatedAuditNode(node);
  });
}

function auditNodeMatches(node, query, typeFilter) {
  if (query && !auditNodeSearchText(node).includes(query)) return false;
  if (typeFilter === "all") return true;
  return node.type === typeFilter;
}

function auditNodeSearchText(node) {
  const readable = readableAuditNode(node);
  return [
    node.id,
    node.type,
    node.title,
    node.summary,
    readable.title,
    readable.summary,
    readable.command,
    node.status,
    node.riskLevel,
    node.turnNumber,
    node.eventIndex,
    node.sourceIndex,
    node.itemRef,
    node.traceNodeId,
    node.toolName,
    node.callId,
    node.relatedType,
    node.relatedNodeId,
    ...(node.tags || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function auditNodeCounts(nodes) {
  return nodes.reduce(
    (counts, node) => {
      if (node.type in counts) counts[node.type] += 1;
      counts.total += 1;
      return counts;
    },
    { intent: 0, reasoning: 0, action: 0, evidence: 0, verification: 0, risk: 0, final: 0, total: 0 },
  );
}

function findAuditNode(id) {
  return (state.detail?.audit?.nodes || buildAuditFallback(state.detail)?.nodes || []).find((node) => node.id === id) || null;
}

function auditNodeDebugPreview(node) {
  const item = node.itemRef ? findItemByRef(node.itemRef) : null;
  return {
    ...node,
    summary: truncateText(node.summary, 4000),
    argumentsPreview: truncateText(node.argumentsPreview, 4000),
    outputPreview: truncateText(node.outputPreview, 8000),
    item: item ? itemDebugPreview(item) : null,
  };
}

function auditEventIndexLabel(node) {
  if (node.eventIndex == null && node.sourceIndex == null) return "";
  const parts = [];
  if (node.eventIndex != null) parts.push(`事件 ${node.eventIndex}`);
  if (node.sourceIndex != null && node.sourceIndex !== node.eventIndex) parts.push(`来源 ${node.sourceIndex}`);
  return parts.join(" / ");
}

function auditRelatedLabel(node) {
  if (!node.relatedNodeId) return "";
  const type = node.relatedType ? auditTypeLabel(node.relatedType) : "节点";
  const tool = node.toolName ? ` · ${node.toolName}` : "";
  return `关联 ${type} ${node.relatedNodeId}${tool}`;
}

function locateRelatedAuditNode(node) {
  if (!node?.relatedNodeId) return;
  const target = findAuditNode(node.relatedNodeId);
  if (!target) {
    showToast("未找到关联审计链节点");
    return;
  }
  if (state.viewMode !== "audit") {
    state.viewMode = "audit";
    cancelRemoteRefreshForNavigation();
    syncItemTypeFilterOptions();
  }
  renderMainContent();
  selectAuditNode(target.id);
  window.setTimeout(() => {
    const active = els.auditContent.querySelector(`[data-audit-node-id="${cssEscape(target.id)}"]`);
    if (active) {
      active.scrollIntoView({ behavior: preferredScrollBehavior(), block: "center" });
    } else {
      showToast("关联节点已在右侧显示；当前搜索或过滤隐藏了它");
    }
  }, 0);
}

function locateItemRef(ref) {
  if (!ref) return;
  const item = findItemByRef(ref);
  if (!item) {
    showToast("未找到关联项");
    return;
  }
  selectItemRef(ref);
  showToast("已在右侧显示关联项");
}

function locateTraceNode(id) {
  if (!id) return;
  const target = findTraceNode(state.detail?.trace?.root, id);
  if (!target) {
    showToast("未找到执行节点");
    return;
  }
  expandTraceAncestors(id);
  selectTraceNode(id);
  showToast("已在右侧显示执行节点");
}

function expandTraceAncestors(id, node = state.detail?.trace?.root, parents = []) {
  if (!node) return false;
  if (node.id === id) {
    for (const parentId of parents) state.expandedTraceNodeIds.add(parentId);
    return true;
  }
  for (const child of node.children || []) {
    if (expandTraceAncestors(id, child, [...parents, node.id])) return true;
  }
  return false;
}

function buildAuditFallback(detail) {
  const nodes = [];
  for (const turn of detail?.turns || []) {
    for (const item of turn.items || []) {
      const ref = itemRef(item);
      if (item.type === "user-message") {
        nodes.push(fallbackAuditNode("intent", item, ref, "用户意图", item.text));
      } else if (item.type === "reasoning") {
        nodes.push(fallbackAuditNode("reasoning", item, ref, "推理摘要", item.text || (item.encrypted ? "推理内容已加密存储。" : "")));
      } else if (item.type === "tool-call") {
        nodes.push(fallbackAuditNode("action", item, ref, item.name ? `工具调用 · ${item.name}` : "工具调用", item.arguments || item.name));
        if (item.output) nodes.push(fallbackAuditNode("evidence", item, ref, item.name ? `工具输出 · ${item.name}` : "工具输出", item.output, item.outputSourceIndex ?? item.sourceIndex));
      } else if (item.type === "assistant-message") {
        nodes.push(fallbackAuditNode(item.phase === "final" ? "final" : "reasoning", item, ref, item.phase === "final" ? "助手最终回复" : "助手消息", item.text));
      }
    }
  }
  return { nodes, counts: auditNodeCounts(nodes) };
}

function fallbackAuditNode(type, item, ref, title, summary, eventIndex = item.sourceIndex) {
  return {
    id: `audit:fallback:${type}:${ref}:${eventIndex ?? "x"}`,
    type,
    title,
    summary: firstLine(summary || "", 360),
    status: item.status || item.phase || "observed",
    timestamp: item.timestamp,
    turnIndex: item.turnIndex,
    turnNumber: (item.turnIndex ?? 0) + 1,
    eventIndex: eventIndex ?? null,
    sourceIndex: item.sourceIndex ?? null,
    itemRef: ref,
    traceNodeId: item.type === "tool-call" ? `item:${item.turnIndex}:${item.itemIndex}:${item.id || item.type}` : null,
    riskLevel: "none",
    tags: [type, item.name].filter(Boolean),
    toolName: item.name || null,
    callId: item.callId || null,
    truncated: Boolean(item.truncated),
  };
}

function auditTypeLabel(type) {
  if (type === "intent") return "意图";
  if (type === "reasoning") return "推理";
  if (type === "action") return "行动";
  if (type === "evidence") return "证据";
  if (type === "verification") return "验证";
  if (type === "risk") return "风险";
  if (type === "final") return "最终";
  return type || "节点";
}

function auditNodeGlyph(type) {
  if (type === "intent") return "I";
  if (type === "reasoning") return "R";
  if (type === "action") return ">";
  if (type === "evidence") return "$";
  if (type === "verification") return "V";
  if (type === "risk") return "!";
  if (type === "final") return "F";
  return "•";
}

function auditRiskLabel(level) {
  if (level === "high") return "高风险";
  if (level === "medium") return "中风险";
  if (level === "low") return "低风险";
  return "未标记风险";
}

function auditRiskMetaLabel(level) {
  return level && level !== "none" ? auditRiskLabel(level) : "";
}

function auditNodeLabel(node) {
  return `${auditTypeLabel(node.type)} · ${node.title || node.id}`;
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
  if (diagnostic.readState?.state === "changing") return "文件在读取中发生变化。已清空本次诊断结果，请重新开始读取。";
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
  if (diagnostic.error) return emptyState("原始事件诊断未完成", "请重新开始读取，旧页不会与新结果混合。");
  if (diagnostic.readState) return emptyState("原始事件诊断已停止", "文件状态已变化，请重新开始读取，不会展示旧页。");
  return emptyState("正在读取有界事件摘要", "正在从当前数据源读取第一页摘要。");
}

function rawDiagnosticResultsMarkup({ diagnostic, currentPage, events, selected }, header) {
  const canLoadNext = Boolean(currentPage.hasMore && !diagnostic.loading);
  const canLoadPrevious = diagnostic.pageIndex > 0 && !diagnostic.loading;
  return `
    <div class="raw-view-shell raw-diagnostic-shell">
      ${header}
      <div class="raw-view-layout">
        <div class="raw-view-list">
          ${events.length ? events.map((event) => renderRawViewEventRow(event)).join("") : `<div class="inspector-empty">当前页没有匹配的事件摘要。</div>`}
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
          ${selected ? renderRawEventInsight(selected, els.itemSearch.value.trim().toLowerCase()) : ""}
          <pre class="raw-preview">${escapeHtml(JSON.stringify(selected || { page: currentPage.page, readState: diagnostic.readState }, null, 2))}</pre>
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
    renderInspector();
  });
  els.rawContent.querySelector("[data-next-raw-page]")?.addEventListener("click", () => void loadRawDiagnosticPage());
}

async function loadRawDiagnosticPage({ restart = false, cursor = null } = {}) {
  if (!restart && showCachedNextRawDiagnosticPage()) return;
  const request = startRawDiagnosticPageRequest(restart, cursor);
  if (!request) return;
  renderRawView();
  try {
    const data = await fetchJson(sourceSessionEventsUrl(request.sessionId, request.sourceId, { cursor: request.cursor, snapshot: request.snapshot }), { signal: request.controller.signal });
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
      renderInspector();
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
  return { controller, cursor, snapshot: diagnostic.snapshot, diagnostic, diagnosticSessionKey, requestSeq: diagnostic.requestSeq, sessionId: detail.session.id, sourceId };
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
  if (!diagnostic.snapshot || currentPage?.snapshot !== diagnostic.snapshot || nextPage?.snapshot !== diagnostic.snapshot) return null;
  return nextPage;
}

function showCachedNextRawDiagnosticPage() {
  const diagnostic = state.rawDiagnostic;
  if (!diagnostic || diagnostic.loading || !rawDiagnosticCachedNextPage(diagnostic)) return false;
  diagnostic.pageIndex += 1;
  state.selectedEventIndex = null;
  renderRawView();
  renderInspector();
  return true;
}

function rawDiagnosticPageNumber(page, fallbackIndex) {
  return Number.isInteger(page?.pageNumber) ? page.pageNumber : fallbackIndex + 1;
}

function resetRawDiagnosticPages(diagnostic, { clearSelection = false, readState = null } = {}) {
  diagnostic.pages = [];
  diagnostic.pageIndex = 0;
  diagnostic.snapshot = "";
  diagnostic.readState = readState;
  clearRawEventCache();
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
  if (data.readState?.state === "changing") {
    resetRawDiagnosticPages(diagnostic, { readState: data.readState });
    return;
  }
  const page = { ...data.page, events: data.events || [], readState: data.readState || null };
  if (!rawDiagnosticPageMatchesRequest(request, page)) {
    resetRawDiagnosticPages(diagnostic);
    diagnostic.error = "原始事件诊断响应与当前分页不一致，请重新开始读取。";
    return;
  }
  page.pageNumber = rawDiagnosticNextPageNumber(diagnostic);
  diagnostic.snapshot = page.snapshot;
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
    && entry.snapshot === diagnostic.snapshot
    && retainedIndexes.has(entry.index)
  ));
}

function rawDiagnosticPageMatchesRequest(request, page) {
  return Number.isInteger(page.cursor)
    && page.cursor === request.cursor
    && Boolean(page.snapshot)
    && (!request.snapshot || page.snapshot === request.snapshot)
    && !request.diagnostic.pages.some((cachedPage) => cachedPage.cursor === page.cursor);
}

function rawDiagnosticNextPageNumber(diagnostic) {
  const lastPage = diagnostic.pages.at(-1);
  return lastPage ? rawDiagnosticPageNumber(lastPage, diagnostic.pages.length - 1) + 1 : 1;
}

function failRawDiagnosticPage(request, error) {
  if (!rawDiagnosticRequestIsCurrent(request)) return;
  if (isRawDiagnosticSnapshotInvalidated(error)) {
    const reset = resetRawDiagnosticForSnapshotChange({
      sourceId: request.sourceId,
      sessionId: request.sessionId,
      snapshot: request.snapshot,
      diagnostic: request.diagnostic,
    });
    if (reset) return;
  }
  resetRawDiagnosticPages(request.diagnostic);
  request.diagnostic.error = error.message;
}

function isRawDiagnosticSnapshotInvalidated(error) {
  return error?.status === 409 && ["session_snapshot_changed", "session_file_changed"].includes(error?.code);
}

function resetRawDiagnosticForSnapshotChange({ sourceId, sessionId, snapshot, diagnostic: requestDiagnostic }) {
  const diagnostic = state.rawDiagnostic;
  const diagnosticSessionKey = sessionKey({ id: sessionId, sourceId });
  if (
    !snapshot
    || state.selectedSourceId !== sourceId
    || state.selectedSessionKey !== diagnosticSessionKey
    || diagnostic !== requestDiagnostic
    || diagnostic?.sessionKey !== diagnosticSessionKey
    || diagnostic.snapshot !== snapshot
  ) return false;
  resetRawDiagnosticPages(diagnostic, { clearSelection: true });
  diagnostic.error = "会话文件或诊断快照已变化，已清空过期摘要、选择和完整事件缓存，请重新开始读取。";
  renderRawView();
  renderInspector();
  return true;
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
      <span class="raw-view-kind">${escapeHtml(event.kind || event.type || "event")}</span>
      <strong>${escapeHtml(`事件 ${event.index} ${humanEventTitle(event)}`)}</strong>
      <em>${escapeHtml(formatDate(event.timestamp) || event.payloadType || "")}</em>
      <span>${escapeHtml(firstLine(event.preview || "", 140))}</span>
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

async function openRawEventFromAudit(index) {
  const changed = state.viewMode !== "diagnostic" || state.diagnosticMode !== "raw";
  state.viewMode = "diagnostic";
  state.diagnosticMode = "raw";
  if (changed) cancelRemoteRefreshForNavigation();
  state.selectedEventIndex = index;
  syncViewControls();
  renderStats();
  await loadRawDiagnosticPage({ restart: true, cursor: index });
  await selectRawViewEvent(index);
  const active = els.rawContent.querySelector(`[data-raw-event-index="${index}"]`);
  active?.scrollIntoView({ behavior: preferredScrollBehavior(), block: "center" });
}

async function selectRawViewEvent(index) {
  await selectRawEvent(index, { rerender: false });
  renderRawView();
  renderInspector();
}


function renderTrace() {
  const detail = state.detail;
  if (!detail?.trace?.root) {
    els.traceContent.innerHTML = emptyState("没有执行链路数据", "当前会话没有可审计执行树。");
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
          <p class="eyebrow">审计链路</p>
          <h3 class="markdown-inline-title">${renderMarkdownTitle(detail.session.title || "未命名会话")}</h3>
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
  const durationLabel = node.durationMs == null ? "未记录" : formatDuration(node.durationMs);
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
  return `<div class="truncation-notice">已截断 ${escapeHtml(fields.join(", "))}，完整内容可在右侧调试 JSON 中按需查看。</div>`;
}

function renderDetails() {
  renderInspector();
}

function renderInspector() {
  const context = buildReviewContext();
  renderReviewHeader(context);
  renderReviewTabs();
  els.selectionDetails.innerHTML = renderReviewPanels(context);
  els.selectionDetails.tabIndex = 0;
  els.selectionDetails.setAttribute("aria-label", "复核内容，可使用方向键或 Page Up/Page Down 滚动");
  els.inspectorActions.innerHTML = renderReviewActions(context);
  bindReviewBodyActions(context);
  bindReviewActions(context);
  if (els.eventCount) els.eventCount.textContent = String(context.metrics?.events ?? 0);
  if (els.selectedEventLabel) els.selectedEventLabel.textContent = context.title || "未选择";
  if (els.rawPreview) els.rawPreview.textContent = context.debugData ? JSON.stringify(context.debugData, null, 2) : "";
  if (els.copyRawButton) {
    const label = context.kind === "session" ? "复制会话引用" : "复制对象引用";
    els.copyRawButton.textContent = label;
    els.copyRawButton.title = `${label}（复制当前复核上下文）`;
    els.copyRawButton.setAttribute("aria-label", label);
  }
  els.copyRawButton.disabled = !state.detail || context.kind === "prompt_archive";
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
          <span class="raw-event-title">${escapeHtml("事件 " + event.index + " " + humanEventTitle(event))}</span>
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
  state.selectedTerminalBlockId = null;
  state.selectedAuditNodeId = null;
  state.selectedAuditTurnKey = null;
  state.selectedEventIndex = index;
  const event = eventByIndex(index);
  if (!event) return;
  if (rerender) renderInspector();
}

async function loadRawEvent(index, { cancelPrevious = true } = {}) {
  const id = state.detail?.session?.id;
  if (!id) throw new Error("未选择会话");
  const sourceId = state.detail?.session?.sourceId || state.selectedSourceId;
  const requestSessionKey = sessionKey({ id, sourceId });
  const diagnostic = state.rawDiagnostic;
  const snapshot = rawDiagnosticSnapshotForEvent(index);
  const cacheKey = rawEventCacheKey(sourceId, id, index, snapshot);
  const cached = state.rawEventCache.get(cacheKey);
  if (cached !== undefined) return cached;
  if (cancelPrevious) cancelRawEventRequest();
  const controller = new AbortController();
  rawEventAbortController = controller;
  try {
    const raw = await fetchJson(sourceEventUrl(id, index, sourceId, snapshot), { signal: controller.signal });
    if (!rawEventRequestIsCurrent({ controller, sourceId, requestSessionKey, diagnostic, snapshot })) return null;
    if (rawEventStillInDiagnosticPages(diagnostic, index, snapshot)) {
      state.rawEventCache.remember(cacheKey, raw, { index, sessionKey: requestSessionKey, snapshot });
    }
    return raw;
  } catch (error) {
    if (isRawDiagnosticSnapshotInvalidated(error) && rawEventRequestIsCurrent({ controller, sourceId, requestSessionKey, diagnostic, snapshot })) {
      resetRawDiagnosticForSnapshotChange({ sourceId, sessionId: id, snapshot, diagnostic });
    }
    throw error;
  } finally {
    if (rawEventAbortController === controller) rawEventAbortController = null;
  }
}

function rawEventRequestIsCurrent({ controller, sourceId, requestSessionKey, diagnostic, snapshot }) {
  if (controller.signal.aborted || state.selectedSourceId !== sourceId || state.selectedSessionKey !== requestSessionKey) return false;
  if (!snapshot) return true;
  return state.rawDiagnostic === diagnostic && diagnostic?.sessionKey === requestSessionKey && diagnostic.snapshot === snapshot;
}

function rawEventCacheKey(sourceId, id, index, snapshot = "") {
  return JSON.stringify([sourceId || "local", id, index, snapshot]);
}

function rawDiagnosticSnapshotForEvent(index) {
  return state.rawDiagnostic?.pages.find((page) => page.events?.some((event) => event.index === index))?.snapshot || "";
}

function rawEventStillInDiagnosticPages(diagnostic, index, snapshot) {
  if (!snapshot) return true;
  return diagnostic?.pages.some((page) => page.snapshot === snapshot && page.events?.some((event) => event.index === index));
}

function selectTraceNode(id) {
  state.selectedTraceNodeId = id;
  const node = findTraceNode(state.detail?.trace?.root, id);
  if (!node) return;
  state.selectedEventIndex = null;
  state.selectedItemRef = null;
  state.selectedTerminalBlockId = null;
  state.selectedAuditNodeId = null;
  state.selectedAuditTurnKey = null;
  renderInspector();
  els.traceContent.querySelectorAll(".trace-row.selected").forEach((row) => row.classList.remove("selected"));
  const active = els.traceContent.querySelector(`[data-trace-node-id="${cssEscape(id)}"]`);
  active?.classList.add("selected");
  refreshAuditSelectionSurface();
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
  state.selectedAuditNodeId = null;
  state.selectedAuditTurnKey = null;
  state.selectedEventIndex = null;
  state.selectedTerminalBlockId = null;
  const item = findItemByRef(ref);
  if (!item) return;
  renderInspector();
  if (state.viewMode === "audit") {
    renderAudit();
  }
}

function renderSelectionDetails() {
  renderInspector();
}

function renderAuditSelection(node) {
  const relatedMeta = [
    node.relatedType ? auditTypeLabel(node.relatedType) : "",
    node.relatedNodeId || "",
    node.toolName ? `工具 ${node.toolName}` : "",
    auditEventIndexLabel(node),
  ]
    .filter(Boolean)
    .join(" · ");
  const rows = [
    ["节点类型", auditTypeLabel(node.type)],
    ["状态", node.status || "未记录"],
    ["风险信号", auditRiskLabel(node.riskLevel || "none")],
    ["轮次", node.turnNumber ? String(node.turnNumber) : "未记录"],
    ["时间", formatDate(node.timestamp) || "未记录"],
    ["关联项引用", node.itemRef || "未记录"],
    ["事件索引", auditEventIndexLabel(node) || "未记录"],
  ];
  if (node.traceNodeId) rows.push(["执行节点", node.traceNodeId]);
  if (node.relatedNodeId) rows.push(["关联来源", relatedMeta || node.relatedNodeId]);
  if (node.toolName) rows.push(["工具", node.toolName]);
  if (node.callId) rows.push(["调用 ID", node.callId]);
  if (node.tags?.length) rows.push(["标签", node.tags.join(", ")]);
  const body = [node.summary, node.outputPreview, node.argumentsPreview].filter(Boolean).join("\n\n");
  return renderSelectionCard({
    eyebrow: "审计链节点",
    title: node.title || auditTypeLabel(node.type),
    meta: [auditTypeLabel(node.type), auditRiskLabel(node.riskLevel || "none")].filter(Boolean).join(" · "),
    rows,
    body: body ? firstLine(body, 1100) : "",
    actions: auditSelectionActions(node),
  });
}

function renderAuditTurnSelection(turn) {
  const rows = [
    ["轮次", String(turn.turnNumber)],
    ["验证状态", turn.stats.verificationStatus],
    ["最高风险", turn.stats.riskLabel],
    ["工具调用", String(turn.stats.toolCount)],
    ["子代理", String(turn.stats.subagentCount)],
    ["证据", String(turn.stats.evidenceCount)],
    ["缺口", String(turn.stats.gapCount)],
  ];
  const body = [`目标：${turn.intentSummary}`, `结果：${turn.finalSummary}`].join("\n");
  return renderSelectionCard({
    eyebrow: "轮次审计摘要",
    title: `第 ${turn.turnNumber} 轮`,
    meta: [turn.stats.verificationStatus, turn.stats.riskLabel].filter(Boolean).join(" · "),
    rows,
    body,
    actions: auditTurnSelectionActions(turn),
  });
}

function renderTraceSelection(node) {
  const detail = node.detail || {};
  const item = detail.item || {};
  const thread = detail.thread || detail.edge?.thread || {};
  const rows = [
    ["类型", traceTypeLabel(node.type)],
    ["状态", node.status || "未记录"],
    ["时间", [formatDate(node.timestamp), formatDate(node.completedAt)].filter(Boolean).join(" - ") || "未记录"],
    ["耗时", node.durationMs == null ? "未记录" : `${formatDuration(node.durationMs)}${node.durationEstimated ? " 估算" : ""}`],
  ];
  if (item.name) rows.push(["工具", item.name]);
  if (thread.id || node.threadId) rows.push(["线程", thread.agentNickname || thread.title || node.threadId || thread.id]);
  const body = item.output || item.arguments || item.text || node.subtitle || detail.note || "";
  const actions = traceSelectionActions(node, body);
  return renderSelectionCard({
    eyebrow: "执行节点",
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
    ["轮次", item.turnIndex == null ? "未记录" : String(item.turnIndex + 1)],
    ["时间", formatDate(item.timestamp) || "未记录"],
    ["状态", [item.phase, item.status].filter(Boolean).join(" / ") || "未记录"],
  ];
  if (item.name) rows.push(["工具", item.name]);
  if (item.callId) rows.push(["调用 ID", item.callId]);
  const body = item.text || item.output || item.arguments || item.payloadPreview || "";
  const actions = itemSelectionActions(item);
  return renderSelectionCard({
    eyebrow: "关联项",
    title: itemTitle(item),
    meta: item.name || item.responseType || item.eventType || "",
    rows,
    body: body ? firstLine(body, 900) : "",
    actions,
  });
}

function renderEventSelection(event) {
  const rows = [
    ["事件", `事件 ${event.index}`],
    ["分类", event.kind || "未记录"],
    ["时间", formatDate(event.timestamp) || "未记录"],
    ["原始内容", event.payloadSize ? formatBytes(event.payloadSize) : "未记录"],
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
      try {
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
        if (action.action === "open-raw-event") {
          await openRawEventFromAudit(action.index);
          return;
        }
        if (action.action === "open-item-ref") {
          locateItemRef(action.ref);
          return;
        }
        if (action.action === "open-trace-node") {
          locateTraceNode(action.id);
          return;
        }
        if (action.action === "open-audit-node") {
          locateRelatedAuditNode(action.node);
          return;
        }
        if (action.copy != null) await copyInspectorText(action.copy, action.toast || "已复制", { sensitive: action.sensitive !== false });
      } catch (error) {
        reportReviewActionFailure(error);
      }
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
  if (state.selectedAuditNodeId) {
    const node = findAuditNode(state.selectedAuditNodeId);
    return node ? auditSelectionActions(node) : [];
  }
  if (state.selectedAuditTurnKey) {
    const turn = findAuditTurn(state.selectedAuditTurnKey);
    return turn ? auditTurnSelectionActions(turn) : [];
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

function auditSelectionActions(node) {
  const readable = readableAuditNode(node);
  const actions = [
    { label: "复制摘要", copy: readable.summary || node.summary || node.title || node.id, toast: "已复制审计摘要" },
    { label: "复制 JSON", action: "copy-debug" },
  ];
  if (node.eventIndex != null || node.sourceIndex != null) {
    actions.unshift({ label: "跳到原始事件", action: "open-raw-event", index: node.eventIndex ?? node.sourceIndex });
    actions.push({ label: "复制事件索引", copy: String(node.eventIndex ?? node.sourceIndex), toast: "已复制事件索引", sensitive: false });
  }
  if (node.itemRef) actions.unshift({ label: "查看关联项", action: "open-item-ref", ref: node.itemRef });
  if (node.traceNodeId) actions.push({ label: "查看执行节点", action: "open-trace-node", id: node.traceNodeId });
  if (node.relatedNodeId) actions.unshift({ label: "定位关联节点", action: "open-audit-node", node });
  return actions;
}

function auditTurnSelectionActions(turn) {
  return [
    { label: "复制摘要", copy: `第 ${turn.turnNumber} 轮\n目标：${turn.intentSummary}\n结果：${turn.finalSummary}`, toast: "已复制轮次审计摘要" },
    { label: "复制 JSON", action: "copy-debug" },
  ];
}

function traceSelectionActions(node, body = "") {
  const readable = node.detail?.item ? readableToolItem(node.detail.item) : null;
  const actions = [{ label: "复制 JSON", action: "copy-debug" }];
  if (readable?.summary || body) actions.unshift({ label: "复制摘要", copy: readable?.summary || body, toast: "已复制节点摘要" });
  if (node.type === "subagent" && node.threadId) actions.unshift({ label: "打开子会话", action: "open-thread", threadId: node.threadId });
  return actions;
}

function itemSelectionActions(item) {
  const actions = [{ label: "复制 JSON", action: "copy-debug" }];
  const readable = readableToolItem(item);
  const body = readable.summary || item.text || item.output || item.arguments || item.payloadPreview || "";
  if (body) actions.unshift({ label: "复制内容", copy: body, toast: "已复制内容" });
  if (item.sourceIndex != null || item.outputSourceIndex != null) {
    actions.push({ label: "跳到原始事件", action: "open-raw-event", index: item.sourceIndex ?? item.outputSourceIndex });
  }
  return actions;
}

function buildReviewContext() {
  if (state.sidebarMode === "prompts") {
    return reviewContextBase({
      kind: "prompt_archive",
      kindLabel: "任务归档",
      title: "任务归档未打开会话",
      summary: "当前正在浏览任务归档。打开原会话后，复核台会恢复为该会话的摘要、证据、关系和来源。",
      metrics: { events: 0, evidence: 0, relations: 0 },
    });
  }
  if (!state.detail) {
    if (state.sessionLoading) {
      return reviewContextBase({
        kind: "loading",
        kindLabel: "读取中",
        title: "正在读取目标会话",
        summary: `${selectedSessionDisplayTitle()} · 正在解析会话正文、事件和审计链。`,
        badges: [selectedSource()?.label || "当前数据源"],
        metrics: { events: 0, evidence: 0, relations: 0 },
      });
    }
    if (state.sessionLoadError) {
      return reviewContextBase({
        kind: "error",
        kindLabel: "读取失败",
        title: "无法读取目标会话",
        riskLevel: "medium",
        summary: `${selectedSessionDisplayTitle()} · ${state.sessionLoadError}`,
        badges: [selectedSource()?.label || "当前数据源"],
        metrics: { events: 0, evidence: 0, relations: 0 },
      });
    }
    return reviewContextBase({
      kind: "empty",
      kindLabel: "未选择",
      title: "选择一个会话",
      summary: "左侧选择会话后，复核台会显示当前对象的摘要、证据、关系和来源。",
    });
  }
  if (state.detail.readState?.state === "changing") {
    const readState = state.detail.readState || {};
    return reviewContextBase({
      kind: "changing",
      kindLabel: "文件变化",
      title: "会话文件正在变化",
      summary: "读取期间文件发生变化，未展示可能过期的正文、审计链或风险结论。请重新读取会话。",
      badges: [readState.code || "session_file_changed"],
      metrics: { events: 0, evidence: 0, relations: 0 },
    });
  }
  if (state.selectedTraceNodeId) {
    const node = findTraceNode(state.detail.trace?.root, state.selectedTraceNodeId);
    if (node) return buildTraceReviewContext(node);
  }
  if (state.selectedAuditNodeId) {
    const node = findAuditNode(state.selectedAuditNodeId);
    if (node) return buildAuditNodeReviewContext(node);
  }
  if (state.selectedAuditTurnKey) {
    const turn = findAuditTurn(state.selectedAuditTurnKey);
    if (turn) return buildAuditTurnReviewContext(turn);
  }
  if (state.selectedItemRef) {
    const item = findItemByRef(state.selectedItemRef);
    if (item) return buildItemReviewContext(item);
  }
  if (state.selectedEventIndex != null) {
    const event = eventByIndex(state.selectedEventIndex);
    if (event) return buildRawEventReviewContext(event);
  }
  return buildSessionBriefReviewContext(state.detail);
}

function reviewContextBase(overrides = {}) {
  return {
    kind: "object",
    kindLabel: "对象",
    title: "未命名对象",
    riskLevel: "none",
    badges: [],
    summary: "",
    rows: [],
    metrics: {},
    evidence: [],
    relations: [],
    sources: [],
    actions: [],
    debugData: null,
    ...overrides,
  };
}

function buildSessionBriefReviewContext(detail) {
  const session = detail.session || {};
  const stats = detail.stats || {};
  const audit = detail.audit || buildAuditFallback(detail) || { nodes: [] };
  const nodes = audit.nodes || [];
  const risks = nodes.filter((node) => node.type === "risk" || (node.riskLevel && node.riskLevel !== "none"));
  const verification = nodes.filter((node) => node.type === "verification");
  const finalNode = [...nodes].reverse().find((node) => node.type === "final");
  const childThreads = detail.trace?.hierarchy?.children || [];
  const tokenUsage = latestTokenUsage(detail.turns || []);
  const startedAt = session.startedAt || detail.turns?.[0]?.startedAt || stats.timing?.startedAt;
  const endedAt = session.updatedAt || session.fileModifiedAt || detail.turns?.at(-1)?.completedAt || stats.timing?.completedAt;
  const duration = durationBetween(startedAt, endedAt);
  const metrics = {
    events: stats.eventCount ?? detail.events?.length ?? 0,
    evidence: verification.length,
    relations: risks.length + childThreads.length,
    risks: risks.length,
    turns: stats.turnCount ?? detail.turns?.length ?? 0,
    tools: countItems("tool-call"),
    tokens: tokenUsage ? compactNumber(tokenUsage.total_tokens || tokenUsage.totalTokens || 0) : "未记录",
  };
  const evidence = [
    ...verification.slice(0, 8).map(reviewEvidenceFromAuditNode),
    ...risks.slice(0, 8).map(reviewEvidenceFromAuditNode),
  ];
  if (!evidence.length) {
    evidence.push({
      kind: "概览",
      title: "没有优先风险或缺口",
      meta: "会话概览",
      body: "从审计链视图选择轮次、执行节点或证据节点后，复核台会切换到对象级复核。",
    });
  }
  return reviewContextBase({
    kind: "session",
    evidenceId: sessionEvidenceId(session),
    kindLabel: "会话概览",
    title: session.title || "未命名会话",
    riskLevel: highestRiskLevel(risks),
    badges: [session.dataSourceKind === "remote" ? "远端快照" : "本机只读", `${metrics.turns} 轮次`, `${metrics.events} 事件`],
    summary: auditNodeFullBody(finalNode) || finalNode?.summary || "当前会话的默认复核入口。选择审计链节点、工具调用、原始事件或子代理后，右侧会切换到对象级复核。",
    rows: [
      ["数据源", session.sourceLabel || selectedSource()?.label || "本机 Codex Home"],
      ["模型", [session.model, session.reasoningEffort].filter(Boolean).join(" / ") || "未记录"],
      ["工作目录", session.cwd || "无项目"],
      ["时间范围", [formatDate(startedAt), formatDate(endedAt)].filter(Boolean).join(" - ") || "未记录"],
      ["持续时间", duration == null ? "未记录" : formatDuration(duration)],
      ["上下文占用", metrics.tokens],
      ["数据文件", session.relativePath || "未记录"],
    ],
    metrics,
    evidence,
    relations: [
      ...risks.slice(0, 8).map((node) => reviewRelationFromAuditNode(node, "优先复核")),
      ...childThreads.slice(0, 8).map((child) => ({
        kind: "子代理",
        title: child.thread?.agentNickname || child.childThreadId,
        meta: child.thread?.title || child.thread?.agentRole || "",
        action: "open-thread",
        threadId: child.childThreadId,
      })),
    ],
    sources: [
      { label: "会话详情（技术）", value: session.id || "未记录", data: { session, stats } },
      { label: "数据文件", value: stats.dataPath || session.relativePath || "未记录", data: stats.dataPath || session.relativePath || "" },
    ],
    actions: [
      { label: "复制会话引用", action: "copy-reference" },
      { label: "复制 Markdown", action: "copy-markdown" },
      { label: "复制会话 ID", copy: session.id || "", toast: "已复制会话 ID", sensitive: false },
      { label: "复制证据包", action: "copy-evidence" },
    ],
    debugData: { session, stats, metrics, auditCounts: audit.counts || auditNodeCounts(nodes) },
  });
}

function buildAuditNodeReviewContext(node) {
  const item = node.itemRef ? findItemByRef(node.itemRef) : null;
  const related = node.relatedNodeId ? findAuditNode(node.relatedNodeId) : null;
  const traceNode = node.traceNodeId ? findTraceNode(state.detail?.trace?.root, node.traceNodeId) : null;
  const event = eventByIndex(node.eventIndex ?? node.sourceIndex);
  const readable = readableAuditNode(node, item);
  const body = auditNodeFullBody(node, readable, item);
  const evidence = [reviewEvidenceFromAuditNode(node)];
  if (item) evidence.push(reviewEvidenceFromItem(item, "关联项"));
  if (event) evidence.push(reviewEvidenceFromEvent(event, "来源事件"));
  const relations = [
    related ? reviewRelationFromAuditNode(related, "关联节点") : null,
    traceNode ? reviewRelationFromTraceNode(traceNode, "执行节点") : null,
    item ? reviewRelationFromItem(item, "关联项") : null,
    event ? reviewRelationFromEvent(event, "原始事件") : null,
  ].filter(Boolean);
  return reviewContextBase({
    kind: "audit_node",
    evidenceId: auditNodeEvidenceId(node),
    kindLabel: "审计链节点",
    title: readable.title || node.title || auditTypeLabel(node.type),
    riskLevel: node.riskLevel || "none",
    badges: [auditTypeLabel(node.type), node.turnNumber ? `第 ${node.turnNumber} 轮` : "未定位轮次", auditEventIndexLabel(node)].filter(Boolean),
    summary: body || "该审计链节点没有摘要正文。",
    changeSet: readable.changeSet,
    rows: [
      ["节点类型", auditTypeLabel(node.type)],
      ["状态", node.status || "未记录"],
      ["风险信号", auditRiskLabel(node.riskLevel || "none")],
      ["轮次", node.turnNumber ? String(node.turnNumber) : "未记录"],
      ["时间", formatDate(node.timestamp) || "未记录"],
      ["关联项引用", node.itemRef || "未记录"],
      ["事件索引", auditEventIndexLabel(node) || "未记录"],
      ["工具", node.toolName || "未记录"],
    ],
    metrics: { events: Number(node.eventIndex != null || node.sourceIndex != null), evidence: evidence.length, relations: relations.length },
    evidence,
    relations,
    sources: buildSourceRefs({ eventIndex: node.eventIndex ?? node.sourceIndex, item, node, traceNode }),
    actions: auditSelectionActions(node),
    debugData: auditNodeDebugPreview(node),
  });
}

function buildAuditTurnReviewContext(turn) {
  const riskNodes = turn.auditNodes.filter((node) => node.type === "risk" || (node.riskLevel && node.riskLevel !== "none"));
  const evidenceNodes = turn.auditNodes.filter((node) => ["evidence", "verification", "risk"].includes(node.type));
  const relations = [
    ...turn.executionRows.slice(0, 12).map((row) => {
      const readable = readableExecutionRow(row);
      return {
        kind: "执行",
        title: readable.title || row.title || row.id,
        meta: [readable.summary, row.type, row.status].filter(Boolean).join(" · "),
        action: row.traceNodeId ? "open-trace-node" : row.itemRef ? "open-item-ref" : "",
        id: row.traceNodeId,
        ref: row.itemRef,
      };
    }),
    ...turn.unlinkedAuditNodes.slice(0, 6).map((node) => reviewRelationFromAuditNode(node, "未关联")),
  ];
  return reviewContextBase({
    kind: "audit_turn",
    evidenceId: auditTurnEvidenceId(turn),
    kindLabel: "轮次审计",
    title: `第 ${turn.turnNumber} 轮`,
    riskLevel: highestRiskLevel(riskNodes),
    badges: [turn.stats.verificationStatus, turn.stats.riskLabel, `${turn.auditNodes.length} 个审计节点`].filter(Boolean),
    summary: [`目标：${auditTurnIntentBody(turn)}`, `结果：${auditTurnFinalBody(turn)}`].join("\n"),
    rows: [
      ["轮次", String(turn.turnNumber)],
      ["验证状态", turn.stats.verificationStatus],
      ["最高风险", turn.stats.riskLabel],
      ["工具调用", String(turn.stats.toolCount)],
      ["子代理", String(turn.stats.subagentCount)],
      ["证据", String(turn.stats.evidenceCount)],
      ["缺口", String(turn.stats.gapCount)],
    ],
    metrics: {
      events: turn.auditNodes.filter((node) => node.eventIndex != null || node.sourceIndex != null).length,
      evidence: evidenceNodes.length,
      relations: relations.length,
    },
    evidence: evidenceNodes.length
      ? evidenceNodes.slice(0, 14).map(reviewEvidenceFromAuditNode)
      : [{ kind: "轮次", title: "没有独立证据节点", meta: "审计链", body: "展开审计链视图可以查看本轮次的执行链。" }],
    relations,
    sources: [{ label: "轮次复核模型", value: turn.key, data: auditTurnDebugPreview(turn) }],
    actions: auditTurnSelectionActions(turn),
    debugData: auditTurnDebugPreview(turn),
  });
}

function buildTraceReviewContext(node) {
  const detail = node.detail || {};
  const item = fullItemForTraceNode(node) || detail.item || null;
  const thread = detail.thread || detail.edge?.thread || {};
  const readable = item ? readableToolItem(item) : null;
  const itemRefValue = itemRefFromTraceNode(node) || (item ? itemRef(item) : null);
  const linkedAuditNodes = auditNodesForItemRef(itemRefValue);
  const body = bestAuditBodyForItem(linkedAuditNodes) || readable?.body || readable?.summary || item?.text || item?.output || item?.arguments || node.subtitle || detail.note || "";
  const childRelations = (node.children || []).slice(0, 10).map((child) => reviewRelationFromTraceNode(child, "下游"));
  return reviewContextBase({
    kind: "trace_node",
    evidenceId: traceNodeEvidenceId(node),
    kindLabel: "执行节点",
    title: readable?.title || node.title || node.label || node.id,
    riskLevel: traceRiskLevel(node, item),
    badges: [traceTypeLabel(node.type), node.status, item?.sourceIndex != null ? `事件 ${item.sourceIndex}` : ""].filter(Boolean),
    summary: body || node.subtitle || "该执行节点没有可显示的正文摘要。",
    changeSet: readable?.changeSet,
    rows: [
      ["类型", traceTypeLabel(node.type)],
      ["状态", node.status || "未记录"],
      ["时间", [formatDate(node.timestamp), formatDate(node.completedAt)].filter(Boolean).join(" - ") || "未记录"],
      ["耗时", node.durationMs == null ? "未记录" : `${formatDuration(node.durationMs)}${node.durationEstimated ? " 估算" : ""}`],
      ["工具", item?.name || "未记录"],
      ["线程", thread.agentNickname || thread.title || node.threadId || thread.id || "未记录"],
    ],
    metrics: { events: item?.sourceIndex != null ? 1 : 0, evidence: item ? 1 : 0, relations: childRelations.length },
    evidence: item ? [reviewEvidenceFromItem(item, "节点明细")] : [{ kind: "执行", title: node.label || node.id, meta: node.status || "", body: node.subtitle || "" }],
    relations: [
      itemRefValue ? { kind: "关联项", title: itemTitle(item), meta: itemRefValue, action: "open-item-ref", ref: itemRefValue } : null,
      node.type === "subagent" && node.threadId ? { kind: "子会话", title: thread.agentNickname || node.threadId, meta: thread.title || "", action: "open-thread", threadId: node.threadId } : null,
      ...childRelations,
    ].filter(Boolean),
    sources: buildSourceRefs({ eventIndex: item?.sourceIndex ?? item?.outputSourceIndex, item, traceNode: node }),
    actions: traceSelectionActions(node, body),
    debugData: traceNodePreview(node),
  });
}

function buildItemReviewContext(item) {
  const ref = itemRef(item);
  const event = eventByIndex(item.sourceIndex ?? item.outputSourceIndex);
  const linkedAuditNodes = auditNodesForItemRef(ref);
  const readable = readableToolItem(item);
  const body = bestAuditBodyForItem(linkedAuditNodes) || readable.body || readable.summary || item.text || item.output || item.arguments || item.payloadPreview || "";
  return reviewContextBase({
    kind: "item",
    evidenceId: itemEvidenceId(item),
    kindLabel: itemTitle(item),
    title: readable.title || itemTitle(item),
    riskLevel: itemRiskLevel(item, linkedAuditNodes),
    badges: [item.turnIndex == null ? "未定位轮次" : `第 ${item.turnIndex + 1} 轮`, item.name, item.sourceIndex != null ? `事件 ${item.sourceIndex}` : ""].filter(Boolean),
    summary: body || "该关联项没有正文摘要。",
    changeSet: readable.changeSet,
    rows: [
      ["类型", itemTitle(item)],
      ["轮次", item.turnIndex == null ? "未记录" : String(item.turnIndex + 1)],
      ["时间", formatDate(item.timestamp) || "未记录"],
      ["状态", [item.phase, item.status].filter(Boolean).join(" / ") || "未记录"],
      ["工具", item.name || "未记录"],
      ["调用 ID", item.callId || "未记录"],
      ["事件索引", item.sourceIndex != null ? `事件 ${item.sourceIndex}` : "未记录"],
    ],
    metrics: { events: item.sourceIndex != null || item.outputSourceIndex != null ? 1 : 0, evidence: linkedAuditNodes.length || (body ? 1 : 0), relations: linkedAuditNodes.length },
    evidence: [reviewEvidenceFromItem(item, "关联项"), ...linkedAuditNodes.slice(0, 8).map(reviewEvidenceFromAuditNode)],
    relations: [...linkedAuditNodes.slice(0, 10).map((node) => reviewRelationFromAuditNode(node, "审计链")), event ? reviewRelationFromEvent(event, "原始事件") : null].filter(Boolean),
    sources: buildSourceRefs({ eventIndex: item.sourceIndex ?? item.outputSourceIndex, item }),
    actions: itemSelectionActions(item),
    debugData: itemDebugPreview(item),
  });
}

function buildRawEventReviewContext(event) {
  const linkedItems = itemsForEventIndex(event.index);
  const linkedAuditNodes = auditNodesForEventIndex(event.index);
  const readable = readableRawEvent(event);
  const compactEvidence = compactReplacementReviewEvidence(event);
  const rows = [
    ["事件", `事件 ${event.index}`],
    ["分类", event.kind || "未记录"],
    ["类型", [event.type, event.payloadType, event.role].filter(Boolean).join(" / ") || "未记录"],
    ["时间", formatDate(event.timestamp) || "未记录"],
    ["原始内容", event.payloadSize ? formatBytes(event.payloadSize) : "未记录"],
    ...compactReviewRows(event),
  ];
  const summary = isCompactEvent(event) ? readable.body || readable.summary || event.preview : readable.summary || event.preview || "原始事件没有预览正文。";
  return reviewContextBase({
    kind: "raw_event",
    evidenceId: rawEventEvidenceId(event),
    kindLabel: "原始事件",
    title: `事件 ${event.index} ${readable.title || humanEventTitle(event)}`,
    riskLevel: rawEventRiskLevel(event, linkedAuditNodes),
    badges: [event.kind || event.type || "事件", formatDate(event.timestamp) || "", event.payloadSize ? formatBytes(event.payloadSize) : ""].filter(Boolean),
    summary,
    changeSet: readable.changeSet,
    rows,
    metrics: { events: 1, evidence: linkedAuditNodes.length + compactEvidence.length, relations: linkedItems.length + linkedAuditNodes.length },
    evidence: [reviewEvidenceFromEvent(event, "事件预览"), ...compactEvidence, ...linkedAuditNodes.slice(0, 8).map(reviewEvidenceFromAuditNode)],
    relations: [...linkedItems.slice(0, 10).map((item) => reviewRelationFromItem(item, "关联项")), ...linkedAuditNodes.slice(0, 10).map((node) => reviewRelationFromAuditNode(node, "审计链"))],
    sources: [{ label: "完整原始事件", value: `事件 ${event.index}`, eventIndex: event.index, data: event, lazy: true }],
    actions: rawEventSelectionActions(event),
    debugData: event,
  });
}

function compactReviewRows(event) {
  const compact = event?.compact;
  if (!compact) return [];
  return [
    ["压缩阶段", compact.phase || "未记录"],
    ["窗口", compact.windowNumber == null ? "未记录" : String(compact.windowNumber)],
    ["替换历史", compact.replacementHistoryCount == null ? "未记录" : String(compact.replacementHistoryCount)],
    ["当前窗口", compact.windowId || "未记录"],
    ["上一窗口", compact.previousWindowId || "未记录"],
  ];
}

function compactReplacementReviewEvidence(event) {
  const compact = event?.compact;
  const preview = Array.isArray(compact?.replacementHistoryPreview) ? compact.replacementHistoryPreview : [];
  if (!preview.length) return [];
  const total = compact.replacementHistoryCount ?? preview.length;
  const more = Math.max(0, total - preview.length);
  return [
    {
      kind: "上下文压缩",
      title: `被替换的对话 (${preview.length}${more ? ` / ${total}` : ""})`,
      meta: [compact.windowNumber != null ? `窗口 ${compact.windowNumber}` : "", more ? `还有 ${more} 条在原始 JSON` : ""].filter(Boolean).join(" · "),
      body: preview.map(compactReplacementReviewLine).join("\n"),
      action: "open-raw-event",
      index: event.index,
      actionLabel: "打开原始事件",
    },
  ];
}

function compactReplacementReviewLine(entry = {}) {
  const meta = [
    entry.textLength != null ? `${compactNumber(entry.textLength)} 字符` : "",
    entry.turnId ? `轮次 ID ${compactReplacementShortId(entry.turnId)}` : "",
    entry.type,
  ]
    .filter(Boolean)
    .join(" · ");
  return `替换记录 ${entry.index ?? ""} ${compactReplacementRoleLabel(entry.role)}${meta ? ` · ${meta}` : ""}\n${entry.preview || "[无文本内容]"}`;
}

function syncReviewPanelHeading() {
  const header = els.inspectorActions?.closest(".inspector")?.querySelector(".panel-header");
  const eyebrow = header?.querySelector(".eyebrow");
  const heading = header?.querySelector("h2");
  if (eyebrow) eyebrow.textContent = "复核台";
  if (heading) heading.textContent = "复核对象";
}

function renderReviewHeader(context) {
  syncReviewPanelHeading();
  if (!state.detail) {
    els.sessionDetails.innerHTML = `
      <div class="review-object-head empty risk-${escapeAttr(context.riskLevel || "none")}" data-evidence-id="${escapeAttr(reviewContextEvidenceId(context))}">
        <span class="review-kind">${escapeHtml(context.kindLabel || "未选择")}</span>
        <strong>${escapeHtml(context.title || "选择一个会话")}</strong>
        <p>${escapeHtml(context.summary || "复核台会显示当前对象的摘要、证据、关系和来源。")}</p>
      </div>
    `;
    return;
  }
  els.sessionDetails.innerHTML = `
    <div class="review-object-head risk-${escapeAttr(context.riskLevel || "none")}" data-evidence-id="${escapeAttr(reviewContextEvidenceId(context))}">
      <div class="review-object-topline">
        <span class="review-kind">${escapeHtml(context.kindLabel || "对象")}</span>
        <span class="review-risk">${escapeHtml(auditRiskLabel(context.riskLevel || "none"))}</span>
      </div>
      <strong class="review-object-title markdown-inline-title">${renderMarkdownTitle(context.title || "未命名对象")}</strong>
      <div class="review-object-meta">
        ${(context.badges || []).map((badge) => `<span>${escapeHtml(badge)}</span>`).join("")}
      </div>
    </div>
  `;
}

function reviewContextEvidenceId(context) {
  return context.evidenceId || buildEvidenceId({ ...evidenceScopeForSession(), entity: context.kind || "object" });
}

function renderReviewTabs() {
  const allowed = new Set(["summary", "evidence", "relations", "source"]);
  if (!allowed.has(state.reviewTab)) state.reviewTab = "summary";
  els.reviewTabs?.querySelectorAll("[data-review-tab]").forEach((button) => {
    const active = button.dataset.reviewTab === state.reviewTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
    button.tabIndex = active ? 0 : -1;
  });
}

function setReviewTab(tab) {
  const next = tab || "summary";
  const changed = state.reviewTab !== next;
  if (changed && state.reviewTab === "source") cancelRawEventRequest();
  state.reviewTab = next;
  if (changed) cancelRemoteRefreshForNavigation();
  renderInspector();
}

function renderReviewPanels(context) {
  const tabs = ["summary", "evidence", "relations", "source"];
  return tabs
    .map((tab) => {
      const active = tab === state.reviewTab;
      return `<section class="review-tab-panel" id="reviewPanel${tab[0].toUpperCase()}${tab.slice(1)}" role="tabpanel" aria-labelledby="reviewTab${tab[0].toUpperCase()}${tab.slice(1)}"${active ? "" : " hidden"}>${renderReviewBody(context, tab)}</section>`;
    })
    .join("");
}

function renderReviewBody(context, tab = state.reviewTab) {
  if (context.kind === "prompt_archive") return renderReviewEmpty(context.title, context.summary);
  if (!state.detail) return renderReviewEmpty(context.title || "未选择会话", context.summary || "左侧选择会话后，复核台会显示会话概览。");
  if (tab === "evidence") return renderReviewEvidence(context);
  if (tab === "relations") return renderReviewRelations(context);
  if (tab === "source") return renderReviewSource(context);
  return renderReviewSummary(context);
}

function renderReviewSummary(context) {
  const metrics = context.metrics || {};
  const patchModel = reviewPatchSummaryModel(context.summary, context.changeSet);
  const commandModel = patchModel ? null : reviewCommandOutputModel(context);
  return `
    <div class="review-section review-summary-section">
      <div class="section-title-row">
        <h3>摘要</h3>
        <span class="muted">${escapeHtml(context.kindLabel || "对象")}</span>
      </div>
      ${renderReviewSummaryText(context.summary || "没有摘要。", { patchModel, commandModel })}
      ${patchModel || commandModel ? "" : renderChangeSetSummary(context.changeSet, { maxFiles: 9 })}
      <div class="review-metric-grid">
        ${renderReviewMetric("证据", metrics.evidence ?? 0)}
        ${renderReviewMetric("关系", metrics.relations ?? 0)}
        ${renderReviewMetric("事件", metrics.events ?? 0)}
        ${renderReviewMetric("风险", metrics.risks ?? riskMetricValue(context.riskLevel))}
      </div>
    </div>
  `;
}

function renderReviewSummaryText(summary, options = {}) {
  if (options.patchModel) return renderReviewPatchSummaryText(options.patchModel);
  if (options.commandModel) return renderReviewCommandOutputText(options.commandModel);
  const model = reviewSummaryTextModel(summary);
  return `
    <div class="review-summary-text ${model.items.length ? "has-items" : ""}">
      <p class="review-summary-lead">${escapeHtml(model.lead)}</p>
      ${
        model.items.length
          ? `<div class="review-summary-items">
              ${model.items
                .map(
                  (item) => `
                    <div class="review-summary-item">
                      ${item.label ? `<span>${escapeHtml(item.label)}</span>` : ""}
                      <strong>${escapeHtml(item.text)}</strong>
                    </div>
                  `,
                )
                .join("")}
            </div>`
          : ""
      }
    </div>
  `;
}

function reviewPatchSummaryModel(summary, changeSet) {
  return window.ToolSummary?.patchBodyModel?.(summary, changeSet) || null;
}

function renderReviewPatchSummaryText(model) {
  const stat = model.additions || model.deletions ? `+${model.additions || 0} -${model.deletions || 0}` : "无行级统计";
  return `
    <div class="review-summary-text has-items review-patch-summary">
      <p class="review-summary-lead review-patch-lead">
        <span class="review-patch-command">${escapeHtml(model.command || "apply_patch")}</span>
        <span>${escapeHtml(`${model.fileCount || model.files.length} 个文件 · ${stat}`)}</span>
      </p>
      <div class="review-patch-files">
        ${model.files.map((file) => renderReviewPatchFile(file)).join("")}
      </div>
    </div>
  `;
}

function renderReviewPatchFile(file) {
  const additions = Number(file.additions) || 0;
  const deletions = Number(file.deletions) || 0;
  const stat = additions || deletions ? `+${additions} -${deletions}` : "文件状态";
  const lines = file.lines?.length ? file.lines : [{ kind: "context", marker: " ", text: "该文件只有状态记录，没有行级 patch 正文。" }];
  return `
    <section class="review-patch-file status-${escapeAttr(file.status || "modified")}">
      <div class="review-patch-file-head">
        <span class="tool-diff-status">${escapeHtml(changeStatusLabel(file.status))}</span>
        <strong title="${escapeAttr(displayChangeFilePath(file))}">${escapeHtml(displayChangeFilePath(file))}</strong>
        <em>${
          additions || deletions
            ? `<span class="tool-diff-add">+${escapeHtml(String(additions))}</span> <span class="tool-diff-del">-${escapeHtml(String(deletions))}</span>`
            : escapeHtml(stat)
        }</em>
      </div>
      <div class="review-patch-lines">
        ${lines.map((line) => renderReviewPatchLine(line)).join("")}
      </div>
    </section>
  `;
}

function renderReviewPatchLine(line) {
  const kind = line.kind || "context";
  return `
    <div class="review-patch-line kind-${escapeAttr(kind)}">
      <span>${escapeHtml(line.marker || "")}</span>
      <code>${escapeHtml(line.text || "")}</code>
    </div>
  `;
}

function reviewCommandOutputModel(context) {
  return reviewCommandOutputModelFromPieces(context.summary, reviewCommandPiecesFromContext(context));
}

function reviewCommandOutputModelFromPieces(body, pieces = {}) {
  return window.ToolSummary?.commandOutputModel?.(body, pieces) || null;
}

function reviewCommandPiecesFromContext(context = {}) {
  const data = context.debugData || {};
  const item = data.item || data.detail?.item || (["tool-call", "tool-output"].includes(data.type) ? data : null);
  const output = firstReviewValue(data.outputBody, item?.output, data.outputPreview, data.type === "evidence" ? data.body : "");
  const args = firstReviewValue(data.argumentsBody, item?.arguments, data.argumentsPreview, data.arguments);
  return {
    title: context.title || data.title || item?.title || "",
    toolName: firstReviewValue(data.toolName, item?.name, data.name),
    command: firstReviewValue(data.command, item?.command),
    arguments: args,
    output,
    status: firstReviewValue(data.status, item?.status),
  };
}

function firstReviewValue(...values) {
  for (const value of values) {
    if (String(value ?? "").trim()) return String(value).trim();
  }
  return "";
}

function renderReviewCommandOutputText(model, options = {}) {
  const compact = options.compact ? " compact" : "";
  return `
    <div class="review-summary-text has-items review-command-output category-${escapeAttr(model.category || "command")} status-${escapeAttr(model.status || "info")}${compact}">
      <p class="review-summary-lead review-command-lead">
        <span class="review-command-name">${escapeHtml(model.command || model.title || "exec_command")}</span>
        <span class="review-command-status">${escapeHtml(commandOutputStatusLabel(model.status))}</span>
        <span>${escapeHtml(model.summary || model.title || "命令输出")}</span>
      </p>
      ${renderReviewCommandMetrics(model.metrics || [])}
      <div class="review-command-sections">
        ${(model.sections || []).map(renderReviewCommandSection).join("")}
      </div>
    </div>
  `;
}

function renderReviewCommandMetrics(metrics) {
  if (!metrics.length) return "";
  return `
    <div class="review-command-metrics">
      ${metrics
        .map(
          (metric) => `
            <div class="review-command-metric tone-${escapeAttr(metric.tone || "info")}">
              <span>${escapeHtml(metric.label || "")}</span>
              <strong title="${escapeAttr(metric.value || "")}">${escapeHtml(metric.value || "")}</strong>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderReviewCommandSection(section) {
  return `
    <section class="review-command-section">
      <div class="review-command-section-head">
        <strong>${escapeHtml(section.title || "输出")}</strong>
        ${section.meta ? `<span>${escapeHtml(section.meta)}</span>` : ""}
      </div>
      ${
        section.items?.length
          ? `<div class="review-command-items">${section.items.map(renderReviewCommandItem).join("")}</div>`
          : `<div class="review-command-lines">${(section.lines || []).map(renderReviewCommandLine).join("")}</div>`
      }
    </section>
  `;
}

function renderReviewCommandItem(item) {
  const label = item.label || item.status || item.kind || "";
  return `
    <div class="review-command-item tone-${escapeAttr(item.tone || "info")} kind-${escapeAttr(item.kind || "item")}">
      <span>${escapeHtml(label)}</span>
      <code title="${escapeAttr(item.path || "")}">${escapeHtml(item.path || "")}</code>
      ${item.meta ? `<em>${escapeHtml(item.meta)}</em>` : ""}
      ${item.text ? `<p>${escapeHtml(item.text)}</p>` : ""}
    </div>
  `;
}

function renderReviewCommandLine(line) {
  return `
    <div class="review-command-line kind-${escapeAttr(line.kind || "muted")}">
      <span>${escapeHtml(commandOutputLineMarker(line.kind))}</span>
      <code>${escapeHtml(line.text || "")}</code>
    </div>
  `;
}

function commandOutputStatusLabel(status) {
  if (status === "passed") return "通过";
  if (status === "failed") return "失败";
  if (status === "changed") return "有变更";
  if (status === "found") return "有命中";
  if (status === "empty") return "空结果";
  return "输出";
}

function commandOutputLineMarker(kind) {
  if (kind === "error") return "!";
  if (kind === "success") return "✓";
  return "·";
}

function reviewSummaryTextModel(summary) {
  const raw = String(summary || "").trim() || "没有摘要。";
  const lines = raw
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length <= 1) {
    const parts = splitSummaryClauses(raw);
    return {
      lead: parts.shift() || raw,
      items: parts.map(summaryClauseItem),
    };
  }
  return {
    lead: lines.shift() || raw,
    items: lines.map(summaryClauseItem),
  };
}

function splitSummaryClauses(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  if (normalized.length <= 110) return [normalized];
  const parts = normalized
    .split(/(?:；|;|\s·\s)/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 1 ? parts : [normalized];
}

function summaryClauseItem(text) {
  const value = String(text || "").trim();
  const match = value.match(/^([^：:]{1,10})[：:]\s*(.+)$/);
  if (!match) return { label: "", text: value };
  return { label: match[1], text: match[2] };
}

function renderReviewEvidence(context) {
  const evidence = context.evidence || [];
  if (!evidence.length) return renderReviewEmpty("没有证据", "当前对象没有可投影的证据。可以切到来源页查看原始结构。");
  return `
    <div class="review-section">
      <div class="section-title-row">
        <h3>证据</h3>
        <span class="count-pill">${escapeHtml(String(evidence.length))}</span>
      </div>
      <div class="review-card-list">
        ${evidence.map((item, index) => renderReviewEvidenceCard(item, index)).join("")}
      </div>
    </div>
  `;
}

function renderReviewRelations(context) {
  const relations = context.relations || [];
  if (!relations.length) return renderReviewEmpty("没有关系", "当前对象没有可跳转的上游或下游对象。");
  return `
    <div class="review-section">
      <div class="section-title-row">
        <h3>关系</h3>
        <span class="count-pill">${escapeHtml(String(relations.length))}</span>
      </div>
      <div class="review-card-list">
        ${relations.map((relation, index) => renderReviewRelationCard(relation, index)).join("")}
      </div>
    </div>
  `;
}

function renderReviewSource(context) {
  const sources = context.sources || [];
  const debug = context.debugData ?? context;
  return `
    <div class="review-section">
      <div class="section-title-row">
        <h3>来源</h3>
        <span class="muted">按需原始事件</span>
      </div>
      ${sources.length ? `<div class="review-source-list">${sources.map((source, index) => renderReviewSourceCard(source, index)).join("")}</div>` : ""}
      <div class="review-source-preview">
        <div class="raw-preview-title">
          <strong>${escapeHtml(context.title || "调试结构")}</strong>
          <span>${escapeHtml(context.kindLabel || "JSON")}</span>
        </div>
        <pre class="raw-preview" data-review-source-preview>${escapeHtml(JSON.stringify(debug, null, 2))}</pre>
      </div>
    </div>
  `;
}

function renderReviewActions(context) {
  const actions = normalizeReviewActions(context);
  return actions
    .map((action, index) => {
      const disabledReason = reviewActionDisabledReason(action);
      const title = disabledReason || action.title || action.label || "";
      return `<button class="ghost-button small" type="button" data-review-action="${index}" data-review-action-type="${escapeAttr(action.action || "")}" title="${escapeAttr(title)}" ${disabledReason ? "disabled" : ""}>${escapeHtml(action.label)}</button>`;
    })
    .join("");
}

function normalizeReviewActions(context) {
  if (!state.detail || context.kind === "prompt_archive") return [];
  const referenceLabel = context.kind === "session" ? "复制会话引用" : "复制对象引用";
  const actions = [...(context.actions || [])];
  actions.forEach((action) => {
    if (action.action === "copy-reference" && action.label === "复制引用") action.label = referenceLabel;
  });
  if (!actions.some((action) => action.action === "copy-reference")) actions.unshift({ label: referenceLabel, action: "copy-reference" });
  if (!actions.some((action) => action.action === "copy-evidence")) actions.push({ label: "复制证据包", action: "copy-evidence" });
  return dedupeActions(actions);
}

function renderReviewMetric(label, value) {
  return `
    <div class="review-metric">
      <strong>${escapeHtml(String(value ?? 0))}</strong>
      <span>${escapeHtml(label)}</span>
    </div>
  `;
}

function renderReviewRows(rows) {
  if (!rows.length) return "";
  return `
    <div class="details-grid review-detail-grid">
      ${rows.map(([key, value]) => `<div class="detail-row"><strong>${escapeHtml(key)}</strong><span>${renderDetailValue(key, value)}</span></div>`).join("")}
    </div>
  `;
}

function renderReviewEvidenceCard(item, index) {
  return `
    <article class="review-card risk-${escapeAttr(item.riskLevel || "none")}">
      <div class="review-card-head">
        <span>${escapeHtml(item.kind || "证据")}</span>
        <strong>${escapeHtml(item.title || "未命名证据")}</strong>
      </div>
      ${item.meta ? `<div class="review-card-meta">${escapeHtml(item.meta)}</div>` : ""}
      ${renderChangeSetSummary(item.changeSet, { maxFiles: 7 })}
      ${item.commandModel ? renderReviewCommandOutputText(item.commandModel, { compact: true }) : item.body ? `<pre class="review-card-body">${escapeHtml(firstLine(item.body, 1000))}</pre>` : ""}
      ${item.action ? `<button class="ghost-button small" type="button" data-review-evidence-action="${index}">${escapeHtml(item.actionLabel || "打开")}</button>` : ""}
    </article>
  `;
}

function renderReviewRelationCard(relation, index) {
  return `
    <button class="review-relation" type="button" data-review-relation="${index}" ${relation.action ? "" : "disabled"}>
      <span>${escapeHtml(relation.kind || "关系")}</span>
      <strong>${escapeHtml(relation.title || "未命名对象")}</strong>
      <em>${escapeHtml(relation.meta || "")}</em>
    </button>
  `;
}

function renderReviewSourceCard(source, index) {
  const button = source.eventIndex != null || source.lazy ? `<button class="ghost-button small" type="button" data-review-source="${index}">读取完整来源</button>` : "";
  return `
    <div class="review-source-card">
      <div>
        <strong>${escapeHtml(source.label || "来源")}</strong>
        <span>${escapeHtml(source.value || "未记录")}</span>
      </div>
      ${button}
    </div>
  `;
}

function renderReviewEmpty(title, subtitle) {
  return `
    <div class="review-section">
      <div class="selection-empty">
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(subtitle)}</span>
      </div>
    </div>
  `;
}

function bindReviewBodyActions(context) {
  const relations = context.relations || [];
  const evidence = context.evidence || [];
  const sources = context.sources || [];
  els.selectionDetails.querySelectorAll("[data-review-relation]").forEach((button) => {
    button.addEventListener("click", () => {
      void runReviewAction(relations[Number(button.dataset.reviewRelation)]).catch(reportReviewActionFailure);
    });
  });
  els.selectionDetails.querySelectorAll("[data-review-evidence-action]").forEach((button) => {
    button.addEventListener("click", () => {
      void runReviewAction(evidence[Number(button.dataset.reviewEvidenceAction)]).catch(reportReviewActionFailure);
    });
  });
  els.selectionDetails.querySelectorAll("[data-review-source]").forEach((button) => {
    button.addEventListener("click", () => {
      const source = sources[Number(button.dataset.reviewSource)];
      if (source) void loadReviewSource(source).catch(reportReviewActionFailure);
    });
  });
}

function bindReviewActions(context) {
  const actions = normalizeReviewActions(context);
  els.inspectorActions.querySelectorAll("[data-review-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = actions[Number(button.dataset.reviewAction)];
      void runReviewAction(action, context).catch(reportReviewActionFailure);
    });
  });
}

async function runReviewAction(action, context = buildReviewContext()) {
  if (!action) return;
  const disabledReason = reviewActionDisabledReason(action);
  if (disabledReason) {
    showToast(disabledReason);
    syncExportButtons();
    renderInspector();
    return;
  }
  if (action.action === "copy-reference") return copyReviewReference(context);
  if (action.action === "copy-evidence") return copyReviewEvidence(context);
  if (action.action === "copy-debug") return copySelectedRawEvent();
  if (action.action === "copy-markdown") return copyMarkdown();
  if (action.action === "open-thread" && action.threadId) return selectSession(action.threadId);
  if (action.action === "open-raw-event") return openRawEventFromAudit(action.index);
  if (action.action === "open-item-ref") return locateItemRef(action.ref);
  if (action.action === "open-trace-node") return locateTraceNode(action.id);
  if (action.action === "open-audit-node") return locateAuditNode(action.id || action.node?.relatedNodeId);
  if (action.action === "switch-review-tab") {
    setReviewTab(action.tab || "summary");
    return;
  }
  if (action.copy != null) return copyInspectorText(action.copy, action.toast || "已复制", { sensitive: action.sensitive !== false });
}

function reviewActionDisabledReason(action) {
  if (!action) return "";
  if (action.disabledReason) return action.disabledReason;
  if (action.disabled) return action.title || "当前操作不可用";
  if (action.action === "copy-markdown") return markdownExportBlockedReason();
  return "";
}

async function loadReviewSource(source) {
  const preview = els.selectionDetails.querySelector("[data-review-source-preview]");
  if (!preview) return;
  if (source.eventIndex == null) {
    preview.textContent = JSON.stringify(source.data ?? source.value ?? null, null, 2);
    return;
  }
  cancelRawEventRequest();
  const request = createReviewSourceRequest(source.eventIndex);
  preview.textContent = JSON.stringify(source.data || {}, null, 2) + "\n\n正在按需读取完整原始事件...";
  try {
    const raw = await loadRawEvent(source.eventIndex, { cancelPrevious: false });
    if (!raw || !reviewSourceRequestIsCurrent(request)) return;
    preview.textContent = JSON.stringify(raw, null, 2);
  } catch (error) {
    if (isAbortError(error) || !reviewSourceRequestIsCurrent(request)) return;
    preview.textContent = JSON.stringify(source.data || {}, null, 2) + `\n\n读取完整事件失败：${error.message}`;
  }
}

function createReviewSourceRequest(eventIndex) {
  return {
    eventIndex,
    requestSeq: ++reviewSourceRequestSeq,
    sourceId: state.selectedSourceId,
    sessionKey: state.selectedSessionKey,
    viewMode: state.viewMode,
    reviewTab: state.reviewTab,
    selectionKey: reviewSelectionKey(),
  };
}

function reviewSourceRequestIsCurrent(request) {
  return request.requestSeq === reviewSourceRequestSeq
    && request.sourceId === state.selectedSourceId
    && request.sessionKey === state.selectedSessionKey
    && request.viewMode === state.viewMode
    && request.reviewTab === state.reviewTab
    && request.reviewTab === "source"
    && request.selectionKey === reviewSelectionKey();
}

function reviewSelectionKey() {
  return JSON.stringify({
    eventIndex: state.selectedEventIndex,
    traceNodeId: state.selectedTraceNodeId,
    auditNodeId: state.selectedAuditNodeId,
    auditTurnKey: state.selectedAuditTurnKey,
    itemRef: state.selectedItemRef,
  });
}

function reportReviewActionFailure(error) {
  if (isAbortError(error)) return;
  console.warn("复核台操作失败", error);
  showToast(`操作失败：${errorTextFromError(error)}`);
}

function reviewEvidenceFromAuditNode(node) {
  const readable = readableAuditNode(node);
  const item = node.itemRef ? findItemByRef(node.itemRef) : null;
  const body = auditNodeFullBody(node, readable, item) || [node.summary, node.outputPreview, node.argumentsPreview].filter(Boolean).join("\n\n");
  return {
    kind: auditTypeLabel(node.type),
    title: readable.title || node.title || auditTypeLabel(node.type),
    meta: [node.turnNumber ? `第 ${node.turnNumber} 轮` : "", node.toolName, auditEventIndexLabel(node), auditRiskMetaLabel(node.riskLevel)].filter(Boolean).join(" · "),
    body,
    changeSet: readable.changeSet,
    commandModel: reviewCommandOutputModelFromPieces(body, {
      title: readable.title || node.title || "",
      toolName: node.toolName,
      arguments: node.argumentsBody || node.argumentsPreview || item?.arguments || "",
      output: node.outputBody || item?.output || node.outputPreview || (node.type === "evidence" ? node.body : ""),
      status: node.status,
    }),
    riskLevel: node.riskLevel || "none",
    action: "open-audit-node",
    id: node.id,
    actionLabel: "定位节点",
  };
}

function reviewEvidenceFromItem(item, kind = "关联项") {
  const ref = itemRef(item);
  const readable = readableToolItem(item);
  const linkedAuditNodes = auditNodesForItemRef(ref);
  const body = bestAuditBodyForItem(linkedAuditNodes) || readable.body || readable.summary || item.text || item.output || item.arguments || item.payloadPreview || "";
  return {
    kind,
    title: readable.title || itemTitle(item),
    meta: [item.turnIndex == null ? "" : `第 ${item.turnIndex + 1} 轮`, item.name, item.sourceIndex != null ? `事件 ${item.sourceIndex}` : ""].filter(Boolean).join(" · "),
    body,
    changeSet: readable.changeSet,
    commandModel: reviewCommandOutputModelFromPieces(body, {
      title: readable.title || itemTitle(item),
      toolName: item.name,
      arguments: item.arguments,
      output: item.output,
      status: item.status || item.phase,
    }),
    riskLevel: itemRiskLevel(item, linkedAuditNodes),
    action: "open-item-ref",
    ref,
    actionLabel: "查看关联项",
  };
}

function reviewEvidenceFromEvent(event, kind = "原始事件") {
  const readable = readableRawEvent(event);
  return {
    kind,
    title: `事件 ${event.index} ${readable.title || humanEventTitle(event)}`,
    meta: [event.kind || event.type, formatDate(event.timestamp)].filter(Boolean).join(" · "),
    body: readable.summary || event.preview || "",
    changeSet: readable.changeSet,
    riskLevel: rawEventRiskLevel(event, auditNodesForEventIndex(event.index)),
    action: "open-raw-event",
    index: event.index,
    actionLabel: "打开原始事件",
  };
}

function reviewRelationFromAuditNode(node, kind = "审计链") {
  const readable = readableAuditNode(node);
  return {
    kind,
    title: readable.title || node.title || auditTypeLabel(node.type),
    meta: [readable.summary, auditTypeLabel(node.type), auditRiskMetaLabel(node.riskLevel), node.turnNumber ? `第 ${node.turnNumber} 轮` : ""].filter(Boolean).join(" · "),
    action: "open-audit-node",
    id: node.id,
  };
}

function reviewRelationFromTraceNode(node, kind = "执行") {
  const readable = node.detail?.item ? readableToolItem(node.detail.item) : null;
  return {
    kind,
    title: readable?.title || node.title || node.label || node.id,
    meta: [readable?.summary, traceTypeLabel(node.type), node.status].filter(Boolean).join(" · "),
    action: "open-trace-node",
    id: node.id,
  };
}

function reviewRelationFromItem(item, kind = "关联项") {
  const readable = readableToolItem(item);
  return {
    kind,
    title: readable.title || itemTitle(item),
    meta: [readable.summary, item.turnIndex == null ? "" : `第 ${item.turnIndex + 1} 轮`, item.name].filter(Boolean).join(" · "),
    action: "open-item-ref",
    ref: itemRef(item),
  };
}

function reviewRelationFromEvent(event, kind = "原始事件") {
  const readable = readableRawEvent(event);
  return {
    kind,
    title: `事件 ${event.index} ${readable.title || humanEventTitle(event)}`,
    meta: [readable.summary, event.kind || event.type, formatDate(event.timestamp)].filter(Boolean).join(" · "),
    action: "open-raw-event",
    index: event.index,
  };
}

function buildSourceRefs({ eventIndex, item, node, traceNode } = {}) {
  const sources = [];
  if (eventIndex != null) {
    const event = eventByIndex(eventIndex);
    sources.push({ label: "原始事件", value: `事件 ${eventIndex}`, eventIndex, data: event, lazy: true });
  }
  if (item) sources.push({ label: "关联项模型", value: itemRef(item), data: itemDebugPreview(item) });
  if (node) sources.push({ label: "审计链节点", value: node.id, data: auditNodeDebugPreview(node) });
  if (traceNode) sources.push({ label: "执行节点模型", value: traceNode.id, data: traceNodePreview(traceNode) });
  return sources;
}

function rawEventSelectionActions(event) {
  return [
    { label: "读取完整原始事件", action: "switch-review-tab", tab: "source" },
    { label: "复制摘要", copy: event.preview || humanEventTitle(event), toast: "已复制事件摘要" },
    { label: "复制 JSON", action: "copy-debug" },
  ];
}

function dedupeActions(actions) {
  const seen = new Set();
  const result = [];
  for (const action of actions.filter(Boolean)) {
    const key = [action.label, action.action, action.index, action.ref, action.id, action.threadId].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(action);
  }
  return result;
}

function eventByIndex(index) {
  if (index == null) return null;
  return state.detail?.events?.find((event) => event.index === index) || state.rawDiagnostic?.pages.flatMap((page) => page.events || []).find((event) => event.index === index) || null;
}

function itemsForEventIndex(index) {
  if (index == null) return [];
  return (state.detail?.turns || []).flatMap((turn) => turn.items || []).filter((item) => item.sourceIndex === index || item.outputSourceIndex === index);
}

function auditNodesForEventIndex(index) {
  if (index == null) return [];
  return (state.detail?.audit?.nodes || buildAuditFallback(state.detail)?.nodes || []).filter((node) => node.eventIndex === index || node.sourceIndex === index);
}

function auditNodesForItemRef(ref) {
  if (!ref) return [];
  return (state.detail?.audit?.nodes || buildAuditFallback(state.detail)?.nodes || []).filter((node) => node.itemRef === ref);
}

function auditNodeFullBody(node, readable = null, item = null) {
  if (!node) return "";
  const direct = [node.body, node.outputBody, node.argumentsBody].find((value) => String(value || "").trim());
  if (direct) return String(direct).trim();
  const fallback = [readable?.body, readable?.summary, item?.text, item?.output, item?.arguments, node.summary, node.outputPreview, node.argumentsPreview].find((value) =>
    String(value || "").trim(),
  );
  return fallback ? String(fallback).trim() : "";
}

function bestAuditBodyForItem(nodes = []) {
  for (const type of ["evidence", "verification", "final", "intent", "reasoning", "action"]) {
    const node = nodes.find((candidate) => candidate.type === type && auditNodeFullBody(candidate));
    const body = auditNodeFullBody(node);
    if (body) return body;
  }
  return auditNodeFullBody(nodes.find((node) => auditNodeFullBody(node))) || "";
}

function fullItemForTraceNode(node) {
  const ref = itemRefFromTraceNode(node);
  return ref ? findItemByRef(ref) : null;
}

function itemRiskLevel(item, auditNodes = []) {
  const level = highestRiskLevel(auditNodes);
  if (level !== "none") return level;
  const text = [item.status, item.phase, item.text, item.output, item.payloadPreview].filter(Boolean).join("\n");
  return /error|failed|失败|错误/i.test(text) ? "medium" : "none";
}

function traceRiskLevel(node, item) {
  if (item) return itemRiskLevel(item, auditNodesForItemRef(itemRef(item)));
  return /error|failed|失败|错误/i.test([node.status, node.label, node.subtitle].filter(Boolean).join(" ")) ? "medium" : "none";
}

function rawEventRiskLevel(event, auditNodes = []) {
  const level = highestRiskLevel(auditNodes);
  if (level !== "none") return level;
  return /error|failed|失败|错误/i.test(JSON.stringify(event)) ? "medium" : "none";
}

function riskMetricValue(level) {
  return level && level !== "none" ? auditRiskLabel(level) : "0";
}

function locateAuditNode(id) {
  if (!id) return;
  const target = findAuditNode(id);
  if (!target) {
    showToast("未找到审计链节点");
    return;
  }
  if (state.viewMode !== "audit") {
    state.viewMode = "audit";
    cancelRemoteRefreshForNavigation();
  }
  renderMainContent();
  selectAuditNode(target.id);
}

function reviewReference(context = buildReviewContext()) {
  const session = state.detail?.session || {};
  const parts = [context.kindLabel || context.kind || "对象", context.title || "未命名对象"];
  if (context.badges?.length) parts.push(context.badges.join(" · "));
  if (session.id) parts.push(`会话：${session.id}`);
  return parts.filter(Boolean).join("\n");
}

async function copyReviewReference(context = buildReviewContext()) {
  if (!state.detail) return;
  await copyWithToast(reviewReference(context), context.kind === "session" ? "已复制会话引用" : "已复制对象引用");
}

function sensitiveCopyToast(prefix) {
  return `${prefix}；可能包含会话正文、路径、命令参数、命令输出或原始内容，请谨慎分享`;
}

async function copyReviewEvidence(context = buildReviewContext()) {
  if (!state.detail) return;
  const pack = {
    reference: reviewReference(context),
    summary: context.summary,
    evidence: context.evidence,
    relations: context.relations,
    sources: (context.sources || []).map((source) => ({ label: source.label, value: source.value, eventIndex: source.eventIndex ?? null })),
  };
  await copyWithToast(JSON.stringify(pack, null, 2), sensitiveCopyToast("已复制证据包"));
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
    await copyWithToast(JSON.stringify(traceNodePreview(node), null, 2), sensitiveCopyToast("已复制执行节点"));
    return;
  }
  if (state.selectedAuditNodeId) {
    const node = findAuditNode(state.selectedAuditNodeId);
    if (!node) return;
    await copyWithToast(JSON.stringify(auditNodeDebugPreview(node), null, 2), sensitiveCopyToast("已复制审计链节点"));
    return;
  }
  if (state.selectedAuditTurnKey) {
    const turn = findAuditTurn(state.selectedAuditTurnKey);
    if (!turn) return;
    await copyWithToast(JSON.stringify(auditTurnDebugPreview(turn), null, 2), sensitiveCopyToast("已复制轮次审计摘要"));
    return;
  }
  if (state.selectedItemRef) {
    const item = findItemByRef(state.selectedItemRef);
    if (!item) return;
    await copyWithToast(JSON.stringify(itemDebugPreview(item), null, 2), sensitiveCopyToast("已复制关联项 JSON"));
    return;
  }
  if (state.selectedEventIndex == null) return;
  const copyContext = createRawEventCopyContext(state.selectedEventIndex);
  try {
    const event = await loadRawEvent(copyContext.eventIndex);
    if (!event || !rawEventCopyContextIsCurrent(copyContext)) return;
    await copyWithToastWhileCurrent(
      JSON.stringify(event, null, 2),
      sensitiveCopyToast("已复制原始事件调试 JSON"),
      () => rawEventCopyContextIsCurrent(copyContext),
    );
  } catch (error) {
    if (isAbortError(error)) return;
    if (isRawDiagnosticSnapshotInvalidated(error) && rawEventCopySnapshotWasInvalidated(copyContext)) {
      showToast("复制失败：会话文件或诊断快照已变化，请重新开始读取。");
      return;
    }
    if (rawEventCopyContextIsCurrent(copyContext)) showToast(`复制失败：${errorTextFromError(error)}`);
  }
}

function createRawEventCopyContext(eventIndex) {
  const detail = state.detail;
  const sourceId = detail?.session?.sourceId || state.selectedSourceId;
  return {
    eventIndex,
    sourceId,
    sessionKey: state.selectedSessionKey,
    diagnostic: state.rawDiagnostic,
    snapshot: rawDiagnosticSnapshotForEvent(eventIndex),
    viewMode: state.viewMode,
    reviewTab: state.reviewTab,
    selectionKey: reviewSelectionKey(),
  };
}

function rawEventCopyContextIsCurrent(context) {
  if (
    context.sourceId !== state.selectedSourceId
    || context.sessionKey !== state.selectedSessionKey
    || context.eventIndex !== state.selectedEventIndex
    || context.viewMode !== state.viewMode
    || context.reviewTab !== state.reviewTab
    || context.selectionKey !== reviewSelectionKey()
  ) return false;
  if (!context.snapshot) return true;
  return state.rawDiagnostic === context.diagnostic && state.rawDiagnostic?.snapshot === context.snapshot;
}

function rawEventCopySnapshotWasInvalidated(context) {
  return Boolean(
    context.snapshot
    && state.selectedSourceId === context.sourceId
    && state.selectedSessionKey === context.sessionKey
    && state.rawDiagnostic === context.diagnostic
    && !state.rawDiagnostic?.snapshot
    && state.rawDiagnostic?.error,
  );
}

async function copyMarkdown() {
  const blockedReason = markdownExportBlockedReason();
  if (blockedReason) {
    showToast(blockedReason);
    syncExportButtons();
    return;
  }
  const snapshot = markdownExportSnapshot();
  if (!snapshot) {
    showToast("未选择可导出的会话");
    syncExportButtons();
    return;
  }
  markdownAbortController?.abort();
  markdownAbortController = new AbortController();
  els.copyMarkdownButton.disabled = true;
  try {
    const markdown = await fetchText(sourceMarkdownUrl(snapshot.sessionId, snapshot.sourceId), { signal: markdownAbortController.signal });
    if (!markdownExportSnapshotStillCurrent(snapshot)) {
      showToast("会话或数据源已切换，已取消本次 Markdown 复制");
      return;
    }
    await copyText(markdown);
    if (!markdownExportSnapshotStillCurrent(snapshot)) {
      showToast("会话或数据源已切换，本次 Markdown 复制不再作为当前会话结果提示");
      return;
    }
    showToast(sensitiveCopyToast("已复制 Markdown"));
  } catch (error) {
    if (isAbortError(error)) return;
    showToast(`复制 Markdown 失败：${error.message}`);
  } finally {
    syncExportButtons();
  }
}

async function downloadMarkdown() {
  const blockedReason = markdownExportBlockedReason();
  if (blockedReason) {
    showToast(blockedReason);
    syncExportButtons();
    return;
  }
  const snapshot = markdownExportSnapshot();
  if (!snapshot) {
    showToast("未选择可导出的会话");
    syncExportButtons();
    return;
  }
  markdownAbortController?.abort();
  markdownAbortController = new AbortController();
  els.downloadMarkdownButton.disabled = true;
  try {
    const markdown = await fetchText(sourceMarkdownUrl(snapshot.sessionId, snapshot.sourceId), { signal: markdownAbortController.signal });
    if (!markdownExportSnapshotStillCurrent(snapshot)) {
      showToast("会话或数据源已切换，已取消本次 Markdown 下载");
      return;
    }
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${sanitizeFileName(snapshot.title || snapshot.sessionId)}.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    if (markdownExportSnapshotStillCurrent(snapshot)) showToast(sensitiveCopyToast("已下载 Markdown"));
  } catch (error) {
    if (isAbortError(error)) return;
    showToast(`下载 Markdown 失败：${error.message}`);
  } finally {
    syncExportButtons();
  }
}

function markdownExportSnapshot() {
  const session = state.detail?.session;
  if (!session?.id) return null;
  return {
    sourceId: state.selectedSourceId,
    sessionId: session.id,
    title: session.title || session.id,
    selectedSessionKey: state.selectedSessionKey,
  };
}

function markdownExportSnapshotStillCurrent(snapshot) {
  if (!snapshot) return false;
  return (
    state.selectedSourceId === snapshot.sourceId &&
    state.selectedSessionKey === snapshot.selectedSessionKey &&
    state.detail?.session?.id === snapshot.sessionId
  );
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
  return text.length > max ? `${text.slice(0, max)}\n\n... 复核预览已截断 ${text.length - max} 个字符 ...` : value;
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
  if (!Number.isFinite(value)) return "未记录";
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

function readableAuditNode(node, item = node?.itemRef ? findItemByRef(node.itemRef) : null) {
  if (!node || !window.ToolSummary) {
    return { matched: false, title: node?.title || "", summary: node?.summary || "", body: node?.summary || "", command: "" };
  }
  return window.ToolSummary.summarizeAuditNode(node, item, summaryRuleOptions());
}

function readableRawEvent(event) {
  if (isCompactEvent(event)) return readableCompactEvent(event);
  if (!event || !window.ToolSummary) {
    return { matched: false, title: humanEventTitle(event), summary: event?.preview || "", body: event?.preview || "", command: "" };
  }
  return window.ToolSummary.summarizeRawEvent(event, summaryRuleOptions());
}

function readableCompactEvent(event) {
  const compact = event?.compact || {};
  const isSummary = compact.kind === "compacted" || event?.kind === "compacted";
  const title = isSummary ? "上下文压缩摘要" : "上下文压缩完成";
  const meta = [
    compact.windowNumber != null ? `窗口 ${compact.windowNumber}` : "",
    compact.replacementHistoryCount ? `替换历史 ${compact.replacementHistoryCount}` : "",
    compact.messageLength ? `${compactNumber(compact.messageLength)} 字符` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const summary = compact.message || event?.preview || (isSummary ? "已生成上下文替换摘要。" : "上下文压缩完成。");
  return {
    matched: true,
    title,
    summary: firstLine([meta, summary].filter(Boolean).join("："), 300),
    body: summary,
    command: "",
  };
}

function readableExecutionRow(row) {
  const action = (row.auditNodes || []).find((node) => node.type === "action");
  if (action) return readableAuditNode(action);
  const item = row.itemRef ? findItemByRef(row.itemRef) : null;
  if (row.type === "agent_message" || item?.type === "assistant-message") {
    return {
      matched: true,
      title: row.title || itemTitle(item),
      summary: firstLine(item?.text || row.subtitle || "", 220),
      body: item?.text || row.subtitle || "",
      command: "",
    };
  }
  if (item) return readableToolItem(item);
  return { matched: false, title: row.title || row.label || row.id, summary: row.subtitle || "", body: row.subtitle || "", command: "" };
}

function itemTitle(item) {
  if (item.type === "user-message") return "用户消息";
  if (item.type === "assistant-message") return item.phase === "final" ? "助手最终回复" : "助手消息";
  if (item.type === "tool-call") {
    const readable = readableToolItem(item);
    return readable.matched ? readable.title : item.name ? `工具调用 · ${item.name}` : "工具调用";
  }
  if (item.type === "tool-output") {
    const readable = readableToolItem(item);
    return readable.matched ? readable.title : "工具输出";
  }
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
  if (item.type === "context-compact") return "C";
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
  if (item.type === "context-compact") return true;
  if (item.status && /error|fail|failed|失败|错误/i.test(item.status)) return true;
  if (item.type !== "tool-call") {
    return /error|fail|failed|失败|错误/i.test([item.eventType, item.responseType, item.phase, item.status].filter(Boolean).join(" "));
  }
  if (/spawn_agent|wait_agent|handoff/i.test(item.name || "")) return true;
  return false;
}

function isHighValueRawEvent(event) {
  const label = `${event.kind || ""}\n${event.title || ""}\n${event.payloadType || ""}`;
  if (isCompactEvent(event)) return true;
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
  const readable = window.ToolSummary ? window.ToolSummary.summarizeRawEvent(event, summaryRuleOptions()) : null;
  if (readable?.matched && readable.title) return readable.title;
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
  if (type === "lazy-child") return "子会话";
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

async function copyInspectorText(text, message, { sensitive = true } = {}) {
  if (!text) {
    showToast("没有可复制内容");
    return;
  }
  await copyWithToast(String(text), sensitive ? sensitiveCopyToast(message) : message);
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
  const suffix = source.kind === "remote" && status.stale ? "旧远端快照" : source.kind === "remote" ? "远端快照" : "本机";
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

function promptArchiveUrl(sourceId = state.selectedSourceId, scope = promptArchiveScope(), pageToken = "") {
  const params = new URLSearchParams({ scope });
  if (pageToken) params.set("pageToken", pageToken);
  return `/api/sources/${encodeURIComponent(sourceId)}/prompts?${params.toString()}`;
}

function remoteIndexUrl(sourceId = state.selectedSourceId, cursor = "0", snapshot = "") {
  const params = new URLSearchParams({
    bucket: state.sessionTimeFilter,
    limit: String(remoteIndexPageLimit),
    cursor: String(cursor),
  });
  const query = els.sessionSearch.value.trim();
  if (query) params.set("q", query);
  params.set("type", sessionListServerType());
  if (snapshot) params.set("snapshot", snapshot);
  return `/api/sources/${encodeURIComponent(sourceId)}/index?${params.toString()}`;
}

function sessionListServerType() {
  const type = els.sessionTypeFilter?.value || "all";
  return type === "error" || type === "tool" ? type : "all";
}

function sourceSessionUrl(id, sourceId = state.selectedSourceId) {
  const params = new URLSearchParams();
  const evidenceRiskRules = window.EvidenceRiskRules?.serializeForQuery?.(state.evidenceRiskRules);
  if (evidenceRiskRules) params.set("evidenceRiskRules", evidenceRiskRules);
  const query = params.toString();
  return `/api/sources/${encodeURIComponent(sourceId)}/sessions/${encodeURIComponent(id)}${query ? `?${query}` : ""}`;
}

function sourceEventUrl(id, index, sourceId = state.selectedSourceId, snapshot = "") {
  const params = new URLSearchParams();
  if (snapshot) params.set("snapshot", snapshot);
  const query = params.toString();
  return `/api/sources/${encodeURIComponent(sourceId)}/sessions/${encodeURIComponent(id)}/events/${index}${query ? `?${query}` : ""}`;
}

function sourceSessionEventsUrl(id, sourceId = state.selectedSourceId, { cursor = 0, snapshot = "" } = {}) {
  const params = new URLSearchParams({ limit: "100", cursor: String(cursor) });
  if (snapshot) params.set("snapshot", snapshot);
  return `/api/sources/${encodeURIComponent(sourceId)}/query/sessions/${encodeURIComponent(id)}/events?${params.toString()}`;
}

function sourceMarkdownUrl(id, sourceId = state.selectedSourceId) {
  return `/api/sources/${encodeURIComponent(sourceId)}/sessions/${encodeURIComponent(id)}/markdown`;
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

async function fetchText(url, options = {}) {
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
  return response.text();
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
  const text = value || "未记录";
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
