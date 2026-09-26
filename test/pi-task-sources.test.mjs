import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDataSourceRegistry, parsePiAgentDefinition } from "../src/data-sources.mjs";
import { createSessionDirectoryQueryService } from "../src/session-directory-query-service.mjs";
import { containsWildcard, expandWildcardDirectories, wildcardSegmentRegExp, wildcardStaticPrefix } from "../src/root-pattern.mjs";

function directoryService({ maxListSessions = 20 } = {}) {
  return createSessionDirectoryQueryService({
    maxListSessions,
    sessionFileStat: async (_context, filePath) => stat(filePath).catch(() => null),
    sourceFileStat: async (_context, filePath) => stat(filePath).catch(() => null),
    sourceSessionRootIsReadable: async (_context, rootPath) => stat(rootPath).then((entry) => entry.isDirectory()).catch(() => false),
    throwIfRequestAborted: () => {},
  });
}

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
    assert.equal(source.codexHome, evaluationsRoot);
    assert.deepEqual(source.status, {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("wildcard helpers expose prefix, matching and expansion semantics", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-root-pattern-"));
  try {
    assert.equal(containsWildcard("/srv/tasks"), false);
    assert.equal(containsWildcard("/srv/tasks/*/pi-sessions"), true);
    assert.equal(wildcardStaticPrefix("/srv/tasks/*/pi-sessions"), "/srv/tasks/");
    assert.equal(wildcardStaticPrefix("/*"), "/");
    assert.equal(wildcardStaticPrefix("/srv/tasks"), "/srv/tasks");
    assert.equal(wildcardSegmentRegExp("sw*").test("sw-1"), true);
    assert.equal(wildcardSegmentRegExp("sw*").test("other"), false);

    const tasksRoot = path.join(dir, "tasks");
    for (const taskName of ["sw-alpha", "sw-beta", ".hidden", "not-sw"]) {
      const sessionsRoot = path.join(tasksRoot, taskName, "output", "run-1", "pi-sessions");
      await mkdir(sessionsRoot, { recursive: true });
    }
    await writeFile(path.join(tasksRoot, "not-sw", "output", "run-1", "pi-sessions", "session.jsonl"), "{}\n", "utf8");

    const matches = await expandWildcardDirectories(path.join(tasksRoot, "sw-*", "output", "*", "pi-sessions"));
    assert.deepEqual(matches.sort(), [
      path.join(tasksRoot, "sw-alpha", "output", "run-1", "pi-sessions"),
      path.join(tasksRoot, "sw-beta", "output", "run-1", "pi-sessions"),
    ]);
    assert.deepEqual(await expandWildcardDirectories(path.join(dir, "missing", "*", "pi-sessions")), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("wildcard session roots discover sessions from every matching directory", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-pi-wildcard-discovery-"));
  try {
    const tasksRoot = path.join(dir, "tasks");
    const sessions = [
      { task: "sw-alpha", run: "run-1", id: "11111111-1111-4111-8111-111111111111" },
      { task: "sw-alpha", run: "run-2", id: "22222222-2222-4222-8222-222222222222" },
      { task: "sw-beta", run: "run-1", id: "33333333-3333-4333-8333-333333333333" },
    ];
    for (const { task, run, id } of sessions) {
      const sessionsRoot = path.join(tasksRoot, task, "output", run, "pi-sessions");
      await mkdir(sessionsRoot, { recursive: true });
      await writeFile(path.join(sessionsRoot, `2026-09-22T00-00-00-000Z_${id}.jsonl`), "{\"type\":\"session\",\"version\":3}\n", "utf8");
    }
    await mkdir(path.join(tasksRoot, ".hidden", "output", "run-1", "pi-sessions"), { recursive: true });
    await writeFile(path.join(tasksRoot, ".hidden", "output", "run-1", "pi-sessions", "hidden.jsonl"), "{}\n", "utf8");

    const pattern = path.join(tasksRoot, "sw-*", "output", "*", "pi-sessions");
    const records = await directoryService().collectSessionFileRecords({ source: {}, codexHome: dir, sessionsRoot: pattern });
    assert.deepEqual(records.map((record) => record.id).sort(), sessions.map((session) => session.id).sort());

    const record = await directoryService().sessionFileRecordById({ source: {}, codexHome: dir, sessionsRoot: pattern }, "22222222-2222-4222-8222-222222222222");
    assert.equal(record?.filePath, path.join(tasksRoot, "sw-alpha", "output", "run-2", "pi-sessions", "2026-09-22T00-00-00-000Z_22222222-2222-4222-8222-222222222222.jsonl"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("legacy task-scoped ids resolve to plain session ids", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-pi-legacy-id-"));
  try {
    const tasksRoot = path.join(dir, "tasks");
    const sessionId = "44444444-4444-4444-4444-444444444444";
    const sessionsRoot = path.join(tasksRoot, "task-alpha", "artifacts", "pi-sessions");
    await mkdir(sessionsRoot, { recursive: true });
    await writeFile(path.join(sessionsRoot, `2026-09-22T00-00-00-000Z_${sessionId}.jsonl`), "{\"type\":\"session\",\"version\":3}\n", "utf8");

    const record = await directoryService().sessionFileRecordById({ source: {}, codexHome: dir, sessionsRoot: tasksRoot }, `task-alpha:${sessionId}`);
    assert.equal(record?.id, sessionId);
    assert.equal(record?.filePath, path.join(sessionsRoot, `2026-09-22T00-00-00-000Z_${sessionId}.jsonl`));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("evaluation-root sessions resolve via the unified recursive walk", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-pi-evaluation-discovery-"));
  try {
    const evaluationsRoot = path.join(dir, "evaluations");
    const evaluationIds = ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222", "a".repeat(64)];
    for (const evaluationId of evaluationIds) {
      const sessionsRoot = path.join(evaluationsRoot, evaluationId, "output", "pi-sessions");
      await mkdir(sessionsRoot, { recursive: true });
      await writeFile(path.join(sessionsRoot, `2026-09-22T00-00-00-000Z_${evaluationId.slice(0, 36)}.jsonl`), "{\"type\":\"session\",\"version\":3}\n", "utf8");
    }

    const records = await directoryService().collectSessionFileRecords({ source: {}, codexHome: evaluationsRoot, sessionsRoot: evaluationsRoot });
    assert.deepEqual(records.map((record) => path.dirname(record.filePath)).sort(), evaluationIds.map((id) => path.join(evaluationsRoot, id, "output", "pi-sessions")).sort());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
