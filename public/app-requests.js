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
