import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const piAgentSourceId = "pi-agent";
const piAgentSessionsRootEnvKeys = ["CODEX_SESSION_RENDERER_PI_AGENT_SESSIONS_ROOT", "PI_AGENT_SESSIONS_ROOT", "PI_AGENT_SESSIONS"];
const piAgentTasksRootEnvKeys = ["CODEX_SESSION_RENDERER_PI_AGENT_TASKS_ROOT", "PI_AGENT_TASKS_ROOT"];
const piAgentEvaluationsRootEnvKeys = ["CODEX_SESSION_RENDERER_PI_AGENT_EVALUATIONS_ROOT", "PI_AGENT_EVALUATIONS_ROOT"];
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
    status: {},
  };
}

function parsePiAgentDefinition(env = process.env, homeDir = os.homedir()) {
  const root = resolvePiAgentRoot(env, homeDir);
  const configuredAgentHome = firstEnvValue(env, piAgentHomeEnvKeys);
  const autoDetected = !root.configured && !configuredAgentHome;
  const sessionsRoot = root.sessionsRoot;
  if (autoDetected && !existsSync(sessionsRoot)) return null;
  const agentHome = path.resolve(configuredAgentHome || root.agentHome);
  return {
    agentHome,
    sessionsRoot,
    ...root.dynamicRoot,
    autoDetected,
  };
}

function resolvePiAgentRoot(env, homeDir) {
  const configuredRoots = [
    { kind: "sessions", value: firstEnvValue(env, piAgentSessionsRootEnvKeys) },
    { kind: "tasks", value: firstEnvValue(env, piAgentTasksRootEnvKeys) },
    { kind: "evaluations", value: firstEnvValue(env, piAgentEvaluationsRootEnvKeys) },
  ].filter((root) => root.value);
  if (configuredRoots.length > 1) throw new Error("PI Agent 会话、任务和评估根目录不能同时配置。");
  const configuredRoot = configuredRoots[0];
  const sessionsRoot = path.resolve(configuredRoot?.value || path.join(homeDir, ".pi", "agent", "sessions"));
  const dynamicRoot = configuredRoot && configuredRoot.kind !== "sessions" ? { [`${configuredRoot.kind}Root`]: sessionsRoot } : {};
  return { configured: Boolean(configuredRoot), sessionsRoot, agentHome: configuredRoot ? sessionsRoot : path.dirname(sessionsRoot), dynamicRoot };
}

function firstEnvValue(env, keys) {
  for (const key of keys) {
    const value = env[key];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function createPiAgentDataSource({ agentHome, sessionsRoot, tasksRoot, evaluationsRoot, autoDetected }) {
  const sessionsAvailable = existsSync(sessionsRoot);
  return {
    id: piAgentSourceId,
    label: "Pi Agent Sessions",
    kind: "pi-agent",
    codexHome: agentHome,
    originalCodexHome: agentHome,
    sessionsRoot,
    taskSessionsRoot: tasksRoot,
    evaluationSessionsRoot: evaluationsRoot,
    sessionIndexPath: path.join(agentHome, "session_index.jsonl"),
    stateDbPath: path.join(agentHome, "state_5.sqlite"),
    origin: { type: "pi-agent", sessionsRoot, taskSessionsRoot: tasksRoot, evaluationSessionsRoot: evaluationsRoot, autoDetected },
    status: sessionsAvailable ? {} : { error: { code: "missing_sessions_root", message: "Pi Agent 会话目录不存在。" } },
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