import test from "node:test";
import assert from "node:assert/strict";

globalThis.window = globalThis;
globalThis.SessionWorkbench = {
  els: { statsContent: null },
  escapeHtml: (value) => String(value ?? ""),
  escapeAttr: (value) => String(value ?? ""),
  compactNumber: (value) => String(value ?? 0),
  highlight: (value) => String(value ?? ""),
  formatBytes: () => "",
  showToast: () => {},
  setViewMode: () => {},
  openRawEvent: () => {},
};

await import("../public/app-view-stats.js");

const api = globalThis.SessionWorkbench;

test("latestContextWindow reads the projected context usage limit", () => {
  const detail = {
    turns: [
      {
        items: [
          { type: "token-count", info: { context_usage: { percent: 6, used: 20291, limit: 353400 } } },
          { type: "token-count", info: { context_usage: { percent: 3, used: 9000, limit: 120000 } } },
        ],
      },
    ],
  };
  assert.equal(api.latestContextWindow(detail), 120000);
});

test("buildContextCapacityStats aggregates Codex token-count peaks, ratios and compaction count", () => {
  const detail = {
    turns: [
      {
        items: [
          {
            type: "token-count",
            info: {
              last_token_usage: { input_tokens: 15577, output_tokens: 641, total_tokens: 16218 },
              context_usage: { percent: 5, used: 16218, limit: 258400 },
            },
          },
          {
            type: "token-count",
            info: {
              last_token_usage: { input_tokens: 41363, output_tokens: 1019, total_tokens: 42382 },
              context_usage: { percent: 17, used: 42382, limit: 258400 },
            },
          },
          { type: "context-compact", compact: { kind: "pi_compaction" } },
        ],
      },
    ],
  };
  assert.deepEqual(api.buildContextCapacityStats(detail), {
    contextWindow: 258400,
    maxUsedTokens: 42382,
    maxOutputTokens: 1019,
    compactCount: 1,
  });
});

test("buildContextCapacityStats reads Pi assistant usage without recorded window", () => {
  const detail = {
    turns: [
      {
        items: [
          { type: "assistant-message", tokenUsage: { outputTokens: 179, reasoningTokens: 0, generatedTokens: 179, inputTokens: 7256, totalTokens: 7563 } },
          { type: "assistant-message", tokenUsage: { outputTokens: 84, reasoningTokens: 10, generatedTokens: 94, inputTokens: 940, totalTokens: 8474 } },
        ],
      },
    ],
  };
  assert.deepEqual(api.buildContextCapacityStats(detail), {
    contextWindow: 0,
    maxUsedTokens: 8474,
    maxOutputTokens: 179,
    compactCount: 0,
  });
});

test("buildContextCapacityStats ignores invalid or non-positive usage values", () => {
  const detail = {
    turns: [
      {
        items: [
          { type: "token-count", info: { last_token_usage: { output_tokens: "n/a", total_tokens: -5 } } },
          { type: "assistant-message", tokenUsage: { outputTokens: 3, reasoningTokens: 1, generatedTokens: 4 } },
        ],
      },
    ],
  };
  assert.deepEqual(api.buildContextCapacityStats(detail), {
    contextWindow: 0,
    maxUsedTokens: 0,
    maxOutputTokens: 4,
    compactCount: 0,
  });
});
