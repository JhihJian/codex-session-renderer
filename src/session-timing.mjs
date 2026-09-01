const bucketDefinitions = [
  ["tool_execution", "工具执行"],
  ["subagent_execution", "子代理执行"],
  ["delegation", "委派与等待"],
  ["context_compaction", "上下文压缩"],
  ["system_processing", "系统事件处理"],
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
  if (node.type === "tool") return "tool_execution";
  if (node.type === "subagent" || node.type === "lazy-child") return "subagent_execution";
  if (node.type === "handoff") return "delegation";
  const item = node.detail?.item || {};
  if (item.type === "context-compact" || /compact/i.test(item.eventType || item.responseType || "")) return "context_compaction";
  if (node.type === "event" || node.type === "metric") return "system_processing";
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

function nodeRef(item) {
  return {
    traceNodeId: item.node.id,
    turnIndex: item.turnIndex,
    eventIndex: item.eventIndex,
    durationMs: item.durationMs,
    durationKind: item.durationKind,
  };
}

function buildBucket(id, label, intervals, totalMs) {
  const complete = intervals.filter((item) => item.durationMs != null);
  const coverage = coveredMs(complete.map((item) => ({ startMs: item.startMs, endMs: item.endMs })));
  const overlap = overlapMs(complete.map((item) => ({ startMs: item.startMs, endMs: item.endMs })));
  return {
    id,
    label,
    coverageMs: coverage,
    nodeDurationMs: complete.reduce((sum, item) => sum + item.durationMs, 0),
    sharePercent: totalMs ? Math.round((coverage / totalMs) * 1000) / 10 : 0,
    count: intervals.length,
    confidence: confidenceFor(complete),
    overlapMs: overlap.overlapMs,
    nodeRefs: intervals.map(nodeRef),
  };
}

// eslint-disable-next-line complexity
function buildSessionTiming(trace) {
  const sessionTiming = trace?.timing || {};
  const startedAt = sessionTiming.startedAt || trace?.root?.timestamp || null;
  const completedAt = sessionTiming.completedAt || trace?.root?.completedAt || null;
  const startMs = Date.parse(startedAt || "");
  const endMs = Date.parse(completedAt || "");
  const durationMs = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs ? endMs - startMs : null;
  const intervals = walkTrace(trace?.root);
  const completeIntervals = intervals.filter((item) => item.durationMs != null);
  const executionCoverage = coveredMs(completeIntervals.map((item) => ({ startMs: item.startMs, endMs: item.endMs })));
  const parallelism = overlapMs(completeIntervals.map((item) => ({ startMs: item.startMs, endMs: item.endMs })));
  const buckets = bucketDefinitions.map(([id, label]) => buildBucket(id, label, intervals.filter((item) => item.bucketId === id), durationMs || 0));
  const partialCount = intervals.filter((item) => item.durationKind === "partial").length;
  const unavailableCount = intervals.filter((item) => item.durationKind === "unavailable").length;
  const estimatedCount = intervals.filter((item) => item.durationKind === "estimated").length;
  if (durationMs != null) {
    buckets.push({
      id: "unattributed",
      label: "未归因时间",
      coverageMs: Math.max(0, durationMs - executionCoverage),
      nodeDurationMs: null,
      sharePercent: Math.max(0, Math.round(((durationMs - executionCoverage) / durationMs) * 1000) / 10),
      count: 0,
      confidence: "estimated",
      overlapMs: 0,
      nodeRefs: [],
    });
  }
  const quality = {
    estimatedCount,
    missingStartCount: intervals.filter((item) => item.startMs == null).length,
    missingEndCount: intervals.filter((item) => item.endMs == null).length,
    partialCount,
    unavailableCount,
    unlinkedCount: intervals.filter((item) => item.eventIndex == null && item.node.type !== "subagent").length,
    notes: trace?.timing?.estimated ? ["会话边界由首末有效事件推算"] : [],
  };
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
      coverageMs: executionCoverage,
      coveragePercent: durationMs ? Math.round((executionCoverage / durationMs) * 1000) / 10 : 0,
      parallelism,
    },
    buckets,
    turns,
    quality,
  };
}

export { buildSessionTiming, coveredMs, mergeIntervals, overlapMs };