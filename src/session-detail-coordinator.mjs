import { promises as fs } from "node:fs";
import { readJsonlWithDiagnostics } from "./jsonl-reader.mjs";

const defaultSessionDetailLimits = {
  maxConcurrentReads: 4,
  diagnosticMaxFileBytes: 8 * 1024 * 1024,
  maxDiagnosticEventScan: 100_000,
  maxCacheEntries: 24,
  maxCacheBytes: 48 * 1024 * 1024,
};

function createAbortError() {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

function fileSignature(filePath, stat) {
  return [filePath || "", stat?.size ?? "", stat?.mtimeMs ?? "", stat?.ctimeMs ?? ""].join(":");
}

function createSharedSubscriptionRegistry() {
  const tasks = new Map();

  function subscribe(key, start, signal) {
    throwIfAborted(signal);
    let task = tasks.get(key);
    if (task?.controller.signal.aborted) {
      if (tasks.get(key) === task) tasks.delete(key);
      task = null;
    }
    if (!task) {
      const controller = new AbortController();
      task = { controller, key, subscribers: new Set(), promise: null };
      task.promise = Promise.resolve()
        .then(() => start(controller.signal))
        .finally(() => {
          if (tasks.get(task.key) === task) tasks.delete(task.key);
        });
      tasks.set(key, task);
    }
    return new Promise((resolve, reject) => {
      const subscriber = { active: true };
      task.subscribers.add(subscriber);
      const detach = () => {
        if (!subscriber.active) return;
        subscriber.active = false;
        task.subscribers.delete(subscriber);
        signal?.removeEventListener("abort", onAbort);
        if (task.subscribers.size === 0 && tasks.get(task.key) === task && !task.controller.signal.aborted) task.controller.abort();
      };
      const onAbort = () => {
        detach();
        reject(createAbortError());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      task.promise.then(
        (value) => {
          if (!subscriber.active) return;
          detach();
          resolve(value);
        },
        (error) => {
          if (!subscriber.active) return;
          detach();
          reject(error);
        },
      );
    });
  }

  return { subscribe, tasks };
}

function createConcurrencyGate(maxConcurrent) {
  let active = 0;
  const queue = [];
  function drain() {
    while (active < maxConcurrent && queue.length > 0) {
      const job = queue.shift();
      if (job.signal?.aborted) {
        job.reject(createAbortError());
        continue;
      }
      active += 1;
      job.signal?.removeEventListener("abort", job.onAbort);
      Promise.resolve()
        .then(job.work)
        .then(job.resolve, job.reject)
        .finally(() => {
          active -= 1;
          drain();
        });
    }
  }
  function run(work, signal) {
    throwIfAborted(signal);
    return new Promise((resolve, reject) => {
      const job = {
        work,
        signal,
        resolve,
        reject,
        onAbort: () => {
          const index = queue.indexOf(job);
          if (index >= 0) queue.splice(index, 1);
          reject(createAbortError());
        },
      };
      signal?.addEventListener("abort", job.onAbort, { once: true });
      queue.push(job);
      drain();
    });
  }
  return { run };
}

function isAbortError(error) {
  return error?.name === "AbortError" || error?.code === "ABORT_ERR";
}

function clampPositive(value, fallback, maximum = Infinity) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(Math.floor(number), maximum);
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw createAbortError();
}

function estimateBytes(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return Infinity;
  }
}

function createSessionDetailCoordinator(options = {}) {
  const limits = {
    maxConcurrentReads: clampPositive(options.maxConcurrentReads, defaultSessionDetailLimits.maxConcurrentReads, 32),
    diagnosticMaxFileBytes: clampPositive(options.diagnosticMaxFileBytes, defaultSessionDetailLimits.diagnosticMaxFileBytes, 256 * 1024 * 1024),
    maxDiagnosticEventScan: clampPositive(options.maxDiagnosticEventScan, defaultSessionDetailLimits.maxDiagnosticEventScan, 500_000),
    maxCacheEntries: clampPositive(options.maxCacheEntries, defaultSessionDetailLimits.maxCacheEntries, 2_000),
    maxCacheBytes: clampPositive(options.maxCacheBytes, defaultSessionDetailLimits.maxCacheBytes, 512 * 1024 * 1024),
  };
  const stat = options.stat || ((filePath) => fs.stat(filePath));
  const readEvents = options.readEvents || ((filePath, readOptions) => readJsonlWithDiagnostics(filePath, readOptions));
  const readGate = options.readGate || createConcurrencyGate(limits.maxConcurrentReads);
  const cache = new Map();
  const registry = createSharedSubscriptionRegistry();
  let cacheBytes = 0;

  function remove(cacheKey) {
    const entry = cache.get(cacheKey);
    if (!entry) return;
    cache.delete(cacheKey);
    cacheBytes -= entry.bytes;
  }

  function remember(cacheKey, signature, value) {
    const bytes = estimateBytes(value);
    if (!Number.isFinite(bytes) || bytes > limits.maxCacheBytes) return;
    remove(cacheKey);
    cache.set(cacheKey, { signature, value, bytes });
    cacheBytes += bytes;
    while (cache.size > limits.maxCacheEntries || cacheBytes > limits.maxCacheBytes) remove(cache.keys().next().value);
  }

  function cached(cacheKey, signature) {
    const entry = cache.get(cacheKey);
    if (!entry || entry.signature !== signature) return null;
    // Map insertion order is the LRU order.
    cache.delete(cacheKey);
    cache.set(cacheKey, entry);
    return entry.value;
  }

  async function read(session, { cacheKey, signal, derive = (events) => events, shouldCache = () => true } = {}) {
    throwIfAborted(signal);
    if (!session?.path) return { state: "unavailable", code: "session_file_unavailable", reason: "missing_session_path" };
    const beforeStat = await stat(session.path);
    throwIfAborted(signal);
    const signature = fileSignature(session.path, beforeStat);
    const existing = cached(cacheKey, signature);
    if (existing) return { state: "ready", value: existing, stat: beforeStat, signature, cached: true };

    return registry.subscribe(
      `${cacheKey}:${signature}`,
      async (sharedSignal) => {
        const events = await readGate.run(
          () => readEvents(session.path, { signal: sharedSignal }),
          sharedSignal,
        );
        throwIfAborted(sharedSignal);
        const value = await derive(events, beforeStat, sharedSignal);
        throwIfAborted(sharedSignal);
        if (shouldCache(value)) remember(cacheKey, signature, value);
        return { state: "ready", value, stat: beforeStat, signature, cached: false };
      },
      signal,
    );
  }

  return { cache, get cacheBytes() { return cacheBytes; }, inFlight: registry.tasks, limits, read, readGate };
}

export {
  createAbortError,
  createConcurrencyGate,
  createSessionDetailCoordinator,
  defaultSessionDetailLimits,
  fileSignature,
  isAbortError,
};