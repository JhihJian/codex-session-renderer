import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

function createAbortError() {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  error.code = "ABORT_ERR";
  return error;
}

function isAbortError(error) {
  return error?.name === "AbortError" || error?.code === "ABORT_ERR";
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (signal.reason?.code && signal.reason.code !== "ABORT_ERR") throw signal.reason;
  throw createAbortError();
}

function createDeadlineSignal(signal, deadlineMs, timeoutCode = "remote_deadline_exceeded") {
  const controller = new AbortController();
  const abort = () => controller.abort(createAbortError());
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timer = Number.isFinite(deadlineMs) && deadlineMs > 0
    ? setTimeout(() => controller.abort(cappedError(timeoutCode, `远端请求超过 ${deadlineMs}ms 时限。`)), deadlineMs)
    : null;
  return {
    signal: controller.signal,
    dispose: () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    },
  };
}

function cappedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function abortReason(signal) {
  if (!signal?.aborted) return null;
  if (signal.reason?.code && signal.reason.code !== "ABORT_ERR") return signal.reason;
  return createAbortError();
}

function contentLength(response) {
  const value = response?.headers?.get?.("content-length");
  if (!value || !/^\d+$/.test(value.trim())) return null;
  const length = Number(value);
  return Number.isSafeInteger(length) ? length : null;
}

function assertDeclaredLength(response, maxBytes, code = "remote_response_too_large") {
  const declared = contentLength(response);
  if (declared != null && declared > maxBytes) throw cappedError(code, `远端响应声明长度超过 ${maxBytes} 字节限制。`);
  return declared;
}

function limitResponseBody(response, options = {}) {
  const maxBytes = options.maxBytes;
  const code = options.code || "remote_response_too_large";
  assertDeclaredLength(response, maxBytes, code);
  if (!response?.body) throw cappedError(options.missingBodyCode || "remote_response_missing_body", "远端响应没有可读取的正文。");
  let received = 0;
  return Readable.fromWeb(response.body).pipe(new Transform({
    transform(chunk, encoding, callback) {
      received += chunk.length;
      if (received > maxBytes) return callback(cappedError(code, `远端响应实际字节超过 ${maxBytes} 字节限制。`));
      return callback(null, chunk);
    },
  }));
}

async function readLimitedResponseText(response, options = {}) {
  const chunks = [];
  for await (const chunk of limitResponseBody(response, options)) {
    throwIfAborted(options.signal);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function pipelineLimitedResponse(response, writable, options = {}) {
  await pipeline(limitResponseBody(response, options), writable, { signal: options.signal });
}

async function fetchWithDeadline(fetchImpl, url, init = {}, options = {}) {
  const controller = new AbortController();
  const deadlineMs = options.deadlineMs;
  let timedOut = false;
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  const timer = Number.isFinite(deadlineMs) && deadlineMs > 0
    ? setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, deadlineMs)
    : null;
  try {
    throwIfAborted(options.signal);
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    const aborted = abortReason(options.signal);
    if (aborted) throw aborted;
    if (timedOut) throw cappedError(options.timeoutCode || "remote_deadline_exceeded", `远端请求超过 ${deadlineMs}ms 时限。`);
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

export {
  assertDeclaredLength,
  createDeadlineSignal,
  createAbortError,
  fetchWithDeadline,
  isAbortError,
  limitResponseBody,
  pipelineLimitedResponse,
  readLimitedResponseText,
  throwIfAborted,
};