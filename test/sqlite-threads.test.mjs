import test from "node:test";
import assert from "node:assert/strict";
import { createSqliteThreadStore, sqlString, threadRowsToMap, unixMaybeToIso } from "../src/sqlite-threads.mjs";

test("threadRowsToMap normalizes sqlite thread rows for API use", () => {
  const rows = [
    {
      id: "thread-1",
      title: "",
      rollout_path: "\\\\?\\D:\\codex\\sessions\\thread-1.jsonl",
      cwd: "\\\\?\\D:\\github\\codex-session-renderer",
      created_at_ms: 1_700_000_000_000,
      updated_at: 1_700_000_100,
      archived: 1,
      first_user_message: "第一条消息",
      preview: "预览",
      model: "gpt-test",
      reasoning_effort: "medium",
    },
    { id: "missing-path" },
  ];

  const threads = threadRowsToMap(rows);
  assert.equal(threads.size, 1);
  assert.deepEqual(threads.get("thread-1"), {
    id: "thread-1",
    title: "第一条消息",
    path: "D:\\codex\\sessions\\thread-1.jsonl",
    cwd: "D:\\github\\codex-session-renderer",
    createdAt: "2023-11-14T22:13:20.000Z",
    updatedAt: "2023-11-14T22:15:00.000Z",
    source: null,
    threadSource: null,
    modelProvider: null,
    archived: true,
    archivedAt: null,
    model: "gpt-test",
    reasoningEffort: "medium",
    agentNickname: null,
    agentRole: null,
    preview: "预览",
  });
});

test("sqlite store escapes ids and filters spawn edges", async () => {
  const calls = [];
  const store = createSqliteThreadStore({
    stateDbPath: "D:\\codex\\state_5.sqlite",
    sqliteCandidates: ["sqlite3-test"],
    runCommand: async (command, args, options) => {
      calls.push({ command, args, options });
      if (args.at(-1).startsWith("select parent_thread_id")) {
        return {
          stdout: JSON.stringify([
            { parent_thread_id: "parent", child_thread_id: "child", status: "done" },
            { parent_thread_id: "", child_thread_id: "missing-parent" },
          ]),
        };
      }
      return {
        stdout: JSON.stringify([
          {
            id: "a'b",
            rollout_path: "D:\\codex\\sessions\\a-b.jsonl",
            updated_at_ms: 1_700_000_100_000,
          },
        ]),
      };
    },
  });

  const rows = await store.readThreadRowsByIds(["a'b", "a'b", null]);
  const edges = await store.readSpawnEdges();

  assert.equal(rows.size, 1);
  assert.equal(edges.length, 1);
  assert.deepEqual(edges[0], { parentThreadId: "parent", childThreadId: "child", status: "done" });
  assert.equal(calls[0].command, "sqlite3-test");
  assert.match(calls[0].args.at(-1), /where id in \('a''b'\)/);
  assert.equal(calls[0].options.maxBuffer, 10 * 1024 * 1024);
});

test("sqlite list query excludes subagent child threads before applying limit", async () => {
  const calls = [];
  const store = createSqliteThreadStore({
    stateDbPath: "D:\\codex\\state_5.sqlite",
    maxListSessions: 25,
    sqliteCandidates: ["sqlite3-test"],
    runCommand: async (command, args, options) => {
      calls.push({ command, args, options });
      return { stdout: "[]" };
    },
  });

  await store.readThreads();

  assert.match(calls[0].args.at(-1), /where id not in \(select child_thread_id from thread_spawn_edges where child_thread_id is not null\)/);
  assert.match(calls[0].args.at(-1), /order by updated_at_ms desc limit 25/);
});

test("sqlite list query pushes recent and historical time bounds into SQL", async () => {
  const calls = [];
  const store = createSqliteThreadStore({
    stateDbPath: "D:\\codex\\state_5.sqlite",
    maxListSessions: 25,
    sqliteCandidates: ["sqlite3-test"],
    runCommand: async (command, args, options) => {
      calls.push({ command, args, options });
      return { stdout: "[]" };
    },
  });

  await store.readThreads({ sinceMs: 1_700_000_000_000 });
  await store.readThreads({ beforeMs: 1_700_000_000_000 });

  assert.match(calls[0].args.at(-1), /updated_at_ms >= 1700000000000/);
  assert.match(calls[1].args.at(-1), /updated_at_ms < 1700000000000 or updated_at_ms is null/);
});

test("sqlite all-thread query keeps child threads for external query APIs", async () => {
  const calls = [];
  const store = createSqliteThreadStore({
    stateDbPath: "D:\\codex\\state_5.sqlite",
    maxListSessions: 25,
    sqliteCandidates: ["sqlite3-test"],
    runCommand: async (command, args, options) => {
      calls.push({ command, args, options });
      return { stdout: "[]" };
    },
  });

  await store.readAllThreads();

  assert.doesNotMatch(calls[0].args.at(-1), /thread_spawn_edges/);
  assert.match(calls[0].args.at(-1), /from threads order by updated_at_ms desc limit 25/);
});

test("sqlite scalar helpers keep quoting and timestamp conversion explicit", () => {
  assert.equal(sqlString("O'Reilly"), "'O''Reilly'");
  assert.equal(unixMaybeToIso(1_700_000_000), "2023-11-14T22:13:20.000Z");
  assert.equal(unixMaybeToIso(1_700_000_000_000), "2023-11-14T22:13:20.000Z");
  assert.equal(unixMaybeToIso("bad"), null);
});
