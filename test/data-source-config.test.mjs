import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile, chmod } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDataSourceConfigStore } from "../src/data-source-config.mjs";
import { createDataSourceRegistry, envPiAgentRootDescription } from "../src/data-sources.mjs";
import { createSessionSourceContextService } from "../src/session-source-context-service.mjs";

async function withTempRoot(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "csr-data-source-config-"));
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function tempEnv(root, extra = {}) {
  return {
    CODEX_HOME: path.join(root, ".codex"),
    PI_AGENT_SESSIONS_ROOT: path.join(root, ".pi", "agent", "sessions"),
    CODEX_SESSION_RENDERER_CONFIG_PATH: path.join(root, "state", "data-source-config.json"),
    ...extra,
  };
}

test("config store treats a missing file as empty config", async () => {
  await withTempRoot(async (root) => {
    const store = createDataSourceConfigStore({ configPath: path.join(root, "state", "data-source-config.json") });
    assert.equal(store.enabled, true);
    assert.deepEqual(await store.read(), { override: null, error: null });
    const description = await store.describe();
    assert.equal(description.configPath, path.join(root, "state", "data-source-config.json"));
    assert.equal(description.override, null);
    assert.equal(description.parseError, null);
  });
});

test("config store reports corrupted JSON as parse error and keeps override null", async () => {
  await withTempRoot(async (root) => {
    const configPath = path.join(root, "data-source-config.json");
    await writeFile(configPath, "{ not json", "utf8");
    const store = createDataSourceConfigStore({ configPath });
    const { override, error } = await store.read();
    assert.equal(override, null);
    assert.match(error, /不是有效 JSON/);
    assert.equal(store.readSync().error, error);
  });
});

test("config store reads a valid override and ignores the legacy type field", async () => {
  await withTempRoot(async (root) => {
    const configPath = path.join(root, "data-source-config.json");
    await writeFile(configPath, JSON.stringify({ version: 1, piAgentRoot: { type: "tasks", path: "/srv/tasks" } }), "utf8");
    const store = createDataSourceConfigStore({ configPath });
    assert.deepEqual(await store.read(), { override: { path: "/srv/tasks" }, error: null });
  });
});

test("config store rejects unsupported versions and malformed overrides", async () => {
  await withTempRoot(async (root) => {
    const configPath = path.join(root, "data-source-config.json");
    await writeFile(configPath, JSON.stringify({ version: 2, piAgentRoot: null }), "utf8");
    const versioned = createDataSourceConfigStore({ configPath });
    assert.match((await versioned.read()).error, /版本不受支持/);

    await writeFile(configPath, JSON.stringify({ version: 1, piAgentRoot: { path: "relative/path" } }), "utf8");
    const malformed = createDataSourceConfigStore({ configPath });
    assert.match((await malformed.read()).error, /piAgentRoot\.path/);
  });
});

test("config store writes atomically and leaves no temporary files", async () => {
  await withTempRoot(async (root) => {
    const stateDir = path.join(root, "state");
    await mkdir(stateDir, { recursive: true });
    const configPath = path.join(stateDir, "data-source-config.json");
    const store = createDataSourceConfigStore({ configPath });
    await store.write({ path: "/srv/eval/*/pi-sessions" });

    const files = await readdir(stateDir);
    assert.deepEqual(files, ["data-source-config.json"]);
    assert.deepEqual(JSON.parse(await readFileUtf8(configPath)), { version: 1, piAgentRoot: { path: "/srv/eval/*/pi-sessions" } });
  });
});

async function readFileUtf8(filePath) {
  const { readFile } = await import("node:fs/promises");
  return readFile(filePath, "utf8");
}

test("config store write fails when the directory is missing and reports writable false", async () => {
  await withTempRoot(async (root) => {
    const configPath = path.join(root, "missing-dir", "data-source-config.json");
    const store = createDataSourceConfigStore({ configPath });
    assert.equal(await store.isWritable(), false);
    await assert.rejects(() => store.write(null), /配置文件写入失败/);
    const files = await readdir(root);
    assert.equal(files.includes("missing-dir"), false);
  });
});

test("validateOverrideForWrite accepts null without touching the filesystem", async () => {
  await withTempRoot(async (root) => {
    const store = createDataSourceConfigStore({ configPath: path.join(root, "data-source-config.json") });
    assert.equal(await store.validateOverrideForWrite(null), null);
  });
});

test("validateOverrideForWrite rejects relative paths, missing paths and files", async () => {
  await withTempRoot(async (root) => {
    const store = createDataSourceConfigStore({ configPath: path.join(root, "data-source-config.json") });
    await assert.rejects(() => store.validateOverrideForWrite({ path: "relative/path" }), /绝对路径/);
    await assert.rejects(() => store.validateOverrideForWrite({ path: path.join(root, "missing") }), /无法解析/);

    const filePath = path.join(root, "not-a-dir.jsonl");
    await writeFile(filePath, "", "utf8");
    await assert.rejects(() => store.validateOverrideForWrite({ path: filePath }), /必须是已存在的目录/);
  });
});

test("validateOverrideForWrite validates only the static prefix of wildcard patterns", async () => {
  await withTempRoot(async (root) => {
    const store = createDataSourceConfigStore({ configPath: path.join(root, "data-source-config.json") });
    const pattern = path.join(root, "tasks", "*", "output", "*", "pi-sessions");
    await mkdir(path.join(root, "tasks"), { recursive: true });
    await assert.rejects(() => store.validateOverrideForWrite({ path: path.join(root, "missing", "*", "pi-sessions") }), /固定前缀必须是已存在的目录/);
    assert.deepEqual(await store.validateOverrideForWrite({ path: pattern }), { path: pattern });
  });
});

test("validateOverrideForWrite resolves the override to a canonical realpath directory", async () => {
  await withTempRoot(async (root) => {
    const realDir = path.join(root, "real");
    const linkPath = path.join(root, "link");
    await mkdir(realDir, { recursive: true });
    await symlink(realDir, linkPath);
    const store = createDataSourceConfigStore({ configPath: path.join(root, "data-source-config.json") });
    assert.deepEqual(await store.validateOverrideForWrite({ path: linkPath }), { path: realDir });
  });
});

async function symlink(target, linkPath) {
  const { symlink: createLink } = await import("node:fs/promises");
  await createLink(target, linkPath);
}

test("registry override replaces the env Pi root", async () => {
  await withTempRoot(async (root) => {
    const env = tempEnv(root);
    const overrideRoot = path.join(root, "override-sessions");
    await mkdir(overrideRoot, { recursive: true });

    const registry = createDataSourceRegistry({ env, homeDir: root, piAgentRootOverride: { path: overrideRoot } });
    const piAgent = registry.getSource("pi-agent");
    assert.equal(piAgent.sessionsRoot, overrideRoot);
    assert.equal(registry.getDefaultSource().id, "pi-agent");
    assert.deepEqual(registry.getSource("local").codexHome, path.join(root, ".codex"));
  });
});

test("registry override with wildcards keeps sessionsRoot as the pattern and checks the static prefix", async () => {
  await withTempRoot(async (root) => {
    const env = tempEnv(root);
    await mkdir(path.join(root, "tasks"), { recursive: true });
    const registry = createDataSourceRegistry({ env, homeDir: root, piAgentRootOverride: { path: path.join(root, "tasks", "*", "pi-sessions") } });
    const piAgent = registry.getSource("pi-agent");
    assert.equal(piAgent.sessionsRoot, path.join(root, "tasks", "*", "pi-sessions"));
    assert.equal(piAgent.codexHome, path.join(root, "tasks"));
    assert.deepEqual(piAgent.status, {});

    const missing = createDataSourceRegistry({ env, homeDir: root, piAgentRootOverride: { path: path.join(root, "missing", "*", "pi-sessions") } });
    assert.deepEqual(missing.getSource("pi-agent").status.error?.code, "missing_sessions_root");
    assert.equal(missing.getDefaultSource().id, "pi-agent");
  });
});

test("registry override without the directory keeps the missing_sessions_root soft status", async () => {
  await withTempRoot(async (root) => {
    const env = tempEnv(root);
    const registry = createDataSourceRegistry({ env, homeDir: root, piAgentRootOverride: { path: path.join(root, "missing") } });
    assert.deepEqual(registry.getSource("pi-agent").status.error?.code, "missing_sessions_root");
    assert.equal(registry.getDefaultSource().id, "pi-agent");
  });
});

test("registry still enforces the env mutual exclusion with an override present", async () => {
  await withTempRoot(async (root) => {
    const env = tempEnv(root, { PI_AGENT_TASKS_ROOT: path.join(root, "tasks") });
    assert.throws(
      () => createDataSourceRegistry({ env, homeDir: root, piAgentRootOverride: { path: root } }),
      /不能同时配置/,
    );
  });
});

test("registry surfaces the config parse error on the pi-agent source status", async () => {
  await withTempRoot(async (root) => {
    const env = tempEnv(root);
    const registry = createDataSourceRegistry({ env, homeDir: root, configError: "配置文件不是有效 JSON。" });
    assert.deepEqual(registry.getSource("pi-agent").status, { error: { code: "config_parse_error", message: "配置文件不是有效 JSON。" } });
  });
});

test("envPiAgentRootDescription reports the env-configured root path", async () => {
  await withTempRoot(async (root) => {
    const env = tempEnv(root);
    assert.deepEqual(envPiAgentRootDescription(env, root), { path: path.join(root, ".pi", "agent", "sessions") });

    const evaluationsEnv = tempEnv(root, { PI_AGENT_SESSIONS_ROOT: "", PI_AGENT_EVALUATIONS_ROOT: path.join(root, "eval") });
    assert.deepEqual(envPiAgentRootDescription(evaluationsEnv, root), { path: path.join(root, "eval") });
  });
});

test("service rebuild swaps contexts and clears the cache after saving", async () => {
  await withTempRoot(async (root) => {
    const envSessionsRoot = path.join(root, ".pi", "agent", "sessions");
    const overrideRoot = path.join(root, "override-sessions");
    await mkdir(envSessionsRoot, { recursive: true });
    await mkdir(overrideRoot, { recursive: true });
    await mkdir(path.join(root, "state"), { recursive: true });
    const store = createDataSourceConfigStore({ configPath: path.join(root, "state", "data-source-config.json") });
    const service = createSessionSourceContextService({ maxListSessions: 5, env: tempEnv(root), homeDir: root, configStore: store });

    const localContextBefore = service.getSourceContext("local");
    const piAgentContextBefore = service.getSourceContext("pi-agent");
    assert.equal(piAgentContextBefore.sessionsRoot, envSessionsRoot);

    const result = await service.updateDataSourceConfig({ piAgentRoot: { path: overrideRoot } });
    assert.deepEqual(result.override, { path: overrideRoot });
    assert.equal(service.getSourceContext("pi-agent").sessionsRoot, overrideRoot);
    assert.notEqual(service.getSourceContext("pi-agent"), piAgentContextBefore);
    assert.notEqual(service.getSourceContext("local"), localContextBefore);
    assert.equal(service.getSourceContext("local").codexHome, localContextBefore.codexHome);
    assert.equal(service.getDefaultSource().id, "pi-agent");
    assert.deepEqual(
      JSON.parse(await readFileUtf8(store.configPath)),
      { version: 1, piAgentRoot: { path: overrideRoot } },
    );

    await service.updateDataSourceConfig({ piAgentRoot: null });
    assert.equal(service.getSourceContext("pi-agent").sessionsRoot, envSessionsRoot);
    assert.equal(JSON.parse(await readFileUtf8(store.configPath)).piAgentRoot, null);
  });
});

test("service update keeps the old registry when the write fails", async () => {
  await withTempRoot(async (root) => {
    const envSessionsRoot = path.join(root, ".pi", "agent", "sessions");
    const overrideRoot = path.join(root, "override-sessions");
    await mkdir(envSessionsRoot, { recursive: true });
    await mkdir(overrideRoot, { recursive: true });
    const unwritableDir = path.join(root, "unwritable");
    await mkdir(unwritableDir, { recursive: true });
    await chmod(unwritableDir, 0o555);
    const store = createDataSourceConfigStore({ configPath: path.join(unwritableDir, "data-source-config.json") });
    const service = createSessionSourceContextService({ maxListSessions: 5, env: tempEnv(root), homeDir: root, configStore: store });

    await assert.rejects(() => service.updateDataSourceConfig({ piAgentRoot: { path: overrideRoot } }), /配置文件写入失败/);
    assert.equal(service.getSourceContext("pi-agent").sessionsRoot, envSessionsRoot);
    assert.equal(service.getDefaultSource().id, "pi-agent");
  });
});

test("service update clears a corrupted config as the self-rescue path", async () => {
  await withTempRoot(async (root) => {
    const envSessionsRoot = path.join(root, ".pi", "agent", "sessions");
    await mkdir(envSessionsRoot, { recursive: true });
    const stateDir = path.join(root, "state");
    await mkdir(stateDir, { recursive: true });
    const configPath = path.join(stateDir, "data-source-config.json");
    await writeFile(configPath, "{ broken", "utf8");

    const store = createDataSourceConfigStore({ configPath });
    const service = createSessionSourceContextService({ maxListSessions: 5, env: tempEnv(root), homeDir: root, configStore: store });
    assert.equal(service.listSources().find((source) => source.id === "pi-agent").status.error?.code, "config_parse_error");
    assert.equal(service.getSourceContext("pi-agent").sessionsRoot, envSessionsRoot);

    const result = await service.updateDataSourceConfig({ piAgentRoot: null });
    assert.equal(result.override, null);
    assert.equal(result.parseError, null);
    assert.equal(service.getSourceContext("pi-agent").sessionsRoot, envSessionsRoot);
    assert.deepEqual(service.listSources().find((source) => source.id === "pi-agent").status, {});
  });
});

test("service rejects disabled config updates and malformed bodies", async () => {
  await withTempRoot(async (root) => {
    const disabledStore = createDataSourceConfigStore({ configPath: null, env: { CODEX_HOME: path.join(root, ".codex") }, homeDir: root });
    const service = createSessionSourceContextService({ maxListSessions: 5, env: { CODEX_HOME: path.join(root, ".codex") }, homeDir: root, configStore: disabledStore });

    assert.deepEqual(await service.describeDataSourceConfig(), {
      configPath: null,
      writable: false,
      override: null,
      envDefault: null,
      parseError: null,
    });
    await assert.rejects(() => service.updateDataSourceConfig({ piAgentRoot: null }), /未启用/);

    const enabledStore = createDataSourceConfigStore({ configPath: path.join(root, "state", "data-source-config.json") });
    const enabledService = createSessionSourceContextService({ maxListSessions: 5, env: tempEnv(root), homeDir: root, configStore: enabledStore });
    await assert.rejects(() => enabledService.updateDataSourceConfig({}), /piAgentRoot/);
    await assert.rejects(() => enabledService.updateDataSourceConfig([1]), /piAgentRoot/);
  });
});
