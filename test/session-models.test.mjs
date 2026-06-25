import test from "node:test";
import assert from "node:assert/strict";
import { compactSessionForList, publicThreadMeta, rootSessionsOnly, sessionFromThread, withFileStat } from "../src/session-models.mjs";

test("sessionFromThread creates the API session model without touching the file", () => {
  const session = sessionFromThread(
    {
      id: "thread-1",
      title: "标题",
      path: "D:\\codex\\sessions\\rollout-2026-06-24T10-20-30-thread-1.jsonl",
      cwd: "D:\\github\\codex-session-renderer",
      model: "gpt-test",
      reasoningEffort: "medium",
      archived: true,
      updatedAt: "2026-06-24T11:00:00.000Z",
      agentNickname: "worker",
      agentRole: "review",
      preview: "预览",
    },
    "D:\\codex",
  );

  assert.equal(session.id, "thread-1");
  assert.equal(session.path, "D:\\codex\\sessions\\rollout-2026-06-24T10-20-30-thread-1.jsonl");
  assert.equal(session.relativePath, "sessions/rollout-2026-06-24T10-20-30-thread-1.jsonl");
  assert.equal(session.startedAt, "2026-06-24T10:20:30.000Z");
  assert.equal(session.updatedAt, "2026-06-24T11:00:00.000Z");
  assert.equal(session.archived, true);
});

test("compactSessionForList preserves list fields while trimming preview text", () => {
  const compact = compactSessionForList({
    id: "thread-1",
    title: "x".repeat(200),
    cwd: "D:\\github",
    model: "gpt-test",
    reasoningEffort: "medium",
    archived: false,
    preview: "p".repeat(200),
    relativePath: "sessions/thread-1.jsonl",
    sizeBytes: 0,
  });

  assert.equal(compact.title, "x".repeat(200));
  assert.equal(compact.preview.length, 120);
  assert.equal(compact.sizeBytes, null);
});

test("rootSessionsOnly removes subagent child threads from the standalone list", () => {
  const sessions = [
    { id: "root", title: "根会话" },
    { id: "child", title: "子代理", agentNickname: "worker" },
    { id: "orphan", title: "独立会话", agentNickname: "reviewer" },
  ];

  assert.deepEqual(
    rootSessionsOnly(sessions, [
      { parentThreadId: "root", childThreadId: "child", status: "done" },
      { parentThreadId: "missing", childThreadId: "", status: "unknown" },
    ]),
    [
      { id: "root", title: "根会话" },
      { id: "orphan", title: "独立会话", agentNickname: "reviewer" },
    ],
  );
  assert.equal(rootSessionsOnly(sessions, []), sessions);
});

test("withFileStat and publicThreadMeta normalize derived file metadata", () => {
  const mtime = new Date("2026-06-24T10:00:00.000Z");
  assert.deepEqual(withFileStat({ id: "thread-1", updatedAt: null }, { size: 42, mtime }), {
    id: "thread-1",
    updatedAt: "2026-06-24T10:00:00.000Z",
    sizeBytes: 42,
    fileModifiedAt: "2026-06-24T10:00:00.000Z",
  });

  assert.deepEqual(
    publicThreadMeta(
      {
        id: "child",
        title: "子线程",
        cwd: "",
        model: "gpt-test",
        reasoningEffort: "low",
        updatedAt: "2026-06-24T10:00:00.000Z",
        path: "D:\\codex\\sessions\\child.jsonl",
      },
      "D:\\codex",
    ),
    {
      id: "child",
      title: "子线程",
      cwd: null,
      model: "gpt-test",
      reasoningEffort: "low",
      agentNickname: null,
      agentRole: null,
      updatedAt: "2026-06-24T10:00:00.000Z",
      path: "D:\\codex\\sessions\\child.jsonl",
      relativePath: "sessions/child.jsonl",
    },
  );
});
