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
  const detail = item.node.detail?.item || {};
  return {
    traceNodeId: item.node.id,
    turnIndex: item.turnIndex,
    eventIndex: detail.sourceIndex ?? item.eventIndex,
    outputEventIndex: detail.outputSourceIndex ?? null,
    durationMs: item.durationMs,
    durationKind: item.durationKind,
    label: detail.name || item.node.title || item.node.type,
    toolName: detail.name || null,
    callId: detail.callId || null,
    status: detail.status || item.node.status || null,
    arguments: detail.arguments || null,
  };
}

function buildGroups(intervals) {
  const groups = new Map();
  for (const item of intervals) {
    const ref = nodeRef(item);
    const key = ref.toolName || ref.label || "未命名节点";
    const group = groups.get(key) || { key, label: key, intervals: [], refs: [] };
    group.intervals.push(item);
    group.refs.push(ref);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    const complete = group.intervals.filter((item) => item.durationMs != null);
    const durations = complete.map((item) => item.durationMs).sort((a, b) => a - b);
    return {
      key: group.key,
      label: group.label,
      count: group.intervals.length,
      coverageMs: coveredMs(complete.map((item) => ({ startMs: item.startMs, endMs: item.endMs }))),
      nodeDurationMs: durations.reduce((sum, duration) => sum + duration, 0),
      averageDurationMs: durations.length ? Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length) : null,
      maxDurationMs: durations.at(-1) ?? null,
      failedCount: group.intervals.filter((item) => /fail|error|abort/i.test(item.node.status || item.node.detail?.item?.status || "")).length,
      incompleteCount: group.intervals.filter((item) => item.durationMs == null).length,
      refs: group.refs,
    };
  }).sort((left, right) => right.coverageMs - left.coverageMs || right.count - left.count);
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
    groups: buildGroups(intervals),
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
    const gaps = mergeIntervals([{ startMs, endMs }]).flatMap((outer) => {
      const inside = mergeIntervals(completeIntervals.map((item) => ({ startMs: Math.max(outer.startMs, item.startMs), endMs: Math.min(outer.endMs, item.endMs) })))
        .filter((item) => item.endMs > item.startMs);
      const points = [outer.startMs, ...inside.flatMap((item) => [item.startMs, item.endMs]), outer.endMs].sort((left, right) => left - right);
      return points.slice(0, -1).flatMap((point, index) => {
        const next = points[index + 1];
        const covered = inside.some((item) => point >= item.startMs && next <= item.endMs);
        return covered || next <= point ? [] : [{ startMs: point, endMs: next }];
      });
    });
    const gapGroups = gaps.map((gap, index) => {
      const midpoint = gap.startMs + (gap.endMs - gap.startMs) / 2;
      const turn = (trace?.root?.children || []).find((node) => {
        const turnStart = Date.parse(node.timestamp || "");
        const turnEnd = Date.parse(node.completedAt || "");
        return Number.isFinite(turnStart) && Number.isFinite(turnEnd) && midpoint >= turnStart && midpoint <= turnEnd;
      });
      const duration = gap.endMs - gap.startMs;
      return { key: `gap-${index}`, label: turn ? `第 ${turn.index + 1} 轮 · 事件间隔` : "会话边界间隔", count: 1, coverageMs: duration, nodeDurationMs: null, averageDurationMs: duration, maxDurationMs: duration, failedCount: 0, incompleteCount: 0, refs: [{ traceNodeId: null, eventIndex: null, durationMs: duration, durationKind: "unavailable", label: `时间缺口 ${index + 1}`, startedAt: new Date(gap.startMs).toISOString(), completedAt: new Date(gap.endMs).toISOString(), actionable: false }] };
    }).sort((left, right) => right.coverageMs - left.coverageMs);
    const unattributedMs = gaps.reduce((sum, gap) => sum + gap.endMs - gap.startMs, 0);
    buckets.push({
      id: "unattributed",
      label: "时间缺口（模型处理 / 等待）",
      coverageMs: unattributedMs,
      nodeDurationMs: null,
      sharePercent: Math.max(0, Math.round((unattributedMs / durationMs) * 1000) / 10),
      count: gapGroups.length,
      confidence: "unavailable",
      overlapMs: 0,
      groups: gapGroups,
      nodeRefs: gapGroups.flatMap((group) => group.refs),
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