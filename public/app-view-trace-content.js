{
  const api = window.SessionWorkbench;
  const { state } = api;
  const formatDate = (...args) => api.formatDate(...args);
  const shortPath = (...args) => api.shortPath(...args);
  const escapeHtml = (...args) => api.escapeHtml(...args);
  const itemTitle = (...args) => api.itemTitle(...args);
  const itemIcon = (...args) => api.itemIcon(...args);
  const itemRef = (...args) => api.itemRef(...args);
  const escapeAttr = (...args) => api.escapeAttr(...args);
  const renderMarkdownMessage = (...args) => api.renderMarkdownMessage(...args);
  const renderCompactContextMeta = (...args) => api.renderCompactContextMeta(...args);
  const prettyMaybeJson = (...args) => api.prettyMaybeJson(...args);
  const highlight = (...args) => api.highlight(...args);
  const findTraceNode = (...args) => api.findTraceNode(...args);
  const renderTrace = (...args) => api.renderTrace(...args);
  const renderToolDetails = (...args) => api.renderToolDetails(...args);
  const findItemByRef = (...args) => api.findItemByRef(...args);
function itemMatches(item, query, typeFilter) {
  const haystack = JSON.stringify(item).toLowerCase();
  if (query && !haystack.includes(query)) return false;
  if (typeFilter === "message") return item.type === "user-message" || item.type === "assistant-message";
  if (typeFilter === "tool") return item.type === "tool-call" || item.type === "response-item";
  if (typeFilter === "output") return item.type === "tool-output" || (item.type === "tool-call" && item.output);
  if (typeFilter === "reasoning") return item.type === "reasoning";
  if (typeFilter === "compact") return item.type === "context-compact";
  if (typeFilter === "system") return item.type === "event" || item.type === "token-count" || item.type === "context-compact";
  if (typeFilter === "error") return /error|failed|失败|错误/i.test(haystack);
  return true;
}

function renderTurn(turn, index, query) {
  const meta = [turn.status, formatDate(turn.startedAt), turn.cwd ? shortPath(turn.cwd) : ""].filter(Boolean).join(" · ");
  return `
    <article class="turn">
      <div class="turn-header">
        <strong>第 ${index} 轮</strong>
        <span>${escapeHtml(meta)}</span>
      </div>
      <div class="turn-body">
        ${turn.items.map((item) => renderItem(item, query)).join("")}
      </div>
    </article>
  `;
}

function renderItem(item, query) {
  const title = itemTitle(item);
  const icon = itemIcon(item);
  const meta = [formatDate(item.timestamp), item.phase, item.status].filter(Boolean).join(" · ");
  const ref = itemRef(item);
  const selected = state.selectedItemRef === ref ? " selected" : "";
  return `
    <section class="item ${escapeAttr(item.type)}${selected}" role="button" tabindex="0" data-item-ref="${escapeAttr(ref)}">
      <div class="item-header">
        <div class="item-title">
          <span class="item-icon">${icon}</span>
          <span>${escapeHtml(title)}</span>
        </div>
        <span class="item-meta">${escapeHtml(meta)}</span>
      </div>
      <div class="item-content">
        ${renderItemContent(item, query)}
      </div>
    </section>
  `;
}

function renderItemContent(item, query) {
  if (item.type === "user-message" || item.type === "assistant-message") {
    return renderMarkdownMessage(item.text, query);
  }
  if (item.type === "context-compact") {
    return `
      ${renderCompactContextMeta(item.compact || {})}
      ${item.text ? renderMarkdownMessage(item.text, query) : `<div class="compact-missing">压缩完成事件没有携带摘要正文。</div>`}
      ${renderTruncationNotice(item, ["text", "payload"])}
    `;
  }
  if (item.type === "reasoning") {
    const text = item.text || (item.encrypted ? "推理内容已加密存储，当前没有可展示的明文摘要。" : "无摘要。");
    return renderMarkdownMessage(text, query);
  }
  if (item.type === "tool-call") {
    const args = item.arguments == null ? "" : prettyMaybeJson(item.arguments);
    const output = item.output == null ? "" : String(item.output);
    return `
      <div class="tool-grid">
        <div>
          <p class="tool-label">调用</p>
          <pre class="json-block">${highlight(escapeHtml(args || item.name || ""), query)}</pre>
        </div>
        ${
          output
            ? `<div><p class="tool-label">输出</p><pre class="code-block">${highlight(escapeHtml(output), query)}</pre></div>`
            : ""
        }
      </div>
      ${renderTruncationNotice(item, ["arguments", "output"])}
    `;
  }
  if (item.type === "tool-output") {
    return `<pre class="code-block">${highlight(escapeHtml(String(item.output || "")), query)}</pre>${renderTruncationNotice(item, ["output"])}`;
  }
  const fallback = item.payloadPreview || JSON.stringify(item.info || item, null, 2);
  return `<pre class="json-block">${highlight(escapeHtml(fallback), query)}</pre>${renderTruncationNotice(item, ["payload"])}`;
}

function terminalVisibleFieldsForBlock(block) {
  if (block.role === "user" || block.role === "assistant") return ["text"];
  if (block.role === "tool") return ["arguments"];
  if (block.role === "output" || block.role === "error") return ["output"];
  return ["text", "arguments", "output", "payload"];
}

function renderTruncationNotice(item, visibleFields = null) {
  if (!item.truncated) return "";
  const fields = item.truncatedFields?.filter((field) => !visibleFields || visibleFields.includes(field)) || [];
  if (!fields.length) return "";
  return `<div class="truncation-notice">已截断 ${escapeHtml(fields.join(", "))}，完整内容可在原始事件视图中按需查看。</div>`;
}

async function selectRawEvent(index) {
  state.selectedTraceNodeId = null;
  state.selectedItemRef = null;
  state.selectedTerminalBlockId = null;
  state.selectedEventIndex = index;
}

function selectTraceNode(id) {
  const node = findTraceNode(state.detail?.trace?.root, id);
  if (!node) return;
  state.selectedTraceNodeId = id;
  const showDetails = node.type !== "thread";
  state.selectedDetailsNodeId = showDetails ? id : null;
  state.selectedEventIndex = null;
  state.selectedItemRef = null;
  renderTrace();
  renderToolDetails(showDetails ? node : null);
}

function selectItemRef(ref) {
  if (!findItemByRef(ref)) return;
  state.selectedItemRef = ref;
  state.selectedTraceNodeId = null;
}

function toggleTraceNode(id) {
  if (state.expandedTraceNodeIds.has(id)) {
    state.expandedTraceNodeIds.delete(id);
  } else {
    state.expandedTraceNodeIds.add(id);
  }
  renderTrace();
}

  Object.assign(api, { itemMatches, renderTurn, renderItem, renderItemContent, terminalVisibleFieldsForBlock, renderTruncationNotice, selectRawEvent, selectTraceNode, selectItemRef, toggleTraceNode });
}
