// Compatibility facade for callers that still import the historic module.
export {
  classifyEvent,
  extractProjectedGoalObjective,
  extractTitleFromEvents,
  isImportantEvent,
  summarizeEventPreview,
  summarizeEventTitle,
  summarizeSessionEvents,
} from "./event-summary.mjs";
export {
  eventTime,
  extractContentText,
  fileTimeMs,
  firstLine,
  normalizeSlash,
  normalizeText,
  sessionIdFromFile,
  sessionStartedFromFile,
  toIso,
} from "./text-utils.mjs";
export { normalizeSessionEvent } from "./session-normalizer.mjs";
export {
  buildTrace,
  buildTurns,
  compactChildBase,
  compactChildPlaceholder,
  compactCompactSession,
  compactTurnsForClient,
  compactTurnForView,
  deriveSessionStatusFromEvents,
  deriveSessionStatusFromTurns,
  findSpawnAgentEvents,
  findSubagentNotifications,
  limitText,
  parseJsonObject,
  toMs,
} from "./session-event-projection.mjs";