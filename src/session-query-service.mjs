import { createSessionCatalogQueryService } from "./session-catalog-query-service.mjs";
import { createSessionDetailQueryService } from "./session-detail-query-service.mjs";
import { createSessionDirectoryQueryService } from "./session-directory-query-service.mjs";
import { createSessionEventQueryService } from "./session-event-query-service.mjs";
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
    throwIfRequestAborted,
  });
  const eventQueries = createSessionEventQueryService({
    getSessionById: catalogQueries.getSessionById,
    sessionFileExists: sourceContexts.sessionFileExists,
    sessionFileStat: sourceContexts.sessionFileStat,
    throwIfRequestAborted,
  });

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
  };
}