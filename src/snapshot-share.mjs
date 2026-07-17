import { createReadStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { readJsonl } from "./jsonl-reader.mjs";
import { createAbortError, throwIfAborted } from "./remote-http.mjs";
import { createSnapshotBuildCoordinator } from "./snapshot-build-coordinator.mjs";
import { sessionIdFromFile, sessionStartedFromFile, toIso } from "./session-events.mjs";
import { createSqliteThreadStore, stripLongPathPrefix } from "./sqlite-threads.mjs";
import { copyCodexTree, snapshotMetadataFile, validateSnapshot } from "./data-sources.mjs";
import { sendError, sendJson } from "./http-response.mjs";

function snapshotShareConfig(options = {}) {
  const env = options.env || process.env;
  const homeDir = options.homeDir || os.homedir();
  return {
    codexHome: path.resolve(env.CODEX_HOME || path.join(homeDir, ".codex")),
    host: env.CODEX_SHARE_HOST || "0.0.0.0",
    port: Number(env.CODEX_SHARE_PORT || env.PORT || 4791),
    token: env.CODEX_SHARE_TOKEN || env.CODEX_REMOTE_TOKEN || "",
    realtimeHours: Number(env.CODEX_SHARE_REALTIME_HOURS || 3),
    maxConcurrentBuilds: positiveEnv(env.CODEX_SHARE_MAX_CONCURRENT_BUILDS, 1, 8),
    maxQueuedBuilds: positiveEnv(env.CODEX_SHARE_MAX_QUEUED_BUILDS, 4, 32),
  };
}

function positiveEnv(value, fallback, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.min(Math.floor(number), maximum);
}

function createSnapshotShareHandler(options = {}) {
  const config = options.config || snapshotShareConfig(options);
  const fsApi = options.fsApi || fs;
  const spawnImpl = options.spawnImpl || spawn;
  const now = options.now || (() => new Date());
  const tempRoot = options.tempRoot || os.tmpdir();
  const coordinator = options.coordinator || createSnapshotBuildCoordinator({
    maxConcurrent: config.maxConcurrentBuilds,
    maxQueued: config.maxQueuedBuilds,
    fsApi,
  });

  return async function route(req, res) {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    try {
      if (url.pathname === "/api/share-health") {
        if (req.method !== "GET") return sendError(res, 405, "Method not allowed");
        if (!isAuthorizedSnapshotRequest(req, config.token)) return sendError(res, 401, "Unauthorized");
        return sendJson(res, 200, {
          ok: true,
          codexHome: config.codexHome,
          requiresAuth: true,
          time: now().toISOString(),
        });
      }

      if (url.pathname === "/api/codex-snapshot.tar") {
        if (req.method !== "GET") return sendError(res, 405, "Method not allowed");
        if (!isAuthorizedSnapshotRequest(req, config.token)) return sendError(res, 401, "Unauthorized");
        return serveSnapshotArchive(req, res, {
          codexHome: config.codexHome,
          scope: url.searchParams.get("scope") || "realtime",
          since: url.searchParams.get("since") || "",
          realtimeHours: Number(url.searchParams.get("hours") || config.realtimeHours || 3),
          fsApi,
          spawnImpl,
          now,
          tempRoot,
          coordinator,
        });
      }

      if (url.pathname === "/api/codex-session-index") {
        if (req.method !== "GET") return sendError(res, 405, "Method not allowed");
        if (!isAuthorizedSnapshotRequest(req, config.token)) return sendError(res, 401, "Unauthorized");
        return sendJson(res, 200, await createSessionIndex({
          codexHome: config.codexHome,
          query: url.searchParams,
          fsApi,
          now,
        }));
      }

      return sendError(res, 404, "Not found");
    } catch (error) {
      if (!res.headersSent) {
        const status = error?.status || 500;
        return sendError(res, status, status === 503 ? "Snapshot service is busy" : "Internal server error", {
          code: error?.code,
        }, status === 503 ? { "retry-after": "1" } : {});
      }
      res.destroy(error);
    }
  };
}

function isAuthorizedSnapshotRequest(req, token) {
  if (!token) return false;
  const header = req.headers?.authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(String(header));
  return Boolean(match && safeEqual(match[1], token));
}

function safeEqual(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

async function serveSnapshotArchive(req, res, options) {
  const subscription = requestAbortSubscription(req, res);
  let lease;
  try {
    lease = await options.coordinator.acquire(snapshotRequestKey(options), (signal) => createSnapshotArchive({ ...options, signal }), subscription.signal);
    const archivePath = lease.archivePath;
    const stat = await fs.stat(archivePath);
    res.writeHead(200, {
      "content-type": "application/x-tar",
      "content-length": stat.size,
      "cache-control": "no-store",
      "content-disposition": 'attachment; filename="codex-snapshot.tar"',
    });
    await pipeline(createReadStream(archivePath), res, { signal: subscription.signal });
  } finally {
    subscription.dispose();
    await lease?.release();
  }
}

function requestAbortSubscription(req, res) {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) controller.abort();
  };
  const onClose = () => {
    if (!res.writableEnded) abort();
  };
  req.once("aborted", abort);
  res.once("close", onClose);
  return {
    signal: controller.signal,
    dispose: () => {
      req.removeListener("aborted", abort);
      res.removeListener("close", onClose);
    },
  };
}

function snapshotRequestKey(options) {
  return JSON.stringify({
    codexHome: path.resolve(options.codexHome),
    scope: normalizeSnapshotScope(options.scope),
    since: options.since || "",
    realtimeHours: Number(options.realtimeHours || 3),
  });
}


async function createSnapshotArchive(options = {}) {
  const fsApi = options.fsApi || fs;
  const spawnImpl = options.spawnImpl || spawn;
  const now = options.now || (() => new Date());
  const codexHome = path.resolve(options.codexHome || path.join(os.homedir(), ".codex"));
  const tempRoot = options.tempRoot || os.tmpdir();
  const scope = normalizeSnapshotScope(options.scope || "realtime");
  const cutoffMs = snapshotCutoffMs({ ...options, scope, now });
  const workDir = await fsApi.mkdtemp(path.join(tempRoot, "csr-share-"));
  const snapshotDir = path.join(workDir, "snapshot");
  const archivePath = path.join(workDir, "codex-snapshot.tar");

  try {
    throwIfAborted(options.signal);
    await copyCodexTree(codexHome, snapshotDir, fsApi, {
      signal: options.signal,
      includeSessionFile: async (filePath) => scope === "all" || (await isFileChangedAfter(filePath, cutoffMs, fsApi)),
    });
    await fsApi.writeFile(
      path.join(snapshotDir, snapshotMetadataFile),
      `${JSON.stringify(
        {
          format: "codex-session-renderer-snapshot",
          createdAt: now().toISOString(),
          codexHome,
          host: os.hostname(),
          scope,
          cutoffAt: cutoffMs ? new Date(cutoffMs).toISOString() : null,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await validateSnapshot(snapshotDir, fsApi);
    await runTar(spawnImpl, archivePath, snapshotDir, options.signal);
    return archivePath;
  } catch (error) {
    await fsApi.rm(workDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

function normalizeSnapshotScope(value) {
  return value === "all" ? "all" : "realtime";
}

function snapshotCutoffMs(options = {}) {
  if (options.scope === "all") return 0;
  if (options.since) {
    const since = new Date(options.since).getTime();
    if (Number.isFinite(since)) return since;
  }
  const hours = Number.isFinite(Number(options.realtimeHours)) ? Number(options.realtimeHours) : 3;
  return options.now().getTime() - Math.max(0.1, hours) * 60 * 60 * 1000;
}

async function isFileChangedAfter(filePath, cutoffMs, fsApi = fs) {
  if (!cutoffMs) return true;
  const stat = await fsApi.stat(filePath).catch(() => null);
  return Boolean(stat && stat.mtimeMs >= cutoffMs);
}

async function createSessionIndex(options = {}) {
  const fsApi = options.fsApi || fs;
  const codexHome = path.resolve(options.codexHome || path.join(os.homedir(), ".codex"));
  const query = parseIndexQuery(options.query || new URLSearchParams());
  const sessions = await readIndexSessions({ codexHome, fsApi, query });
  const filtered = filterIndexSessions(sessions, query, options.now || (() => new Date()));
  const start = query.cursor;
  const end = start + query.limit;
  return {
    ok: true,
    codexHome,
    page: {
      total: filtered.length,
      limit: query.limit,
      cursor: start,
      nextCursor: end < filtered.length ? String(end) : null,
    },
    sessions: filtered.slice(start, end).map((session) => ({
      ...session,
      availableInSnapshot: false,
      remoteIndexOnly: true,
    })),
  };
}

function parseIndexQuery(params) {
  const searchParams = params instanceof URLSearchParams ? params : new URLSearchParams(params);
  return {
    q: String(searchParams.get("q") || "").trim().toLowerCase(),
    bucket: searchParams.get("bucket") || "all",
    limit: clampNumber(searchParams.get("limit"), 1, 500, 120),
    cursor: clampNumber(searchParams.get("cursor"), 0, Number.MAX_SAFE_INTEGER, 0),
  };
}

async function readIndexSessions({ codexHome, fsApi, query }) {
  const sqliteSessions = await readSqliteIndexSessions({ codexHome, query });
  if (sqliteSessions.length > 0) return sqliteSessions;
  return readFileIndexSessions({ codexHome, fsApi });
}

async function readSqliteIndexSessions({ codexHome, query }) {
  const store = createSqliteThreadStore({
    stateDbPath: path.join(codexHome, "state_5.sqlite"),
    maxListSessions: Math.max(query.limit + query.cursor, 1000),
  });
  const threads = await store.readAllThreads();
  return [...threads.values()].map((thread) => ({
    id: thread.id,
    title: thread.title || "未命名会话",
    cwd: thread.cwd || null,
    model: thread.model || null,
    reasoningEffort: thread.reasoningEffort || null,
    source: thread.source || null,
    threadSource: thread.threadSource || null,
    modelProvider: thread.modelProvider || null,
    archived: thread.archived ?? false,
    agentNickname: thread.agentNickname || null,
    agentRole: thread.agentRole || null,
    preview: thread.preview || null,
    relativePath: relativeCodexPath(codexHome, thread.path),
    startedAt: thread.createdAt || sessionStartedFromFile(thread.path),
    updatedAt: thread.updatedAt || null,
    fileModifiedAt: null,
    sizeBytes: null,
  }));
}

async function readFileIndexSessions({ codexHome, fsApi }) {
  const index = await readSessionIndexFile(path.join(codexHome, "session_index.jsonl"));
  const sessionsRoot = path.join(codexHome, "sessions");
  const sessions = [];
  for await (const filePath of walkJsonl(sessionsRoot, fsApi)) {
    const stat = await fsApi.stat(filePath).catch(() => null);
    if (!stat) continue;
    const id = sessionIdFromFile(filePath);
    const indexed = index.get(id);
    sessions.push({
      id,
      title: indexed?.title || path.basename(filePath, ".jsonl"),
      cwd: null,
      model: null,
      reasoningEffort: null,
      source: null,
      threadSource: null,
      modelProvider: null,
      archived: false,
      agentNickname: null,
      agentRole: null,
      preview: null,
      relativePath: relativeCodexPath(codexHome, filePath),
      startedAt: sessionStartedFromFile(filePath),
      updatedAt: indexed?.updatedAt || toIso(stat.mtime),
      fileModifiedAt: toIso(stat.mtime),
      sizeBytes: stat.size,
    });
  }
  sessions.sort((left, right) => sessionTimeMs(right) - sessionTimeMs(left));
  return sessions;
}

async function readSessionIndexFile(filePath) {
  const byId = new Map();
  try {
    const rows = await readJsonl(filePath);
    for (const row of rows) {
      if (!row?.id) continue;
      byId.set(row.id, {
        title: row.thread_name || row.name || "未命名会话",
        updatedAt: toIso(row.updated_at) || toIso(row.updatedAt),
      });
    }
  } catch {
    // JSONL files remain the fallback index.
  }
  return byId;
}

async function* walkJsonl(dir, fsApi = fs) {
  let entries;
  try {
    entries = await fsApi.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkJsonl(fullPath, fsApi);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      yield fullPath;
    }
  }
}

function filterIndexSessions(sessions, query, now = () => new Date()) {
  return sessions.filter((session) => {
    if (query.bucket !== "all" && sessionTimeBucket(session, now().getTime()) !== query.bucket) return false;
    if (query.q && !indexSearchText(session).includes(query.q)) return false;
    return true;
  });
}

function indexSearchText(session) {
  return [
    session.id,
    session.title,
    session.preview,
    session.cwd,
    session.relativePath,
    session.model,
    session.reasoningEffort,
    session.source,
    session.threadSource,
    session.modelProvider,
    session.agentNickname,
    session.agentRole,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function sessionTimeBucket(session, nowMs = Date.now()) {
  const timestamp = sessionTimeMs(session);
  if (timestamp == null) return "earlier";
  const ageMs = Math.max(0, Number(nowMs) - timestamp);
  if (ageMs < 3 * 60 * 60 * 1000) return "realtime";
  if (ageMs < 24 * 60 * 60 * 1000) return "day";
  return "earlier";
}

function sessionTimeMs(session) {
  for (const value of [session.updatedAt, session.fileModifiedAt, session.startedAt]) {
    if (!value) continue;
    const time = new Date(value).getTime();
    if (Number.isFinite(time)) return time;
  }
  return null;
}

function relativeCodexPath(codexHome, filePath) {
  const normalizedHome = stripLongPathPrefix(codexHome || "");
  const normalizedFile = stripLongPathPrefix(filePath || "");
  if (!normalizedHome || !normalizedFile) return null;
  const pathApi = normalizedHome.includes("\\") || normalizedFile.includes("\\") ? path.win32 : path;
  return pathApi.relative(normalizedHome, normalizedFile).replaceAll("\\", "/");
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(number)));
}

function runTar(spawnImpl, archivePath, sourceDir, signal) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl("tar", ["-cf", archivePath, "-C", sourceDir, "."], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    const abort = () => child.kill?.("SIGTERM");
    signal?.addEventListener("abort", abort, { once: true });
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => reject(error));
    child.on("close", (exitCode) => {
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) return reject(createAbortError());
      if (exitCode === 0) {
        resolve();
      } else {
        reject(new Error(firstLine(stderr) || `tar exited with ${exitCode}`));
      }
    });
  });
}

function firstLine(value) {
  return String(value || "").split(/\r?\n/).find((line) => line.trim())?.trim().slice(0, 240) || "";
}

export {
  createSnapshotArchive,
  createSnapshotBuildCoordinator,
  createSessionIndex,
  createSnapshotShareHandler,
  isAuthorizedSnapshotRequest,
  safeEqual,
  snapshotShareConfig,
};
