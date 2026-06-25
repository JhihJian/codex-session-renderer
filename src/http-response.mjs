import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

const textHeaders = {
  "content-type": "text/plain; charset=utf-8",
  "cache-control": "no-store",
};

const staticTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".json", "application/json; charset=utf-8"],
]);

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

function sendJson(res, status, body) {
  send(res, status, jsonHeaders, JSON.stringify(body));
}

function sendText(res, status, body) {
  send(res, status, textHeaders, body);
}

function sendError(res, status, message, details = null) {
  sendJson(res, status, { error: message, details });
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

  res.writeHead(200, { "content-type": contentTypeForPath(filePath, types), "cache-control": "no-store" });
  createStream(filePath).pipe(res);
}

export {
  contentTypeForPath,
  jsonHeaders,
  resolveStaticFilePath,
  send,
  sendError,
  sendJson,
  sendText,
  serveStaticFile,
  staticTypes,
  textHeaders,
};
