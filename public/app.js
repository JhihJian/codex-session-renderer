const state = {
  sources: [],
  peers: [],
  selectedPeerId: null,
  selectedSourceId: "local",
  sessions: [],
  remoteIndexSessions: [],
  filteredSessions: [],
  remoteIndexLoading: false,
  remoteIndexError: "",
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
  rawEventCache: new Map(),
  viewMode: "compact",
  sessionTimeFilter: "realtime",
  visibleEvents: 40,
  visibleThreadItems: 140,
  visibleRawEvents: 240,
  reviewTab: "summary",
  summaryRules: [],
  executionGroupRules: [],
  evidenceRiskRules: [],
  settingsView: "summary",
  expandedAuditGroupIds: new Set(),
  inspectorWidth: 388,
  resizingInspector: false,
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
  normalizeMarkdownForRendering,
  prettyMaybeJson,
  sanitizeFileName,
  sessionTimeBucket,
  shortPath,
} = window.AppFormat;

const markdownCache = new Map();
const markdownCacheLimit = 700;
const inspectorWidthStorageKey = "codexSessionRenderer.inspectorWidth.v1";
const inspectorWidthDefaults = {
  min: 310,
  max: 680,
  step: 24,
  contentMin: 360,
};
const visibleViewModes = new Set(["compact", "audit", "raw"]);
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
  importantOnlyControl: document.getElementById("importantOnlyControl"),
  importantOnlyLabel: document.getElementById("importantOnlyLabel"),
  sessionMetaLabel: document.getElementById("sessionMetaLabel"),
  sessionTitle: document.getElementById("sessionTitle"),
  statsStrip: document.getElementById("statsStrip"),
  threadContent: document.getElementById("threadContent"),
  compactContent: document.getElementById("compactContent"),
  terminalContent: document.getElementById("terminalContent"),
  auditContent: document.getElementById("auditContent"),
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
  copyMarkdownButton: document.getElementById("copyMarkdownButton"),
  downloadMarkdownButton: document.getElementById("downloadMarkdownButton"),
  compactViewButton: document.getElementById("compactViewButton"),
  auditViewButton: document.getElementById("auditViewButton"),
  rawViewButton: document.getElementById("rawViewButton"),
  toggleLeft: document.getElementById("toggleLeft"),
  toggleRight: document.getElementById("toggleRight"),
};

const standardItemTypeOptions = [
  ["all", "全部类型"],
  ["message", "用户/助手消息"],
  ["tool", "工具与命令"],
  ["output", "工具输出"],
  ["reasoning", "推理摘要"],
  ["system", "系统事件"],
  ["error", "错误事件"],
];

const auditItemTypeOptions = [
  ["all", "全部"],
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
  { id: "evidence", label: "Evidence 风险" },
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
  applyInspectorWidth(state.inspectorWidth);
  loadHealthAndSources();
}

function bindEvents() {
  els.refreshButton.addEventListener("click", () => loadSessions({ keepSelection: true }));
  document.addEventListener("click", handleMarkdownCodeCopy);
  els.refreshRemoteButton.addEventListener("click", refreshSelectedSource);
  els.sourceSelect.addEventListener("change", () => selectSource(els.sourceSelect.value));
  els.managePeersButton.addEventListener("click", openPeerDialog);
  els.settingsButton?.addEventListener("click", openSettingsDialog);
  els.closeSettingsDialogButton?.addEventListener("click", () => els.settingsDialog.close());
  els.settingsForm?.addEventListener("submit", saveSettingsFromForm);
  els.settingsTabs?.addEventListener("click", selectSettingsViewFromEvent);
  els.settingsOverview?.addEventListener("click", selectSettingsViewFromEvent);
  els.addSummaryRuleButton?.addEventListener("click", () => {
    state.summaryRules.push(newSummaryRule());
    state.settingsView = "summary";
    renderSettingsDialog();
  });
  els.resetSummaryRulesButton?.addEventListener("click", () => {
    state.summaryRules = [];
    state.settingsView = "summary";
    renderSettingsDialog();
  });
  els.addExecutionGroupRuleButton?.addEventListener("click", () => {
    state.executionGroupRules.push(newExecutionGroupRule());
    state.settingsView = "execution";
    renderSettingsDialog();
  });
  els.resetExecutionGroupRulesButton?.addEventListener("click", () => {
    state.executionGroupRules = [];
    state.settingsView = "execution";
    renderSettingsDialog();
  });
  els.addEvidenceRiskRuleButton?.addEventListener("click", () => {
    ensureEvidenceRiskEditorRules();
    state.evidenceRiskRules.unshift(newEvidenceRiskRule());
    state.settingsView = "evidence";
    renderSettingsDialog();
  });
  els.resetEvidenceRiskRulesButton?.addEventListener("click", () => {
    state.evidenceRiskRules = [];
    state.settingsView = "evidence";
    renderSettingsDialog();
  });
  els.closePeerDialogButton.addEventListener("click", () => els.peerDialog.close());
  els.newPeerButton.addEventListener("click", () => selectPeerForEdit(null));
  els.peerForm.addEventListener("submit", savePeerFromForm);
  els.testPeerButton.addEventListener("click", testSelectedPeer);
  els.deletePeerButton.addEventListener("click", deleteSelectedPeer);
  els.sessionSearch.addEventListener("input", () => {
    renderSessionList();
    void loadRemoteIndexForCurrentFilter();
  });
  els.sessionTimeFilter.querySelectorAll("[data-session-time]").forEach((button) => {
    button.addEventListener("click", () => {
      state.sessionTimeFilter = button.dataset.sessionTime || "realtime";
      renderSessionList();
      void loadRemoteIndexForCurrentFilter();
      const nextSession = state.filteredSessions[0];
      if (nextSession && !nextSession.remoteIndexOnly && !state.filteredSessions.some((session) => sessionKey(session) === state.selectedSessionKey)) {
        selectSession(nextSession.id);
      }
    });
  });
  els.sessionTypeFilter.addEventListener("change", () => {
    renderSessionList();
    void loadRemoteIndexForCurrentFilter();
  });
  els.itemSearch.addEventListener("input", () => {
    state.visibleThreadItems = 140;
    state.visibleRawEvents = 240;
    renderMainContent();
  });
  els.itemTypeFilter.addEventListener("change", () => {
    state.visibleThreadItems = 140;
    renderMainContent();
  });
  els.importantOnly.addEventListener("change", renderMainContent);
  els.compactViewButton.addEventListener("click", () => setViewMode("compact"));
  els.auditViewButton.addEventListener("click", () => setViewMode("audit"));
  els.rawViewButton.addEventListener("click", () => setViewMode("raw"));
  els.reviewTabs?.querySelectorAll("[data-review-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.reviewTab = button.dataset.reviewTab || "summary";
      renderInspector();
    });
  });
  els.showMoreEventsButton.addEventListener("click", renderInspector);
  els.copyRawButton.addEventListener("click", copyReviewReference);
  els.copyMarkdownButton.addEventListener("click", copyMarkdown);
  els.downloadMarkdownButton.addEventListener("click", downloadMarkdown);
  els.toggleLeft.addEventListener("click", () => {
    const next = els.appShell.dataset.left === "open" ? "closed" : "open";
    els.appShell.dataset.left = next;
  });
  els.toggleRight.addEventListener("click", () => {
    const next = els.appShell.dataset.right === "open" ? "closed" : "open";
    els.appShell.dataset.right = next;
    syncInspectorResizerState();
  });
  bindInspectorResize();
  window.addEventListener("resize", () => applyInspectorWidth(state.inspectorWidth));
  document.querySelectorAll("[data-panel-target]").forEach((button) => {
    button.addEventListener("click", () => {
      els.appShell.dataset.panel = button.dataset.panelTarget;
    });
  });
}

function bindInspectorResize() {
  if (!els.inspectorResizer) return;
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
    const min = bounds?.min ?? inspectorWidthDefaults.min;
    const max = bounds?.max ?? inspectorWidthDefaults.max;
    els.inspectorResizer.setAttribute("aria-valuemin", String(min));
    els.inspectorResizer.setAttribute("aria-valuemax", String(max));
    els.inspectorResizer.setAttribute("aria-valuenow", String(state.inspectorWidth));
    els.inspectorResizer.setAttribute("aria-disabled", inspectorResizeEnabled() ? "false" : "true");
  }
  if (options.persist) saveInspectorWidth(state.inspectorWidth);
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
  return Boolean(els.appShell?.dataset.right !== "closed" && window.matchMedia("(min-width: 1181px)").matches);
}

function syncInspectorResizerState() {
  applyInspectorWidth(state.inspectorWidth);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || min));
}

async function loadHealthAndSources() {
  try {
    const health = await fetchJson("/api/health");
    state.sources = health.sources || [];
    state.selectedSourceId = health.defaultSourceId || "local";
    renderSourceControls();
    els.healthStatus.textContent = health.sources?.length > 1 ? `数据源 ${health.sources.length} 个` : `只读数据源 ${health.codexHome}`;
    await reloadPeers();
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
    renderStatusbar();
    return;
  }
  const status = source.status || {};
  els.refreshRemoteButton.hidden = !status.refreshable;
  els.refreshRemoteButton.disabled = Boolean(status.refreshing);
  els.refreshRemoteButton.textContent = status.refreshing ? "远程刷新中" : "刷新远程";
  const parts = [source.kind === "remote" ? "远程实时快照" : "本机"];
  if (status.refreshing) parts.push("刷新中");
  if (status.lastSuccessfulRefreshAt) parts.push(`最近成功 ${formatDate(status.lastSuccessfulRefreshAt)}`);
  if (status.stale) parts.push("正在浏览旧快照");
  if (status.error?.message) parts.push(status.error.message);
  if (source.kind === "remote" && !status.snapshotAvailable) parts.push("尚无可用快照");
  if (source.kind === "remote" && state.sessionTimeFilter !== "realtime") {
    parts.push(state.remoteIndexLoading ? "历史索引检索中" : "历史仅索引");
    if (state.remoteIndexError) parts.push(state.remoteIndexError);
  }
  els.sourceStatus.textContent = parts.join(" · ");
  renderStatusbar();
}

async function loadSessions({ keepSelection = false } = {}) {
  setBusy(true);
  try {
    const data = await fetchJson(sourceSessionsUrl());
    if (data.source) upsertSource(data.source);
    state.sessions = data.sessions || [];
    state.remoteIndexSessions = [];
    state.remoteIndexError = "";
    renderSessionList();
    const nextSession =
      keepSelection && state.filteredSessions.some((session) => sessionKey(session) === state.selectedSessionKey)
        ? state.filteredSessions.find((session) => sessionKey(session) === state.selectedSessionKey)
        : state.filteredSessions[0] || state.sessions[0];
    if (nextSession && !nextSession.remoteIndexOnly) {
      await selectSession(nextSession.id);
    } else {
      clearSelectedSession();
      renderAll();
    }
    await loadRemoteIndexForCurrentFilter();
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
  state.selectedAuditNodeId = null;
  state.selectedAuditTurnKey = null;
  state.selectedTerminalBlockId = null;
  state.expandedTraceNodeIds = new Set();
  state.expandedAuditTurnKeys = new Set();
  state.expandedAuditGroupIds = new Set();
  state.rawEventCache = new Map();
  state.visibleEvents = 40;
  state.visibleThreadItems = 140;
  state.visibleRawEvents = 240;
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

async function reloadSelectedSessionDetail() {
  if (!state.selectedSessionId) return;
  const detail = await fetchJson(sourceSessionUrl(state.selectedSessionId));
  state.detail = detail;
  state.selectedSourceId = detail.session?.sourceId || state.selectedSourceId;
  state.selectedSessionKey = sessionKey(detail.session || { id: state.selectedSessionId, sourceId: state.selectedSourceId });
  primeTraceExpansion(detail);
  renderAll();
}

function clearSelectedSession() {
  state.selectedSessionId = null;
  state.selectedSessionKey = null;
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
  state.rawEventCache = new Map();
  els.copyMarkdownButton.disabled = true;
  els.downloadMarkdownButton.disabled = true;
}

async function selectSource(sourceId) {
  if (!sourceId || sourceId === state.selectedSourceId) return;
  state.selectedSourceId = sourceId;
  state.remoteIndexSessions = [];
  state.remoteIndexError = "";
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

async function reloadPeers() {
  const data = await fetchJson("/api/peers").catch((error) => {
    state.peerEditorStatusText = error.message;
    return null;
  });
  if (!data?.peers) return;
  state.peers = data.peers;
  if (data.sources) state.sources = data.sources;
  renderSourceControls();
  renderPeerManager();
}

function openPeerDialog() {
  reloadPeers();
  if (!state.selectedPeerId && state.peers.length > 0) state.selectedPeerId = state.peers[0].id;
  renderPeerManager();
  els.peerDialog.showModal();
}

function renderPeerManager() {
  if (!els.peerList) return;
  const selected = state.peers.find((peer) => peer.id === state.selectedPeerId) || null;
  if (state.peers.length === 0) {
    els.peerList.innerHTML = `<div class="peer-empty">暂无远端设备</div>`;
  } else {
    els.peerList.innerHTML = state.peers.map(renderPeerRow).join("");
  }
  els.peerList.querySelectorAll("[data-peer-id]").forEach((row) => {
    row.addEventListener("click", () => selectPeerForEdit(row.dataset.peerId));
  });
  fillPeerForm(selected);
}

function renderPeerRow(peer) {
  const active = peer.id === state.selectedPeerId ? " active" : "";
  const status = peer.enabled ? (peer.hasToken ? "已配置" : "缺 token") : "停用";
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

function fillPeerForm(peer) {
  els.peerId.value = peer?.id || "";
  els.peerLabel.value = peer?.label || "";
  els.peerUrl.value = peer?.url || "";
  els.peerToken.value = "";
  els.peerToken.placeholder = peer?.hasToken ? "已保存；留空表示保留原 token" : "远端 CODEX_SHARE_TOKEN";
  els.peerEnabled.checked = peer?.enabled !== false;
  els.deletePeerButton.disabled = !peer;
  els.testPeerButton.disabled = !peer;
  if (!els.peerEditorStatus.textContent || els.peerEditorStatus.dataset.sticky !== "true") {
    els.peerEditorStatus.textContent = peer ? "编辑设备；Token 留空会保留原值。" : "新建设备；保存后立即出现在数据源列表。";
  }
  els.peerEditorStatus.dataset.sticky = "false";
}

async function savePeerFromForm(event) {
  event.preventDefault();
  const existingId = els.peerId.value.trim();
  const body = {
    id: existingId || undefined,
    label: els.peerLabel.value.trim(),
    url: els.peerUrl.value.trim(),
    token: els.peerToken.value.trim(),
    enabled: els.peerEnabled.checked,
  };
  setPeerStatus("保存中...");
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
    state.selectedPeerId = data.peer?.id || existingId || null;
    renderSourceControls();
    renderPeerManager();
    setPeerStatus("已保存");
    showToast("远端设备已保存");
  } catch (error) {
    setPeerStatus(`保存失败：${error.message}`);
  }
}

async function testSelectedPeer() {
  const id = els.peerId.value.trim();
  if (!id) return;
  setPeerStatus("测试连接中...");
  try {
    const result = await fetchJson(`/api/peers/${encodeURIComponent(id)}/test`, { method: "POST" });
    setPeerStatus(result.ok ? `连接正常 · ${formatDate(result.remote?.time) || "远端已响应"}` : `连接失败：${result.error || "未知错误"}`);
  } catch (error) {
    setPeerStatus(`连接失败：${error.message}`);
  }
}

async function deleteSelectedPeer() {
  const id = els.peerId.value.trim();
  if (!id) return;
  setPeerStatus("删除中...");
  try {
    const data = await fetchJson(`/api/peers/${encodeURIComponent(id)}`, { method: "DELETE" });
    state.peers = data.peers || [];
    state.sources = data.sources || state.sources.filter((source) => source.id !== id);
    if (state.selectedSourceId === id) state.selectedSourceId = "local";
    state.selectedPeerId = state.peers[0]?.id || null;
    renderSourceControls();
    renderPeerManager();
    await loadSessions();
    showToast("远端设备已删除");
  } catch (error) {
    setPeerStatus(`删除失败：${error.message}`);
  }
}

function setPeerStatus(message) {
  els.peerEditorStatus.textContent = message;
  els.peerEditorStatus.dataset.sticky = "true";
}

function openSettingsDialog() {
  state.summaryRules = window.ToolSummary?.loadCustomRules?.() || [];
  state.executionGroupRules = window.ExecutionGrouping?.loadCustomRules?.() || [];
  state.evidenceRiskRules = window.EvidenceRiskRules?.loadCustomRules?.() || [];
  normalizeSettingsView();
  renderSettingsDialog();
  els.settingsDialog?.showModal();
}

function selectSettingsViewFromEvent(event) {
  const button = event.target.closest("[data-settings-view]");
  if (!button) return;
  const view = button.dataset.settingsView;
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
  if (els.settingsStatus) {
    const evidenceCount = window.EvidenceRiskRules?.activeRules?.(state.evidenceRiskRules)?.length || 0;
    const currentView = settingsViewOptions.find((view) => view.id === state.settingsView);
    els.settingsStatus.textContent = `${currentView?.label || "展示规则"} · 摘要自定义 ${state.summaryRules.length} 条；执行聚合自定义 ${state.executionGroupRules.length} 条；Evidence 生效 ${evidenceCount} 条；配置保存在当前浏览器本地。`;
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
      label: "Evidence 风险",
      value: `${evidenceActiveCount}`,
      detail: `${evidenceLocalCount} 条本地覆盖 · ${evidenceDefaultCount} 条内置`,
    },
    {
      id: "structured",
      label: "结构化展示",
      value: "3",
      detail: "Git、搜索、测试检查 viewer",
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
          <span class="field-label">名称</span>
          <input class="text-input" type="text" value="${escapeAttr(rule.label || "")}" data-rule-field="label" data-rule-index="${escapeAttr(String(index))}" placeholder="读取文件" />
        </label>
        <label>
          <span class="field-label">工具</span>
          <input class="text-input" type="text" value="${escapeAttr(rule.tool || "")}" data-rule-field="tool" data-rule-index="${escapeAttr(String(index))}" placeholder="exec_command 或 *" />
        </label>
        <label>
          <span class="field-label">标题模板</span>
          <input class="text-input" type="text" value="${escapeAttr(rule.title || "")}" data-rule-field="title" data-rule-index="${escapeAttr(String(index))}" placeholder="读取文件内容" />
        </label>
        <label>
          <span class="field-label">摘要模板</span>
          <input class="text-input" type="text" value="${escapeAttr(rule.summary || "")}" data-rule-field="summary" data-rule-index="${escapeAttr(String(index))}" placeholder="{path}" />
        </label>
      </div>
      <label>
        <span class="field-label">匹配正则</span>
        <textarea class="text-input rule-pattern-input" data-rule-field="pattern" data-rule-index="${escapeAttr(String(index))}" spellcheck="false" placeholder="\\bGet-Content\\b">${escapeHtml(rule.pattern || "")}</textarea>
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
    els.executionGroupRuleList.innerHTML = `<div class="rule-empty">暂无自定义执行聚合规则。Audit 会先使用自定义规则，再回退到内置规则。</div>`;
    return;
  }
  els.executionGroupRuleList.innerHTML = state.executionGroupRules.map((rule, index) => renderExecutionGroupRuleEditor(rule, index)).join("");
  els.executionGroupRuleList.querySelectorAll("[data-group-rule-field]").forEach((input) => {
    input.addEventListener("input", () => updateExecutionGroupRuleFromInput(input));
    input.addEventListener("change", () => updateExecutionGroupRuleFromInput(input));
  });
  els.executionGroupRuleList.querySelectorAll("[data-delete-group-rule]").forEach((button) => {
    button.addEventListener("click", () => {
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
          <input class="text-input" type="text" value="${escapeAttr(rule.label || "")}" data-group-rule-field="label" data-group-rule-index="${escapeAttr(String(index))}" placeholder="收集文件与目录信息" />
        </label>
        <label>
          <span class="field-label">工具</span>
          <input class="text-input" type="text" value="${escapeAttr(rule.tool || "")}" data-group-rule-field="tool" data-group-rule-index="${escapeAttr(String(index))}" placeholder="exec_command 或 *" />
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
        <textarea class="text-input rule-pattern-input" data-group-rule-field="pattern" data-group-rule-index="${escapeAttr(String(index))}" spellcheck="false" placeholder="读取文件内容|列出目录">${escapeHtml(rule.pattern || "")}</textarea>
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
    els.evidenceRiskRuleList.innerHTML = `<div class="rule-empty">暂无 Evidence 风险规则。Audit 会回退到内置规则。</div>`;
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
        ${isDefaultRule ? `<span class="muted">内置项</span>` : `<button class="ghost-button small danger" type="button" data-delete-evidence-rule="${escapeAttr(String(index))}">删除</button>`}
      </div>
      <div class="summary-rule-grid">
        <label>
          <span class="field-label">名称</span>
          <input class="text-input" type="text" value="${escapeAttr(rule.label || "")}" data-evidence-rule-field="label" data-evidence-rule-index="${escapeAttr(String(index))}" placeholder="工具输出风险词" />
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
          <input class="text-input" type="text" value="${escapeAttr(rule.tool || "*")}" data-evidence-rule-field="tool" data-evidence-rule-index="${escapeAttr(String(index))}" placeholder="exec_command 或 *" />
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
          <input class="text-input" type="text" value="${escapeAttr(fieldText)}" data-evidence-rule-field="textFields" data-evidence-rule-index="${escapeAttr(String(index))}" placeholder="status,output,payloadPreview" />
        </label>
        <label>
          <span class="field-label">大型输出阈值</span>
          <input class="text-input" type="number" min="1" step="1" value="${escapeAttr(String(rule.maxLength || 100000))}" data-evidence-rule-field="maxLength" data-evidence-rule-index="${escapeAttr(String(index))}" />
        </label>
        <label class="summary-rule-grid-wide">
          <span class="field-label">提示文案</span>
          <input class="text-input" type="text" value="${escapeAttr(rule.summary || "")}" data-evidence-rule-field="summary" data-evidence-rule-index="${escapeAttr(String(index))}" placeholder="工具输出或状态包含风险词。" />
        </label>
      </div>
      <label>
        <span class="field-label">风险词正则</span>
        <textarea class="text-input rule-pattern-input" data-evidence-rule-field="riskPattern" data-evidence-rule-index="${escapeAttr(String(index))}" spellcheck="false">${escapeHtml(rule.riskPattern || "")}</textarea>
      </label>
      <label>
        <span class="field-label">非零失败正则</span>
        <textarea class="text-input rule-pattern-input" data-evidence-rule-field="nonZeroFailurePattern" data-evidence-rule-index="${escapeAttr(String(index))}" spellcheck="false">${escapeHtml(rule.nonZeroFailurePattern || "")}</textarea>
      </label>
      <label>
        <span class="field-label">忽略输出正文的命令正则</span>
        <textarea class="text-input rule-pattern-input" data-evidence-rule-field="ignoredCommandPattern" data-evidence-rule-index="${escapeAttr(String(index))}" spellcheck="false" placeholder="读取文件或搜索文本命令">${escapeHtml(rule.ignoredCommandPattern || "")}</textarea>
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
  const index = Number(input.dataset.ruleIndex);
  const field = input.dataset.ruleField;
  const rule = state.summaryRules[index];
  if (!rule || !field) return;
  rule[field] = field === "enabled" ? input.checked : input.value;
}

function updateExecutionGroupRuleFromInput(input) {
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
}

function updateEvidenceRiskRuleFromInput(input) {
  const index = Number(input.dataset.evidenceRuleIndex);
  const field = input.dataset.evidenceRuleField;
  const rule = state.evidenceRiskRules[index];
  if (!rule || !field) return;
  if (field === "enabled") {
    rule[field] = input.checked;
  } else if (field === "maxLength") {
    rule[field] = input.valueAsNumber || Number(input.value) || 100000;
  } else if (field === "textFields") {
    rule[field] = input.value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  } else {
    rule[field] = input.value;
  }
}

function ensureEvidenceRiskEditorRules() {
  state.evidenceRiskRules = window.EvidenceRiskRules?.mergedRules?.(state.evidenceRiskRules) || state.evidenceRiskRules || [];
}

async function saveSettingsFromForm(event) {
  event.preventDefault();
  try {
    const normalized = window.ToolSummary?.saveCustomRules?.(state.summaryRules) || [];
    const normalizedGroupRules = window.ExecutionGrouping?.saveCustomRules?.(state.executionGroupRules) || [];
    const normalizedEvidenceRiskRules = window.EvidenceRiskRules?.saveCustomRules?.(state.evidenceRiskRules) || [];
    state.summaryRules = normalized;
    state.executionGroupRules = normalizedGroupRules;
    state.evidenceRiskRules = normalizedEvidenceRiskRules;
    renderSettingsDialog();
    if (state.selectedSessionId) {
      await reloadSelectedSessionDetail();
    } else {
      renderMainContent();
      renderInspector();
    }
    showToast("展示规则已保存");
    els.settingsDialog?.close();
  } catch (error) {
    showToast(`保存展示规则失败：${error.message}`);
  }
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
    label: "自定义 Evidence 风险",
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

async function loadRemoteIndexForCurrentFilter() {
  const source = selectedSource();
  if (source?.kind !== "remote" || state.sessionTimeFilter === "realtime") {
    if (state.remoteIndexSessions.length || state.remoteIndexError) {
      state.remoteIndexSessions = [];
      state.remoteIndexError = "";
      renderSessionList();
    }
    return;
  }
  const requestKey = [
    state.selectedSourceId,
    state.sessionTimeFilter,
    els.sessionSearch.value.trim(),
    els.sessionTypeFilter.value,
  ].join("\n");
  state.remoteIndexRequestKey = requestKey;
  state.remoteIndexLoading = true;
  renderSourceStatus();
  try {
    const data = await fetchJson(remoteIndexUrl());
    if (state.remoteIndexRequestKey !== requestKey) return;
    if (data.source) upsertSource(data.source);
    state.remoteIndexSessions = (data.sessions || []).map((session) => ({
      ...session,
      remoteIndexOnly: true,
      availableInSnapshot: false,
    }));
    state.remoteIndexError = "";
  } catch (error) {
    if (state.remoteIndexRequestKey !== requestKey) return;
    state.remoteIndexSessions = [];
    state.remoteIndexError = error.message;
    showToast(`远端索引检索失败：${error.message}`);
  } finally {
    if (state.remoteIndexRequestKey === requestKey) {
      state.remoteIndexLoading = false;
      renderSourceStatus();
      renderSessionList();
    }
  }
}

function renderAll() {
  renderSessionList();
  renderThreadHeader();
  renderStats();
  renderMainContent();
  renderInspector();
  renderStatusbar();
}

function setViewMode(mode) {
  state.viewMode = normalizeViewMode(mode);
  syncViewControls();
  renderMainContent();
}

function normalizeViewMode(mode) {
  if (visibleViewModes.has(mode)) return mode;
  if (mode === "trace" || mode === "terminal") return "audit";
  return "compact";
}

function syncViewControls() {
  state.viewMode = normalizeViewMode(state.viewMode);
  syncItemTypeFilterOptions();
  els.compactViewButton.classList.toggle("active", state.viewMode === "compact");
  els.auditViewButton.classList.toggle("active", state.viewMode === "audit");
  els.rawViewButton.classList.toggle("active", state.viewMode === "raw");
  els.threadContent.hidden = true;
  els.compactContent.hidden = state.viewMode !== "compact";
  els.terminalContent.hidden = true;
  els.auditContent.hidden = state.viewMode !== "audit";
  els.traceContent.hidden = true;
  els.rawContent.hidden = state.viewMode !== "raw";
  if (els.importantOnlyLabel) {
    els.importantOnlyLabel.textContent = "复核优先";
  }
  if (els.keyEventsTitle) {
    els.keyEventsTitle.textContent = "Review Dock";
  }
  if (els.importantOnlyControl) {
    els.importantOnlyControl.title = "仅在主内容区突出重要或复核优先内容";
  }
}

function syncItemTypeFilterOptions() {
  const mode = state.viewMode === "audit" ? "audit" : "standard";
  if (els.itemTypeFilter.dataset.optionMode === mode) return;
  const previous = els.itemTypeFilter.value || "all";
  const options = mode === "audit" ? auditItemTypeOptions : standardItemTypeOptions;
  const mapped = mode === "audit" ? standardToAuditType[previous] || "all" : auditToStandardType[previous] || "all";
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

function renderSessionList() {
  const query = els.sessionSearch.value.trim().toLowerCase();
  const filter = els.sessionTypeFilter.value;
  syncSessionTimeFilter();
  const sessions = mergedVisibleSessions().filter((session) => {
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
    const hint =
      selectedSource()?.kind === "remote" && state.sessionTimeFilter !== "realtime"
        ? "远端历史只检索索引；如果还在加载，请稍候。"
        : "调整搜索或过滤条件。";
    els.sessionList.innerHTML = emptyState("没有匹配的会话", hint);
    renderStatusbar();
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
      if (row.dataset.remoteIndexOnly === "true") {
        showToast("这是远端历史索引结果，未同步正文。请切回实时或刷新远程查看活跃会话。");
        return;
      }
      selectSession(row.dataset.sessionId);
    });
    row.addEventListener("keydown", (event) => {
      if (event.target.closest("a")) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      if (row.dataset.remoteIndexOnly === "true") {
        showToast("这是远端历史索引结果，未同步正文。");
        return;
      }
      selectSession(row.dataset.sessionId);
    });
  });
  renderStatusbar();
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
  const indexOnly = session.remoteIndexOnly ? " index-only" : "";
  const cwd = session.cwd ? shortPath(session.cwd) : "Projectless";
  const agentName = session.agentNickname || "Codex";
  const agent = session.agentNickname ? `${session.agentNickname}/${session.agentRole || "agent"}` : "Codex";
  const source = session.remoteIndexOnly ? `${session.sourceLabel || selectedSource()?.label || ""} · 仅索引` : session.sourceLabel || selectedSource()?.label || "";
  const model = session.model || session.modelProvider || "unknown";
  const status = sessionStatusLabel(session.status);
  return `
    <div class="session-row${active}${indexOnly}" role="button" tabindex="0" data-session-id="${escapeAttr(session.id)}" data-remote-index-only="${session.remoteIndexOnly ? "true" : "false"}">
      <span class="agent-dot" data-agent="${escapeAttr(agentName.toLowerCase())}" aria-hidden="true"></span>
      <span class="session-title markdown-inline-title">${renderMarkdownTitle(session.title || "未命名会话", query)}</span>
      <span class="session-date">${formatShortDate(session.updatedAt || session.fileModifiedAt)}</span>
      <span class="session-meta">
        <span>${escapeHtml(agent)}</span>
        <span>${escapeHtml(model)}</span>
        ${status ? `<span>${escapeHtml(status)}</span>` : ""}
        <span>${escapeHtml(cwd)}</span>
      </span>
      <span class="session-source">${escapeHtml(source)}</span>
    </div>
  `;
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
    ["Turns", stats.turnCount, "对话轮次"],
    ["Events", stats.eventCount, "事件流"],
    ["Important", stats.importantEventCount, "关键事件"],
    ["Tools", countItems("tool-call"), "工具调用"],
    ["Agents", stats.childThreadCount || 0, "子代理"],
    ["Tokens", tokenUsage ? compactNumber(tokenUsage.total_tokens || tokenUsage.totalTokens || 0) : "n/a", "最近统计"],
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

function renderStatusbar() {
  const source = selectedSource();
  const session = state.detail?.session;
  const stats = state.detail?.stats;
  const sourceKind = source?.kind === "remote" ? "远程快照" : "本机只读";
  const sourceLabelText = source?.label || source?.id || "未选择";
  els.statusSource.textContent = `数据源：${sourceLabelText} · ${sourceKind}`;
  els.statusSession.textContent = session
    ? `当前：${firstLine(session.title || session.id || "未命名会话", 54)}`
    : "未选择会话";
  const remoteIndexText = state.remoteIndexSessions.length ? ` · ${state.remoteIndexSessions.length} index` : "";
  els.statusEvents.textContent = `${state.filteredSessions.length || 0}/${state.sessions.length || 0} sessions${remoteIndexText}`;
  const updated = session?.updatedAt || session?.fileModifiedAt || session?.startedAt;
  els.statusUpdated.textContent = stats
    ? `${stats.eventCount || 0} events · ${stats.turnCount || 0} turns · ${formatDate(updated) || "未知时间"}`
    : "只读浏览";
}

function renderMainContent() {
  syncViewControls();
  if (state.viewMode === "raw") {
    renderRawView();
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
    els.compactContent.innerHTML = emptyState("没有匹配的精简内容", "精简视图包含用户输入、全部助手消息和子代理层级。");
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
  const assistantMessages = items
    .filter((item) => item.type === "assistant-message" && String(item.text || "").trim())
    .map(compactMessageFallback);
  return {
    id: turn.id || `turn-${index}`,
    turnNumber: turn.turnNumber ?? index + 1,
    status: turn.status,
    startedAt: turn.startedAt,
    completedAt: turn.completedAt,
    userMessages,
    assistantMessages,
    assistantMessage: assistantMessages.at(-1) || null,
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
    contextUsage: item.contextUsage || null,
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
  if (typeFilter === "tool") return Boolean(hasChild);
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
    ...(turn.userMessages || []).map((message) => message.text),
    ...compactAssistantMessages(turn).map((message) => message.text),
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
          <em>${escapeHtml([session.agentRole, node.notificationSummary?.label, `${(node.turns || []).length} turns`].filter(Boolean).join(" · "))}</em>
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
      ? `<button class="ghost-button small" type="button" data-compact-event-index="${escapeAttr(String(summary.eventIndex))}">查看 Raw</button>`
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
    ? turn.userMessages.map((message) => renderCompactMessage("user", "用户", message, context.query)).join("")
    : `<div class="compact-missing">本轮没有可展示的用户输入。</div>`;
  const assistantMessages = compactAssistantMessages(turn);
  const assistant = assistantMessages.length
    ? assistantMessages.map((message, index) => renderCompactMessage("assistant", compactAssistantMessageLabel(message, index, assistantMessages.length), message, context.query)).join("")
    : `<div class="compact-missing">本轮没有助手消息。</div>`;
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

function renderCompactMessage(kind, label, message, query) {
  const meta = [formatDate(message.timestamp), message.phase, message.truncated ? `已截断 ${compactNumber(message.textLength || 0)} 字符` : ""]
    .filter(Boolean)
    .join(" · ");
  return `
    <section class="compact-message ${kind}">
      <div class="compact-message-label">
        <span class="compact-message-role">${escapeHtml(label)}</span>
        ${renderContextUsageBadge(message.contextUsage)}
        <em>${escapeHtml(meta)}</em>
      </div>
      ${renderMarkdownMessage(message.text || "", query)}
    </section>
  `;
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
          <p class="eyebrow">Terminal Session</p>
          <h3 class="markdown-inline-title">${renderMarkdownTitle(detail.session?.title || "当前会话")}</h3>
        </div>
        <div class="terminal-role-nav" aria-label="Terminal 角色跳转">
          ${renderTerminalRoleNavButton("user", "User", activeStats.user, stats.user)}
          ${renderTerminalRoleNavButton("assistant", "Agent", activeStats.assistant, stats.assistant)}
          ${renderTerminalRoleNavButton("tool", "Tools", activeStats.tool, stats.tool)}
          ${renderTerminalRoleNavButton("error", "Errors", activeStats.error, stats.error)}
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
        title: `Turn ${turnNumber}`,
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
  const meta = [`Turn ${block.turnIndex + 1}`, formatDate(block.timestamp), block.item?.name, block.item?.status]
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
  next.scrollIntoView({ behavior: "smooth", block: "center" });
  selectTerminalBlock(next.dataset.terminalBlockId);
}

function renderAudit() {
  const detail = state.detail;
  if (!detail) {
    els.auditContent.innerHTML = emptyState("选择一个会话", "Audit 视图按 Turn 聚合目标、执行链、证据、验证、风险和最终回复。");
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
        ${emptyState("没有匹配的 Turn 审计单元", "调整内容搜索或类型过滤；Audit 会保留 Turn 上下文，不显示孤立风险列表。")}
      </div>
    `;
    return;
  }
  els.auditContent.innerHTML = `
    <div class="audit-shell">
      ${renderAuditHead(model, counts, filteredCounts, { query, typeFilter })}
      <div class="audit-turn-list" role="list">
        ${filteredTurns.map((turn) => renderAuditTurn(turn, { query, filtersActive: auditFiltersActive(filters) })).join("")}
        ${filteredUnplaced.length ? renderAuditUnplacedSection(filteredUnplaced, query) : ""}
      </div>
    </div>
  `;
  bindAuditInteractions();
}

function renderAuditHead(model, counts, filteredCounts, filters = {}) {
  const filtered = Boolean(filters.query || (filters.typeFilter && filters.typeFilter !== "all"));
  const metrics = [
    ["turn", "Turns", model.turns.length, model.filteredTurnCount ?? 0],
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
        <p class="eyebrow">Turn Audit Chain</p>
        <h3 class="markdown-inline-title">${renderMarkdownTitle(model.detail.session?.title || "当前会话")}</h3>
        <div class="audit-head-note">
          ${model.hasTraceRoot ? "以 trace.root 投影执行链" : "缺少 trace.root，按 Turn item 提供有限执行复核"}
          ${model.unplacedAuditNodes.length ? ` · ${model.unplacedAuditNodes.length} 个节点未关联` : ""}
        </div>
      </div>
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
  `;
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
    <article class="audit-turn${selected}${expanded ? " expanded" : ""}" role="listitem" data-audit-turn-root="${escapeAttr(turn.key)}">
      <div class="audit-turn-header">
        <button class="audit-turn-toggle" type="button" data-audit-turn-toggle="${escapeAttr(turn.key)}" title="${expanded ? "收起 Turn" : "展开 Turn"}">
          ${expanded ? "⌄" : "›"}
        </button>
        <button class="audit-turn-summary-button" type="button" data-audit-turn-key="${escapeAttr(turn.key)}">
          <span class="audit-turn-main">
            <span class="audit-turn-title">
              <strong>Turn ${escapeHtml(String(turn.turnNumber))}</strong>
              <span>${highlight(escapeHtml(turn.intentSummary), context.query)}</span>
            </span>
            <span class="audit-turn-result">${highlight(escapeHtml(turn.finalSummary), context.query)}</span>
            <span class="audit-turn-meta">${escapeHtml(meta || "无时间元数据")}</span>
          </span>
          <span class="audit-turn-state">
            <span class="audit-state-pill ${escapeAttr(verificationClass)}">${escapeHtml(stats.verificationStatus)}</span>
            <span class="audit-state-pill risk-${escapeAttr(riskClass)}">${escapeHtml(stats.riskLabel)}</span>
          </span>
          <span class="audit-turn-metrics" aria-label="Turn 审计指标">
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
              ${renderAuditEvidenceSection(turn, context)}
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

function renderAuditEvidenceSection(turn, context = {}) {
  const nodes = turn.visibleAuditPhaseNodes || turn.visibleAuditEvidenceNodes;
  const review = window.AuditClosure?.buildClosureReview(turn, {
    visibleNodes: nodes,
    visibleExecutionRows: turn.visibleExecutionRows,
    filtersActive: context.filtersActive,
  });
  if (!review) {
    return `
      <section class="audit-turn-section evidence">
        <div class="audit-section-title">
          <strong>闭环判断</strong>
          <span>缺少闭环判断模块</span>
        </div>
        <div class="audit-section-empty">闭环判断模块未加载，无法展示证据支撑和风险缺口。</div>
      </section>
    `;
  }
  return `
    <section class="audit-turn-section evidence">
      <div class="audit-section-title">
        <strong>闭环判断</strong>
        <span>${escapeHtml(review.countLabel)}</span>
      </div>
      ${renderAuditClosureReview(review, context.query)}
    </section>
  `;
}

function renderAuditClosureReview(review, query) {
  return `
    <div class="audit-closure-panel state-${escapeAttr(review.status)}">
      <div class="audit-closure-verdict state-${escapeAttr(review.status)}">
        <div class="audit-closure-verdict-main">
          <span class="audit-closure-status">${escapeHtml(review.label)}</span>
          <strong>${escapeHtml(review.headline)}</strong>
          <p>${escapeHtml(review.summary)}</p>
        </div>
        <div class="audit-closure-score" title="${escapeAttr("闭环度按目标、结论、风险、执行、证据和验证计算")}">
          <span>闭环度</span>
          <strong>${escapeHtml(review.score.label)}</strong>
        </div>
      </div>
      <div class="audit-closure-metrics">
        ${review.metrics.map(renderAuditClosureMetric).join("")}
      </div>
      <div class="audit-closure-lanes">
        ${review.lanes.map((lane) => renderAuditClosureLane(lane, query)).join("")}
        ${renderAuditClosureActionLane(review.actions)}
      </div>
    </div>
  `;
}

function renderAuditClosureMetric(metric) {
  return `
    <div class="audit-closure-metric state-${escapeAttr(metric.state)}">
      <span>${escapeHtml(metric.label)}</span>
      <strong>${escapeHtml(metric.value)}</strong>
      <em>${escapeHtml(metric.detail)}</em>
    </div>
  `;
}

function renderAuditClosureLane(lane, query) {
  const shown = lane.nodes.slice(0, 5);
  const more = lane.nodes.length - shown.length;
  return `
    <div class="audit-closure-lane state-${escapeAttr(lane.state)} lane-${escapeAttr(lane.key)}">
      <div class="audit-closure-lane-head">
        <strong>${escapeHtml(lane.label)}</strong>
        <span>${escapeHtml(lane.caption)}</span>
      </div>
      <div class="audit-closure-lane-body">
        ${
          shown.length
            ? shown.map((node) => renderAuditClosureNode(node, query)).join("")
            : `<span class="audit-closure-empty">${escapeHtml(lane.emptyText)}</span>`
        }
        ${more > 0 ? `<span class="audit-more-node">+${escapeHtml(String(more))}</span>` : ""}
      </div>
    </div>
  `;
}

function renderAuditClosureActionLane(actions = []) {
  return `
    <div class="audit-closure-lane state-action lane-next">
      <div class="audit-closure-lane-head">
        <strong>下一步</strong>
        <span>${escapeHtml(`${actions.length} 条建议`)}</span>
      </div>
      <div class="audit-closure-lane-body">
        ${actions.map(renderAuditClosureAction).join("")}
      </div>
    </div>
  `;
}

function renderAuditClosureAction(action) {
  return `
    <div class="audit-closure-action tone-${escapeAttr(action.tone || "neutral")}">
      <strong>${escapeHtml(action.title || "复核")}</strong>
      <span>${escapeHtml(action.body || "")}</span>
    </div>
  `;
}

function renderAuditClosureNode(node, query) {
  const selected = state.selectedAuditNodeId === node.id ? " selected" : "";
  const readable = readableAuditNode(node);
  const summary = firstLine(readable.summary || "", 150);
  const label = [auditTypeLabel(node.type), node.status, node.riskLevel && node.riskLevel !== "none" ? auditRiskLabel(node.riskLevel) : ""]
    .filter(Boolean)
    .join(" · ");
  return `
    <button class="audit-closure-node type-${escapeAttr(node.type)} risk-${escapeAttr(node.riskLevel || "none")}${selected}" type="button" data-audit-node-id="${escapeAttr(node.id)}">
      <span class="audit-closure-node-kind">${escapeHtml(auditNodeGlyph(node.type))}</span>
      <span class="audit-closure-node-main">
        <strong>${highlight(escapeHtml(firstLine(readable.title || auditTypeLabel(node.type), 54)), query)}</strong>
        ${summary ? `<small>${highlight(escapeHtml(summary), query)}</small>` : ""}
      </span>
      <em>${escapeHtml(label)}</em>
    </button>
  `;
}

function renderAuditUnlinkedSection(nodes, query) {
  return `
    <section class="audit-turn-section unlinked">
      <div class="audit-section-title">
        <strong>未关联 / Raw 复核</strong>
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
    node.status || "n/a",
    auditRiskMetaLabel(node.riskLevel),
    node.turnNumber ? `Turn ${node.turnNumber}` : "",
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

  const auditEvidenceNodes = turnAuditNodes.filter((node) => {
    if (node.type === "action") return false;
    if (unlinkedAuditNodes.some((candidate) => candidate.id === node.id)) return false;
    return true;
  });
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
    auditEvidenceNodes,
    unlinkedAuditNodes,
    executionRows,
    linkedNodeIds,
    stats,
    visibleExecutionRows: executionRows,
    visibleAuditEvidenceNodes: auditEvidenceNodes,
    visibleAuditPhaseNodes: turnAuditNodes,
    visibleUnlinkedAuditNodes: unlinkedAuditNodes,
  };
}

function buildAuditExecutionRows(detail, turn, turnIndex) {
  const rows = [];
  const seen = new Set();
  const traceTurn = traceTurnNodeForIndex(detail.trace?.root, turnIndex);
  if (traceTurn) {
    for (const row of flattenAuditExecutionRows(traceTurn.children || [], 0)) {
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

function flattenAuditExecutionRows(nodes, depth) {
  const rows = [];
  for (const node of nodes || []) {
    const isExecution = auditTraceNodeIsExecution(node);
    if (isExecution) rows.push(auditExecutionRowFromTraceNode(node, depth));
    rows.push(...flattenAuditExecutionRows(node.children || [], isExecution ? depth + 1 : depth));
  }
  return rows;
}

function auditTraceNodeIsExecution(node) {
  return ["tool", "handoff", "subagent", "lazy-child"].includes(node?.type);
}

function auditExecutionRowFromTraceNode(node, depth = 0) {
  const item = node.detail?.item || {};
  const ref = itemRefFromTraceNode(node);
  const itemIndex = itemIndexFromItemRef(ref);
  return {
    id: node.id,
    traceNodeId: node.id,
    itemRef: ref,
    itemIndex,
    type: node.type,
    icon: node.icon || node.type,
    label: node.label,
    title: node.title || item.name || node.label || node.id,
    subtitle: node.subtitle || "",
    status: node.status || item.status || "",
    timestamp: node.timestamp || item.timestamp || null,
    completedAt: node.completedAt || item.completedAt || null,
    durationMs: node.durationMs,
    durationEstimated: node.durationEstimated,
    depth,
    auditNodes: [],
  };
}

function auditExecutionRowFromItem(item, turnIndex) {
  const itemIndex = item.itemIndex ?? 0;
  const isHandoff = ["spawn_agent", "wait_agent", "handoff"].includes(item.name);
  return {
    id: `item:${turnIndex}:${itemIndex}:${item.id || item.type}`,
    traceNodeId: `item:${turnIndex}:${itemIndex}:${item.id || item.type}`,
    itemRef: itemRef(item),
    itemIndex,
    type: isHandoff ? "handoff" : "tool",
    icon: isHandoff ? "handoff" : "tool",
    label: isHandoff ? "Handoff" : "Tool call",
    title: item.name || item.callId || "tool",
    subtitle: [item.status, formatDate(item.timestamp)].filter(Boolean).join(" · "),
    status: item.status || "",
    timestamp: item.timestamp || null,
    completedAt: item.completedAt || null,
    durationMs: durationBetween(item.timestamp, item.completedAt),
    durationEstimated: !item.completedAt,
    depth: 0,
    auditNodes: [],
  };
}

function attachAuditRowsToAgentMessages(rows, turn, turnIndex) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const agentRows = (turn.items || [])
    .map((item, itemIndex) => (item.type === "assistant-message" && String(item.text || "").trim() ? auditAgentMessageRowFromItem(item, turnIndex, itemIndex) : null))
    .filter(Boolean);

  if (!agentRows.length) {
    if (!sourceRows.length) return [];
    const parent = auditImplicitAgentMessageRow(turn, turnIndex);
    return linkAuditExecutionHierarchy([parent, ...sourceRows.map((row) => auditExecutionChildRow(row, parent))]);
  }

  if (!sourceRows.length) return linkAuditExecutionHierarchy(agentRows);

  const childrenByAgentId = new Map(agentRows.map((row) => [row.id, []]));
  for (const row of sourceRows) {
    const parent = auditAgentParentForExecutionRow(row, agentRows);
    if (parent) {
      childrenByAgentId.get(parent.id)?.push(auditExecutionChildRow(row, parent));
    }
  }

  const result = agentRows.flatMap((row) => [row, ...(childrenByAgentId.get(row.id) || [])]);

  return linkAuditExecutionHierarchy(result);
}

function auditAgentMessageRowFromItem(item, turnIndex, itemIndex) {
  const phase = item.phase || null;
  const title = phase === "final" ? "助手最终回复" : "助手消息";
  return {
    id: `agent-message:${turnIndex}:${itemIndex}:${item.id || "assistant"}`,
    traceNodeId: null,
    itemRef: itemRef({ ...item, turnIndex, itemIndex }),
    itemIndex,
    type: "agent_message",
    icon: "assistant",
    label: "Agent message",
    title,
    subtitle: firstLine(item.text || "", 180),
    status: phase || "observed",
    timestamp: item.timestamp || null,
    completedAt: item.completedAt || null,
    durationMs: null,
    durationEstimated: false,
    depth: 0,
    auditNodes: [],
    childRowIds: [],
    contextUsage: item.contextUsage || null,
  };
}

function auditImplicitAgentMessageRow(turn, turnIndex) {
  return {
    id: `agent-message:${turnIndex}:implicit`,
    traceNodeId: null,
    itemRef: null,
    itemIndex: -1,
    type: "agent_message",
    icon: "assistant",
    label: "Agent message",
    title: "助手消息 · 未记录正文",
    subtitle: "此 Turn 有执行动作，但原始日志没有对应的 agent_message 文本。",
    status: turn.status || "observed",
    timestamp: turn.startedAt || null,
    completedAt: turn.completedAt || null,
    durationMs: null,
    durationEstimated: false,
    depth: 0,
    auditNodes: [],
    childRowIds: [],
    synthetic: true,
  };
}

function auditExecutionChildRow(row, parent) {
  return {
    ...row,
    parentRowId: parent.id,
    agentMessageItemRef: parent.itemRef || null,
    depth: (parent.depth || 0) + 1 + (row.depth || 0),
  };
}

function auditAgentParentForExecutionRow(row, agentRows) {
  if (!agentRows.length) return null;
  const itemIndex = Number.isInteger(row.itemIndex) ? row.itemIndex : itemIndexFromItemRef(row.itemRef);
  if (Number.isInteger(itemIndex)) {
    const previous = [...agentRows].reverse().find((agent) => agent.itemIndex <= itemIndex);
    return previous || agentRows.find((agent) => agent.itemIndex > itemIndex) || agentRows[0];
  }
  const rowTime = dateValue(row.timestamp);
  if (rowTime != null) {
    const previous = [...agentRows].reverse().find((agent) => {
      const agentTime = dateValue(agent.timestamp);
      return agentTime != null && agentTime <= rowTime;
    });
    return previous || agentRows.find((agent) => {
      const agentTime = dateValue(agent.timestamp);
      return agentTime != null && agentTime > rowTime;
    }) || agentRows[0];
  }
  return agentRows[0];
}

function linkAuditExecutionHierarchy(rows) {
  const linked = rows.map((row) => ({ ...row, childRowIds: [...(row.childRowIds || [])] }));
  const byId = new Map(linked.map((row) => [row.id, row]));
  for (const row of linked) {
    if (!row.parentRowId) continue;
    const parent = byId.get(row.parentRowId);
    if (parent && !parent.childRowIds.includes(row.id)) parent.childRowIds.push(row.id);
  }
  return linked;
}

function traceTurnNodeForIndex(root, turnIndex) {
  if (!root) return null;
  const turns = (root.children || []).filter((node) => node.type === "turn");
  return turns[turnIndex] || null;
}

function itemRefFromTraceNode(node) {
  const match = String(node?.id || "").match(/^item:(\d+):(\d+):/);
  const type = node?.detail?.item?.type;
  if (!match || !type) return null;
  return `${match[1]}:${match[2]}:${type}`;
}

function itemIndexFromItemRef(ref) {
  const match = String(ref || "").match(/^\d+:(\d+):/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isInteger(value) ? value : null;
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
  return "此 Turn 没有工具、handoff、子代理调用或助手消息";
}

function auditFiltersActive(filters = {}) {
  return Boolean(filters.query || (filters.typeFilter && filters.typeFilter !== "all"));
}

function filterAuditTurnModel(turn, filters = {}) {
  if (!auditFiltersActive(filters)) return turn;
  const query = filters.query || "";
  const typeFilter = filters.typeFilter || "all";
  const matchingRows = turn.executionRows.filter((row) => auditExecutionRowMatches(row, query, typeFilter));
  const matchingPhaseNodes = turn.auditNodes.filter((node) => auditNodeMatches(node, query, typeFilter));
  const matchingNodes = turn.auditEvidenceNodes.filter((node) => auditNodeMatches(node, query, typeFilter));
  const matchingUnlinked = turn.unlinkedAuditNodes.filter((node) => auditNodeMatches(node, query, typeFilter));
  const rowContextIds = new Set(matchingRows.map((row) => row.id));
  const rowById = new Map(turn.executionRows.map((row) => [row.id, row]));
  const nodeContextIds = new Set(matchingNodes.map((node) => node.id));
  for (const row of matchingRows) {
    addAuditExecutionAncestors(row, rowById, rowContextIds);
    addAuditExecutionDescendants(row, rowById, rowContextIds);
  }
  for (const row of matchingRows) {
    for (const node of row.auditNodes || []) {
      if (node.type !== "action") nodeContextIds.add(node.id);
    }
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
  const visibleEvidenceNodes = turn.auditEvidenceNodes.filter((node) => nodeContextIds.has(node.id));
  const visiblePhaseNodeIds = new Set([...matchingPhaseNodes.map((node) => node.id), ...visibleEvidenceNodes.map((node) => node.id)]);
  for (const row of visibleExecutionRows) {
    for (const node of row.auditNodes || []) visiblePhaseNodeIds.add(node.id);
  }
  for (const node of matchingUnlinked) visiblePhaseNodeIds.add(node.id);
  const visiblePhaseNodes = turn.auditNodes.filter((node) => visiblePhaseNodeIds.has(node.id));
  const summaryMatches = auditTurnSearchText(turn).includes(query) && auditTurnMatchesType(turn, typeFilter);
  if (!summaryMatches && !visibleExecutionRows.length && !matchingNodes.length && !matchingUnlinked.length) return null;
  return {
    ...turn,
    visibleExecutionRows: summaryMatches && typeFilter === "all" ? turn.executionRows : visibleExecutionRows,
    visibleAuditEvidenceNodes: summaryMatches && !matchingNodes.length && typeFilter === "all" ? turn.auditEvidenceNodes : visibleEvidenceNodes,
    visibleAuditPhaseNodes: summaryMatches && typeFilter === "all" ? turn.auditNodes : visiblePhaseNodes,
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
  markAuditSelection();
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
  els.auditContent
    .querySelectorAll(".audit-evidence-node.selected, .audit-node-chip.selected, .audit-closure-node.selected")
    .forEach((row) => row.classList.remove("selected"));
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
  markAuditSelection();
}

function renderAuditActions(node) {
  const actions = [];
  if (node.eventIndex != null || node.sourceIndex != null) actions.push(`<button class="ghost-button small" type="button" data-open-audit-raw>打开 Raw event</button>`);
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
  if (node.eventIndex != null) parts.push(`event #${node.eventIndex}`);
  if (node.sourceIndex != null && node.sourceIndex !== node.eventIndex) parts.push(`source #${node.sourceIndex}`);
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
    showToast("未找到关联 Audit 节点");
    return;
  }
  if (state.viewMode !== "audit") {
    state.viewMode = "audit";
    syncItemTypeFilterOptions();
  }
  renderMainContent();
  selectAuditNode(target.id);
  window.setTimeout(() => {
    const active = els.auditContent.querySelector(`[data-audit-node-id="${cssEscape(target.id)}"]`);
    if (active) {
      active.scrollIntoView({ behavior: "smooth", block: "center" });
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
    els.rawContent.innerHTML = emptyState("选择一个会话", "Raw 视图展示会话级事件摘要和调试 JSON。");
    return;
  }
  const query = els.itemSearch.value.trim().toLowerCase();
  const typeFilter = els.itemTypeFilter.value;
  const events = (detail.events || []).filter((event) => rawEventMatches(event, query, typeFilter));
  if (events.length === 0) {
    els.rawContent.innerHTML = emptyState("没有匹配的 Raw 事件", "调整内容搜索或类型过滤。");
    return;
  }
  const shown = events.slice(0, state.visibleRawEvents);
  const selected = selectedRawViewEvent(shown, events);
  els.rawContent.innerHTML = `
    <div class="raw-view-shell">
      <div class="raw-view-head">
        <div>
          <p class="eyebrow">Raw JSON</p>
          <h3>${escapeHtml(events.length)} / ${escapeHtml(detail.events.length)} events</h3>
        </div>
        <div class="raw-view-actions">
          <button class="ghost-button small" type="button" data-copy-raw-session>复制事件摘要</button>
        </div>
      </div>
      <div class="raw-view-layout">
        <div class="raw-view-list">
          ${shown.map((event) => renderRawViewEventRow(event)).join("")}
          ${
            events.length > shown.length
              ? `<button class="ghost-button full-width" type="button" data-show-more-raw>显示更多事件 (${shown.length}/${events.length})</button>`
              : ""
          }
        </div>
        <div class="raw-view-preview">
          <div class="raw-preview-title">
            <strong>${escapeHtml(selected ? `#${selected.index} ${humanEventTitle(selected)}` : "事件摘要")}</strong>
            <span>${escapeHtml(selected ? selected.kind || "" : "Pretty JSON")}</span>
          </div>
          <pre class="raw-preview">${escapeHtml(JSON.stringify(selected || detailSummaryForRaw(detail), null, 2))}</pre>
        </div>
      </div>
    </div>
  `;
  els.rawContent.querySelectorAll("[data-raw-event-index]").forEach((button) => {
    button.addEventListener("click", () => selectRawViewEvent(Number(button.dataset.rawEventIndex)));
  });
  els.rawContent.querySelector("[data-show-more-raw]")?.addEventListener("click", () => {
    state.visibleRawEvents += 240;
    renderRawView();
  });
  els.rawContent.querySelector("[data-copy-raw-session]")?.addEventListener("click", async () => {
    await copyText(JSON.stringify(detailSummaryForRaw(detail), null, 2));
    showToast("已复制会话事件摘要");
  });
}

function rawEventMatches(event, query, typeFilter) {
  if (query && !JSON.stringify(event).toLowerCase().includes(query)) return false;
  if (typeFilter === "message") return event.kind === "user_message" || event.kind === "agent_message" || event.role === "user" || event.role === "assistant";
  if (typeFilter === "tool") return /tool|call|function|mcp|patch/i.test([event.kind, event.type, event.payloadType].filter(Boolean).join(" "));
  if (typeFilter === "output") return /output|result/i.test([event.kind, event.type, event.payloadType, event.title].filter(Boolean).join(" "));
  if (typeFilter === "reasoning") return /reasoning/i.test([event.kind, event.type, event.payloadType].filter(Boolean).join(" "));
  if (typeFilter === "system") return event.kind === "system" || event.kind === "token_count" || event.kind === "session_meta";
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
  return `
    <button class="raw-view-row${active}" type="button" data-raw-event-index="${event.index}">
      <span class="raw-view-kind">${escapeHtml(event.kind || event.type || "event")}</span>
      <strong>${escapeHtml(`event #${event.index} ${humanEventTitle(event)}`)}</strong>
      <em>${escapeHtml(formatDate(event.timestamp) || event.payloadType || "")}</em>
      <span>${escapeHtml(firstLine(event.preview || "", 140))}</span>
    </button>
  `;
}

async function openRawEventFromAudit(index) {
  state.viewMode = "raw";
  state.selectedEventIndex = index;
  renderMainContent();
  await selectRawViewEvent(index);
  const active = els.rawContent.querySelector(`[data-raw-event-index="${index}"]`);
  active?.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function selectRawViewEvent(index) {
  await selectRawEvent(index, { rerender: false });
  renderRawView();
  renderInspector();
}

function detailSummaryForRaw(detail) {
  return {
    session: detail.session,
    stats: detail.stats,
    events: detail.events || [],
  };
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
  els.selectionDetails.innerHTML = renderReviewBody(context);
  els.inspectorActions.innerHTML = renderReviewActions(context);
  bindReviewBodyActions(context);
  bindReviewActions(context);
  if (els.eventCount) els.eventCount.textContent = String(context.metrics?.events ?? 0);
  if (els.selectedEventLabel) els.selectedEventLabel.textContent = context.title || "未选择";
  if (els.rawPreview) els.rawPreview.textContent = context.debugData ? JSON.stringify(context.debugData, null, 2) : "";
  els.copyRawButton.disabled = !state.detail;
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
          <span class="raw-event-title">${escapeHtml("event #" + event.index + " " + humanEventTitle(event))}</span>
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
  const event = state.detail?.events.find((candidate) => candidate.index === index);
  if (!event) return;
  if (rerender) renderInspector();
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
  state.selectedTerminalBlockId = null;
  state.selectedAuditNodeId = null;
  state.selectedAuditTurnKey = null;
  renderInspector();
  els.traceContent.querySelectorAll(".trace-row.selected").forEach((row) => row.classList.remove("selected"));
  const active = els.traceContent.querySelector(`[data-trace-node-id="${cssEscape(id)}"]`);
  active?.classList.add("selected");
  markAuditSelection();
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
    ["状态", node.status || "n/a"],
    ["风险信号", auditRiskLabel(node.riskLevel || "none")],
    ["Turn", node.turnNumber ? String(node.turnNumber) : "n/a"],
    ["时间", formatDate(node.timestamp) || "n/a"],
    ["itemRef", node.itemRef || "n/a"],
    ["事件索引", auditEventIndexLabel(node) || "n/a"],
  ];
  if (node.traceNodeId) rows.push(["执行节点", node.traceNodeId]);
  if (node.relatedNodeId) rows.push(["关联来源", relatedMeta || node.relatedNodeId]);
  if (node.toolName) rows.push(["工具", node.toolName]);
  if (node.callId) rows.push(["Call ID", node.callId]);
  if (node.tags?.length) rows.push(["标签", node.tags.join(", ")]);
  const body = [node.summary, node.outputPreview, node.argumentsPreview].filter(Boolean).join("\n\n");
  return renderSelectionCard({
    eyebrow: "Audit 节点",
    title: node.title || auditTypeLabel(node.type),
    meta: [auditTypeLabel(node.type), auditRiskLabel(node.riskLevel || "none")].filter(Boolean).join(" · "),
    rows,
    body: body ? firstLine(body, 1100) : "",
    actions: auditSelectionActions(node),
  });
}

function renderAuditTurnSelection(turn) {
  const rows = [
    ["Turn", String(turn.turnNumber)],
    ["验证状态", turn.stats.verificationStatus],
    ["最高风险", turn.stats.riskLabel],
    ["工具调用", String(turn.stats.toolCount)],
    ["子代理", String(turn.stats.subagentCount)],
    ["证据", String(turn.stats.evidenceCount)],
    ["缺口", String(turn.stats.gapCount)],
  ];
  const body = [`目标：${turn.intentSummary}`, `结果：${turn.finalSummary}`].join("\n");
  return renderSelectionCard({
    eyebrow: "Turn 审计摘要",
    title: `Turn ${turn.turnNumber}`,
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
    ["状态", node.status || "n/a"],
    ["时间", [formatDate(node.timestamp), formatDate(node.completedAt)].filter(Boolean).join(" - ") || "n/a"],
    ["耗时", node.durationMs == null ? "n/a" : `${formatDuration(node.durationMs)}${node.durationEstimated ? " 估算" : ""}`],
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
    ["Turn", item.turnIndex == null ? "n/a" : String(item.turnIndex + 1)],
    ["时间", formatDate(item.timestamp) || "n/a"],
    ["状态", [item.phase, item.status].filter(Boolean).join(" / ") || "n/a"],
  ];
  if (item.name) rows.push(["工具", item.name]);
  if (item.callId) rows.push(["Call ID", item.callId]);
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
    ["事件", `event #${event.index}`],
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
      if (action.action === "open-raw-event") {
        openRawEventFromAudit(action.index);
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
    actions.unshift({ label: "跳到 Raw", action: "open-raw-event", index: node.eventIndex ?? node.sourceIndex });
    actions.push({ label: "复制事件索引", copy: String(node.eventIndex ?? node.sourceIndex), toast: "已复制事件索引" });
  }
  if (node.itemRef) actions.unshift({ label: "查看关联项", action: "open-item-ref", ref: node.itemRef });
  if (node.traceNodeId) actions.push({ label: "查看执行节点", action: "open-trace-node", id: node.traceNodeId });
  if (node.relatedNodeId) actions.unshift({ label: "定位关联节点", action: "open-audit-node", node });
  return actions;
}

function auditTurnSelectionActions(turn) {
  return [
    { label: "复制摘要", copy: `Turn ${turn.turnNumber}\n目标：${turn.intentSummary}\n结果：${turn.finalSummary}`, toast: "已复制 Turn 审计摘要" },
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
    actions.push({ label: "跳到 Raw", action: "open-raw-event", index: item.sourceIndex ?? item.outputSourceIndex });
  }
  return actions;
}

function buildReviewContext() {
  if (!state.detail) {
    return reviewContextBase({
      kind: "empty",
      kindLabel: "未选择",
      title: "选择一个会话",
      summary: "左侧选择会话后，复核台会显示当前对象的摘要、证据、关系和来源。",
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
    tokens: tokenUsage ? compactNumber(tokenUsage.total_tokens || tokenUsage.totalTokens || 0) : "n/a",
  };
  const evidence = [
    ...verification.slice(0, 8).map(reviewEvidenceFromAuditNode),
    ...risks.slice(0, 8).map(reviewEvidenceFromAuditNode),
  ];
  if (!evidence.length) {
    evidence.push({
      kind: "概览",
      title: "没有优先风险或缺口",
      meta: "Session Brief",
      body: "从 Audit 视图选择 Turn、执行节点或证据节点后，复核台会切换到对象级复核。",
    });
  }
  return reviewContextBase({
    kind: "session",
    kindLabel: "Session Brief",
    title: session.title || "未命名会话",
    riskLevel: highestRiskLevel(risks),
    badges: [session.dataSourceKind === "remote" ? "远程快照" : "本机只读", `${metrics.turns} turns`, `${metrics.events} events`],
    summary: auditNodeFullBody(finalNode) || finalNode?.summary || "当前会话的默认复核入口。选择 Audit 节点、工具调用、Raw event 或子代理后，右侧会切换到对象级复核。",
    rows: [
      ["数据源", session.sourceLabel || selectedSource()?.label || "本机 Codex Home"],
      ["模型", [session.model, session.reasoningEffort].filter(Boolean).join(" / ") || "unknown"],
      ["工作目录", session.cwd || "Projectless"],
      ["时间范围", [formatDate(startedAt), formatDate(endedAt)].filter(Boolean).join(" - ") || "n/a"],
      ["持续时间", duration == null ? "n/a" : formatDuration(duration)],
      ["Tokens", metrics.tokens],
      ["数据文件", session.relativePath || "n/a"],
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
      { label: "Session detail", value: session.id || "n/a", data: { session, stats } },
      { label: "数据文件", value: stats.dataPath || session.relativePath || "n/a", data: stats.dataPath || session.relativePath || "" },
    ],
    actions: [
      { label: "复制引用", action: "copy-reference" },
      { label: "复制 Markdown", action: "copy-markdown" },
      { label: "复制会话 ID", copy: session.id || "", toast: "已复制会话 ID" },
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
    event ? reviewRelationFromEvent(event, "Raw event") : null,
  ].filter(Boolean);
  return reviewContextBase({
    kind: "audit_node",
    kindLabel: "Audit 节点",
    title: readable.title || node.title || auditTypeLabel(node.type),
    riskLevel: node.riskLevel || "none",
    badges: [auditTypeLabel(node.type), node.turnNumber ? `Turn ${node.turnNumber}` : "未定位 Turn", auditEventIndexLabel(node)].filter(Boolean),
    summary: body || "该 Audit 节点没有摘要正文。",
    changeSet: readable.changeSet,
    rows: [
      ["节点类型", auditTypeLabel(node.type)],
      ["状态", node.status || "n/a"],
      ["风险信号", auditRiskLabel(node.riskLevel || "none")],
      ["Turn", node.turnNumber ? String(node.turnNumber) : "n/a"],
      ["时间", formatDate(node.timestamp) || "n/a"],
      ["itemRef", node.itemRef || "n/a"],
      ["事件索引", auditEventIndexLabel(node) || "n/a"],
      ["工具", node.toolName || "n/a"],
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
    kindLabel: "Turn 审计",
    title: `Turn ${turn.turnNumber}`,
    riskLevel: highestRiskLevel(riskNodes),
    badges: [turn.stats.verificationStatus, turn.stats.riskLabel, `${turn.auditNodes.length} audit nodes`].filter(Boolean),
    summary: [`目标：${auditTurnIntentBody(turn)}`, `结果：${auditTurnFinalBody(turn)}`].join("\n"),
    rows: [
      ["Turn", String(turn.turnNumber)],
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
      : [{ kind: "Turn", title: "没有独立证据节点", meta: "Audit", body: "展开 Audit 主视图可以查看本 Turn 的执行链。" }],
    relations,
    sources: [{ label: "Turn model", value: turn.key, data: auditTurnDebugPreview(turn) }],
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
    kindLabel: "执行节点",
    title: readable?.title || node.title || node.label || node.id,
    riskLevel: traceRiskLevel(node, item),
    badges: [traceTypeLabel(node.type), node.status, item?.sourceIndex != null ? `event #${item.sourceIndex}` : ""].filter(Boolean),
    summary: body || node.subtitle || "该执行节点没有可显示的正文摘要。",
    changeSet: readable?.changeSet,
    rows: [
      ["类型", traceTypeLabel(node.type)],
      ["状态", node.status || "n/a"],
      ["时间", [formatDate(node.timestamp), formatDate(node.completedAt)].filter(Boolean).join(" - ") || "n/a"],
      ["耗时", node.durationMs == null ? "n/a" : `${formatDuration(node.durationMs)}${node.durationEstimated ? " 估算" : ""}`],
      ["工具", item?.name || "n/a"],
      ["线程", thread.agentNickname || thread.title || node.threadId || thread.id || "n/a"],
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
    kindLabel: itemTitle(item),
    title: readable.title || itemTitle(item),
    riskLevel: itemRiskLevel(item, linkedAuditNodes),
    badges: [item.turnIndex == null ? "未定位 Turn" : `Turn ${item.turnIndex + 1}`, item.name, item.sourceIndex != null ? `event #${item.sourceIndex}` : ""].filter(Boolean),
    summary: body || "该关联项没有正文摘要。",
    changeSet: readable.changeSet,
    rows: [
      ["类型", itemTitle(item)],
      ["Turn", item.turnIndex == null ? "n/a" : String(item.turnIndex + 1)],
      ["时间", formatDate(item.timestamp) || "n/a"],
      ["状态", [item.phase, item.status].filter(Boolean).join(" / ") || "n/a"],
      ["工具", item.name || "n/a"],
      ["Call ID", item.callId || "n/a"],
      ["事件索引", item.sourceIndex != null ? `event #${item.sourceIndex}` : "n/a"],
    ],
    metrics: { events: item.sourceIndex != null || item.outputSourceIndex != null ? 1 : 0, evidence: linkedAuditNodes.length || (body ? 1 : 0), relations: linkedAuditNodes.length },
    evidence: [reviewEvidenceFromItem(item, "关联项"), ...linkedAuditNodes.slice(0, 8).map(reviewEvidenceFromAuditNode)],
    relations: [...linkedAuditNodes.slice(0, 10).map((node) => reviewRelationFromAuditNode(node, "Audit")), event ? reviewRelationFromEvent(event, "Raw event") : null].filter(Boolean),
    sources: buildSourceRefs({ eventIndex: item.sourceIndex ?? item.outputSourceIndex, item }),
    actions: itemSelectionActions(item),
    debugData: itemDebugPreview(item),
  });
}

function buildRawEventReviewContext(event) {
  const linkedItems = itemsForEventIndex(event.index);
  const linkedAuditNodes = auditNodesForEventIndex(event.index);
  const readable = readableRawEvent(event);
  return reviewContextBase({
    kind: "raw_event",
    kindLabel: "Raw event",
    title: `#${event.index} ${readable.title || humanEventTitle(event)}`,
    riskLevel: rawEventRiskLevel(event, linkedAuditNodes),
    badges: [event.kind || event.type || "event", formatDate(event.timestamp) || "", event.payloadSize ? formatBytes(event.payloadSize) : ""].filter(Boolean),
    summary: readable.summary || event.preview || "Raw 事件没有预览正文。",
    changeSet: readable.changeSet,
    rows: [
      ["事件", `event #${event.index}`],
      ["分类", event.kind || "n/a"],
      ["类型", [event.type, event.payloadType, event.role].filter(Boolean).join(" / ") || "n/a"],
      ["时间", formatDate(event.timestamp) || "n/a"],
      ["Payload", event.payloadSize ? formatBytes(event.payloadSize) : "n/a"],
    ],
    metrics: { events: 1, evidence: linkedAuditNodes.length, relations: linkedItems.length + linkedAuditNodes.length },
    evidence: [reviewEvidenceFromEvent(event, "事件预览"), ...linkedAuditNodes.slice(0, 8).map(reviewEvidenceFromAuditNode)],
    relations: [...linkedItems.slice(0, 10).map((item) => reviewRelationFromItem(item, "关联项")), ...linkedAuditNodes.slice(0, 10).map((node) => reviewRelationFromAuditNode(node, "Audit"))],
    sources: [{ label: "完整 Raw event", value: `event #${event.index}`, eventIndex: event.index, data: event, lazy: true }],
    actions: rawEventSelectionActions(event),
    debugData: event,
  });
}

function renderReviewHeader(context) {
  if (!state.detail) {
    els.sessionDetails.innerHTML = `
      <div class="review-object-head empty">
        <span class="review-kind">未选择</span>
        <strong>选择一个会话</strong>
        <p>复核台会显示当前对象的摘要、证据、关系和来源。</p>
      </div>
    `;
    return;
  }
  els.sessionDetails.innerHTML = `
    <div class="review-object-head risk-${escapeAttr(context.riskLevel || "none")}">
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

function renderReviewTabs() {
  const allowed = new Set(["summary", "evidence", "relations", "source"]);
  if (!allowed.has(state.reviewTab)) state.reviewTab = "summary";
  els.reviewTabs?.querySelectorAll("[data-review-tab]").forEach((button) => {
    const active = button.dataset.reviewTab === state.reviewTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
}

function renderReviewBody(context) {
  if (!state.detail) return renderReviewEmpty("未选择会话", "左侧选择会话后，复核台会显示 Session Brief。");
  if (state.reviewTab === "evidence") return renderReviewEvidence(context);
  if (state.reviewTab === "relations") return renderReviewRelations(context);
  if (state.reviewTab === "source") return renderReviewSource(context);
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
        <span class="muted">按需 Raw</span>
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
    .map((action, index) => `<button class="ghost-button small" type="button" data-review-action="${index}">${escapeHtml(action.label)}</button>`)
    .join("");
}

function normalizeReviewActions(context) {
  if (!state.detail) return [];
  const actions = [...(context.actions || [])];
  if (!actions.some((action) => action.action === "copy-reference")) actions.unshift({ label: "复制引用", action: "copy-reference" });
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
        <span>${escapeHtml(source.value || "n/a")}</span>
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
    button.addEventListener("click", () => runReviewAction(relations[Number(button.dataset.reviewRelation)]));
  });
  els.selectionDetails.querySelectorAll("[data-review-evidence-action]").forEach((button) => {
    button.addEventListener("click", () => runReviewAction(evidence[Number(button.dataset.reviewEvidenceAction)]));
  });
  els.selectionDetails.querySelectorAll("[data-review-source]").forEach((button) => {
    button.addEventListener("click", async () => {
      const source = sources[Number(button.dataset.reviewSource)];
      if (source) await loadReviewSource(source);
    });
  });
}

function bindReviewActions(context) {
  const actions = normalizeReviewActions(context);
  els.inspectorActions.querySelectorAll("[data-review-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = actions[Number(button.dataset.reviewAction)];
      await runReviewAction(action, context);
    });
  });
}

async function runReviewAction(action, context = buildReviewContext()) {
  if (!action) return;
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
    state.reviewTab = action.tab || "summary";
    renderInspector();
    return;
  }
  if (action.copy != null) return copyInspectorText(action.copy, action.toast || "已复制");
}

async function loadReviewSource(source) {
  const preview = els.selectionDetails.querySelector("[data-review-source-preview]");
  if (!preview) return;
  if (source.eventIndex == null) {
    preview.textContent = JSON.stringify(source.data ?? source.value ?? null, null, 2);
    return;
  }
  preview.textContent = JSON.stringify(source.data || {}, null, 2) + "\n\n正在按需读取完整 payload...";
  try {
    const raw = await loadRawEvent(source.eventIndex);
    preview.textContent = JSON.stringify(raw, null, 2);
  } catch (error) {
    preview.textContent = JSON.stringify(source.data || {}, null, 2) + `\n\n读取完整事件失败：${error.message}`;
  }
}

function reviewEvidenceFromAuditNode(node) {
  const readable = readableAuditNode(node);
  const item = node.itemRef ? findItemByRef(node.itemRef) : null;
  const body = auditNodeFullBody(node, readable, item) || [node.summary, node.outputPreview, node.argumentsPreview].filter(Boolean).join("\n\n");
  return {
    kind: auditTypeLabel(node.type),
    title: readable.title || node.title || auditTypeLabel(node.type),
    meta: [node.turnNumber ? `Turn ${node.turnNumber}` : "", node.toolName, auditEventIndexLabel(node), auditRiskMetaLabel(node.riskLevel)].filter(Boolean).join(" · "),
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
    meta: [item.turnIndex == null ? "" : `Turn ${item.turnIndex + 1}`, item.name, item.sourceIndex != null ? `event #${item.sourceIndex}` : ""].filter(Boolean).join(" · "),
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

function reviewEvidenceFromEvent(event, kind = "Raw event") {
  const readable = readableRawEvent(event);
  return {
    kind,
    title: `#${event.index} ${readable.title || humanEventTitle(event)}`,
    meta: [event.kind || event.type, formatDate(event.timestamp)].filter(Boolean).join(" · "),
    body: readable.summary || event.preview || "",
    changeSet: readable.changeSet,
    riskLevel: rawEventRiskLevel(event, auditNodesForEventIndex(event.index)),
    action: "open-raw-event",
    index: event.index,
    actionLabel: "打开 Raw",
  };
}

function reviewRelationFromAuditNode(node, kind = "Audit") {
  const readable = readableAuditNode(node);
  return {
    kind,
    title: readable.title || node.title || auditTypeLabel(node.type),
    meta: [readable.summary, auditTypeLabel(node.type), auditRiskMetaLabel(node.riskLevel), node.turnNumber ? `Turn ${node.turnNumber}` : ""].filter(Boolean).join(" · "),
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
    meta: [readable.summary, item.turnIndex == null ? "" : `Turn ${item.turnIndex + 1}`, item.name].filter(Boolean).join(" · "),
    action: "open-item-ref",
    ref: itemRef(item),
  };
}

function reviewRelationFromEvent(event, kind = "Raw") {
  const readable = readableRawEvent(event);
  return {
    kind,
    title: `#${event.index} ${readable.title || humanEventTitle(event)}`,
    meta: [readable.summary, event.kind || event.type, formatDate(event.timestamp)].filter(Boolean).join(" · "),
    action: "open-raw-event",
    index: event.index,
  };
}

function buildSourceRefs({ eventIndex, item, node, traceNode } = {}) {
  const sources = [];
  if (eventIndex != null) {
    const event = eventByIndex(eventIndex);
    sources.push({ label: "Raw event", value: `event #${eventIndex}`, eventIndex, data: event, lazy: true });
  }
  if (item) sources.push({ label: "Item model", value: itemRef(item), data: itemDebugPreview(item) });
  if (node) sources.push({ label: "Audit node", value: node.id, data: auditNodeDebugPreview(node) });
  if (traceNode) sources.push({ label: "Trace node", value: traceNode.id, data: traceNodePreview(traceNode) });
  return sources;
}

function rawEventSelectionActions(event) {
  return [
    { label: "读取完整 Raw", action: "switch-review-tab", tab: "source" },
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
  return state.detail?.events?.find((event) => event.index === index) || null;
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
    showToast("未找到 Audit 节点");
    return;
  }
  if (state.viewMode !== "audit") state.viewMode = "audit";
  renderMainContent();
  selectAuditNode(target.id);
}

function reviewReference(context = buildReviewContext()) {
  const session = state.detail?.session || {};
  const parts = [context.kindLabel || context.kind || "对象", context.title || "未命名对象"];
  if (context.badges?.length) parts.push(context.badges.join(" · "));
  if (session.id) parts.push(`session: ${session.id}`);
  return parts.filter(Boolean).join("\n");
}

async function copyReviewReference(context = buildReviewContext()) {
  if (!state.detail) return;
  await copyText(reviewReference(context));
  showToast("已复制引用");
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
  await copyText(JSON.stringify(pack, null, 2));
  showToast("已复制证据包");
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
    showToast("已复制执行节点");
    return;
  }
  if (state.selectedAuditNodeId) {
    const node = findAuditNode(state.selectedAuditNodeId);
    if (!node) return;
    await copyText(JSON.stringify(auditNodeDebugPreview(node), null, 2));
    showToast("已复制 Audit 节点");
    return;
  }
  if (state.selectedAuditTurnKey) {
    const turn = findAuditTurn(state.selectedAuditTurnKey);
    if (!turn) return;
    await copyText(JSON.stringify(auditTurnDebugPreview(turn), null, 2));
    showToast("已复制 Turn 审计摘要");
    return;
  }
  if (state.selectedItemRef) {
    const item = findItemByRef(state.selectedItemRef);
    if (!item) return;
    await copyText(JSON.stringify(itemDebugPreview(item), null, 2));
    showToast("已复制关联项 JSON");
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
  if (!event || !window.ToolSummary) {
    return { matched: false, title: humanEventTitle(event), summary: event?.preview || "", body: event?.preview || "", command: "" };
  }
  return window.ToolSummary.summarizeRawEvent(event, summaryRuleOptions());
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
  const readable = window.ToolSummary ? window.ToolSummary.summarizeRawEvent(event, summaryRuleOptions()) : null;
  if (readable?.matched && readable.title) return readable.title;
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

async function copyInspectorText(text, message) {
  if (!text) {
    showToast("没有可复制内容");
    return;
  }
  await copyText(String(text));
  showToast(message);
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
  await copyText(code);
  const originalText = button.textContent;
  button.textContent = "已复制";
  button.disabled = true;
  showToast("已复制代码");
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

function remoteIndexUrl() {
  const params = new URLSearchParams({
    bucket: state.sessionTimeFilter,
    limit: "220",
  });
  const query = els.sessionSearch.value.trim();
  if (query) params.set("q", query);
  return `/api/sources/${encodeURIComponent(state.selectedSourceId)}/index?${params.toString()}`;
}

function sourceSessionUrl(id) {
  const params = new URLSearchParams();
  const evidenceRiskRules = window.EvidenceRiskRules?.serializeForQuery?.(state.evidenceRiskRules);
  if (evidenceRiskRules) params.set("evidenceRiskRules", evidenceRiskRules);
  const query = params.toString();
  return `/api/sources/${encodeURIComponent(state.selectedSourceId)}/sessions/${encodeURIComponent(id)}${query ? `?${query}` : ""}`;
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
