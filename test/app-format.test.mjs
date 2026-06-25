import test from "node:test";
import assert from "node:assert/strict";
import "../public/app-format.js";

const {
  compactNumber,
  cssEscape,
  escapeAttr,
  escapeHtml,
  firstLine,
  formatBytes,
  highlight,
  highlightHtmlText,
  prettyMaybeJson,
  sanitizeFileName,
  sessionTimeBucket,
  sessionTimeMs,
  shortPath,
} = globalThis.AppFormat;

test("format helpers keep compact display text stable", () => {
  assert.equal(firstLine(" 第一行\n第二行 ", 20), "第一行 第二行");
  assert.equal(firstLine("abcdef", 4), "abc…");
  assert.equal(formatBytes(1024), "1.0 KB");
  assert.equal(formatBytes(1024 * 1024), "1.0 MB");
  assert.equal(compactNumber(1200), "1.2K");
  assert.equal(compactNumber(1_500_000), "1.5M");
});

test("escape and highlight helpers avoid corrupting markup", () => {
  assert.equal(escapeHtml('<a title="x">'), "&lt;a title=&quot;x&quot;&gt;");
  assert.equal(escapeAttr("Bob's <tag>"), "Bob&#39;s &lt;tag&gt;");
  assert.equal(highlight("a+b A+B", "a+b"), "<mark>a+b</mark> <mark>A+B</mark>");
  assert.equal(highlightHtmlText("<p>hello link</p>", "p"), "<p>hello link</p>");
  assert.equal(highlightHtmlText("<p>hello link</p>", "link"), "<p>hello <mark>link</mark></p>");
  assert.equal(
    highlightHtmlText('<a href="https://example.com">example link</a>', "example"),
    '<a href="https://example.com"><mark>example</mark> link</a>',
  );
});

test("path, filename and JSON helpers handle local diagnostics", () => {
  assert.equal(shortPath("\\\\?\\D:\\github\\codex-session-renderer\\public\\app.js"), "D:/github/…/app.js");
  assert.equal(sanitizeFileName('bad<>:"/\\|?*\x00name.md'), "bad__________name.md");
  assert.equal(prettyMaybeJson('{"a":1}'), '{\n  "a": 1\n}');
  assert.equal(prettyMaybeJson("not json"), "not json");
  assert.equal(cssEscape('a"b\\c', null), 'a\\"b\\\\c');
});

test("session time helpers classify list buckets by recency", () => {
  const now = new Date("2026-06-25T12:00:00.000Z").getTime();

  assert.equal(sessionTimeMs({ updatedAt: "2026-06-25T10:00:00.000Z" }), new Date("2026-06-25T10:00:00.000Z").getTime());
  assert.equal(sessionTimeBucket({ updatedAt: "2026-06-25T09:30:00.000Z" }, now), "realtime");
  assert.equal(sessionTimeBucket({ updatedAt: "2026-06-25T08:59:59.000Z" }, now), "day");
  assert.equal(sessionTimeBucket({ updatedAt: "2026-06-24T12:30:00.000Z" }, now), "day");
  assert.equal(sessionTimeBucket({ updatedAt: "2026-06-24T11:59:59.000Z" }, now), "earlier");
  assert.equal(sessionTimeBucket({}, now), "earlier");
});
