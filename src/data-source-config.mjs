import { constants as fsConstants, readFileSync, promises as fs } from "node:fs";
import path from "node:path";
import { containsWildcard, wildcardStaticPrefix } from "./root-pattern.mjs";
import { envPiAgentRootDescription } from "./data-sources.mjs";

const CONFIG_VERSION = 1;

function resolveConfigPathFromEnv(env = process.env) {
  const raw = String(env.CODEX_SESSION_RENDERER_CONFIG_PATH || "").trim();
  if (!raw) return null;
  if (!path.isAbsolute(raw)) {
    const error = new Error("CODEX_SESSION_RENDERER_CONFIG_PATH 必须是绝对路径。");
    error.code = "invalid_config_path";
    throw error;
  }
  return raw;
}

function parseOverrideShape(value) {
  if (value === null || value === undefined) return { override: null, error: null };
  if (typeof value !== "object" || Array.isArray(value)) return { override: null, error: "piAgentRoot 必须是对象或 null。" };
  // 兼容旧配置中的 type 字段：根类型概念已移除，统一按路径（可含 * 通配符）读取。
  const rootPath = typeof value.path === "string" ? value.path.trim() : "";
  if (!rootPath || !path.isAbsolute(rootPath)) return { override: null, error: "piAgentRoot.path 必须是绝对路径，可含 * 通配符。" };
  return { override: { path: rootPath }, error: null };
}

function badRequest(message, field = "piAgentRoot") {
  const error = new Error(message);
  error.status = 400;
  error.code = "invalid_data_source_config";
  error.field = field;
  return error;
}

function parseConfigContent(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { override: null, error: "配置文件不是有效 JSON。" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { override: null, error: "配置文件内容必须是对象。" };
  if (parsed.version !== CONFIG_VERSION) return { override: null, error: `配置文件版本不受支持：${String(parsed.version)}` };
  const { override, error } = parseOverrideShape(parsed.piAgentRoot === undefined ? null : parsed.piAgentRoot);
  return { override, error: error ? `配置文件 ${error}` : null };
}

function readConfigFile(configPath) {
  try {
    return { text: readFileSync(configPath, "utf8") };
  } catch (error) {
    return { error };
  }
}

function createDataSourceConfigStore(options = {}) {
  const configPath = options.configPath !== undefined ? options.configPath : resolveConfigPathFromEnv(options.env || process.env);
  const env = options.env || process.env;
  const homeDir = options.homeDir;

  function normalizeReadResult(result) {
    if (result.error) {
      if (result.error.code === "ENOENT") return { override: null, error: null };
      return { override: null, error: `配置文件读取失败：${result.error.code || result.error.message || "未知错误"}` };
    }
    return parseConfigContent(result.text);
  }

  async function read() {
    if (configPath == null) return { override: null, error: null };
    try {
      return normalizeReadResult({ text: await fs.readFile(configPath, "utf8") });
    } catch (error) {
      return normalizeReadResult({ error });
    }
  }

  function readSync() {
    if (configPath == null) return { override: null, error: null };
    return normalizeReadResult(readConfigFile(configPath));
  }

  async function isWritable() {
    if (configPath == null) return false;
    try {
      await fs.access(path.dirname(configPath), fsConstants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  async function validateOverrideForWrite(value) {
    const { override, error } = parseOverrideShape(value);
    if (error) throw badRequest(error);
    if (!override) return null;
    if (containsWildcard(override.path)) {
      const prefix = wildcardStaticPrefix(override.path);
      const prefixStat = await fs.stat(prefix).catch(() => null);
      if (!prefixStat?.isDirectory()) throw badRequest(`piAgentRoot.path 固定前缀必须是已存在的目录：${prefix || "/"}`, "piAgentRoot.path");
      return { path: override.path };
    }
    let resolved;
    try {
      resolved = await fs.realpath(override.path);
    } catch {
      throw badRequest(`piAgentRoot.path 无法解析为真实路径：${override.path}`, "piAgentRoot.path");
    }
    const stat = await fs.stat(resolved).catch(() => null);
    if (!stat?.isDirectory()) throw badRequest(`piAgentRoot.path 必须是已存在的目录：${override.path}`, "piAgentRoot.path");
    return { path: resolved };
  }

  async function write(override) {
    const body = `${JSON.stringify({ version: CONFIG_VERSION, piAgentRoot: override }, null, 2)}\n`;
    const tempPath = path.join(path.dirname(configPath), `.${path.basename(configPath)}.${process.pid}.${Date.now()}.tmp`);
    try {
      await fs.writeFile(tempPath, body, "utf8");
      await fs.rename(tempPath, configPath);
    } catch (error) {
      await fs.unlink(tempPath).catch(() => {});
      const failure = new Error(`配置文件写入失败：${error?.code || error?.message || "未知错误"}`);
      failure.status = 500;
      failure.code = "config_write_failed";
      throw failure;
    }
  }

  async function describe() {
    const current = await read();
    return {
      configPath,
      writable: await isWritable(),
      override: current.override,
      envDefault: envPiAgentRootDescription(env, homeDir),
      parseError: current.error,
    };
  }

  return {
    enabled: configPath != null,
    configPath,
    describe,
    read,
    readSync,
    isWritable,
    validateOverrideForWrite,
    write,
  };
}

export { createDataSourceConfigStore, parseOverrideShape };
