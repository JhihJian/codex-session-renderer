import {
  firstLine,
  isImportantEvent,
  normalizeText,
  summarizeEventPreview,
  summarizeEventTitle,
  toIso,
} from "./session-events.mjs";
import { parseSessionListType, sessionMatchesListType, spawnEdgesFromSessions, withSubagentMeta } from "./session-models.mjs";
import { normalizeSessionEvent } from "./session-normalizer.mjs";

const defaultSessionLimit = 100;
const maxSessionLimit = 500;
const defaultEventLimit = 100;
const maxEventLimit = 1000;
const defaultEventMaxScan = 5000;
const maxEventMaxScan = 50000;

function parseSessionListQuery(params) {
  const includeChildren = parseBoolean(params.get("includeChildren"), false);
  const rootOnly = params.has("rootOnly") ? parseBoolean(params.get("rootOnly"), true) : !includeChildren;
  return {
    q: stringParam(params, "q"),
    type: parseSessionListType(params.get("type")),
    ids: listParam(params, "id", "ids"),
    title: stringParam(params, "title"),
    cwd: stringParam(params, "cwd"),
    path: stringParam(params, "path"),
    model: stringParam(params, "model"),
    source: stringParam(params, "source"),
    threadSource: stringParam(params, "threadSource"),
    modelProvider: stringParam(params, "modelProvider"),
    agentNickname: stringParam(params, "agentNickname"),
    agentRole: stringParam(params, "agentRole"),
    archived: parseTriState(params.get("archived")),
    isChild: parseTriState(params.get("isChild")),
    hasChildren: parseTriState(params.get("hasChildren")),
    rootOnly,
    includeChildren: !rootOnly,
    changedAfter: dateParam(params, "changedAfter", "updatedAfter", "since", "after"),
    changedBefore: dateParam(params, "changedBefore", "updatedBefore", "before"),
    startedAfter: dateParam(params, "startedAfter"),
    startedBefore: dateParam(params, "startedBefore"),
    limit: intParam(params, "limit", defaultSessionLimit, 1, maxSessionLimit),
    cursor: stringParam(params, "cursor"),
    offset: intParam(params, "offset", 0, 0, Number.MAX_SAFE_INTEGER),
    sort: enumParam(params, "sort", ["changedAt", "updatedAt", "startedAt", "title", "id", "sizeBytes"], "changedAt"),
    order: enumParam(params, "order", ["asc", "desc"], "desc"),
    fields: listParam(params, "fields"),
    includePath: parseBoolean(params.get("includePath"), false),
  };
}

function parseSessionEventQuery(params) {
  const explicitCursor = intParam(params, "cursor", null, 0, Number.MAX_SAFE_INTEGER);
  const after = intParam(params, "after", null, 0, Number.MAX_SAFE_INTEGER);
  const cursor = explicitCursor ?? (after == null ? 0 : after + 1);
  return {
    cursor,
    limit: intParam(params, "limit", defaultEventLimit, 1, maxEventLimit),
    maxScan: intParam(params, "maxScan", defaultEventMaxScan, 1, maxEventMaxScan),
    q: stringParam(params, "q"),
    kinds: listParam(params, "kind", "kinds"),
    types: listParam(params, "type", "types"),
    payloadTypes: listParam(params, "payloadType", "payloadTypes"),
    roles: listParam(params, "role", "roles"),
    important: parseEventImportance(params),
    from: dateParam(params, "from", "startedAfter"),
    to: dateParam(params, "to", "startedBefore"),
    includePayload: parseBoolean(params.get("includePayload"), false),
    includeRaw: parseBoolean(params.get("includeRaw"), false),
    snapshot: stringParam(params, "snapshot"),
    fields: listParam(params, "fields"),
  };
}

function parseSessionViewQuery(params) {
  return {
    view: enumParam(params, "view", ["compact", "turns", "trace", "timing", "detail"], "compact"),
    maxDepth: intParam(params, "maxDepth", 3, 0, 8),
  };
}

function filterSessions(sessions, query, spawnEdges = []) {
  const edges = [...spawnEdges, ...spawnEdgesFromSessions(sessions)];
  const childIds = new Set(edges.map((edge) => edge?.childThreadId).filter(Boolean));
  const parentIds = new Set(edges.map((edge) => edge?.parentThreadId).filter(Boolean));
  return sessions.map(withSubagentMeta).filter((session) => sessionMatchesQuery(session, query, { childIds, parentIds }));
}

function sortSessions(sessions, query) {
  const orderFactor = query.order === "asc" ? 1 : -1;
  return [...sessions].sort((left, right) => {
    const compared = compareSessionValue(sessionSortValue(left, query.sort), sessionSortValue(right, query.sort));
    if (compared !== 0) return compared * orderFactor;
    return compareSessionValue(left.id || "", right.id || "") * orderFactor;
  });
}

function paginateSessions(sessions, query) {
  const cursorPayload = decodeCursor(query.cursor);
  const offset = Number.isInteger(cursorPayload?.offset) ? cursorPayload.offset : query.offset;
  const safeOffset = Math.max(0, Math.min(offset, sessions.length));
  const items = sessions.slice(safeOffset, safeOffset + query.limit);
  const nextOffset = safeOffset + items.length;
  return {
    items,
    offset: safeOffset,
    limit: query.limit,
    total: sessions.length,
    nextCursor: nextOffset < sessions.length ? encodeCursor({ offset: nextOffset }) : null,
  };
}

function projectSessionForApi(session, query = {}, options = {}) {
  const enriched = withSubagentMeta(session);
  const links = sessionLinks(enriched.id, options);
  const projected = {
    id: enriched.id,
    title: enriched.title || "未命名会话",
    preview: firstLine(enriched.preview || "", 180) || null,
    cwd: enriched.cwd || null,
    originator: enriched.originator || null,
    model: enriched.model || null,
    reasoningEffort: enriched.reasoningEffort || null,
    source: enriched.source || null,
    threadSource: enriched.threadSource || null,
    modelProvider: enriched.modelProvider || null,
    archived: enriched.archived ?? false,
    archivedAt: enriched.archivedAt || null,
    agentNickname: enriched.agentNickname || null,
    agentRole: enriched.agentRole || null,
    status: enriched.status || null,
    relativePath: enriched.relativePath || null,
    startedAt: enriched.startedAt || null,
    updatedAt: enriched.updatedAt || null,
    fileModifiedAt: enriched.fileModifiedAt || null,
    changedAt: sessionChangedAt(enriched),
    sizeBytes: enriched.sizeBytes ?? null,
    links,
  };
  if (query.includePath) projected.path = enriched.path || null;
  return pickFields(projected, query.fields);
}

function sessionLinks(sessionId, options = {}) {
  const encodedId = encodeURIComponent(sessionId);
  const sourceId = stringValue(options.sourceId);
  if (sourceId) {
    const sourcePrefix = `/api/sources/${encodeURIComponent(sourceId)}`;
    return {
      detail: `${sourcePrefix}/sessions/${encodedId}`,
      compactView: `${sourcePrefix}/query/sessions/${encodedId}/view?view=compact`,
      events: `${sourcePrefix}/query/sessions/${encodedId}/events`,
      markdown: `${sourcePrefix}/sessions/${encodedId}/markdown`,
    };
  }
  return {
    detail: `/api/sessions/${encodedId}`,
    compactView: `/api/query/sessions/${encodedId}/view?view=compact`,
    events: `/api/query/sessions/${encodedId}/events`,
    markdown: `/api/sessions/${encodedId}/markdown`,
  };
}

function projectEventForApi(event, index, query = {}) {
  const normalized = normalizeSessionEvent(event, event?.index ?? index);
  const payload = normalized.payload ?? null;
  const payloadSize = normalized.payloadSize;
  const projected = {
    index,
    timestamp: normalized.timestamp,
    kind: normalized.kind,
    semanticKind: normalized.semanticKind,
    important: isImportantEvent(normalized),
    type: normalized.rawType || null,
    payloadType: normalized.payloadType ?? null,
    role: normalized.role ?? null,
    messageId: normalized.messageId ?? null,
    parentId: normalized.parentId ?? null,
    title: summarizeEventTitle(normalized),
    preview: summarizeEventPreview(normalized),
    payloadSize,
    rawSize: normalized.rawSize,
  };
  if (normalized.attachments?.length) projected.attachments = normalized.attachments;
  if (normalized.reasoning) projected.reasoning = normalized.reasoning;
  if (normalized.compact) projected.compact = normalized.compact;
  if (normalized.diagnostic) projected.diagnostic = normalized.diagnostic;
  if (query.includePayload) projected.payload = payload;
  if (query.includeRaw) projected.raw = event;
  return pickFields(projected, query.fields);
}

function eventMatchesQuery(projected, rawEvent, query, options = {}) {
  if (query.important != null && projected.important !== query.important) return false;
  if (query.kinds.length > 0 && !query.kinds.includes(projected.kind)) return false;
  if (query.types.length > 0 && !query.types.includes(projected.type || "")) return false;
  if (query.payloadTypes.length > 0 && !query.payloadTypes.includes(projected.payloadType || "")) return false;
  if (query.roles.length > 0 && !query.roles.includes(projected.role || "")) return false;
  if (query.from && !dateAtOrAfter(projected.timestamp, query.from)) return false;
  if (query.to && !dateAtOrBefore(projected.timestamp, query.to)) return false;
  if (query.q && !containsText(eventSearchText(projected, rawEvent, options), query.q)) return false;
  return true;
}

function sessionChangedAt(session) {
  return session.updatedAt || session.fileModifiedAt || session.startedAt || null;
}

function sessionWatermark(sessions) {
  const max = sessions.reduce((current, session) => {
    const ms = dateMs(sessionChangedAt(session));
    return ms == null ? current : Math.max(current, ms);
  }, 0);
  return max > 0 ? toIso(max) : null;
}

function sessionMatchesQuery(session, query, edgeState) {
  if (query.rootOnly && edgeState.childIds.has(session.id)) return false;
  if (query.ids.length > 0 && !query.ids.includes(session.id)) return false;
  if (query.archived != null && Boolean(session.archived) !== query.archived) return false;
  if (query.isChild != null && edgeState.childIds.has(session.id) !== query.isChild) return false;
  if (query.hasChildren != null && edgeState.parentIds.has(session.id) !== query.hasChildren) return false;
  if (!sessionMatchesListType(session, query.type)) return false;
  if (query.changedAfter && !dateAfter(sessionChangedAt(session), query.changedAfter)) return false;
  if (query.changedBefore && !dateBefore(sessionChangedAt(session), query.changedBefore)) return false;
  if (query.startedAfter && !dateAfter(session.startedAt, query.startedAfter)) return false;
  if (query.startedBefore && !dateBefore(session.startedAt, query.startedBefore)) return false;

  const containsFilters = [
    ["title", query.title],
    ["cwd", query.cwd],
    ["relativePath", query.path],
    ["path", query.path],
    ["model", query.model],
    ["source", query.source],
    ["threadSource", query.threadSource],
    ["modelProvider", query.modelProvider],
    ["agentNickname", query.agentNickname],
    ["agentRole", query.agentRole],
  ];
  for (const [field, expected] of containsFilters) {
    if (expected && !containsText(session[field], expected)) return false;
  }

  if (query.q && !containsText(sessionSearchText(session), query.q)) return false;
  return true;
}

function sessionSearchText(session) {
  return [
    session.id,
    session.title,
    session.preview,
    session.cwd,
    session.relativePath,
    session.model,
    session.reasoningEffort,
    session.source,
    session.threadSource,
    session.modelProvider,
    session.agentNickname,
    session.agentRole,
    session.status,
  ]
    .filter(Boolean)
    .join("\n");
}

function eventSearchText(projected, rawEvent, options = {}) {
  const normalized = normalizeSessionEvent(rawEvent, rawEvent?.index ?? projected.index);
  if (normalized.role === "user" && options.goalProjection) {
    if (options.goalProjection.kind === "suppress") return "";
    if (options.goalProjection.kind === "objective") {
      return [projected.kind, projected.type, projected.payloadType, normalized.role, options.goalProjection.text].filter(Boolean).join("\n");
    }
  }
  return [projected.title, projected.preview, projected.kind, projected.type, projected.payloadType, normalized.searchText]
    .filter(Boolean)
    .join("\n");
}

function sessionSortValue(session, sort) {
  if (sort === "title") return normalizeText(session.title || "");
  if (sort === "id") return session.id || "";
  if (sort === "sizeBytes") return Number(session.sizeBytes) || 0;
  if (sort === "startedAt") return dateMs(session.startedAt) ?? 0;
  if (sort === "updatedAt") return dateMs(session.updatedAt) ?? 0;
  return dateMs(sessionChangedAt(session)) ?? 0;
}

function compareSessionValue(left, right) {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right), "zh-Hans-CN");
}

function pickFields(value, fields) {
  if (!fields?.length) return value;
  const picked = {};
  if ("id" in value) picked.id = value.id;
  if ("index" in value) picked.index = value.index;
  for (const field of fields) {
    if (field in value) picked[field] = value[field];
  }
  return picked;
}

function containsText(value, expected) {
  return normalizeText(value).toLowerCase().includes(normalizeText(expected).toLowerCase());
}

function dateParam(params, ...names) {
  for (const name of names) {
    const value = stringParam(params, name);
    if (!value) continue;
    const iso = toIso(value);
    if (iso) return iso;
  }
  return null;
}

function stringParam(params, name) {
  const value = params.get(name);
  return value == null || value === "" ? null : value;
}

function stringValue(value) {
  const text = String(value || "").trim();
  return text || null;
}

function listParam(params, ...names) {
  return names
    .flatMap((name) => params.getAll(name))
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

function intParam(params, name, fallback, min, max) {
  const raw = params.get(name);
  if (raw == null || raw === "") return fallback;
  const number = Number(raw);
  if (!Number.isInteger(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function enumParam(params, name, allowed, fallback) {
  const value = params.get(name);
  return allowed.includes(value) ? value : fallback;
}

function parseBoolean(value, fallback) {
  if (value == null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(normalized)) return true;
  if (["0", "false", "no", "n"].includes(normalized)) return false;
  return fallback;
}

function parseTriState(value) {
  if (value == null || value === "" || String(value).toLowerCase() === "any" || String(value).toLowerCase() === "all") {
    return null;
  }
  return parseBoolean(value, null);
}

function parseEventImportance(params) {
  if (params.has("important")) return parseTriState(params.get("important"));
  if (params.has("onlyImportant")) return parseBoolean(params.get("onlyImportant"), false);
  return null;
}

function dateMs(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function dateAfter(value, boundary) {
  const valueMs = dateMs(value);
  const boundaryMs = dateMs(boundary);
  return valueMs != null && boundaryMs != null && valueMs > boundaryMs;
}

function dateBefore(value, boundary) {
  const valueMs = dateMs(value);
  const boundaryMs = dateMs(boundary);
  return valueMs != null && boundaryMs != null && valueMs < boundaryMs;
}

function dateAtOrAfter(value, boundary) {
  const valueMs = dateMs(value);
  const boundaryMs = dateMs(boundary);
  return valueMs != null && boundaryMs != null && valueMs >= boundaryMs;
}

function dateAtOrBefore(value, boundary) {
  const valueMs = dateMs(value);
  const boundaryMs = dateMs(boundary);
  return valueMs != null && boundaryMs != null && valueMs <= boundaryMs;
}

function encodeCursor(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export {
  decodeCursor,
  encodeCursor,
  eventMatchesQuery,
  filterSessions,
  paginateSessions,
  parseSessionEventQuery,
  parseSessionListQuery,
  parseSessionViewQuery,
  projectEventForApi,
  projectSessionForApi,
  sessionChangedAt,
  sessionWatermark,
  sortSessions,
};
