import test from "node:test";
import assert from "node:assert/strict";
import { adaptSessionEvent, sessionMetadataFromEvents } from "../src/session-format-adapters/adapter-registry.mjs";
import { readSpecialSessionFixture } from "./helpers/special-fixtures.mjs";

test("Claude Code adapter preserves message content, lineage and embedded tool records", async () => {
  const events = await readSpecialSessionFixture("claude-code-sdk-cli.jsonl");
  const user = adaptSessionEvent(events[1]);
  const assistant = adaptSessionEvent(events[2]);
  const results = adaptSessionEvent(events[3]);

  assert.equal(user.format, "claude-code");
  assert.equal(user.payload.content, "请检查项目。");
  assert.equal(user.messageId, "11111111-1111-4111-8111-111111111111");
  assert.equal(user.parentId, null);
  assert.equal(assistant.payload.role, "assistant");
  assert.deepEqual(assistant.toolCalls, [
    { callId: "call-read", name: "Read", arguments: JSON.stringify({ file_path: "README.md" }, null, 2) },
    { callId: "call-list", name: "Bash", arguments: JSON.stringify({ command: "rg --files" }, null, 2) },
  ]);
  assert.equal(results.payload.type, "function_call_output");
  assert.equal(results.payload.role, "tool");
  assert.deepEqual(results.toolResults, [
    { callId: "call-read", output: "# README", success: true },
    { callId: "call-list", output: "README.md\nsrc/app.mjs", success: false },
  ]);
});

test("Claude Code adapter extracts session metadata without changing source identity", async () => {
  const events = await readSpecialSessionFixture("claude-code-sdk-cli.jsonl");

  assert.deepEqual(sessionMetadataFromEvents(events), {
    cwd: "/workspace/project",
    model: "claude-test",
    timestamp: "2026-09-28T18:31:46.911Z",
    originator: "claude_code",
    source: "claude-code",
  });
});