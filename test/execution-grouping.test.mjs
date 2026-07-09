import test from "node:test";
import assert from "node:assert/strict";
import "../public/execution-grouping.js";

const { groupExecutionRows, normalizeRules, validateRulesForSave } = globalThis.ExecutionGrouping;

function execRow(id, readable, options = {}) {
  return {
    id,
    traceNodeId: id,
    itemRef: `0:${id}:tool-call`,
    type: "tool",
    title: "exec_command",
    depth: options.depth ?? 0,
    readable: {
      toolName: "exec_command",
      ...readable,
    },
    auditNodes: [
      {
        id: `audit:${id}`,
        type: "action",
        toolName: "exec_command",
        title: readable.title,
        summary: readable.summary,
        tags: ["tool", "exec_command"],
      },
    ],
  };
}

test("default rules group consecutive file and directory collection nodes", () => {
  const entries = groupExecutionRows([
    execRow("readme", { ruleId: "exec-read-file", title: "读取文件内容", summary: "README.md", command: "Get-Content README.md" }),
    execRow("files", { ruleId: "exec-rg-files", title: "列出文件", summary: ".", command: "rg --files" }),
    execRow("src", { ruleId: "exec-list-dir", title: "列出目录", summary: "src", command: "Get-ChildItem src" }),
  ]);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, "group");
  assert.equal(entries[0].ruleId, "collect-file-dir-info");
  assert.equal(entries[0].count, 3);
  assert.match(entries[0].title, /收集文件与目录信息/);
});

test("grouping keeps nonconsecutive execution rows separate", () => {
  const entries = groupExecutionRows([
    execRow("readme", { ruleId: "exec-read-file", title: "读取文件内容", summary: "README.md", command: "cat README.md" }),
    execRow("test", { ruleId: "exec-verification", title: "运行验证", summary: "npm test", command: "npm test" }),
    execRow("src", { ruleId: "exec-list-dir", title: "列出目录", summary: "src", command: "ls src" }),
  ]);

  assert.deepEqual(entries.map((entry) => entry.kind), ["row", "row", "row"]);
});

test("custom group rules normalize minimum consecutive item count", () => {
  const rules = normalizeRules([
    {
      id: "custom",
      label: "自定义",
      tool: "*",
      minItems: 1,
      pattern: "alpha",
      title: "执行组",
      summary: "{count}",
    },
  ]);

  assert.equal(rules[0].minItems, 2);
});

test("custom group rules validate required fields and regexp syntax before saving", () => {
  const errors = validateRulesForSave([
    {
      id: "bad-group",
      label: "",
      tool: "/exec(command/",
      minItems: 2,
      pattern: "[",
      title: "执行组",
      summary: "{count}",
    },
  ]);

  assert.equal(errors.some((error) => error.field === "label"), true);
  assert.equal(errors.some((error) => error.field === "tool"), true);
  assert.equal(errors.some((error) => error.field === "pattern"), true);
});
