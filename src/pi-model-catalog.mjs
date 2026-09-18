import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const modelCatalogFileEnvKey = "CODEX_SESSION_RENDERER_PI_MODEL_CATALOG_FILE";
const defaultRpcCommand = ["pi", "--mode", "rpc", "--no-session"];
const defaultRefreshTtlMs = 10 * 60_000;
const defaultQueryTimeoutMs = 30_000;

function positiveInt(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function buildModelIndex(models) {
  const map = new Map();
  for (const model of Array.isArray(models) ? models : []) {
    const provider = String(model?.provider || "").trim();
    const id = String(model?.id || model?.modelId || "").trim();
    if (!provider || !id) continue;
    map.set(`${provider}\u0000${id}`, { contextWindow: positiveInt(model?.contextWindow), maxTokens: positiveInt(model?.maxTokens) });
  }
  return map;
}

function lookupWindowIn(map, provider, modelId) {
  const key = `${String(provider || "").trim()}\u0000${String(modelId || "").trim()}`;
  const entry = map.get(key);
  return entry?.contextWindow ? { contextWindow: entry.contextWindow, maxTokens: entry.maxTokens } : null;
}

function createStaticModelCatalog(models) {
  const map = buildModelIndex(models);
  return {
    start() {},
    stop() {},
    refresh: async () => map,
    getModels: () => map,
    lookupWindow: (provider, modelId) => lookupWindowIn(map, provider, modelId),
  };
}

function resolvePiCommand() {
  const besideNode = path.join(path.dirname(process.execPath), "pi");
  return {
    command: existsSync(besideNode) ? [besideNode, "--mode", "rpc", "--no-session"] : [...defaultRpcCommand],
    hint: besideNode,
  };
}

function createPiModelCatalogService(options = {}) {
  const ttlMs = options.ttlMs ?? defaultRefreshTtlMs;
  const resolved = resolvePiCommand();
  const queryModels = options.queryModels ?? (() => queryPiRpcModels({ command: resolved.command }));
  const now = options.now ?? Date.now;
  let snapshot = null;
  let inFlight = null;
  let timer = null;

  async function refresh() {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const map = buildModelIndex(await queryModels());
      snapshot = { models: map, fetchedAt: now() };
      return map;
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  function start() {
    refresh().catch(() => {});
    const interval = setInterval(() => {
      if (!snapshot || now() - snapshot.fetchedAt >= ttlMs) refresh().catch(() => {});
    }, Math.max(Math.floor(ttlMs / 2), 1_000));
    interval.unref?.();
    timer = interval;
    return api;
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  const api = {
    start,
    stop,
    refresh,
    getModels: () => snapshot?.models ?? null,
    lookupWindow: (provider, modelId) => (snapshot ? lookupWindowIn(snapshot.models, provider, modelId) : null),
  };
  return api;
}

function queryPiRpcModels({ command = defaultRpcCommand, timeoutMs = defaultQueryTimeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), { stdio: ["pipe", "pipe", "ignore"] });
    let buffer = "";
    let settled = false;
    const finish = (settle, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill("SIGKILL");
      } catch {
        // 进程可能已退出。
      }
      settle(value);
    };
    const timer = setTimeout(() => finish(reject, new Error("Pi 模型目录查询超时。")), timeoutMs);
    child.on("error", (error) => finish(reject, error));
    child.stdout.on("data", (chunk) => {
      buffer += String(chunk);
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        if (event?.type === "response" && event.command === "get_available_models") {
          finish(resolve, event.data?.models || []);
        }
      }
    });
    child.stdin.write(`${JSON.stringify({ type: "get_available_models" })}\n`);
  });
}

function createPiModelCatalogFromEnv({ env = process.env, dynamicCatalog = null } = {}) {
  const filePath = env[modelCatalogFileEnvKey];
  if (filePath) {
    try {
      return createStaticModelCatalog(JSON.parse(readFileSync(filePath, "utf8")));
    } catch {
      return null;
    }
  }
  return dynamicCatalog ?? createPiModelCatalogService();
}

export { createPiModelCatalogService, createPiModelCatalogFromEnv, createStaticModelCatalog, queryPiRpcModels, modelCatalogFileEnvKey };
