import { promises as fs } from "node:fs";
import { createDataSourceRegistry } from "./data-sources.mjs";
import {
  createAbortError,
  createConcurrencyGate,
  createSessionDetailCoordinator,
} from "./session-detail-coordinator.mjs";
import { sessionIdFromFile } from "./session-events.mjs";
import { createSqliteThreadStore } from "./sqlite-threads.mjs";

function readPositiveEnv(name, fallback, maximum) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), maximum);
}

export function createSessionSourceContextService({ maxListSessions }) {
  const sessionReadGate = createConcurrencyGate(readPositiveEnv("CODEX_SESSION_DETAIL_MAX_CONCURRENT_READS", 4, 32));
  const dataSources = createDataSourceRegistry();
  const sourceContexts = new Map();

  function sessionDetailCoordinatorOptions() {
    return {
      maxConcurrentReads: readPositiveEnv("CODEX_SESSION_DETAIL_MAX_CONCURRENT_READS", 4, 32),
      diagnosticMaxFileBytes: readPositiveEnv("CODEX_SESSION_DIAGNOSTIC_MAX_FILE_BYTES", 8 * 1024 * 1024, 256 * 1024 * 1024),
      maxDiagnosticEventScan: readPositiveEnv("CODEX_SESSION_DIAGNOSTIC_MAX_EVENT_SCAN", 100_000, 500_000),
      maxCacheEntries: readPositiveEnv("CODEX_SESSION_DETAIL_MAX_CACHE_ENTRIES", 24, 2_000),
      maxCacheBytes: readPositiveEnv("CODEX_SESSION_DETAIL_MAX_CACHE_BYTES", 48 * 1024 * 1024, 512 * 1024 * 1024),
      readGate: sessionReadGate,
    };
  }

  async function regularFileStat(filePath) {
    const stat = await fs.stat(filePath);
    return stat.isFile() ? stat : null;
  }

  async function sourceFileStat(_context, filePath) {
    try {
      return await regularFileStat(filePath);
    } catch {
      return null;
    }
  }

  async function sourceSessionRootIsReadable(_context, rootPath) {
    try {
      return (await fs.stat(rootPath)).isDirectory();
    } catch {
      return false;
    }
  }

  async function sessionFileStat(context, filePath, expectedId = null) {
    if (expectedId && sessionIdFromFile(filePath) !== expectedId) return null;
    return sourceFileStat(context, filePath);
  }

  async function requireReadableSessionFile(context, filePath) {
    const stat = await sessionFileStat(context, filePath);
    if (stat) return stat;
    const error = new Error("会话文件不可安全读取。");
    error.code = "unsafe_session_file";
    throw error;
  }

  async function sessionFileExists(context, session, options = {}) {
    if (!session?.path) return false;
    throwIfRequestAborted(options.signal);
    const stat = await sessionFileStat(context, session.path, session.id);
    throwIfRequestAborted(options.signal);
    return Boolean(stat);
  }

  function getSourceContext(sourceId = "local") {
    const source = dataSources.getSource(sourceId || "local");
    if (!source) return null;
    const cached = sourceContexts.get(source.id);
    if (cached) return cached;
    const context = {
      source,
      codexHome: source.codexHome,
      originalCodexHome: source.originalCodexHome || source.codexHome,
      sessionsRoot: source.sessionsRoot,
      sessionIndexPath: source.sessionIndexPath,
      stateDbPath: source.stateDbPath,
      threadStore: createSqliteThreadStore({ stateDbPath: source.stateDbPath, maxListSessions }),
      sessionCache: null,
      sessionCacheTime: 0,
      sessionCacheByScope: new Map(),
      allSessionCache: null,
      allSessionCacheTime: 0,
      sessionDetailCoordinator: null,
    };
    context.sessionDetailCoordinator = createSessionDetailCoordinator({
      ...sessionDetailCoordinatorOptions(),
      stat: async (filePath) => requireReadableSessionFile(context, filePath),
    });
    sourceContexts.set(source.id, context);
    return context;
  }

  return {
    getDefaultSource: () => dataSources.getDefaultSource(),
    getSourceContext,
    listSources: () => dataSources.listSources(),
    sessionFileExists,
    sessionFileStat,
    sourceFileStat,
    sourceModelOptions: (context) => ({
      sourceId: context.source.id,
      sourceLabel: context.source.label,
      dataSourceKind: context.source.kind,
      originalCodexHome: context.originalCodexHome,
    }),
    sourceSessionRootIsReadable,
  };
}

export function throwIfRequestAborted(signal) {
  if (signal?.aborted) throw createAbortError();
}