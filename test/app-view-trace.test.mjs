import test from "node:test";
import assert from "node:assert/strict";

function fakeElement() {
  return {
    innerHTML: "",
    value: "",
    hidden: false,
    querySelectorAll: () => [],
  };
}

globalThis.window = globalThis;
globalThis.SessionWorkbench = {
  state: { detail: null, expandedTraceNodeIds: new Set(), selectedTraceNodeId: null },
  els: { traceContent: fakeElement(), itemSearch: fakeElement(), itemTypeFilter: fakeElement(), toolDetailsContent: fakeElement() },
  emptyState: (title) => `<div class="empty">${title}</div>`,
  maxNodeDuration: () => 0,
  escapeHtml: (value) => String(value ?? ""),
  escapeAttr: (value) => String(value ?? ""),
  formatDuration: (ms) => (ms == null ? "" : `${Math.round(ms / 1000)}s`),
  firstLine: (text) => String(text ?? "").split("\n")[0],
  traceIcon: () => "T",
  readableToolItem: () => ({ matched: false, title: "" }),
  prettyMaybeJson: (value) => String(value ?? ""),
  formatDate: () => "",
  selectTraceNode: () => {},
  toggleTraceNode: () => {},
};

await import("../public/app-view-trace.js");

const api = globalThis.SessionWorkbench;

function traceFixture() {
  return {
    session: { title: "示例会话" },
    turns: [],
    trace: {
      timing: { durationMs: 60_000 },
      root: {
        id: "thread:1",
        type: "thread",
        label: "根会话",
        title: "示例会话",
        status: "running",
        durationMs: 60_000,
        timestamp: "2026-07-08T10:00:00.000Z",
        children: [
          {
            id: "turn:1:0",
            type: "turn",
            label: "第 1 轮",
            title: "示例任务",
            status: "running",
            timestamp: "2026-07-08T10:00:00.000Z",
            completedAt: "2026-07-08T10:00:30.000Z",
            durationMs: 30_000,
            durationEstimated: true,
            children: [
              {
                id: "item:0:0:call-1",
                type: "tool",
                label: "工具调用",
                title: "bash",
                status: "completed",
                timestamp: "2026-07-08T10:00:01.000Z",
                completedAt: "2026-07-08T10:00:05.000Z",
                durationMs: 4_000,
                children: [],
                detail: { kind: "item", item: { type: "tool-call", name: "bash", status: "completed", arguments: "pwd", output: "/data" } },
              },
            ],
          },
        ],
      },
    },
  };
}

function renderFixture() {
  api.state.detail = traceFixture();
  api.state.expandedTraceNodeIds = new Set(["thread:1", "turn:1:0"]);
  api.state.selectedTraceNodeId = null;
  api.els.itemSearch.value = "";
  api.els.itemTypeFilter.value = "all";
  api.renderTrace();
  const html = api.els.traceContent.innerHTML;
  const row = (id) => {
    const start = html.indexOf(`data-trace-node-id="${id}"`);
    assert.ok(start >= 0, `row ${id} missing`);
    return html.slice(start, html.indexOf("</button>", start));
  };
  return { html, row };
}

test("执行树轮次行展示执行耗时而不是状态", () => {
  const { row } = renderFixture();
  const turnRow = row("turn:1:0");
  assert.match(turnRow, /trace-duration/);
  assert.match(turnRow, /30s · 估算/);
  assert.doesNotMatch(turnRow, /trace-status/);
  assert.doesNotMatch(turnRow, /执行中/);
});

test("执行树工具行继续展示状态和耗时", () => {
  const { row } = renderFixture();
  const toolRow = row("item:0:0:call-1");
  assert.match(toolRow, /trace-status status-success/);
  assert.match(toolRow, /执行成功/);
  assert.match(toolRow, /trace-duration/);
});

test("轮次详情面板不再展示生命周期状态", () => {
  api.state.detail = traceFixture();
  const turnNode = api.state.detail.trace.root.children[0];
  api.renderToolDetails(turnNode);
  assert.doesNotMatch(api.els.toolDetailsContent.innerHTML, /tool-details-status/);
  assert.doesNotMatch(api.els.toolDetailsContent.innerHTML, /执行中/);
  assert.match(api.els.toolDetailsContent.innerHTML, /30s/);
});

test("工具详情面板继续展示状态", () => {
  api.state.detail = traceFixture();
  const toolNode = api.state.detail.trace.root.children[0].children[0];
  api.renderToolDetails(toolNode);
  assert.match(api.els.toolDetailsContent.innerHTML, /tool-details-status status-success/);
  assert.match(api.els.toolDetailsContent.innerHTML, /执行成功/);
});
