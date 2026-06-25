import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

function safeJsonParse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

async function closeReader(reader, stream) {
  reader.close();
  stream.destroy();
}

export async function readJsonl(filePath, { maxLines = Infinity } = {}) {
  const items = [];
  if (maxLines <= 0) return items;

  const stream = createReadStream(filePath, { encoding: "utf8" });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of reader) {
      if (items.length >= maxLines) break;
      if (!line.trim()) continue;
      const obj = safeJsonParse(line);
      if (obj) items.push(obj);
    }
  } finally {
    await closeReader(reader, stream);
  }
  return items;
}

export async function readJsonlLine(filePath, targetIndex) {
  if (!Number.isInteger(targetIndex) || targetIndex < 0) return null;

  const stream = createReadStream(filePath, { encoding: "utf8" });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  let index = 0;
  try {
    for await (const line of reader) {
      if (!line.trim()) continue;
      if (index === targetIndex) {
        return safeJsonParse(line);
      }
      index += 1;
    }
  } finally {
    await closeReader(reader, stream);
  }
  return null;
}

export async function readJsonlRange(filePath, { start = 0, limit = 100, maxScan = 5000, predicate = null } = {}) {
  const safeStart = Number.isInteger(start) && start > 0 ? start : 0;
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 100;
  const safeMaxScan = Number.isInteger(maxScan) && maxScan > 0 ? maxScan : 5000;
  const items = [];
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  let index = 0;
  let scanned = 0;
  let lastIndex = safeStart - 1;
  let reachedEnd = true;
  try {
    for await (const line of reader) {
      if (!line.trim()) continue;
      if (index < safeStart) {
        index += 1;
        continue;
      }
      if (items.length >= safeLimit || scanned >= safeMaxScan) {
        reachedEnd = false;
        break;
      }

      const obj = safeJsonParse(line);
      lastIndex = index;
      scanned += 1;
      if (obj && (!predicate || predicate(obj, index))) {
        items.push({ index, event: obj });
      }
      index += 1;
    }
  } finally {
    await closeReader(reader, stream);
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

export { safeJsonParse };
