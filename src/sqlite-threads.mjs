import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { toIso } from "./session-events.mjs";

const execFileAsync = promisify(execFile);

function defaultSqliteCandidates(env = process.env, homeDir = os.homedir()) {
  return [
    env.SQLITE3_PATH,
    "sqlite3",
    path.join(homeDir, "AppData", "Local", "Android", "Sdk", "platform-tools", "sqlite3.exe"),
  ].filter(Boolean);
}

function createSqliteThreadStore(options) {
  const { stateDbPath, maxListSessions = 800, sqliteCandidates = defaultSqliteCandidates(), runCommand = execFileAsync } = options;
  async function runSqliteJson(query, maxBuffer, signal) {
    const dbUrl = `file:${stateDbPath.replaceAll("\\", "/")}?mode=ro`;
    let lastError = null;
    for (const sqlite of sqliteCandidates) {
      try {
        const { stdout } = await runCommand(sqlite, ["-readonly", "-json", dbUrl, query], { maxBuffer, signal });
        return stdout;
      } catch (error) {
        if (error?.name === "AbortError" || error?.code === "ABORT_ERR") throw error;
        lastError = error;
      }
    }
    throw lastError || new Error("sqlite3 is not available");
  }
  async function readThreads({ sinceMs = null, beforeMs = null, limit = maxListSessions, cursor = null, sort = "updated", signal } = {}) {
    const conditions = ["id not in (select child_thread_id from thread_spawn_edges where child_thread_id is not null)"];
    if (Number.isFinite(sinceMs)) conditions.push(`updated_at_ms >= ${Math.trunc(sinceMs)}`);
    if (Number.isFinite(beforeMs)) conditions.push(`(updated_at_ms < ${Math.trunc(beforeMs)} or updated_at_ms is null)`);
    const order = sort === "path" ? "rollout_path desc, id asc" : "updated_at_ms desc, id asc";
    if (sort === "path" && cursor?.path) {
      conditions.push(`(rollout_path < ${sqlString(cursor.path)} or (rollout_path = ${sqlString(cursor.path)} and id > ${sqlString(cursor.id || "")}))`);
    } else {
      const cursorTime = Number(cursor?.updatedAtMs);
      if (Number.isFinite(cursorTime) && cursor?.id) {
        const timeColumn = "coalesce(updated_at_ms, created_at_ms, 0)";
        conditions.push(`(${timeColumn} < ${Math.trunc(cursorTime)} or (${timeColumn} = ${Math.trunc(cursorTime)} and id > ${sqlString(cursor.id)}))`);
      }
    }
    const query = [
      "select",
      "id,title,rollout_path,created_at,updated_at,created_at_ms,updated_at_ms,",
      "source,thread_source,model_provider,cwd,archived,archived_at,",
      "model,reasoning_effort,agent_nickname,agent_role,first_user_message,preview",
      "from threads",
      `where ${conditions.join(" and ")}`,
      `order by ${order} limit`,
      String(Math.min(maxListSessions, Math.max(1, Math.floor(Number(limit) || maxListSessions)))),
    ].join(" ");
    try {
      const stdout = await runSqliteJson(query, 30 * 1024 * 1024, signal);
      return threadRowsToMap(JSON.parse(stdout || "[]"));
    } catch (error) {
      if (error?.name === "AbortError" || error?.code === "ABORT_ERR") throw error;
      return new Map();
    }
  }
  async function readAllThreads() {
    const query = [
      "select",
      "id,title,rollout_path,created_at,updated_at,created_at_ms,updated_at_ms,",
      "source,thread_source,model_provider,cwd,archived,archived_at,",
      "model,reasoning_effort,agent_nickname,agent_role,first_user_message,preview",
      "from threads",
      "order by updated_at_ms desc limit",
      String(maxListSessions),
    ].join(" ");
    try {
      const stdout = await runSqliteJson(query, 30 * 1024 * 1024);
      return threadRowsToMap(JSON.parse(stdout || "[]"));
    } catch {
      return new Map();
    }
  }
  async function readThreadRowsByIds(ids) {
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    if (uniqueIds.length === 0) return new Map();
    const quotedIds = uniqueIds.map(sqlString).join(",");
    const query = [
      "select",
      "id,title,rollout_path,created_at,updated_at,created_at_ms,updated_at_ms,",
      "source,thread_source,model_provider,cwd,archived,archived_at,",
      "model,reasoning_effort,agent_nickname,agent_role,first_user_message,preview",
      "from threads where id in",
      `(${quotedIds})`,
    ].join(" ");
    try {
      const stdout = await runSqliteJson(query, 10 * 1024 * 1024);
      return threadRowsToMap(JSON.parse(stdout || "[]"));
    } catch {
      return new Map();
    }
  }
  async function readSpawnEdges() {
    const query = "select parent_thread_id,child_thread_id,status from thread_spawn_edges";
    try {
      const stdout = await runSqliteJson(query, 10 * 1024 * 1024);
      return JSON.parse(stdout || "[]")
        .filter((row) => row?.parent_thread_id && row?.child_thread_id)
        .map((row) => ({
          parentThreadId: row.parent_thread_id,
          childThreadId: row.child_thread_id,
          status: row.status || "unknown",
        }));
    } catch {
      return [];
    }
  }

  return {
    readAllThreads,
    readSpawnEdges,
    readThreadIndexPage: (options) => queryThreadIndexPage(runSqliteJson, options),
    readThreadRowsByIds,
    readThreads,
    runSqliteJson,
  };
}

async function queryThreadIndexPage(runSqliteJson, { conditions, limit, cursor, signal, maxBuffer }) {
  const where = conditions.length ? `where ${conditions.join(" and ")}` : "";
  const normalizedLimit = Math.min(500, Math.max(1, Math.floor(Number(limit) || 120)));
  const normalizedCursor = Math.max(0, Math.floor(Number(cursor) || 0));
  const countQuery = `select count(*) as total from threads ${where}`;
  const rowsQuery = [
    "select",
    "id,title,rollout_path,created_at,updated_at,created_at_ms,updated_at_ms,",
    "source,thread_source,model_provider,cwd,archived,archived_at,",
    "model,reasoning_effort,agent_nickname,agent_role,first_user_message,preview",
    "from threads",
    where,
    "order by coalesce(updated_at_ms, created_at_ms) desc, id asc limit",
    String(normalizedLimit),
    "offset",
    String(normalizedCursor),
  ].filter(Boolean).join(" ");
  const [countStdout, rowsStdout] = await Promise.all([
    runSqliteJson(countQuery, maxBuffer, signal),
    runSqliteJson(rowsQuery, maxBuffer, signal),
  ]);
  const total = Number(JSON.parse(countStdout || "[]")[0]?.total);
  return {
    total: Number.isSafeInteger(total) && total >= 0 ? total : 0,
    threads: threadRowsToMap(JSON.parse(rowsStdout || "[]")),
  };
}

function threadRowsToMap(rows) {
  return new Map(
    rows
      .filter((row) => row?.id && row?.rollout_path)
      .map((row) => [
        row.id,
        {
          id: row.id,
          title: row.title || row.first_user_message || row.preview || "未命名会话",
          path: stripLongPathPrefix(row.rollout_path),
          cwd: stripLongPathPrefix(row.cwd || ""),
          createdAt: unixMaybeToIso(row.created_at_ms ?? row.created_at),
          updatedAt: unixMaybeToIso(row.updated_at_ms ?? row.updated_at),
          source: row.source || null,
          threadSource: row.thread_source || null,
          modelProvider: row.model_provider || null,
          archived: row.archived === 1,
          archivedAt: unixMaybeToIso(row.archived_at),
          model: row.model || null,
          reasoningEffort: row.reasoning_effort || null,
          agentNickname: row.agent_nickname || null,
          agentRole: row.agent_role || null,
          preview: row.preview || row.first_user_message || null,
        },
      ]),
  );
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function stripLongPathPrefix(value) {
  if (!value) return value;
  return String(value).replace(/^\\\\\?\\/, "");
}

function unixMaybeToIso(value) {
  if (value == null || value === "") return null;
  if (typeof value === "string" && value.includes("T")) return toIso(value);
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const millis = number > 10_000_000_000 ? number : number * 1000;
  return toIso(millis);
}

export {
  createSqliteThreadStore,
  defaultSqliteCandidates,
  sqlString,
  stripLongPathPrefix,
  threadRowsToMap,
  unixMaybeToIso,
};
