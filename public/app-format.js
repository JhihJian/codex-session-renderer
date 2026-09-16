(function () {
  function firstLine(text, max = 120) {
    const normalized = String(text || "").replace(/\s+/g, " ").trim();
    return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
  }

  function highlight(html, query) {
    if (!query) return html;
    const escaped = escapeRegExp(query);
    return String(html).replace(new RegExp(`(${escaped})`, "gi"), "<mark>$1</mark>");
  }

  function highlightHtmlText(html, query) {
    if (!query) return html;
    const escaped = escapeRegExp(query);
    const re = new RegExp(`(${escaped})`, "gi");
    return String(html)
      .split(/(<[^>]+>)/g)
      .map((part) => (part.startsWith("<") ? part : part.replace(re, "<mark>$1</mark>")))
      .join("");
  }

  function prettyMaybeJson(value) {
    if (typeof value !== "string") return JSON.stringify(value, null, 2);
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }

  function normalizeMarkdownForRendering(value) {
    return trimPartialClosingMarkdownFence(String(value || "").replace(/\t/g, "   "));
  }

  function trimPartialClosingMarkdownFence(value) {
    const text = String(value || "");
    if (!text) return text;
    const lastLineStart = text.lastIndexOf("\n") + 1;
    if (lastLineStart <= 0) return text;
    const lastLine = text.slice(lastLineStart).replace(/\r$/, "");
    const partialMarker = /^( {0,3})([`~]+)$/.exec(lastLine);
    if (!partialMarker) return text;

    const openFence = lastOpenMarkdownFence(text.slice(0, lastLineStart));
    if (!openFence || openFence.char !== partialMarker[2][0] || partialMarker[2].length >= openFence.length) {
      return text;
    }

    return text.slice(0, lastLineStart).replace(/\r?\n$/, "");
  }

  function lastOpenMarkdownFence(text) {
    const lines = String(text || "").split(/\n/);
    let openFence = null;
    for (const rawLine of lines) {
      const line = rawLine.replace(/\r$/, "");
      const opening = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line);
      if (!opening) continue;
      const marker = opening[2];
      const char = marker[0];
      if (!openFence) {
        openFence = { char, length: marker.length };
        continue;
      }
      if (char === openFence.char && marker.length >= openFence.length && new RegExp(`^ {0,3}\\${char}{${openFence.length},}\\s*$`).test(line)) {
        openFence = null;
      }
    }
    return openFence;
  }

  function formatDate(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  function formatShortDate(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }

  function compactNumber(value) {
    const number = Number(value || 0);
    if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(1)}M`;
    if (number >= 1_000) return `${(number / 1_000).toFixed(1)}K`;
    return String(number);
  }

  function sessionTimeMs(session) {
    for (const value of [session?.updatedAt, session?.fileModifiedAt, session?.startedAt]) {
      if (!value) continue;
      const time = new Date(value).getTime();
      if (Number.isFinite(time)) return time;
    }
    return null;
  }

  function sessionTimeBucket(session, nowMs = Date.now()) {
    const timestamp = sessionTimeMs(session);
    if (timestamp == null) return "earlier";
    const ageMs = Math.max(0, Number(nowMs) - timestamp);
    if (ageMs < 3 * 60 * 60 * 1000) return "realtime";
    if (ageMs < 24 * 60 * 60 * 1000) return "day";
    return "earlier";
  }

  function sessionChainTimeMs(session) {
    for (const value of [session?.startedAt, session?.updatedAt, session?.fileModifiedAt]) {
      if (!value) continue;
      const time = new Date(value).getTime();
      if (Number.isFinite(time)) return time;
    }
    return 0;
  }

  function nestSessionChains(sessions) {
    const rows = sessions.map((session) => ({ session, depth: 0 }));
    const byId = new Map(sessions.map((session) => [session.id, session]));
    const childrenOf = new Map();
    for (const session of sessions) {
      const parent = session.parentSessionId ? byId.get(session.parentSessionId) : null;
      if (!parent || parent.id === session.id) continue;
      if (!childrenOf.has(parent.id)) childrenOf.set(parent.id, []);
      childrenOf.get(parent.id).push(session);
    }
    if (childrenOf.size === 0) return rows;
    for (const children of childrenOf.values()) {
      children.sort((left, right) => sessionChainTimeMs(left) - sessionChainTimeMs(right));
    }
    const emitted = new Set();
    const ordered = [];
    const walk = (session, depth) => {
      if (emitted.has(session.id)) return;
      emitted.add(session.id);
      ordered.push({ session, depth });
      for (const child of childrenOf.get(session.id) || []) walk(child, depth + 1);
    };
    for (const session of sessions) {
      const parent = session.parentSessionId ? byId.get(session.parentSessionId) : null;
      if (parent && parent.id !== session.id) continue;
      walk(session, 0);
    }
    for (const session of sessions) walk(session, 0);
    return ordered;
  }

  function buildSessionDirectoryTree(sessions) {
    const root = createDirectoryNode({ path: "", label: "" });
    const projectless = createDirectoryNode({ path: "__projectless__", label: "无项目", projectless: true });
    let hasProjectless = false;
    for (const session of sessions || []) {
      const directory = normalizeDirectoryPath(session?.cwd);
      if (!directory) {
        projectless.sessions.push(session);
        hasProjectless = true;
        continue;
      }
      let node = root;
      for (const segment of directory.segments) {
        const nextPath = node.path ? `${node.path}/${segment}` : segment;
        let child = node.children.get(nextPath);
        if (!child) {
          child = createDirectoryNode({ path: nextPath, label: segment });
          node.children.set(nextPath, child);
        }
        node = child;
      }
      node.sessions.push(session);
    }
    finalizeDirectoryNode(root);
    if (hasProjectless) finalizeDirectoryNode(projectless);
    const nodes = [...root.children.values()];
    if (hasProjectless) nodes.push(projectless);
    return nodes;
  }

  function createDirectoryNode({ path, label, projectless = false }) {
    return { path, label, projectless, children: new Map(), sessions: [], sessionCount: 0, latestTime: 0 };
  }

  function normalizeDirectoryPath(value) {
    const raw = String(value || "").trim().replace(/^\\\\\?\\/, "").replaceAll("\\", "/");
    if (!raw) return null;
    const isAbsolute = raw.startsWith("/");
    const segments = raw.split("/").filter(Boolean);
    if (!segments.length) return null;
    if (isAbsolute) segments[0] = `/${segments[0]}`;
    return { segments };
  }

  function finalizeDirectoryNode(node) {
    let count = node.sessions.length;
    let latestTime = Math.max(0, ...node.sessions.map(sessionTimeMs).filter(Number.isFinite));
    for (const child of node.children.values()) {
      finalizeDirectoryNode(child);
      count += child.sessionCount;
      latestTime = Math.max(latestTime, child.latestTime);
    }
    node.sessionCount = count;
    node.latestTime = latestTime;
    node.children = [...node.children.values()].sort(compareDirectoryNodes);
  }

  function compareDirectoryNodes(left, right) {
    if (left.projectless !== right.projectless) return left.projectless ? 1 : -1;
    return right.latestTime - left.latestTime || left.label.localeCompare(right.label, "zh-CN");
  }

  function shortPath(value) {
    const text = String(value || "");
    const parts = text.replace(/^\\\\\?\\/, "").split(/[\\/]+/).filter(Boolean);
    if (parts.length <= 3) return text;
    return `${parts[0]}/${parts[1]}/…/${parts.at(-1)}`;
  }

  function sanitizeFileName(value) {
    const invalidCharacters = '<>:"/\\|?*';
    return Array.from(String(value), (character) => {
      const codePoint = character.codePointAt(0);
      return codePoint <= 0x1f || invalidCharacters.includes(character) ? "_" : character;
    }).join("").slice(0, 120);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replaceAll("'", "&#39;");
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function cssEscape(value, css = globalThis.CSS) {
    if (css?.escape) return css.escape(value);
    return String(value).replace(/["\\]/g, "\\$&");
  }

  const api = {
    buildSessionDirectoryTree,
    compactNumber,
    cssEscape,
    escapeAttr,
    escapeHtml,
    escapeRegExp,
    firstLine,
    formatBytes,
    formatDate,
    formatShortDate,
    highlight,
    highlightHtmlText,
    nestSessionChains,
    normalizeMarkdownForRendering,
    prettyMaybeJson,
    sanitizeFileName,
    sessionTimeBucket,
    sessionTimeMs,
    shortPath,
    trimPartialClosingMarkdownFence,
  };

  globalThis.AppFormat = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
