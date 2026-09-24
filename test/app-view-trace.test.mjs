import test from "node:test";
import assert from "node:assert/strict";

function fakeElement() {
  return {
    innerHTML: "",
    value: "",
    hidden: false,
    querySelectorAll: () => [],
    querySelector: () => null,
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
  prettyMaybeJson: (value) => (value == null ? "" : JSON.stringify(value, null, 2)),
  formatDate: () => "",
  renderMarkdownMessage: (text) => `<div class="markdown">${text}</div>`,
  openRawEvent: () => {},
  selectTraceNode: () => {},
  toggleTraceNode: () => {},
};

await import("../public/app-view-trace.js");

const api = globalThis.SessionWorkbench;

function skillTraceFixtureNodes() {
  return [
    {
      id: "item:0:1:skill-1",
      type: "skill",
      icon: "skill",
      label: "技能加载",
      title: "release-check",
      subtitle: "SKILL.md · 09-16 02:00",
      timestamp: "2026-07-08T10:00:00.500Z",
      completedAt: null,
      durationMs: null,
      durationEstimated: true,
      status: null,
      children: [],
      detail: {
        kind: "item",
        item: { type: "user-message", sourceIndex: 7, skillDeclaration: { name: "release-check", sourceFile: "SKILL.md", instruction: { text: "执行发布检查。" }, userText: { text: "检查当前分支。" } } },
        note: "Pi 会话持久化的 <skill> 指令块证据：该技能指令已随用户消息注入上下文。",
      },
    },
    {
      id: "item:0:2:call-skill",
      type: "tool",
      icon: "tool",
      label: "技能读取",
      title: "release-check/SKILL.md",
      status: "completed",
      timestamp: "2026-07-08T10:00:01.000Z",
      completedAt: "2026-07-08T10:00:02.000Z",
      durationMs: 1_000,
      children: [],
      detail: {
        kind: "item",
        item: { type: "tool-call", name: "read", status: "completed", arguments: '{ "path": "/skills/release-check/SKILL.md" }', skillRead: { sourceFile: "SKILL.md", skillNameHint: "release-check" } },
      },
    },
  ];
}

function traceFixture() {
  return {
    session: { title: "示例会话" },
    turns: [{
      items: [
        { type: "assistant-message", sourceIndex: 42, text: "这是完整的模型输出。\n\n包含第二段内容。", reasoning: { summary: "先确认关联的原始事件。", encrypted: true } },
        { type: "user-message", sourceIndex: 7, text: "<skill name=\"release-check\">执行发布检查。</skill>", skillDeclaration: { name: "release-check", sourceFile: "SKILL.md", instruction: "执行发布检查。", userText: "检查当前分支。" } },
        { type: "tool-call", name: "read", status: "completed", arguments: '{ "path": "/skills/release-check/SKILL.md" }', skillRead: { sourceFile: "SKILL.md", skillNameHint: "release-check" } },
      ],
    }],
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
              ...skillTraceFixtureNodes(),
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
                detail: {
                  kind: "item",
                  item: { type: "tool-call", name: "bash", status: "completed", arguments: "pwd", output: "/data" },
                  contextMetrics: { source: null, usage: null, resultTokens: 100, resultTokenKind: "estimated", changePercent: null },
                },
              },
              {
                id: "response:0:0",
                type: "response",
                label: "模型回复",
                title: "gpt-5",
                timestamp: "2026-07-08T10:00:05.000Z",
                completedAt: "2026-07-08T10:00:25.000Z",
                durationMs: 20_000,
                status: null,
                icon: "llm",
                children: [],
                detail: {
                  kind: "response",
                  response: { model: "gpt-5", generatedTokens: 120, inputTokens: 1_000, outputTokens: 80, reasoningTokens: 40, cacheReadTokens: 500, cacheWriteTokens: 20, totalTokens: 1_640, cost: 0.0123, contextPercent: 50, contextUsed: 50_000, contextLimit: 100_000, messageRef: { turnIndex: 0, itemIndex: 0, sourceIndex: 42, textLength: 18 }, thinkingRefs: [{ turnIndex: 0, itemIndex: 0, sourceIndex: 42, textLength: 11, encrypted: true }] },
                  contextMetrics: { source: "recorded", usage: { percent: 50, used: 50_000, limit: 100_000 }, resultTokens: 120, resultTokenKind: "recorded", changePercent: -2 },
                },
              },
              {
                id: "gap:turn:1:0",
                type: "gap",
                label: "其他时间",
                title: "事件写入与调度等未归因间隔",
                timestamp: "2026-07-08T10:00:30.000Z",
                durationMs: 6_000,
                status: null,
                icon: "gap",
                children: [],
                detail: { kind: "gap", note: "轮次执行时长减去已归因子项后的剩余间隔。" },
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
  assert.match(turnRow, /30s/);
  assert.doesNotMatch(turnRow, /估算/);
  assert.doesNotMatch(turnRow, /trace-status/);
  assert.doesNotMatch(turnRow, /执行中/);
});

test("轮次子项包含模型回复和其他时间且不展示状态", () => {
  const { row } = renderFixture();
  const responseRow = row("response:0:0");
  assert.match(responseRow, /模型回复/);
  assert.match(responseRow, /gpt-5/);
  assert.match(responseRow, /20s/);
  assert.match(responseRow, /返 120 tok/);
  assert.match(responseRow, /入 1K tok · 出 80 tok · 推理 40 tok · 缓存读 500 tok · 缓存写 20 tok · 总 1.6K tok · 成本 \$0.0123/);
  assert.match(responseRow, /上下文 50%（记录）/);
  assert.match(responseRow, /-2%/);
  assert.doesNotMatch(responseRow, /trace-status/);
  const gapRow = row("gap:turn:1:0");
  assert.match(gapRow, /其他时间/);
  assert.match(gapRow, /6s/);
  assert.doesNotMatch(gapRow, /trace-status/);
});

test("执行树默认展示技能加载节点和技能读取工具", () => {
  const { html, row } = renderFixture();
  const skillRow = row("item:0:1:skill-1");
  assert.match(skillRow, /技能加载/);
  assert.match(skillRow, /release-check/);
  assert.doesNotMatch(skillRow, /trace-duration/);
  assert.doesNotMatch(skillRow, /用户消息/);
  const skillReadRow = row("item:0:2:call-skill");
  assert.match(skillReadRow, /技能读取/);
  assert.match(skillReadRow, /release-check\/SKILL\.md/);
  assert.match(skillReadRow, /trace-duration/);
  assert.match(html, /legend-dot skill/);
});

test("执行视图提供文本导出操作", () => {
  const { html } = renderFixture();
  assert.match(html, /data-execution-export/);
  assert.match(html, /导出文本/);
});

test("技能加载详情面板展示指令、触发消息和原始事件入口", () => {
  api.state.detail = traceFixture();
  const skillNode = api.state.detail.trace.root.children[0].children.find((node) => node.type === "skill");
  api.renderToolDetails(skillNode);
  const detailsHtml = api.els.toolDetailsContent.innerHTML;
  assert.match(detailsHtml, /release-check/);
  assert.match(detailsHtml, /技能指令/);
  assert.match(detailsHtml, /执行发布检查。/);
  assert.match(detailsHtml, /触发消息/);
  assert.match(detailsHtml, /检查当前分支。/);
  assert.match(detailsHtml, /节点信息/);
  assert.match(detailsHtml, /data-response-raw-event-index="7"/);
});

test("技能加载筛选只保留技能声明与技能读取节点", () => {
  api.state.detail = traceFixture();
  const root = api.filterTraceNode(api.state.detail.trace.root, "", "skill");
  assert.ok(root);
  const turn = root.children[0];
  assert.deepEqual(turn.children.map((node) => node.type), ["skill", "tool"]);
  assert.equal(api.traceNodeMatchesType({ type: "skill" }, "skill"), true);
  assert.equal(api.traceNodeMatchesType({ type: "tool", detail: { item: { skillRead: {} } } }, "skill"), true);
  assert.equal(api.traceNodeMatchesType({ type: "response" }, "skill"), false);
});

test("模型回复详情面板展示回复信息", () => {
  api.state.detail = traceFixture();
  const responseNode = api.state.detail.trace.root.children[0].children.find((node) => node.type === "response");
  api.renderToolDetails(responseNode);
  const detailsHtml = api.els.toolDetailsContent.innerHTML;
  assert.match(detailsHtml, /节点信息/);
  assert.match(detailsHtml, /gpt-5/);
  assert.match(detailsHtml, /generatedTokens/);
  assert.match(detailsHtml, /模型输出/);
  assert.match(detailsHtml, /这是完整的模型输出/);
  assert.match(detailsHtml, /模型推理/);
  assert.match(detailsHtml, /先确认关联的原始事件/);
  assert.match(detailsHtml, /data-response-raw-event-index="42"/);
  assert.doesNotMatch(detailsHtml, /tool-details-status/);
});

test("执行树工具行继续展示状态和耗时", () => {
  const { row } = renderFixture();
  const toolRow = row("item:0:0:call-1");
  assert.match(toolRow, /trace-status status-success/);
  assert.match(toolRow, /执行成功/);
  assert.match(toolRow, /trace-duration/);
  assert.match(toolRow, /返 100 tok/);
  assert.doesNotMatch(toolRow, /上下文/);
  assert.match(toolRow, /估算返回 token/);
});

test("模型回复上下文不展示估算来源", () => {
  assert.equal(api.traceContextSourceLabel("recorded"), "记录");
  assert.match(api.renderTraceContextSummary({ source: "recorded", usage: { percent: 18.4, used: 50_000, limit: 272_000 } }), /上下文 18.4%（记录）/);
  assert.doesNotMatch(api.traceContextUsageTitle({ source: "recorded", usage: { percent: 18.4, used: 50_000, limit: 272_000 } }), /估算/);
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
  const toolNode = api.state.detail.trace.root.children[0].children.find((node) => node.id === "item:0:0:call-1");
  api.renderToolDetails(toolNode);
  assert.match(api.els.toolDetailsContent.innerHTML, /tool-details-status status-success/);
  assert.match(api.els.toolDetailsContent.innerHTML, /执行成功/);
  assert.match(api.els.toolDetailsContent.innerHTML, /返回指标/);
  assert.match(api.els.toolDetailsContent.innerHTML, /估算 100 tok/);
  assert.doesNotMatch(api.els.toolDetailsContent.innerHTML, /上下文/);
  assert.match(api.els.toolDetailsContent.innerHTML, /data-tool-raw-event-index="42"/);
});

test("工具详情明确标识 Pi 在运行时截断的 bash 返回结果", () => {
  const output = "最后一段内容\n\n[Showing lines 27-30 of 30 (50.0KB limit). Full output: /tmp/pi-bash-example.log]";
  assert.deepEqual(api.sourceOutputTruncation("bash", output), { toolName: "bash", limit: "50.0KB limit" });
  assert.equal(api.sourceOutputTruncation("bash", "完整输出"), null);

  api.renderToolDetails({
    id: "tool:truncated-bash",
    type: "tool",
    label: "工具调用",
    title: "bash",
    status: "completed",
    detail: {
      item: { type: "tool-call", name: "bash", status: "completed", sourceIndex: 12, outputSourceIndex: 13, output },
    },
  });
  assert.match(api.els.toolDetailsContent.innerHTML, /返回结果已在执行时按 50\.0KB limit 截断/);
  assert.match(api.els.toolDetailsContent.innerHTML, /不属于会话记录/);
  assert.match(api.els.toolDetailsContent.innerHTML, /data-tool-raw-event-index="13"/);
});
