import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRendererConfigStore, normalizePeerInput } from "../src/renderer-config.mjs";

test("renderer config store persists peers and redacts token in public output", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-config-"));
  try {
    const store = createRendererConfigStore({ configPath: path.join(dir, "config.json") });
    const peer = await store.upsertPeer({
      id: "office",
      label: "Office",
      url: "192.168.1.20:4791",
      token: "secret-token",
    });

    assert.equal(peer.id, "office");
    assert.equal(peer.label, "Office");
    assert.equal(peer.url, "http://192.168.1.20:4791");
    assert.equal(peer.enabled, true);
    assert.equal(peer.hasToken, true);
    assert.match(await readFile(path.join(dir, "config.json"), "utf8"), /secret-token/);
    assert.doesNotMatch(JSON.stringify(await store.listPeers()), /secret-token/);

    await store.upsertPeer({
      id: "office",
      label: "Office renamed",
      url: "192.168.1.20:4791",
      token: "",
    });
    const config = await store.readConfig();
    assert.equal(config.peers[0].label, "Office renamed");
    assert.equal(config.peers[0].token, "secret-token");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("normalizePeerInput requires a token for new peers", () => {
  assert.throws(
    () => normalizePeerInput({ id: "office", url: "192.168.1.20:4791" }),
    /Token 不能为空/,
  );
  assert.equal(
    normalizePeerInput({ id: "office", url: "192.168.1.20:4791", requireToken: false }).url,
    "http://192.168.1.20:4791",
  );
});
