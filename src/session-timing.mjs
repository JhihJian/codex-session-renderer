const bucketDefinitions = [
  ["llm_wait", "LLM 等待时长"],
  ["tool_execution", "工具执行时长"],
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
  const contextMetrics = node?.detail?.contextMetrics || null;
  const turnIndex = node?.type === "turn" ? node.index ?? parentTurnIndex : parentTurnIndex;
  if (durationMs == null) return {
    node,
    turnIndex,
    durationMs: null,
    durationKind: startMs == null && endMs == null ? "unavailable" : "partial",
    startMs,
    endMs,
    eventIndex: item.sourceIndex ?? item.outputSourceIndex ?? event.index ?? null,
    contextMetrics,
    contextUsage: contextMetrics?.usage || null,
  };
  return {
    node,
    turnIndex,
    durationMs,
    durationKind: node.durationEstimated ? "estimated" : "observed",
    startMs,
    endMs,
    eventIndex: item.sourceIndex ?? item.outputSourceIndex ?? event.index ?? null,
    contextMetrics,
    contextUsage: contextMetrics?.usage || null,
  };
}

function bucketForNode(node) {
  if (node.type === "llm-response") return "llm_wait";
  if (node.type === "tool") return "tool_execution";
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
      detail: { item: { name: response.model || "未知模型", sourceIndex: response.eventIndex, contextUsage: response.contextUsage, contextSource: response.contextSource, responseType: response.responseType, outputTokens: response.outputTokens, reasoningTokens: response.reasoningTokens, generatedTokens: response.generatedTokens, inputTokens: response.inputTokens, cacheReadTokens: response.cacheReadTokens, cacheWriteTokens: response.cacheWriteTokens, totalTokens: response.totalTokens, cost: response.cost } },
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
    contextSource: response.contextSource || null,
    outputTokens: response.outputTokens,
    reasoningTokens: response.reasoningTokens,
    generatedTokens: response.generatedTokens,
    inputTokens: response.inputTokens,
    cacheReadTokens: response.cacheReadTokens,
    cacheWriteTokens: response.cacheWriteTokens,
    totalTokens: response.totalTokens,
    cost: response.cost,
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
  const contextMetrics = item.contextMetrics || item.node.detail?.contextMetrics || null;
  const resultTokens = item.generatedTokens ?? contextMetrics?.resultTokens ?? toolResultTokens(detail.output);
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
    contextUsage: item.contextUsage || detail.contextUsage || contextMetrics?.usage || null,
    resultTokens,
    resultTokenKind: item.generatedTokens != null ? "recorded" : contextMetrics?.resultTokenKind || (resultTokens != null ? "estimated" : null),
    contextSource: contextMetrics?.source || item.contextSource || (item.contextUsage ? "recorded" : null),
    contextChangePercent: contextMetrics?.changePercent ?? null,
    outputTokens: item.outputTokens ?? detail.outputTokens ?? null,
    reasoningTokens: item.reasoningTokens ?? detail.reasoningTokens ?? null,
    generatedTokens: item.generatedTokens ?? detail.generatedTokens ?? null,
    inputTokens: item.inputTokens ?? detail.inputTokens ?? null,
    cacheReadTokens: item.cacheReadTokens ?? detail.cacheReadTokens ?? null,
    cacheWriteTokens: item.cacheWriteTokens ?? detail.cacheWriteTokens ?? null,
    totalTokens: item.totalTokens ?? detail.totalTokens ?? null,
    cost: item.cost ?? detail.cost ?? null,
    callId: detail.callId || null,
    status: detail.status || item.node.status || null,
    arguments: detail.arguments || null,
  };
}

function toolResultTokens(output) {
  if (output == null || output === "") return null;
  return Math.max(1, Math.ceil(Buffer.byteLength(String(output), "utf8") / 4));
}

function contextSnapshots(trace, intervals) {
  const snapshots = [];
  const add = (usage, time, eventIndex = null) => {
    if (!Number.isFinite(usage?.percent) || !Number.isFinite(time)) return;
    snapshots.push({ usage, time, eventIndex });
  };
  for (const item of intervals) {
    if (item.contextMetrics?.source !== "estimated") add(item.contextUsage, item.endMs, item.eventIndex);
  }
  const walk = (node) => {
    if (!node) return;
    const item = node.detail?.item || {};
    add(item.info?.context_usage, Date.parse(node.timestamp || ""), item.sourceIndex ?? null);
    for (const child of node.children || []) walk(child);
  };
  walk(trace?.root);
  const seen = new Set();
  return snapshots
    .sort((left, right) => left.time - right.time || (left.eventIndex ?? Infinity) - (right.eventIndex ?? Infinity))
    .filter((snapshot) => {
      const key = `${snapshot.time}:${snapshot.eventIndex ?? ""}:${snapshot.usage.percent}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((snapshot, index, values) => ({
      ...snapshot,
      deltaPercent: index === 0 ? null : Math.round((snapshot.usage.percent - values[index - 1].usage.percent) * 10) / 10,
    }));
}

function closestContextSnapshot(snapshots, item) {
  if (item.contextUsage && Number.isFinite(item.contextUsage.percent)) {
    return snapshots.find((snapshot) => snapshot.eventIndex === item.eventIndex && snapshot.usage.percent === item.contextUsage.percent)
      || { usage: item.contextUsage, deltaPercent: null };
  }
  if (!snapshots.length || item.endMs == null) return null;
  return snapshots.reduce((closest, snapshot) => (
    Math.abs(snapshot.time - item.endMs) < Math.abs(closest.time - item.endMs) ? snapshot : closest
  ));
}

function buildSteps(trace, intervals) {
  const snapshots = contextSnapshots(trace, intervals);
  return intervals
    .map((item) => {
      const ref = nodeRef(item);
      const snapshot = closestContextSnapshot(snapshots, item);
      return {
        ...ref,
        bucketId: item.bucketId,
        contextUsage: snapshot?.usage || ref.contextUsage || null,
        contextChangePercent: ref.contextChangePercent ?? snapshot?.deltaPercent ?? null,
        contextRecordedAt: snapshot?.time != null ? new Date(snapshot.time).toISOString() : null,
        contextSource: ref.contextSource || (snapshot ? "recorded" : null),
      };
    })
    .sort((left, right) => (left.eventIndex ?? Infinity) - (right.eventIndex ?? Infinity) || (left.traceNodeId || "").localeCompare(right.traceNodeId || ""));
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
    const parallel = bucketIds.length > 1;
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
  const steps = buildSteps(trace, intervals);
  const completeIntervals = intervals.filter((item) => item.durationMs != null);
  const executionCoverage = coveredMs(completeIntervals.map((item) => ({ startMs: item.startMs, endMs: item.endMs })));
  const completeLlmIntervals = completeIntervals.filter((item) => item.bucketId === "llm_wait");
  const parallelism = overlapMs(completeLlmIntervals.map((item) => ({ startMs: item.startMs, endMs: item.endMs })));
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
  const turns = buildTimingTurns(trace, intervals, steps);
  return {
    version: 2,
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
        usage: summarizeLlmUsage(completeLlmIntervals),
      },
    },
    buckets,
    steps,
    turns,
    quality,
  };
}

function buildTimingTurns(trace, intervals, steps) {
  return (trace?.root?.children || [])
    .filter((node) => node.type === "turn")
    .map((turn, turnIndex) => buildTimingTurn(turn, turnIndex, intervals, steps));
}

function buildTimingTurn(turn, turnIndex, intervals, steps) {
  const turnIntervals = intervals.filter((item) => item.turnIndex === turnIndex);
  const completeTurnIntervals = turnIntervals.filter((item) => item.durationMs != null);
  const duration = timingTurnDuration(turn);
  return {
    turnNumber: turnIndex + 1,
    turnId: timingTurnId(turn),
    userTitle: turn.title || null,
    startedAt: turn.timestamp || null,
    completedAt: turn.completedAt || null,
    ...duration,
    confidence: confidenceFor(completeTurnIntervals),
    activeRunMs: coveredMs(completeTurnIntervals.map((item) => ({ startMs: item.startMs, endMs: item.endMs }))),
    llmUsage: summarizeLlmUsage(turnIntervals.filter((item) => item.bucketId === "llm_wait")),
    ...timingTurnContext(steps, turnIndex),
    buckets: timingTurnBuckets(turnIntervals, duration.durationMs),
  };
}

function timingTurnId(turn) {
  return turn.detail?.turn?.id || turn.id;
}

function timingTurnDuration(turn) {
  const start = Date.parse(turn.timestamp || "");
  const end = Date.parse(turn.completedAt || "");
  const durationMs = Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;
  return { durationMs, durationKind: durationMs == null ? "partial" : turn.durationEstimated ? "estimated" : "observed" };
}

function timingTurnContext(steps, turnIndex) {
  const context = latestTurnContext(steps, turnIndex);
  return {
    contextUsage: context?.usage || null,
    contextSource: context?.source || null,
    contextChangePercent: context?.changePercent ?? null,
  };
}

function timingTurnBuckets(intervals, durationMs) {
  return bucketDefinitions
    .map(([id, label]) => buildBucket(id, label, intervals.filter((item) => item.bucketId === id), durationMs || 0))
    .filter((bucket) => bucket.count > 0);
}

function summarizeLlmUsage(intervals) {
  const fields = ["inputTokens", "outputTokens", "reasoningTokens", "cacheReadTokens", "cacheWriteTokens", "totalTokens", "cost"];
  const summary = {};
  for (const field of fields) {
    const values = intervals.map((item) => item[field]).filter(Number.isFinite);
    summary[field] = values.length ? values.reduce((sum, value) => sum + value, 0) : null;
  }
  return summary;
}

function latestTurnContext(steps, turnIndex) {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step.turnIndex === turnIndex && Number.isFinite(step.contextUsage?.percent)) {
      return { usage: step.contextUsage, source: step.contextSource, changePercent: step.contextChangePercent };
    }
  }
  return null;
}

export { buildSessionTiming, coveredMs, mergeIntervals, overlapMs };