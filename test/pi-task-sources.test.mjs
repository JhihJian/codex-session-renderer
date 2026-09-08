import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDataSourceRegistry, parsePiAgentDefinition } from "../src/data-sources.mjs";

test("createDataSourceRegistry supports a dynamic Pi Agent task root", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-pi-task-source-"));
  try {
    const tasksRoot = path.join(dir, "runtime-state", "tasks");
    await mkdir(tasksRoot, { recursive: true });
    const registry = createDataSourceRegistry({
      env: {
        CODEX_HOME: path.join(dir, ".codex"),
        PI_AGENT_TASKS_ROOT: tasksRoot,
      },
      homeDir: dir,
    });

    const source = registry.getSource("pi-agent");
    assert.equal(source.sessionsRoot, tasksRoot);
    assert.equal(source.taskSessionsRoot, tasksRoot);
    assert.equal(source.codexHome, tasksRoot);
    assert.equal(source.status.snapshotAvailable, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("parsePiAgentDefinition rejects ambiguous direct and dynamic Pi roots", () => {
  assert.throws(
    () => parsePiAgentDefinition({ PI_AGENT_SESSIONS_ROOT: "/tmp/pi-sessions", PI_AGENT_TASKS_ROOT: "/tmp/tasks" }, "/tmp/home"),
    /不能同时配置/,
  );
});