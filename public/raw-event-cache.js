(function () {
  const defaultRawEventCacheLimits = {
    maxEntries: 24,
    maxBytes: 8 * 1024 * 1024,
  };

  function clampPositive(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
  }

  function estimateJsonUtf8Bytes(value) {
    try {
      return new TextEncoder().encode(JSON.stringify(value)).byteLength;
    } catch {
      return Infinity;
    }
  }

  function createRawEventCache(options = {}) {
    const limits = {
      maxEntries: clampPositive(options.maxEntries, defaultRawEventCacheLimits.maxEntries),
      maxBytes: clampPositive(options.maxBytes, defaultRawEventCacheLimits.maxBytes),
    };
    const entries = new Map();
    let bytes = 0;

    function remove(key) {
      const entry = entries.get(key);
      if (!entry) return false;
      entries.delete(key);
      bytes -= entry.bytes;
      return true;
    }

    function trim() {
      while (entries.size > limits.maxEntries || bytes > limits.maxBytes) remove(entries.keys().next().value);
    }

    return {
      limits,
      get size() { return entries.size; },
      get bytes() { return bytes; },
      clear() {
        entries.clear();
        bytes = 0;
      },
      get(key) {
        const entry = entries.get(key);
        if (!entry) return undefined;
        entries.delete(key);
        entries.set(key, entry);
        return entry.value;
      },
      remember(key, value, metadata = {}) {
        const entryBytes = estimateJsonUtf8Bytes(value);
        if (!Number.isFinite(entryBytes) || entryBytes > limits.maxBytes) return false;
        remove(key);
        entries.set(key, { ...metadata, value, bytes: entryBytes });
        bytes += entryBytes;
        trim();
        return entries.has(key);
      },
      retain(predicate) {
        for (const [key, entry] of entries) {
          if (!predicate(entry, key)) remove(key);
        }
      },
    };
  }

  const api = { createRawEventCache, defaultRawEventCacheLimits, estimateJsonUtf8Bytes };
  if (typeof window !== "undefined") window.RawEventCache = api;
  if (typeof globalThis !== "undefined" && !globalThis.RawEventCache) globalThis.RawEventCache = api;
}());
