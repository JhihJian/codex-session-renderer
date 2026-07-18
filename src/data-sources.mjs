import { chmodSync, createReadStream, createWriteStream, existsSync, lstatSync, readFileSync, readdirSync, renameSync, promises as fs } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import * as tar from "tar";
import { createConcurrencyGate, createSharedSubscriptionRegistry } from "./prompt-archive-coordinator.mjs";
import { createDeadlineSignal, fetchWithDeadline, isAbortError, pipelineLimitedResponse, throwIfAborted } from "./remote-http.mjs";
import { createByteLimitTransform, createContentBudget, snapshotBudgetError } from "./snapshot-budget.mjs";
import { createSnapshotRootCommitCoordinator } from "./snapshot-root-commit-coordinator.mjs";
import { syncStateFile } from "./sync-71-state.mjs";


const safeIdPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const snapshotStatusFile = ".codex-session-renderer-source.json";
const snapshotProvenanceFile = ".codex-session-renderer-snapshot-source.json";
const snapshotMetadataFile = ".codex-session-renderer-snapshot.json";

const allowedSnapshotFiles = new Set(["state_5.sqlite", "session_index.jsonl", snapshotMetadataFile]);
const piAgentSourceId = "pi-agent";
const piAgentSessionsRootEnvKeys = ["CODEX_SESSION_RENDERER_PI_AGENT_SESSIONS_ROOT", "PI_AGENT_SESSIONS_ROOT", "PI_AGENT_SESSIONS"];
const piAgentHomeEnvKeys = ["CODEX_SESSION_RENDERER_PI_AGENT_HOME", "PI_AGENT_HOME"];
const remoteUrlQueryCode = "remote_url_query";
const remoteUrlQueryMessage = "远端地址不能包含查询参数或片段；认证信息只填写在访问令牌字段里。";
const remoteUrlUserinfoCode = "remote_url_userinfo";
const remoteUrlUserinfoMessage = "远端地址不能把账号或密码写在地址里；请在访问令牌里配置认证信息。";

function createDataSourceRegistry(options = {}) {
  const env = options.env || process.env;
  const homeDir = options.homeDir || os.homedir();
  const now = options.now || (() => new Date());
  const fsApi = options.fsApi || fs;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const isUnix = isUnixPlatform(options);
  const refreshLimits = remoteRefreshLimits(env);
  const refreshGate = options.refreshGate || createConcurrencyGate(refreshLimits.maxConcurrent);
  const refreshSubscriptions = options.refreshSubscriptions || createSharedSubscriptionRegistry();
  const sourceIdentityRegistry = options.sourceIdentityRegistry || new Map();
  const snapshotCommitCoordinator = options.snapshotCommitCoordinator || createSnapshotRootCommitCoordinator();
  const localCodexHome = path.resolve(env.CODEX_HOME || path.join(homeDir, ".codex"));
  const remoteSnapshotRoot = path.resolve(env.CODEX_REMOTE_SNAPSHOT_ROOT || path.join(homeDir, ".codex-session-renderer", "remote-snapshots"));
  const remoteDefinitions = [...parseConfigRemoteDefinitions(options.config), ...parseRemoteDefinitions(env)];
  const piAgentDefinition = parsePiAgentDefinition(env, homeDir);

  const sources = buildDataSources({
    localCodexHome,
    remoteDefinitions,
    remoteSnapshotRoot,
    piAgentDefinition,
    now,
    sourceIdentityRegistry,
    snapshotCommitCoordinator,
    renameCurrent: options.renameCurrent || renameSync,
    beforeFinalCurrentPublish: options.beforeFinalCurrentPublish,
    isUnix,
  });

  function listSources() {
    return [...sources.values()].map((source) => publicDataSource(source));
  }

  function getSource(id = "local") {
    return sources.get(id || "local") || null;
  }

  function getDefaultSource() {
    return sources.get("local");
  }

  async function refreshSource(id, options = {}) {
    const source = getSource(id);
    if (!source) {
      return {
        ok: false,
        status: 404,
        error: safeRemoteError("not_configured", "数据源不存在。"),
      };
    }
    if (source.kind !== "remote") {
      return {
        ok: false,
        status: 400,
        error: safeRemoteError("not_refreshable", "本机数据源不需要刷新。"),
      };
    }

    const refreshPromise = refreshSubscriptions.subscribe(`${source.snapshotRoot}:${source.sourceVersion}`, async (signal) => {
      await refreshGate.run(async () => {
        await refreshRemoteSource(source, {
          fsApi,
          fetchImpl,
          now,
          signal,
          limits: refreshLimits,
          isUnix,
        });
      }, signal);
      if (!source.isCurrent()) {
        const error = sourceConfigurationChangedError();
        error.status = 409;
        markRefreshFailure(source, error);
      }
      return {
        ok: source.isCurrent() && source.status.lastRefreshOk === true,
        status: source.isCurrent() ? (source.status.lastRefreshOk === true ? 200 : source.status.lastRefreshStatus || 502) : 409,
        error: source.isCurrent() ? undefined : safeRemoteError("source_configuration_changed", "远端来源配置已变更；本次旧快照拉取已取消。"),
        source: publicDataSource(source),
      };
    }, options.signal);
    return await refreshPromise;
  }

  return {
    getDefaultSource,
    getSource,
    listSources,
    refreshSource,
    refreshLimits,
  };
}

function buildDataSources(options) {
  const sources = new Map();
  const localSource = createLocalDataSource({ codexHome: options.localCodexHome });
  sources.set(localSource.id, localSource);
  for (const definition of options.remoteDefinitions) {
    const source = createRemoteDataSource({ definition, ...options });
    sources.set(source.id, source);
  }
  if (options.piAgentDefinition && !sources.has(piAgentSourceId)) {
    const source = createPiAgentDataSource(options.piAgentDefinition);
    sources.set(source.id, source);
  }
  synchronizeSourceIdentityRegistry(options.sourceIdentityRegistry, sources);
  return sources;
}

function remoteRefreshLimits(env = process.env) {
  return {
    deadlineMs: positiveEnv(env, "CODEX_REMOTE_HTTP_DEADLINE_MS", 30_000, 300_000),
    snapshotMaxBytes: positiveEnv(env, "CODEX_REMOTE_SNAPSHOT_MAX_BYTES", 256 * 1024 * 1024, 2 * 1024 * 1024 * 1024),
    snapshotMaxExpandedBytes: positiveEnv(env, "CODEX_REMOTE_SNAPSHOT_MAX_EXPANDED_BYTES", 512 * 1024 * 1024, 4 * 1024 * 1024 * 1024),
    snapshotMaxFiles: positiveEnv(env, "CODEX_REMOTE_SNAPSHOT_MAX_FILES", 10_000, 100_000),
    maxConcurrent: positiveEnv(env, "CODEX_REMOTE_MAX_CONCURRENT_REFRESHES", 2, 16),
    maxGenerations: positiveEnv(env, "CODEX_REMOTE_MAX_SNAPSHOT_GENERATIONS", 2, 16),
  };
}

function positiveEnv(env, name, fallback, maximum) {
  const value = Number(env[name]);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), maximum);
}

function createLocalDataSource({ codexHome }) {
  return {
    id: "local",
    label: "本机 Codex Home",
    kind: "local",
    origin: {
      type: "local",
      codexHome,
    },
    codexHome,
    originalCodexHome: codexHome,
    sessionsRoot: path.join(codexHome, "sessions"),
    sessionIndexPath: path.join(codexHome, "session_index.jsonl"),
    stateDbPath: path.join(codexHome, "state_5.sqlite"),
    status: {
      configured: true,
      refreshable: false,
      refreshing: false,
      lastRefreshOk: null,
      lastSuccessfulRefreshAt: null,
      stale: false,
      snapshotAvailable: true,
      error: null,
    },
  };
}

function createRemoteDataSource({ definition, remoteSnapshotRoot, now, sourceIdentityRegistry, snapshotCommitCoordinator, renameCurrent, beforeFinalCurrentPublish, isUnix }) {
  const snapshotRoot = path.resolve(definition.snapshotRoot || path.join(remoteSnapshotRoot, definition.id));
  const codexHome = path.join(snapshotRoot, "current");
  tightenExistingSnapshotPermissions(snapshotRoot, isUnix);
  const snapshotMetadata = readSnapshotMetadataSync(codexHome);
  const originalCodexHome = definition.remoteCodexHome || snapshotMetadata?.codexHome || codexHome;
  const sourceVersion = remoteSourceVersion(definition, snapshotRoot);
  const status = initialRemoteSourceStatus({
    sourceVersion,
    currentPath: codexHome,
    persisted: readPersistedStatus(path.join(snapshotRoot, snapshotStatusFile)),
    provenance: readSnapshotProvenanceSync(codexHome),
  });
  const source = {
    id: definition.id,
    label: definition.label || definition.id,
    kind: "remote",
    origin: {
      type: "remote",
      remoteCodexHome: originalCodexHome === codexHome ? null : originalCodexHome,
      snapshotUrlConfigured: Boolean(definition.snapshotUrl),
      snapshotPathConfigured: Boolean(definition.snapshotPath),
      peerUrl: definition.peerUrl || null,
      managed: definition.managed === true,
      sourceVersion,
    },
    codexHome,
    originalCodexHome,
    sessionsRoot: path.join(codexHome, "sessions"),
    sessionIndexPath: path.join(codexHome, "session_index.jsonl"),
    stateDbPath: path.join(codexHome, "state_5.sqlite"),
    snapshotRoot,
    currentPath: codexHome,
    definition,
    sourceVersion,
    snapshotCommitCoordinator,
    renameCurrent,
    beforeFinalCurrentPublish,
    isUnix,
    isCurrent: () => sourceIdentityRegistry.get(definition.id) === sourceVersion,
    status,
  };
  source.statusFile = path.join(snapshotRoot, snapshotStatusFile);
  source.status.loadedAt = now().toISOString();
  return source;
}

function isUnixPlatform(options) {
  return options.isUnix ?? process.platform !== "win32";
}

function initialRemoteSourceStatus({ sourceVersion, currentPath, persisted, provenance }) {
  const status = {
    configured: true,
    refreshable: true,
    refreshing: false,
    lastRefreshOk: null,
    lastSuccessfulRefreshAt: null,
    stale: false,
    snapshotAvailable: false,
    needsRefresh: true,
    sourceVersion,
    error: null,
  };
  if (!snapshotMatchesCurrentSource(currentPath, provenance, sourceVersion)) {
    status.error = unavailableSnapshotError(existsSync(currentPath));
    return status;
  }
  return statusForMatchingSnapshot(status, persisted, sourceVersion);
}

function snapshotMatchesCurrentSource(currentPath, provenance, sourceVersion) {
  return existsSync(currentPath) && provenance?.sourceVersion === sourceVersion;
}

function unavailableSnapshotError(currentExists) {
  return currentExists
    ? safeRemoteError("snapshot_source_changed", "远端来源已变更，需要拉取新快照。")
    : safeRemoteError("snapshot_required", "尚未拉取远端快照。");
}

function statusForMatchingSnapshot(status, persisted, sourceVersion) {
  if (persistedStatusSourceVersion(persisted) === sourceVersion) {
    status.lastRefreshOk = persisted?.status?.lastRefreshOk ?? null;
    status.lastSuccessfulRefreshAt = persisted?.status?.lastSuccessfulRefreshAt ?? null;
    status.error = persisted?.status?.error ?? null;
    status.snapshotAvailable = true;
    status.needsRefresh = false;
    status.stale = status.lastRefreshOk === false;
    return status;
  }
  status.snapshotAvailable = true;
  status.needsRefresh = false;
  status.stale = true;
  status.error = safeRemoteError("snapshot_status_recovered", "快照状态文件不可用，已从完整同源快照安全恢复。");
  return status;
}

function persistedStatusSourceVersion(persisted) {
  return persisted?.status?.sourceVersion || persisted?.sourceVersion || "";
}

function synchronizeSourceIdentityRegistry(sourceIdentityRegistry, sources) {
  const remoteSources = [...sources.values()].filter((source) => source.kind === "remote");
  const activeIds = new Set(remoteSources.map((source) => source.id));
  for (const sourceId of sourceIdentityRegistry.keys()) {
    if (!activeIds.has(sourceId)) sourceIdentityRegistry.delete(sourceId);
  }
  for (const source of remoteSources) sourceIdentityRegistry.set(source.id, source.sourceVersion);
}

function remoteSourceVersion(definition, snapshotRoot) {
  const identity = {
    schema: "remote-source-v1",
    snapshotUrl: normalizeSourceIdentityUrl(definition.snapshotUrl),
    snapshotPath: definition.snapshotPath ? path.resolve(definition.snapshotPath) : "",
    remoteCodexHome: normalizeRemoteCodexHome(definition.remoteCodexHome),
    snapshotRoot: path.resolve(snapshotRoot),
  };
  return `remote-v1-${createHash("sha256").update(JSON.stringify(identity)).digest("hex").slice(0, 20)}`;
}

function normalizeSourceIdentityUrl(value) {
  if (!value) return "";
  try {
    return new URL(String(value)).toString();
  } catch {
    return String(value).trim();
  }
}

function normalizeRemoteCodexHome(value) {
  return String(value || "").trim().replaceAll("\\", "/").replace(/\/+$/, "");
}

function parseRemoteDefinitions(env = process.env) {
  const peerDefinitions = parsePeerDefinitions(env);
  const raw = env.CODEX_REMOTE_SOURCES || "";
  const ids = raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const definitions = [...peerDefinitions, ...ids.map((id) => parseRemoteDefinition(id, env)).filter(Boolean)];

  if (definitions.length === 0 && hasSingleRemoteConfig(env)) {
    const single = parseRemoteDefinition(env.CODEX_REMOTE_SOURCE_ID || "remote", env);
    if (single) definitions.push(single);
  }
  return definitions;
}

function parsePiAgentDefinition(env = process.env, homeDir = os.homedir()) {
  const configuredSessionsRoot = firstEnvValue(env, piAgentSessionsRootEnvKeys);
  const configuredAgentHome = firstEnvValue(env, piAgentHomeEnvKeys);
  const sessionsRoot = path.resolve(configuredSessionsRoot || path.join(homeDir, ".pi", "agent", "sessions"));
  const autoDetected = !configuredSessionsRoot && !configuredAgentHome;
  if (autoDetected && !existsSync(sessionsRoot)) return null;
  const agentHome = path.resolve(configuredAgentHome || path.dirname(sessionsRoot));
  return {
    agentHome,
    sessionsRoot,
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

function createPiAgentDataSource({ agentHome, sessionsRoot, autoDetected }) {
  const snapshotAvailable = existsSync(sessionsRoot);
  return {
    id: piAgentSourceId,
    label: "Pi Agent Sessions",
    kind: "pi-agent",
    origin: {
      type: "pi-agent",
      sessionsRoot,
      autoDetected,
    },
    codexHome: agentHome,
    originalCodexHome: agentHome,
    sessionsRoot,
    sessionIndexPath: path.join(agentHome, "session_index.jsonl"),
    stateDbPath: path.join(agentHome, "state_5.sqlite"),
    status: {
      configured: true,
      refreshable: false,
      refreshing: false,
      lastRefreshOk: null,
      lastSuccessfulRefreshAt: null,
      stale: false,
      snapshotAvailable,
      error: snapshotAvailable ? null : safeRemoteError("missing_sessions_root", "Pi Agent 会话目录不存在。"),
    },
  };
}

function parseConfigRemoteDefinitions(config = {}) {
  return (config.peers || [])
    .filter((peer) => peer && peer.enabled !== false)
    .map((peer, index) => parseConfigPeerDefinition(peer, index))
    .filter(Boolean);
}

function parseConfigPeerDefinition(peer, index = 0) {
  const peerUrl = normalizePeerUrl(peer.url);
  const sourceId = normalizeSourceId(peer.id || peer.label || peerUrl || `remote-${index + 1}`);
  return {
    id: sourceId,
    label: peer.label || sourceId,
    snapshotUrl: snapshotUrlFromPeerUrl(peerUrl),
    snapshotPath: "",
    remoteCodexHome: peer.remoteCodexHome || "",
    tokenEnv: "renderer-config",
    token: peer.token || "",
    snapshotRoot: peer.snapshotRoot ? path.resolve(peer.snapshotRoot) : "",
    allowInsecureTls: peer.allowInsecureTls === true,
    peerUrl,
    indexUrl: peerIndexUrlFromPeerUrl(peerUrl),
    managed: true,
  };
}

function hasSingleRemoteConfig(env) {
  return Boolean(
    env.CODEX_REMOTE_PEERS ||
    env.CODEX_REMOTE_SOURCE_ID ||
      env.CODEX_REMOTE_LABEL ||
      env.CODEX_REMOTE_SNAPSHOT_URL ||
      env.CODEX_REMOTE_SNAPSHOT_PATH ||
      env.CODEX_REMOTE_CODEX_HOME,
  );
}

function parsePeerDefinitions(env = process.env) {
  return String(env.CODEX_REMOTE_PEERS || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry, index) => parsePeerDefinition(entry, env, index))
    .filter(Boolean);
}

function parsePeerDefinition(entry, env = process.env, index = 0) {
  const parsed = splitPeerEntry(entry);
  const sourceId = normalizeSourceId(parsed.id || peerIdFromUrl(parsed.url) || `remote-${index + 1}`);
  const prefix = envPrefix(sourceId);
  const tokenEnv = env[`${prefix}_TOKEN_ENV`] || env.CODEX_REMOTE_TOKEN_ENV || "CODEX_REMOTE_TOKEN";
  const token = env[`${prefix}_TOKEN`] || env[tokenEnv] || env.CODEX_REMOTE_TOKEN || "";
  const label = env[`${prefix}_LABEL`] || parsed.label || sourceId;
  const remoteCodexHome = env[`${prefix}_CODEX_HOME`] || "";
  const snapshotRoot = env[`${prefix}_SNAPSHOT_ROOT`] || "";
  const allowInsecureTls = env[`${prefix}_ALLOW_INSECURE_TLS`] === "1";
  const peerUrl = normalizePeerUrl(parsed.url);

  return {
    id: sourceId,
    label,
    snapshotUrl: snapshotUrlFromPeerUrl(peerUrl),
    snapshotPath: "",
    remoteCodexHome,
    tokenEnv,
    token,
    snapshotRoot: snapshotRoot ? path.resolve(snapshotRoot) : "",
    allowInsecureTls,
    peerUrl,
    indexUrl: peerIndexUrlFromPeerUrl(peerUrl),
  };
}

function splitPeerEntry(entry) {
  const separator = entry.indexOf("=");
  if (separator < 0) {
    return {
      id: "",
      label: "",
      url: entry,
    };
  }
  const left = entry.slice(0, separator).trim();
  const [id, label = ""] = left.split("|").map((part) => part.trim());
  return {
    id,
    label,
    url: entry.slice(separator + 1).trim(),
  };
}

function peerIdFromUrl(value) {
  try {
    return new URL(normalizePeerUrl(value)).hostname;
  } catch {
    return "";
  }
}

function snapshotUrlFromPeerUrl(value) {
  const url = new URL(normalizePeerUrl(value));
  const pathname = url.pathname || "/";
  if (!/\.(tar|tgz|tar\.gz)$/i.test(pathname)) {
    url.pathname = `${pathname.replace(/\/+$/, "")}/api/codex-snapshot.tar`;
    url.searchParams.set("scope", "realtime");
  }
  return url.toString();
}

function peerIndexUrlFromPeerUrl(value) {
  const url = new URL(normalizePeerUrl(value));
  const pathname = url.pathname || "/";
  url.pathname = `${pathname.replace(/\/+$/, "")}/api/codex-session-index`;
  url.search = "";
  return url.toString();
}

function normalizePeerUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  const url = new URL(withProtocol);
  rejectUrlUserinfo(url);
  rejectUrlQuery(url);
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

function rejectRemoteUrlUserinfo(value) {
  const text = String(value || "").trim();
  if (!text || !/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return text;
  rejectUrlUserinfo(new URL(text));
  return text;
}

function rejectUrlUserinfo(url) {
  if (!url.username && !url.password) return;
  const error = new Error(remoteUrlUserinfoMessage);
  error.code = remoteUrlUserinfoCode;
  throw error;
}

function rejectUrlQuery(url) {
  if (!url.search && !url.hash) return;
  const error = new Error(remoteUrlQueryMessage);
  error.code = remoteUrlQueryCode;
  throw error;
}

function publicRemoteOrigin(origin = {}) {
  const publicOrigin = { ...origin };
  if (publicOrigin.peerUrl) publicOrigin.peerUrl = publicRemoteUrl(publicOrigin.peerUrl);
  return publicOrigin;
}

function publicRemoteUrl(value) {
  try {
    return normalizePeerUrl(value);
  } catch {
    return null;
  }
}

function parseRemoteDefinition(id, env = process.env) {
  const sourceId = normalizeSourceId(id);
  const prefix = envPrefix(sourceId);
  const label = env[`${prefix}_LABEL`] || (sourceId === "remote" ? env.CODEX_REMOTE_LABEL : "");
  const snapshotUrl = rejectRemoteUrlUserinfo(
    env[`${prefix}_SNAPSHOT_URL`] || (sourceId === "remote" ? env.CODEX_REMOTE_SNAPSHOT_URL : ""),
  );
  const snapshotPath = env[`${prefix}_SNAPSHOT_PATH`] || (sourceId === "remote" ? env.CODEX_REMOTE_SNAPSHOT_PATH : "");
  const remoteCodexHome = env[`${prefix}_CODEX_HOME`] || (sourceId === "remote" ? env.CODEX_REMOTE_CODEX_HOME : "");
  const tokenEnv = env[`${prefix}_TOKEN_ENV`] || (sourceId === "remote" ? env.CODEX_REMOTE_TOKEN_ENV : "") || `${prefix}_TOKEN`;
  const token = env[tokenEnv] || "";
  const snapshotRoot = env[`${prefix}_SNAPSHOT_ROOT`] || (sourceId === "remote" ? env.CODEX_REMOTE_SOURCE_SNAPSHOT_ROOT : "");
  const allowInsecureTls =
    env[`${prefix}_ALLOW_INSECURE_TLS`] === "1" || (sourceId === "remote" && env.CODEX_REMOTE_ALLOW_INSECURE_TLS === "1");

  return {
    id: sourceId,
    label: label || sourceId,
    snapshotUrl: snapshotUrl || "",
    snapshotPath: snapshotPath ? path.resolve(snapshotPath) : "",
    remoteCodexHome: remoteCodexHome || "",
    tokenEnv,
    token,
    snapshotRoot: snapshotRoot ? path.resolve(snapshotRoot) : "",
    allowInsecureTls,
  };
}

function normalizeSourceId(value) {
  const id = String(value || "remote").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!safeIdPattern.test(id)) throw new Error(`Invalid remote source id: ${value}`);
  if (id === "local") throw new Error("Remote source id cannot be local");
  return id;
}

function envPrefix(sourceId) {
  return `CODEX_REMOTE_${sourceId.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
}

async function refreshRemoteSource(source, options = {}) {
  const fsApi = options.fsApi || fs;
  const now = options.now || (() => new Date());
  const startedAt = now().toISOString();
  source.status.refreshing = true;
  source.status.error = null;
  source.status.lastRefreshStatus = null;
  source.status.startedAt = startedAt;
  const deadline = createDeadlineSignal(options.signal, options.limits?.deadlineMs, "snapshot_deadline_exceeded");
  const signal = deadline.signal;

  try {
    assertSourceIdentityCurrent(source);
    throwIfAborted(signal);
    await createPrivateDirectory(source.snapshotRoot, fsApi, options.isUnix);
    const stagingPath = path.join(source.snapshotRoot, `staging-${source.sourceVersion}-${Date.now()}-${process.pid}`);
    await removeTree(stagingPath, fsApi);
    await createPrivateDirectory(stagingPath, fsApi, options.isUnix);

    try {
      await refreshAndPublishSource(source, stagingPath, { ...options, now, signal });
      markRefreshSuccess(source, now);
    } finally {
      await removeTree(stagingPath, fsApi);
    }
  } catch (error) {
    if (isAbortError(error)) throw error;
    markRefreshFailure(source, error);
    await createPrivateDirectory(source.snapshotRoot, fsApi, options.isUnix).catch(() => {});
  } finally {
    deadline.dispose();
    await finishRemoteRefresh(source, fsApi, now);
  }
}

async function refreshAndPublishSource(source, stagingPath, options) {
  await fetchRemoteSnapshotToDirectory(source, stagingPath, options);
  assertSourceIdentityCurrent(source);
  throwIfAborted(options.signal);
  const codexHomePath = await findSnapshotCodexHome(stagingPath, source.definition.remoteCodexHome, options.fsApi || fs);
  const snapshotMetadata = await readSnapshotMetadata(codexHomePath, options.fsApi || fs);
  if (!source.definition.remoteCodexHome && snapshotMetadata?.codexHome) updateSourceOriginalCodexHome(source, snapshotMetadata.codexHome);
  await validateSnapshot(codexHomePath, options.fsApi || fs);
  assertSourceIdentityCurrent(source);
  await publishSnapshot(source, codexHomePath, options);
}

function markRefreshSuccess(source, now) {
  source.status.lastRefreshOk = true;
  source.status.lastSuccessfulRefreshAt = now().toISOString();
  source.status.snapshotAvailable = true;
  source.status.needsRefresh = false;
  source.status.stale = false;
  source.status.error = null;
}

function markRefreshFailure(source, error) {
  source.status.lastRefreshOk = false;
  source.status.lastRefreshStatus = error?.status || (error?.code === "source_configuration_changed" ? 409 : 502);
  const sourceChanged = error?.code === "source_configuration_changed";
  source.status.snapshotAvailable = sourceChanged ? false : source.status.snapshotAvailable && source.isCurrent();
  source.status.needsRefresh = !source.status.snapshotAvailable;
  source.status.stale = !sourceChanged && source.status.snapshotAvailable;
  source.status.error = classifyRefreshError(error);
}

async function finishRemoteRefresh(source, fsApi, now) {
  source.status.refreshing = false;
  source.status.completedAt = now().toISOString();
  if (source.isCurrent()) await writeStatusFile(source, fsApi).catch(() => {});
}

function assertSourceIdentityCurrent(source) {
  if (source.isCurrent()) return;
  const error = sourceConfigurationChangedError();
  error.status = 409;
  throw error;
}

function sourceConfigurationChangedError() {
  return remoteRefreshError("source_configuration_changed", "远端来源配置已变更；本次旧快照拉取已取消。");
}

async function fetchRemoteSnapshotToDirectory(source, stagingPath, options = {}) {
  const { definition } = source;
  if (definition.snapshotPath) {
    await copySnapshotTree(definition.snapshotPath, stagingPath, options.fsApi || fs, options);
    return;
  }
  if (definition.snapshotUrl) {
    if (!definition.token) {
      throw remoteRefreshError("missing_token", `缺少 ${definition.tokenEnv}。`);
    }
    await downloadSnapshotArchive(source, stagingPath, options);
    return;
  }
  throw remoteRefreshError("not_configured", "远端数据源缺少 snapshotPath 或 snapshotUrl。");
}

async function copySnapshotTree(sourcePath, stagingPath, fsApi = fs, options = {}) {
  if (!(await pathExists(sourcePath, fsApi))) {
    throw remoteRefreshError("snapshot_failed", "配置的快照路径不可读。");
  }
  await assertCompleteSync71Snapshot(sourcePath, fsApi);
  await copyCodexTree(sourcePath, stagingPath, fsApi, options);
}

async function assertCompleteSync71Snapshot(sourcePath, fsApi) {
  const statePath = path.join(sourcePath, syncStateFile);
  let stateText;
  try {
    stateText = await fsApi.readFile(statePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw remoteRefreshError("snapshot_failed", "无法读取同步状态，未发布新快照。");
  }
  try {
    if (JSON.parse(stateText)?.complete !== false) return;
  } catch {
    // A malformed ownership marker is not safe to treat as a complete snapshot.
  }
  throw remoteRefreshError("partial_sync_snapshot", "同步目标是限量验证结果，不能发布到工作台。请不带 --limit 完成全量同步后再刷新。");
}

async function copyCodexTree(sourcePath, targetPath, fsApi = fs, options = {}) {
  throwIfAborted(options.signal);
  await createPrivateDirectory(targetPath, fsApi, options.isUnix);
  const entries = await fsApi.readdir(sourcePath, { withFileTypes: true });
  for (const entry of entries) {
    throwIfAborted(options.signal);
    const from = path.join(sourcePath, entry.name);
    const to = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      if (!options.inSessions && entry.name !== "sessions") continue;
      await copyCodexTree(from, to, fsApi, { ...options, inSessions: options.inSessions || entry.name === "sessions" });
    } else if (
      entry.isFile() &&
      (allowedSnapshotFiles.has(entry.name) ||
        (options.inSessions && entry.name.endsWith(".jsonl") && (await shouldCopySessionFile(from, entry, options))))
    ) {
      await createPrivateDirectory(path.dirname(to), fsApi, options.isUnix);
      await options.beforeCopyFile?.(from, entry);
      await fsApi.copyFile(from, to);
      await setPrivateMode(to, 0o600, fsApi, options.isUnix);
      throwIfAborted(options.signal);
    }
  }
}

async function shouldCopySessionFile(filePath, entry, options = {}) {
  if (!options.includeSessionFile) return true;
  return Boolean(await options.includeSessionFile(filePath, entry));
}

async function downloadSnapshotArchive(source, stagingPath, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const fsApi = options.fsApi || fs;
  if (!fetchImpl) throw remoteRefreshError("transport_failed", "当前 Node 运行时缺少 fetch。");
  const response = await fetchWithDeadline(fetchImpl, source.definition.snapshotUrl, {
    headers: {
      authorization: `Bearer ${source.definition.token}`,
    },
  }, {
    signal: options.signal,
  }).catch((error) => {
    if (isAbortError(error) || error?.code === "snapshot_deadline_exceeded") throw error;
    throw remoteRefreshError("unreachable", error?.message || "远端不可达。");
  });
  if (response.status === 401 || response.status === 403) {
    throw remoteRefreshError("auth_failed", "远端认证失败。");
  }
  if (!response.ok) {
    throw remoteRefreshError("transport_failed", `远端快照下载失败：HTTP ${response.status}`);
  }

  const archivePath = path.join(stagingPath, "snapshot.tar");
  try {
    await pipelineLimitedResponse(response, createWriteStream(archivePath, { mode: 0o600 }), {
      maxBytes: options.limits?.snapshotMaxBytes || 256 * 1024 * 1024,
      code: "snapshot_too_large",
      signal: options.signal,
    });
  } catch (error) {
    throwIfAborted(options.signal);
    throw error;
  }
  await extractTarArchive(archivePath, stagingPath, {
    limits: options.limits,
    signal: options.signal,
  });
  await tightenSnapshotTree(stagingPath, fsApi, options.isUnix);
  await fsApi.rm(archivePath, { force: true });
}

async function extractTarArchive(archivePath, targetDir, options = {}) {
  const limits = options.limits || {};
  const expandedBudget = createContentBudget({
    maxBytes: limits.snapshotMaxExpandedBytes || 512 * 1024 * 1024,
    maxFiles: limits.snapshotMaxFiles || 10_000,
    bytesCode: "snapshot_expanded_too_large",
    filesCode: "snapshot_too_many_files",
  });
  const seenPaths = new Set();
  let archiveError = null;
  let unpack;
  const rejectArchive = (error) => {
    archiveError ||= error;
    unpack?.abort(archiveError);
  };
  unpack = tar.x({
    cwd: targetDir,
    strict: true,
    preserveOwner: false,
    noChmod: true,
    onReadEntry(entry) {
      try {
        const entryPath = normalizeArchivePath(entry.path);
        if (!isSafeArchivePath(entry.path, entryPath) || !isAllowedArchiveEntry(entryPath, entry.type)) {
          throw snapshotBudgetError("snapshot_unsafe_archive", "快照包含不允许的文件或条目类型。");
        }
        if (seenPaths.has(entryPath)) {
          throw snapshotBudgetError("snapshot_unsafe_archive", "快照包含重复文件路径。");
        }
        seenPaths.add(entryPath);
        if (entry.type === "File") {
          expandedBudget.addFile(entry.size, options.signal);
        } else {
          expandedBudget.addEntry(options.signal);
        }
      } catch (error) {
        rejectArchive(error);
      }
    },
    onwarn() {
      rejectArchive(snapshotBudgetError("snapshot_invalid_archive", "快照归档格式无效。"));
    },
  });
  const unpackClosed = new Promise((resolve) => unpack.once("close", resolve));
  const streams = [createReadStream(archivePath)];
  if (await isGzipArchive(archivePath)) streams.push(createGunzip());
  streams.push(createByteLimitTransform({
    maxBytes: limits.snapshotMaxExpandedBytes || 512 * 1024 * 1024,
    code: "snapshot_expanded_too_large",
    signal: options.signal,
  }), unpack);
  try {
    await pipeline(...streams, { signal: options.signal });
  } catch (error) {
    if (!archiveError && !unpack.writableEnded) unpack.abort(error);
    await unpackClosed;
    if (archiveError) throw archiveError;
    throwIfAborted(options.signal);
    if (isAbortError(error) || String(error?.code || "").startsWith("snapshot_")) throw error;
    throw remoteRefreshError("snapshot_invalid_archive", "快照归档格式无效。");
  }
}

function normalizeArchivePath(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
}

function isSafeArchivePath(value, normalizedPath) {
  const rawPath = String(value || "").replaceAll("\\", "/");
  if (rawPath.startsWith("/") || /^[a-z]:/i.test(rawPath)) return false;
  const segments = normalizedPath.split("/").filter(Boolean);
  return !segments.includes("..") && segments.length <= 32;
}

function isAllowedArchiveEntry(entryPath, type) {
  if (type !== "Directory" && type !== "File") return false;
  if (!entryPath) return type === "Directory";
  if (entryPath === "sessions" || entryPath.startsWith("sessions/")) {
    return type === "Directory" || entryPath.endsWith(".jsonl");
  }
  return type === "File" && allowedSnapshotFiles.has(entryPath);
}

async function isGzipArchive(archivePath) {
  const handle = await fs.open(archivePath, "r");
  try {
    const buffer = Buffer.alloc(2);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return bytesRead === 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
  } finally {
    await handle.close();
  }
}


async function findSnapshotCodexHome(stagingPath, remoteCodexHome, fsApi = fs) {
  if (await looksLikeCodexHome(stagingPath, fsApi)) return stagingPath;

  const candidates = [
    path.join(stagingPath, ".codex"),
    path.join(stagingPath, "codex"),
    path.join(stagingPath, "root", ".codex"),
    path.join(stagingPath, remoteCodexHome || ""),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (await looksLikeCodexHome(candidate, fsApi)) return candidate;
  }

  const queue = [stagingPath];
  for (let depth = 0; depth < 4 && queue.length > 0; depth += 1) {
    const level = queue.splice(0);
    for (const dir of level) {
      const entries = await fsApi.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const child = path.join(dir, entry.name);
        if (await looksLikeCodexHome(child, fsApi)) return child;
        queue.push(child);
      }
    }
  }

  throw remoteRefreshError("snapshot_failed", "快照中没有可识别的 Codex Home。");
}

async function looksLikeCodexHome(dir, fsApi = fs) {
  return (await pathExists(path.join(dir, "sessions"), fsApi)) || (await pathExists(path.join(dir, "session_index.jsonl"), fsApi));
}

async function validateSnapshot(codexHomePath, fsApi = fs) {
  const sessionsPath = path.join(codexHomePath, "sessions");
  const hasSessions = await pathExists(sessionsPath, fsApi);
  const hasIndex = await pathExists(path.join(codexHomePath, "session_index.jsonl"), fsApi);
  const hasDb = await pathExists(path.join(codexHomePath, "state_5.sqlite"), fsApi);
  if (!hasSessions && !hasIndex && !hasDb) {
    throw remoteRefreshError("snapshot_failed", "快照缺少 Codex 会话数据。");
  }
}

async function readSnapshotMetadata(codexHomePath, fsApi = fs) {
  try {
    return JSON.parse(await fsApi.readFile(path.join(codexHomePath, snapshotMetadataFile), "utf8"));
  } catch {
    return null;
  }
}

function readSnapshotMetadataSync(codexHomePath) {
  try {
    return JSON.parse(readFileSync(path.join(codexHomePath, snapshotMetadataFile), "utf8"));
  } catch {
    return null;
  }
}

function readSnapshotProvenanceSync(codexHomePath) {
  try {
    return JSON.parse(readFileSync(path.join(codexHomePath, snapshotProvenanceFile), "utf8"));
  } catch {
    return null;
  }
}

function updateSourceOriginalCodexHome(source, originalCodexHome) {
  source.originalCodexHome = originalCodexHome;
  source.origin.remoteCodexHome = originalCodexHome;
}

async function publishSnapshot(source, codexHomePath, options = {}) {
  const fsApi = options.fsApi || fs;
  const now = options.now || (() => new Date());
  const signal = options.signal;
  const maxGenerations = options.maxGenerations || 2;
  const versionsPath = path.join(source.snapshotRoot, "versions");
  const generation = `snapshot-${source.sourceVersion}-${Date.now()}-${process.pid}`;
  const nextPath = path.join(versionsPath, generation);
  const nextLink = path.join(source.snapshotRoot, `.current-${generation}`);
  let committed = false;
  try {
    assertSourceIdentityCurrent(source);
    await createPrivateDirectory(versionsPath, fsApi, options.isUnix);
    await fsApi.rm(nextPath, { recursive: true, force: true });
    await copyCodexTree(codexHomePath, nextPath, fsApi, { signal, isUnix: options.isUnix });
    await writeSnapshotProvenance(nextPath, source, fsApi, options.isUnix);
    throwIfAborted(signal);
    await validateSnapshot(nextPath, fsApi);
    await fsApi.rm(nextLink, { force: true });
    await fsApi.symlink(path.relative(source.snapshotRoot, nextPath), nextLink, "dir");
    throwIfAborted(signal);
    // A test hook can yield here. The final identity check and pointer replacement cannot.
    await source.beforeFinalCurrentPublish?.(source);
    source.snapshotCommitCoordinator.run(source.snapshotRoot, () => {
      assertSourceIdentityCurrent(source);
      throwIfAborted(signal);
      source.renameCurrent(nextLink, source.currentPath);
    });
    committed = true;
  } catch (error) {
    await fsApi.rm(nextLink, { force: true }).catch(() => {});
    if (!committed) await fsApi.rm(nextPath, { recursive: true, force: true }).catch(() => {});
    if (isAbortError(error) || String(error?.code || "").startsWith("snapshot_")) throw error;
    throw remoteRefreshError("local_snapshot_unavailable", error?.message || "本地快照发布失败。");
  }
  await pruneSnapshotGenerations(versionsPath, generation, maxGenerations, fsApi);
  source.status.publishedAt = now().toISOString();
}

async function pruneSnapshotGenerations(versionsPath, currentGeneration, maxGenerations, fsApi) {
  const entries = await fsApi.readdir(versionsPath, { withFileTypes: true }).catch(() => []);
  const generations = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("snapshot-"))
    .map((entry) => entry.name)
    .toSorted((left, right) => right.localeCompare(left));
  const retained = new Set(generations.slice(0, Math.max(1, maxGenerations)));
  retained.add(currentGeneration);
  await Promise.all(generations.filter((generation) => !retained.has(generation)).map((generation) => fsApi.rm(path.join(versionsPath, generation), { recursive: true, force: true }).catch(() => {})));
}

async function writeStatusFile(source, fsApi = fs) {
  await createPrivateDirectory(source.snapshotRoot, fsApi, source.isUnix);
  const temporaryPath = `${source.statusFile}.${randomUUID()}.tmp`;
  try {
    await fsApi.writeFile(temporaryPath, `${JSON.stringify(publicDataSource(source), null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await setPrivateMode(temporaryPath, 0o600, fsApi, source.isUnix);
    await fsApi.rename(temporaryPath, source.statusFile);
    await setPrivateMode(source.statusFile, 0o600, fsApi, source.isUnix);
  } finally {
    await fsApi.rm(temporaryPath, { force: true }).catch(() => {});
  }
}

async function writeSnapshotProvenance(snapshotPath, source, fsApi, isUnix) {
  const provenancePath = path.join(snapshotPath, snapshotProvenanceFile);
  const provenance = {
    schema: "remote-snapshot-source-v1",
    sourceVersion: source.sourceVersion,
  };
  await fsApi.writeFile(provenancePath, `${JSON.stringify(provenance)}\n`, { encoding: "utf8", mode: 0o600 });
  await setPrivateMode(provenancePath, 0o600, fsApi, isUnix);
}

async function createPrivateDirectory(directory, fsApi, isUnix) {
  await fsApi.mkdir(directory, { recursive: true, mode: 0o700 });
  await setPrivateMode(directory, 0o700, fsApi, isUnix);
}

async function setPrivateMode(filePath, mode, fsApi, isUnix) {
  if (!isUnix || typeof fsApi.chmod !== "function") return;
  await fsApi.chmod(filePath, mode);
}

function tightenExistingSnapshotPermissions(snapshotRoot, isUnix) {
  if (!isUnix || !existsSync(snapshotRoot)) return;
  const tighten = (entryPath) => {
    const entry = lstatSync(entryPath);
    if (entry.isSymbolicLink()) return;
    chmodSync(entryPath, entry.isDirectory() ? 0o700 : 0o600);
    if (!entry.isDirectory()) return;
    for (const child of readdirSync(entryPath)) tighten(path.join(entryPath, child));
  };
  tighten(snapshotRoot);
}

async function tightenSnapshotTree(snapshotRoot, fsApi, isUnix) {
  const entries = await fsApi.readdir(snapshotRoot, { withFileTypes: true });
  await createPrivateDirectory(snapshotRoot, fsApi, isUnix);
  for (const entry of entries) {
    const entryPath = path.join(snapshotRoot, entry.name);
    if (entry.isDirectory()) await tightenSnapshotTree(entryPath, fsApi, isUnix);
    else if (entry.isFile()) await setPrivateMode(entryPath, 0o600, fsApi, isUnix);
  }
}

function readPersistedStatus(statusFile) {
  try {
    return JSON.parse(readFileSync(statusFile, "utf8"));
  } catch {
    return null;
  }
}

async function pathExists(filePath, fsApi = fs) {
  try {
    await fsApi.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function removeTree(targetPath, fsApi = fs) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await fsApi.rm(targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      if (error?.code !== "ENOTEMPTY" && error?.code !== "EBUSY") throw error;
      await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }
  throw lastError;
}

function publicDataSource(source) {
  return {
    id: source.id,
    label: source.label,
    kind: source.kind,
    origin: publicRemoteOrigin(source.origin),
    isDefault: source.id === "local",
    codexHome: source.kind === "remote" ? null : source.codexHome,
    snapshotPath: source.kind === "remote" ? source.currentPath : null,
    status: {
      configured: source.status.configured,
      refreshable: source.status.refreshable,
      refreshing: source.status.refreshing,
      lastRefreshOk: source.status.lastRefreshOk,
      lastSuccessfulRefreshAt: source.status.lastSuccessfulRefreshAt,
      stale: source.status.stale,
      snapshotAvailable: source.status.snapshotAvailable,
      needsRefresh: source.status.needsRefresh === true,
      sourceVersion: source.status.sourceVersion || source.sourceVersion || null,
      error: source.status.error,
    },
  };
}

function remoteRefreshError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function safeRemoteError(code, message) {
  return {
    code,
    message: sanitizeErrorMessage(message),
  };
}

function classifyRefreshError(error) {
  return safeRemoteError(error?.code || "refresh_failed", error?.message || "刷新失败。");
}

function sanitizeErrorMessage(message) {
  const text = firstSafeLine(message || "刷新失败。");
  const authPlaceholder = "__CSR_AUTH_BEARER_REDACTED__";
  return text
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^@/\s]+@/gi, "$1[redacted]@")
    .replace(/authorization\s*[=:]\s*bearer\s+[a-z0-9._~+/=-]+/gi, authPlaceholder)
    .replace(/bearer\s+[a-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/token[=:]\s*[^\s]+/gi, "token=[redacted]")
    .replace(/authorization[=:]\s*[^\s]+/gi, "authorization=[redacted]")
    .replaceAll(authPlaceholder, "authorization=Bearer [redacted]");
}

function firstSafeLine(value) {
  return String(value || "").split(/\r?\n/).find((line) => line.trim())?.trim().slice(0, 240) || "";
}

export {
  copyCodexTree,
  createDataSourceRegistry,
  normalizePeerUrl,
  normalizeSourceId,
  parsePiAgentDefinition,
  parseConfigRemoteDefinitions,
  parseRemoteDefinitions,
  piAgentSourceId,
  publicDataSource,
  remoteSourceVersion,
  remoteRefreshLimits,
  remoteUrlQueryMessage,
  remoteUrlUserinfoMessage,
  safeRemoteError,
  sanitizeErrorMessage,
  snapshotMetadataFile,
  validateSnapshot,
};
