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
  assert.match(withTokens, /平均生成速度/);
  assert.match(withTokens, /50 tok\/s/);
  assert.match(withTokens, /2 次响应 · 生成 500 tok/);

  const withoutTokens = api.renderTimingMetrics(timingFixture({ withTokens: false }).session).join("");
  assert.equal(withoutTokens.includes("平均生成速度"), false);
});

test("timing view renders session TPS card and per-turn TPS meta", () => {
  const markup = api.renderTimingView(timingFixture());
  assert.match(markup, /平均生成速度/);
  assert.match(markup, /50 tok\/s/);
  assert.match(markup, /约 50 tok\/s/);
  assert.match(markup, /含排队与首字等待/);

  const noTokenView = api.renderTimingView(timingFixture({ withTokens: false }));
  assert.equal(noTokenView.includes("tok/s"), false);
  assert.equal(noTokenView.includes("约 50"), false);
});
