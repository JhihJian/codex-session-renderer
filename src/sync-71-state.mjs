import { promises as fs } from "node:fs";
import path from "node:path";

const syncStateFile = ".codex-session-renderer-71-sync.json";

async function readLocalState(target, fsApi = fs) {
  try {
    return JSON.parse(await fsApi.readFile(path.join(target, syncStateFile), "utf8"));
  } catch {
    return { files: {} };
  }
}

async function hasExistingSnapshotContent(target, fsApi = fs) {
  for (const relativePath of [syncStateFile, "state_5.sqlite", "session_index.jsonl", "sessions"]) {
    try {
      await fsApi.access(path.join(target, relativePath));
      return true;
    } catch {
      // Continue checking the other snapshot roots.
    }
  }
  return false;
}

async function syncModeForTarget(options, fsApi = fs) {
  const localState = await readLocalState(options.target, fsApi);
  if (options.limit == null) return { localState, partial: false };
  if (options.refresh) {
    throw new Error("--limit 只用于隔离验证，不能与 --refresh 一起使用；请对独立测试目标完成全量同步后再刷新工作台。");
  }
  if (localState.complete === true) {
    throw new Error("目标已有完整同步状态，拒绝 --limit 以保护现有会话。请改用独立空目录，或不带 --limit 执行全量同步。");
  }
  if (localState.complete !== false && await hasExistingSnapshotContent(options.target, fsApi)) {
    throw new Error("目标已有未标记为部分验证的快照内容，拒绝 --limit 以保护现有会话。请改用独立空目录，或不带 --limit 执行全量同步。");
  }
  return { localState, partial: true };
}

function stateFromManifest(remoteFiles, options, previousState = {}) {
  const files = options.limit == null ? {} : { ...(previousState.files || {}) };
  for (const entry of remoteFiles) {
    const relativePath = String(entry.relativePath || "").split(/[\\/]+/).filter(Boolean).join("/");
    files[relativePath] = { size: entry.size, mtime: entry.mtime };
  }
  return {
    version: 1,
    complete: options.limit == null,
    remoteHome: options.remoteHome,
    syncedAt: new Date().toISOString(),
    files,
  };
}

export { readLocalState, stateFromManifest, syncModeForTarget, syncStateFile };