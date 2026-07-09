import { createReadStream, createWriteStream, existsSync, readFileSync, promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { spawn } from "node:child_process";

const defaultRemoteSnapshotRoot = path.join(os.homedir(), ".codex-session-renderer", "remote-snapshots");
const safeIdPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const snapshotStatusFile = ".codex-session-renderer-source.json";
const snapshotMetadataFile = ".codex-session-renderer-snapshot.json";
const allowedSnapshotFiles = new Set(["state_5.sqlite", "session_index.jsonl", snapshotMetadataFile]);
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
  const spawnImpl = options.spawnImpl || spawn;
  const localCodexHome = path.resolve(env.CODEX_HOME || path.join(homeDir, ".codex"));
  const remoteSnapshotRoot = path.resolve(env.CODEX_REMOTE_SNAPSHOT_ROOT || defaultRemoteSnapshotRoot);
  const remoteDefinitions = [...parseConfigRemoteDefinitions(options.config), ...parseRemoteDefinitions(env)];

  const sources = new Map();
  const activeRefreshes = new Map();
  const localSource = createLocalDataSource({ codexHome: localCodexHome });
  sources.set(localSource.id, localSource);

  for (const definition of remoteDefinitions) {
    const source = createRemoteDataSource({
      definition,
      remoteSnapshotRoot,
      now,
    });
    sources.set(source.id, source);
  }

  function listSources() {
    return [...sources.values()].map((source) => publicDataSource(source));
  }

  function getSource(id = "local") {
    return sources.get(id || "local") || null;
  }

  function getDefaultSource() {
    return sources.get("local");
  }

  async function refreshSource(id) {
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

    const existingRefresh = activeRefreshes.get(source.id);
    if (existingRefresh) return await existingRefresh;

    const refreshPromise = (async () => {
      await refreshRemoteSource(source, {
        fsApi,
        fetchImpl,
        spawnImpl,
        now,
      });
      return {
        ok: source.status.lastRefreshOk === true,
        status: source.status.lastRefreshOk === true ? 200 : 502,
        source: publicDataSource(source),
      };
    })();
    activeRefreshes.set(source.id, refreshPromise);
    try {
      return await refreshPromise;
    } finally {
      if (activeRefreshes.get(source.id) === refreshPromise) {
        activeRefreshes.delete(source.id);
      }
    }
  }

  return {
    getDefaultSource,
    getSource,
    listSources,
    refreshSource,
  };
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

function createRemoteDataSource({ definition, remoteSnapshotRoot, now }) {
  const snapshotRoot = path.resolve(definition.snapshotRoot || path.join(remoteSnapshotRoot, definition.id));
  const codexHome = path.join(snapshotRoot, "current");
  const snapshotMetadata = readSnapshotMetadataSync(codexHome);
  const originalCodexHome = definition.remoteCodexHome || snapshotMetadata?.codexHome || codexHome;
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
    },
    codexHome,
    originalCodexHome,
    sessionsRoot: path.join(codexHome, "sessions"),
    sessionIndexPath: path.join(codexHome, "session_index.jsonl"),
    stateDbPath: path.join(codexHome, "state_5.sqlite"),
    snapshotRoot,
    currentPath: codexHome,
    definition,
    status: {
      configured: true,
      refreshable: true,
      refreshing: false,
      lastRefreshOk: null,
      lastSuccessfulRefreshAt: null,
      stale: false,
      snapshotAvailable: false,
      error: null,
    },
  };
  source.statusFile = path.join(snapshotRoot, snapshotStatusFile);
  const persisted = readPersistedStatus(source.statusFile);
  source.status.lastRefreshOk = persisted?.status?.lastRefreshOk ?? null;
  source.status.lastSuccessfulRefreshAt = persisted?.status?.lastSuccessfulRefreshAt ?? null;
  source.status.error = persisted?.status?.error ?? null;
  source.status.snapshotAvailable = existsSync(source.currentPath);
  source.status.stale = source.status.snapshotAvailable && source.status.lastRefreshOk === false;
  source.status.loadedAt = now().toISOString();
  return source;
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
  source.status.startedAt = startedAt;

  try {
    await fsApi.mkdir(source.snapshotRoot, { recursive: true });
    const stagingPath = path.join(source.snapshotRoot, `staging-${Date.now()}-${process.pid}`);
    await fsApi.rm(stagingPath, { recursive: true, force: true });
    await fsApi.mkdir(stagingPath, { recursive: true });

    try {
      await fetchRemoteSnapshotToDirectory(source, stagingPath, options);
      const codexHomePath = await findSnapshotCodexHome(stagingPath, source.definition.remoteCodexHome, fsApi);
      const snapshotMetadata = await readSnapshotMetadata(codexHomePath, fsApi);
      if (!source.definition.remoteCodexHome && snapshotMetadata?.codexHome) {
        updateSourceOriginalCodexHome(source, snapshotMetadata.codexHome);
      }
      await validateSnapshot(codexHomePath, fsApi);
      await publishSnapshot(source, codexHomePath, fsApi, now);
      source.status.lastRefreshOk = true;
      source.status.lastSuccessfulRefreshAt = now().toISOString();
      source.status.snapshotAvailable = true;
      source.status.stale = false;
      source.status.error = null;
    } finally {
      await fsApi.rm(stagingPath, { recursive: true, force: true });
    }
  } catch (error) {
    source.status.lastRefreshOk = false;
    source.status.snapshotAvailable = await pathExists(source.currentPath, fsApi);
    source.status.stale = source.status.snapshotAvailable;
    source.status.error = classifyRefreshError(error);
    await fsApi.mkdir(source.snapshotRoot, { recursive: true }).catch(() => {});
  } finally {
    source.status.refreshing = false;
    source.status.completedAt = now().toISOString();
    await writeStatusFile(source, fsApi).catch(() => {});
  }
}

async function fetchRemoteSnapshotToDirectory(source, stagingPath, options = {}) {
  const { definition } = source;
  if (definition.snapshotPath) {
    await copySnapshotTree(definition.snapshotPath, stagingPath, options.fsApi || fs);
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

async function copySnapshotTree(sourcePath, stagingPath, fsApi = fs) {
  if (!(await pathExists(sourcePath, fsApi))) {
    throw remoteRefreshError("snapshot_failed", "配置的快照路径不可读。");
  }
  await copyCodexTree(sourcePath, stagingPath, fsApi);
}

async function copyCodexTree(sourcePath, targetPath, fsApi = fs, options = {}) {
  await fsApi.mkdir(targetPath, { recursive: true });
  const entries = await fsApi.readdir(sourcePath, { withFileTypes: true });
  for (const entry of entries) {
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
      await fsApi.mkdir(path.dirname(to), { recursive: true });
      await fsApi.copyFile(from, to);
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
  const response = await fetchImpl(source.definition.snapshotUrl, {
    headers: {
      authorization: `Bearer ${source.definition.token}`,
    },
  }).catch((error) => {
    throw remoteRefreshError("unreachable", error?.message || "远端不可达。");
  });
  if (response.status === 401 || response.status === 403) {
    throw remoteRefreshError("auth_failed", "远端认证失败。");
  }
  if (!response.ok || !response.body) {
    throw remoteRefreshError("transport_failed", `远端快照下载失败：HTTP ${response.status}`);
  }

  const archivePath = path.join(stagingPath, "snapshot.tar");
  await pipeline(Readable.fromWeb(response.body), createWriteStream(archivePath));
  await extractTarArchive(archivePath, stagingPath, source.definition.snapshotUrl, options.spawnImpl || spawn);
  await fsApi.rm(archivePath, { force: true });
}

async function extractTarArchive(archivePath, targetDir, sourceUrl, spawnImpl = spawn) {
  const tarArgs = ["-xf", archivePath, "-C", targetDir];
  const lower = String(sourceUrl || archivePath).toLowerCase();
  const useGunzip = lower.endsWith(".tgz") || lower.endsWith(".tar.gz");
  if (!useGunzip) {
    await runProcess(spawnImpl, "tar", tarArgs, "snapshot_failed");
    return;
  }

  const inflatedPath = `${archivePath}.inflated`;
  await pipeline(createReadStream(archivePath), createGunzip(), createWriteStream(inflatedPath));
  try {
    await runProcess(spawnImpl, "tar", ["-xf", inflatedPath, "-C", targetDir], "snapshot_failed");
  } finally {
    await fs.rm(inflatedPath, { force: true });
  }
}

function runProcess(spawnImpl, command, args, code) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => reject(remoteRefreshError(code, error?.message || `${command} 启动失败。`)));
    child.on("close", (exitCode) => {
      if (exitCode === 0) {
        resolve();
      } else {
        reject(remoteRefreshError(code, firstSafeLine(stderr) || `${command} 退出码 ${exitCode}`));
      }
    });
  });
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

function updateSourceOriginalCodexHome(source, originalCodexHome) {
  source.originalCodexHome = originalCodexHome;
  source.origin.remoteCodexHome = originalCodexHome;
}

async function publishSnapshot(source, codexHomePath, fsApi = fs, now = () => new Date()) {
  const nextPath = path.join(source.snapshotRoot, `next-${Date.now()}-${process.pid}`);
  const previousPath = path.join(source.snapshotRoot, "previous");
  await fsApi.rm(nextPath, { recursive: true, force: true });
  await copyCodexTree(codexHomePath, nextPath, fsApi);
  await validateSnapshot(nextPath, fsApi);
  await fsApi.rm(previousPath, { recursive: true, force: true });
  if (await pathExists(source.currentPath, fsApi)) {
    await fsApi.rename(source.currentPath, previousPath);
  }
  try {
    await fsApi.rename(nextPath, source.currentPath);
  } catch (error) {
    if (await pathExists(previousPath, fsApi)) {
      await fsApi.rename(previousPath, source.currentPath).catch(() => {});
    }
    throw remoteRefreshError("local_snapshot_unavailable", error?.message || "本地快照发布失败。");
  }
  await fsApi.rm(previousPath, { recursive: true, force: true });
  source.status.publishedAt = now().toISOString();
}

async function writeStatusFile(source, fsApi = fs) {
  const status = publicDataSource(source);
  await fsApi.writeFile(source.statusFile, `${JSON.stringify(status, null, 2)}\n`, "utf8");
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

function publicDataSource(source) {
  return {
    id: source.id,
    label: source.label,
    kind: source.kind,
    origin: publicRemoteOrigin(source.origin),
    isDefault: source.id === "local",
    codexHome: source.kind === "local" ? source.codexHome : null,
    snapshotPath: source.kind === "remote" ? source.currentPath : null,
    status: {
      configured: source.status.configured,
      refreshable: source.status.refreshable,
      refreshing: source.status.refreshing,
      lastRefreshOk: source.status.lastRefreshOk,
      lastSuccessfulRefreshAt: source.status.lastSuccessfulRefreshAt,
      stale: source.status.stale,
      snapshotAvailable: source.status.snapshotAvailable,
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
  parseConfigRemoteDefinitions,
  parseRemoteDefinitions,
  publicDataSource,
  remoteUrlQueryMessage,
  remoteUrlUserinfoMessage,
  safeRemoteError,
  sanitizeErrorMessage,
  snapshotMetadataFile,
  validateSnapshot,
};
