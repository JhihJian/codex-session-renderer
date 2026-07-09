import test from "node:test";
import assert from "node:assert/strict";
import "../public/tool-summary.js";

const { commandOutputModel, patchBodyModel, summarizeAuditNode, summarizeToolItem, validateRulesForSave } = globalThis.ToolSummary;

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

test("custom summary rules validate required fields and regexp syntax before saving", () => {
  const errors = validateRulesForSave([
    {
      id: "bad",
      enabled: true,
      tool: "/exec(command/",
      pattern: "(",
      title: "",
      summary: "{cmd}",
    },
  ]);

  assert.equal(errors.some((error) => error.field === "title"), true);
  assert.equal(errors.some((error) => error.field === "tool"), true);
  assert.equal(errors.some((error) => error.field === "pattern"), true);
});

test("custom summary rules accept slash regexp syntax with flags", () => {
  const errors = validateRulesForSave([
    {
      id: "good",
      enabled: true,
      tool: "/exec_.+/i",
      pattern: "/README\\.md/m",
      title: "读取项目说明",
      summary: "{path}",
    },
  ]);

  assert.deepEqual(errors, []);
});

test("apply_patch summaries include file-level diff stats", () => {
  const summary = summarizeToolItem({
    type: "tool-call",
    name: "apply_patch",
    arguments: `*** Begin Patch
*** Update File: public/app.js
@@
-oldLine();
+newLine();
+nextLine();
*** Add File: docs/changes.md
+# 变更说明
*** End Patch`,
    output: "Success. Updated the following files:\nM public/app.js\nA docs/changes.md",
  });

  assert.equal(summary.title, "修改文件");
  assert.equal(summary.summary, "2 个文件 · +3 -1 · public/app.js, docs/changes.md");
  assert.equal(summary.changeSet.fileCount, 2);
  assert.equal(summary.changeSet.additions, 3);
  assert.equal(summary.changeSet.deletions, 1);
  assert.deepEqual(
    summary.changeSet.files.map((file) => [file.path, file.status, file.additions, file.deletions]),
    [
      ["public/app.js", "modified", 2, 1],
      ["docs/changes.md", "added", 1, 0],
    ],
  );
});

test("apply_patch summaries fall back to output file status lines", () => {
  const summary = summarizeToolItem({
    type: "tool-call",
    name: "apply_patch",
    arguments: "",
    output: "Success. Updated the following files:\nM README.md",
  });

  assert.equal(summary.title, "修改文件");
  assert.equal(summary.summary, "1 个文件 · README.md");
  assert.equal(summary.changeSet.files[0].status, "modified");
});

test("patch body model preserves apply_patch file hunks and line kinds", () => {
  const model = patchBodyModel(`apply_patch
*** Begin Patch
*** Update File: D:\\github\\codex-session-renderer\\public\\app.js
@@
   if (lines.length <= 1) {
-      lead: firstLine(parts.shift() || raw, 220),
+      lead: parts.shift() || raw,
   }
*** Update File: D:\\github\\codex-session-renderer\\public\\styles.css
@@
-.review-summary-text {
+.review-summary-text.patch {
*** End Patch`);

  assert.equal(model.command, "apply_patch");
  assert.equal(model.fileCount, 2);
  assert.equal(model.additions, 2);
  assert.equal(model.deletions, 2);
  assert.equal(model.files[0].status, "modified");
  assert.equal(model.files[0].path, "D:\\github\\codex-session-renderer\\public\\app.js");
  assert.deepEqual(
    model.files[0].lines.map((line) => line.kind),
    ["hunk", "context", "removed", "added", "context"],
  );
});

test("command output model summarizes git status files", () => {
  const model = commandOutputModel("M public/app.js\n?? docs/notes.md", {
    toolName: "exec_command",
    arguments: '{"cmd":"git status --short"}',
  });

  assert.equal(model.category, "git_status");
  assert.equal(model.status, "changed");
  assert.equal(model.summary, "2 个变更文件");
  assert.deepEqual(
    model.sections[0].items.map((item) => [item.label, item.path]),
    [
      ["修改", "public/app.js"],
      ["未跟踪", "docs/notes.md"],
    ],
  );
});

test("command output model groups search matches", () => {
  const model = commandOutputModel("public/app.js:12:function renderReviewSummary(context) {\npublic/tool-summary.js:88:  summary: \"{query}\"", {
    toolName: "exec_command",
    arguments: '{"cmd":"rg -n \\"renderReviewSummary|summary\\" public"}',
  });

  assert.equal(model.category, "search");
  assert.equal(model.status, "found");
  assert.equal(model.metrics[0].value, "2");
  assert.equal(model.sections[0].items[0].path, "public/app.js");
  assert.equal(model.sections[0].items[0].label, ":12");
});

test("command output model recognizes node test summaries", () => {
  const model = commandOutputModel(`# tests 91
# pass 91
# fail 0
# duration_ms 1059.4
Process exited with code 0`, {
    toolName: "exec_command",
    arguments: '{"cmd":"npm test"}',
  });

  assert.equal(model.category, "verification");
  assert.equal(model.status, "passed");
  assert.match(model.summary, /验证通过/);
  assert.deepEqual(
    model.metrics.slice(0, 4).map((metric) => [metric.label, metric.value]),
    [
      ["退出码", "0"],
      ["测试", "91"],
      ["通过", "91"],
      ["失败", "0"],
    ],
  );
});

test("command output model does not treat successful test names as failures", () => {
  const model = commandOutputModel(`✔ remote snapshot refresh publishes current atomically and keeps previous snapshot after failure (35.4285ms)
ℹ tests 90
ℹ pass 90
ℹ fail 0
Process exited with code 0`, {
    toolName: "exec_command",
    arguments: '{"cmd":"npm test"}',
  });

  assert.equal(model.category, "verification");
  assert.equal(model.status, "passed");
  assert.match(model.summary, /90 tests/);
  assert.equal(model.metrics.find((metric) => metric.label === "测试").value, "90");
});
