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
  addToolOutputOperationStats(groups, detail);
  return [...groups.values()].sort(
    (left, right) => right.count - left.count || right.approxTokens - left.approxTokens || left.kind.localeCompare(right.kind),
  );
}

function addToolOutputOperationStats(groups, detail) {
  const eventsByIndex = new Map((detail?.events || []).map((event) => [event.index, event]));
  for (const item of (detail?.turns || []).flatMap((turn) => turn.items || [])) {
    addToolOutputOperationStat(groups, eventsByIndex, item);

  }
  for (const group of groups.values()) {
    if (!group.operations) continue;
    group.operations = [...group.operations.values()].sort(
      (left, right) => right.count - left.count || right.approxTokens - left.approxTokens || left.title.localeCompare(right.title, "zh-Hans-CN"),
    );
  }
}

function addToolOutputOperationStat(groups, eventsByIndex, item) {
  if (item.type !== "tool-call") return;
  const outputEvent = toolOutputEventForItem(item, eventsByIndex);
  if (!outputEvent) return;
  const parent = groups.get(eventTypeKey(outputEvent));
  if (!parent || eventTypeLabel(parent.kind) !== "工具输出") return;
  const readable = readableToolItem(item);
  if (!readable.matched || !readable.ruleId) return;
  const operations = parent.operations || new Map();
  const current = operations.get(readable.ruleId) || createToolOutputOperation(readable);
  current.count += 1;
  current.approxTokens += estimateEventTokens(outputEvent);
  current.approxBytes += estimateEventBytes(outputEvent);
  operations.set(readable.ruleId, current);
  parent.operations = operations;
}

function toolOutputEventForItem(item, eventsByIndex) {
  const index = item.outputSourceIndex ?? (item.output != null ? item.sourceIndex : null);
  return eventsByIndex.get(index) || null;
}

function createToolOutputOperation(readable) {
  return {
    ruleId: readable.ruleId,
    ruleLabel: readable.ruleLabel,
    title: readable.title,
    count: 0,
    approxTokens: 0,
    approxBytes: 0,
  };
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

function renderTimingView(timing) {
  if (!timing?.session) return `<div class="timing-empty"><strong>暂无会话时间数据</strong><span>当前会话尚未生成可用的时间区间。</span></div>`;
  const session = timing.session;
  const composition = session.executionComposition || [];
  const quality = timing.quality || {};
  const metrics = renderTimingMetrics(session);
  return `
    <div class="timing-section" aria-labelledby="timingDetailHeading">
      <div class="timing-heading"><div><h4 id="timingDetailHeading">会话时间分布</h4><p>等待输入、工具执行与模型响应的时间构成。</p></div><span class="timing-confidence">${escapeHtml(timingKindLabel(session.durationKind))}</span></div>
      ${metrics.length ? `<div class="timing-metrics" aria-label="会话时间概览">${metrics.join("")}</div>` : ""}
      <p class="timing-note">等待输入仅统计助手最后回复到下一次用户消息的间隔。实际运行时长只统计工具与 LLM 的可关联区间；两者并行时按时间并集计一次。</p>
      <div class="timing-composition" aria-label="实际运行时长构成">
        ${composition.length ? renderTimingComposition(composition) : `<div class="timing-empty"><strong>暂无可关联执行时长</strong><span>会话事件中尚未发现具有完整起止时间的工具或 LLM 记录。</span></div>`}
      </div>
      ${renderTimingTurns(timing.turns)}
      <div class="timing-quality"><strong>时间数据质量</strong><span>估算 ${quality.estimatedCount || 0} 项 · 缺少开始 ${quality.missingStartCount || 0} 项 · 缺少结束 ${quality.missingEndCount || 0} 项 · 未关联 ${quality.unlinkedCount || 0} 项</span></div>
    </div>
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

function renderStatsEventRows(stat, totalEvents, query) {
  const rows = [renderStatsEventRow(stat, totalEvents, query)];
  for (const operation of stat.operations || []) rows.push(renderStatsOperationRow(operation, totalEvents, query));
  return rows.join("");
}

function renderStatsEventRow(stat, totalEvents, query) {
  const percent = totalEvents ? Math.round((stat.count / totalEvents) * 1000) / 10 : 0;
  const average = stat.count ? Math.round(stat.approxTokens / stat.count) : 0;
  const bar = percent;
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

function renderStatsOperationRow(operation, totalEvents, query) {
  const percent = totalEvents ? Math.round((operation.count / totalEvents) * 1000) / 10 : 0;
  const average = operation.count ? Math.round(operation.approxTokens / operation.count) : 0;
  const bar = percent;
  return `
    <div class="stats-event-row stats-event-operation-row" role="row" style="--bar:${escapeAttr(String(bar))}" title="${escapeAttr(`${operation.ruleLabel} · ${operation.count} 个工具输出 · 约 ${compactNumber(operation.approxTokens)} tok`)}">
      <span class="stats-event-type" role="cell">
        <strong data-overflow-tooltip>${highlight(escapeHtml(operation.title), query)}</strong>
        <em data-overflow-tooltip>${escapeHtml(operation.ruleLabel)}</em>
      </span>
      <span role="cell" data-overflow-tooltip><strong>${escapeHtml(String(operation.count))}</strong></span>
      <span role="cell" data-overflow-tooltip>${escapeHtml(`约 ${compactNumber(operation.approxTokens)}`)}</span>
      <span role="cell" data-overflow-tooltip>${escapeHtml(`约 ${compactNumber(average)}`)}</span>
      <span class="stats-event-share" role="cell">
        <i aria-hidden="true"></i>
        <em>${escapeHtml(`${percent}%`)}</em>
      </span>
      <span role="cell" data-overflow-tooltip>${escapeHtml(formatBytes(operation.approxBytes))}</span>
    </div>
  `;
}
