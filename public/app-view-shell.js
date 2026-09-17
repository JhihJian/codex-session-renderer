{
  const api = window.SessionWorkbench;
  const { state, els, visibleViewModes, rawItemTypeOptions, standardItemTypeOptions } = api;
  const renderSessionList = (...args) => api.renderSessionList(...args);
  const renderThreadHeader = (...args) => api.renderThreadHeader(...args);
  const renderStats = (...args) => api.renderStats(...args);
  const renderMainContent = (...args) => api.renderMainContent(...args);
  const renderToolDetails = (...args) => api.renderToolDetails(...args);
  const findTraceNode = (...args) => api.findTraceNode(...args);
  let overflowTooltipFrame = api.overflowTooltipFrame;
  const cancelRawDiagnosticRequest = (...args) => api.cancelRawDiagnosticRequest(...args);
  const cancelRawEventRequest = (...args) => api.cancelRawEventRequest(...args);
  const mobilePanelLayoutActive = (...args) => api.mobilePanelLayoutActive(...args);
  const setMobilePanel = (...args) => api.setMobilePanel(...args);
  const escapeAttr = (...args) => api.escapeAttr(...args);
  const escapeHtml = (...args) => api.escapeHtml(...args);
  const syncAsyncAccessibility = (...args) => api.syncAsyncAccessibility(...args);
  const selectedSource = (...args) => api.selectedSource(...args);
  const currentSessionFilteredOut = (...args) => api.currentSessionFilteredOut(...args);
  const renderSessionFilterNotice = (...args) => api.renderSessionFilterNotice(...args);
  const selectedSessionDisplayTitle = (...args) => api.selectedSessionDisplayTitle(...args);
  const formatDate = (...args) => api.formatDate(...args);
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

  Object.assign(api, { renderAll, initializeOverflowTooltips, scheduleOverflowTooltipSync, overflowTooltipCandidate, syncOverflowTooltip, setViewMode, normalizeViewMode, setDiagnosticMode, syncViewControls, syncItemTypeFilterOptions, primeTraceExpansion, renderStatusbar, syncStatusbarDataStatus });
}
