import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeSourceId } from "./data-sources.mjs";

const configFileName = "config.json";
const defaultConfigDirName = ".codex-session-renderer";

function defaultConfigPath(homeDir = os.homedir()) {
  return path.join(homeDir, defaultConfigDirName, configFileName);
}

function createRendererConfigStore(options = {}) {
  const fsApi = options.fsApi || fs;
  const configPath = options.configPath || defaultConfigPath(options.homeDir || os.homedir());

  async function readConfig() {
    return normalizeConfig(await readConfigFile(configPath, fsApi));
  }

  async function writeConfig(config) {
    const normalized = normalizeConfig(config);
    await fsApi.mkdir(path.dirname(configPath), { recursive: true });
    await fsApi.writeFile(configPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    return normalized;
  }

  async function listPeers() {
    const config = await readConfig();
    return config.peers.map(publicPeer);
  }

  async function upsertPeer(input) {
    const config = await readConfig();
    const requestedId = normalizeSourceId(input.id || input.label || input.url);
    const index = config.peers.findIndex((item) => item.id === requestedId);
    const peer = normalizePeerInput({ ...input, requireToken: index < 0 });
    if (index >= 0) {
      const previous = config.peers[index];
      config.peers[index] = {
        ...previous,
        ...peer,
        token: peer.token || previous.token || "",
      };
    } else {
      config.peers.push(peer);
    }
    await writeConfig(config);
    return publicPeer(config.peers.find((item) => item.id === peer.id));
  }

  async function deletePeer(id) {
    const sourceId = normalizeSourceId(id);
    const config = await readConfig();
    const nextPeers = config.peers.filter((peer) => peer.id !== sourceId);
    if (nextPeers.length === config.peers.length) return false;
    await writeConfig({ ...config, peers: nextPeers });
    return true;
  }

  return {
    configPath,
    deletePeer,
    listPeers,
    readConfig,
    upsertPeer,
    writeConfig,
  };
}

async function readConfigFile(filePath, fsApi = fs) {
  try {
    return JSON.parse(await fsApi.readFile(filePath, "utf8"));
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
    const id = normalizeSourceId(peer.id || peer.label || peer.url);
    return {
      id,
      label: String(peer.label || id).trim() || id,
      url: normalizePeerUrl(peer.url),
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
  const id = normalizeSourceId(input.id || input.label || input.url);
  const now = new Date().toISOString();
  const peer = {
    id,
    label: String(input.label || id).trim() || id,
    url: normalizePeerUrl(input.url),
    token: String(input.token || ""),
    enabled: input.enabled !== false,
    updatedAt: now,
  };
  if (!peer.url) throw validationError("url", "远端地址不能为空。");
  if (!peer.token && input.requireToken !== false) throw validationError("token", "Token 不能为空。");
  return peer;
}

function normalizePeerUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  const url = new URL(withProtocol);
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function publicPeer(peer) {
  return {
    id: peer.id,
    label: peer.label,
    url: peer.url,
    enabled: peer.enabled !== false,
    hasToken: Boolean(peer.token),
    createdAt: peer.createdAt || null,
    updatedAt: peer.updatedAt || null,
  };
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
