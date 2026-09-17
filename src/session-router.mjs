import { sanitizeErrorMessage } from "./data-sources.mjs";
import { sendError, sendJson, serveStaticFile } from "./http-response.mjs";
import { isAbortError } from "./session-detail-coordinator.mjs";

const READ_ONLY_API_PATHS = ["/api/health", "/api/sources"];
const READ_ONLY_API_PATTERNS = [
  /^\/api\/sessions(?:\/.*)?$/,
  /^\/api\/query\/.*$/,
  /^\/api\/sources\/[^/]+\/sessions(?:\/.*)?$/,
  /^\/api\/sources\/[^/]+\/query\/.*$/,
];

const API_HANDLERS = [
  handleHealthRequest,
  handleSourcesRequest,
  handleSessionListRequest,
  handleSourceSessionListRequest,
  handleSourceEventRequest,
  handleSourceSessionRequest,
  handleSessionQueryRequest,
  handleSessionViewQueryRequest,
  handleSessionEventsQueryRequest,
  handleSourceSessionQueryRequest,
  handleSourceSessionViewQueryRequest,
  handleSourceSessionEventsQueryRequest,
  handleEventRequest,
  handleSessionRequest,
];

export function createSessionRouter({ service, publicDir }) {
  return createRoute({ service, publicDir });
}

function createRoute(dependencies) {
  return function route(req, res) {
    return routeRequest(dependencies, req, res);
  };
}

async function routeRequest(dependencies, req, res) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const requestSubscription = createRequestAbortSubscription(req, res);
  try {
    if (rejectUnsupportedReadOnlyMethod(req, res, url.pathname)) return undefined;
    const handled = await dispatchApiRequest({ ...dependencies, req, res, url, pathname: url.pathname, signal: requestSubscription.signal });
    if (handled) return undefined;
    return serveStaticRequest(req, res, url.pathname, dependencies.publicDir);
  } catch (error) {
    return sendUnexpectedRequestError(res, error);
  } finally {
    requestSubscription.dispose();
  }
}

async function dispatchApiRequest(request) {
  for (const handler of API_HANDLERS) {
    if (await handler(request)) return true;
  }
  return false;
}

function createRequestAbortSubscription(req, res) {
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

function rejectUnsupportedReadOnlyMethod(req, res, pathname) {
  if (!isReadOnlyApiPath(pathname) || req.method === "GET") return false;
  sendError(res, 405, "Method not allowed");
  return true;
}

function isReadOnlyApiPath(pathname) {
  return READ_ONLY_API_PATHS.includes(pathname) || READ_ONLY_API_PATTERNS.some((pattern) => pattern.test(pathname));
}

function serveStaticRequest(req, res, pathname, publicDir) {
  if (req.method !== "GET") return sendError(res, 405, "Method not allowed");
  return serveStaticFile(res, publicDir, pathname);
}

function sendUnexpectedRequestError(res, error) {
  if (isAbortError(error) || res.destroyed) return undefined;
  const status = error?.status || 500;
  const publicMessage = status >= 500 ? "Internal server error" : sanitizeErrorMessage(error?.message || "Bad request");
  return sendError(res, status, publicMessage, {
    name: error?.name,
    code: error?.code,
    status,
    message: publicMessage,
  });
}

function resolveRequestSource(service, url) {
  return service.getSourceContext(url.searchParams.get("sourceId") || "local");
}

function resolveSourceOrRespond(res, sourceContext) {
  if (sourceContext) return sourceContext;
  sendError(res, 404, "Data source not found");
  return null;
}

function queryProjectionOptions(context, url) {
  if (url.searchParams.has("sourceId") && context.source.id !== "local") return { sourceId: context.source.id };
  return {};
}

function sendResourceResponse(res, resourceName, resource) {
  if (!resource) return sendError(res, 404, `${resourceName} not found`);
  return sendJson(res, 200, resource);
}

async function sendSessionList(res, service, context, url, source) {
  const scope = service.normalizeSessionCatalogScope(url.searchParams.get("scope"));
  const sessions = await service.listSessionsForDisplay(context, scope, url.searchParams);
  const body = source ? { source, scope, sessions } : { scope, sessions };
  return sendJson(res, 200, body);
}

function handleHealthRequest({ pathname, res, service }) {
  if (pathname !== "/api/health") return false;
  const defaultContext = service.getSourceContext(service.getDefaultSource()?.id);
  sendJson(res, 200, {
    ok: true,
    codexHome: defaultContext?.codexHome,
    sessionsRoot: defaultContext?.sessionsRoot,
    sessionIndexPath: defaultContext?.sessionIndexPath,
    defaultSourceId: defaultContext?.source.id,
    sources: service.listSources(),
    time: new Date().toISOString(),
  });
  return true;
}

function handleSourcesRequest({ pathname, res, service }) {
  if (pathname !== "/api/sources") return false;
  sendJson(res, 200, { sources: service.listSources() });
  return true;
}

async function handleSessionListRequest({ pathname, res, service, url }) {
  if (pathname !== "/api/sessions") return false;
  const context = resolveSourceOrRespond(res, resolveRequestSource(service, url));
  if (!context) return true;
  await sendSessionList(res, service, context, url);
  return true;
}

async function handleSourceSessionListRequest({ pathname, res, service, url }) {
  const match = pathname.match(/^\/api\/sources\/([^/]+)\/sessions$/);
  if (!match) return false;
  const context = resolveSourceOrRespond(res, service.getSourceContext(decodeURIComponent(match[1])));
  if (!context) return true;
  const source = service.listSources().find((candidate) => candidate.id === context.source.id);
  await sendSessionList(res, service, context, url, source);
  return true;
}

async function handleSourceEventRequest({ pathname, res, service, signal }) {
  const match = pathname.match(/^\/api\/sources\/([^/]+)\/sessions\/([^/]+)\/events\/(\d+)$/);
  if (!match) return false;
  const context = resolveSourceOrRespond(res, service.getSourceContext(decodeURIComponent(match[1])));
  if (!context) return true;
  const event = await service.getSessionEvent(context, decodeURIComponent(match[2]), Number(match[3]), { signal });
  sendResourceResponse(res, "Event", event);
  return true;
}

async function handleSourceSessionRequest({ pathname, res, service, signal }) {
  const match = pathname.match(/^\/api\/sources\/([^/]+)\/sessions\/([^/]+)$/);
  if (!match) return false;
  const context = resolveSourceOrRespond(res, service.getSourceContext(decodeURIComponent(match[1])));
  if (!context) return true;
  const detail = await service.getSessionDetail(context, decodeURIComponent(match[2]), { signal });
  sendResourceResponse(res, "Session", detail);
  return true;
}

async function handleSessionQueryRequest({ pathname, res, service, url }) {
  if (pathname !== "/api/query/sessions") return false;
  const context = resolveSourceOrRespond(res, resolveRequestSource(service, url));
  if (!context) return true;
  const result = await service.querySessions(context, url.searchParams, queryProjectionOptions(context, url));
  sendJson(res, 200, result);
  return true;
}

async function handleSessionViewQueryRequest({ pathname, res, service, signal, url }) {
  const match = pathname.match(/^\/api\/query\/sessions\/([^/]+)\/view$/);
  if (!match) return false;
  const context = resolveSourceOrRespond(res, resolveRequestSource(service, url));
  if (!context) return true;
  const view = await service.querySessionView(context, decodeURIComponent(match[1]), url.searchParams, queryProjectionOptions(context, url), { signal });
  sendResourceResponse(res, "Session", view);
  return true;
}

async function handleSessionEventsQueryRequest({ pathname, res, service, signal, url }) {
  const match = pathname.match(/^\/api\/query\/sessions\/([^/]+)\/events$/);
  if (!match) return false;
  const context = resolveSourceOrRespond(res, resolveRequestSource(service, url));
  if (!context) return true;
  const events = await service.querySessionEvents(context, decodeURIComponent(match[1]), url.searchParams, queryProjectionOptions(context, url), { signal });
  sendResourceResponse(res, "Session", events);
  return true;
}

async function handleSourceSessionQueryRequest({ pathname, res, service, url }) {
  const match = pathname.match(/^\/api\/sources\/([^/]+)\/query\/sessions$/);
  if (!match) return false;
  const context = resolveSourceOrRespond(res, service.getSourceContext(decodeURIComponent(match[1])));
  if (!context) return true;
  const result = await service.querySessions(context, url.searchParams, { sourceId: context.source.id });
  sendJson(res, 200, result);
  return true;
}

async function handleSourceSessionViewQueryRequest({ pathname, res, service, signal, url }) {
  const match = pathname.match(/^\/api\/sources\/([^/]+)\/query\/sessions\/([^/]+)\/view$/);
  if (!match) return false;
  const context = resolveSourceOrRespond(res, service.getSourceContext(decodeURIComponent(match[1])));
  if (!context) return true;
  const view = await service.querySessionView(context, decodeURIComponent(match[2]), url.searchParams, { sourceId: context.source.id }, { signal });
  sendResourceResponse(res, "Session", view);
  return true;
}

async function handleSourceSessionEventsQueryRequest({ pathname, res, service, signal, url }) {
  const match = pathname.match(/^\/api\/sources\/([^/]+)\/query\/sessions\/([^/]+)\/events$/);
  if (!match) return false;
  const context = resolveSourceOrRespond(res, service.getSourceContext(decodeURIComponent(match[1])));
  if (!context) return true;
  const events = await service.querySessionEvents(context, decodeURIComponent(match[2]), url.searchParams, { sourceId: context.source.id }, { signal });
  sendResourceResponse(res, "Session", events);
  return true;
}

async function handleEventRequest({ pathname, res, service, signal, url }) {
  const match = pathname.match(/^\/api\/sessions\/([^/]+)\/events\/(\d+)$/);
  if (!match) return false;
  const context = resolveSourceOrRespond(res, resolveRequestSource(service, url));
  if (!context) return true;
  const event = await service.getSessionEvent(context, decodeURIComponent(match[1]), Number(match[2]), { signal });
  sendResourceResponse(res, "Event", event);
  return true;
}

async function handleSessionRequest({ pathname, res, service, signal, url }) {
  const match = pathname.match(/^\/api\/sessions\/([^/]+)$/);
  if (!match) return false;
  const context = resolveSourceOrRespond(res, resolveRequestSource(service, url));
  if (!context) return true;
  const detail = await service.getSessionDetail(context, decodeURIComponent(match[1]), { signal });
  sendResourceResponse(res, "Session", detail);
  return true;
}