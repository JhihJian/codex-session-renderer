import assert from "node:assert/strict";
import test from "node:test";
import { buildExecutionExport, producerOutputTruncated } from "../src/session-execution-export-projection.mjs";

const toolOutput = "敏感工具结果-DO-NOT-EXPORT-42\n[Showing lines 1-2 of 50 (50.0KB limit). Full output: /tmp/secret-output.log]";

function fixture() {
  return {
    session: { id: "session/one", title: "排查慢测试", status: "completed", model: "gpt-5" },
    stats: { turnCount: 1, eventCount: 4 },
    timing: {
      session: { durationMs: 12_000, durationKind: "estimated", waitingForInputMs: 0, waitingForInputCount: 0, coverageMs: 10_000, parallelism: { overlapMs: 0, peak: 1 }, llm: {} },
      buckets: [{ id: "llm_wait", coverageMs: 3_000 }, { id: "tool_execution", coverageMs: 7_000 }],
      quality: { estimatedCount: 1, partialCount: 0, unavailableCount: 0, notes: ["会话边界由首末有效事件推算"] },
    },
    turns: [{
      items: [
        { type: "user-message", text: "请排查运行慢。" },
        { type: "assistant-message", text: "我会先运行测试。" },
        { type: "reasoning", text: "先确认耗时集中在哪个工具。" },
        { type: "tool-call", name: "bash", status: "completed", arguments: "npm test", output: toolOutput },
      ],
    }],
    trace: {
      root: {
        id: "thread:one",
        type: "thread",
        label: "根会话",
        title: "排查慢测试",
        timestamp: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:12.000Z",
        durationMs: 12_000,
        durationEstimated: true,
        status: "completed",
        detail: {},
        children: [{
          id: "turn:one:0",
          index: 0,
          type: "turn",
          label: "第 1 轮",
          title: "请排查运行慢。",
          timestamp: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:00:12.000Z",
          durationMs: 12_000,
          durationEstimated: true,
          status: "completed",
          detail: {},
          children: [{
            id: "item:0:3:call",
            type: "tool",
            label: "工具调用",
            title: "bash",
            timestamp: "2026-01-01T00:00:02.000Z",
            completedAt: "2026-01-01T00:00:09.000Z",
            durationMs: 7_000,
            durationEstimated: false,
            status: "completed",
            detail: { item: { type: "tool-call", name: "bash", callId: "call-1", status: "completed", arguments: "npm test", output: toolOutput } },
            children: [],
          }, {
            id: "response:0:0",
            type: "response",
            label: "模型回复",
            title: "gpt-5",
            timestamp: "2026-01-01T00:00:09.000Z",
            completedAt: "2026-01-01T00:00:12.000Z",
            durationMs: 3_000,
            durationEstimated: true,
            status: null,
            detail: { response: { generatedTokens: 240, inputTokens: 1_000, outputTokens: 80, reasoningTokens: 160, contextPercent: 32 } },
            children: [],
          }],
        }],
      },
    },
  };
}

test("执行文本导出保留诊断过程且完全省略工具输出正文", () => {
  const exported = buildExecutionExport(fixture());
  assert.match(exported, /执行诊断记录/);
  assert.match(exported, /请排查运行慢。/);
  assert.match(exported, /npm test/);
  assert.match(exported, /模型回复：gpt-5/);
  assert.match(exported, new RegExp(`已持久化 ${Buffer.byteLength(toolOutput, "utf8")} UTF-8 字节`));
  assert.match(exported, /来源侧已截断，完整大小未知/);
  assert.doesNotMatch(exported, /敏感工具结果-DO-NOT-EXPORT-42/);
  assert.doesNotMatch(exported, /\/tmp\/secret-output\.log/);
  assert.doesNotMatch(exported, /sourceIndex|outputSourceIndex|"output"/);
});

test("工具输出大小按 UTF-8 字节而不是 JavaScript 字符数计算", () => {
  const detail = fixture();
  const output = "A你😀";
  detail.turns[0].items[3].output = output;
  detail.trace.root.children[0].children[0].detail.item.output = output;
  const exported = buildExecutionExport(detail);
  assert.match(exported, /已持久化 8 UTF-8 字节/);
  assert.doesNotMatch(exported, /A你😀/);
});

test("来源截断检测不读取截断标记引用的临时文件", () => {
  assert.equal(producerOutputTruncated(toolOutput), true);
  assert.equal(producerOutputTruncated("普通输出"), false);
});