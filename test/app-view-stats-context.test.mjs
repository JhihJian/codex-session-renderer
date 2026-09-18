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
    windowSource: "recorded",
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
    windowSource: "none",
    maxUsedTokens: 8474,
    maxOutputTokens: 179,
    compactCount: 0,
  });
});

test("model window config fills in missing session window with substring matching", () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
  };
  const detail = {
    session: { model: "gpt-5.6-terra" },
    turns: [
      {
        items: [
          { type: "assistant-message", tokenUsage: { outputTokens: 179, reasoningTokens: 0, generatedTokens: 179, inputTokens: 7256, totalTokens: 7563 } },
        ],
      },
    ],
  };

  assert.equal(api.resolveConfiguredContextWindow("GPT-5.6-TERRA", [{ match: "gpt-5", tokens: 400000, enabled: true }]), 400000);
  assert.equal(api.resolveConfiguredContextWindow("glm-5.3", [{ match: "gpt-5", tokens: 400000, enabled: true }]), 0);
  assert.equal(api.resolveConfiguredContextWindow("gpt-5", [{ match: "gpt-5", tokens: 400000, enabled: false }]), 0);
  assert.deepEqual(api.saveModelContextWindows([{ match: " gpt-5 ", tokens: "400000" }, { match: "", tokens: 100 }, { match: "bad", tokens: "nan" }], globalThis.localStorage), [
    { match: "gpt-5", tokens: 400000, enabled: true },
  ]);
  assert.deepEqual(api.loadModelContextWindows(globalThis.localStorage), [{ match: "gpt-5", tokens: 400000, enabled: true }]);

  assert.deepEqual(api.buildContextCapacityStats(detail), {
    contextWindow: 400000,
    windowSource: "configured",
    maxUsedTokens: 7563,
    maxOutputTokens: 179,
    compactCount: 0,
  });
  delete globalThis.localStorage;
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
    windowSource: "none",
    maxUsedTokens: 0,
    maxOutputTokens: 4,
    compactCount: 0,
  });
});
