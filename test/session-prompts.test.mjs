import test from "node:test";
import assert from "node:assert/strict";
import { buildPromptArchiveEntry, extractFirstPrompt, promptProjectKey } from "../src/session-prompts.mjs";

test("extractFirstPrompt keeps the first real user task and its source anchor", () => {
  const prompt = extractFirstPrompt([
    { type: "session_meta", payload: { cwd: "/work/app" } },
    {
      type: "event_msg",
      payload: {
        type: "user_message",
        message: "AGENTS.md instructions\n<environment_context>machine</environment_context>\n\n## My request for Codex:\n请整理首个任务",
      },
    },
    { type: "event_msg", payload: { type: "agent_message", message: "开始处理" } },
    { type: "event_msg", payload: { type: "user_message", message: "后续补充" } },
  ]);

  assert.equal(prompt.state, "found");
  assert.equal(prompt.text, "请整理首个任务");
  assert.equal(prompt.sourceIndex, 1);
  assert.equal(prompt.turnId, "turn-1");
});

test("extractFirstPrompt keeps a Pi goal-like short user message in the bounded JSONL prefix", () => {
  const prompt = extractFirstPrompt([
    { type: "session", id: "pi-session", cwd: "/work/pi" },
    { type: "session_info", id: "pi-info", name: "Pi 会话标题" },
    {
      type: "message",
      id: "pi-machine",
      parentId: "pi-info",
      message: { role: "user", content: [{ type: "text", text: "Continue working toward the active thread goal" }] },
    },
    {
      type: "message",
      id: "pi-user",
      parentId: "pi-machine",
      timestamp: "2026-07-18T10:00:00.000Z",
      message: { role: "user", content: [{ type: "text", text: "提取 Pi 会话前缀任务" }] },
    },
  ]);

  assert.equal(prompt.state, "found");
  assert.equal(prompt.text, "Continue working toward the active thread goal");
  assert.equal(prompt.sourceIndex, 2);
});

test("extractFirstPrompt does not use compact replacement history as a new prompt", () => {
  const prompt = extractFirstPrompt([
    { type: "compacted", payload: { message: "压缩摘要", replacement_history: [{ role: "user", content: [{ text: "旧任务" }] }] } },
    { type: "context_compacted", payload: {} },
  ]);

  assert.equal(prompt.state, "empty");
  assert.equal(prompt.text, null);
});

test("extractFirstPrompt marks invalid JSONL diagnostics as a read failure when no prompt is available", () => {
  const prompt = extractFirstPrompt([{ __jsonlDiagnostic: true, payload: { code: "invalid-json" } }]);

  assert.equal(prompt.state, "error");
  assert.equal(prompt.text, null);
});

test("extractFirstPrompt preserves safe image-only attachment evidence", () => {
  const dataUri = "data:image/png;base64,YWJj";
  const prompt = extractFirstPrompt([
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_image", image_url: { url: dataUri } }],
      },
    },
  ]);

  assert.equal(prompt.state, "image-only");
  assert.equal(prompt.text, null);
  assert.equal(prompt.attachments[0].redacted, true);
  assert.equal(JSON.stringify(prompt).includes(dataUri), false);
});

test("buildPromptArchiveEntry keeps source/session identity and project grouping separate", () => {
  const entry = buildPromptArchiveEntry(
    {
      id: "session-1",
      sourceId: "remote-a",
      sourceLabel: "远端 A",
      title: "标题",
      cwd: "D:\\work\\App\\",
      updatedAt: "2026-07-17T10:00:00.000Z",
      path: "D:\\work\\App\\session.jsonl",
    },
    { state: "found", text: "完整任务", preview: "完整任务", sourceIndex: 3 },
  );

  assert.equal(entry.id, "remote-a:session-1");
  assert.equal(entry.projectKey, "remote-a:d:/work/app");
  assert.equal(entry.projectLabel, "D:\\work\\App\\");
  assert.equal(entry.promptText, "完整任务");
  assert.equal(promptProjectKey("D:\\work\\App\\"), "d:/work/app");
});

test("buildPromptArchiveEntry preserves the full canonical title when the prompt is readable", () => {
  const title = `归档标题 ${"x".repeat(500)} 后段标记`;
  const entry = buildPromptArchiveEntry({ id: "session-1", sourceId: "local", title }, { state: "found", text: "任务" });
  assert.equal(entry.sessionTitle, title);
});

test("buildPromptArchiveEntry hides user-derived titles for bounded archive states", () => {
  const entry = buildPromptArchiveEntry(
    { id: "session-1", sourceId: "local", title: "这是不应在超限结果中返回的用户正文" },
    { state: "too_large", limitReason: "prompt_too_long" },
  );
  assert.equal(entry.sessionTitle, "未命名会话");
  assert.equal(entry.promptText, null);
});

test("buildPromptArchiveEntry hides a large-file title even when its bounded prefix has a task", () => {
  const entry = buildPromptArchiveEntry(
    { id: "session-1", sourceId: "pi-agent", title: "不应从前缀外索引返回的标题" },
    { state: "found", text: "前缀内有效任务", preview: "前缀内有效任务" },
    { hideSessionTitle: true },
  );
  assert.equal(entry.sessionTitle, "未命名会话");
  assert.equal(entry.promptText, "前缀内有效任务");
});