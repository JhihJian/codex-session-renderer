import test from "node:test";
import assert from "node:assert/strict";
import {
  isStandaloneToolEvent,
  mergeToolOutput,
  renderMcpResult,
  toolArgumentsFromPayload,
  toolNameFromPayload,
  toolOutputFromPayload,
} from "../src/tool-events.mjs";

test("tool event helpers normalize names, arguments and output", () => {
  assert.equal(toolNameFromPayload({ invocation: { server: "fs", tool: "read" } }), "fs.read");
  assert.equal(toolNameFromPayload({ type: "patch_apply_end" }), "apply_patch");
  assert.equal(toolArgumentsFromPayload({ invocation: { arguments: { file: "README.md" } } }), '{\n  "file": "README.md"\n}');
  assert.equal(toolOutputFromPayload({ stdout: "ok", stderr: "warn" }), "ok\nwarn");
  assert.equal(toolOutputFromPayload({ success: false }), "Failed");
  assert.equal(isStandaloneToolEvent("custom_tool_call_output"), true);
});

test("tool event helpers render MCP results and merge duplicate output", () => {
  assert.equal(renderMcpResult({ Ok: { content: [{ text: "one" }, { text: "two" }] } }), "one\n\ntwo");
  assert.equal(renderMcpResult({ Err: { message: "bad" } }), '{\n  "message": "bad"\n}');
  assert.equal(mergeToolOutput("abc", "abc"), "abc");
  assert.equal(mergeToolOutput("abc", "abcdef"), "abcdef");
  assert.equal(mergeToolOutput("abc", "def"), "abc\n\ndef");
});
