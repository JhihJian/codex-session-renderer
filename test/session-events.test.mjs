import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTurns,
  compactTurnsForClient,
  extractTitleFromEvents,
  findSubagentNotifications,
  renderConversationMarkdown,
  summarizeEventPreview,
} from "../src/session-events.mjs";

test("buildTurns keeps visible behavior while deduplicating response echoes", () => {
  const events = [
    {
      type: "event_msg",
      timestamp: "2026-06-24T10:00:00.000Z",
      payload: { type: "task_started", turn_id: "turn-1" },
    },
    {
      type: "event_msg",
      timestamp: "2026-06-24T10:00:01.000Z",
      payload: { type: "user_message", message: "请列出会话" },
    },
    {
      type: "response_item",
      timestamp: "2026-06-24T10:00:02.000Z",
      payload: { type: "message", role: "user", content: [{ type: "input_text", text: "请列出会话" }] },
    },
    {
      type: "response_item",
      timestamp: "2026-06-24T10:00:03.000Z",
      payload: { type: "function_call", name: "list_sessions", call_id: "call-1", arguments: "{\"limit\":2}" },
    },
    {
      type: "response_item",
      timestamp: "2026-06-24T10:00:04.000Z",
      payload: { type: "function_call_output", call_id: "call-1", output: "found 2" },
    },
    {
      type: "event_msg",
      timestamp: "2026-06-24T10:00:05.000Z",
      payload: { type: "agent_message", message: "找到 2 个会话。" },
    },
    {
      type: "event_msg",
      timestamp: "2026-06-24T10:00:06.000Z",
      payload: { type: "task_complete", last_agent_message: "找到 2 个会话。" },
    },
  ];

  const turns = buildTurns(events);

  assert.equal(turns.length, 1);
  assert.equal(turns[0].status, "completed");
  assert.deepEqual(
    turns[0].items.map((item) => item.type),
    ["user-message", "tool-call", "assistant-message"],
  );
  assert.equal(turns[0].items[1].name, "list_sessions");
  assert.equal(turns[0].items[1].output, "found 2");
});

test("event summaries and markdown export keep diagnostics readable", () => {
  const events = [
    {
      type: "response_item",
      payload: { type: "message", role: "user", content: [{ text: "第一行\n第二行" }] },
    },
    {
      type: "event_msg",
      payload: { type: "agent_message", message: "完成处理" },
    },
  ];
  const turns = buildTurns(events);
  const markdown = renderConversationMarkdown(
    {
      id: "thread-1",
      title: "测试会话",
      cwd: "D:\\github\\codex-session-renderer",
      startedAt: "2026-06-24T10:00:00.000Z",
    },
    turns,
  );

  assert.equal(extractTitleFromEvents(events, "fallback"), "第一行 第二行");
  assert.equal(summarizeEventPreview(events[0]), "第一行 第二行");
  assert.match(markdown, /^# 测试会话/m);
  assert.match(markdown, /### 用户/);
  assert.match(markdown, /### 助手/);
});

test("findSubagentNotifications inspects payload even when preview omits child id", () => {
  const childId = "019efa76-515d-7ef3-a544-8b13547c0ddb";
  const events = [
    {
      timestamp: "2026-06-24T10:00:00.000Z",
      preview: "subagent_notification finished",
      payload: {
        type: "subagent_notification",
        agent_path: childId,
        status: { completed: "完成" },
      },
    },
  ];

  const notifications = findSubagentNotifications(events, new Map([[childId, { childThreadId: childId }]]));

  assert.equal(notifications.get(childId), events[0]);
});

test("compactTurnsForClient keeps tool output complete for reading view", () => {
  const longOutput = "output-line\n" + "x".repeat(1200);
  const events = [
    {
      type: "event_msg",
      timestamp: "2026-06-24T10:00:00.000Z",
      payload: { type: "task_started", turn_id: "turn-1" },
    },
    {
      type: "response_item",
      timestamp: "2026-06-24T10:00:01.000Z",
      payload: { type: "function_call", name: "run_check", call_id: "call-1", arguments: "{\"cmd\":\"check\"}" },
    },
    {
      type: "response_item",
      timestamp: "2026-06-24T10:00:02.000Z",
      payload: { type: "function_call_output", call_id: "call-1", output: longOutput },
    },
  ];

  const compactTurns = compactTurnsForClient(buildTurns(events));
  const item = compactTurns[0].items[0];

  assert.equal(item.output, longOutput);
  assert.equal(item.outputLength, longOutput.length);
  assert.equal(item.truncated, undefined);
  assert.equal(item.truncatedFields, undefined);
});

test("buildTurns uses normalized field drift and coalesces assistant deltas", () => {
  const events = [
    { type: "user", time: 1782790557, content: "请总结" },
    { type: "assistant", message_id: "msg-1", delta: true, content: [{ text: "第一" }] },
    { type: "assistant", message_id: "msg-1", delta: true, content: [{ text: "第二" }] },
    { type: "function_call", call_id: "call-1", function: { name: "run_check", arguments: "{\"cmd\":\"npm test\"}" } },
    { type: "function_result", call_id: "call-1", stdout: "ok" },
  ];

  const turns = buildTurns(events);

  assert.equal(turns.length, 1);
  assert.deepEqual(
    turns[0].items.map((item) => item.type),
    ["user-message", "assistant-message", "tool-call"],
  );
  assert.equal(turns[0].items[0].text, "请总结");
  assert.equal(turns[0].items[1].text, "第一第二");
  assert.equal(turns[0].items[2].name, "run_check");
  assert.equal(turns[0].items[2].output, "ok");
});

test("compactTurnsForClient exposes attachment summary without inline data", () => {
  const dataUri = "data:image/png;base64," + Buffer.from("abc").toString("base64");
  const turns = buildTurns([
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ text: "图片" }, { type: "input_image", image_url: { url: dataUri } }],
      },
    },
  ]);

  const compact = compactTurnsForClient(turns);

  assert.equal(compact[0].items[0].attachments[0].kind, "inline");
  assert.equal(compact[0].items[0].attachments[0].redacted, true);
  assert.equal(JSON.stringify(compact).includes(dataUri), false);
});

test("buildTurns keeps image-only messages as attachment evidence", () => {
  const turns = buildTurns([
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_image", image_url: { url: "https://example.invalid/only-image.png" } }],
      },
    },
  ]);

  assert.equal(turns.length, 1);
  assert.equal(turns[0].items.length, 1);
  assert.equal(turns[0].items[0].type, "user-message");
  assert.equal(turns[0].items[0].text, "");
  assert.equal(turns[0].items[0].attachments[0].kind, "url");
});
