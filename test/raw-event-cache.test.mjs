import test from "node:test";
import assert from "node:assert/strict";
import "../public/raw-event-cache.js";

const { createRawEventCache, estimateJsonUtf8Bytes } = globalThis.RawEventCache;

test("完整原始事件缓存按访问顺序淘汰，命中会刷新 LRU", () => {
  const cache = createRawEventCache({ maxEntries: 2, maxBytes: 1_000 });
  cache.remember("first", { text: "first" });
  cache.remember("second", { text: "second" });
  assert.deepEqual(cache.get("first"), { text: "first" });

  cache.remember("third", { text: "third" });
  assert.equal(cache.get("second"), undefined);
  assert.deepEqual(cache.get("first"), { text: "first" });
  assert.deepEqual(cache.get("third"), { text: "third" });
  assert.equal(cache.size, 2);
});

test("完整原始事件缓存限制 UTF-8 总字节，超单项预算不写入", () => {
  const first = { text: "a".repeat(24) };
  const second = { text: "b".repeat(24) };
  const firstBytes = estimateJsonUtf8Bytes(first);
  const cache = createRawEventCache({ maxEntries: 3, maxBytes: firstBytes + 2 });
  assert.equal(cache.remember("first", first), true);
  assert.equal(cache.remember("second", second), true);
  assert.equal(cache.get("first"), undefined);
  assert.deepEqual(cache.get("second"), second);
  assert.equal(cache.bytes, estimateJsonUtf8Bytes(second));
  assert.equal(cache.remember("oversized", { text: "x".repeat(200) }), false);
  assert.equal(cache.get("oversized"), undefined);

  const protectedBytes = createRawEventCache({ maxEntries: 1, maxBytes: 1_000 });
  protectedBytes.remember("protected-bytes", { text: "ok" }, { bytes: 0 });
  protectedBytes.remember("replacement", { text: "new" });
  assert.equal(protectedBytes.bytes, estimateJsonUtf8Bytes({ text: "new" }));
});

test("摘要页淘汰时同步丢弃已不在当前诊断页的完整事件", () => {
  const cache = createRawEventCache({ maxEntries: 8, maxBytes: 1_000 });
  cache.remember("old", { raw: "old" }, { sessionKey: "local:session", snapshot: "snapshot", index: 0 });
  cache.remember("current", { raw: "current" }, { sessionKey: "local:session", snapshot: "snapshot", index: 100 });
  cache.remember("other-snapshot", { raw: "other" }, { sessionKey: "local:session", snapshot: "old-snapshot", index: 100 });

  const retainedIndexes = new Set([100, 101]);
  cache.retain((entry) => (
    entry.sessionKey === "local:session"
    && entry.snapshot === "snapshot"
    && retainedIndexes.has(entry.index)
  ));

  assert.equal(cache.get("old"), undefined);
  assert.deepEqual(cache.get("current"), { raw: "current" });
  assert.equal(cache.get("other-snapshot"), undefined);
});
