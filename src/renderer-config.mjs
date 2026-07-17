import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import {
  normalizePeerUrl as normalizeRemotePeerUrl,
  normalizeSourceId,
  remoteUrlQueryMessage,
  remoteUrlUserinfoMessage,
} from "./data-sources.mjs";

const configFileName = "config.json";
const defaultConfigDirName = ".codex-session-renderer";

function defaultConfigPath(homeDir = os.homedir()) {
  return path.join(homeDir, defaultConfigDirName, configFileName);
}

function createRendererConfigStore(options = {}) {
  const fsApi = options.fsApi || fs;
  const configPath = options.configPath || defaultConfigPath(options.homeDir || os.homedir());
  let mutationQueue = Promise.resolve();

  async function readConfig() {
    return normalizeConfig(await readConfigFile(configPath, fsApi));
  }

  async function writeConfig(config) {
    const normalized = normalizeConfig(config);
    const directory = path.dirname(configPath);
    const temporaryPath = `${configPath}.${randomUUID()}.tmp`;
    await fsApi.mkdir(directory, { recursive: true, mode: 0o700 });
    await fsApi.chmod(directory, 0o700);
    try {
      await fsApi.writeFile(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await fsApi.chmod(temporaryPath, 0o600);
      await fsApi.rename(temporaryPath, configPath);
      await fsApi.chmod(configPath, 0o600);
    } finally {
      await fsApi.rm(temporaryPath, { force: true });
    }
    return normalized;
  }

  async function listPeers() {
    const config = await readConfig();
    return config.peers.map(publicPeer);
  }

  function queueMutation(operation) {
    const result = mutationQueue.then(operation);
    mutationQueue = result.catch(() => {});
    return result;
  }

  function upsertPeer(input) {
    return queueMutation(async () => {
      const config = await readConfig();
      const normalizedUrl = normalizePeerUrl(input.url);
      const requestedId = normalizeSourceId(input.id || input.label || normalizedUrl);
      const index = config.peers.findIndex((item) => item.id === requestedId);
      const peer = normalizePeerInput({ ...input, url: normalizedUrl, requireToken: index < 0 });
      if (index >= 0) {
        const previous = config.peers[index];
        if (!peer.token && previous.token && peer.url !== previous.url) {
          throw validationError("token", "修改远端地址时必须重新填写访问令牌。");
        }
        config.peers[index] = { ...previous, ...peer, token: peer.token || previous.token || "" };
      } else {
        config.peers.push(peer);
      }
      await writeConfig(config);
      return publicPeer(config.peers.find((item) => item.id === peer.id));
    });
  }

  function deletePeer(id) {
    return queueMutation(async () => {
      const sourceId = normalizeSourceId(id);
      const config = await readConfig();
      const nextPeers = config.peers.filter((peer) => peer.id !== sourceId);
      if (nextPeers.length === config.peers.length) return false;
      await writeConfig({ ...config, peers: nextPeers });
      return true;
    });
  }

  return {
    configPath,
    deletePeer,
    listPeers,
    readConfig,
    upsertPeer,
    writeConfig: (config) => queueMutation(() => writeConfig(config)),
  };
}

async function readConfigFile(filePath, fsApi = fs) {
  try {
    const config = JSON.parse(await fsApi.readFile(filePath, "utf8"));
    await fsApi.chmod(path.dirname(filePath), 0o700);
    await fsApi.chmod(filePath, 0o600);
    return config;
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

function normalizeConfig(config = {}) {
  return {
    version: 1,
    peers: (config.peers || []).map((peer) => normalizeStoredPeer(peer)).filter(Boolean),
  };
}

function normalizeStoredPeer(peer) {
  try {
    const url = normalizePeerUrl(peer.url);
    const id = normalizeSourceId(peer.id || peer.label || url);
    return {
      id,
      label: String(peer.label || id).trim() || id,
      url,
      token: String(peer.token || ""),
      enabled: peer.enabled !== false,
      createdAt: peer.createdAt || new Date().toISOString(),
      updatedAt: peer.updatedAt || peer.createdAt || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function normalizePeerInput(input = {}) {
  const url = normalizePeerUrl(input.url);
  const id = normalizeSourceId(input.id || input.label || url);
  const now = new Date().toISOString();
  const peer = {
    id,
    label: String(input.label || id).trim() || id,
    url,
    token: String(input.token || ""),
    enabled: input.enabled !== false,
    updatedAt: now,
  };
  if (!peer.url) throw validationError("url", "远端地址不能为空。");
  if (!peer.token && input.requireToken !== false) throw validationError("token", "访问令牌不能为空。");
  return peer;
}

function normalizePeerUrl(value) {
  try {
    const normalized = normalizeRemotePeerUrl(value);
    if (!normalized) return "";
    return normalized;
  } catch (error) {
    if (error?.code === "remote_url_userinfo") throw validationError("url", remoteUrlUserinfoMessage);
    if (error?.code === "remote_url_query") throw validationError("url", remoteUrlQueryMessage);
    throw validationError("url", "远端地址格式无效。");
  }
}

function publicPeer(peer) {
  return {
    id: peer.id,
    label: peer.label,
    url: publicPeerUrl(peer.url),
    enabled: peer.enabled !== false,
    hasToken: Boolean(peer.token),
    createdAt: peer.createdAt || null,
    updatedAt: peer.updatedAt || null,
  };
}

function publicPeerUrl(value) {
  try {
    return normalizePeerUrl(value);
  } catch {
    return "";
  }
}

function validationError(field, message) {
  const error = new Error(message);
  error.status = 400;
  error.field = field;
  return error;
}

export {
  createRendererConfigStore,
  defaultConfigPath,
  normalizeConfig,
  normalizePeerInput,
  publicPeer,
};
