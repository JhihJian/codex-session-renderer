import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createPiModelCatalogService, createPiModelCatalogFromEnv, createStaticModelCatalog, queryPiRpcModels } from "../src/pi-model-catalog.mjs";

test("createStaticModelCatalog indexes provider and model id pairs", () => {
  const catalog = createStaticModelCatalog([
    { provider: "local-sub2api", id: "gpt-5.6-terra", contextWindow: 1_000_000, maxTokens: 128_000 },
    { provider: "openai", id: "gpt-5.6-terra", contextWindow: 272_000, maxTokens: 128_000 },
    { provider: "", id: "broken", contextWindow: 100 },
    { provider: "x", id: "no-window", contextWindow: 0 },
  ]);
  catalog.start();
  assert.deepEqual(catalog.lookupWindow("local-sub2api", "gpt-5.6-terra"), { contextWindow: 1_000_000, maxTokens: 128_000 });
  assert.deepEqual(catalog.lookupWindow("openai", "gpt-5.6-terra"), { contextWindow: 272_000, maxTokens: 128_000 });
  assert.equal(catalog.lookupWindow("local-sub2api", "unknown"), null);
  assert.equal(catalog.lookupWindow("x", "no-window"), null);
  catalog.stop();
});

test("createPiModelCatalogService refreshes snapshot and dedupes concurrent refreshes", async () => {
  let calls = 0;
  let resolveQuery;
  const service = createPiModelCatalogService({
    queryModels: () => {
      calls += 1;
      return new Promise((resolve) => {
        resolveQuery = () => resolve([{ provider: "p", id: "m", contextWindow: 5000, maxTokens: 800 }]);
      });
    },
  });
  assert.equal(service.getModels(), null);
  const first = service.refresh();
  const second = service.refresh();
  resolveQuery();
  await first;
  await second;
  assert.equal(calls, 1);
  assert.deepEqual(service.lookupWindow("p", "m"), { contextWindow: 5000, maxTokens: 800 });
  assert.equal(service.lookupWindow("p", "other"), null);
});

test("createPiModelCatalogService keeps last snapshot when refresh fails", async () => {
  let fail = false;
  const service = createPiModelCatalogService({
    queryModels: () => (fail ? Promise.reject(new Error("pi unavailable")) : Promise.resolve([{ provider: "p", id: "m", contextWindow: 5000 }])),
  });
  await service.refresh();
  fail = true;
  await assert.rejects(() => service.refresh(), /pi unavailable/);
  assert.deepEqual(service.lookupWindow("p", "m"), { contextWindow: 5000, maxTokens: 0 });
});

test("createPiModelCatalogFromEnv prefers a catalog fixture file", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "csr-catalog-"));
  try {
    const filePath = path.join(dir, "models.json");
    writeFileSync(filePath, JSON.stringify([{ provider: "local-sub2api", id: "gpt-5.6-terra", contextWindow: 400000, maxTokens: 64000 }]));
    const catalog = createPiModelCatalogFromEnv({ env: { CODEX_SESSION_RENDERER_PI_MODEL_CATALOG_FILE: filePath } });
    catalog.start();
    assert.deepEqual(catalog.lookupWindow("local-sub2api", "gpt-5.6-terra"), { contextWindow: 400000, maxTokens: 64000 });
    assert.equal(createPiModelCatalogFromEnv({ env: { CODEX_SESSION_RENDERER_PI_MODEL_CATALOG_FILE: path.join(dir, "missing.json") } }), null);
    catalog.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("queryPiRpcModels resolves models from the rpc response line", async () => {
  const models = await queryPiRpcModels({
    command: [process.execPath, "-e", [
      'process.stdin.once("data", () => {',
      '  process.stdout.write(JSON.stringify({ type: "session", version: 3 }) + "\\n");',
      '  process.stdout.write(JSON.stringify({ type: "response", command: "get_available_models", data: { models: [{ provider: "p", id: "m", contextWindow: 1000 }] } }) + "\\n");',
      '});',
    ].join("")],
    timeoutMs: 10_000,
  });
  assert.deepEqual(models, [{ provider: "p", id: "m", contextWindow: 1000 }]);
});

test("queryPiRpcModels rejects on spawn error", async () => {
  await assert.rejects(() => queryPiRpcModels({ command: ["definitely-missing-pi-binary-xyz", "--mode", "rpc"], timeoutMs: 2_000 }));
});
