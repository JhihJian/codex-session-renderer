import assert from "node:assert/strict";
import { appendFile, mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createLiveSessionStreamService } from "../src/live-session-stream.mjs";
import { readCommittedJsonlChunk } from "../src/jsonl-tail-reader.mjs";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function responseCapture() {
  return {
    destroyed: false,
    writableEnded: false,
    text: "",
    writeHead() {},
    flushHeaders() {},
    write(chunk) {
      this.text += String(chunk);
      return true;
    },
  };
}

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (predicate()) return;
    await delay(80);
  }
  assert.fail(message);
}

test("committed JSONL reader keeps an unfinished tail pending", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "csr-live-tail-"));
  const filePath = path.join(root, "session.jsonl");
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(filePath, '{"type":"message"}', "utf8");

  const pending = await readCommittedJsonlChunk(filePath, { endOffset: (await stat(filePath)).size });
  assert.equal(pending.events.length, 0);
  assert.equal(pending.committedByteOffset, 0);

  await appendFile(filePath, "\n", "utf8");
  const committed = await readCommittedJsonlChunk(filePath, { endOffset: (await stat(filePath)).size });
  assert.equal(committed.events.length, 1);
  assert.equal(committed.events[0].type, "message");
});

test("live stream appends completed records and resets after replacement", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "csr-live-stream-"));
  const filePath = path.join(root, "session.jsonl");
  const replacementPath = path.join(root, "replacement.jsonl");
  const id = "33333333-3333-4333-8333-333333333333";
  const session = { id, path: filePath };
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(filePath, '{"type":"event_msg","payload":{"type":"agent_message","message":"半写"}', "utf8");

  const service = createLiveSessionStreamService({
    getSessionById: async () => session,
    sessionFileExists: async () => true,
    sessionFileStat: async () => stat(filePath),
  });
  const controller = new AbortController();
  const response = responseCapture();
  const pending = service.streamSession({ source: { id: "test" } }, id, response, { signal: controller.signal });
  await waitFor(() => response.text.includes("event: snapshot"), "stream did not send its snapshot");
  assert.doesNotMatch(response.text, /半写/);

  await appendFile(filePath, "}\n", "utf8");
  await waitFor(() => response.text.includes("event: append"), "stream did not append the completed record");
  assert.match(response.text, /半写/);

  await writeFile(replacementPath, '{"type":"event_msg","payload":{"type":"agent_message","message":"替换后"}}\n', "utf8");
  await rename(replacementPath, filePath);
  await waitFor(() => response.text.includes("event: reset") && response.text.includes("替换后"), "stream did not reset after file replacement");
  controller.abort();
  await pending;
});