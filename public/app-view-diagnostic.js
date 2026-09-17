{
  const api = window.SessionWorkbench;
  const { state, els } = api;
  const emptyState = (...args) => api.emptyState(...args);
  const loadRawDiagnosticPage = (...args) => api.loadRawDiagnosticPage(...args);
  const createRawDiagnosticState = (...args) => api.createRawDiagnosticState(...args);
  const escapeHtml = (...args) => api.escapeHtml(...args);
  const selectedSessionDisplayTitle = (...args) => api.selectedSessionDisplayTitle(...args);
  const selectedSource = (...args) => api.selectedSource(...args);
  const rawDiagnosticPageNumber = (...args) => api.rawDiagnosticPageNumber(...args);
  const compactNumber = (...args) => api.compactNumber(...args);
  const formatBytes = (...args) => api.formatBytes(...args);
  const humanEventTitle = (...args) => api.humanEventTitle(...args);
  const rawDiagnosticRequestIsCurrent = (...args) => api.rawDiagnosticRequestIsCurrent(...args);
  const resetRawDiagnosticPages = (...args) => api.resetRawDiagnosticPages(...args);
  const escapeAttr = (...args) => api.escapeAttr(...args);
  const rawEventEvidenceId = (...args) => api.rawEventEvidenceId(...args);
  const formatDate = (...args) => api.formatDate(...args);
  const renderMarkdownMessage = (...args) => api.renderMarkdownMessage(...args);
  const renderCompactReplacementHistory = (...args) => api.renderCompactReplacementHistory(...args);
  const mobilePanelLayoutActive = (...args) => api.mobilePanelLayoutActive(...args);
  const setMobilePanel = (...args) => api.setMobilePanel(...args);
  const syncViewControls = (...args) => api.syncViewControls(...args);
  const renderStats = (...args) => api.renderStats(...args);
  const preferredScrollBehavior = (...args) => api.preferredScrollBehavior(...args);
  const selectRawEvent = (...args) => api.selectRawEvent(...args);
  const loadRawEvent = (...args) => api.loadRawEvent(...args);
  const isAbortError = (...args) => api.isAbortError(...args);
  const showToast = (...args) => api.showToast(...args);
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

  Object.assign(api, { renderRawView, renderRawDiagnostic, rawDiagnosticRenderModel, rawDiagnosticHeader, rawDiagnosticStateNote, rawDiagnosticAwaitingFirstPage, rawDiagnosticEmptyMarkup, rawDiagnosticResultsMarkup, bindRawDiagnosticActions, failRawDiagnosticPage, rawEventMatches, selectedRawViewEvent, renderRawViewEventRow, isCompactEvent, renderRawEventInsight, openRawEvent, selectRawViewEvent });
}
