{
  const api = window.SessionWorkbench;
  const { state, els } = api;
  const emptyState = (...args) => api.emptyState(...args);
  const rawEventMatches = (...args) => api.rawEventMatches(...args);
  const buildEventTypeStats = (...args) => api.buildEventTypeStats(...args);
  const escapeHtml = (...args) => api.escapeHtml(...args);
  const renderStatsMetric = (...args) => api.renderStatsMetric(...args);
  const compactNumber = (...args) => api.compactNumber(...args);
  const formatBytes = (...args) => api.formatBytes(...args);
  const renderStatsEventRows = (...args) => api.renderStatsEventRows(...args);
  const renderTimingView = (...args) => api.renderTimingView(...args);
  const bindTimingActions = (...args) => api.bindTimingActions(...args);
  const buildToolContextStats = (...args) => api.buildToolContextStats(...args);
  const buildContextCapacityStats = (...args) => api.buildContextCapacityStats(...args);
  const formatContextRatio = (...args) => api.formatContextRatio(...args);
  const ratioPercent = (...args) => api.ratioPercent(...args);
  const escapeAttr = (...args) => api.escapeAttr(...args);
  const openRawEvent = (...args) => api.openRawEvent(...args);
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
  const eventTypeStats = buildEventTypeStats({ ...detail, events: filteredEvents });
  const totalEventTypeStats = buildEventTypeStats(detail);
  const filtered = filteredEvents.length !== allEvents.length;
  const approxTokens = eventTypeStats.reduce((sum, stat) => sum + stat.approxTokens, 0);
  const approxBytes = eventTypeStats.reduce((sum, stat) => sum + stat.approxBytes, 0);
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
      <section class="stats-diagnostic-section context-diagnostic-section" aria-labelledby="contextDiagnosticHeading">
        <div class="stats-diagnostic-section-head">
          <div><p class="eyebrow">上下文</p><h3 id="contextDiagnosticHeading">上下文统计诊断</h3></div>
          <span>当前筛选范围</span>
        </div>
        <div class="stats-subsection-head"><h4>上下文容量</h4><span>完整会话口径</span></div>
        <div class="stats-view-metrics" aria-label="上下文容量概览">
          ${renderContextCapacityMetrics(buildContextCapacityStats(detail))}
        </div>
        ${renderToolContextStats(detail, query, typeFilter)}
        <div class="stats-subsection-head"><h4>事件概览</h4><span>${escapeHtml(filtered ? "已应用搜索或类型过滤" : "完整事件流")}</span></div>
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
              ${eventTypeStats.map((stat) => renderStatsEventRows(stat, filteredEvents.length, query)).join("")}
            </div>`
          : emptyState("没有匹配的事件统计", "调整内容搜索或类型过滤。")
      }
      </section>
      <section class="stats-diagnostic-section timing-diagnostic-section" aria-labelledby="timeDiagnosticHeading">
        <div class="stats-diagnostic-section-head">
          <div><p class="eyebrow">时间</p><h3 id="timeDiagnosticHeading">时间统计诊断</h3></div>
          <span>完整会话口径</span>
        </div>
        ${renderTimingView(detail.timing)}
      </section>
    </div>
  `;
  bindTimingActions();
  bindToolContextControls();
}

function renderContextCapacityMetrics(capacity) {
  const hasWindow = capacity.contextWindow > 0;
  const windowHint = capacity.windowSource === "catalog" ? "按 Pi 模型目录匹配" : "最近记录的窗口配置";
  const usedShare = ratioPercent(capacity.maxUsedTokens, capacity.contextWindow);
  const outputLimit = capacity.maxOutputLimit || capacity.contextWindow;
  const outputShare = ratioPercent(capacity.maxOutputTokens, outputLimit);
  const outputHint = capacity.maxOutputLimit && capacity.maxOutputTokens ? `单次最大 ${compactNumber(capacity.maxOutputTokens)} tok 生成 · 占模型最大输出上限` : `单次最大 ${compactNumber(capacity.maxOutputTokens)} tok 生成`;
  return [
    hasWindow
      ? renderStatsMetric("模型上下文窗口", `${compactNumber(capacity.contextWindow)} tok`, windowHint)
      : "",
    capacity.maxUsedTokens
      ? renderStatsMetric(
          "最大上下文占用",
          hasWindow ? formatContextRatio(usedShare) : `约 ${compactNumber(capacity.maxUsedTokens)} tok`,
          hasWindow ? `峰值约 ${compactNumber(capacity.maxUsedTokens)} tok · 单次请求总 token` : "单次请求峰值总 token",
        )
      : "",
    capacity.maxOutputTokens
      ? renderStatsMetric(
          "最大输出上下文",
          hasWindow ? formatContextRatio(outputShare) : `约 ${compactNumber(capacity.maxOutputTokens)} tok`,
          hasWindow ? outputHint : "单次响应最大生成 token",
        )
      : "",
    renderStatsMetric("触发压缩", `${compactNumber(capacity.compactCount)} 次`, capacity.compactCount ? "会话中的上下文压缩事件" : "未发生上下文压缩"),
  ]
    .filter(Boolean)
    .join("");
}

function renderToolContextStats(detail, query, typeFilter) {
  const stats = buildToolContextStats(detail, query, typeFilter, state.toolContextQuery, state.toolContextSort);
  const hasContextWindow = stats.contextWindow > 0;
  const totalShare = formatContextRatio(ratioPercent(stats.contextTokens, stats.contextWindow));
  return `
    <div class="tool-context-stats${hasContextWindow ? " has-context-window" : ""}" aria-labelledby="toolContextStatsHeading">
      <div class="tool-context-stats-head">
        <div>
          <h4 id="toolContextStatsHeading">已识别工具上下文</h4>
          <p>只汇总命中摘要规则且关联了工具输出的记录。</p>
        </div>
        ${stats.groups.length ? `<button class="ghost-button tool-context-list-toggle" type="button" data-tool-context-list-toggle aria-expanded="${state.toolContextListExpanded}">${state.toolContextListExpanded ? "收起工具明细" : `查看工具明细（${stats.groups.length} 个目标）`}</button>` : ""}
      </div>
      <div class="tool-context-kpis" aria-label="工具上下文占用概览">
        <span><strong>${escapeHtml(String(stats.groups.length))}</strong>已识别工具目标</span>
        ${hasContextWindow ? `<span><strong>${escapeHtml(`${compactNumber(stats.contextWindow)} tok`)}</strong>最近上下文窗口</span>` : ""}
        <span><strong>${escapeHtml(formatBytes(stats.outputBytes))}</strong>返回结果</span>
        <span><strong>约 ${escapeHtml(compactNumber(stats.contextTokens))} tok</strong>累计参数与返回</span>
        ${hasContextWindow ? `<span><strong>${escapeHtml(totalShare)}</strong>相对最近窗口</span>` : ""}
      </div>
      ${
        !stats.groups.length
          ? `<div class="tool-context-empty">当前筛选范围没有可按规则归类的工具调用。</div>`
          : state.toolContextListExpanded
            ? renderToolContextList(stats, hasContextWindow)
            : `<div class="tool-context-drill-hint">展开明细后可按操作、目标或返回内容筛选和排序。</div>`
      }
    </div>
  `;
}

function renderToolContextList(stats, hasContextWindow) {
  const initialLimit = 6;
  const groups = state.toolContextShowAll ? stats.groups : stats.groups.slice(0, initialLimit);
  const hiddenCount = stats.groups.length - groups.length;
  return `
    <div class="tool-context-controls" aria-label="工具上下文统计筛选和排序">
      <input class="text-input compact" id="toolContextQuery" type="search" autocomplete="off" value="${escapeAttr(state.toolContextQuery)}" placeholder="搜索操作、目标或返回内容" />
      <select class="select-input compact" id="toolContextSort" aria-label="工具返回结果排序">
        <option value="output-bytes" ${state.toolContextSort === "output-bytes" ? "selected" : ""}>返回内容大小</option>
        ${hasContextWindow ? `<option value="context-share" ${state.toolContextSort === "context-share" ? "selected" : ""}>相对最近窗口</option>` : ""}
        <option value="max-output" ${state.toolContextSort === "max-output" ? "selected" : ""}>单次最大返回</option>
        <option value="target" ${state.toolContextSort === "target" ? "selected" : ""}>操作与目标</option>
      </select>
    </div>
    <div class="tool-context-table" role="table" aria-label="工具上下文占用明细">
      <div class="tool-context-row header" role="row">
        <span role="columnheader">操作与目标</span>
        <span role="columnheader">调用参数</span>
        <span role="columnheader">返回结果</span>
        ${hasContextWindow ? `<span role="columnheader">相对最近窗口</span><span role="columnheader">最大返回</span>` : ""}
      </div>
      ${groups.map((group) => renderToolContextStatRow(group, hasContextWindow)).join("")}
    </div>
    ${hiddenCount > 0 ? `<button class="ghost-button tool-context-show-all" type="button" data-tool-context-show-all>展开其余 ${hiddenCount} 个目标</button>` : stats.groups.length > initialLimit ? `<button class="ghost-button tool-context-show-all" type="button" data-tool-context-show-all>仅显示前 ${initialLimit} 个目标</button>` : ""}
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
      ${renderToolContextNumber("调用参数", formatBytes(group.argumentBytes))}
      ${renderToolContextNumber("返回结果", formatBytes(group.outputBytes))}
      ${hasContextWindow ? `${renderToolContextNumber("相对最近窗口", `约 ${compactNumber(group.contextTokens)} tok · ${formatContextRatio(group.contextWindowShare)}`)}${renderToolContextNumber("最大返回", `${formatBytes(group.maxOutputBytes)} · ${formatContextRatio(group.maxOutputWindowShare)}`)}` : ""}
    </div>
  `;
}

function renderToolContextNumber(label, value) {
  return `<span class="tool-context-number" role="cell" data-tool-context-label="${escapeAttr(label)}" aria-label="${escapeAttr(`${label}：${value}`)}">${escapeHtml(value)}</span>`;
}

function bindToolContextControls() {
  const listToggle = els.statsContent.querySelector("[data-tool-context-list-toggle]");
  const showAll = els.statsContent.querySelector("[data-tool-context-show-all]");
  const queryInput = els.statsContent.querySelector("#toolContextQuery");
  const sortInput = els.statsContent.querySelector("#toolContextSort");
  listToggle?.addEventListener("click", () => {
    state.toolContextListExpanded = !state.toolContextListExpanded;
    if (!state.toolContextListExpanded) state.toolContextShowAll = false;
    renderStatsInfoView();
  });
  showAll?.addEventListener("click", () => {
    state.toolContextShowAll = !state.toolContextShowAll;
    renderStatsInfoView();
  });
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

  Object.assign(api, { renderStatsInfoView, renderContextCapacityMetrics, renderToolContextStats, renderToolContextList, renderToolContextStatRow, renderToolContextNumber, bindToolContextControls });
}
