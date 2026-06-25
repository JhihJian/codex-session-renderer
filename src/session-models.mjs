import path from "node:path";
import {
  firstLine,
  normalizeSlash,
  sessionStartedFromFile,
  toIso,
} from "./session-events.mjs";
import { stripLongPathPrefix } from "./sqlite-threads.mjs";

function mapCodexHomePath(filePath, codexHome, originalCodexHome = codexHome) {
  const normalized = stripLongPathPrefix(filePath || "");
  if (!normalized) return "";
  const normalizedOriginal = stripLongPathPrefix(originalCodexHome || codexHome || "");
  if (normalizedOriginal) {
    const pathApi = pathApiFor(normalizedOriginal, normalized);
    const relative = pathApi.relative(normalizedOriginal, normalized);
    if (isRelativeInside(relative, pathApi)) {
      return joinRelativePath(codexHome, relative);
    }
  }
  return normalized;
}

function relativeCodexPath(codexHome, filePath) {
  const normalizedHome = stripLongPathPrefix(codexHome || "");
  const normalizedFile = stripLongPathPrefix(filePath || "");
  const pathApi = pathApiFor(normalizedHome, normalizedFile);
  return normalizeSlash(pathApi.relative(normalizedHome, normalizedFile));
}

function pathApiFor(...values) {
  return values.some((value) => /^[a-z]:[\\/]/i.test(String(value || "")) || String(value || "").includes("\\")) ? path.win32 : path;
}

function joinRelativePath(root, relative) {
  const pathApi = pathApiFor(root);
  return pathApi.join(root, ...String(relative || "").split(/[\\/]+/).filter(Boolean));
}

function isRelativeInside(relative, pathApi = path) {
  return Boolean(relative) && relative !== ".." && !relative.startsWith(`..${pathApi.sep}`) && !pathApi.isAbsolute(relative);
}

function sessionFromThread(thread, codexHome, options = {}) {
  const filePath = mapCodexHomePath(thread.path || "", codexHome, options.originalCodexHome);
  return {
    id: thread.id,
    sourceId: options.sourceId || "local",
    sourceLabel: options.sourceLabel || "本机 Codex Home",
    dataSourceKind: options.dataSourceKind || "local",
    title: thread.title || "未命名会话",
    cwd: thread.cwd || null,
    originator: null,
    model: thread.model || null,
    reasoningEffort: thread.reasoningEffort || null,
    source: thread.source || null,
    threadSource: thread.threadSource || null,
    modelProvider: thread.modelProvider || null,
    archived: thread.archived ?? false,
    archivedAt: thread.archivedAt || null,
    agentNickname: thread.agentNickname || null,
    agentRole: thread.agentRole || null,
    preview: thread.preview || null,
    path: filePath || null,
    relativePath: filePath ? relativeCodexPath(codexHome, filePath) : null,
    startedAt: thread.createdAt || (filePath ? sessionStartedFromFile(filePath) : null),
    updatedAt: thread.updatedAt || null,
    sizeBytes: null,
    fileModifiedAt: null,
  };
}

function compactSessionForList(session) {
  return {
    id: session.id,
    sourceId: session.sourceId || "local",
    sourceLabel: session.sourceLabel || null,
    dataSourceKind: session.dataSourceKind || "local",
    title: session.title || "未命名会话",
    cwd: session.cwd || null,
    model: session.model || null,
    reasoningEffort: session.reasoningEffort || null,
    source: session.source || null,
    threadSource: session.threadSource || null,
    modelProvider: session.modelProvider || null,
    archived: session.archived ?? false,
    agentNickname: session.agentNickname || null,
    agentRole: session.agentRole || null,
    preview: firstLine(session.preview || "", 120) || null,
    relativePath: session.relativePath || null,
    startedAt: session.startedAt || null,
    updatedAt: session.updatedAt || null,
    fileModifiedAt: session.fileModifiedAt || null,
    sizeBytes: session.sizeBytes || null,
  };
}

function rootSessionsOnly(sessions, spawnEdges = []) {
  const childThreadIds = new Set(spawnEdges.map((edge) => edge?.childThreadId).filter(Boolean));
  if (childThreadIds.size === 0) return sessions;
  return sessions.filter((session) => !childThreadIds.has(session.id));
}

function withFileStat(session, stat) {
  if (!stat) return session;
  return {
    ...session,
    sizeBytes: stat.size,
    fileModifiedAt: toIso(stat.mtime),
    updatedAt: session.updatedAt || toIso(stat.mtime),
  };
}

function publicThreadMeta(thread, codexHome, options = {}) {
  if (!thread) return null;
  const filePath = mapCodexHomePath(thread.path || "", codexHome, options.originalCodexHome);
  return {
    id: thread.id,
    title: thread.title,
    cwd: thread.cwd || null,
    model: thread.model || null,
    reasoningEffort: thread.reasoningEffort || null,
    agentNickname: thread.agentNickname || null,
    agentRole: thread.agentRole || null,
    updatedAt: thread.updatedAt || null,
    sourceId: options.sourceId || "local",
    sourceLabel: options.sourceLabel || null,
    dataSourceKind: options.dataSourceKind || "local",
    path: filePath || null,
    relativePath: filePath ? relativeCodexPath(codexHome, filePath) : null,
  };
}

export {
  compactSessionForList,
  mapCodexHomePath,
  publicThreadMeta,
  relativeCodexPath,
  rootSessionsOnly,
  sessionFromThread,
  withFileStat,
};
