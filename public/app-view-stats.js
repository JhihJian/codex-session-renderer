{
  const api = window.SessionWorkbench;
  const { state, els } = api;
  const escapeAttr = (...args) => api.escapeAttr(...args);
  const escapeHtml = (...args) => api.escapeHtml(...args);
  const setViewMode = (...args) => api.setViewMode(...args);
  const scrollToCompactTarget = (...args) => api.scrollToCompactTarget(...args);
  const readableToolItem = (...args) => api.readableToolItem(...args);
  const itemMatches = (...args) => api.itemMatches(...args);
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
    for (const value of [info.context_window, info.contextWindow, info.contextWindowTokens, info.model_context_window, info.context_usage?.limit]) {
      const window = Number(value);
      if (Number.isFinite(window) && window > 0) return Math.round(window);
    }
  }
  return 0;
}

function buildContextCapacityStats(detail) {
  const items = (detail?.turns || []).flatMap((turn) => turn.items || []);
  const contextWindow = latestContextWindow(detail);
  let maxUsedTokens = 0;
  let maxOutputTokens = 0;
  let compactCount = 0;
  for (const item of items) {
    const usage = contextUsageFromItem(item);
    if (usage.used > maxUsedTokens) maxUsedTokens = usage.used;
    if (usage.output > maxOutputTokens) maxOutputTokens = usage.output;
    if (item.type === "context-compact") compactCount += 1;
  }
  return { contextWindow, maxUsedTokens, maxOutputTokens, compactCount };
}

function contextUsageFromItem(item) {
  if (item.type === "token-count") return contextUsageFromTokenCount(item);
  if (item.type === "assistant-message") return contextUsageFromAssistant(item);
  return { used: 0, output: 0 };
}

function contextUsageFromTokenCount(item) {
  const usage = item.info?.last_token_usage || item.info?.lastTokenUsage || null;
  return {
    used: positiveTokenNumber(tokenCountUsageValue(usage, item, "total")),
    output: positiveTokenNumber(tokenCountUsageValue(usage, item, "output")),
  };
}

function tokenCountUsageValue(usage, item, kind) {
  const keys = kind === "total" ? ["total_tokens", "totalTokens"] : ["output_tokens", "outputTokens"];
  const fallbacks = kind === "total" ? [item.info?.context_usage?.used] : [item.tokenUsage?.generatedTokens];
  for (let index = 0; index < keys.length; index += 1) {
    const value = usage?.[keys[index]] ?? fallbacks[index];
    if (value != null) return value;
  }
  return fallbacks[fallbacks.length - 1];
}

function contextUsageFromAssistant(item) {
  const usage = item.tokenUsage;
  if (!usage) return { used: 0, output: 0 };
  const used = positiveTokenNumber(usage.totalTokens ?? (usage.inputTokens != null ? usage.inputTokens + usage.generatedTokens : null));
  return { used, output: positiveTokenNumber(usage.generatedTokens) };
}

function positiveTokenNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
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

  Object.assign(api, { renderHandoffFact, openHandoffFact, buildEventTypeStats, addToolOutputOperationStats, addToolOutputOperationStat, toolOutputEventForItem, createToolOutputOperation, buildToolContextStats, addToolContextItem, addToolContextRawEventIndex, toolContextQueryMatches, createToolContextGroup, latestContextWindow, buildContextCapacityStats, contextUsageFromItem, contextUsageFromTokenCount, tokenCountUsageValue, contextUsageFromAssistant, positiveTokenNumber, ratioPercent, formatContextRatio, toolContextComparator, eventTypeKey, eventTypeLabel, estimateEventTokens, estimateEventBytes, numericEventTokenValue, approxTokensFromValue, utf8ByteLength });
}
