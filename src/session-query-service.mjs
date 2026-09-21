import { createSessionCatalogQueryService } from "./session-catalog-query-service.mjs";
import { createSessionDetailQueryService } from "./session-detail-query-service.mjs";
import { createSessionDirectoryQueryService } from "./session-directory-query-service.mjs";
import { createSessionEventQueryService } from "./session-event-query-service.mjs";
import { createLiveSessionStreamService } from "./live-session-stream.mjs";
import { createSessionSourceContextService, throwIfRequestAborted } from "./session-source-context-service.mjs";

export function createSessionQueryService() {
  const maxListSessions = Number(process.env.CODEX_SESSION_RENDERER_LIMIT || 800);
  const sourceContexts = createSessionSourceContextService({ maxListSessions });
  const directoryQueries = createSessionDirectoryQueryService({
    maxListSessions,
    sessionFileStat: sourceContexts.sessionFileStat,
    sourceFileStat: sourceContexts.sourceFileStat,
    sourceModelOptions: sourceContexts.sourceModelOptions,
    sourceSessionRootIsReadable: sourceContexts.sourceSessionRootIsReadable,
    throwIfRequestAborted,
  });
  const catalogQueries = createSessionCatalogQueryService({
    directoryQueries,
    maxListSessions,
    sessionFileExists: sourceContexts.sessionFileExists,
    sessionFileStat: sourceContexts.sessionFileStat,
    sourceModelOptions: sourceContexts.sourceModelOptions,
    throwIfRequestAborted,
  });
  const detailQueries = createSessionDetailQueryService({
    getSessionById: catalogQueries.getSessionById,
    getSessionLineage: catalogQueries.getSessionLineage,
    getThreadHierarchy: catalogQueries.getThreadHierarchy,
    sessionFileExists: sourceContexts.sessionFileExists,
    sessionFileStat: sourceContexts.sessionFileStat,
    modelContextWindow: sourceContexts.modelContextWindow,
    throwIfRequestAborted,
  });
  const eventQueries = createSessionEventQueryService({
    getSessionById: catalogQueries.getSessionById,
    sessionFileExists: sourceContexts.sessionFileExists,
    sessionFileStat: sourceContexts.sessionFileStat,
    throwIfRequestAborted,
  });
  const liveStreams = createLiveSessionStreamService({
    getSessionById: catalogQueries.getSessionById,
    sessionFileExists: sourceContexts.sessionFileExists,
    sessionFileStat: sourceContexts.sessionFileStat,
  });

  async function temporarySession(filePath, options = {}) {
    const resolvedPath = await sourceContexts.resolveTemporarySessionFile(filePath);
    const context = sourceContexts.getTemporarySessionContext(resolvedPath);
    const session = await directoryQueries.sessionFromFilePath(context, resolvedPath, { signal: options.signal });
    return session ? { context, session } : null;
  }

  async function openTemporarySession(filePath, options = {}) {
    const target = await temporarySession(filePath, options);
    if (!target) return null;
    return detailQueries.getSessionDetailForSession(target.context, target.session, {
      signal: options.signal,
      related: null,
      getThreadHierarchy: async () => ({ parent: null, children: [], siblings: [] }),
    });
  }

  async function queryTemporarySessionEvents(filePath, params, options = {}) {
    const target = await temporarySession(filePath, options);
    if (!target) return null;
    return eventQueries.querySessionEventsForSession(target.context, target.session, params, { sourceId: target.context.source.id }, options);
  }

  async function getTemporarySessionEvent(filePath, index, options = {}) {
    const target = await temporarySession(filePath, options);
    if (!target) return null;
    return eventQueries.getSessionEventForSession(target.context, target.session, index, options);
  }

  return {
    getDefaultSource: sourceContexts.getDefaultSource,
    getSourceContext: sourceContexts.getSourceContext,
    listSources: sourceContexts.listSources,
    normalizeSessionCatalogScope: catalogQueries.normalizeSessionCatalogScope,
    listSessionsForDisplay: catalogQueries.listSessionsForDisplay,
    getSessionDetail: detailQueries.getSessionDetail,
    querySessions: catalogQueries.querySessions,
    querySessionView: detailQueries.querySessionView,
    querySessionEvents: eventQueries.querySessionEvents,
    getSessionEvent: eventQueries.getSessionEvent,
    getTemporarySessionEvent,
    openTemporarySession,
    queryTemporarySessionEvents,
    streamSessionLive: liveStreams.streamSession,
  };
}
