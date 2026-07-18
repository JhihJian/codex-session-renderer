import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readJsonl, readJsonlLine, readJsonlLineWithDiagnostics, readJsonlRange, readJsonlWithDiagnostics } from "../src/jsonl-reader.mjs";

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

test("readJsonlWithDiagnostics preserves invalid rows as diagnostic events", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-jsonl-diag-"));
  try {
    const file = path.join(dir, "sample.jsonl");
    await writeFile(file, '{"id":1}\nnot-json\n{"id":2}\n', "utf8");

    const events = await readJsonlWithDiagnostics(file);

    assert.equal(events.length, 3);
    assert.deepEqual(events[0], { id: 1 });
    assert.equal(events[1].type, "jsonl_parse_error");
    assert.equal(events[1].lineNumber, 2);
    assert.equal(events[1].payload.preview, "not-json");
    assert.deepEqual(events[2], { id: 2 });
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

test("readJsonlLine applies its independent logical scan boundary", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-jsonl-line-limit-"));
  try {
    const file = path.join(dir, "sample.jsonl");
    await writeFile(file, '{"id":"first"}\n{"id":"second"}\n{"id":"third"}\n', "utf8");

    assert.equal(await readJsonlLine(file, 2, { maxScan: 2 }), null);
    assert.deepEqual(await readJsonlLine(file, 2, { maxScan: 3 }), { id: "third" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readJsonlLineWithDiagnostics returns invalid row diagnostics by logical index", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-jsonl-line-diag-"));
  try {
    const file = path.join(dir, "sample.jsonl");
    await writeFile(file, '{"id":"first"}\nnot-json\n', "utf8");

    const event = await readJsonlLineWithDiagnostics(file, 1);

    assert.equal(event.type, "jsonl_parse_error");
    assert.equal(event.payload.lineNumber, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readJsonlRange reads incremental events by logical cursor", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-jsonl-range-"));
  try {
    const file = path.join(dir, "sample.jsonl");
    await writeFile(file, '{"kind":"skip"}\n{"kind":"keep","id":1}\nnot-json\n{"kind":"keep","id":2}\n{"kind":"keep","id":3}\n', "utf8");

    const range = await readJsonlRange(file, {
      start: 1,
      limit: 2,
      maxScan: 3,
      predicate: (event) => event.kind === "keep",
    });

    assert.deepEqual(range.items, [
      { index: 1, event: { kind: "keep", id: 1 } },
      { index: 3, event: { kind: "keep", id: 2 } },
    ]);
    assert.equal(range.scanned, 3);
    assert.equal(range.nextCursor, 4);
    assert.equal(range.exhausted, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readJsonlRange can include invalid row diagnostics in incremental scans", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "csr-jsonl-range-diag-"));
  try {
    const file = path.join(dir, "sample.jsonl");
    await writeFile(file, '{"kind":"keep","id":1}\nnot-json\n{"kind":"keep","id":2}\n', "utf8");

    const range = await readJsonlRange(file, {
      start: 0,
      limit: 3,
      maxScan: 3,
      includeInvalid: true,
    });

    assert.equal(range.items.length, 3);
    assert.equal(range.items[1].index, 1);
    assert.equal(range.items[1].event.type, "jsonl_parse_error");
    assert.equal(range.nextCursor, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
