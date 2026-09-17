import { sanitizeErrorMessage } from "./data-sources.mjs";
import { sendError, sendJson, serveStaticFile } from "./http-response.mjs";
import { isAbortError } from "./session-detail-coordinator.mjs";

export function createSessionRouter({ service, publicDir }) {
  const {
    getDefaultSource,
    getSourceContext,
    listSources,
    normalizeSessionCatalogScope,
    listSessionsForDisplay,
    getSessionDetail,
    querySessions,
    querySessionView,
    querySessionEvents,
    getSessionEvent,
  } = service;

async function serveStatic(req, res, pathname) {
  if (req.method !== "GET") return sendError(res, 405, "Method not allowed");
  return serveStaticFile(res, publicDir, pathname);
}


function allowMethod(req, res, methods) {
  if (methods.includes(req.method)) return true;
  sendError(res, 405, "Method not allowed");
  return false;
}

function requestAbortSubscription(req, res) {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) controller.abort();
  };
  const onResponseClose = () => {
    if (!res.writableEnded) abort();
  };
  req.once("aborted", abort);
  res.once("close", onResponseClose);
  return {
    signal: controller.signal,
    dispose: () => {
      req.removeListener("aborted", abort);
      res.removeListener("close", onResponseClose);
    },
  };
}

function isReadOnlyApiPath(pathname) {
  return (
    pathname === "/api/health" ||

    pathname === "/api/sources" ||
    pathname === "/api/sessions" ||
    pathname.startsWith("/api/sessions/") ||
    pathname.startsWith("/api/query/") ||
    /^\/api\/sources\/[^/]+\/sessions(?:\/.*)?$/.test(pathname) ||
    /^\/api\/sources\/[^/]+\/query\/.*$/.test(pathname)
  );
}


async function route(req, res) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const pathname = url.pathname;
  const requestSubscription = requestAbortSubscription(req, res);
  try {
    if (isReadOnlyApiPath(pathname) && !allowMethod(req, res, ["GET"])) return;

    if (pathname === "/api/health") {
      const defaultContext = getSourceContext(getDefaultSource()?.id);
      return sendJson(res, 200, {
        ok: true,
        codexHome: defaultContext?.codexHome,
        sessionsRoot: defaultContext?.sessionsRoot,
        sessionIndexPath: defaultContext?.sessionIndexPath,
        defaultSourceId: defaultContext?.source.id,
        sources: listSources(),
        time: new Date().toISOString(),
      });
    }

    if (pathname === "/api/sources") {
      return sendJson(res, 200, { sources: listSources() });
    }

    if (pathname === "/api/sessions") {
      const context = resolveRequestSource(url);
      if (!context) return sendError(res, 404, "Data source not found");
      const scope = normalizeSessionCatalogScope(url.searchParams.get("scope"));
      const sessions = await listSessionsForDisplay(context, scope, url.searchParams);
      return sendJson(res, 200, { scope, sessions });
    }
    const sourceSessionsMatch = pathname.match(/^\/api\/sources\/([^/]+)\/sessions$/);
    if (sourceSessionsMatch) {
      const context = getSourceContext(decodeURIComponent(sourceSessionsMatch[1]));
      if (!context) return sendError(res, 404, "Data source not found");
      const scope = normalizeSessionCatalogScope(url.searchParams.get("scope"));
      const sessions = await listSessionsForDisplay(context, scope, url.searchParams);
      return sendJson(res, 200, { source: listSources().find((source) => source.id === context.source.id), scope, sessions });
    }

    const sourceEventMatch = pathname.match(/^\/api\/sources\/([^/]+)\/sessions\/([^/]+)\/events\/(\d+)$/);
    if (sourceEventMatch) {
      const context = getSourceContext(decodeURIComponent(sourceEventMatch[1]));
      if (!context) return sendError(res, 404, "Data source not found");
      const event = await getSessionEvent(context, decodeURIComponent(sourceEventMatch[2]), Number(sourceEventMatch[3]), { signal: requestSubscription.signal });
      if (!event) return sendError(res, 404, "Event not found");
      return sendJson(res, 200, event);
    }
    const sourceSessionMatch = pathname.match(/^\/api\/sources\/([^/]+)\/sessions\/([^/]+)$/);
    if (sourceSessionMatch) {
      const context = getSourceContext(decodeURIComponent(sourceSessionMatch[1]));
      if (!context) return sendError(res, 404, "Data source not found");
      const detail = await getSessionDetail(context, decodeURIComponent(sourceSessionMatch[2]), { signal: requestSubscription.signal });
      if (!detail) return sendError(res, 404, "Session not found");
      return sendJson(res, 200, detail);
    }
    if (pathname === "/api/query/sessions") {
      const context = resolveRequestSource(url);
      if (!context) return sendError(res, 404, "Data source not found");
      return sendJson(res, 200, await querySessions(context, url.searchParams, queryProjectionOptions(context, url)));
    }
    const queryViewMatch = pathname.match(/^\/api\/query\/sessions\/([^/]+)\/view$/);
    if (queryViewMatch) {
      const context = resolveRequestSource(url);
      if (!context) return sendError(res, 404, "Data source not found");
      const view = await querySessionView(context, decodeURIComponent(queryViewMatch[1]), url.searchParams, queryProjectionOptions(context, url), { signal: requestSubscription.signal });
      if (!view) return sendError(res, 404, "Session not found");
      return sendJson(res, 200, view);
    }
    const queryEventsMatch = pathname.match(/^\/api\/query\/sessions\/([^/]+)\/events$/);
    if (queryEventsMatch) {
      const context = resolveRequestSource(url);
      if (!context) return sendError(res, 404, "Data source not found");
      const events = await querySessionEvents(context, decodeURIComponent(queryEventsMatch[1]), url.searchParams, queryProjectionOptions(context, url), { signal: requestSubscription.signal });
      if (!events) return sendError(res, 404, "Session not found");
      return sendJson(res, 200, events);
    }
    const sourceQuerySessionsMatch = pathname.match(/^\/api\/sources\/([^/]+)\/query\/sessions$/);
    if (sourceQuerySessionsMatch) {
      const context = getSourceContext(decodeURIComponent(sourceQuerySessionsMatch[1]));
      if (!context) return sendError(res, 404, "Data source not found");
      return sendJson(res, 200, await querySessions(context, url.searchParams, { sourceId: context.source.id }));
    }
    const sourceQueryViewMatch = pathname.match(/^\/api\/sources\/([^/]+)\/query\/sessions\/([^/]+)\/view$/);
    if (sourceQueryViewMatch) {
      const context = getSourceContext(decodeURIComponent(sourceQueryViewMatch[1]));
      if (!context) return sendError(res, 404, "Data source not found");
      const view = await querySessionView(context, decodeURIComponent(sourceQueryViewMatch[2]), url.searchParams, { sourceId: context.source.id }, { signal: requestSubscription.signal });
      if (!view) return sendError(res, 404, "Session not found");
      return sendJson(res, 200, view);
    }
    const sourceQueryEventsMatch = pathname.match(/^\/api\/sources\/([^/]+)\/query\/sessions\/([^/]+)\/events$/);
    if (sourceQueryEventsMatch) {
      const context = getSourceContext(decodeURIComponent(sourceQueryEventsMatch[1]));
      if (!context) return sendError(res, 404, "Data source not found");
      const events = await querySessionEvents(context, decodeURIComponent(sourceQueryEventsMatch[2]), url.searchParams, { sourceId: context.source.id }, { signal: requestSubscription.signal });
      if (!events) return sendError(res, 404, "Session not found");
      return sendJson(res, 200, events);
    }

    const eventMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/events\/(\d+)$/);
    if (eventMatch) {
      const context = resolveRequestSource(url);
      if (!context) return sendError(res, 404, "Data source not found");
      const event = await getSessionEvent(context, decodeURIComponent(eventMatch[1]), Number(eventMatch[2]), { signal: requestSubscription.signal });
      if (!event) return sendError(res, 404, "Event not found");
      return sendJson(res, 200, event);
    }
    const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
    if (sessionMatch) {
      const context = resolveRequestSource(url);
      if (!context) return sendError(res, 404, "Data source not found");
      const detail = await getSessionDetail(context, decodeURIComponent(sessionMatch[1]), { signal: requestSubscription.signal });
      if (!detail) return sendError(res, 404, "Session not found");
      return sendJson(res, 200, detail);
    }
    return serveStatic(req, res, pathname);
  } catch (error) {
    if (isAbortError(error) || res.destroyed) return undefined;
    const status = error?.status || 500;
    const publicMessage = status >= 500 ? "Internal server error" : sanitizeErrorMessage(error?.message || "Bad request");
    return sendError(res, status, publicMessage, {
      name: error?.name,
      code: error?.code,
      status,
      message: publicMessage,
    });
  } finally {
    requestSubscription.dispose();
  }
}

function resolveRequestSource(url) {
  return getSourceContext(url.searchParams.get("sourceId") || "local");
}

function queryProjectionOptions(context, url) {
  if (url.searchParams.has("sourceId") && context.source.id !== "local") {
    return { sourceId: context.source.id };
  }
  return {};
}



  return route;
}
