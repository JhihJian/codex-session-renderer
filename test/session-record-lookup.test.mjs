import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stat } from "node:fs/promises";
import { createSessionCatalogQueryService } from "../src/session-catalog-query-service.mjs";
import { createSessionDirectoryQueryService } from "../src/session-directory-query-service.mjs";

const sessionFileContent = "{\"type\":\"session\",\"version\":3,\"cwd\":\"/tmp\",\"timestamp\":\"2026-09-22T00:00:00.000Z\"}\n";

function directoryDeps({ maxListSessions = 1 } = {}) {
  return {
    maxListSessions,
    sessionFileStat: async (_context, filePath) => stat(filePath).catch(() => null),
    sourceFileStat: async (_context, filePath) => stat(filePath).catch(() => null),
    sourceSessionRootIsReadable: async () => true,
    throwIfRequestAborted: () => {},
  };
}

async function evaluationFixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-record-lookup-"));
  const evaluationsRoot = path.join(dir, "evaluations");
  const taskIds = [
    "11111111-1111-1111-1111-111111111111",
    "22222222-2222-2222-2222-222222222222",
    "33333333-3333-3333-3333-333333333333",
  ];
  for (const taskId of taskIds) {
    const sessionsDir = path.join(evaluationsRoot, taskId, "output", "pi-sessions");
    await mkdir(sessionsDir, { recursive: true });
    const fileName = `2026-09-22T00-00-00-000Z_${taskId}.jsonl`;
    await writeFile(path.join(sessionsDir, fileName), sessionFileContent, "utf8");
  }
  return { dir, evaluationsRoot, taskIds };
}

test("sessionFileRecordById resolves evaluation sessions beyond the listing cap", async () => {
  const { dir, evaluationsRoot, taskIds } = await evaluationFixture();
  try {
    const deps = directoryDeps({ maxListSessions: 1 });
    const service = createSessionDirectoryQueryService(deps);
    const context = {
      source: { evaluationSessionsRoot: evaluationsRoot },
      codexHome: evaluationsRoot,
      sessionsRoot: evaluationsRoot,
    };

    const listed = await service.collectSessionFileRecords(context);
    assert.equal(listed.length, 1);

    const targetId = `${taskIds[2]}:${taskIds[2]}`;
    const record = await service.sessionFileRecordById(context, targetId);
    assert.ok(record);
    assert.equal(record.id, targetId);
    assert.equal(path.dirname(record.filePath), path.join(evaluationsRoot, taskIds[2], "output", "pi-sessions"));
    assert.equal(record.stat.isFile(), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("sessionFileRecordById resolves task-root sessions beyond the listing cap", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-task-lookup-"));
  try {
    const tasksRoot = path.join(dir, "tasks");
    const sessionId = "44444444-4444-4444-4444-444444444444";
    const sessionsDir = path.join(tasksRoot, "task-alpha", "artifacts", "pi-sessions");
    await mkdir(sessionsDir, { recursive: true });
    const fileName = `2026-09-22T01-00-00-000Z_${sessionId}.jsonl`;
    await writeFile(path.join(sessionsDir, fileName), sessionFileContent, "utf8");

    const deps = directoryDeps({ maxListSessions: 1 });
    const service = createSessionDirectoryQueryService(deps);
    const context = {
      source: { taskSessionsRoot: tasksRoot },
      codexHome: tasksRoot,
      sessionsRoot: tasksRoot,
    };

    const record = await service.sessionFileRecordById(context, `task-alpha:${sessionId}`);
    assert.ok(record);
    assert.equal(record.filePath, path.join(sessionsDir, fileName));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("sessionFileRecordById resolves plain sessions-root ids via uncapped walk", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-walk-lookup-"));
  try {
    const sessionsRoot = path.join(dir, "sessions");
    const firstId = "55555555-5555-5555-5555-555555555555";
    const secondId = "66666666-6666-6666-6666-666666666666";
    for (const [day, sessionId] of [["07", firstId], ["08", secondId]]) {
      const dayDir = path.join(sessionsRoot, "2026", "07", day);
      await mkdir(dayDir, { recursive: true });
      await writeFile(path.join(dayDir, `rollout-2026-07-${day}T00-00-00-${sessionId}.jsonl`), sessionFileContent, "utf8");
    }

    const deps = directoryDeps({ maxListSessions: 1 });
    const service = createSessionDirectoryQueryService(deps);
    const context = {
      source: {},
      codexHome: dir,
      sessionsRoot,
    };

    const listed = await service.collectSessionFileRecords(context);
    assert.equal(listed.length, 1);

    const record = await service.sessionFileRecordById(context, secondId);
    assert.ok(record);
    assert.equal(record.id, secondId);
    assert.ok(record.filePath.includes(secondId));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("sessionFileRecordById rejects traversal-shaped ids without matching", async () => {
  const { dir, evaluationsRoot, taskIds } = await evaluationFixture();
  try {
    const service = createSessionDirectoryQueryService(directoryDeps());
    const context = {
      source: { evaluationSessionsRoot: evaluationsRoot },
      codexHome: evaluationsRoot,
      sessionsRoot: evaluationsRoot,
    };

    const hostileIds = [
      `../evaluations/${taskIds[0]}:${taskIds[0]}`,
      `..:${taskIds[0]}`,
      `${taskIds[0]}:../../etc/passwd`,
      `${taskIds[0]}:`,
    ];
    for (const id of hostileIds) {
      assert.equal(await service.sessionFileRecordById(context, id), null, id);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("catalog findSessionFileRecord resolves sessions beyond the listing cap", async () => {
  const { dir, evaluationsRoot, taskIds } = await evaluationFixture();
  try {
    const directoryDepsInstance = directoryDeps({ maxListSessions: 1 });
    const directoryQueries = createSessionDirectoryQueryService(directoryDepsInstance);
    const catalogDeps = {
      directoryQueries,
      maxListSessions: 1,
      sessionFileStat: directoryDepsInstance.sessionFileStat,
      sourceModelOptions: () => ({ sourceId: "pi-agent", sourceLabel: "Pi Agent Sessions", dataSourceKind: "pi-agent" }),
      throwIfRequestAborted: () => {},
    };
    const catalog = createSessionCatalogQueryService(catalogDeps);
    const context = {
      source: { id: "pi-agent", kind: "pi-agent", evaluationSessionsRoot: evaluationsRoot },
      codexHome: evaluationsRoot,
      sessionsRoot: evaluationsRoot,
      sessionCacheByScope: new Map(),
      threadStore: {
        readThreadRowsByIds: async () => new Map(),
        readThreads: async () => new Map(),
        readAllThreads: async () => new Map(),
        readSpawnEdges: async () => [],
      },
    };

    const targetId = `${taskIds[2]}:${taskIds[2]}`;
    const session = await catalog.getSessionById(context, targetId);
    assert.ok(session);
    assert.equal(session.id, targetId);
    assert.ok(session.path.includes(taskIds[2]));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
