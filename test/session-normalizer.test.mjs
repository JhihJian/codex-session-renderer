import test from "node:test";
import assert from "node:assert/strict";
import {
  coalesceNormalizedEvents,
  normalizeSessionEvent,
  redactSensitiveText,
  safeStringifyRedacted,
} from "../src/session-normalizer.mjs";

test("normalizeSessionEvent absorbs field drift for time, text and tool fields", () => {
  const event = {
    role: "assistant",
    ts: 1782790557000000,
    message_id: "msg-1",
    content: [{ type: "output_text", text: "处理完成" }, { value: "第二段" }],
    function: { name: "search_repo", arguments: { q: "README" } },
    type: "function_call",
  };

  const normalized = normalizeSessionEvent(event, 7);

  assert.equal(normalized.index, 7);
  assert.equal(normalized.timestamp, "2026-06-30T03:35:57.000Z");
  assert.equal(normalized.kind, "function_call");
  assert.equal(normalized.semanticKind, "tool_call");
  assert.equal(normalized.messageId, "msg-1");
  assert.equal(normalized.toolName, "search_repo");
  assert.equal(normalized.toolInput, JSON.stringify({ q: "README" }, null, 2));
  assert.match(normalized.text, /处理完成/);
});

test("normalizer maps function_result to tool result and preserves output precedence", () => {
  const normalized = normalizeSessionEvent({
    type: "function_result",
    function: { name: "run" },
    stdout: "stdout text",
    stderr: "stderr text",
    output: "less preferred",
  });

  assert.equal(normalized.kind, "function_call_output");
  assert.equal(normalized.semanticKind, "tool_result");
  assert.equal(normalized.toolName, "run");
  assert.equal(normalized.toolOutput, "stdout text\nstderr text");
});

test("coalesceNormalizedEvents joins streamed message delta chunks by message id", () => {
  const events = [
    { type: "assistant", message_id: "msg-1", delta: true, content: [{ text: "第一段" }] },
    { type: "assistant", message_id: "msg-1", delta: true, content: [{ text: "第二段" }] },
    { type: "assistant", message_id: "msg-2", delta: true, content: [{ text: "另一个消息" }] },
  ];

  const coalesced = coalesceNormalizedEvents(events);

  assert.equal(coalesced.length, 2);
  assert.equal(coalesced[0].text, "第一段第二段");
  assert.deepEqual(coalesced[0].sourceIndexes, [0, 1]);
  assert.equal(coalesced[1].text, "另一个消息");
});

test("image references are summarized without retaining inline data in search text", () => {
  const dataUri = "data:image/png;base64," + Buffer.from("fake image bytes").toString("base64");
  const event = {
    type: "response_item",
    payload: {
      type: "message",
      role: "user",
      content: [
        { type: "input_text", text: "看图" },
        { type: "input_image", image_url: { url: dataUri } },
        { type: "input_image", image_url: { url: "https://example.invalid/image.png" } },
      ],
    },
  };

  const normalized = normalizeSessionEvent(event);

  assert.equal(normalized.attachments.length, 2);
  assert.equal(normalized.attachments[0].kind, "inline");
  assert.equal(normalized.attachments[0].mediaType, "image/png");
  assert.equal(normalized.attachments[0].redacted, true);
  assert.equal(normalized.attachments[1].kind, "url");
  assert.doesNotMatch(normalized.searchText, /ZmFrZSBpbWFnZSBieXRlcw/);
  assert.match(normalized.searchText, /inline image\/png/);
});

test("encrypted reasoning is opaque and redacted from search-oriented text", () => {
  const event = {
    type: "response_item",
    payload: {
      type: "reasoning",
      encrypted_content: "AAECAwQFBgcICQoL",
      summary: [{ text: "公开摘要" }],
    },
  };

  const normalized = normalizeSessionEvent(event);

  assert.equal(normalized.semanticKind, "reasoning");
  assert.equal(normalized.reasoning.encrypted, true);
  assert.equal(normalized.reasoning.encryptedLength, 16);
  assert.equal(normalized.reasoning.summary, "公开摘要");
  assert.doesNotMatch(normalized.searchText, /AAECAwQ/);
  assert.match(safeStringifyRedacted(event), /\[encrypted_content redacted length=16\]/);
});

test("redactSensitiveText replaces data URIs with bounded markers", () => {
  const text = redactSensitiveText("prefix data:image/png;base64,QUJDRA== suffix");

  assert.equal(text, "prefix [redacted data URI image/png ~4 bytes] suffix");
});
