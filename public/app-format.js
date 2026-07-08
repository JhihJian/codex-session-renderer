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

  function shortPath(value) {
    const text = String(value || "");
    const parts = text.replace(/^\\\\\?\\/, "").split(/[\\/]+/).filter(Boolean);
    if (parts.length <= 3) return text;
    return `${parts[0]}/${parts[1]}/…/${parts.at(-1)}`;
  }

  function sanitizeFileName(value) {
    return String(value).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 120);
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
