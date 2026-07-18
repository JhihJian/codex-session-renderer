import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeCursor,
  eventMatchesQuery,
  filterSessions,
  paginateSessions,
  parseSessionEventQuery,
  parseSessionListQuery,
  projectEventForApi,
  projectSessionForApi,
  sessionWatermark,
  sortSessions,
} from "../src/session-query.mjs";

test("session query filters root sessions by time, text and child state", () => {
  const sessions = [
    {
      id: "root",
      title: "接口设计",
      cwd: "D:\\github\\codex-session-renderer",
      model: "gpt-5",
      updatedAt: "2026-06-25T08:00:00.000Z",
      startedAt: "2026-06-25T07:00:00.000Z",
      preview: "增量会话查询",
    },
    {
      id: "child",
      title: "子代理实现",
      cwd: "D:\\github\\codex-session-renderer",
      model: "gpt-5",
      updatedAt: "2026-06-25T08:05:00.000Z",
      startedAt: "2026-06-25T07:05:00.000Z",
    },
    {
      id: "old",
      title: "旧会话",
      cwd: "D:\\github\\other",
      model: "gpt-4.1",
      updatedAt: "2026-06-24T08:00:00.000Z",
      startedAt: "2026-06-24T07:00:00.000Z",
    },
  ];
  const edges = [{ parentThreadId: "root", childThreadId: "child", status: "done" }];
  const query = parseSessionListQuery(
    new URLSearchParams({
      q: "增量",
      cwd: "renderer",
      changedAfter: "2026-06-25T00:00:00.000Z",
    }),
  );

  assert.deepEqual(filterSessions(sessions, query, edges).map((session) => session.id), ["root"]);
  assert.equal(query.rootOnly, true);
});

test("session query can include and select child sessions", () => {
  const sessions = [
    { id: "root", title: "根", updatedAt: "2026-06-25T08:00:00.000Z" },
    { id: "child", title: "子", updatedAt: "2026-06-25T08:05:00.000Z", agentNickname: "worker" },
  ];
  const edges = [{ parentThreadId: "root", childThreadId: "child", status: "done" }];
  const query = parseSessionListQuery(new URLSearchParams("includeChildren=true&isChild=true&agentNickname=work"));

  assert.deepEqual(filterSessions(sessions, query, edges).map((session) => session.id), ["child"]);
});

test("session query applies controlled list types to complete title, cwd and relative path", () => {
  const longErrorTitle = `标题前缀 ${"x".repeat(300)} ERROR_AFTER_DISPLAY_LIMIT`;
  const sessions = [
    { id: "error-title", title: longErrorTitle },
    { id: "tool-path", title: "普通标题", relativePath: "sessions/tool-output.jsonl" },
    { id: "plain", title: "普通会话", cwd: "/workspace/plain" },
  ];

  assert.deepEqual(filterSessions(sessions, parseSessionListQuery(new URLSearchParams("type=error"))).map((session) => session.id), ["error-title"]);
  assert.deepEqual(filterSessions(sessions, parseSessionListQuery(new URLSearchParams("type=tool"))).map((session) => session.id), ["tool-path"]);
  assert.equal(parseSessionListQuery(new URLSearchParams("type=unexpected")).type, "all");
  assert.deepEqual(filterSessions(sessions, parseSessionListQuery(new URLSearchParams("type=unexpected"))).map((session) => session.id), ["error-title", "tool-path", "plain"]);
});

test("session query derives child sessions from JSONL subagent metadata", () => {
  const sessions = [
    { id: "root", title: "根", updatedAt: "2026-06-25T08:00:00.000Z" },
    {
      id: "child",
      title: "子",
      updatedAt: "2026-06-25T08:05:00.000Z",
      source: {
        subagent: {
          thread_spawn: {
            parent_thread_id: "root",
            agent_nickname: "Bernoulli",
            agent_role: "explorer",
          },
        },
      },
    },
  ];

  assert.deepEqual(filterSessions(sessions, parseSessionListQuery(new URLSearchParams()), []).map((session) => session.id), ["root"]);
  assert.deepEqual(
    filterSessions(sessions, parseSessionListQuery(new URLSearchParams("includeChildren=true&isChild=true&agentNickname=bernoulli")), []).map(
      (session) => session.id,
    ),
    ["child"],
  );
});

test("projectSessionForApi exposes subagent display name from JSONL metadata", () => {
  const projected = projectSessionForApi({
    id: "child",
    title: "子",
    source: {
      subagent: {
        thread_spawn: {
          parent_thread_id: "root",
          agent_nickname: "Leibniz",
          agent_role: "explorer",
        },
      },
    },
  });

  assert.equal(projected.threadSource, "subagent");
  assert.equal(projected.agentNickname, "Leibniz");
  assert.equal(projected.agentRole, "explorer");
});

test("projectSessionForApi keeps legacy links by default and supports source-scoped links", () => {
  const legacy = projectSessionForApi({ id: "thread id", title: "链接测试" });
  assert.deepEqual(legacy.links, {
    detail: "/api/sessions/thread%20id",
    compactView: "/api/query/sessions/thread%20id/view?view=compact",
    events: "/api/query/sessions/thread%20id/events",
    markdown: "/api/sessions/thread%20id/markdown",
  });

  const scoped = projectSessionForApi({ id: "thread id", title: "链接测试" }, {}, { sourceId: "remote-a" });
  assert.deepEqual(scoped.links, {
    detail: "/api/sources/remote-a/sessions/thread%20id",
    compactView: "/api/sources/remote-a/query/sessions/thread%20id/view?view=compact",
    events: "/api/sources/remote-a/query/sessions/thread%20id/events",
    markdown: "/api/sources/remote-a/sessions/thread%20id/markdown",
  });
});

test("session query sorts, paginates and projects fields", () => {
  const query = parseSessionListQuery(new URLSearchParams("limit=1&sort=updatedAt&order=desc&fields=title,changedAt"));
  const sessions = sortSessions(
    [
      { id: "a", title: "A", updatedAt: "2026-06-25T07:00:00.000Z", path: "D:\\codex\\a.jsonl" },
      { id: "b", title: "B", updatedAt: "2026-06-25T08:00:00.000Z", path: "D:\\codex\\b.jsonl" },
    ],
    query,
  );
  const page = paginateSessions(sessions, query);
  const projected = page.items.map((session) => projectSessionForApi(session, query));

  assert.deepEqual(projected, [{ id: "b", title: "B", changedAt: "2026-06-25T08:00:00.000Z" }]);
  assert.equal(page.total, 2);
  assert.equal(decodeCursor(page.nextCursor).offset, 1);
  assert.equal(sessionWatermark(sessions), "2026-06-25T08:00:00.000Z");
});

test("event query filters projected events without returning payload by default", () => {
  const event = {
    type: "response_item",
    timestamp: "2026-06-25T08:00:00.000Z",
    payload: { type: "function_call", name: "read_file", arguments: "{\"path\":\"README.md\"}" },
  };
  const query = parseSessionEventQuery(new URLSearchParams("kind=function_call&q=README&important=true"));
  const projected = projectEventForApi(event, 3, query);

  assert.equal(eventMatchesQuery(projected, event, query), true);
  assert.equal(projected.index, 3);
  assert.equal(projected.kind, "function_call");
  assert.equal(projected.payload, undefined);
  assert.equal(projected.payloadSize > 0, true);
});

test("event query search uses normalized redacted text", () => {
  const event = {
    type: "response_item",
    payload: {
      type: "reasoning",
      encrypted_content: "SECRET_ENCRYPTED_BLOB",
      summary: [{ text: "公开摘要" }],
    },
  };
  const querySecret = parseSessionEventQuery(new URLSearchParams("q=SECRET_ENCRYPTED_BLOB"));
  const projected = projectEventForApi(event, 1, querySecret);

  assert.equal(eventMatchesQuery(projected, event, querySecret), false);
  assert.equal(projected.reasoning.encrypted, true);

  const queryFieldName = parseSessionEventQuery(new URLSearchParams("q=encrypted_content"));
  assert.equal(eventMatchesQuery(projectEventForApi(event, 1, queryFieldName), event, queryFieldName), false);

  const querySummary = parseSessionEventQuery(new URLSearchParams("q=公开摘要"));
  assert.equal(eventMatchesQuery(projectEventForApi(event, 1, querySummary), event, querySummary), true);
});

test("event query search hides machine-injected user context by default", () => {
  const event = {
    type: "event_msg",
    timestamp: "2026-07-07T11:00:01.000Z",
    payload: {
      type: "user_message",
      message:
        "# AGENTS.md instructions\n\n<INSTRUCTIONS>内部规则</INSTRUCTIONS><environment_context><cwd>/tmp/project</cwd></environment_context>\n请继续整理复盘材料",
    },
  };

  const machineQuery = parseSessionEventQuery(new URLSearchParams("q=AGENTS.md"));
  assert.equal(eventMatchesQuery(projectEventForApi(event, 1, machineQuery), event, machineQuery), false);

  const userQuery = parseSessionEventQuery(new URLSearchParams("q=复盘材料"));
  assert.equal(eventMatchesQuery(projectEventForApi(event, 1, userQuery), event, userQuery), true);
});

test("event query exposes and searches compact metadata", () => {
  const event = {
    type: "compacted",
    timestamp: "2026-07-08T03:24:06.920Z",
    payload: {
      message: "压缩摘要：保留关键结论",
      replacement_history: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "原始请求：页面显示被替换对话" }],
          internal_chat_message_metadata_passthrough: { turn_id: "turn-compact-source" },
        },
      ],
      window_id: "w-2",
    },
  };
  const query = parseSessionEventQuery(new URLSearchParams("kind=compacted&q=被替换对话"));
  const projected = projectEventForApi(event, 9, query);

  assert.equal(eventMatchesQuery(projected, event, query), true);
  assert.equal(projected.important, true);
  assert.equal(projected.compact.windowId, "w-2");
  assert.equal(projected.compact.replacementHistoryCount, 1);
  assert.equal(projected.compact.replacementHistoryPreview[0].turnId, "turn-compact-source");
  assert.match(projected.compact.replacementHistoryPreview[0].preview, /页面显示/);
});

test("event query supports payload inclusion and cursor aliases", () => {
  const event = {
    type: "event_msg",
    timestamp: "2026-06-25T08:00:00.000Z",
    payload: { type: "agent_message", message: "完成" },
  };
  const query = parseSessionEventQuery(new URLSearchParams("after=4&limit=5&includePayload=true&fields=payload,title"));
  const projected = projectEventForApi(event, 5, query);

  assert.equal(query.cursor, 5);
  assert.deepEqual(projected, {
    index: 5,
    payload: { type: "agent_message", message: "完成" },
    title: "助手消息",
  });
});

test("event query keeps an opaque diagnostic snapshot token separate from payload projection", () => {
  const query = parseSessionEventQuery(new URLSearchParams("cursor=7&snapshot=opaque-page-token"));

  assert.equal(query.cursor, 7);
  assert.equal(query.snapshot, "opaque-page-token");
  assert.equal(query.includePayload, false);
  assert.equal(query.includeRaw, false);
});
