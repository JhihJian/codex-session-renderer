import path from "node:path";
import { sessionIdFromFile } from "./text-utils.mjs";

function sessionFileRoots(codexHome, sessionsRoot = path.join(codexHome || "", "sessions")) {
  const roots = [];
  if (sessionsRoot) roots.push({ root: sessionsRoot, archived: false });
  if (codexHome) roots.push({ root: path.join(codexHome, "archived_sessions"), archived: true });
  return roots;
}

function dedupeSessionFileRecords(records) {
  const byId = new Map();
  for (const record of records) {
    if (!record?.filePath) continue;
    const id = record.id || sessionIdFromFile(record.filePath);
    const candidate = { ...record, id };
    const previous = byId.get(id);
    if (!previous || compareSessionFileRecord(candidate, previous) > 0) byId.set(id, candidate);
  }
  return [...byId.values()];
}

function compareSessionFileRecord(left, right) {
  const leftLiveRank = left.archived ? 0 : 1;
  const rightLiveRank = right.archived ? 0 : 1;
  if (leftLiveRank !== rightLiveRank) return leftLiveRank - rightLiveRank;
  const leftMtime = Number(left.stat?.mtimeMs ?? left.mtimeMs ?? 0);
  const rightMtime = Number(right.stat?.mtimeMs ?? right.mtimeMs ?? 0);
  if (leftMtime !== rightMtime) return leftMtime - rightMtime;
  return String(right.filePath || "").localeCompare(String(left.filePath || ""));
}

export {
  dedupeSessionFileRecords,
  sessionFileRoots,
};
