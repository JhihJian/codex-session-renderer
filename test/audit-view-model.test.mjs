import test from "node:test";
import assert from "node:assert/strict";
import "../public/audit-view-model.js";

const {
  attachAuditRowsToAgentMessages,
  auditAgentParentForExecutionRow,
  auditExecutionRowFromItem,
  auditExecutionRowFromTraceNode,
  auditTraceNodeIsExecution,
  flattenAuditExecutionRows,
  itemIndexFromItemRef,
  itemRefFromTraceNode,
  linkAuditExecutionHierarchy,
} = globalThis.AuditViewModel;

const helpers = {
  itemRef(item) {
    return `${item.turnIndex ?? "x"}:${item.itemIndex ?? item.id ?? "x"}:${item.type || "item"}`;
  },
  firstLine(text, limit) {
    return String(text || "").split(/\r?\n/)[0].slice(0, limit);
  },
  formatDate(value) {
    return value ? `fmt:${value}` : "";
  },
  durationBetween(start, end) {
    const startMs = start ? new Date(start).getTime() : null;
    const endMs = end ? new Date(end).getTime() : null;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return null;
    return endMs - startMs;
  },
};

test("trace item node projects item identity into an execution row", () => {
  const node = {
    id: "item:0:2:abc",
    type: "tool",
    icon: "tool",
    label: "Tool call",
    status: "completed",
    timestamp: "2026-07-08T10:00:00.000Z",
    completedAt: "2026-07-08T10:00:02.000Z",
    durationMs: 2000,
    durationEstimated: false,
    detail: { item: { type: "tool-call", name: "read_file" } },
  };

  const row = auditExecutionRowFromTraceNode(node, 1);

  assert.equal(itemRefFromTraceNode(node), "0:2:tool-call");
  assert.equal(row.itemRef, "0:2:tool-call");
  assert.equal(row.itemIndex, 2);
  assert.equal(row.traceNodeId, "item:0:2:abc");
  assert.equal(row.title, "read_file");
  assert.equal(row.depth, 1);
});

test("subagent and lazy child trace rows keep execution fields without item identity", () => {
  const subagent = auditExecutionRowFromTraceNode(
    {
      id: "subagent:worker-1",
      type: "subagent",
      icon: "subagent",
      label: "Subagent",
      title: "Review worker",
      subtitle: "delegated review",
      status: "running",
      timestamp: "2026-07-08T10:01:00.000Z",
    },
    2,
  );
  const lazyChild = auditExecutionRowFromTraceNode(
    {
      id: "lazy-child:worker-1",
      type: "lazy-child",
      label: "Lazy child",
      title: "Deferred child",
      status: "observed",
    },
    3,
  );

  assert.equal(auditTraceNodeIsExecution({ type: "subagent" }), true);
  assert.equal(auditTraceNodeIsExecution({ type: "lazy-child" }), true);
  assert.equal(auditTraceNodeIsExecution({ type: "turn" }), false);
  assert.equal(subagent.itemRef, null);
  assert.equal(subagent.itemIndex, null);
  assert.equal(subagent.traceNodeId, "subagent:worker-1");
  assert.equal(subagent.type, "subagent");
  assert.equal(subagent.icon, "subagent");
  assert.equal(subagent.title, "Review worker");
  assert.equal(subagent.status, "running");
  assert.equal(subagent.depth, 2);
  assert.equal(lazyChild.itemRef, null);
  assert.equal(lazyChild.icon, "lazy-child");
  assert.equal(lazyChild.title, "Deferred child");
  assert.equal(lazyChild.status, "observed");
});

test("fallback tool-call row keeps identity, handoff classification, and duration fields", () => {
  const row = auditExecutionRowFromItem(
    {
      id: "call-1",
      turnIndex: 0,
      itemIndex: 4,
      type: "tool-call",
      name: "spawn_agent",
      status: "completed",
      timestamp: "2026-07-08T10:00:00.000Z",
      completedAt: "2026-07-08T10:00:05.000Z",
    },
    0,
    helpers,
  );
  const estimated = auditExecutionRowFromItem(
    {
      id: "call-2",
      turnIndex: 0,
      itemIndex: 5,
      type: "tool-call",
      name: "read_file",
      status: "running",
      timestamp: "2026-07-08T10:01:00.000Z",
    },
    0,
    helpers,
  );

  assert.equal(row.id, "item:0:4:call-1");
  assert.equal(row.traceNodeId, "item:0:4:call-1");
  assert.equal(row.itemRef, "0:4:tool-call");
  assert.equal(row.itemIndex, 4);
  assert.equal(row.type, "handoff");
  assert.equal(row.icon, "handoff");
  assert.equal(row.label, "Handoff");
  assert.equal(row.title, "spawn_agent");
  assert.equal(row.subtitle, "completed · fmt:2026-07-08T10:00:00.000Z");
  assert.equal(row.durationMs, 5000);
  assert.equal(row.durationEstimated, false);
  assert.equal(estimated.type, "tool");
  assert.equal(estimated.durationMs, null);
  assert.equal(estimated.durationEstimated, true);
});

test("invalid itemRef returns null without throwing", () => {
  assert.equal(itemIndexFromItemRef("not-a-ref"), null);
  assert.equal(itemIndexFromItemRef("0:x:tool-call"), null);
  assert.equal(itemIndexFromItemRef(""), null);
  assert.equal(itemIndexFromItemRef(null), null);
  assert.doesNotThrow(() => itemIndexFromItemRef("0:x:tool-call"));
});

test("flattenAuditExecutionRows keeps nested execution depth", () => {
  const rows = flattenAuditExecutionRows(
    [
      {
        id: "message:0",
        type: "message",
        children: [
          {
            id: "item:0:1:tool-a",
            type: "tool",
            detail: { item: { type: "tool-call", name: "read_file" } },
            children: [
              {
                id: "subagent:0",
                type: "subagent",
                title: "Worker",
                children: [
                  {
                    id: "message:1",
                    type: "message",
                    children: [{ id: "lazy-child:0", type: "lazy-child", title: "Deferred" }],
                  },
                ],
              },
            ],
          },
          {
            id: "item:0:2:tool-b",
            type: "handoff",
            detail: { item: { type: "tool-call", name: "wait_agent" } },
          },
        ],
      },
    ],
    0,
  );

  assert.deepEqual(
    rows.map((row) => [row.id, row.depth]),
    [
      ["item:0:1:tool-a", 0],
      ["subagent:0", 1],
      ["lazy-child:0", 2],
      ["item:0:2:tool-b", 0],
    ],
  );
});

test("execution row without item identity attaches to previous assistant message by timestamp", () => {
  const agentRows = [
    {
      id: "agent-message:0:1:first",
      itemIndex: 1,
      timestamp: "2026-07-08T10:00:00.000Z",
    },
    {
      id: "agent-message:0:3:second",
      itemIndex: 3,
      timestamp: "2026-07-08T10:05:00.000Z",
    },
    {
      id: "agent-message:0:5:third",
      itemIndex: 5,
      timestamp: "2026-07-08T10:10:00.000Z",
    },
  ];

  const parent = auditAgentParentForExecutionRow(
    {
      id: "trace-tool-without-item-ref",
      timestamp: "2026-07-08T10:06:30.000Z",
    },
    agentRows,
  );

  assert.equal(parent?.id, "agent-message:0:3:second");
});

test("execution row itemRef keeps item index based parent selection", () => {
  const agentRows = [
    { id: "agent-message:0:1:first", itemIndex: 1, timestamp: "2026-07-08T10:00:00.000Z" },
    { id: "agent-message:0:4:second", itemIndex: 4, timestamp: "2026-07-08T10:05:00.000Z" },
  ];

  assert.equal(itemIndexFromItemRef("0:3:tool-call"), 3);
  assert.equal(auditAgentParentForExecutionRow({ itemRef: "0:3:tool-call" }, agentRows)?.id, "agent-message:0:1:first");
});

test("execution rows without assistant messages attach to an implicit synthetic parent", () => {
  const rows = [{ id: "tool:0", type: "tool", depth: 0, auditNodes: [] }];
  const linkedRows = attachAuditRowsToAgentMessages(rows, { status: "completed", startedAt: "2026-07-08T10:00:00.000Z" }, 0, helpers);

  assert.equal(linkedRows.length, 2);
  assert.equal(linkedRows[0].id, "agent-message:0:implicit");
  assert.equal(linkedRows[0].synthetic, true);
  assert.deepEqual(linkedRows[0].childRowIds, ["tool:0"]);
  assert.equal(linkedRows[1].id, "tool:0");
  assert.equal(linkedRows[1].parentRowId, "agent-message:0:implicit");
  assert.equal(linkedRows[1].agentMessageItemRef, null);
  assert.equal(linkedRows[1].depth, 1);
});

test("execution rows attach to the previous assistant message by itemIndex and itemRef", () => {
  const turn = {
    items: [
      { type: "user-message", text: "request" },
      { id: "first", type: "assistant-message", text: "first assistant", timestamp: "2026-07-08T10:00:00.000Z" },
      { id: "tool-a", type: "tool-call", name: "read_file" },
      { id: "second", type: "assistant-message", text: "second assistant", timestamp: "2026-07-08T10:05:00.000Z" },
      { id: "tool-b", type: "tool-call", name: "run_test" },
    ],
  };
  const rows = [
    { id: "exec:item-index", itemIndex: 2, itemRef: "0:2:tool-call", depth: 0, auditNodes: [] },
    { id: "exec:item-ref", itemRef: "0:4:tool-call", depth: 0, auditNodes: [] },
  ];

  const linkedRows = attachAuditRowsToAgentMessages(rows, turn, 0, helpers);
  const firstAgent = linkedRows.find((row) => row.id === "agent-message:0:1:first");
  const secondAgent = linkedRows.find((row) => row.id === "agent-message:0:3:second");
  const itemIndexChild = linkedRows.find((row) => row.id === "exec:item-index");
  const itemRefChild = linkedRows.find((row) => row.id === "exec:item-ref");

  assert.deepEqual(
    linkedRows.map((row) => row.id),
    ["agent-message:0:1:first", "exec:item-index", "agent-message:0:3:second", "exec:item-ref"],
  );
  assert.deepEqual(firstAgent.childRowIds, ["exec:item-index"]);
  assert.deepEqual(secondAgent.childRowIds, ["exec:item-ref"]);
  assert.equal(itemIndexChild.parentRowId, "agent-message:0:1:first");
  assert.equal(itemIndexChild.agentMessageItemRef, "0:1:assistant-message");
  assert.equal(itemRefChild.parentRowId, "agent-message:0:3:second");
  assert.equal(itemRefChild.agentMessageItemRef, "0:3:assistant-message");
});

test("execution rows before the first assistant attach to first and rows after the last attach to last", () => {
  const turn = {
    items: [
      { type: "user-message", text: "request" },
      { type: "reasoning", text: "thinking" },
      { id: "first", type: "assistant-message", text: "first assistant" },
      { type: "tool-call", name: "read_file" },
      { id: "last", type: "assistant-message", text: "last assistant" },
    ],
  };
  const rows = [
    { id: "exec:early", itemIndex: 0, itemRef: "0:0:tool-call", depth: 0, auditNodes: [] },
    { id: "exec:late", itemIndex: 9, itemRef: "0:9:tool-call", depth: 0, auditNodes: [] },
  ];

  const linkedRows = attachAuditRowsToAgentMessages(rows, turn, 0, helpers);
  const firstAgent = linkedRows.find((row) => row.id === "agent-message:0:2:first");
  const lastAgent = linkedRows.find((row) => row.id === "agent-message:0:4:last");

  assert.deepEqual(firstAgent.childRowIds, ["exec:early"]);
  assert.deepEqual(lastAgent.childRowIds, ["exec:late"]);
  assert.equal(linkedRows.find((row) => row.id === "exec:early").parentRowId, "agent-message:0:2:first");
  assert.equal(linkedRows.find((row) => row.id === "exec:late").parentRowId, "agent-message:0:4:last");
});

test("linkAuditExecutionHierarchy does not duplicate childRowIds", () => {
  const linkedRows = linkAuditExecutionHierarchy([
    { id: "parent", childRowIds: ["child", "child"] },
    { id: "child", parentRowId: "parent", childRowIds: [] },
    { id: "next-child", parentRowId: "parent", childRowIds: [] },
  ]);

  assert.deepEqual(
    linkedRows.find((row) => row.id === "parent").childRowIds,
    ["child", "next-child"],
  );
});
