import { promises as fs } from "node:fs";
import path from "node:path";

// Pi 会话根路径支持 * 通配符：每个 * 只匹配一层目录名，不匹配点开头的目录。
// 通配符目录在每次列表与详情读取时重新展开，新建目录无需重启即可被发现。

function containsWildcard(pattern) {
  return typeof pattern === "string" && pattern.includes("*");
}

function wildcardStaticPrefix(pattern) {
  if (!containsWildcard(pattern)) return pattern;
  return pattern.slice(0, pattern.lastIndexOf("/", pattern.indexOf("*")) + 1);
}

function wildcardSegmentRegExp(segment) {
  const source = [...segment].map((character) => (character === "*" ? "[^/]*" : character.replace(/[.+^${}()|[\]\\]/g, `\\${character}`))).join("");
  return new RegExp(`^${source}$`);
}

async function expandWildcardDirectories(pattern, { readdir = fs.readdir, stat = fs.stat, throwIfRequestAborted = () => {}, signal } = {}) {
  const segments = pattern.replace(/\/+$/, "").split("/").slice(1);
  let frontier = ["/"];
  for (const segment of segments) {
    const next = [];
    for (const directory of frontier) {
      throwIfRequestAborted(signal);
      if (segment.includes("*")) next.push(...(await matchWildcardSegment(readdir, directory, segment)));
      else if (await isDirectory(stat, path.join(directory, segment))) next.push(path.join(directory, segment));
    }
    next.sort();
    if (!next.length) return [];
    frontier = next;
  }
  return frontier;
}

async function matchWildcardSegment(readdir, directory, segment) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const matcher = wildcardSegmentRegExp(segment);
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && matcher.test(entry.name))
    .map((entry) => path.join(directory, entry.name));
}

async function isDirectory(stat, candidate) {
  const candidateStat = await stat(candidate).catch(() => null);
  return Boolean(candidateStat?.isDirectory());
}

export { containsWildcard, expandWildcardDirectories, wildcardSegmentRegExp, wildcardStaticPrefix };
