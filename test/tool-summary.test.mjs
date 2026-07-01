import test from "node:test";
import assert from "node:assert/strict";
import "../public/tool-summary.js";

const { summarizeAuditNode, summarizeToolItem } = globalThis.ToolSummary;

test("default rules translate PowerShell UTF-8 raw reads", () => {
  const summary = summarizeToolItem({
    type: "tool-call",
    name: "exec_command",
    arguments: JSON.stringify({
      cmd: "Get-Content -Raw -Encoding UTF8 public\\app.js",
      workdir: "D:\\github\\codex-session-renderer",
    }),
  });

  assert.equal(summary.matched, true);
  assert.equal(summary.title, "读取文件内容");
  assert.equal(summary.summary, "public\\app.js");
});

test("audit evidence uses readable output summaries", () => {
  const node = {
    type: "evidence",
    title: "工具输出 · exec_command",
    toolName: "exec_command",
    summary: "const state = {};\nrenderAudit();",
    outputPreview: "const state = {};\nrenderAudit();",
    argumentsPreview: '{"cmd":"Get-Content -Raw -Encoding UTF8 public\\\\app.js"}',
  };
  const item = {
    type: "tool-call",
    name: "exec_command",
    arguments: '{"cmd":"Get-Content -Raw -Encoding UTF8 public\\\\app.js"}',
    output: "const state = {};\nrenderAudit();",
  };
  const summary = summarizeAuditNode(node, item);

  assert.equal(summary.title, "读取文件内容 · 输出");
  assert.match(summary.summary, /读取文件内容的输出 · 2 行/);
});

test("custom rules override defaults", () => {
  const summary = summarizeToolItem(
    {
      type: "tool-call",
      name: "exec_command",
      arguments: '{"cmd":"Get-Content -Raw -Encoding UTF8 README.md"}',
    },
    {
      customRules: [
        {
          id: "custom-read-doc",
          enabled: true,
          tool: "exec_command",
          pattern: "README\\.md",
          title: "读取项目说明",
          summary: "{path}",
        },
      ],
    },
  );

  assert.equal(summary.title, "读取项目说明");
  assert.equal(summary.summary, "README.md");
});
