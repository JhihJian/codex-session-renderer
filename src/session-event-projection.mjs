// Compatibility facade for the historic projection module path.
export { compactTurnsForClient, compactTurnForView } from "./session-compact-reading-projection.mjs";
export {
  addTruncatedField,
  compactChildBase,
  compactChildPlaceholder,
  compactCompactSession,
  compactTraceInfo,
  contextUsageForAssistantMessage,
  contextUsageFromTokenInfo,
  durationMs,
  limitText,
  parseJsonObject,
  subagentNotificationAgentIds,
  subagentNotificationPayload,
  toMs,
} from "./session-projection-shared.mjs";
export { buildTurns, deriveSessionStatusFromEvents, deriveSessionStatusFromTurns } from "./session-turn-projection.mjs";
export { buildTrace } from "./session-execution-trace-projection.mjs";
export { findSpawnAgentEvents, findSubagentNotifications } from "./session-trace-node-projection.mjs";