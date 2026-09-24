import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createSessionRouter } from "../src/session-router.mjs";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address()));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

function service() {
  const context = { source: { id: "local" } };
  const exported = { filename: "execution-safe.md", text: "# 执行诊断记录\n\n工具输出：已省略，已持久化 12 UTF-8 字节\n" };
  return {
    getSourceContext: (id) => (id === "local" ? context : null),
    getSessionExecutionExport: async () => exported,
    getTemporarySessionExecutionExport: async () => exported,
  };
}

test("执行文本导出路由以附件形式返回文本并保持只读", async (t) => {
  const server = createServer(createSessionRouter({ service: service(), publicDir: process.cwd() }));
  const address = await listen(server);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => close(server));

  const response = await fetch(`${baseUrl}/api/sources/local/sessions/session-1/execution-export`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /^text\/plain/);
  assert.equal(response.headers.get("content-disposition"), "attachment; filename=\"execution-safe.md\"");
  assert.match(await response.text(), /已持久化 12 UTF-8 字节/);

  const temporary = await fetch(`${baseUrl}/api/open-session/execution-export?path=%2Ftmp%2Fsession.jsonl`);
  assert.equal(temporary.status, 200);

  const writeAttempt = await fetch(`${baseUrl}/api/sessions/session-1/execution-export`, { method: "POST" });
  assert.equal(writeAttempt.status, 405);
});