import { open } from "node:fs/promises";

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

function parseLine(line, index, lineNumber) {
  try {
    return JSON.parse(line);
  } catch (error) {
    return diagnosticEventFromInvalidLine(line, index, lineNumber, error);
  }
}

async function readBytes(filePath, start, end) {
  const length = Math.max(0, end - start);
  if (!length) return Buffer.alloc(0);
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Reads only records terminated by a newline. A JSONL writer may leave its
 * current record half-written, which is normal for an active session.
 */
export async function readCommittedJsonlChunk(filePath, { startOffset = 0, endOffset, startIndex = 0, startLineNumber = 0 } = {}) {
  const start = Math.max(0, Math.floor(startOffset));
  const end = Math.max(start, Math.floor(endOffset ?? start));
  const bytes = await readBytes(filePath, start, end);
  const newline = bytes.lastIndexOf(0x0a);
  if (newline < 0) {
    return { events: [], committedByteOffset: start, recordCount: 0, lineCount: 0 };
  }

  const committed = bytes.subarray(0, newline + 1);
  const lines = committed.toString("utf8").split("\n");
  lines.pop();
  const events = [];
  let recordIndex = startIndex;
  let lineNumber = startLineNumber;
  for (let line of lines) {
    lineNumber += 1;
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (!line.trim()) continue;
    events.push(parseLine(line, recordIndex, lineNumber));
    recordIndex += 1;
  }
  return {
    events,
    committedByteOffset: start + newline + 1,
    recordCount: recordIndex - startIndex,
    lineCount: lineNumber - startLineNumber,
  };
}
