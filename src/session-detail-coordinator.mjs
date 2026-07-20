import { promises as fs } from "node:fs";
import {
  createAbortError,
  createConcurrencyGate,
  createSharedSubscriptionRegistry,
  fileSignature,
} from "./prompt-archive-coordinator.mjs";
import { readJsonlWithDiagnostics } from "./jsonl-reader.mjs";

const defaultSessionDetailLimits = {
  maxConcurrentReads: 4,
  diagnosticMaxFileBytes: 8 * 1024 * 1024,
  maxDiagnosticEventScan: 100_000,
  maxCacheEntries: 24,
  maxCacheBytes: 48 * 1024 * 1024,
};

function clampPositive(value, fallback, maximum = Infinity) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(Math.floor(number), maximum);
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw createAbortError();
}

function changingRead(stat) {
  return {
    state: "changing",
    code: "session_file_changed",
    reason: "file_changed_during_read",
    fileSizeBytes: stat?.size ?? null,

  };
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
        const afterReadStat = await stat(session.path);
        if (signature !== fileSignature(session.path, afterReadStat)) return changingRead(afterReadStat);
        const value = await derive(events, afterReadStat, sharedSignal);
        throwIfAborted(sharedSignal);
        const afterDeriveStat = await stat(session.path);
        if (signature !== fileSignature(session.path, afterDeriveStat)) return changingRead(afterDeriveStat);
        if (shouldCache(value)) remember(cacheKey, signature, value);
        return { state: "ready", value, stat: afterDeriveStat, signature, cached: false };
      },
      signal,
    );
  }

  return { cache, get cacheBytes() { return cacheBytes; }, inFlight: registry.tasks, limits, read, readGate };
}

export { changingRead, createSessionDetailCoordinator, defaultSessionDetailLimits };