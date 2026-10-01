import test from "node:test";
import assert from "node:assert/strict";
import { createSessionCatalogQueryService } from "../src/session-catalog-query-service.mjs";

test("Pi catalog lookup resolves a file record without building the full catalog", async () => {
  const id = "77777777-7777-4777-8777-777777777777";
  const directoryQueries = {
    sessionFileRecordById: async (_context, requestedId) => ({ id: requestedId, filePath: `/sessions/${requestedId}.jsonl`, archived: false }),
    sessionFromFilePath: async (_context, filePath, options) => ({ id: options.sessionId, path: filePath, title: "target session" }),
  };
  const catalog = createSessionCatalogQueryService({
    directoryQueries,
    maxListSessions: 1,
    sessionFileStat: async () => null,
    sourceModelOptions: () => ({}),
    throwIfRequestAborted: () => {},
  });
  const context = {
    source: { id: "pi-agent", kind: "pi-agent" },
    sessionCacheByScope: new Map(),
    threadStore: {
      readThreadRowsByIds: async () => new Map(),
      readThreads: async () => { throw new Error("detail lookup must not build the full catalog"); },
    },
  };

  const session = await catalog.getSessionById(context, id);

  assert.deepEqual(session, { id, path: `/sessions/${id}.jsonl`, title: "target session" });
});

test("Pi lineage uses a fresh catalog cache and skips a cold full catalog", async () => {
  const parent = { id: "parent", title: "parent session" };
  const child = { id: "child", title: "child session", parentSessionId: "parent" };
  const catalog = createSessionCatalogQueryService({
    directoryQueries: {},
    maxListSessions: 1,
    throwIfRequestAborted: () => {},
  });
  const context = {
    source: { id: "pi-agent", kind: "pi-agent" },
    sessionCacheByScope: new Map(),
    threadStore: {
      readThreads: async () => { throw new Error("cold lineage lookup must not build the full catalog"); },
    },
  };

  assert.equal(await catalog.getSessionLineage(context, child), null);

  context.sessionCacheByScope.set("all", { sessions: [parent, child], time: Date.now() });
  assert.deepEqual(await catalog.getSessionLineage(context, child), {
    parentId: "parent",
    parent: { id: "parent", title: "parent session", startedAt: null, updatedAt: null, archived: false },
    children: [],
    chain: [{ id: "parent", title: "parent session", startedAt: null, updatedAt: null, archived: false }],
  });
});