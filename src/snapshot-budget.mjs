import { Transform } from "node:stream";
import { throwIfAborted } from "./remote-http.mjs";

function snapshotBudgetError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  if (status) error.status = status;
  return error;
}

function createContentBudget(options = {}) {
  const maxBytes = Number(options.maxBytes);
  const maxFiles = Number(options.maxFiles);
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || !Number.isSafeInteger(maxFiles) || maxFiles <= 0) {
    throw snapshotBudgetError(options.invalidCode || "snapshot_invalid_budget", "快照预算配置无效。", options.status);
  }
  let bytes = 0;
  let files = 0;

  function addEntry(signal) {
    throwIfAborted(signal);
    files += 1;
    if (files > maxFiles) {
      throw snapshotBudgetError(options.filesCode, `快照文件数超过 ${maxFiles} 个限制。`, options.status);
    }
  }

  function addFile(size, signal) {
    addEntry(signal);
    const fileBytes = Number(size);
    if (!Number.isSafeInteger(fileBytes) || fileBytes < 0) {
      throw snapshotBudgetError(options.invalidCode || "snapshot_invalid_archive", "快照文件大小无效。", options.status);
    }
    bytes += fileBytes;
    if (bytes > maxBytes) {
      throw snapshotBudgetError(options.bytesCode, `快照内容超过 ${maxBytes} 字节限制。`, options.status);
    }
  }

  return {
    addEntry,
    addFile,
    get bytes() {
      return bytes;
    },
    get files() {
      return files;
    },
  };
}

function createByteLimitTransform(options = {}) {
  const maxBytes = Number(options.maxBytes);
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw snapshotBudgetError(options.invalidCode || "snapshot_invalid_budget", "快照预算配置无效。", options.status);
  }
  let bytes = 0;
  return new Transform({
    transform(chunk, encoding, callback) {
      try {
        throwIfAborted(options.signal);
        bytes += chunk.length;
        if (bytes > maxBytes) {
          throw snapshotBudgetError(options.code, `快照产物超过 ${maxBytes} 字节限制。`, options.status);
        }
        callback(null, chunk);
      } catch (error) {
        callback(error);
      }
    },
  });
}

export { createByteLimitTransform, createContentBudget, snapshotBudgetError };