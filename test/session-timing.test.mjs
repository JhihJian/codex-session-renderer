import test from "node:test";
import assert from "node:assert/strict";
import { buildSessionTiming, coveredMs, mergeIntervals, overlapMs } from "../src/session-timing.mjs";

const interval = (startMs, endMs) => ({ startMs, endMs });

test("session timing merges coverage and reports overlap", () => {
  assert.deepEqual(mergeIntervals([interval(0, 10), interval(5, 20), interval(30, 40)]), [
    { startMs: 0, endMs: 20 },
    { startMs: 30, endMs: 40 },
  ]);
  assert.equal(coveredMs([interval(0, 10), interval(5, 20)]), 20);
  assert.deepEqual(overlapMs([interval(0, 10), interval(5, 20), interval(8, 12)]), { overlapMs: 7, peak: 3 });
});

test("session timing classifies trace nodes and preserves source references", () => {
  const trace = {
    timing: {
      startedAt: "2026-07-08T10:00:00.000Z",
      completedAt: "2026-07-08T10:00:20.000Z",
      estimated: false,
    },
    root: {
      type: "thread",
      timestamp: "2026-07-08T10:00:00.000Z",
      completedAt: "2026-07-08T10:00:20.000Z",
      children: [{
        type: "turn",
        index: 0,
        id: "turn:0",
        timestamp: "2026-07-08T10:00:00.000Z",
        completedAt: "2026-07-08T10:00:20.000Z",
        durationEstimated: false,
        detail: { turn: { id: "turn-1" } },
        children: [
          {
            type: "tool",
            id: "tool-1",
            timestamp: "2026-07-08T10:00:02.000Z",
            completedAt: "2026-07-08T10:00:08.000Z",
            durationEstimated: false,
            detail: { item: { sourceIndex: 4, name: "exec_command", callId: "call-1", status: "completed" } },
            children: [],
          },
          {
            type: "subagent",
            id: "agent-1",
            timestamp: "2026-07-08T10:00:05.000Z",
            completedAt: "2026-07-08T10:00:12.000Z",
            durationEstimated: true,
            detail: {},
            children: [],
          },
        ],
      }],
    },
  };
  const timing = buildSessionTiming(trace);
  const tools = timing.buckets.find((bucket) => bucket.id === "tool_execution");
  const agents = timing.buckets.find((bucket) => bucket.id === "subagent_execution");

  assert.equal(timing.session.durationMs, 20_000);
  assert.equal(timing.session.coverageMs, 10_000);
  assert.equal(timing.session.parallelism.peak, 2);
  assert.equal(timing.session.parallelism.overlapMs, 3_000);
  assert.equal(tools.coverageMs, 6_000);
  assert.equal(tools.nodeRefs[0].eventIndex, 4);
  assert.equal(tools.groups[0].label, "exec_command");
  assert.equal(tools.groups[0].count, 1);
  assert.equal(tools.groups[0].averageDurationMs, 6_000);
  assert.equal(agents.confidence, "estimated");
  assert.equal(timing.turns[0].turnNumber, 1);
});

test("session timing reports partial nodes without inventing duration", () => {
  const timing = buildSessionTiming({
    timing: { startedAt: "2026-07-08T10:00:00.000Z", completedAt: "2026-07-08T10:00:05.000Z", estimated: true },
    root: {
      type: "thread",
      children: [{
        type: "turn",
        index: 0,
        timestamp: "2026-07-08T10:00:00.000Z",
        completedAt: "2026-07-08T10:00:05.000Z",
        children: [{ type: "tool", id: "open", timestamp: "2026-07-08T10:00:01.000Z", children: [] }],
      }],
    },
  });

  assert.equal(timing.session.durationMs, 5_000);
  assert.equal(timing.quality.missingEndCount, 1);
  assert.equal(timing.quality.partialCount, 1);
  assert.equal(timing.buckets.find((bucket) => bucket.id === "tool_execution").count, 1);
  assert.equal(timing.buckets.find((bucket) => bucket.id === "tool_execution").coverageMs, 0);
});
