import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readJsonl, readJsonlLine } from "../src/jsonl-reader.mjs";

test("readJsonl skips invalid rows and respects maxLines", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-jsonl-"));
  try {
    const file = path.join(dir, "sample.jsonl");
    await writeFile(file, '{"id":1}\nnot-json\n{"id":2}\n{"id":3}\n', "utf8");

    assert.deepEqual(await readJsonl(file, { maxLines: 2 }), [{ id: 1 }, { id: 2 }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readJsonlLine returns a parsed non-empty JSONL row by logical index", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-jsonl-line-"));
  try {
    const file = path.join(dir, "sample.jsonl");
    await writeFile(file, '\n{"id":"first"}\n{"id":"second"}\n', "utf8");

    assert.deepEqual(await readJsonlLine(file, 1), { id: "second" });
    assert.equal(await readJsonlLine(file, 8), null);
    assert.equal(await readJsonlLine(file, -1), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
