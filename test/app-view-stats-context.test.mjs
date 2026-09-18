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
  itemMatches: () => true,
  readableToolItem: (item) => ({ matched: true, ruleId: "shell", ruleLabel: "运行验证", title: "运行验证", summary: String(item.arguments || "") }),
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

test("buildToolContextStats keeps recorded window for ratio sorting and columns", () => {
  const detail = {
    turns: [
      {
        items: [
          {
            type: "tool-call",
            name: "bash",
            arguments: "npm test",
            output: "ok",
            sourceIndex: 3,
          },
        ],
      },
      {
        items: [
          { type: "token-count", info: { context_usage: { percent: 5, used: 64000, limit: 128000 } } },
        ],
      },
    ],
  };
  const stats = api.buildToolContextStats(detail, "", "all", "", "context-share");
  assert.equal(stats.contextWindow, 128000);
  assert.equal(stats.groups.length, 1);
  assert.equal(stats.groups[0].contextWindowShare, 0.00234375);
});
