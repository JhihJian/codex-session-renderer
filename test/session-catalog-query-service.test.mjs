import test from "node:test";
import assert from "node:assert/strict";
import { sessionCatalogBounds, sessionMatchesCatalogBounds } from "../src/session-catalog-query-service.mjs";

test("session catalog scopes divide fixed-source sessions on the server", () => {
  const now = Date.parse("2026-09-29T10:00:00.000Z");
  const realtime = { updatedAt: "2026-09-29T07:30:00.000Z" };
  const day = { updatedAt: "2026-09-29T04:00:00.000Z" };
  const earlier = { updatedAt: "2026-09-28T09:00:00.000Z" };

  assert.equal(sessionMatchesCatalogBounds(realtime, sessionCatalogBounds("realtime", now)), true);
  assert.equal(sessionMatchesCatalogBounds(day, sessionCatalogBounds("realtime", now)), false);

  assert.equal(sessionMatchesCatalogBounds(realtime, sessionCatalogBounds("day", now)), false);
  assert.equal(sessionMatchesCatalogBounds(day, sessionCatalogBounds("day", now)), true);
  assert.equal(sessionMatchesCatalogBounds(earlier, sessionCatalogBounds("day", now)), false);

  assert.equal(sessionMatchesCatalogBounds(day, sessionCatalogBounds("earlier", now)), false);
  assert.equal(sessionMatchesCatalogBounds(earlier, sessionCatalogBounds("earlier", now)), true);
  assert.equal(sessionMatchesCatalogBounds({}, sessionCatalogBounds("earlier", now)), true);
});