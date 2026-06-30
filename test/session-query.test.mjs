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
    title: "agent_message",
  });
});
