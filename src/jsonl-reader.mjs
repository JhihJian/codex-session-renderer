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

export { safeJsonParse };
