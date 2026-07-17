import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRendererConfigStore, normalizePeerInput, publicPeer } from "../src/renderer-config.mjs";

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
    if (process.platform !== "win32") {
      assert.equal((await stat(dir)).mode & 0o777, 0o700);
      assert.equal((await stat(path.join(dir, "config.json"))).mode & 0o777, 0o600);
    }

    await store.upsertPeer({
      id: "office",
      label: "Office renamed",
      url: "192.168.1.20:4791",
      token: "",
    });
    const config = await store.readConfig();
    assert.equal(config.peers[0].label, "Office renamed");
    assert.equal(config.peers[0].token, "secret-token");
    await assert.rejects(
      store.upsertPeer({ id: "office", label: "Office renamed", url: "192.168.1.21:4791", token: "" }),
      /修改远端地址时必须重新填写访问令牌/,
    );
    assert.equal((await store.readConfig()).peers[0].url, "http://192.168.1.20:4791");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("normalizePeerInput requires a token for new peers", () => {
  assert.throws(
    () => normalizePeerInput({ id: "office", url: "192.168.1.20:4791" }),
    /访问令牌不能为空/,
  );
  assert.equal(
    normalizePeerInput({ id: "office", url: "192.168.1.20:4791", requireToken: false }).url,
    "http://192.168.1.20:4791",
  );
});

test("renderer config serializes concurrent peer writes", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-config-queue-"));
  try {
    const store = createRendererConfigStore({ configPath: path.join(dir, "config.json") });
    await Promise.all([
      store.upsertPeer({ id: "office", url: "192.168.1.20:4791", token: "office-token" }),
      store.upsertPeer({ id: "lab", url: "192.168.1.21:4791", token: "lab-token" }),
    ]);
    assert.deepEqual((await store.listPeers()).map((peer) => peer.id).sort(), ["lab", "office"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("failed config replacement does not commit the source-fence callback", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-config-transaction-"));
  try {
    const configPath = path.join(dir, "config.json");
    const initial = createRendererConfigStore({ configPath });
    await initial.upsertPeer({ id: "office", label: "Office", url: "192.168.1.20:4791", token: "office-token" });
    let committed = 0;
    const failingFs = {
      chmod,
      mkdir,
      readFile,
      rm,
      writeFile,
      async rename(from, to) {
        if (to === configPath) throw new Error("simulated config replacement failure");
        await rename(from, to);
      },
    };
    const store = createRendererConfigStore({
      configPath,
      fsApi: failingFs,
      onCommittedMutation: () => {
        committed += 1;
      },
    });

    await assert.rejects(
      store.upsertPeer({ id: "office", label: "Changed", url: "192.168.1.20:4791", token: "" }),
      /simulated config replacement failure/,
    );
    assert.equal(committed, 0);
    assert.equal((await initial.readConfig()).peers[0].label, "Office");
    assert.equal((await initial.readConfig()).peers[0].token, "office-token");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("renderer config rejects peer URLs with embedded userinfo", async () => {
  assert.throws(
    () => normalizePeerInput({ id: "office", url: "http://user:secret@192.168.1.20:4791", token: "peer-token" }),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.field, "url");
      assert.match(error.message, /账号或密码/);
      assert.doesNotMatch(error.message, /secret|user:secret/);
      return true;
    },
  );

  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-config-userinfo-"));
  try {
    const configPath = path.join(dir, "config.json");
    const store = createRendererConfigStore({ configPath });
    await assert.rejects(
      store.upsertPeer({ id: "office", url: "http://user:secret@192.168.1.20:4791", token: "peer-token" }),
      (error) => {
        assert.equal(error.status, 400);
        assert.equal(error.field, "url");
        assert.doesNotMatch(error.message, /secret|user:secret/);
        return true;
      },
    );
    await assert.rejects(readFile(configPath, "utf8"), { code: "ENOENT" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("renderer config rejects peer URLs with query credentials", async () => {
  assert.throws(
    () => normalizePeerInput({ id: "office", url: "http://192.168.1.20:4791?token=secret#frag", token: "peer-token" }),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.field, "url");
      assert.match(error.message, /查询参数|访问令牌/);
      assert.doesNotMatch(error.message, /secret|token=secret/);
      return true;
    },
  );

  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-config-query-"));
  try {
    const configPath = path.join(dir, "config.json");
    const store = createRendererConfigStore({ configPath });
    await assert.rejects(
      store.upsertPeer({ id: "office", url: "http://192.168.1.20:4791?access_token=secret", token: "peer-token" }),
      (error) => {
        assert.equal(error.status, 400);
        assert.equal(error.field, "url");
        assert.doesNotMatch(error.message, /secret|access_token/);
        return true;
      },
    );
    await assert.rejects(readFile(configPath, "utf8"), { code: "ENOENT" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("publicPeer never exposes URL userinfo", () => {
  const peer = publicPeer({
    id: "office",
    label: "Office",
    url: "http://user:secret@192.168.1.20:4791",
    token: "peer-token",
    enabled: true,
  });

  assert.equal(peer.url, "");
  assert.equal(peer.hasToken, true);
  assert.doesNotMatch(JSON.stringify(peer), /secret|user:secret/);
});

test("publicPeer never exposes URL query credentials", () => {
  const peer = publicPeer({
    id: "office",
    label: "Office",
    url: "http://192.168.1.20:4791?token=secret",
    token: "peer-token",
    enabled: true,
  });

  assert.equal(peer.url, "");
  assert.equal(peer.hasToken, true);
  assert.doesNotMatch(JSON.stringify(peer), /secret|token=secret/);
});
