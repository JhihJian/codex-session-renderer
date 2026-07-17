import { createHash, timingSafeEqual } from "node:crypto";
import { sendError } from "./http-response.mjs";

const basicRealm = "Codex Session Renderer";

function isLoopbackHost(host) {
  const value = String(host || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  return value === "::1" || /^127(?:\.\d{1,3}){3}$/.test(value);
}

function createAccessControl(options = {}) {
  const host = options.host || "127.0.0.1";
  const token = String(options.token || "");
  const required = !isLoopbackHost(host);
  return {
    required,
    authorize: (request) => !required || isAuthorizedRequest(request, token),
  };
}

function assertSecureListenConfig(options = {}) {
  const host = options.host || "127.0.0.1";
  if (!isLoopbackHost(host) && !String(options.token || "")) {
    const error = new Error("非 loopback 监听必须设置 CODEX_SESSION_RENDERER_TOKEN。");
    error.code = "missing_access_token";
    throw error;
  }
}

function requireAuthorizedRequest(request, response, accessControl) {
  if (accessControl.authorize(request)) return true;
  sendError(response, 401, "Unauthorized", null, { "www-authenticate": `Basic realm="${basicRealm}", charset="UTF-8"` });
  return false;
}

function isAuthorizedRequest(request, token) {
  if (!token) return false;
  const authorization = String(request.headers?.authorization || "");
  const bearer = /^Bearer\s+(.+)$/i.exec(authorization);
  if (bearer) return safeEqualSecret(bearer[1], token);
  const basic = /^Basic\s+(.+)$/i.exec(authorization);
  if (!basic) return false;
  const credentials = parseBasicCredentials(basic[1]);
  return credentials.username === "codex" && safeEqualSecret(credentials.password, token);
}

function parseBasicCredentials(value) {
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return { username: "", password: "" };
    return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
  } catch {
    return { username: "", password: "" };
  }
}

function safeEqualSecret(left, right) {
  const leftHash = createHash("sha256").update(String(left || ""), "utf8").digest();
  const rightHash = createHash("sha256").update(String(right || ""), "utf8").digest();
  return timingSafeEqual(leftHash, rightHash);
}

export {
  assertSecureListenConfig,
  createAccessControl,
  isAuthorizedRequest,
  isLoopbackHost,
  requireAuthorizedRequest,
};