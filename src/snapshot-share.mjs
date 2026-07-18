import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { createDeadlineSignal, throwIfAborted } from "./remote-http.mjs";
import { createByteLimitTransform, createContentBudget } from "./snapshot-budget.mjs";
import { createSnapshotBuildCoordinator } from "./snapshot-build-coordinator.mjs";
import { sessionStartedFromFile } from "./session-events.mjs";
import { createSqliteThreadStore, sqlString } from "./sqlite-threads.mjs";
import { indexSnapshotChangedError, readFileIndexPage, relativeCodexPath, safeRemoteIndexTitle } from "./remote-session-index.mjs";
import { compactSessionForList, parseSessionListType } from "./session-models.mjs";
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
    maxSourceBytes: positiveLimit(env.CODEX_SHARE_SNAPSHOT_MAX_SOURCE_BYTES, 256 * 1024 * 1024, 2 * 1024 * 1024 * 1024),
    maxFiles: positiveLimit(env.CODEX_SHARE_SNAPSHOT_MAX_FILES, 10_000, 100_000),
    maxArchiveBytes: positiveLimit(env.CODEX_SHARE_SNAPSHOT_MAX_ARCHIVE_BYTES, 300 * 1024 * 1024, 2 * 1024 * 1024 * 1024),
    buildDeadlineMs: positiveLimit(env.CODEX_SHARE_SNAPSHOT_BUILD_DEADLINE_MS, 60_000, 300_000),
    indexDeadlineMs: positiveLimit(env.CODEX_SHARE_INDEX_DEADLINE_MS, 10_000, 60_000),
    indexSqliteMaxBytes: positiveLimit(env.CODEX_SHARE_INDEX_SQLITE_MAX_BYTES, 2 * 1024 * 1024, 16 * 1024 * 1024),
    indexFallbackMaxEntries: positiveLimit(env.CODEX_SHARE_INDEX_FALLBACK_MAX_ENTRIES, 10_000, 100_000),
    indexFallbackMaxBytes: positiveLimit(env.CODEX_SHARE_INDEX_FALLBACK_MAX_BYTES, 128 * 1024 * 1024, 1024 * 1024 * 1024),
  };
}

function positiveEnv(value, fallback, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.min(Math.floor(number), maximum);
}

function positiveLimit(value, fallback, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(Math.floor(number), maximum);
}

function createSnapshotShareHandler(options = {}) {
  const config = { ...snapshotShareConfig(options), ...(options.config || {}) };
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
          limits: {
            maxSourceBytes: config.maxSourceBytes,
            maxFiles: config.maxFiles,
            maxArchiveBytes: config.maxArchiveBytes,
            deadlineMs: config.buildDeadlineMs,
          },
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
        const subscription = requestAbortSubscription(req, res);
        try {
          const index = await createSessionIndex({
            codexHome: config.codexHome,
            query: url.searchParams,
            fsApi,
            now,
            signal: subscription.signal,
            limits: indexLimitsFromConfig(config),
          });
          if (!subscription.signal.aborted && !res.destroyed) return sendJson(res, 200, index);
          return undefined;
        } finally {
          subscription.dispose();
        }
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
  const limits = { ...defaultSnapshotShareLimits(), ...(options.limits || {}) };
  const sourceBudget = createContentBudget({
    maxBytes: limits.maxSourceBytes,
    maxFiles: limits.maxFiles,
    bytesCode: "snapshot_source_too_large",
    filesCode: "snapshot_source_too_many_files",
    status: 413,
  });
  const deadline = createDeadlineSignal(options.signal, limits.deadlineMs, "snapshot_build_deadline_exceeded");
  const signal = deadline.signal;

  try {
    throwIfAborted(signal);
    await copyCodexTree(codexHome, snapshotDir, fsApi, {
      signal,
      includeSessionFile: async (filePath) => scope === "all" || (await isFileChangedAfter(filePath, cutoffMs, fsApi)),
      beforeCopyFile: async (filePath) => {
        const stat = await (fsApi.stat || fs.stat)(filePath);
        sourceBudget.addFile(stat.size, signal);
      },
    });
    const metadata = `${JSON.stringify(
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
    )}\n`;
    sourceBudget.addFile(Buffer.byteLength(metadata), signal);
    await fsApi.writeFile(path.join(snapshotDir, snapshotMetadataFile), metadata, "utf8");
    await validateSnapshot(snapshotDir, fsApi);
    await runTar(spawnImpl, archivePath, snapshotDir, {
      signal,
      maxArchiveBytes: limits.maxArchiveBytes,
    });
    return archivePath;
  } catch (error) {
    await fsApi.rm(workDir, { recursive: true, force: true }).catch(() => {});
    if (error?.code === "snapshot_build_deadline_exceeded") error.status ||= 504;
    throw error;
  } finally {
    deadline.dispose();
  }
}

function defaultSnapshotShareLimits() {
  return {
    maxSourceBytes: 256 * 1024 * 1024,
    maxFiles: 10_000,
    maxArchiveBytes: 300 * 1024 * 1024,
    deadlineMs: 60_000,
  };
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
  const limits = { ...defaultIndexLimits(), ...(options.limits || {}) };
  const deadline = createDeadlineSignal(options.signal, limits.deadlineMs, "index_deadline_exceeded");
  try {
    throwIfAborted(deadline.signal);
    const now = options.now || (() => new Date());
    const sqlite = await readSqliteIndexPage({ codexHome, fsApi, query, now, limits, signal: deadline.signal, sqliteStore: options.sqliteStore });
    const index = sqlite || await readFileIndexPage({ codexHome, fsApi, query, now, limits, signal: deadline.signal });
    const snapshot = indexSnapshotToken({ query, kind: index.kind, version: index.version });
    assertIndexSnapshot(query.snapshot, snapshot);
    const end = query.cursor + query.limit;
    return {
      ok: true,
      page: {
        total: index.total,
        limit: query.limit,
        cursor: query.cursor,
        nextCursor: end < index.total ? String(end) : null,
        snapshot,
      },
      sessions: index.sessions.map((session) => ({
        ...compactSessionForList(session),
        availableInSnapshot: false,
        remoteIndexOnly: true,
      })),
    };
  } catch (error) {
    if (error?.code === "index_deadline_exceeded") error.status ||= 504;
    throw error;
  } finally {
    deadline.dispose();
  }
}

function parseIndexQuery(params) {
  const searchParams = params instanceof URLSearchParams ? params : new URLSearchParams(params);
  return {
    q: String(searchParams.get("q") || "").trim().toLowerCase(),
    type: parseSessionListType(searchParams.get("type")),
    bucket: searchParams.get("bucket") || "all",
    limit: clampNumber(searchParams.get("limit"), 1, 500, 120),
    cursor: clampNumber(searchParams.get("cursor"), 0, Number.MAX_SAFE_INTEGER, 0),
    snapshot: String(searchParams.get("snapshot") || ""),
  };
}

function defaultIndexLimits() {
  return {
    deadlineMs: 10_000,
    sqliteMaxBytes: 2 * 1024 * 1024,
    fallbackMaxEntries: 10_000,
    fallbackMaxBytes: 128 * 1024 * 1024,
  };
}

function indexLimitsFromConfig(config) {
  return {
    deadlineMs: config.indexDeadlineMs,
    sqliteMaxBytes: config.indexSqliteMaxBytes,
    fallbackMaxEntries: config.indexFallbackMaxEntries,
    fallbackMaxBytes: config.indexFallbackMaxBytes,
  };
}

async function readSqliteIndexPage({ codexHome, fsApi, query, now, limits, signal, sqliteStore }) {
  const stateDbPath = path.join(codexHome, "state_5.sqlite");
  const before = await indexFileSignature(stateDbPath, fsApi);
  if (!before && !sqliteStore) return null;
  const store = sqliteStore || createSqliteThreadStore({ stateDbPath });
  try {
    const page = await store.readThreadIndexPage({
      conditions: sqliteIndexConditions(query, now().getTime(), codexHome),
      limit: query.limit,
      cursor: query.cursor,
      maxBuffer: limits.sqliteMaxBytes,
      signal,
    });
    throwIfAborted(signal);
    const after = await indexFileSignature(stateDbPath, fsApi);
    if (before && after !== before) throw indexSnapshotChangedError();
    return {
      kind: "sqlite",
      version: after || before || "injected-store",
      total: page.total,
      sessions: [...page.threads.values()].map((thread) => ({
    id: thread.id,
    title: safeRemoteIndexTitle(thread.title || "未命名会话"),
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
      })),
    };
  } catch (error) {
    if (error?.name === "AbortError" || error?.code === "ABORT_ERR" || error?.code === "index_snapshot_changed") throw error;
    return null;
  }
}

function sqliteIndexConditions(query, nowMs, codexHome) {
  const time = "coalesce(updated_at_ms, created_at_ms)";
  const isSessionPath = sqliteVerifiedSessionPathCondition(codexHome);
  const conditions = ["rollout_path is not null and rollout_path <> ''", isSessionPath, "id not in (select child_thread_id from thread_spawn_edges where child_thread_id is not null)"];
  if (query.bucket === "realtime") conditions.push(`${time} >= ${Math.trunc(nowMs - 3 * 60 * 60 * 1000)}`);
  if (query.bucket === "day") conditions.push(`${time} >= ${Math.trunc(nowMs - 24 * 60 * 60 * 1000)} and ${time} < ${Math.trunc(nowMs - 3 * 60 * 60 * 1000)}`);
  if (query.bucket === "earlier") conditions.push(`(${time} < ${Math.trunc(nowMs - 24 * 60 * 60 * 1000)} or ${time} is null)`);
  if (query.q) {
    const searchable = ["id", "title", "first_user_message", "preview", "cwd", "rollout_path", "model", "reasoning_effort", "source", "thread_source", "model_provider", "agent_nickname", "agent_role"]
      .map((field) => `coalesce(${field}, '')`)
      .join(" || ' ' || ");
    conditions.push(`instr(lower(${searchable}), ${sqlString(query.q)}) > 0`);
  }
  const typeCondition = sqliteListTypeCondition(query.type);
  if (typeCondition) conditions.push(typeCondition);
  return conditions;
}

function sqliteListTypeCondition(type) {
  const patterns = {
    error: ["error", "failed", "失败", "错误"],
    tool: ["tool", "mcp", "command", "shell", "工具", "命令"],
  };
  const terms = patterns[type];
  if (!terms) return "";
  const safeTitle = `case when ${sqliteGoalControlTitleCondition("title")} then '' else coalesce(title, '') end`;
  const searchable = [safeTitle, "coalesce(cwd, '')", "coalesce(rollout_path, '')"].join(" || ' ' || ");
  return `(${terms.map((term) => `instr(lower(${searchable}), ${sqlString(term)}) > 0`).join(" or ")})`;
}

function sqliteVerifiedSessionPathCondition(codexHome) {
  const normalizedHome = path.resolve(codexHome).replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
  const normalizedPath = "lower(replace(rollout_path, '\\', '/'))";
  const prefix = `${normalizedHome}/sessions/`;
  return `instr(${normalizedPath}, ${sqlString(prefix)}) = 1 and ${normalizedPath} like '%.jsonl' and instr(${normalizedPath}, '/../') = 0 and instr(${normalizedPath}, '//') = 0`;
}

function sqliteGoalControlTitleCondition(field) {
  return `instr(lower(coalesce(${field}, '')), ${sqlString('<codex_internal_context source="goal">')}) = 1`;
}


async function indexFileSignature(filePath, fsApi = fs) {
  const stat = await fsApi.stat(filePath).catch(() => null);
  return stat ? [stat.size, stat.mtimeMs, stat.ctimeMs].join(":") : null;
}


function indexSnapshotToken({ query, kind, version }) {
  return createHash("sha256")
    .update(JSON.stringify({ bucket: query.bucket, q: query.q, type: query.type, kind, version }))
    .digest("base64url");
}

function assertIndexSnapshot(requestSnapshot, snapshot) {
  if (!requestSnapshot || requestSnapshot === snapshot) return;
  throw indexSnapshotChangedError();
}


function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(number)));
}

async function runTar(spawnImpl, archivePath, sourceDir, options = {}) {
  const signal = options.signal;
  const child = spawnImpl("tar", ["-cf", "-", "-C", sourceDir, "."], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const abort = () => child.kill?.("SIGTERM");
  signal?.addEventListener("abort", abort, { once: true });
  let stderr = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk) => {
    stderr += chunk;
  });
  const closed = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (exitCode) => {
      if (exitCode === 0) resolve();
      else reject(new Error(firstLine(stderr) || `tar exited with ${exitCode}`));
    });
  });
  try {
    await Promise.all([
      pipeline(
        child.stdout,
        createByteLimitTransform({
          maxBytes: options.maxArchiveBytes,
          code: "snapshot_archive_too_large",
          status: 413,
          signal,
        }),
        createWriteStream(archivePath),
        { signal },
      ),
      closed,
    ]);
  } catch (error) {
    child.kill?.("SIGTERM");
    await closed.catch(() => {});
    throwIfAborted(signal);
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
  }
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
