import { promises as fs } from "node:fs";
import path from "node:path";
import { createDataSourceRegistry } from "./data-sources.mjs";
import {
  createAbortError,
  createConcurrencyGate,
  createSessionDetailCoordinator,
} from "./session-detail-coordinator.mjs";
import { sessionIdFromFile } from "./text-utils.mjs";
import { createSqliteThreadStore } from "./sqlite-threads.mjs";

function readPositiveEnv(name, fallback, maximum) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), maximum);
}

function sessionDetailCoordinatorOptions(readGate) {
  return {
    maxConcurrentReads: readPositiveEnv("CODEX_SESSION_DETAIL_MAX_CONCURRENT_READS", 4, 32),
    diagnosticMaxFileBytes: readPositiveEnv("CODEX_SESSION_DIAGNOSTIC_MAX_FILE_BYTES", 8 * 1024 * 1024, 256 * 1024 * 1024),
    maxDiagnosticEventScan: readPositiveEnv("CODEX_SESSION_DIAGNOSTIC_MAX_EVENT_SCAN", 100_000, 500_000),
    maxCacheEntries: readPositiveEnv("CODEX_SESSION_DETAIL_MAX_CACHE_ENTRIES", 24, 2_000),
    maxCacheBytes: readPositiveEnv("CODEX_SESSION_DETAIL_MAX_CACHE_BYTES", 48 * 1024 * 1024, 512 * 1024 * 1024),
    readGate,
  };
}

const temporarySessionSource = {
  id: "temporary",
  label: "临时本机会话",
  kind: "temporary",
  codexHome: "",
  originalCodexHome: "",
  sessionsRoot: "",
  sessionIndexPath: "",
  stateDbPath: "",
  status: {},
};

async function resolveTemporarySessionPath(value) {
  const requestedPath = String(value || "").trim();
  if (!requestedPath || !path.isAbsolute(requestedPath)) {
    throw invalidTemporarySessionFileError();
  }
  try {
    const filePath = await fs.realpath(requestedPath);
    const stat = await fs.stat(filePath);
    if (stat.isDirectory() || (stat.isFile() && path.extname(filePath).toLowerCase() === ".jsonl")) return filePath;
  } catch {
    // Normalize inaccessible and non-file paths to the same public error.
  }
  throw invalidTemporarySessionFileError();
}

async function listTemporarySessionFiles(rootPath, { maxRecords = 800, signal, throwIfRequestAborted }) {
  const files = [];
  async function walk(directoryPath) {
    throwIfRequestAborted(signal);
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    entries.sort((left, right) => right.name.localeCompare(left.name, "en"));
    for (const entry of entries) {
      throwIfRequestAborted(signal);
      const filePath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) await walk(filePath);
      else if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".jsonl") files.push(await fs.realpath(filePath));
      if (files.length >= maxRecords) return;
    }
  }
  await walk(rootPath);
  return [...new Set(files)].slice(0, maxRecords);
}

function createTemporarySessionContext(filePath, { maxListSessions, sessionReadGate, requireReadableSessionFile }) {
  const source = { ...temporarySessionSource, codexHome: path.dirname(filePath), originalCodexHome: path.dirname(filePath) };
  const context = {
    source,
    codexHome: source.codexHome,
    originalCodexHome: source.originalCodexHome,
    sessionsRoot: source.sessionsRoot,
    sessionIndexPath: source.sessionIndexPath,
    stateDbPath: source.stateDbPath,
    threadStore: createSqliteThreadStore({ stateDbPath: source.stateDbPath, maxListSessions }),
    sessionCache: null,
    sessionCacheTime: 0,
    sessionCacheByScope: new Map(),
    allSessionCache: null,
    allSessionCacheTime: 0,
    modelStorePath: null,
    modelContextWindows: null,
    modelStoreStamp: null,
    sessionDetailCoordinator: null,
  };
  context.sessionDetailCoordinator = createSessionDetailCoordinator({
    ...sessionDetailCoordinatorOptions(sessionReadGate),
    stat: async (candidatePath) => requireReadableSessionFile(context, candidatePath),
  });
  return context;
}

export function createSessionSourceContextService({ maxListSessions }) {
  const sessionReadGate = createConcurrencyGate(readPositiveEnv("CODEX_SESSION_DETAIL_MAX_CONCURRENT_READS", 4, 32));
  const dataSources = createDataSourceRegistry();
  const sourceContexts = new Map();
  const piAgentContext = dataSources.getSource("pi-agent");
  if (piAgentContext) getSourceContext(piAgentContext.id);

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
    if (expectedId && !sessionFileMatchesExpectedId(filePath, expectedId)) return null;
    return sourceFileStat(context, filePath);
  }

  function sessionFileMatchesExpectedId(filePath, expectedId) {
    const fileSessionId = sessionIdFromFile(filePath);
    return fileSessionId === expectedId || expectedId.endsWith(`:${fileSessionId}`);
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
      modelStorePath: source.modelStorePath || null,
      modelContextWindows: null,
      modelStoreStamp: null,
      sessionDetailCoordinator: null,
    };
    context.sessionDetailCoordinator = createSessionDetailCoordinator({
      ...sessionDetailCoordinatorOptions(sessionReadGate),
      stat: async (filePath) => requireReadableSessionFile(context, filePath),
    });
    sourceContexts.set(source.id, context);
    return context;
  }

  function getTemporarySessionContext(filePath) {
    return createTemporarySessionContext(filePath, { maxListSessions, sessionReadGate, requireReadableSessionFile });
  }

  return {
    getDefaultSource: () => dataSources.getDefaultSource(),
    getSourceContext,
    getTemporarySessionContext,
    listSources: () => dataSources.listSources(),
    listTemporarySessionFiles,
    resolveTemporarySessionPath,
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
    modelContextWindow,
  };

}

function invalidTemporarySessionFileError() {
  const error = new Error("临时会话必须是可读取的绝对 .jsonl 文件或目录。");
  error.status = 400;
  error.code = "invalid_temporary_session_file";
  return error;
}

async function modelContextWindow(context, modelId) {
  if (context.source.kind !== "pi-agent" || !context.modelStorePath || !modelId) return null;
  let stat;
  try {
    stat = await fs.stat(context.modelStorePath);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  const stamp = `${stat.mtimeMs}:${stat.size}`;
  if (context.modelStoreStamp !== stamp) {
    try {
      const store = JSON.parse(await fs.readFile(context.modelStorePath, "utf8"));
      context.modelContextWindows = collectModelContextWindows(store);
      context.modelStoreStamp = stamp;
    } catch {
      return null;
    }
  }
  const contextWindow = context.modelContextWindows?.get(String(modelId)) || null;
  return Number.isFinite(contextWindow) && contextWindow > 0 ? contextWindow : null;
}

function collectModelContextWindows(value, result = new Map()) {
  if (!value || typeof value !== "object") return result;
  if (typeof value.id === "string" && Number.isFinite(value.contextWindow)) result.set(value.id, Math.round(value.contextWindow));
  for (const child of Object.values(value)) collectModelContextWindows(child, result);
  return result;
}

export function throwIfRequestAborted(signal) {
  if (signal?.aborted) throw createAbortError();
}