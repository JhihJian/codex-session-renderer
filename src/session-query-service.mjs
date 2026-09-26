import { stat } from "node:fs/promises";
import { createSessionCatalogQueryService } from "./session-catalog-query-service.mjs";
import { createSessionDetailQueryService } from "./session-detail-query-service.mjs";
import { createSessionDirectoryQueryService } from "./session-directory-query-service.mjs";
import { createSessionEventQueryService } from "./session-event-query-service.mjs";
import { createSessionSourceContextService, throwIfRequestAborted } from "./session-source-context-service.mjs";
import { compactSessionForList } from "./session-models.mjs";

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

  async function temporarySession(filePath, options = {}) {
    const resolvedPath = await sourceContexts.resolveTemporarySessionPath(filePath);
    const context = sourceContexts.getTemporarySessionContext(resolvedPath);
    if ((await stat(resolvedPath)).isDirectory()) {
      const files = await sourceContexts.listTemporarySessionFiles(resolvedPath, { maxRecords: maxListSessions, signal: options.signal, throwIfRequestAborted });
      const sessions = (await Promise.all(files.map((candidatePath) => directoryQueries.sessionFromFilePath(context, candidatePath, { signal: options.signal })))).filter(Boolean);
      return { context, directoryPath: resolvedPath, sessions };
    }
    const session = await directoryQueries.sessionFromFilePath(context, resolvedPath, { signal: options.signal });
    return session ? { context, session } : null;
  }

  async function openTemporarySession(filePath, options = {}) {
    const target = await temporarySession(filePath, options);
    if (!target) return null;
    if (target.sessions) {
      return {
        source: { id: target.context.source.id, label: target.context.source.label, kind: target.context.source.kind },
        path: target.directoryPath,
        sessions: target.sessions.map((session) => ({ ...compactSessionForList(session), path: session.path })),
      };
    }
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

  async function getTemporarySessionExecutionExport(filePath, options = {}) {
    const target = await temporarySession(filePath, options);
    if (!target?.session) return null;
    return detailQueries.getSessionExecutionExportForSession(target.context, target.session, {
      signal: options.signal,
      related: null,
      getThreadHierarchy: async () => ({ parent: null, children: [], siblings: [] }),
    });
  }

  return {
    getDefaultSource: sourceContexts.getDefaultSource,
    getSourceContext: sourceContexts.getSourceContext,
    listSources: sourceContexts.listSources,
    describeDataSourceConfig: sourceContexts.describeDataSourceConfig,
    updateDataSourceConfig: sourceContexts.updateDataSourceConfig,
    normalizeSessionCatalogScope: catalogQueries.normalizeSessionCatalogScope,
    listSessionsForDisplay: catalogQueries.listSessionsForDisplay,
    getSessionDetail: detailQueries.getSessionDetail,
    getSessionExecutionExport: detailQueries.getSessionExecutionExport,
    querySessions: catalogQueries.querySessions,
    querySessionView: detailQueries.querySessionView,
    querySessionEvents: eventQueries.querySessionEvents,
    getSessionEvent: eventQueries.getSessionEvent,
    getTemporarySessionEvent,
    getTemporarySessionExecutionExport,
    openTemporarySession,
    queryTemporarySessionEvents,
  };
}
