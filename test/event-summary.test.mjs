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
  assert.equal(summarizeEventTitle(events[2]), "Call list_sessions");
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
  assert.equal(summarizeEventTitle(events[1]), "Output fs.read");
});
