import { readCommittedJsonlChunk } from "./jsonl-tail-reader.mjs";
import { deriveSessionStatusFromEvents } from "./session-turn-projection.mjs";

const defaultStaleRunningMs = 30 * 60 * 1000;
const tailStatusWindowBytes = 96 * 1024;

let cachedStaleThresholdMs = null;

/**
 * Sessions only stay "running" while their JSONL file keeps growing. When a
 * turn never reaches a terminal event (no task_complete / task_failed /
 * turn_aborted) and the file has not been written to for a long time, the
 * agent process is gone and the status is downgraded to "stopped".
 */
function staleRunningThresholdMs() {
  if (cachedStaleThresholdMs == null) {
    const configured = Number(process.env.CODEX_SESSION_STALE_RUNNING_MS);
    cachedStaleThresholdMs = Number.isFinite(configured) && configured > 0 ? configured : defaultStaleRunningMs;
  }
  return cachedStaleThresholdMs;
}

function isStaleRunning(modifiedAtMs, nowMs = Date.now(), thresholdMs = staleRunningThresholdMs()) {
  return Number.isFinite(modifiedAtMs) && Number.isFinite(nowMs) && nowMs - modifiedAtMs >= thresholdMs;
}

function applyStaleRunningStatus(status, modifiedAtMs, nowMs = Date.now(), thresholdMs = staleRunningThresholdMs()) {
  if (status !== "running") return status;
  return isStaleRunning(modifiedAtMs, nowMs, thresholdMs) ? "stopped" : status;
}

/**
 * Only the final turn decides session-level status, so historical turns keep
 * their original (possibly unterminated) status untouched.
 */
function applyStaleStatusToTurns(turns, modifiedAtMs, nowMs = Date.now(), thresholdMs = staleRunningThresholdMs()) {
  const last = turns?.[turns.length - 1];
  if (!last || last.status !== "running") return turns;
  const status = applyStaleRunningStatus(last.status, modifiedAtMs, nowMs, thresholdMs);
  if (status === last.status) return turns;
  return [...turns.slice(0, -1), { ...last, status }];
}

/**
 * Derives status from the tail of the JSONL file instead of its head: the
 * status of a session is decided by how its last turn ends, not by how it
 * began. The window may cut into a record at the start, so the partial first
 * line is dropped.
 */
async function readTailSessionStatus(filePath, { size, mtimeMs } = {}, options = {}) {
  if (!filePath || !Number.isFinite(size)) return null;
  const chunk = await readCommittedJsonlChunk(filePath, {
    startOffset: Math.max(0, size - tailStatusWindowBytes),
    endOffset: size,
    skipPartialStart: true,
  });
  const events = chunk.events.filter((event) => !event?.__jsonlDiagnostic);
  if (events.length === 0) return null;
  return applyStaleRunningStatus(deriveSessionStatusFromEvents(events), mtimeMs, options.nowMs);
}

export {
  applyStaleRunningStatus,
  applyStaleStatusToTurns,
  isStaleRunning,
  readTailSessionStatus,
  staleRunningThresholdMs,
};
