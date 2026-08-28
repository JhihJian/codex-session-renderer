import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { discoverReviewContexts } from "../src/review-context-discovery.mjs";
import { createReviewContextLab } from "../src/review-context-lab.mjs";

test("明确纠正此前交付的用户回复生成只读复盘上下文", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "review-context-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "session.jsonl");
  const rows = [
    { type: "message", id: "u1", timestamp: "2026-01-01T00:00:00Z", message: { role: "user", content: [{ type: "text", text: "修复页面可读性" }] } },
    { type: "message", id: "a1", timestamp: "2026-01-01T00:01:00Z", message: { role: "assistant", content: [{ type: "text", text: "页面已修复。" }] } },
    { type: "message", id: "u2", timestamp: "2026-01-01T00:02:00Z", message: { role: "user", content: [{ type: "text", text: "不对，页面仍然看不出问题。" }] } },
  ];
  await fs.writeFile(source, `${rows.map(JSON.stringify).join("\n")}\n`, "utf8");
  const discovery = await discoverReviewContexts({ archivePath: source });
  assert.equal(discovery.matches.length, 1);
  assert.equal(discovery.matches[0].task.text, "修复页面可读性");
  assert.equal(discovery.matches[0].priorAssistant.text, "页面已修复。");
  assert.equal(discovery.matches[0].correction.text, "不对，页面仍然看不出问题。");

  const lab = createReviewContextLab({ rootDir: path.join(root, "lab") });
  const archive = await lab.archive({ sourcePath: source, sourceId: "pi-agent", sessionId: "session-1" });
  const first = await lab.record({ archiveId: archive.id, context: discovery.matches[0] });
  const second = await lab.record({ archiveId: archive.id, context: discovery.matches[0] });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
});

test("补充需求和孤立情绪不生成复盘上下文", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "review-context-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "session.jsonl");
  const rows = [
    { type: "message", message: { role: "user", content: [{ type: "text", text: "做一个页面，风格不要太花。" }] } },
    { type: "message", message: { role: "assistant", content: [{ type: "text", text: "开始实现。" }] } },
    { type: "message", message: { role: "user", content: [{ type: "text", text: "再加一个搜索框。" }] } },
  ];
  await fs.writeFile(source, `${rows.map(JSON.stringify).join("\n")}\n`, "utf8");
  assert.equal((await discoverReviewContexts({ archivePath: source })).matches.length, 0);
});