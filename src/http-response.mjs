import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";

const securityHeaders = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'self'; base-uri 'none'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

const jsonHeaders = {
  ...securityHeaders,
  "content-type": "application/json; charset=utf-8",
};

const textHeaders = {
  ...securityHeaders,
  "content-type": "text/plain; charset=utf-8",
};

const staticTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".json", "application/json; charset=utf-8"],
]);

const publicErrorMessages = new Map([
  ["Bad request", "请求无效"],
  ["Data source not found", "数据源不存在"],
  ["Event not found", "事件不存在"],
  ["Forbidden", "禁止访问该资源"],
  ["Internal server error", "服务内部错误"],

  ["Invalid JSON body", "请求体不是有效 JSON"],
  ["Method not allowed", "请求方法不允许"],
  ["Not found", "未找到资源"],
  ["Peer not found", "远端数据源不存在"],
  ["Request body too large", "请求体过大"],
  ["Session not found", "会话不存在"],
  ["Unauthorized", "未授权访问"],
]);

function send(res, status, headers, body, extraHeaders = {}) {
  res.writeHead(status, { ...headers, ...extraHeaders });
  res.end(body);
}

function sendJson(res, status, body, extraHeaders = {}) {
  send(res, status, jsonHeaders, JSON.stringify(body), extraHeaders);
}

function sendText(res, status, body, extraHeaders = {}) {
  send(res, status, textHeaders, body, extraHeaders);
}

function publicErrorMessage(message) {
  const text = typeof message === "string" ? message : String(message || "");
  return publicErrorMessages.get(text) || text || "请求失败";
}

function sendError(res, status, message, details = null, extraHeaders = {}) {
  sendJson(res, status, { error: publicErrorMessage(message), details }, extraHeaders);
}

function contentTypeForPath(filePath, types = staticTypes) {
  return types.get(path.extname(filePath).toLowerCase()) || "application/octet-stream";
}

function resolveStaticFilePath(publicDir, pathname) {
  const relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  const root = path.resolve(publicDir);
  const filePath = path.resolve(root, relative);
  if (filePath !== root && !filePath.startsWith(root + path.sep)) return null;
  return filePath;
}

async function serveStaticFile(res, publicDir, pathname, options = {}) {
  const fsApi = options.fsApi || fs;
  const createStream = options.createStream || createReadStream;
  const types = options.staticTypes || staticTypes;
  let filePath;
  try {
    filePath = resolveStaticFilePath(publicDir, pathname);
  } catch {
    return sendError(res, 400, "Bad request");
  }
  if (!filePath) return sendError(res, 403, "Forbidden");

  let stat;
  try {
    stat = await fsApi.stat(filePath);
  } catch {
    return sendError(res, 404, "Not found");
  }
  if (!stat.isFile()) return sendError(res, 404, "Not found");

  res.writeHead(200, { ...jsonHeaders, "content-type": contentTypeForPath(filePath, types) });
  createStream(filePath).pipe(res);
}

export {
  contentTypeForPath,
  jsonHeaders,
  publicErrorMessage,
  resolveStaticFilePath,
  send,
  sendError,
  sendJson,
  sendText,
  serveStaticFile,
  staticTypes,
  textHeaders,
};
