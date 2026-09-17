{
  const api = window.SessionWorkbench;
  const { state, els, localServiceUnavailableMessage } = api;
  const fetchJson = (...args) => api.fetchJson(...args);
  const healthUnavailableMessage = (...args) => api.healthUnavailableMessage(...args);
  const renderAll = (...args) => api.renderAll(...args);
  const escapeAttr = (...args) => api.escapeAttr(...args);
  const escapeHtml = (...args) => api.escapeHtml(...args);
  const sourceLabel = (...args) => api.sourceLabel(...args);
  const renderStatusbar = (...args) => api.renderStatusbar(...args);
  const selectedSource = (...args) => api.selectedSource(...args);
  const renderSessionList = (...args) => api.renderSessionList(...args);
  const sourceSessionsUrl = (...args) => api.sourceSessionsUrl(...args);
  const requireSourceResponse = (...args) => api.requireSourceResponse(...args);
  const upsertSource = (...args) => api.upsertSource(...args);
  const isAbortError = (...args) => api.isAbortError(...args);
  const showToast = (...args) => api.showToast(...args);
  let alternateLocalSourceAbortController = api.alternateLocalSourceAbortController;
  const sessionTimeBucket = (...args) => api.sessionTimeBucket(...args);
  const sessionKey = (...args) => api.sessionKey(...args);
  const cancelRawDiagnosticRequest = (...args) => api.cancelRawDiagnosticRequest(...args);
  const cancelRawEventRequest = (...args) => api.cancelRawEventRequest(...args);
  let sessionAbortController = api.sessionAbortController;
  const findSessionSummary = (...args) => api.findSessionSummary(...args);
  const setMobilePanel = (...args) => api.setMobilePanel(...args);
  const clearRawEventCache = (...args) => api.clearRawEventCache(...args);
  const sourceSessionUrl = (...args) => api.sourceSessionUrl(...args);
  const primeTraceExpansion = (...args) => api.primeTraceExpansion(...args);
  const selectedSessionDisplayTitle = (...args) => api.selectedSessionDisplayTitle(...args);

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
  state.toolContextQuery = "";
  state.toolContextSort = "output-bytes";
  state.toolContextListExpanded = false;
  state.toolContextShowAll = false;
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
  Object.assign(api, { loadHealthAndSources, renderSourceControls, renderSourceStatus, selectSessionTimeFilter, loadSessions, selectFirstVisibleSession, cancelAlternateLocalSourceDiscovery, alternateLocalSourceCandidate, canDiscoverAlternateLocalSource, alternateLocalSourceDiscoveryCurrent, alternateLocalSourceResult, alternateLocalSourceDiscoveryFailed, discoverAlternateLocalSource, loadHistoricalSessions, refreshCurrentSessionList, invalidateSessionListRequests, sessionListRequestIsCurrent, setBusy, setWorkbenchStatus, syncAsyncAccessibility, setAriaBusy, selectSession, reloadSelectedSessionDetail, clearSelectedSession, selectSource, sourceNavigationContext, sourceNavigationRequestIsCurrent, sourceRequestOwnsState });
}
