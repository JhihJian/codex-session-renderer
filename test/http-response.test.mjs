import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { contentTypeForPath, jsonHeaders, resolveStaticFilePath, textHeaders } from "../src/http-response.mjs";

test("resolveStaticFilePath keeps static requests inside the public root", () => {
  const publicDir = path.resolve("public");

  assert.equal(resolveStaticFilePath(publicDir, "/"), path.join(publicDir, "index.html"));
  assert.equal(resolveStaticFilePath(publicDir, "/styles.css"), path.join(publicDir, "styles.css"));
  assert.equal(resolveStaticFilePath(publicDir, "/nested/app.js"), path.join(publicDir, "nested", "app.js"));
  assert.equal(resolveStaticFilePath(publicDir, "/../server.mjs"), null);
  assert.equal(resolveStaticFilePath(publicDir, "/..%2Fserver.mjs"), null);
});

test("contentTypeForPath returns explicit UTF-8 types and binary fallback", () => {
  assert.equal(contentTypeForPath("index.html"), "text/html; charset=utf-8");
  assert.equal(contentTypeForPath("app.js"), "text/javascript; charset=utf-8");
  assert.equal(contentTypeForPath("styles.css"), "text/css; charset=utf-8");
  assert.equal(contentTypeForPath("asset.bin"), "application/octet-stream");
});

test("all normal response header sets disable browser caching and active-content escalation", () => {
  for (const headers of [jsonHeaders, textHeaders]) {
    assert.equal(headers["cache-control"], "no-store");
    assert.match(headers["content-security-policy"], /frame-ancestors 'none'/);
    assert.equal(headers["x-content-type-options"], "nosniff");
    assert.equal(headers["x-frame-options"], "DENY");
    assert.equal(headers["referrer-policy"], "no-referrer");
  }
});
