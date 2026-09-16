import test from "node:test";
import assert from "node:assert/strict";
import MarkdownIt from "markdown-it";
import "../public/app-format.js";

const {
  buildSessionDirectoryTree,
  compactNumber,
  cssEscape,
  escapeAttr,
  escapeHtml,
  firstLine,
  formatBytes,
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

test("markdown normalization trims streamed partial closing fences", () => {
  assert.equal(normalizeMarkdownForRendering("A\tB"), "A   B");
  assert.equal(trimPartialClosingMarkdownFence("```js\nconsole.log(1)\n``"), "```js\nconsole.log(1)");
  assert.equal(trimPartialClosingMarkdownFence("````js\nconsole.log(1)\n```"), "````js\nconsole.log(1)");
  assert.equal(trimPartialClosingMarkdownFence("```js\nconsole.log(1)\n```"), "```js\nconsole.log(1)\n```");
  assert.equal(trimPartialClosingMarkdownFence("not a code block\n``"), "not a code block\n``");

  const markdown = new MarkdownIt({ html: false, linkify: true, breaks: false });
  const html = markdown.render(normalizeMarkdownForRendering("```js\nconsole.log(1)\n``"));
  assert.equal(html.includes("``</code>"), false);
  assert.match(html, /console\.log\(1\)/);
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

test("nestSessionChains nests fork chains under visible parents in fork order", () => {
  const session = (id, parentSessionId, startedAt) => ({ id, parentSessionId, startedAt, updatedAt: startedAt });
  const rows = nestSessionChains([
    session("grandchild", "child", "2026-09-14T03:00:00.000Z"),
    session("root", null, "2026-09-14T01:00:00.000Z"),
    session("child", "root", "2026-09-14T02:00:00.000Z"),
  ]);
  assert.deepEqual(
    rows.map((row) => [row.session.id, row.depth]),
    [
      ["root", 0],
      ["child", 1],
      ["grandchild", 2],
    ],
  );
});

test("nestSessionChains treats orphans, self references and cycles as roots", () => {
  const session = (id, parentSessionId) => ({ id, parentSessionId, startedAt: `2026-09-14T0${id.length}:00:00.000Z` });
  const rows = nestSessionChains([
    session("orphan", "missing-parent"),
    session("self", "self"),
    session("a", "b"),
    session("b", "a"),
  ]);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((row) => row.depth), [0, 0, 0, 1]);
  assert.deepEqual(rows.map((row) => row.session.id), ["orphan", "self", "a", "b"]);
});

test("nestSessionChains keeps flat rows when no parent links resolve", () => {
  const rows = nestSessionChains([{ id: "one" }, { id: "two" }]);
  assert.deepEqual(rows.map((row) => row.depth), [0, 0]);
});

test("buildSessionDirectoryTree keeps project paths hierarchical and projectless sessions separate", () => {
  const sessions = [
    { id: "alpha", cwd: "/data/dev/alpha", updatedAt: "2026-09-16T01:00:00.000Z" },
    { id: "beta", cwd: "/data/dev/beta/", updatedAt: "2026-09-16T03:00:00.000Z" },
    { id: "windows", cwd: "C:\\work\\tools", updatedAt: "2026-09-16T02:00:00.000Z" },
    { id: "none", cwd: "", updatedAt: "2026-09-16T04:00:00.000Z" },
  ];
  const tree = buildSessionDirectoryTree(sessions);

  assert.deepEqual(tree.map((node) => [node.label, node.sessionCount]), [["/data", 2], ["C:", 1], ["无项目", 1]]);
  const dev = tree[0].children[0];
  assert.equal(dev.label, "dev");
  assert.deepEqual(dev.children.map((node) => [node.label, node.sessions[0].id]), [["beta", "beta"], ["alpha", "alpha"]]);
  assert.equal(tree.at(-1).projectless, true);
  assert.equal(tree.at(-1).sessions[0].id, "none");
});
