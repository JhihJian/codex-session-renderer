import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { readJsonl } from "./jsonl-reader.mjs";
import { throwIfAborted } from "./remote-http.mjs";
import { sessionIdFromFile, sessionStartedFromFile, toIso } from "./session-events.mjs";
import { stripLongPathPrefix } from "./sqlite-threads.mjs";

async function readFileIndexPage({ codexHome, fsApi, query, now, limits, signal }) {
  const indexPath = path.join(codexHome, "session_index.jsonl");
  const sessionsRoot = path.join(codexHome, "sessions");
  const before = await indexTreeSignature([indexPath, sessionsRoot], fsApi);
  const budget = createIndexFallbackBudget(limits);
  const index = await readSessionIndexFile(indexPath, {
    signal,
    maxBytes: Math.min(limits.fallbackMaxBytes, 4 * 1024 * 1024),
    maxLines: limits.fallbackMaxEntries,
  });
  const sessions = [];
  const versionParts = [];
  for await (const filePath of walkJsonl(sessionsRoot, fsApi, signal)) {
    throwIfAborted(signal);
    const stat = await fsApi.stat(filePath).catch(() => null);
    if (!stat) continue;
    budget.add(stat.size, signal);
    const id = sessionIdFromFile(filePath);
    const indexed = index.get(id);
    versionParts.push([id, stat.size, stat.mtimeMs, stat.ctimeMs].join(":"));
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
  const after = await indexTreeSignature([indexPath, sessionsRoot], fsApi);
  if (before !== after) throw indexSnapshotChangedError();
  const filtered = filterIndexSessions(sessions, query, now);
  filtered.sort((left, right) => sessionTimeMs(right) - sessionTimeMs(left) || String(left.id).localeCompare(String(right.id)));
  return {
    kind: "files",
    version: createHash("sha256").update(`${after}\n${versionParts.sort().join("\n")}`).digest("base64url"),
    total: filtered.length,
    sessions: filtered.slice(query.cursor, query.cursor + query.limit),
  };
}

function createIndexFallbackBudget(limits) {
  let entries = 0;
  let bytes = 0;
  return {
    add(size, signal) {
      throwIfAborted(signal);
      entries += 1;
      bytes += Math.max(0, Number(size) || 0);
      if (entries > limits.fallbackMaxEntries) throw indexLimitError("index_fallback_too_many_entries", 413);
      if (bytes > limits.fallbackMaxBytes) throw indexLimitError("index_fallback_too_many_bytes", 413);
    },
  };
}

async function readSessionIndexFile(filePath, { signal, maxBytes, maxLines } = {}) {
  const byId = new Map();
  try {
    const rows = await readJsonl(filePath, { signal, maxBytes, maxLines });
    for (const row of rows) {
      throwIfAborted(signal);
      if (!row?.id) continue;
      byId.set(row.id, {
        title: row.thread_name || row.name || "未命名会话",
        updatedAt: toIso(row.updated_at) || toIso(row.updatedAt),
      });
    }
  } catch (error) {
    if (error?.name === "AbortError" || error?.code === "ABORT_ERR") throw error;
  }
  return byId;
}

async function* walkJsonl(dir, fsApi = fs, signal) {
  throwIfAborted(signal);
  let entries;
  try {
    entries = await fsApi.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    throwIfAborted(signal);
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkJsonl(fullPath, fsApi, signal);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) yield fullPath;
  }
}

async function indexFileSignature(filePath, fsApi = fs) {
  const stat = await fsApi.stat(filePath).catch(() => null);
  return stat ? [stat.size, stat.mtimeMs, stat.ctimeMs].join(":") : null;
}

async function indexTreeSignature(paths, fsApi = fs) {
  const values = await Promise.all(paths.map((filePath) => indexFileSignature(filePath, fsApi)));
  return values.map((value) => value || "missing").join("|");
}

function filterIndexSessions(sessions, query, now) {
  return sessions.filter((session) => {
    if (query.bucket !== "all" && sessionTimeBucket(session, now().getTime()) !== query.bucket) return false;
    if (query.q && !indexSearchText(session).includes(query.q)) return false;
    return true;
  });
}

function indexSearchText(session) {
  return [session.id, session.title, session.preview, session.cwd, session.relativePath, session.model, session.reasoningEffort, session.source, session.threadSource, session.modelProvider, session.agentNickname, session.agentRole]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function sessionTimeBucket(session, nowMs) {
  const timestamp = sessionTimeMs(session);
  if (timestamp == null) return "earlier";
  const ageMs = Math.max(0, Number(nowMs) - timestamp);
  if (ageMs < 3 * 60 * 60 * 1000) return "realtime";
  if (ageMs < 24 * 60 * 60 * 1000) return "day";
  return "earlier";
}

function sessionTimeMs(session) {
  for (const value of [session.updatedAt, session.fileModifiedAt, session.startedAt]) {
    const time = value ? new Date(value).getTime() : NaN;
    if (Number.isFinite(time)) return time;
  }
  return null;
}

function relativeCodexPath(codexHome, filePath) {
  const normalizedHome = stripLongPathPrefix(codexHome || "");
  const normalizedFile = stripLongPathPrefix(filePath || "");
  if (!normalizedHome || !normalizedFile) return null;
  const pathApi = normalizedHome.includes("\\") || normalizedFile.includes("\\") ? path.win32 : path;
  const relative = pathApi.relative(normalizedHome, normalizedFile);
  const parts = relative.split(/[\\/]+/);
  if (!relative || relative === ".." || relative.startsWith(`..${pathApi.sep}`) || pathApi.isAbsolute(relative)) return null;
  if (parts.length < 2 || parts[0] !== "sessions" || parts.some((part) => !part || part === "." || part === "..") || !parts.at(-1).endsWith(".jsonl")) return null;
  return relative.replaceAll("\\", "/");
}

function indexSnapshotChangedError() {
  return indexLimitError("index_snapshot_changed", 409, "远端历史索引已变化，请重新开始定位。");
}

function indexLimitError(code, status, message = "远端历史索引超过读取上限，请缩小范围后重试。") {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

export { indexSnapshotChangedError, readFileIndexPage, relativeCodexPath };