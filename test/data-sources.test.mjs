import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDataSourceRegistry, parsePiAgentDefinition } from "../src/data-sources.mjs";

test("createDataSourceRegistry only exposes the local Codex source by default", () => {
  const registry = createDataSourceRegistry({ env: { CODEX_HOME: "/tmp/codex-home" }, homeDir: "/home/user" });

  assert.deepEqual(
    registry.listSources().map((source) => [source.id, source.kind, source.isDefault]),
    [["local", "local", true]],
  );
  assert.equal(registry.getDefaultSource().codexHome, path.resolve("/tmp/codex-home"));
  assert.equal(registry.getSource("unknown"), null);
});

test("createDataSourceRegistry prefers an available local Pi Agent source", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-pi-source-"));
  try {
    const sessionsRoot = path.join(dir, ".pi", "agent", "sessions");
    await mkdir(sessionsRoot, { recursive: true });
    const registry = createDataSourceRegistry({ env: { CODEX_HOME: path.join(dir, ".codex"), PI_AGENT_SESSIONS_ROOT: sessionsRoot }, homeDir: dir });

    assert.equal(registry.getDefaultSource().id, "pi-agent");
    assert.deepEqual(registry.listSources().map(({ id, kind, isDefault }) => [id, kind, isDefault]), [["local", "local", false], ["pi-agent", "pi-agent", true]]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("parsePiAgentDefinition only auto-detects an existing session root", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-pi-detect-"));
  try {
    assert.equal(parsePiAgentDefinition({}, dir), null);
    const sessionsRoot = path.join(dir, ".pi", "agent", "sessions");
    await mkdir(sessionsRoot, { recursive: true });
    assert.deepEqual(parsePiAgentDefinition({}, dir), { agentHome: path.dirname(sessionsRoot), sessionsRoot, autoDetected: true });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});