{
  const api = window.SessionWorkbench;
  const { state, els, clientErrorMessages, statusErrorMessages, localServiceUnavailableMessage } = api;
  const sourceResponseMatches = (...args) => api.sourceResponseMatches(...args);
  const renderRawView = (...args) => api.renderRawView(...args);
  const failRawDiagnosticPage = (...args) => api.failRawDiagnosticPage(...args);
  let rawDiagnosticAbortController = api.rawDiagnosticAbortController;
  const createRawDiagnosticState = (...args) => api.createRawDiagnosticState(...args);
  const cancelRawDiagnosticRequest = (...args) => api.cancelRawDiagnosticRequest(...args);
  const cancelRawEventRequest = (...args) => api.cancelRawEventRequest(...args);
  const clearRawEventCache = (...args) => api.clearRawEventCache(...args);
  let rawEventAbortController = api.rawEventAbortController;
  const errorTextFromError = (...args) => api.errorTextFromError(...args);
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

  Object.assign(api, { responseScopeMatches, requireSourceResponse, loadRawDiagnosticPage, startRawDiagnosticPageRequest, rawDiagnosticDetailAvailable, rawDiagnosticRequestCursor, rawDiagnosticCachedNextPage, showCachedNextRawDiagnosticPage, rawDiagnosticPageNumber, resetRawDiagnosticPages, rawDiagnosticRequestIsCurrent, rawDiagnosticStillSelected, applyRawDiagnosticPage, retainRawEventsForDiagnosticPages, rawDiagnosticPageMatchesRequest, rawDiagnosticNextPageNumber, loadRawEvent, rawEventRequestIsCurrent, rawEventCacheKey, rawEventStillInDiagnosticPages, selectedSource, sourceLabel, upsertSource, sourceSessionsUrl, sessionListServerType, sourceSessionUrl, sourceEventUrl, sourceSessionEventsUrl, sessionKey, fetchJson, isAbortError, responseError, errorText, localizeErrorText, requestFailedMessage, healthUnavailableMessage });
}
