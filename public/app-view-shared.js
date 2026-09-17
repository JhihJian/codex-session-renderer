{
  const api = window.SessionWorkbench;
  const { els, markdownCache, markdownRenderer, markdownCacheLimit } = api;
  const sensitiveCopyToast = (...args) => api.sensitiveCopyToast(...args);
  const localizeErrorText = (...args) => api.localizeErrorText(...args);
  const escapeHtml = (...args) => api.escapeHtml(...args);
  const escapeAttr = (...args) => api.escapeAttr(...args);
  const highlightHtmlText = (...args) => api.highlightHtmlText(...args);
  const normalizeMarkdownForRendering = (...args) => api.normalizeMarkdownForRendering(...args);
async function handleMarkdownCodeCopy(event) {
  const button = event.target.closest("[data-markdown-code-copy]");
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  const code = button.closest(".markdown-code-frame")?.querySelector("pre code")?.textContent || "";
  if (!code) {
    showToast("没有可复制代码");
    return;
  }
  const copied = await copyWithToast(code, sensitiveCopyToast("已复制代码"));
  if (!copied) return;
  const originalText = button.textContent;
  button.textContent = "已复制";
  button.disabled = true;
  setTimeout(() => {
    button.textContent = originalText || "复制";
    button.disabled = false;
  }, 1200);
}

async function copyWithToast(text, successMessage) {
  try {
    await copyText(String(text));
    showToast(successMessage);
    return true;
  } catch (error) {
    console.warn("复制到剪贴板失败", error);
    showToast(`复制失败：${errorTextFromError(error)}`);
    return false;
  }
}

async function copyWithToastWhileCurrent(text, successMessage, isCurrent) {
  try {
    await copyText(String(text));
    if (!isCurrent()) return false;
    showToast(successMessage);
    return true;
  } catch (error) {
    if (!isCurrent()) return false;
    console.warn("复制到剪贴板失败", error);
    showToast(`复制失败：${errorTextFromError(error)}`);
    return false;
  }
}

async function copyText(text) {
  const value = String(text);
  const errors = [];
  if (navigator.clipboard?.writeText) {
    try {
      await clipboardWriteTextWithTimeout(value);
      return;
    } catch (error) {
      errors.push({ method: "navigator.clipboard.writeText", error });
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  try {
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, value.length);
    if (typeof document.execCommand !== "function") {
      throw new Error("document.execCommand 不可用");
    }
    const copied = document.execCommand("copy");
    if (!copied) throw new Error("document.execCommand 返回 false");
  } catch (error) {
    errors.push({ method: "document.execCommand", error });
    console.warn("复制通道均失败", errors);
    throw new Error("请允许浏览器访问剪贴板，或手动选中文本复制。");
  } finally {
    textarea.remove();
  }
}

function clipboardWriteTextWithTimeout(value, timeoutMs = 800) {
  return Promise.race([
    navigator.clipboard.writeText(value),
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error("浏览器剪贴板响应超时")), timeoutMs);
    }),
  ]);
}

function errorTextFromError(error) {
  return localizeErrorText(error?.message || String(error || "未知错误"));
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove("show"), 2200);
}

function emptyState(title, subtitle, action = "") {
  return `<div class="empty-state"><div><strong>${escapeHtml(title)}</strong><br /><span>${escapeHtml(subtitle)}</span>${action}</div></div>`;
}

function renderMarkdownFence(tokens, index, options) {
  const token = tokens[index];
  const info = String(token.info || "").trim();
  const language = markdownFenceLanguage(info);
  const languageClass = language ? ` class="${escapeAttr(`${options?.langPrefix || "language-"}${language}`)}"` : "";
  const label = language || "代码";
  return `
    <div class="markdown-code-frame">
      <div class="markdown-code-head">
        <span>${escapeHtml(label)}</span>
        <button class="markdown-code-copy" type="button" data-markdown-code-copy title="复制代码">复制</button>
      </div>
      <pre><code${languageClass}>${escapeHtml(token.content || "")}</code></pre>
    </div>
  `;
}

function markdownFenceLanguage(info) {
  const firstWord = String(info || "").split(/\s+/)[0] || "";
  return firstWord.replace(/[^\w.+#-]/g, "").slice(0, 40);
}

function renderMarkdownMessage(text, query) {
  const html = markdownToHtml(text);
  return `<div class="message-text markdown-body">${highlightHtmlText(html, query)}</div>`;
}

function renderMarkdownTitle(text, query = "") {
  const html = markdownInlineToHtml(text);
  return highlightHtmlText(html, query);
}

function renderDetailValue(key, value) {
  const text = value || "";
  if (key === "标题") return `<span class="markdown-inline-title">${renderMarkdownTitle(text)}</span>`;
  return escapeHtml(text);
}

function renderSubagentMiniTitle(thread) {
  const parts = [];
  if (thread.agentRole) parts.push(escapeHtml(thread.agentRole));
  if (thread.title) parts.push(`<span class="markdown-inline-title">${renderMarkdownTitle(thread.title)}</span>`);
  return parts.join(" · ") || "";
}

function markdownToHtml(value) {
  const text = normalizeMarkdownForRendering(value);
  const key = `block:${text}`;
  const cached = markdownCache.get(key);
  if (cached != null) return cached;
  const html = markdownRenderer ? markdownRenderer.render(text) : `<p>${escapeHtml(text).replace(/\n/g, "<br />")}</p>`;
  setMarkdownCache(key, html);
  return html;
}

function markdownInlineToHtml(value) {
  const text = normalizeMarkdownForRendering(value);
  const key = `inline:${text}`;
  const cached = markdownCache.get(key);
  if (cached != null) return cached;
  const html = markdownRenderer ? markdownRenderer.renderInline(text) : escapeHtml(text);
  setMarkdownCache(key, html);
  return html;
}

function setMarkdownCache(key, html) {
  markdownCache.set(key, html);
  if (markdownCache.size > markdownCacheLimit) {
    const firstKey = markdownCache.keys().next().value;
    markdownCache.delete(firstKey);
  }
  return html;
}

window.SessionWorkbench.renderMarkdownFence = renderMarkdownFence;

  Object.assign(api, { handleMarkdownCodeCopy, copyWithToast, copyWithToastWhileCurrent, copyText, clipboardWriteTextWithTimeout, errorTextFromError, showToast, emptyState, renderMarkdownFence, markdownFenceLanguage, renderMarkdownMessage, renderMarkdownTitle, renderDetailValue, renderSubagentMiniTitle, markdownToHtml, markdownInlineToHtml, setMarkdownCache });
}
