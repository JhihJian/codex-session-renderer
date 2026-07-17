import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

function safeJsonParse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function parseJsonlRecord(line, index, lineNumber) {
  try {
    return {
      index,
      lineNumber,
      valid: true,
      event: JSON.parse(line),
    };
  } catch (error) {
    return {
      index,
      lineNumber,
      valid: false,
      error: {
        code: "invalid-json",
        message: error?.message || "Invalid JSON",
      },
      rawLine: line,
      event: diagnosticEventFromInvalidLine(line, index, lineNumber, error),
    };
  }
}

function diagnosticEventFromInvalidLine(line, index, lineNumber, error) {
  const preview = String(line || "").replace(/\s+/g, " ").trim().slice(0, 220);
  return {
    type: "jsonl_parse_error",
    __jsonlDiagnostic: true,
    index,
    lineNumber,
    payload: {
      type: "jsonl_parse_error",
      lineNumber,
      code: "invalid-json",
      message: error?.message || "Invalid JSON",
      preview,
    },
  };
}

async function closeReader(reader, stream) {
  reader.close();
  stream.destroy();
}

function abortError() {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function createJsonlReader(filePath, { signal, maxBytes = Infinity } = {}) {
  throwIfAborted(signal);
  const streamOptions = { encoding: "utf8" };
  if (Number.isFinite(maxBytes)) streamOptions.end = Math.max(0, Math.floor(maxBytes) - 1);
  const stream = createReadStream(filePath, streamOptions);
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  const onAbort = () => stream.destroy(abortError());
  signal?.addEventListener("abort", onAbort, { once: true });
  return {
    reader,
    close: async () => {
      signal?.removeEventListener("abort", onAbort);
      await closeReader(reader, stream);
    },
  };
}

export async function readJsonl(filePath, { maxLines = Infinity, maxBytes = Infinity, signal } = {}) {
  const items = [];
  if (maxLines <= 0) return items;

  const { reader, close } = createJsonlReader(filePath, { signal, maxBytes });
  try {
    for await (const line of reader) {
      throwIfAborted(signal);
      if (items.length >= maxLines) break;
      if (!line.trim()) continue;
      const obj = safeJsonParse(line);
      if (obj) items.push(obj);
    }
  } finally {
    await close();
  }
  return items;
}

export async function readJsonlWithDiagnostics(filePath, { maxLines = Infinity, maxBytes = Infinity, signal } = {}) {
  const items = [];
  if (maxLines <= 0) return items;

  const { reader, close } = createJsonlReader(filePath, { signal, maxBytes });
  let index = 0;
  let lineNumber = 0;
  try {
    for await (const line of reader) {
      throwIfAborted(signal);
      lineNumber += 1;
      if (!line.trim()) continue;
      if (items.length >= maxLines) break;
      const record = parseJsonlRecord(line, index, lineNumber);
      items.push(record.event);
      index += 1;
    }
  } finally {
    await close();
  }
  return items;
}

export async function readJsonlLine(filePath, targetIndex, { signal, maxBytes = Infinity, maxScan = Infinity } = {}) {
  if (!Number.isInteger(targetIndex) || targetIndex < 0) return null;

  const { reader, close } = createJsonlReader(filePath, { signal, maxBytes });
  let index = 0;
  try {
    for await (const line of reader) {
      throwIfAborted(signal);
      if (!line.trim()) continue;
      if (index >= maxScan) return null;
      if (index === targetIndex) return safeJsonParse(line);
      index += 1;
    }
  } finally {
    await close();
  }
  return null;
}

export async function readJsonlLineWithDiagnostics(filePath, targetIndex, { signal, maxBytes = Infinity, maxScan = Infinity } = {}) {
  if (!Number.isInteger(targetIndex) || targetIndex < 0) return null;

  const { reader, close } = createJsonlReader(filePath, { signal, maxBytes });
  let index = 0;
  let lineNumber = 0;
  try {
    for await (const line of reader) {
      throwIfAborted(signal);
      lineNumber += 1;
      if (!line.trim()) continue;
      if (index >= maxScan) return null;
      if (index === targetIndex) return parseJsonlRecord(line, index, lineNumber).event;
      index += 1;
    }
  } finally {
    await close();
  }
  return null;
}

export async function readJsonlRange(filePath, { start = 0, limit = 100, maxScan = 5000, maxBytes = Infinity, predicate = null, includeInvalid = false, signal } = {}) {
  const safeStart = Number.isInteger(start) && start > 0 ? start : 0;
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 100;
  const safeMaxScan = Number.isInteger(maxScan) && maxScan > 0 ? maxScan : 5000;
  const items = [];
  const { reader, close } = createJsonlReader(filePath, { signal, maxBytes });
  let index = 0;
  let lineNumber = 0;
  let scanned = 0;
  let lastIndex = safeStart - 1;
  let reachedEnd = true;
  try {
    for await (const line of reader) {
      throwIfAborted(signal);
      lineNumber += 1;
      if (!line.trim()) continue;
      if (index < safeStart) {
        index += 1;
        continue;
      }
      if (items.length >= safeLimit || scanned >= safeMaxScan) {
        reachedEnd = false;
        break;
      }
      const record = parseJsonlRecord(line, index, lineNumber);
      lastIndex = index;
      scanned += 1;
      if (record.valid) {
        if (!predicate || predicate(record.event, index)) items.push({ index, event: record.event });
      } else if (includeInvalid && (!predicate || predicate(record.event, index))) {
        items.push({ index, event: record.event });
      }
      index += 1;
    }
  } finally {
    await close();
  }
  return {
    items,
    start: safeStart,
    limit: safeLimit,
    scanned,
    nextCursor: lastIndex >= safeStart ? lastIndex + 1 : safeStart,
    exhausted: reachedEnd,
  };
}

export { diagnosticEventFromInvalidLine, parseJsonlRecord, safeJsonParse };
