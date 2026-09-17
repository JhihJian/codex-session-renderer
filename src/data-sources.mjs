import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const piAgentSourceId = "pi-agent";
const piAgentSessionsRootEnvKeys = ["CODEX_SESSION_RENDERER_PI_AGENT_SESSIONS_ROOT", "PI_AGENT_SESSIONS_ROOT", "PI_AGENT_SESSIONS"];
const piAgentTasksRootEnvKeys = ["CODEX_SESSION_RENDERER_PI_AGENT_TASKS_ROOT", "PI_AGENT_TASKS_ROOT"];
const piAgentHomeEnvKeys = ["CODEX_SESSION_RENDERER_PI_AGENT_HOME", "PI_AGENT_HOME"];

function createDataSourceRegistry(options = {}) {
  const env = options.env || process.env;
  const homeDir = options.homeDir || os.homedir();
  const localCodexHome = path.resolve(env.CODEX_HOME || path.join(homeDir, ".codex"));
  const piAgentDefinition = parsePiAgentDefinition(env, homeDir);
  const sources = new Map();
  const localSource = createLocalDataSource({ codexHome: localCodexHome });
  sources.set(localSource.id, localSource);
  if (piAgentDefinition) {
    const piAgentSource = createPiAgentDataSource(piAgentDefinition);
    sources.set(piAgentSource.id, piAgentSource);
  }
  const defaultSourceId = sources.has(piAgentSourceId) ? piAgentSourceId : "local";

  return {
    getDefaultSource: () => sources.get(defaultSourceId),
    getSource: (id = "local") => sources.get(id || "local") || null,
    listSources: () => [...sources.values()].map((source) => publicDataSource(source, defaultSourceId)),
  };
}

function createLocalDataSource({ codexHome }) {
  return {
    id: "local",
    label: "本机 Codex Home",
    kind: "local",
    codexHome,
    originalCodexHome: codexHome,
    sessionsRoot: path.join(codexHome, "sessions"),
    sessionIndexPath: path.join(codexHome, "session_index.jsonl"),
    stateDbPath: path.join(codexHome, "state_5.sqlite"),
    status: availableSourceStatus(),
  };
}

function parsePiAgentDefinition(env = process.env, homeDir = os.homedir()) {
  const configuredSessionsRoot = firstEnvValue(env, piAgentSessionsRootEnvKeys);
  const configuredTasksRoot = firstEnvValue(env, piAgentTasksRootEnvKeys);
  const configuredAgentHome = firstEnvValue(env, piAgentHomeEnvKeys);
  if (configuredSessionsRoot && configuredTasksRoot) {
    throw new Error("PI Agent 会话根目录和任务根目录不能同时配置。");
  }
  const tasksRoot = configuredTasksRoot ? path.resolve(configuredTasksRoot) : "";
  const sessionsRoot = path.resolve(configuredSessionsRoot || path.join(homeDir, ".pi", "agent", "sessions"));
  const autoDetected = !configuredSessionsRoot && !configuredTasksRoot && !configuredAgentHome;
  if (autoDetected && !existsSync(sessionsRoot)) return null;
  const agentHome = path.resolve(configuredAgentHome || tasksRoot || path.dirname(sessionsRoot));
  return {
    agentHome,
    sessionsRoot: tasksRoot || sessionsRoot,
    ...(tasksRoot ? { tasksRoot } : {}),
    autoDetected,
  };
}

function firstEnvValue(env, keys) {
  for (const key of keys) {
    const value = env[key];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function createPiAgentDataSource({ agentHome, sessionsRoot, tasksRoot, autoDetected }) {
  const snapshotAvailable = existsSync(sessionsRoot);
  return {
    id: piAgentSourceId,
    label: "Pi Agent Sessions",
    kind: "pi-agent",
    codexHome: agentHome,
    originalCodexHome: agentHome,
    sessionsRoot,
    taskSessionsRoot: tasksRoot,
    sessionIndexPath: path.join(agentHome, "session_index.jsonl"),
    stateDbPath: path.join(agentHome, "state_5.sqlite"),
    origin: { type: "pi-agent", sessionsRoot, taskSessionsRoot: tasksRoot, autoDetected },
    status: {
      ...availableSourceStatus(),
      snapshotAvailable,
      error: snapshotAvailable ? null : { code: "missing_sessions_root", message: "Pi Agent 会话目录不存在。" },
    },
  };
}

function availableSourceStatus() {
  return {
    configured: true,
    refreshable: false,
    refreshing: false,
    lastRefreshOk: null,
    lastSuccessfulRefreshAt: null,
    stale: false,
    snapshotAvailable: true,
    error: null,
  };
}

function publicDataSource(source, defaultSourceId = "local") {
  return {
    id: source.id,
    label: source.label,
    kind: source.kind,
    origin: source.origin || { type: "local", codexHome: source.codexHome },
    isDefault: source.id === defaultSourceId,
    codexHome: source.codexHome,
    snapshotPath: null,
    status: { ...source.status },
  };
}

function sanitizeErrorMessage(message) {
  const text = String(message || "请求失败。").split(/\r?\n/).find((line) => line.trim())?.trim().slice(0, 240) || "";
  const authPlaceholder = "__CSR_AUTH_BEARER_REDACTED__";
  return text
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^@/\s]+@/gi, "$1[redacted]@")
    .replace(/authorization\s*[=:]\s*bearer\s+[a-z0-9._~+/=-]+/gi, authPlaceholder)
    .replace(/bearer\s+[a-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/token[=:]\s*[^\s]+/gi, "token=[redacted]")
    .replace(/authorization[=:]\s*[^\s]+/gi, "authorization=[redacted]")
    .replaceAll(authPlaceholder, "authorization=Bearer [redacted]");
}

export { createDataSourceRegistry, parsePiAgentDefinition, piAgentSourceId, publicDataSource, sanitizeErrorMessage };