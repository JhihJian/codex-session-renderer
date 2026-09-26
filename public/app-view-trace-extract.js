{
  const api = window.SessionWorkbench;
  const { state, els } = api;
  const escapeHtml = (...args) => api.escapeHtml(...args);
  const escapeAttr = (...args) => api.escapeAttr(...args);
  const renderMarkdownMessage = (...args) => api.renderMarkdownMessage(...args);
  const renderToolDetails = (...args) => api.renderToolDetails(...args);
function renderToolExtractBar() {
  const mode = state.toolRenderMode === "markdown" ? "markdown" : "raw";
  return `
    <div class="tool-extract-bar">
      <input class="text-input" data-tool-field-path type="text" autocomplete="off" spellcheck="false" placeholder="JSON 路径，如 .content 或 items[0].text，留空整体渲染" value="${escapeAttr(String(state.toolFieldPath || ""))}" aria-label="JSON 字段路径">
      <div class="tool-extract-modes" role="group" aria-label="内容渲染方式">
        <button type="button" data-tool-render-mode="raw" class="${mode === "raw" ? "active" : ""}">原文</button>
        <button type="button" data-tool-render-mode="markdown" class="${mode === "markdown" ? "active" : ""}">Markdown</button>
      </div>
    </div>
  `;
}

function renderToolTextBody(extractable, source, prettyText) {
  if (!extractable || state.toolRenderMode !== "markdown") {
    return `<pre>${escapeHtml(prettyText)}</pre>`;
  }
  const path = String(state.toolFieldPath || "").trim();
  const result = path ? extractJsonFieldValue(source, path) : { ok: true, value: prettyText };
  if (result.ok) {
    const value = result.value;
    return typeof value === "string"
      ? renderMarkdownMessage(value, "")
      : `<pre>${escapeHtml(value == null ? String(value) : JSON.stringify(value, null, 2))}</pre>`;
  }
  const reason = result.reason === "not-json" ? "内容不是有效 JSON" : result.reason === "empty" ? "没有可提取的内容" : `没有找到字段 ${path}`;
  const hint = result.reason === "not-found" ? jsonPathSuggestionHtml(result.root) : "";
  return `
    <p class="tool-extract-note">${escapeHtml(reason)}，已显示原文。</p>
    ${hint}
    <pre>${escapeHtml(prettyText)}</pre>
  `;
}

function jsonPathSuggestionHtml(root) {
  if (!root || typeof root !== "object" || Array.isArray(root)) return "";
  const keys = Object.keys(root).slice(0, 12);
  if (!keys.length) return "";
  return `
    <div class="tool-extract-suggest"><span>可用字段</span>${keys.map((key) => `<button type="button" data-tool-field-suggest=".${escapeAttr(key)}">${escapeHtml(key)}</button>`).join("")}</div>
  `;
}

function parseJsonPathSegments(path) {
  const normalized = String(path || "").trim().replace(/^\$/, "").replace(/^\.+/, "");
  if (!normalized) return [];
  return normalized
    .replace(/\[(\d+)\]/g, ".$1")
    .replace(/\["([^"]+)"\]/g, ".$1")
    .replace(/\['([^']+)'\]/g, ".$1")
    .split(".")
    .filter(Boolean)
    .map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment));
}

function extractJsonFieldValue(source, path) {
  const segments = parseJsonPathSegments(path);
  if (!segments.length) return { ok: false, reason: "empty" };
  let root;
  if (typeof source === "string") {
    if (!source.trim()) return { ok: false, reason: "empty" };
    try {
      root = JSON.parse(source);
    } catch {
      return { ok: false, reason: "not-json" };
    }
  } else if (source != null) {
    root = source;
  } else {
    return { ok: false, reason: "empty" };
  }
  let current = root;
  for (const segment of segments) {
    if (typeof segment === "number") {
      if (!Array.isArray(current) || segment >= current.length) {
        return { ok: false, reason: "not-found", root };
      }
      current = current[segment];
    } else {
      if (typeof current !== "object" || current === null || !(segment in current)) {
        return { ok: false, reason: "not-found", root };
      }
      current = current[segment];
    }
  }
  return { ok: true, value: current, root };
}

function bindToolExtractBar(node) {
  const input = els.toolDetailsContent.querySelector("[data-tool-field-path]");
  if (input) {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        applyToolFieldPath(node);
      }
    });
    input.addEventListener("change", () => applyToolFieldPath(node));
  }
  els.toolDetailsContent.querySelectorAll("[data-tool-render-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.toolRenderMode = button.dataset.toolRenderMode;
      renderToolDetails(node);
      els.toolDetailsContent.querySelector(`[data-tool-render-mode="${button.dataset.toolRenderMode}"]`)?.focus();
    });
  });
  els.toolDetailsContent.querySelectorAll("[data-tool-field-suggest]").forEach((button) => {
    button.addEventListener("click", () => {
      state.toolFieldPath = button.dataset.toolFieldSuggest;
      renderToolDetails(node);
      els.toolDetailsContent.querySelector("[data-tool-field-path]")?.focus();
    });
  });
}

function applyToolFieldPath(node) {
  const input = els.toolDetailsContent.querySelector("[data-tool-field-path]");
  if (!input) return;
  const nextPath = input.value;
  const cursor = Number.isInteger(input.selectionStart) ? input.selectionStart : nextPath.length;
  if (nextPath === state.toolFieldPath) return;
  state.toolFieldPath = nextPath;
  // 输入路径说明用户想提取字段，原文模式下路径没有效果，自动切到 Markdown 渲染。
  if (nextPath.trim() && state.toolRenderMode !== "markdown") state.toolRenderMode = "markdown";
  renderToolDetails(node);
  const next = els.toolDetailsContent.querySelector("[data-tool-field-path]");
  if (next) {
    next.focus();
    try {
      next.setSelectionRange(cursor, cursor);
    } catch {
      /* type=text 始终支持光标，防御性兼容 */
    }
  }
}

  Object.assign(api, { renderToolExtractBar, renderToolTextBody, jsonPathSuggestionHtml, parseJsonPathSegments, extractJsonFieldValue, bindToolExtractBar, applyToolFieldPath });
}
