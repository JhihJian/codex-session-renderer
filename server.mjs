import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertSecureListenConfig, createAccessControl, requireAuthorizedRequest } from "./src/access-control.mjs";
import { createSessionQueryService } from "./src/session-query-service.mjs";
import { createSessionRouter } from "./src/session-router.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const port = Number(process.env.PORT || 4789);
const host = process.env.HOST || "127.0.0.1";
const accessToken = process.env.CODEX_SESSION_RENDERER_TOKEN || "";

const sessionQueryService = createSessionQueryService();
const route = createSessionRouter({ service: sessionQueryService, publicDir });

function createRendererServer(options = {}) {
  const listenHost = options.host || host;
  const listenToken = options.token ?? accessToken;
  assertSecureListenConfig({ host: listenHost, token: listenToken });
  const requestRoute = options.route || route;
  const accessControl = options.accessControl || createAccessControl({ host: listenHost, token: listenToken });
  return createServer((req, res) => {
    if (!requireAuthorizedRequest(req, res, accessControl)) return;
    return requestRoute(req, res);
  });
}

function startServer(options = {}) {
  const listenPort = options.port ?? port;
  const listenHost = options.host ?? host;
  const listenToken = options.token ?? accessToken;
  const server = createRendererServer({ ...options, host: listenHost, token: listenToken });
  return server.listen(listenPort, listenHost, () => {
    console.log(`Codex session renderer: http://${listenHost}:${listenPort}/`);
    for (const source of sessionQueryService.listSources()) {
      console.log(`Read-only data source [${source.id}]: ${source.codexHome}`);
    }
  });
}

function isDirectRun() {
  if (!process.argv[1]) return false;
  const currentPath = path.resolve(fileURLToPath(import.meta.url));
  const entryPath = path.resolve(process.argv[1]);
  return process.platform === "win32" ? currentPath.toLowerCase() === entryPath.toLowerCase() : currentPath === entryPath;
}

if (isDirectRun()) {
  try {
    startServer();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

export {
  assertSecureListenConfig,
  createAccessControl,
  createRendererServer,
  route,
  startServer,
};