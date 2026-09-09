const bucketDefinitions = [
  ["llm_wait", "LLM 等待时长"],
  ["tool_execution", "工具执行时长"],
  ["subagent_execution", "子代理运行时长"],
];

// eslint-disable-next-line complexity
function intervalFromNode(node, parentTurnIndex = null) {
  const start = Date.parse(node?.timestamp || "");
  const end = Date.parse(node?.completedAt || "");
  const startMs = Number.isFinite(start) ? start : null;
  const endMs = Number.isFinite(end) ? end : null;
  const durationMs = startMs != null && endMs != null && endMs >= startMs ? endMs - startMs : null;
  const item = node?.detail?.item || {};
  const event = node?.detail?.event || node?.detail?.spawnEvent || node?.detail?.notificationEvent || {};
  const turnIndex = node?.type === "turn" ? node.index ?? parentTurnIndex : parentTurnIndex;
  if (durationMs == null) return {
    node,
    turnIndex,
    durationMs: null,
    durationKind: startMs == null && endMs == null ? "unavailable" : "partial",
    startMs,
    endMs,
    eventIndex: item.sourceIndex ?? item.outputSourceIndex ?? event.index ?? null,
  };
  return {
    node,
    turnIndex,
    durationMs,
    durationKind: node.durationEstimated ? "estimated" : "observed",
    startMs,
    endMs,
    eventIndex: item.sourceIndex ?? item.outputSourceIndex ?? event.index ?? null,
  };
}

function bucketForNode(node) {
  if (node.type === "llm-response") return "llm_wait";
  if (node.type === "tool") return "tool_execution";
  if (node.type === "subagent") return "subagent_execution";
  return null;
}

function walkTrace(node, result = [], turnIndex = null) {
  if (!node) return result;
  const currentTurnIndex = node.type === "turn" ? node.index ?? turnIndex : turnIndex;
  const bucketId = bucketForNode(node);
  if (bucketId) result.push({ ...intervalFromNode(node, currentTurnIndex), bucketId });
  for (const child of node.children || []) walkTrace(child, result, currentTurnIndex);
  return result;
}

function responseIntervals(trace) {
  return (trace?.timing?.responses || []).map((response) => ({
    node: {
      id: response.id,
      type: "llm-response",
      title: response.model || "LLM 等待",
      timestamp: response.startedAt,
      completedAt: response.completedAt,
      durationEstimated: true,
      status: "inferred",
      detail: { item: { name: response.model || "未知模型", sourceIndex: response.eventIndex, contextUsage: response.contextUsage, responseType: response.responseType, outputTokens: response.outputTokens, reasoningTokens: response.reasoningTokens, generatedTokens: response.generatedTokens } },
    },
    turnIndex: response.turnIndex,
    bucketId: "llm_wait",
    durationMs: response.durationMs,
    durationKind: "estimated",
    startMs: response.startMs,
    endMs: response.endMs,
    eventIndex: response.eventIndex,
    model: response.model,
    contextUsage: response.contextUsage,
    outputTokens: response.outputTokens,
    reasoningTokens: response.reasoningTokens,
    generatedTokens: response.generatedTokens,
  }));
}

function mergeIntervals(intervals) {
  const sorted = intervals
    .filter((item) => item.startMs != null && item.endMs != null && item.endMs >= item.startMs)
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  const merged = [];
  for (const item of sorted) {
    const last = merged.at(-1);
    if (last && item.startMs <= last.endMs) last.endMs = Math.max(last.endMs, item.endMs);
    else merged.push({ startMs: item.startMs, endMs: item.endMs });
  }
  return merged;
}

function coveredMs(intervals) {
  return mergeIntervals(intervals).reduce((sum, item) => sum + item.endMs - item.startMs, 0);
}

function overlapMs(intervals) {
  const points = intervals.flatMap((item) => [[item.startMs, 1], [item.endMs, -1]]).sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  let active = 0;
  let overlap = 0;
  let previous = null;
  let peak = 0;
  for (const [time, delta] of points) {
    if (previous != null && active > 1) overlap += time - previous;
    active += delta;
    peak = Math.max(peak, active);
    previous = time;
  }
  return { overlapMs: overlap, peak };
}

function confidenceFor(intervals) {
  if (!intervals.length) return "unavailable";
  const estimated = intervals.filter((item) => item.durationKind === "estimated").length;
  return estimated === 0 ? "observed" : estimated === intervals.length ? "estimated" : "mixed";
}

// Keep the ref projection flat so the client can render aggregate rows without loading raw events.
// eslint-disable-next-line complexity
function nodeRef(item) {
  const detail = item.node.detail?.item || {};
  return {
    traceNodeId: item.node.id,
    turnIndex: item.turnIndex,
    eventIndex: detail.sourceIndex ?? item.eventIndex,
    outputEventIndex: detail.outputSourceIndex ?? null,
    durationMs: item.durationMs,
    durationKind: item.durationKind,
    label: item.model || detail.name || item.node.title || item.node.type,
    toolName: item.model || detail.name || null,
    model: item.model || null,
    contextUsage: item.contextUsage || detail.contextUsage || null,
    outputTokens: item.outputTokens ?? detail.outputTokens ?? null,
    reasoningTokens: item.reasoningTokens ?? detail.reasoningTokens ?? null,
    generatedTokens: item.generatedTokens ?? detail.generatedTokens ?? null,
    callId: detail.callId || null,
    status: detail.status || item.node.status || null,
    arguments: detail.arguments || null,
  };
}

function buildGroups(intervals) {
  const groups = new Map();
  for (const item of intervals) {
    const ref = nodeRef(item);
    const response = item.node.type === "llm-response";
    const key = response ? item.node.id : ref.toolName || ref.label || "未命名节点";
    const label = response ? `第 ${(item.turnIndex ?? 0) + 1} 轮 · ${ref.model || "未知模型"}` : key;
    const group = groups.get(key) || { key, label, intervals: [], refs: [] };
    group.intervals.push(item);
    group.refs.push(ref);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    const complete = group.intervals.filter((item) => item.durationMs != null);
    const durations = complete.map((item) => item.durationMs).sort((a, b) => a - b);
    const generatedTokens = complete.reduce((sum, item) => sum + (Number.isFinite(item.generatedTokens) ? item.generatedTokens : 0), 0);
    const tokenDurationMs = complete.reduce((sum, item) => sum + (Number.isFinite(item.generatedTokens) ? item.durationMs : 0), 0);
    return {
      key: group.key,
      label: group.label,
      count: group.intervals.length,
      coverageMs: coveredMs(complete.map((item) => ({ startMs: item.startMs, endMs: item.endMs }))),
      nodeDurationMs: durations.reduce((sum, duration) => sum + duration, 0),
      averageDurationMs: durations.length ? Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length) : null,
      maxDurationMs: durations.at(-1) ?? null,
      generatedTokens: generatedTokens || null,
      generatedTokensPerSecond: generatedTokens && tokenDurationMs ? Math.round(((generatedTokens * 1000) / tokenDurationMs) * 100) / 100 : null,
      failedCount: group.intervals.filter((item) => /fail|error|abort/i.test(item.node.status || item.node.detail?.item?.status || "")).length,
      incompleteCount: group.intervals.filter((item) => item.durationMs == null).length,
      refs: group.refs,
    };
  }).sort((left, right) => right.maxDurationMs - left.maxDurationMs || right.coverageMs - left.coverageMs || right.count - left.count);
}

function buildBucket(id, label, intervals, totalMs) {
  const complete = intervals.filter((item) => item.durationMs != null);
  const coverage = coveredMs(complete.map((item) => ({ startMs: item.startMs, endMs: item.endMs })));
  const overlap = overlapMs(complete.map((item) => ({ startMs: item.startMs, endMs: item.endMs })));
  const generatedTokens = complete.reduce((sum, item) => sum + (Number.isFinite(item.generatedTokens) ? item.generatedTokens : 0), 0);
  const tokenDurationMs = complete.reduce((sum, item) => sum + (Number.isFinite(item.generatedTokens) ? item.durationMs : 0), 0);
  return {
    id,
    label,
    coverageMs: coverage,
    nodeDurationMs: complete.reduce((sum, item) => sum + item.durationMs, 0),
    sharePercent: totalMs ? Math.round((coverage / totalMs) * 1000) / 10 : 0,
    count: intervals.length,
    confidence: confidenceFor(complete),
    overlapMs: overlap.overlapMs,
    generatedTokens: generatedTokens || null,
    generatedTokensPerSecond: generatedTokens && tokenDurationMs ? Math.round(((generatedTokens * 1000) / tokenDurationMs) * 100) / 100 : null,
    groups: buildGroups(intervals),
    nodeRefs: intervals.map(nodeRef),
  };
}

function executionComposition(intervals, totalMs) {
  const complete = intervals.filter((item) => item.durationMs != null);
  const points = [...new Set(complete.flatMap((item) => [item.startMs, item.endMs]))].sort((left, right) => left - right);
  const components = new Map();
  for (let index = 0; index < points.length - 1; index += 1) {
    const startMs = points[index];
    const endMs = points[index + 1];
    if (endMs <= startMs) continue;
    const active = complete.filter((item) => item.startMs <= startMs && item.endMs >= endMs);
    if (!active.length) continue;
    const bucketIds = [...new Set(active.map((item) => item.bucketId))].sort();
    const parallel = active.length > 1;
    const key = `${bucketIds.join("+")}:${parallel ? "parallel" : "single"}`;
    const component = components.get(key) || { key, bucketIds, parallel, durationMs: 0, intervals: [], refs: new Map() };
    component.durationMs += endMs - startMs;
    component.intervals.push(...active);
    for (const item of active) {
      const ref = nodeRef(item);
      component.refs.set(`${ref.traceNodeId || ""}:${ref.eventIndex ?? ""}`, ref);
    }
    components.set(key, component);
  }
  const labels = new Map(bucketDefinitions);
  return [...components.values()].map((component) => {
    const categories = component.bucketIds.map((id) => labels.get(id) || id);
    return {
      key: component.key,
      bucketIds: component.bucketIds,
      label: component.parallel ? `并行：${categories.join(" + ")}` : categories[0],
      durationMs: component.durationMs,
      sharePercent: totalMs ? Math.round((component.durationMs / totalMs) * 1000) / 10 : 0,
      parallel: component.parallel,
      confidence: confidenceFor(component.intervals),
      nodeRefs: [...component.refs.values()],
    };
  }).sort((left, right) => right.durationMs - left.durationMs || left.key.localeCompare(right.key));
}

// eslint-disable-next-line complexity
function buildSessionTiming(trace) {
  const sessionTiming = trace?.timing || {};
  const startedAt = sessionTiming.startedAt || trace?.root?.timestamp || null;
  const completedAt = sessionTiming.completedAt || trace?.root?.completedAt || null;
  const startMs = Date.parse(startedAt || "");
  const endMs = Date.parse(completedAt || "");
  const durationMs = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs ? endMs - startMs : null;
  const intervals = [...walkTrace(trace?.root), ...responseIntervals(trace)];
  const completeIntervals = intervals.filter((item) => item.durationMs != null);
  const executionCoverage = coveredMs(completeIntervals.map((item) => ({ startMs: item.startMs, endMs: item.endMs })));
  const parallelism = overlapMs(completeIntervals.map((item) => ({ startMs: item.startMs, endMs: item.endMs })));
  const inputWaits = (trace?.timing?.inputWaits || []).filter((wait) => Number.isFinite(wait.startMs) && Number.isFinite(wait.endMs) && wait.endMs >= wait.startMs);
  const waitingForInputMs = coveredMs(inputWaits);
  const activeRunMs = executionCoverage;
  const buckets = bucketDefinitions.map(([id, label]) => buildBucket(id, label, intervals.filter((item) => item.bucketId === id), activeRunMs || 0));
  const composition = executionComposition(completeIntervals, activeRunMs);
  const partialCount = intervals.filter((item) => item.durationKind === "partial").length;
  const unavailableCount = intervals.filter((item) => item.durationKind === "unavailable").length;
  const estimatedCount = intervals.filter((item) => item.durationKind === "estimated").length;

  const quality = {
    estimatedCount,
    missingStartCount: intervals.filter((item) => item.startMs == null).length,
    missingEndCount: intervals.filter((item) => item.endMs == null).length,
    partialCount,
    unavailableCount,
    unlinkedCount: intervals.filter((item) => item.eventIndex == null && item.node.type !== "subagent").length,
    notes: trace?.timing?.estimated ? ["会话边界由首末有效事件推算"] : [],
  };
  const llmBucket = buckets.find((bucket) => bucket.id === "llm_wait");
  const turns = (trace?.root?.children || []).filter((node) => node.type === "turn").map((turn, turnIndex) => {
    const turnIntervals = intervals.filter((item) => item.turnIndex === turnIndex);
    const turnStart = Date.parse(turn.timestamp || "");
    const turnEnd = Date.parse(turn.completedAt || "");
    const turnDuration = Number.isFinite(turnStart) && Number.isFinite(turnEnd) && turnEnd >= turnStart ? turnEnd - turnStart : null;
    return {
      turnNumber: turnIndex + 1,
      turnId: turn.detail?.turn?.id || turn.id,
      startedAt: turn.timestamp || null,
      completedAt: turn.completedAt || null,
      durationMs: turnDuration,
      durationKind: turnDuration == null ? "partial" : turn.durationEstimated ? "estimated" : "observed",
      confidence: confidenceFor(turnIntervals.filter((item) => item.durationMs != null)),
      buckets: bucketDefinitions
        .map(([id, label]) => buildBucket(id, label, turnIntervals.filter((item) => item.bucketId === id), turnDuration || 0))
        .filter((bucket) => bucket.count > 0),
    };
  });
  return {
    version: 1,
    session: {
      startedAt,
      completedAt,
      durationMs,
      durationKind: durationMs == null ? "unavailable" : trace?.timing?.estimated ? "estimated" : "observed",
      waitingForInputMs,
      waitingForInputCount: inputWaits.length,
      activeRunMs,
      coverageMs: executionCoverage,
      executionComposition: composition,
      parallelism,
      llm: {
        generatedTokens: llmBucket?.generatedTokens || null,
        generatedTokensPerSecond: llmBucket?.generatedTokensPerSecond || null,
        responseCount: llmBucket?.count || 0,
      },
    },
    buckets,
    turns,
    quality,
  };
}

export { buildSessionTiming, coveredMs, mergeIntervals, overlapMs };