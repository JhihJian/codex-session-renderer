import assert from "node:assert/strict";
import test from "node:test";
import { piEmbeddedSubagentCall, piEmbeddedSubagentResult } from "../src/embedded-subagents.mjs";

test("Pi 内嵌 subagent 使用结构化 results 投影任务状态", () => {
  const batch = piEmbeddedSubagentCall(JSON.stringify({ mode: "parallel", agentScope: "both", tasks: [{ agent: "reviewer", task: "审阅" }, { agent: "tester", task: "测试" }] }));
  const result = piEmbeddedSubagentResult(batch, { message: { details: { results: [
    { agent: "reviewer", agentSource: "project", exitCode: 0, stopReason: "stop", messages: [{ role: "assistant", content: [{ type: "text", text: "已完成审阅" }] }] },
    { agent: "tester", exitCode: 0, stopReason: "error", errorMessage: "429 status code" },
  ] } } });

  assert.equal(result.status, "partial");
  assert.deepEqual(result.results.map((task) => task.status), ["succeeded", "rate_limited"]);
  assert.equal(result.results[1].summary, "429 status code");
});

test("Pi 内嵌 subagent 缺少结构化结果时保留未知状态", () => {
  const batch = piEmbeddedSubagentCall(JSON.stringify({ agent: "reviewer", task: "审阅" }));
  const result = piEmbeddedSubagentResult(batch, { message: { details: { mode: "single" } } });
  assert.equal(result.status, "unknown");
  assert.deepEqual(result.results, []);
});

test("Pi 单代理调用在携带空 tasks 数组时回退顶层任务", () => {
  const batch = piEmbeddedSubagentCall(JSON.stringify({ agent: "reviewer", task: "审阅", tasks: [] }));
  assert.deepEqual(batch.requested, [{ index: 0, agent: "reviewer", task: "审阅" }]);
});

test("Pi 参数校验失败在没有 results 时显示为请求无效", () => {
  const batch = piEmbeddedSubagentCall(JSON.stringify({ agent: "reviewer", task: "审阅" }));
  const result = piEmbeddedSubagentResult(batch, { message: { details: { results: [] } } }, "Invalid parameters. Provide exactly one mode.");
  assert.equal(result.status, "invalid_request");
  assert.equal(result.results[0].status, "invalid_request");
});

test("Pi 内嵌 subagent 以非零退出码标识失败", () => {
  const batch = piEmbeddedSubagentCall(JSON.stringify({ agent: "reviewer", task: "审阅" }));
  const result = piEmbeddedSubagentResult(batch, { message: { details: { results: [{ agent: "reviewer", agentSource: "unknown", exitCode: 1 }] } } });
  assert.equal(result.status, "failed");
  assert.equal(result.results[0].status, "failed");
  assert.equal(result.results[0].agentSource, null);
});