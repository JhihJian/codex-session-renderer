{
  const api = window.SessionWorkbench;
  const { els } = api;
  const escapeHtml = (...args) => api.escapeHtml(...args);
  const escapeAttr = (...args) => api.escapeAttr(...args);
  const formatDuration = (...args) => api.formatDuration(...args);
  const setViewMode = (...args) => api.setViewMode(...args);
  const selectTraceNode = (...args) => api.selectTraceNode(...args);
  const openRawEvent = (...args) => api.openRawEvent(...args);
  const showToast = (...args) => api.showToast(...args);
  const compactNumber = (...args) => api.compactNumber(...args);
  const highlight = (...args) => api.highlight(...args);
  const formatBytes = (...args) => api.formatBytes(...args);
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
      <p class="timing-note">LLM 原始上下文快照显示为“记录”；Pi 会话缺少快照时，使用模型定义窗口和 LLM 输入 token 显示为“模型估算”。工具在已有基线时按返回 token 累加显示“估算”，下一次 LLM 用量会重新校准。等待输入仅统计助手最后回复到下一次用户消息的间隔。实际运行时长只统计工具与 LLM 的可关联区间；两者并行时按时间并集计一次。LLM 并发只统计可关联 LLM 请求区间，不计工具或子代理。平均生成速度为估算口径：生成 token 数除以对应响应区间时长，区间含排队与首字等待。</p>
      <div class="timing-composition" aria-label="实际运行时长构成">
        ${composition.length ? renderTimingComposition(composition) : `<div class="timing-empty"><strong>暂无可关联执行时长</strong><span>会话事件中尚未发现具有完整起止时间的工具或 LLM 记录。</span></div>`}
      </div>
      ${renderTimingSteps(timing.steps)}
      ${renderTimingTurns(timing.turns)}
      <div class="timing-quality"><strong>时间数据质量</strong><span>估算 ${quality.estimatedCount || 0} 项 · 缺少开始 ${quality.missingStartCount || 0} 项 · 缺少结束 ${quality.missingEndCount || 0} 项 · 未关联 ${quality.unlinkedCount || 0} 项</span></div>
    </div>
  `;
}

function renderTimingSteps(steps = []) {
  if (!steps.length) return "";
  return `<div class="timing-steps" aria-labelledby="timingStepsHeading">
    <div class="timing-steps-caption"><h4 id="timingStepsHeading">步骤明细</h4><span>上下文变化取相邻记录快照的占用率差</span></div>
    <div class="timing-steps-table" role="table" aria-label="步骤时间、返回 token 与上下文占用">
      <div class="timing-step header" role="row"><span role="columnheader">步骤</span><span role="columnheader">耗时</span><span role="columnheader">返回 token</span><span role="columnheader">上下文占用</span><span role="columnheader">上下文变化</span></div>
      ${steps.map(renderTimingStep).join("")}
    </div>
  </div>`;
}

function renderTimingStep(step) {
  const context = step.contextUsage;
  const resultTokens = Number.isFinite(step.resultTokens)
    ? `${step.resultTokenKind === "estimated" ? "约 " : ""}${compactNumber(step.resultTokens)} tok`
    : "未记录";
  const contextValue = Number.isFinite(context?.percent)
    ? `${context.used != null && context.limit != null ? `${compactNumber(context.used)} / ${compactNumber(context.limit)} · ` : ""}${formatContextPercent(context.percent)}（${contextSourceLabel(step.contextSource)}）`
    : "未记录";
  const change = Number.isFinite(step.contextChangePercent) ? formatContextChange(step.contextChangePercent) : "未记录";
  const label = step.bucketId === "llm_wait" ? `LLM · ${step.label}` : step.label;
  return `<button class="timing-step" type="button" role="row" data-timing-node-id="${escapeAttr(step.traceNodeId || "")}" data-timing-event-index="${escapeAttr(step.eventIndex ?? "")}">
    <span class="timing-step-label" role="cell" title="${escapeAttr(label)}">${escapeHtml(label)}</span>
    <span role="cell">${escapeHtml(step.durationMs == null ? "未记录" : formatTimingDuration(step.durationMs))}</span>
    <span role="cell">${escapeHtml(resultTokens)}</span>
    <span role="cell" title="${escapeAttr(step.contextRecordedAt ? `记录于 ${step.contextRecordedAt}` : "")}">${escapeHtml(contextValue)}</span>
    <span class="timing-context-change ${step.contextChangePercent < 0 ? "decrease" : "increase"}" role="cell">${escapeHtml(change)}</span>
  </button>`;
}

function formatContextPercent(value) {
  return `${Math.round(value * 10) / 10}%`;
}

function contextSourceLabel(source) {
  if (source === "estimated") return "估算";
  if (source === "model-estimated") return "模型估算";
  return "记录";
}

function formatContextChange(value) {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded >= 0 ? "+" : ""}${rounded}%`;
}

function renderTimingMetrics(session) {
  const llm = session.llm || {};
  return [
    Number.isFinite(session.durationMs) ? renderStatsMetric("总墙钟时长", formatTimingDuration(session.durationMs), "会话开始至最后事件") : "",
    Number.isFinite(session.waitingForInputMs) ? renderStatsMetric("等待输入时长", formatTimingDuration(session.waitingForInputMs), `${session.waitingForInputCount || 0} 段可确认等待`) : "",
    Number.isFinite(session.activeRunMs) ? renderStatsMetric("实际运行时长", formatTimingDuration(session.activeRunMs), "工具与 LLM 时间并集") : "",
    Number.isFinite(session.parallelism?.peak) ? renderStatsMetric("LLM 并发峰值", `${session.parallelism.peak} 路`, formatTimingDuration(session.parallelism?.overlapMs, "LLM 请求重叠")) : "",
    Number.isFinite(llm.generatedTokensPerSecond) ? renderStatsMetric("平均生成速度", formatTokensPerSecond(llm.generatedTokensPerSecond), `${llm.responseCount || 0} 次响应 · 生成 ${compactNumber(llm.generatedTokens)} tok`) : "",
  ].filter(Boolean);
}

function formatTokensPerSecond(value) {
  if (!Number.isFinite(value)) return "";
  return `${value >= 100 ? Math.round(value) : Math.round(value * 10) / 10} tok/s`;
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

function timingTurnScaleMs(turn) {
  if (Number.isFinite(turn?.durationMs) && turn.durationMs > 0) return turn.durationMs;
  return Number.isFinite(turn?.activeRunMs) && turn.activeRunMs > 0 ? turn.activeRunMs : 0;
}

function renderTimingTurns(turns = []) {
  if (!turns.length) return "";
  const maxTurnMs = turns.reduce((max, turn) => Math.max(max, timingTurnScaleMs(turn)), 0);
  return `<div class="timing-turns"><div class="timing-turns-caption"><h4>按轮次查看</h4><span>条长相对最长轮次时长</span></div>${turns.map((turn) => {
    const llmBucket = (turn.buckets || []).find((bucket) => bucket.id === "llm_wait");
    const meta = [
      Number.isFinite(turn.durationMs) ? formatTimingDuration(turn.durationMs) : "",
      timingKindLabel(turn.confidence),
      Number.isFinite(llmBucket?.generatedTokensPerSecond) ? `约 ${formatTokensPerSecond(llmBucket.generatedTokensPerSecond)}` : "",
    ].filter(Boolean).join(" · ");
    const turnShare = maxTurnMs > 0 ? Math.max(1, Math.min(100, Math.round((timingTurnScaleMs(turn) / maxTurnMs) * 1000) / 10)) : 100;
    const userTitle = turn.userTitle ? `<em class="timing-turn-user" title="${escapeAttr(turn.userTitle)}">${escapeHtml(turn.userTitle)}</em>` : "";
    return `<div class="timing-turn"><div class="timing-turn-head"><strong>第 ${turn.turnNumber} 轮</strong>${userTitle}${meta ? `<span>${escapeHtml(meta)}</span>` : ""}</div><div class="timing-turn-bars" style="--turn:${turnShare}%">${(turn.buckets || []).map((bucket) => `<span class="timing-turn-bar timing-${escapeAttr(bucket.id)}" style="--bar:${Math.max(3, Math.min(100, bucket.sharePercent || 0))}%" title="${escapeAttr(`${bucket.label} ${formatTimingDuration(bucket.coverageMs)} · 占本轮 ${bucket.sharePercent || 0}%`.trim())}"><i></i></span>`).join("")}</div></div>`;
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

  Object.assign(api, { renderTimingView, renderTimingMetrics, renderTimingSteps, renderTimingStep, formatContextPercent, contextSourceLabel, formatContextChange, formatTokensPerSecond, renderTimingComposition, renderTimingTurns, timingTurnScaleMs, timingKindLabel, formatTimingDuration, bindTimingActions, renderStatsMetric, renderStatsEventRows, renderStatsEventRow, renderStatsOperationRow });
}
