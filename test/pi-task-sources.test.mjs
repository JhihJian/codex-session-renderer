import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDataSourceRegistry, parsePiAgentDefinition } from "../src/data-sources.mjs";
import { createSessionDirectoryQueryService } from "../src/session-directory-query-service.mjs";

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
    assert.deepEqual(source.status, {});
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

test("createDataSourceRegistry supports an evaluation-root Pi Agent source", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-pi-evaluation-source-"));
  try {
    const evaluationsRoot = path.join(dir, "work", "evaluations");
    await mkdir(evaluationsRoot, { recursive: true });
    const registry = createDataSourceRegistry({
      env: {
        CODEX_HOME: path.join(dir, ".codex"),
        PI_AGENT_EVALUATIONS_ROOT: evaluationsRoot,
      },
      homeDir: dir,
    });

    const source = registry.getSource("pi-agent");
    assert.equal(source.sessionsRoot, evaluationsRoot);
    assert.equal(source.evaluationSessionsRoot, evaluationsRoot);
    assert.equal(source.codexHome, evaluationsRoot);
    assert.deepEqual(source.status, {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("evaluation-root discovery only reads Pi sessions below each evaluation output directory", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-pi-evaluation-discovery-"));
  try {
    const evaluationsRoot = path.join(dir, "evaluations");
    const evaluationIds = ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"];
    for (const evaluationId of evaluationIds) {
      const sessionsRoot = path.join(evaluationsRoot, evaluationId, "output", "pi-sessions", "2026", "09", "18");
      await mkdir(sessionsRoot, { recursive: true });
      await writeFile(path.join(sessionsRoot, "pi-stdout.jsonl"), "{\"type\":\"session\",\"version\":3}\n", "utf8");
      await writeFile(path.join(evaluationsRoot, evaluationId, "outside-session-root.jsonl"), "{}\n", "utf8");
    }
    await mkdir(path.join(evaluationsRoot, "not-an-evaluation"), { recursive: true });
    await writeFile(path.join(evaluationsRoot, "not-an-evaluation", "pi-stdout.jsonl"), "{}\n", "utf8");

    const service = createSessionDirectoryQueryService({
      maxListSessions: 10,
      sessionFileStat: async (_context, filePath) => stat(filePath),
      sourceFileStat: async (_context, filePath) => stat(filePath),
      sourceSessionRootIsReadable: async () => true,
      throwIfRequestAborted: () => {},
    });
    const records = await service.collectSessionFileRecords({
      source: { evaluationSessionsRoot: evaluationsRoot },
      codexHome: evaluationsRoot,
      sessionsRoot: evaluationsRoot,
    });

    assert.deepEqual(records.map((record) => record.id).sort(), evaluationIds.map((id) => `${id}:pi-stdout`).sort());
    assert.deepEqual(records.map((record) => path.basename(record.filePath)), ["pi-stdout.jsonl", "pi-stdout.jsonl"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});