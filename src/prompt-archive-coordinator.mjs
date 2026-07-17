import { promises as fs } from "node:fs";
import { readJsonlWithDiagnostics } from "./jsonl-reader.mjs";
import { buildPromptArchiveEntry, extractFirstPrompt } from "./session-prompts.mjs";

const defaultLimits = {
  maxConcurrentReads: 4,
  maxFileBytes: 2 * 1024 * 1024,
  maxLines: 20_000,
  maxPromptChars: 12_000,
  maxSessions: 200,
};

function createAbortError() {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

function isAbortError(error) {
  return error?.name === "AbortError" || error?.code === "ABORT_ERR";
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw createAbortError();
}

function clampPositive(value, fallback, maximum = Infinity) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(Math.floor(number), maximum);
}

function fileSignature(filePath, stat) {
  return [filePath || "", stat?.size ?? "", stat?.mtimeMs ?? "", stat?.ctimeMs ?? ""].join(":");
}

function limitPrompt(prompt, maxPromptChars) {
  if (!prompt?.text || prompt.text.length <= maxPromptChars) return prompt;
  return limitedPrompt("prompt_too_long");
}

function limitedPrompt(reason) {
  return { state: "too_large", text: null, preview: null, attachments: [], limitReason: reason };
}

function changingPrompt() {
  return { state: "changing", text: null, preview: null, attachments: [], limitReason: "file_changed_during_read" };
}

function entryKey(session, signature) {
  return [session?.sourceId || "local", session?.id || "", signature].join(":");
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

function createPromptArchiveCoordinator(options = {}) {
  const limits = {
    maxConcurrentReads: clampPositive(options.maxConcurrentReads, defaultLimits.maxConcurrentReads, 32),
    maxFileBytes: clampPositive(options.maxFileBytes, defaultLimits.maxFileBytes, 64 * 1024 * 1024),
    maxLines: clampPositive(options.maxLines, defaultLimits.maxLines, 200_000),
    maxPromptChars: clampPositive(options.maxPromptChars, defaultLimits.maxPromptChars, 100_000),
    maxSessions: clampPositive(options.maxSessions, defaultLimits.maxSessions, 1_000),
    maxCacheEntries: clampPositive(options.maxCacheEntries, defaultLimits.maxSessions * 2, 10_000),
  };
  const stat = options.stat || ((filePath) => fs.stat(filePath));
  const readEvents = options.readEvents || ((filePath, readOptions) => readJsonlWithDiagnostics(filePath, readOptions));
  const buildEntry = options.buildEntry || buildPromptArchiveEntry;
  const extractPrompt = options.extractPrompt || extractFirstPrompt;
  const entryCache = new Map();
  const registry = createSharedSubscriptionRegistry();
  const readGate = options.readGate || createConcurrencyGate(limits.maxConcurrentReads);

  async function readStableEntry(session, beforeStat, beforeSignature, signal) {
    throwIfAborted(signal);
    if (beforeStat.size > limits.maxFileBytes) {
      return { entry: buildEntry(session, limitedPrompt("file_too_large")), signature: beforeSignature, cacheable: true };
    }
    const events = await readEvents(session.path, {
      signal,
      maxBytes: limits.maxFileBytes,
      maxLines: limits.maxLines + 1,
    });
    throwIfAborted(signal);
    const afterStat = await stat(session.path);
    const afterSignature = fileSignature(session.path, afterStat);
    if (beforeSignature !== afterSignature) {
      return { entry: buildEntry(session, changingPrompt()), signature: afterSignature, cacheable: false };
    }
    if (events.length > limits.maxLines) {
      return { entry: buildEntry(session, limitedPrompt("too_many_events")), signature: afterSignature, cacheable: true };
    }
    return { entry: buildEntry(session, limitPrompt(extractPrompt(events), limits.maxPromptChars)), signature: afterSignature, cacheable: true };
  }

  async function getEntry(session, { signal } = {}) {
    throwIfAborted(signal);
    if (!session?.path) return buildEntry(session, { state: "unavailable", attachments: [] });
    let beforeStat;
    try {
      beforeStat = await stat(session.path);
    } catch {
      return buildEntry(session, { state: "unavailable", attachments: [] });
    }
    const signature = fileSignature(session.path, beforeStat);
    const key = entryKey(session, signature);
    const cached = entryCache.get(key);
    if (cached) return cached;
    return registry.subscribe(key, async (sharedSignal) => {
      try {
        const stable = await readStableEntry(session, beforeStat, signature, sharedSignal);
        if (stable.cacheable) {
          const identity = `${session?.sourceId || "local"}:${session?.id || ""}:`;
          for (const existingKey of entryCache.keys()) {
            if (existingKey.startsWith(identity)) entryCache.delete(existingKey);
          }
          entryCache.set(entryKey(session, stable.signature), stable.entry);
          while (entryCache.size > limits.maxCacheEntries) entryCache.delete(entryCache.keys().next().value);
        }
        return stable.entry;
      } catch (error) {
        if (isAbortError(error)) throw error;
        return buildEntry(session, { state: "error", attachments: [] });
      }
    }, signal);
  }

  async function list(sessions, { signal } = {}) {
    throwIfAborted(signal);
    const selected = (sessions || []).slice(0, limits.maxSessions);
    const entries = await Promise.all(selected.map((session) => readGate.run(() => getEntry(session, { signal }), signal)));
    return { entries, truncated: (sessions || []).length > selected.length };
  }

  return { getEntry, list, limits, entryCache, inFlight: registry.tasks };
}

export { createAbortError, createConcurrencyGate, createPromptArchiveCoordinator, createSharedSubscriptionRegistry, defaultLimits, fileSignature, isAbortError };