import { readJsonlLineWithDiagnostics, readJsonlRange } from "./jsonl-reader.mjs";
import { createPiGoalMessageProjector } from "./pi-goal-projection.mjs";
import { withFileStat } from "./session-models.mjs";
import { eventMatchesQuery, parseSessionEventQuery, projectEventForApi, projectSessionForApi } from "./session-query.mjs";

export function createSessionEventQueryService({ getSessionById, sessionFileExists, sessionFileStat, throwIfRequestAborted }) {
  function diagnosticEventScanLimitError() {
    const error = new Error("事件索引超过单条来源诊断读取上限。");
    error.status = 413;
    error.code = "session_event_scan_limited";
    return error;
  }

  function diagnosticPageState(range, { query, maxDiagnosticEventScan, diagnosticMaxFileBytes, byteLimited }) {
    const eventScanLimited = range.nextCursor >= maxDiagnosticEventScan && !range.exhausted;
    const byteScanLimited = byteLimited && range.exhausted;
    return {
      page: {
        cursor: query.cursor, limit: query.limit, maxScan: query.maxScan, scanned: range.scanned, returned: range.items.length,
        nextCursor: range.nextCursor, hasMore: !range.exhausted && !eventScanLimited, truncated: eventScanLimited || byteScanLimited,
        stopReason: eventScanLimited ? "raw_event_scan_limit" : byteScanLimited ? "raw_scan_byte_limit" : null,
      },
      readState: eventScanLimited || byteScanLimited ? {
        state: "limited",
        code: "diagnostic_budget_reached",
        reason: eventScanLimited ? "raw_event_scan_limit" : "raw_scan_byte_limit",
        limits: { diagnosticMaxFileBytes, maxDiagnosticEventScan },
      } : null,
    };
  }

  async function querySessionEvents(context, id, params, projectionOptions = {}, options = {}) {
    throwIfRequestAborted(options.signal);
    const session = await getSessionById(context, id, { signal: options.signal });
    if (!session?.path || !await sessionFileExists(context, session, options)) return null;
    const query = parseSessionEventQuery(params);
    const beforeStat = await sessionFileStat(context, session.path, session.id);
    if (!beforeStat) return null;
    const { maxDiagnosticEventScan, diagnosticMaxFileBytes } = context.sessionDetailCoordinator.limits;
    if (query.cursor >= maxDiagnosticEventScan) throw diagnosticEventScanLimitError();
    const byteLimited = beforeStat.size > diagnosticMaxFileBytes;
    const goalProjector = createPiGoalMessageProjector();
    let currentGoalProjection = null;
    const range = await context.sessionDetailCoordinator.readGate.run(() => readJsonlRange(session.path, {
      start: query.cursor,
      limit: query.limit,
      maxScan: Math.min(query.maxScan, maxDiagnosticEventScan - query.cursor),
      maxBytes: diagnosticMaxFileBytes,
      signal: options.signal,
      includeInvalid: !byteLimited,
      onRecord: (event, index) => { currentGoalProjection = goalProjector.project(event, index); },
      predicate: (event, index) => eventMatchesQuery(projectEventForApi(event, index, { fields: [] }), event, query, { goalProjection: currentGoalProjection }),
    }), options.signal);
    return {
      session: projectSessionForApi(withFileStat(session, beforeStat), {}, projectionOptions),
      events: range.items.map(({ event, index }) => projectEventForApi(event, index, query)),
      ...diagnosticPageState(range, { query, maxDiagnosticEventScan, diagnosticMaxFileBytes, byteLimited }),
      serverTime: new Date().toISOString(),
    };
  }

  async function getSessionEvent(context, id, index, options = {}) {
    throwIfRequestAborted(options.signal);
    const session = await getSessionById(context, id, { signal: options.signal });
    if (!session?.path || !await sessionFileExists(context, session, options)) return null;
    const beforeStat = await sessionFileStat(context, session.path, session.id);
    if (!beforeStat) return null;
    const { maxDiagnosticEventScan, diagnosticMaxFileBytes } = context.sessionDetailCoordinator.limits;
    if (index >= maxDiagnosticEventScan) throw diagnosticEventScanLimitError();
    const event = await context.sessionDetailCoordinator.readGate.run(
      () => readJsonlLineWithDiagnostics(session.path, index, { signal: options.signal, maxBytes: diagnosticMaxFileBytes, maxScan: maxDiagnosticEventScan }),
      options.signal,
    );
    if (!event && beforeStat.size > diagnosticMaxFileBytes) {
      const error = new Error("Session event exceeds the diagnostic scan limit");
      error.status = 413;
      error.code = "diagnostic_byte_budget_reached";
      throw error;
    }
    return event ? projectEventForApi(event, index, { includePayload: true, includeRaw: true }) : null;
  }

  return { getSessionEvent, querySessionEvents };
}