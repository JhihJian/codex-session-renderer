import test from "node:test";
import assert from "node:assert/strict";

globalThis.window = globalThis;
globalThis.SessionWorkbench = {
  els: { statsContent: null },
  escapeHtml: (value) => String(value ?? ""),
  escapeAttr: (value) => String(value ?? ""),
  formatDuration: (ms) => (ms == null ? "" : `${Math.round(ms / 1000)}s`),
  compactNumber: (value) => String(value ?? 0),
  highlight: (value) => String(value ?? ""),
  formatBytes: () => "",
  showToast: () => {},
  setViewMode: () => {},
  selectTraceNode: () => {},
  openRawEvent: () => {},
};

await import("../public/app-view-stats-timing.js");

const api = globalThis.SessionWorkbench;

function timingFixture({ withTokens = true } = {}) {
  return {
    session: {
      durationMs: 60_000,
      durationKind: "estimated",
      waitingForInputMs: 5_000,
      waitingForInputCount: 1,
      activeRunMs: 40_000,
      parallelism: { peak: 1, overlapMs: 0 },
      executionComposition: [],
      llm: withTokens
        ? { generatedTokens: 500, generatedTokensPerSecond: 50, responseCount: 2 }
        : { generatedTokens: null, generatedTokensPerSecond: null, responseCount: 0 },
    },
    buckets: [],
    turns: [{
      turnNumber: 1,
      durationMs: 30_000,
      userTitle: "帮我优化首页样式",
      confidence: "estimated",
      buckets: withTokens
        ? [{ id: "llm_wait", label: "LLM 等待时长", coverageMs: 10_000, sharePercent: 33.3, generatedTokensPerSecond: 50 }]
        : [],
    }],
    quality: { estimatedCount: 1 },
  };
}

test("formatTokensPerSecond keeps readable precision", () => {
  assert.equal(api.formatTokensPerSecond(50), "50 tok/s");
  assert.equal(api.formatTokensPerSecond(50.25), "50.3 tok/s");
  assert.equal(api.formatTokensPerSecond(137.6), "138 tok/s");
  assert.equal(api.formatTokensPerSecond(null), "");
});

test("timing metrics include session TPS card only when token data exists", () => {
  const withTokens = api.renderTimingMetrics(timingFixture().session).join("");
  assert.match(withTokens, /LLM 并发峰值/);
  assert.match(withTokens, /LLM 请求重叠 0s/);
  assert.match(withTokens, /平均生成速度/);
  assert.match(withTokens, /50 tok\/s/);
  assert.match(withTokens, /2 次响应 · 生成 500 tok/);

  const withoutTokens = api.renderTimingMetrics(timingFixture({ withTokens: false }).session).join("");
  assert.equal(withoutTokens.includes("平均生成速度"), false);
});

test("timing view renders session TPS card and per-turn TPS meta", () => {
  const markup = api.renderTimingView(timingFixture());
  assert.match(markup, /平均生成速度/);
  assert.match(markup, /LLM 并发只统计可关联 LLM 请求区间/);
  assert.match(markup, /50 tok\/s/);
  assert.match(markup, /约 50 tok\/s/);
  assert.match(markup, /含排队与首字等待/);

  const noTokenView = api.renderTimingView(timingFixture({ withTokens: false }));
  assert.equal(noTokenView.includes("tok/s"), false);
  assert.equal(noTokenView.includes("约 50"), false);
});

test("timing steps render returned tokens, context occupancy, and signed change", () => {
  const markup = api.renderTimingSteps([
    { traceNodeId: "response-1", eventIndex: 1, bucketId: "llm_wait", label: "gpt-5", durationMs: 3_000, resultTokens: 120, resultTokenKind: "recorded", contextUsage: { percent: 42, used: 42_000, limit: 100_000 }, contextChangePercent: 2.5, contextRecordedAt: "2026-07-08T10:00:03.000Z" },
    { traceNodeId: "tool-1", eventIndex: 2, bucketId: "tool_execution", label: "bash", durationMs: 1_000, resultTokens: 8, resultTokenKind: "estimated", contextUsage: { percent: 38 }, contextChangePercent: -4, contextRecordedAt: "2026-07-08T10:00:04.000Z" },
  ]);

  assert.match(markup, /步骤明细/);
  assert.match(markup, /LLM · gpt-5/);
  assert.match(markup, /120 tok/);
  assert.match(markup, /约 8 tok/);
  assert.match(markup, /42000 \/ 100000 · 42%/);
  assert.match(markup, /\+2.5%/);
  assert.match(markup, /-4%/);
  assert.equal(api.formatContextChange(0), "+0%");
});

test("timing turn bars scale relative to the longest turn and show user title", () => {
  const turns = [
    ...timingFixture().turns,
    { turnNumber: 2, durationMs: 60_000, userTitle: "再补一个登录页", confidence: "observed", buckets: [{ id: "tool_execution", label: "工具执行时长", coverageMs: 30_000, sharePercent: 50 }] },
    { turnNumber: 3, durationMs: null, activeRunMs: 0, confidence: "unavailable", buckets: [] },
  ];
  const markup = api.renderTimingTurns(turns);
  assert.match(markup, /条长相对最长轮次时长/);
  assert.match(markup, /第 1 轮/);
  assert.match(markup, /帮我优化首页样式/);
  assert.match(markup, /再补一个登录页/);
  const shares = [...markup.matchAll(/--turn:([\d.]+)%/g)].map((match) => match[1]);
  assert.deepEqual(shares, ["50", "100", "1"]);
  assert.equal(markup.includes('class="timing-turn-user" title="帮我优化首页样式"'), true);
});

test("timing turn bars fall back to full width without usable turn durations", () => {
  const markup = api.renderTimingTurns([{ turnNumber: 1, durationMs: null, confidence: "unavailable", buckets: [] }]);
  assert.match(markup, /--turn:100%/);
});

test("timing turn shows its final context occupancy and source", () => {
  assert.equal(api.formatTurnContext({ contextUsage: { percent: 18.4 }, contextSource: "model-estimated" }), "上下文 18.4%（模型估算）");
  assert.match(api.renderTimingTurns([{ turnNumber: 1, durationMs: 1_000, confidence: "estimated", contextUsage: { percent: 18.4 }, contextSource: "model-estimated", buckets: [] }]), /上下文 18.4%（模型估算）/);
});

test("timing steps distinguish model-window estimates from recorded snapshots", () => {
  assert.equal(api.contextSourceLabel("model-estimated"), "模型估算");
  assert.match(api.renderTimingStep({ traceNodeId: "response-1", bucketId: "llm_wait", label: "gpt-5.6-terra", durationMs: 1_000, contextUsage: { percent: 18.4, used: 50_000, limit: 272_000 }, contextSource: "model-estimated" }), /18.4%（模型估算）/);
});
