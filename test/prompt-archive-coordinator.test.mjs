import assert from "node:assert/strict";
import test from "node:test";
import { createPromptArchiveCoordinator } from "../src/prompt-archive-coordinator.mjs";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function abortError() {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}

function session(id) {
  return {
    id,
    sourceId: "local",
    sourceLabel: "本机",
    title: id,
    path: `/archive/${id}.jsonl`,
  };
}

function stat(version) {
  return { size: version.size, mtimeMs: version.mtimeMs, ctimeMs: version.ctimeMs ?? version.mtimeMs };
}

function promptFromEvents(events) {
  return {
    state: "found",
    text: events[0],
    preview: events[0],
    attachments: [],
  };
}

function waitForCount(values, count) {
  if (values.length >= count) return Promise.resolve();
  return new Promise((resolve) => {
    values.onCount = () => {
      if (values.length >= count) resolve();
    };
  });
}

function push(values, value) {
  values.push(value);
  values.onCount?.();
}

test("归档协调器限制慢读取并发且不会提前启动后续文件", async () => {
  const started = [];
  const gates = new Map([["a", deferred()], ["b", deferred()], ["c", deferred()], ["d", deferred()]]);
  const coordinator = createPromptArchiveCoordinator({
    maxConcurrentReads: 2,
    stat: async () => stat({ size: 10, mtimeMs: 1 }),
    extractPrompt: promptFromEvents,
    readEvents: async (filePath) => {
      const id = filePath.split("/").at(-1).replace(".jsonl", "");
      push(started, id);
      return gates.get(id).promise;
    },
  });
  const listed = coordinator.list([session("a"), session("b"), session("c"), session("d")]);
  await waitForCount(started, 2);
  assert.deepEqual(started.slice().sort(), ["a", "b"]);
  gates.get("a").resolve(["A"]);
  await waitForCount(started, 3);
  assert.equal(started.length, 3);
  gates.get("b").resolve(["B"]);
  await waitForCount(started, 4);
  gates.get("c").resolve(["C"]);
  gates.get("d").resolve(["D"]);
  assert.deepEqual((await listed).entries.map((entry) => entry.promptText), ["A", "B", "C", "D"]);
});

test("归档协调器在并发请求之间共享读取配额", async () => {
  const started = [];
  const gates = new Map([["a", deferred()], ["b", deferred()], ["c", deferred()], ["d", deferred()]]);
  const coordinator = createPromptArchiveCoordinator({
    maxConcurrentReads: 2,
    stat: async () => stat({ size: 10, mtimeMs: 1 }),
    extractPrompt: promptFromEvents,
    readEvents: async (filePath) => {
      const id = filePath.split("/").at(-1).replace(".jsonl", "");
      push(started, id);
      return gates.get(id).promise;
    },
  });
  const first = coordinator.list([session("a"), session("b")]);
  const second = coordinator.list([session("c"), session("d")]);
  await waitForCount(started, 2);
  assert.deepEqual(started.slice().sort(), ["a", "b"]);
  gates.get("a").resolve(["A"]);
  await waitForCount(started, 3);
  gates.get("b").resolve(["B"]);
  await waitForCount(started, 4);
  gates.get("c").resolve(["C"]);
  gates.get("d").resolve(["D"]);
  await Promise.all([first, second]);
});

test("取消唯一订阅会中止慢读取且不留下缓存", async () => {
  const started = [];
  let aborts = 0;
  const coordinator = createPromptArchiveCoordinator({
    stat: async () => stat({ size: 10, mtimeMs: 1 }),
    extractPrompt: promptFromEvents,
    readEvents: async (_filePath, { signal }) => {
      push(started, true);
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          aborts += 1;
          reject(abortError());
        }, { once: true });
      });
    },
  });
  const controller = new AbortController();
  const pending = coordinator.getEntry(session("single"), { signal: controller.signal });
  await waitForCount(started, 1);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(aborts, 1);
  assert.equal(coordinator.entryCache.size, 0);
});

test("取消一个共享订阅不会中止仍在等待的订阅", async () => {
  const started = [];
  const gate = deferred();
  let aborts = 0;
  const coordinator = createPromptArchiveCoordinator({
    stat: async () => stat({ size: 10, mtimeMs: 1 }),
    extractPrompt: promptFromEvents,
    readEvents: async (_filePath, { signal }) => {
      push(started, true);
      signal.addEventListener("abort", () => {
        aborts += 1;
        gate.reject(abortError());
      }, { once: true });
      return gate.promise;
    },
  });
  const firstController = new AbortController();
  const first = coordinator.getEntry(session("shared"), { signal: firstController.signal });
  const second = coordinator.getEntry(session("shared"));
  await waitForCount(started, 1);
  firstController.abort();
  await assert.rejects(first, { name: "AbortError" });
  assert.equal(aborts, 0);
  gate.resolve(["仍应完成"]);
  assert.equal((await second).promptText, "仍应完成");
  assert.equal(started.length, 1);
});

test("文件读取中变化时不返回或缓存旧版本，后续新签名才读取", async () => {
  const versions = [stat({ size: 10, mtimeMs: 1 }), stat({ size: 11, mtimeMs: 2 }), stat({ size: 11, mtimeMs: 2 }), stat({ size: 11, mtimeMs: 2 })];
  let statCalls = 0;
  let reads = 0;
  const coordinator = createPromptArchiveCoordinator({
    stat: async () => versions[Math.min(statCalls++, versions.length - 1)],
    extractPrompt: promptFromEvents,
    readEvents: async () => [reads++ === 0 ? "旧正文" : "新正文"],
  });
  const first = await coordinator.getEntry(session("changed"));
  const second = await coordinator.getEntry(session("changed"));
  assert.equal(first.promptState, "changing");
  assert.equal(first.promptText, null);
  assert.equal(second.promptText, "新正文");
  assert.equal(reads, 2);
  assert.equal(coordinator.entryCache.size, 1);
});

test("超长提示词受限，而超大文件的有界前缀仍可归档首个任务", async () => {
  let reads = 0;
  const readOptions = [];
  const coordinator = createPromptArchiveCoordinator({
    maxPromptChars: 8,
    maxFileBytes: 100,
    stat: async (filePath) => stat(filePath.includes("large") ? { size: 101, mtimeMs: 1 } : { size: 10, mtimeMs: 1 }),
    extractPrompt: promptFromEvents,
    readEvents: async (_filePath, options) => {
      reads += 1;
      readOptions.push(options);
      return _filePath.includes("large-long")
        ? ["这是一段明显超过上限且不应完整进入响应的提示词"]
        : _filePath.includes("large")
        ? ["大文件前缀任务"]
        : ["这是一段明显超过上限且不应完整进入响应的提示词"];
    },
  });
  const longPrompt = await coordinator.getEntry(session("long"));
  const largeFile = await coordinator.getEntry(session("large"));
  const largeLongPrompt = await coordinator.getEntry(session("large-long"));
  assert.equal(longPrompt.promptState, "too_large");
  assert.equal(longPrompt.promptText, null);
  assert.equal(longPrompt.promptLimitReason, "prompt_too_long");
  assert.equal(largeFile.promptState, "found");
  assert.equal(largeFile.promptText, "大文件前缀任务");
  assert.equal(largeFile.sessionTitle, "未命名会话");
  assert.equal(largeLongPrompt.promptState, "too_large");
  assert.equal(largeLongPrompt.promptLimitReason, "prompt_too_long");
  assert.equal(largeLongPrompt.promptText, null);
  assert.equal(largeLongPrompt.sessionTitle, "未命名会话");
  assert.equal(reads, 3);
  assert.equal((await coordinator.getEntry(session("large"))).promptText, "大文件前缀任务");
  assert.equal(reads, 3);
  assert.equal(readOptions[1].maxBytes, 100);
  assert.equal(readOptions[1].maxLines, 20_001);
  assert.equal(readOptions[1].signal.aborted, false);
});

test("超大文件在有界前缀未找到任务时受限且不泄露目录标题", async () => {
  const coordinator = createPromptArchiveCoordinator({
    maxFileBytes: 100,
    stat: async () => stat({ size: 101, mtimeMs: 1 }),
    extractPrompt: () => ({ state: "empty", text: null, preview: null, attachments: [] }),
    readEvents: async () => ["没有有效用户提示词"],
  });

  const entry = await coordinator.getEntry({ ...session("no-prompt"), title: "前缀外不应返回的恶意标题" });

  assert.equal(entry.promptState, "too_large");
  assert.equal(entry.promptLimitReason, "file_too_large");
  assert.equal(entry.promptText, null);
  assert.equal(entry.sessionTitle, "未命名会话");
});

test("额外事件探针不参与提取，前缀内首任务仍优先成功", async () => {
  const extracted = [];
  const coordinator = createPromptArchiveCoordinator({
    maxLines: 2,
    stat: async () => stat({ size: 10, mtimeMs: 1 }),
    extractPrompt: (events) => {
      extracted.push(events);
      return events.includes("前缀任务")
        ? { state: "found", text: "前缀任务", preview: "前缀任务", attachments: [] }
        : { state: "empty", text: null, preview: null, attachments: [] };
    },
    readEvents: async () => ["前缀任务", "第二条", "探针中的伪任务"],
  });

  const entry = await coordinator.getEntry(session("event-probe"));

  assert.equal(entry.promptState, "found");
  assert.equal(entry.promptText, "前缀任务");
  assert.deepEqual(extracted, [["前缀任务", "第二条"]]);
});

test("首次 stat 后取消会传播且不命中缓存", async () => {
  const statGate = deferred();
  const coordinator = createPromptArchiveCoordinator({
    stat: async () => statGate.promise,
    extractPrompt: promptFromEvents,
    readEvents: async () => ["不应读取"],
  });
  const controller = new AbortController();
  const pending = coordinator.getEntry(session("cancel-stat"), { signal: controller.signal });

  controller.abort();
  statGate.resolve(stat({ size: 10, mtimeMs: 1 }));

  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(coordinator.entryCache.size, 0);
});

test("读取后的签名检查期间取消不会缓存前缀结果", async () => {
  const afterStatGate = deferred();
  const readStarted = deferred();
  let statCalls = 0;
  const coordinator = createPromptArchiveCoordinator({
    stat: async () => (statCalls++ === 0 ? stat({ size: 10, mtimeMs: 1 }) : afterStatGate.promise),
    extractPrompt: promptFromEvents,
    readEvents: async () => {
      readStarted.resolve();
      return ["不应缓存的前缀任务"];
    },
  });
  const controller = new AbortController();
  const pending = coordinator.getEntry(session("cancel-after-read"), { signal: controller.signal });

  await readStarted.promise;
  controller.abort();
  afterStatGate.resolve(stat({ size: 10, mtimeMs: 1 }));

  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(coordinator.entryCache.size, 0);
});

test("相同稳定文件签名命中缓存而不重复读取", async () => {
  let reads = 0;
  const coordinator = createPromptArchiveCoordinator({
    stat: async () => stat({ size: 10, mtimeMs: 1 }),
    extractPrompt: promptFromEvents,
    readEvents: async () => {
      reads += 1;
      return ["稳定提示词"];
    },
  });
  assert.equal((await coordinator.getEntry(session("cached"))).promptText, "稳定提示词");
  assert.equal((await coordinator.getEntry(session("cached"))).promptText, "稳定提示词");
  assert.equal(reads, 1);
});