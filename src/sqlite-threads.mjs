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
  const {
    stateDbPath,
    maxListSessions = 800,
    sqliteCandidates = defaultSqliteCandidates(),
    runCommand = execFileAsync,
  } = options;

  async function runSqliteJson(query, maxBuffer) {
    const dbUrl = `file:${stateDbPath.replaceAll("\\", "/")}?mode=ro`;
    let lastError = null;
    for (const sqlite of sqliteCandidates) {
      try {
        const { stdout } = await runCommand(sqlite, ["-readonly", "-json", dbUrl, query], { maxBuffer });
        return stdout;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("sqlite3 is not available");
  }

  async function readThreads() {
    const query = [
      "select",
      "id,title,rollout_path,created_at,updated_at,created_at_ms,updated_at_ms,",
      "source,thread_source,model_provider,cwd,archived,archived_at,",
      "model,reasoning_effort,agent_nickname,agent_role,first_user_message,preview",
      "from threads",
      "where id not in (select child_thread_id from thread_spawn_edges where child_thread_id is not null)",
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
    readSpawnEdges,
    readThreadRowsByIds,
    readThreads,
    runSqliteJson,
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
