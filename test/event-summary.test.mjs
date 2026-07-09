import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyEvent,
  extractTitleFromEvents,
  isImportantEvent,
  summarizeEventPreview,
  summarizeEventTitle,
  summarizeSessionEvents,
} from "../src/event-summary.mjs";

test("event summary helpers classify and title common Codex events", () => {
  const events = [
    { type: "session_meta", payload: { role: "system" } },
    { type: "event_msg", payload: { type: "user_message", message: "用户输入" } },
    { type: "response_item", payload: { type: "function_call", name: "list_sessions", arguments: "{}" } },
  ];

  assert.equal(classifyEvent(events[0]), "meta");
  assert.equal(classifyEvent(events[1]), "user_message");
  assert.equal(isImportantEvent(events[2]), true);
  assert.equal(summarizeEventTitle(events[0]), "会话元信息");
  assert.equal(summarizeEventTitle(events[1]), "用户消息");
  assert.equal(summarizeEventTitle(events[2]), "调用工具：list_sessions");
  assert.deepEqual(summarizeSessionEvents(events), {
    counts: { meta: 1, user_message: 1, function_call: 1 },
    roles: { system: 1 },
  });
});

test("event summary helpers extract readable text from mixed payloads", () => {
  const events = [
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "第一行\n第二行" }],
      },
    },
    { type: "event_msg", payload: { type: "mcp_tool_call_end", invocation: { server: "fs", tool: "read" } } },
  ];

  assert.equal(extractTitleFromEvents(events, "fallback"), "第一行 第二行");
  assert.equal(summarizeEventPreview(events[0]), "第一行 第二行");
  assert.equal(summarizeEventTitle(events[0]), "用户消息");
  assert.equal(summarizeEventTitle(events[1]), "工具输出：fs.read");
});

test("event summary helpers mark context compaction as important", () => {
  const compacted = {
    type: "compacted",
    timestamp: "2026-07-08T03:24:06.920Z",
    payload: {
      message: "压缩后的关键结论",
      replacement_history: [{ type: "message" }],
      window_number: 2,
    },
  };
  const complete = { type: "event_msg", payload: { type: "context_compacted" } };

  assert.equal(classifyEvent(compacted), "compacted");
  assert.equal(isImportantEvent(compacted), true);
  assert.equal(summarizeEventTitle(compacted), "上下文已压缩");
  assert.match(summarizeEventPreview(compacted), /压缩摘要/);
  assert.equal(isImportantEvent(complete), true);
  assert.equal(summarizeEventTitle(complete), "上下文压缩完成");
});

test("event summary titles localize raw fallback labels without changing source fields", () => {
  assert.equal(
    summarizeEventTitle({
      type: "jsonl_parse_error",
      __jsonlDiagnostic: true,
      payload: { type: "jsonl_parse_error", lineNumber: 7, preview: "{bad json" },
    }),
    "事件解析失败",
  );
  assert.equal(summarizeEventTitle({ type: "turn_context", payload: { turn_id: "turn-1" } }), "轮次上下文：turn-1");
  assert.equal(summarizeEventTitle({ type: "response_item", payload: { type: "opaque_item" } }), "响应项：opaque_item");
});
