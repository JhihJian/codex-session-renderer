import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  compactSessionForList,
  displayTitleForList,
  listDisplayTitleLimit,
  mapCodexHomePath,
  publicThreadMeta,
  rootSessionsOnly,
  sessionFromThread,
  spawnEdgesFromSessions,
  subagentThreadSpawn,
  withFileStat,
  withSubagentMeta,
} from "../src/session-models.mjs";

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
      createdAt: "2026-06-24T10:20:30.000Z",
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
  assert.equal(session.sourceId, "local");
  assert.equal(session.sourceLabel, "本机 Codex Home");
  assert.equal(session.dataSourceKind, "local");
  assert.equal(session.startedAt, "2026-06-24T10:20:30.000Z");
  assert.equal(session.updatedAt, "2026-06-24T11:00:00.000Z");
  assert.equal(session.archived, true);
});

test("compactSessionForList separates a bounded display title from the canonical title", () => {
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

  assert.equal(compact.title, undefined);
  assert.equal(compact.displayTitle, `${"x".repeat(listDisplayTitleLimit - 3)}...`);
  assert.equal(compact.titleTruncated, true);
  assert.equal(compact.preview.length, 120);
  assert.equal(compact.sizeBytes, null);
  assert.equal(compact.sourceId, "local");
});

test("displayTitleForList normalizes whitespace and has a deterministic boundary", () => {
  assert.deepEqual(displayTitleForList("  第一行\n第二行  "), { displayTitle: "第一行 第二行", titleTruncated: false });
  assert.deepEqual(displayTitleForList("a".repeat(listDisplayTitleLimit + 1)), {
    displayTitle: `${"a".repeat(listDisplayTitleLimit - 3)}...`,
    titleTruncated: true,
  });
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

test("JSONL subagent metadata supplies child relation and display name", () => {
  const source = {
    subagent: {
      thread_spawn: {
        parent_thread_id: "root",
        agent_nickname: "Nash",
        agent_role: "explorer",
      },
    },
  };
  const session = withSubagentMeta({
    id: "child-from-jsonl",
    title: "子代理会话",
    source,
    threadSource: null,
    agentNickname: null,
    agentRole: null,
  });

  assert.deepEqual(subagentThreadSpawn(source), {
    parentThreadId: "root",
    agentNickname: "Nash",
    agentRole: "explorer",
    agentPath: null,
    depth: null,
  });
  assert.equal(session.threadSource, "subagent");
  assert.equal(session.agentNickname, "Nash");
  assert.equal(session.agentRole, "explorer");
  assert.deepEqual(spawnEdgesFromSessions([session]), [
    { parentThreadId: "root", childThreadId: "child-from-jsonl", status: "unknown" },
  ]);
  assert.deepEqual(rootSessionsOnly([{ id: "root", title: "根会话" }, session]).map((item) => item.id), ["root"]);
});

test("sessionFromThread maps remote rollout paths into the local snapshot source", () => {
  const session = sessionFromThread(
    {
      id: "same-id",
      title: "远程会话",
      path: "/root/.codex/sessions/2026/06/25/rollout-2026-06-25T01-02-03-same-id.jsonl",
    },
    "/tmp/snapshots/remote/current",
    {
      sourceId: "remote",
      sourceLabel: "远程设备",
      dataSourceKind: "remote",
      originalCodexHome: "/root/.codex",
    },
  );

  assert.equal(
    session.path,
    path.join("/tmp/snapshots/remote/current", "sessions", "2026", "06", "25", "rollout-2026-06-25T01-02-03-same-id.jsonl"),
  );
  assert.equal(session.relativePath, "sessions/2026/06/25/rollout-2026-06-25T01-02-03-same-id.jsonl");
  assert.equal(session.sourceId, "remote");
  assert.equal(session.sourceLabel, "远程设备");
  assert.equal(session.dataSourceKind, "remote");
});

test("mapCodexHomePath leaves unrelated paths untouched", () => {
  assert.equal(mapCodexHomePath("/var/log/session.jsonl", "/tmp/current", "/root/.codex"), "/var/log/session.jsonl");
});

test("remote SQLite rollout paths fail closed unless they map to snapshot sessions JSONL", () => {
  const options = { dataSourceKind: "remote" };
  assert.equal(mapCodexHomePath("/var/log/session.jsonl", "/tmp/current", "/root/.codex", options), "");
  assert.equal(mapCodexHomePath("/root/.codex/archived_sessions/old.jsonl", "/tmp/current", "/root/.codex", options), "");
  assert.equal(mapCodexHomePath("/root/.codex/sessions/../state_5.sqlite", "/tmp/current", "/root/.codex", options), "");
  assert.equal(mapCodexHomePath("/root/.codex/sessions/2026/07/session.txt", "/tmp/current", "/root/.codex", options), "");
  assert.equal(
    sessionFromThread({ id: "unsafe", path: "/var/log/session.jsonl" }, "/tmp/current", { ...options, originalCodexHome: "/root/.codex" }).path,
    null,
  );
});

test("withFileStat and publicThreadMeta normalize derived file metadata", () => {
  const mtime = new Date("2026-06-24T10:00:00.000Z");
  assert.deepEqual(withFileStat({ id: "thread-1", updatedAt: null }, { size: 42, mtime }), {
    id: "thread-1",
    updatedAt: "2026-06-24T10:00:00.000Z",
    sizeBytes: 42,
    fileModifiedAt: "2026-06-24T10:00:00.000Z",
  });

  const threadMeta = publicThreadMeta(
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
  );
  assert.deepEqual(threadMeta, {
    id: "child",
    title: "子线程",
    cwd: null,
    model: "gpt-test",
    reasoningEffort: "low",
    agentNickname: null,
    agentRole: null,
    updatedAt: "2026-06-24T10:00:00.000Z",
    sourceId: "local",
    sourceLabel: null,
    dataSourceKind: "local",
    path: "D:\\codex\\sessions\\child.jsonl",
    relativePath: "sessions/child.jsonl",
  });
});
