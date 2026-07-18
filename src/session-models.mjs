import path from "node:path";
import {
  firstLine,
  normalizeSlash,
  sessionStartedFromFile,
  toIso,
} from "./session-events.mjs";
import { stripLongPathPrefix } from "./sqlite-threads.mjs";

function mapCodexHomePath(filePath, codexHome, originalCodexHome = codexHome, options = {}) {
  const normalized = stripLongPathPrefix(filePath || "");
  if (!normalized) return "";
  const normalizedOriginal = stripLongPathPrefix(originalCodexHome || codexHome || "");
  if (normalizedOriginal) {
    const pathApi = pathApiFor(normalizedOriginal, normalized);
    const relative = pathApi.relative(normalizedOriginal, normalized);
    if (isRelativeInside(relative, pathApi)) {
      if (options.dataSourceKind === "remote" && !isRemoteSessionRelativePath(relative)) return "";
      return joinRelativePath(codexHome, relative);
    }
  }
  return options.dataSourceKind === "remote" ? "" : normalized;
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

function isRemoteSessionRelativePath(relative) {
  const parts = String(relative || "").split(/[\\/]+/);
  return parts.length >= 2 && parts[0] === "sessions" && parts.every((part) => part && part !== "." && part !== "..") && parts.at(-1).endsWith(".jsonl");
}

function sessionFromThread(thread, codexHome, options = {}) {
  const filePath = mapCodexHomePath(thread.path || "", codexHome, options.originalCodexHome, options);
  const spawn = subagentThreadSpawn(thread.source);
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
    threadSource: thread.threadSource || (spawn ? "subagent" : null),
    modelProvider: thread.modelProvider || null,
    archived: thread.archived ?? false,
    archivedAt: thread.archivedAt || null,
    agentNickname: thread.agentNickname || spawn?.agentNickname || null,
    agentRole: thread.agentRole || spawn?.agentRole || null,
    preview: thread.preview || null,
    status: thread.status || null,
    path: filePath || null,
    relativePath: filePath ? relativeCodexPath(codexHome, filePath) : null,
    startedAt: thread.createdAt || (filePath ? sessionStartedFromFile(filePath) : null),
    updatedAt: thread.updatedAt || null,
    sizeBytes: null,
    fileModifiedAt: null,
  };
}

function compactSessionForList(session) {
  const enriched = withSubagentMeta(session);
  return {
    id: enriched.id,
    sourceId: enriched.sourceId || "local",
    sourceLabel: enriched.sourceLabel || null,
    dataSourceKind: enriched.dataSourceKind || "local",
    title: enriched.title || "未命名会话",
    cwd: enriched.cwd || null,
    model: enriched.model || null,
    reasoningEffort: enriched.reasoningEffort || null,
    source: enriched.source || null,
    threadSource: enriched.threadSource || null,
    modelProvider: enriched.modelProvider || null,
    archived: enriched.archived ?? false,
    agentNickname: enriched.agentNickname || null,
    agentRole: enriched.agentRole || null,
    preview: firstLine(enriched.preview || "", 120) || null,
    status: enriched.status || null,
    relativePath: enriched.relativePath || null,
    startedAt: enriched.startedAt || null,
    updatedAt: enriched.updatedAt || null,
    fileModifiedAt: enriched.fileModifiedAt || null,
    sizeBytes: enriched.sizeBytes || null,
  };
}

function rootSessionsOnly(sessions, spawnEdges = []) {
  const childThreadIds = new Set(spawnEdges.map((edge) => edge?.childThreadId).filter(Boolean));
  for (const session of sessions) {
    if (sessionIsChild(session)) childThreadIds.add(session.id);
  }
  if (childThreadIds.size === 0) return sessions;
  return sessions.filter((session) => !childThreadIds.has(session.id));
}

function subagentThreadSpawn(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const subagent = source.subagent && typeof source.subagent === "object" ? source.subagent : {};
  const spawn = subagent.thread_spawn || subagent.threadSpawn || source.thread_spawn || source.threadSpawn || null;
  if (!spawn || typeof spawn !== "object" || Array.isArray(spawn)) return null;
  const parentThreadId = firstPresent(spawn.parent_thread_id, spawn.parentThreadId, spawn.parent_id, spawn.parentId);
  const agentNickname = firstPresent(spawn.agent_nickname, spawn.agentNickname, subagent.agent_nickname, subagent.agentNickname);
  const agentRole = firstPresent(spawn.agent_role, spawn.agentRole, subagent.agent_role, subagent.agentRole);
  const agentPath = firstPresent(spawn.agent_path, spawn.agentPath, subagent.agent_path, subagent.agentPath);
  return {
    parentThreadId: parentThreadId || null,
    agentNickname: agentNickname || null,
    agentRole: agentRole || null,
    agentPath: agentPath || null,
    depth: Number.isFinite(Number(spawn.depth)) ? Number(spawn.depth) : null,
  };
}

function firstPresent(...values) {
  for (const value of values) {
    if (value != null && value !== "") return String(value);
  }
  return null;
}

function sessionParentThreadId(session) {
  return session?.parentThreadId || subagentThreadSpawn(session?.source)?.parentThreadId || null;
}

function sessionIsChild(session) {
  return Boolean(session?.id && (sessionParentThreadId(session) || session.threadSource === "subagent"));
}

function withSubagentMeta(session) {
  if (!session) return session;
  const spawn = subagentThreadSpawn(session.source);
  if (!spawn) return session;
  return {
    ...session,
    threadSource: session.threadSource || "subagent",
    agentNickname: session.agentNickname || spawn.agentNickname || null,
    agentRole: session.agentRole || spawn.agentRole || null,
  };
}

function spawnEdgesFromSessions(sessions) {
  return sessions
    .map((session) => {
      const parentThreadId = sessionParentThreadId(session);
      if (!session?.id || !parentThreadId) return null;
      return {
        parentThreadId,
        childThreadId: session.id,
        status: "unknown",
      };
    })
    .filter(Boolean);
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
  const filePath = mapCodexHomePath(thread.path || "", codexHome, options.originalCodexHome, options);
  const spawn = subagentThreadSpawn(thread.source);
  return {
    id: thread.id,
    title: thread.title,
    cwd: thread.cwd || null,
    model: thread.model || null,
    reasoningEffort: thread.reasoningEffort || null,
    agentNickname: thread.agentNickname || spawn?.agentNickname || null,
    agentRole: thread.agentRole || spawn?.agentRole || null,
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
  sessionIsChild,
  sessionParentThreadId,
  spawnEdgesFromSessions,
  subagentThreadSpawn,
  withFileStat,
  withSubagentMeta,
};
