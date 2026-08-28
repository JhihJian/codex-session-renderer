import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHarnessLedger } from "./harness-defect-ledger.mjs";

function createReviewContextLab(options = {}) {
  const fsApi = options.fsApi || fs;
  const rootDir = path.resolve(options.rootDir || path.join(process.cwd(), ".harness-defects"));
  const archivesDir = path.join(rootDir, "review-context-archives");
  const ledger = createHarnessLedger({ fsApi, rootDir, ledgerName: "review-context-ledger.jsonl" });
  async function state() {
    const value = { archives: [], contexts: [] };
    for (const entry of await ledger.read()) {
      if (entry.type === "review_context_archive") value.archives.push(entry.payload);
      if (entry.type === "review_context_created") value.contexts.push(entry.payload);
    }
    return value;
  }
  async function archive(input) {
    const sourcePath = path.resolve(String(input.sourcePath || ""));
    const contents = await fsApi.readFile(sourcePath);
    const sha256 = createHash("sha256").update(contents).digest("hex");
    const current = await state();
    const prior = current.archives.find((item) => item.sha256 === sha256 && item.sourceId === input.sourceId && item.sessionId === input.sessionId);
    if (prior) return prior;
    await fsApi.mkdir(archivesDir, { recursive: true });
    const archive = { id: `RA-${randomUUID()}`, sourceId: String(input.sourceId), sessionId: String(input.sessionId), sha256, archivePath: path.join(archivesDir, `${sha256}.jsonl`), createdAt: new Date().toISOString() };
    await fsApi.writeFile(archive.archivePath, contents);
    await ledger.append({ type: "review_context_archive", payload: archive });
    return archive;
  }
  async function record(input) {
    const current = await state();
    const archive = current.archives.find((item) => item.id === input.archiveId);
    if (!archive) throw new Error("复盘来源归档不存在。");
    if (current.contexts.some((item) => item.dedupeKey === input.context.dedupeKey)) return { context: current.contexts.find((item) => item.dedupeKey === input.context.dedupeKey), created: false };
    const context = { ...input.context, archiveId: archive.id, source: { sourceId: archive.sourceId, sessionId: archive.sessionId, sha256: archive.sha256 } };
    await ledger.append({ type: "review_context_created", payload: context });
    return { context, created: true };
  }
  return { archive, record, state, rootDir };
}

export { createReviewContextLab };