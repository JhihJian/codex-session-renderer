import path from "node:path";
import {
  firstLine,
  normalizeSlash,
  sessionStartedFromFile,
  toIso,
} from "./session-events.mjs";
import { stripLongPathPrefix } from "./sqlite-threads.mjs";

function sessionFromThread(thread, codexHome) {
  const filePath = stripLongPathPrefix(thread.path || "");
  return {
    id: thread.id,
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
    relativePath: filePath ? normalizeSlash(path.relative(codexHome, filePath)) : null,
    startedAt: thread.createdAt || (filePath ? sessionStartedFromFile(filePath) : null),
    updatedAt: thread.updatedAt || null,
    sizeBytes: null,
    fileModifiedAt: null,
  };
}

function compactSessionForList(session) {
  return {
    id: session.id,
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

function publicThreadMeta(thread, codexHome) {
  if (!thread) return null;
  return {
    id: thread.id,
    title: thread.title,
    cwd: thread.cwd || null,
    model: thread.model || null,
    reasoningEffort: thread.reasoningEffort || null,
    agentNickname: thread.agentNickname || null,
    agentRole: thread.agentRole || null,
    updatedAt: thread.updatedAt || null,
    path: thread.path || null,
    relativePath: thread.path ? normalizeSlash(path.relative(codexHome, thread.path)) : null,
  };
}

export { compactSessionForList, publicThreadMeta, rootSessionsOnly, sessionFromThread, withFileStat };
