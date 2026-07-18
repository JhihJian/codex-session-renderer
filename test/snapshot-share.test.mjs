import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  createSnapshotArchive,
  createSessionIndex,
  createSnapshotShareHandler,
  isAuthorizedSnapshotRequest,
  safeEqual,
  snapshotShareConfig,
} from "../src/snapshot-share.mjs";

const execFileAsync = promisify(execFile);

test("snapshotShareConfig uses explicit share port and token", () => {
  const config = snapshotShareConfig({
    env: {
      CODEX_HOME: "/tmp/codex-home",
      CODEX_SHARE_PORT: "4801",
      CODEX_SHARE_TOKEN: "token",
    },
    homeDir: "/home/user",
  });

  assert.equal(config.port, 4801);
  assert.equal(config.token, "token");
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.codexHome, path.resolve("/tmp/codex-home"));
});

test("isAuthorizedSnapshotRequest requires bearer token", () => {
  assert.equal(isAuthorizedSnapshotRequest({ headers: {} }, "secret"), false);
  assert.equal(isAuthorizedSnapshotRequest({ headers: { authorization: "Bearer wrong" } }, "secret"), false);
  assert.equal(isAuthorizedSnapshotRequest({ headers: { authorization: "Bearer secret" } }, "secret"), true);
  assert.equal(isAuthorizedSnapshotRequest({ headers: { authorization: "Bearer secret" } }, ""), false);
  assert.equal(safeEqual("same", "same"), true);
  assert.equal(safeEqual("same", "diff"), false);
});

test("share health endpoint is protected by bearer token", async () => {
  const handler = createSnapshotShareHandler({
    config: {
      codexHome: "C:\\Users\\user\\.codex",
      host: "0.0.0.0",
      port: 4791,
      token: "secret",
    },
    now: () => new Date("2026-06-30T00:00:00.000Z"),
  });

  const unauthorized = await callHandler(handler, {
    method: "GET",
    url: "/api/share-health",
    headers: { host: "localhost" },
  });
  assert.equal(unauthorized.status, 401);
  assert.doesNotMatch(unauthorized.body, /Users/);

  const authorized = await callHandler(handler, {
    method: "GET",
    url: "/api/share-health",
    headers: { host: "localhost", authorization: "Bearer secret" },
  });
  assert.equal(authorized.status, 200);
  assert.match(authorized.body, /codexHome/);
});

test("createSnapshotArchive includes allowed Codex files and metadata", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-share-test-"));
  try {
    const codexHome = path.join(dir, ".codex");
    const sessionsDir = path.join(codexHome, "sessions", "2026", "06", "30");
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(path.join(codexHome, "state_5.sqlite"), "sqlite", "utf8");
    await writeFile(path.join(codexHome, "session_index.jsonl"), '{"id":"one"}\n', "utf8");
    await writeFile(path.join(codexHome, "ignored.log"), "ignore me", "utf8");
    await writeFile(path.join(sessionsDir, "rollout-2026-06-30T01-02-03-one.jsonl"), "{}\n", "utf8");

    const archivePath = await createSnapshotArchive({
      codexHome,
      tempRoot: dir,
      now: () => new Date("2026-06-30T00:00:00.000Z"),
    });
    const extractDir = path.join(dir, "extract");
    await mkdir(extractDir);
    await runTar(["-xf", archivePath, "-C", extractDir]);

    assert.equal(await readFile(path.join(extractDir, "session_index.jsonl"), "utf8"), '{"id":"one"}\n');
    assert.equal(await readFile(path.join(extractDir, "sessions", "2026", "06", "30", "rollout-2026-06-30T01-02-03-one.jsonl"), "utf8"), "{}\n");
    const metadata = JSON.parse(await readFile(path.join(extractDir, ".codex-session-renderer-snapshot.json"), "utf8"));
    assert.equal(metadata.codexHome, codexHome);
    await assert.rejects(readFile(path.join(extractDir, "ignored.log"), "utf8"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createSnapshotArchive defaults to realtime session files", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-share-realtime-"));
  try {
    const codexHome = path.join(dir, ".codex");
    const sessionsDir = path.join(codexHome, "sessions", "2026", "06", "30");
    await mkdir(sessionsDir, { recursive: true });
    const oldFile = path.join(sessionsDir, "rollout-2026-06-30T01-00-00-old.jsonl");
    const newFile = path.join(sessionsDir, "rollout-2026-06-30T03-30-00-new.jsonl");
    await writeFile(path.join(codexHome, "session_index.jsonl"), '{"id":"rollout-2026-06-30T03-30-00-new"}\n', "utf8");
    await writeFile(oldFile, "{}\n", "utf8");
    await writeFile(newFile, "{}\n", "utf8");
    await touch(oldFile, new Date("2026-06-29T23:00:00.000Z"));
    await touch(newFile, new Date("2026-06-30T03:30:00.000Z"));

    const archivePath = await createSnapshotArchive({
      codexHome,
      tempRoot: dir,
      now: () => new Date("2026-06-30T04:00:00.000Z"),
      realtimeHours: 3,
    });
    const extractDir = path.join(dir, "extract-realtime");
    await mkdir(extractDir);
    await runTar(["-xf", archivePath, "-C", extractDir]);

    await assert.rejects(readFile(path.join(extractDir, "sessions", "2026", "06", "30", path.basename(oldFile)), "utf8"));
    assert.equal(await readFile(path.join(extractDir, "sessions", "2026", "06", "30", path.basename(newFile)), "utf8"), "{}\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createSessionIndex returns older sessions without session bodies", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-share-index-"));
  try {
    const codexHome = path.join(dir, ".codex");
    const sessionsDir = path.join(codexHome, "sessions", "2026", "06", "29");
    await mkdir(sessionsDir, { recursive: true });
    const filePath = path.join(sessionsDir, "rollout-2026-06-29T01-00-00-old.jsonl");
    await writeFile(
      path.join(codexHome, "session_index.jsonl"),
      '{"id":"rollout-2026-06-29T01-00-00-old","thread_name":"历史会话","updated_at":"2026-06-29T01:00:00.000Z"}\n',
      "utf8",
    );
    await writeFile(filePath, "{}\n", "utf8");
    await touch(filePath, new Date("2026-06-29T01:00:00.000Z"));

    const index = await createSessionIndex({
      codexHome,
      query: new URLSearchParams({ bucket: "earlier", q: "历史" }),
      now: () => new Date("2026-06-30T04:00:00.000Z"),
    });

    assert.equal(index.sessions.length, 1);
    assert.equal(index.sessions[0].title, "历史会话");
    assert.equal(index.sessions[0].remoteIndexOnly, true);
    assert.equal(index.sessions[0].availableInSnapshot, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createSessionIndex keeps total and cursors stable across bounded pages", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-share-index-pages-"));
  try {
    const codexHome = path.join(dir, ".codex");
    const sessionsDir = path.join(codexHome, "sessions", "2026", "06", "27");
    await mkdir(sessionsDir, { recursive: true });
    for (const id of ["first", "second", "third"]) {
      const filePath = path.join(sessionsDir, `rollout-2026-06-27T01-00-00-${id}.jsonl`);
      await writeFile(filePath, "{}\n", "utf8");
      await touch(filePath, new Date("2026-06-27T01:00:00.000Z"));
    }
    const now = () => new Date("2026-06-30T04:00:00.000Z");
    const first = await createSessionIndex({
      codexHome,
      query: new URLSearchParams({ bucket: "earlier", limit: "2", cursor: "0" }),
      now,
    });
    const last = await createSessionIndex({
      codexHome,
      query: new URLSearchParams({ bucket: "earlier", limit: "2", cursor: first.page.nextCursor, snapshot: first.page.snapshot }),
      now,
    });

    assert.deepEqual({ ...first.page, snapshot: undefined }, { total: 3, limit: 2, cursor: 0, nextCursor: "2", snapshot: undefined });
    assert.match(first.page.snapshot, /^[A-Za-z0-9_-]{20,}$/);
    assert.equal(first.sessions.length, 2);
    assert.deepEqual({ ...last.page, snapshot: undefined }, { total: 3, limit: 2, cursor: 2, nextCursor: null, snapshot: undefined });
    assert.equal(last.page.snapshot, first.page.snapshot);
    assert.equal(last.sessions.length, 1);
    assert.equal(last.sessions[0].remoteIndexOnly, true);
    assert.equal(last.sessions[0].availableInSnapshot, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("SQLite 历史索引跨 1201 条记录分页完整，筛选 total 在数据库侧计算", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-share-sqlite-pages-"));
  try {
    const codexHome = path.join(dir, ".codex");
    await mkdir(codexHome, { recursive: true });
    await createIndexSqlite(path.join(codexHome, "state_5.sqlite"), 1201);
    const now = () => new Date("2026-06-30T04:00:00.000Z");
    const ids = [];
    let cursor = "0";
    let snapshot = "";
    let total = 0;
    do {
      const index = await createSessionIndex({
        codexHome,
        query: new URLSearchParams({ bucket: "earlier", limit: "200", cursor, ...(snapshot ? { snapshot } : {}) }),
        now,
      });
      total = index.page.total;
      snapshot ||= index.page.snapshot;
      assert.equal(index.page.snapshot, snapshot);
      ids.push(...index.sessions.map((session) => session.id));
      cursor = index.page.nextCursor;
    } while (cursor);
    assert.equal(total, 1201);
    assert.equal(ids.length, 1201);
    assert.equal(new Set(ids).size, 1201);

    const filtered = await createSessionIndex({
      codexHome,
      query: new URLSearchParams({ bucket: "earlier", q: "needle", limit: "20" }),
      now,
    });
    assert.equal(filtered.page.total, 13);
    assert.equal(filtered.sessions.length, 13);
    assert.ok(filtered.sessions.every((session) => session.title.includes("needle")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("索引变动拒绝续页令牌，文件回退遵守条目预算和取消", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-share-index-limits-"));
  try {
    const codexHome = path.join(dir, ".codex");
    const dbPath = path.join(codexHome, "state_5.sqlite");
    await mkdir(path.join(codexHome, "sessions", "2026", "06", "20"), { recursive: true });
    await createIndexSqlite(dbPath, 3);
    const now = () => new Date("2026-06-30T04:00:00.000Z");
    const first = await createSessionIndex({ codexHome, query: new URLSearchParams({ bucket: "earlier", limit: "1" }), now });
    assert.doesNotMatch(first.page.snapshot, /private|codex|token/i);
    await execFileAsync("sqlite3", [dbPath, "update threads set title = 'changed' where id = 'thread-0001'"]);
    await assert.rejects(
      createSessionIndex({ codexHome, query: new URLSearchParams({ bucket: "earlier", limit: "1", cursor: first.page.nextCursor, snapshot: first.page.snapshot }), now }),
      { code: "index_snapshot_changed", status: 409 },
    );

    await rm(dbPath);
    const sessionsDir = path.join(codexHome, "sessions", "2026", "06", "20");
    await writeFile(path.join(sessionsDir, "rollout-2026-06-20T01-00-00-one.jsonl"), "0123456789\n", "utf8");
    await writeFile(path.join(sessionsDir, "rollout-2026-06-20T01-00-00-two.jsonl"), "0123456789\n", "utf8");
    await assert.rejects(
      createSessionIndex({ codexHome, query: new URLSearchParams({ bucket: "earlier" }), now, limits: { fallbackMaxEntries: 1, fallbackMaxBytes: 1024 } }),
      { code: "index_fallback_too_many_entries", status: 413 },
    );
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      createSessionIndex({ codexHome, query: new URLSearchParams({ bucket: "earlier" }), now, signal: controller.signal }),
      { name: "AbortError" },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("共享端索引路径要求 Bearer token，响应不回传目录或 token", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-share-index-auth-"));
  try {
    const codexHome = path.join(dir, ".codex");
    const handler = createSnapshotShareHandler({ config: { codexHome, token: "index-secret" } });
    const unauthorized = await callHandler(handler, { method: "GET", url: "/api/codex-session-index", headers: { host: "localhost" } });
    assert.equal(unauthorized.status, 401);
    const authorized = await callHandler(handler, {
      method: "GET",
      url: "/api/codex-session-index?bucket=earlier",
      headers: { host: "localhost", authorization: "Bearer index-secret" },
    });
    assert.equal(authorized.status, 200);
    assert.doesNotMatch(authorized.body, new RegExp(codexHome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(authorized.body, /index-secret/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function createIndexSqlite(dbPath, count) {
  const schema = [
    "create table threads (id text, title text, rollout_path text, created_at text, updated_at text, created_at_ms integer, updated_at_ms integer, source text, thread_source text, model_provider text, cwd text, archived integer, archived_at text, model text, reasoning_effort text, agent_nickname text, agent_role text, first_user_message text, preview text)",
    "create table thread_spawn_edges (parent_thread_id text, child_thread_id text, status text)",
  ];
  const rows = Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    const title = number % 100 === 0 || number === 1201 ? `needle ${number}` : `history ${number}`;
    const timestamp = Date.parse("2026-06-20T00:00:00.000Z") - number;
    return `insert into threads values ('thread-${String(number).padStart(4, "0")}', '${title}', '/private/sessions/${number}.jsonl', null, null, ${timestamp}, ${timestamp}, null, null, null, '/private/project', 0, null, null, null, null, null, null, null)`;
  });
  await execFileAsync("sqlite3", [dbPath, schema.join("; ")]);
  for (let offset = 0; offset < rows.length; offset += 100) {
    await execFileAsync("sqlite3", [dbPath, `begin; ${rows.slice(offset, offset + 100).join("; ")}; commit;`]);
  }
}

function callHandler(handler, req) {
  return new Promise((resolve, reject) => {
    const request = { once() {}, removeListener() {}, ...req };
    const response = {
      headersSent: false,
      writableEnded: false,
      destroyed: false,
      once() {},
      removeListener() {},
      status: 0,
      headers: {},
      body: "",
      writeHead(status, headers) {
        this.status = status;
        this.headers = headers;
        this.headersSent = true;
      },
      end(body = "") {
        this.body += body;
        this.writableEnded = true;
        resolve({
          status: this.status,
          headers: this.headers,
          body: this.body,
        });
      },
      destroy(error) {
        reject(error);
      },
    };
    Promise.resolve(handler(request, response)).catch(reject);
  });
}

async function touch(filePath, date) {
  const { utimes } = await import("node:fs/promises");
  await utimes(filePath, date, date);
}

function runTar(args) {
  return new Promise((resolve, reject) => {
    const tar = spawn("tar", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    tar.stderr.setEncoding("utf8");
    tar.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    tar.on("error", reject);
    tar.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `tar exited with ${code}`));
    });
  });
}
