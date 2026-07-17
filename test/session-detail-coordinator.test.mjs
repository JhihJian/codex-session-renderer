import assert from "node:assert/strict";
import test from "node:test";
import { createSessionDetailCoordinator } from "../src/session-detail-coordinator.mjs";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function session(id) {
  return { id, path: `/details/${id}.jsonl` };
}

function stat(version) {
  return { size: version.size, mtimeMs: version.mtimeMs, ctimeMs: version.ctimeMs ?? version.mtimeMs };
}

function abortError() {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}

test("详情协调器在服务级读取闸门下限制并发", async () => {
  const started = [];
  const gates = new Map([["a", deferred()], ["b", deferred()], ["c", deferred()]]);
  const coordinator = createSessionDetailCoordinator({
    maxConcurrentReads: 2,
    stat: async () => stat({ size: 10, mtimeMs: 1 }),
    readEvents: async (filePath) => {
      const id = filePath.split("/").at(-1).replace(".jsonl", "");
      started.push(id);
      return gates.get(id).promise;
    },
  });
  const reads = ["a", "b", "c"].map((id) => coordinator.read(session(id), { cacheKey: id }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started.slice().sort(), ["a", "b"]);
  gates.get("a").resolve([{ id: "a" }]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started.length, 3);
  gates.get("b").resolve([{ id: "b" }]);
  gates.get("c").resolve([{ id: "c" }]);
  assert.deepEqual((await Promise.all(reads)).map((result) => result.state), ["ready", "ready", "ready"]);
});

test("详情协调器在最后一个订阅取消后中止读取且不写缓存", async () => {
  let started = 0;
  let aborted = 0;
  const coordinator = createSessionDetailCoordinator({
    stat: async () => stat({ size: 10, mtimeMs: 1 }),
    readEvents: async (_filePath, { signal }) => {
      started += 1;
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          aborted += 1;
          reject(abortError());
        }, { once: true });
      });
    },
  });
  const controller = new AbortController();
  const pending = coordinator.read(session("cancel"), { cacheKey: "cancel", signal: controller.signal });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(started, 1);
  assert.equal(aborted, 1);
  assert.equal(coordinator.cache.size, 0);
});

test("详情协调器检测读取后文件变化，不返回或缓存旧详情", async () => {
  const versions = [stat({ size: 10, mtimeMs: 1 }), stat({ size: 11, mtimeMs: 2 }), stat({ size: 11, mtimeMs: 2 }), stat({ size: 11, mtimeMs: 2 })];
  let statCalls = 0;
  const coordinator = createSessionDetailCoordinator({
    stat: async () => versions[Math.min(statCalls++, versions.length - 1)],
    readEvents: async () => [{ text: "正文" }],
  });
  const result = await coordinator.read(session("changed"), { cacheKey: "changed" });
  assert.equal(result.state, "changing");
  assert.equal(coordinator.cache.size, 0);
});

test("详情协调器拒绝超限文件，并按估算字节维护有限版本 LRU", async () => {
  const versions = new Map([
    ["large", stat({ size: 101, mtimeMs: 1 })],
    ["a", stat({ size: 10, mtimeMs: 1 })],
    ["b", stat({ size: 10, mtimeMs: 1 })],
  ]);
  let reads = 0;
  const coordinator = createSessionDetailCoordinator({
    maxFileBytes: 100,
    maxCacheEntries: 2,
    maxCacheBytes: 70,
    stat: async (filePath) => versions.get(filePath.split("/").at(-1).replace(".jsonl", "")),
    readEvents: async () => {
      reads += 1;
      return [{ text: "x" }];
    },
    derive: undefined,
  });
  const large = await coordinator.read(session("large"), { cacheKey: "large" });
  assert.equal(large.state, "limited");
  assert.equal(large.reason, "file_too_large");
  await coordinator.read(session("a"), { cacheKey: "a", derive: () => ({ payload: "a".repeat(36) }) });
  await coordinator.read(session("b"), { cacheKey: "b", derive: () => ({ payload: "b".repeat(36) }) });
  assert.equal(reads, 2);
  assert.equal(coordinator.cache.size, 1);
  assert.ok(coordinator.cacheBytes <= 70);
});

test("详情派生可在读取闸门释放后读取子会话", async () => {
  const coordinator = createSessionDetailCoordinator({
    maxConcurrentReads: 1,
    stat: async () => stat({ size: 10, mtimeMs: 1 }),
    readEvents: async (filePath) => [{ id: filePath }],
  });
  const parent = await coordinator.read(session("parent"), {
    cacheKey: "parent",
    derive: async () => {
      const child = await coordinator.read(session("child"), { cacheKey: "child" });
      return child.value;
    },
  });
  assert.equal(parent.state, "ready");
  assert.deepEqual(parent.value, [{ id: "/details/child.jsonl" }]);
});