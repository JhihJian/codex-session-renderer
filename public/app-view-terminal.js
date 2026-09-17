function renderTerminal() {
  const detail = state.detail;
  if (!detail) {
    els.terminalContent.innerHTML = emptyState("选择一个会话", "Terminal 视图按执行语义展示用户、助手、工具和错误。");
    return;
  }
  const query = els.itemSearch.value.trim().toLowerCase();
  const typeFilter = els.itemTypeFilter.value;
  const blocks = buildTerminalBlocks(detail);
  const filtered = blocks.filter((block) => terminalBlockMatches(block, query, typeFilter));
  if (filtered.length === 0) {
    els.terminalContent.innerHTML = emptyState("没有匹配的 Terminal 块", "调整内容搜索或类型过滤。");
    return;
  }
  const stats = terminalRoleStats(blocks);
  const activeStats = terminalRoleStats(filtered);
  els.terminalContent.innerHTML = `
    <div class="terminal-shell">
      <div class="terminal-head">
        <div>
          <p class="eyebrow">终端会话</p>
          <h3 class="markdown-inline-title">${renderMarkdownTitle(detail.session?.title || "当前会话")}</h3>
        </div>
        <div class="terminal-role-nav" aria-label="Terminal 角色跳转">
          ${renderTerminalRoleNavButton("user", "用户", activeStats.user, stats.user)}
          ${renderTerminalRoleNavButton("assistant", "代理", activeStats.assistant, stats.assistant)}
          ${renderTerminalRoleNavButton("tool", "工具", activeStats.tool, stats.tool)}
          ${renderTerminalRoleNavButton("error", "错误", activeStats.error, stats.error)}
        </div>
      </div>
      <div class="terminal-blocks">
        ${filtered.map((block) => renderTerminalBlock(block, query)).join("")}
      </div>
    </div>
  `;
  els.terminalContent.querySelectorAll("[data-terminal-block-id]").forEach((blockEl) => {
    blockEl.addEventListener("click", (event) => {
      if (event.target.closest("a, button")) return;
      selectTerminalBlock(blockEl.dataset.terminalBlockId);
    });
    blockEl.addEventListener("keydown", (event) => {
      if (event.target.closest("a, button")) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      selectTerminalBlock(blockEl.dataset.terminalBlockId);
    });
  });
  els.terminalContent.querySelectorAll("[data-terminal-role]").forEach((button) => {
    button.addEventListener("click", () => jumpTerminalRole(button.dataset.terminalRole));
  });
}

function buildTerminalBlocks(detail) {
  const blocks = [];
  for (const turn of detail?.turns || []) {
    const turnNumber = turn.turnNumber ?? (blocks.length + 1);
    if (turn.startedAt || turn.status || turn.cwd) {
      blocks.push({
        id: `turn-${turnNumber}-meta`,
        role: "meta",
        title: `第 ${turnNumber} 轮`,
        text: [turn.status, formatDate(turn.startedAt), turn.cwd ? shortPath(turn.cwd) : ""].filter(Boolean).join(" · "),
        turnIndex: turnNumber - 1,
        timestamp: turn.startedAt,
      });
    }
    for (const item of turn.items || []) {
      blocks.push(...terminalBlocksFromItem(item, turnNumber));
    }
  }
  return blocks;
}

function terminalBlocksFromItem(item, turnNumber) {
  const ref = itemRef(item);
  const base = {
    id: ref,
    itemRef: ref,
    turnIndex: turnNumber - 1,
    timestamp: item.timestamp,
    eventIndex: item.sourceIndex ?? item.outputSourceIndex ?? null,
    title: itemTitle(item),
    role: terminalRoleForItem(item),
    text: terminalTextForItem(item),
    item,
  };
  if (!base.text && item.type !== "token-count") return [];
  if (item.type !== "tool-call" || item.output == null) return [base];
  const callText = [`$ ${item.name || "tool"}`, item.arguments == null ? "" : prettyMaybeJson(item.arguments)].filter(Boolean).join("\n");
  return [
    {
      ...base,
      id: `${ref}:call`,
      role: "tool",
      title: item.name ? `工具调用 · ${item.name}` : "工具调用",
      text: callText,
    },
    {
      ...base,
      id: `${ref}:output`,
      role: terminalItemHasError(item) ? "error" : "output",
      title: item.name ? `工具输出 · ${item.name}` : "工具输出",
      text: String(item.output || ""),
      timestamp: item.completedAt || item.timestamp,
      eventIndex: item.outputSourceIndex ?? item.sourceIndex ?? null,
    },
  ];
}

function terminalRoleForItem(item) {
  if (item.type === "user-message") return "user";
  if (item.type === "assistant-message") return "assistant";
  if (item.type === "tool-call" || item.type === "response-item") {
    return terminalItemHasError(item) ? "error" : "tool";
  }
  if (item.type === "tool-output") return terminalItemHasError(item) ? "error" : "output";
  if (item.type === "reasoning" || item.type === "token-count" || item.type === "event") return "meta";
  return "meta";
}

function terminalTextForItem(item) {
  if (item.type === "user-message" || item.type === "assistant-message") return item.text || "";
  if (item.type === "reasoning") return item.text || (item.encrypted ? "推理内容已加密存储，当前没有可展示的明文摘要。" : "");
  if (item.type === "context-compact") return item.text || item.compact?.message || item.payloadPreview || "";
  if (item.type === "token-count") return JSON.stringify(item.info || {}, null, 2);
  if (item.type === "tool-call") {
    const args = item.arguments == null ? "" : prettyMaybeJson(item.arguments);
    const output = item.output == null ? "" : String(item.output);
    return [`$ ${item.name || "tool"}`, args, output ? `\n# output\n${output}` : ""].filter(Boolean).join("\n");
  }
  if (item.type === "tool-output") return String(item.output || "");
  return item.payloadPreview || JSON.stringify(item.info || item.payload || item, null, 2);
}

function terminalItemHasError(item) {
  const text = [item.status, item.phase, item.responseType, item.eventType, item.output, item.payloadPreview].filter(Boolean).join("\n");
  return /error|failed|failure|stderr|失败|错误/i.test(text);
}

function terminalBlockMatches(block, query, typeFilter) {
  if (query && !terminalBlockSearchText(block).includes(query)) return false;
  if (typeFilter === "message") return block.role === "user" || block.role === "assistant";
  if (typeFilter === "tool") return block.role === "tool" || block.role === "output";
  if (typeFilter === "output") return block.role === "output" || (block.role === "tool" && block.item?.output);
  if (typeFilter === "reasoning") return block.item?.type === "reasoning";
  if (typeFilter === "compact") return block.item?.type === "context-compact";
  if (typeFilter === "system") return block.role === "meta";
  if (typeFilter === "error") return block.role === "error";
  return true;
}

function terminalBlockSearchText(block) {
  return [
    block.id,
    block.role,
    block.title,
    block.text,
    block.item?.name,
    block.item?.callId,
    block.item?.status,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function terminalRoleStats(blocks) {
  return blocks.reduce(
    (stats, block) => {
      if (block.role === "user") stats.user += 1;
      if (block.role === "assistant") stats.assistant += 1;
      if (block.role === "tool" || block.role === "output") stats.tool += 1;
      if (block.role === "error") stats.error += 1;
      return stats;
    },
    { user: 0, assistant: 0, tool: 0, error: 0 },
  );
}

function renderTerminalRoleNavButton(role, label, activeCount, totalCount) {
  const disabled = activeCount === 0 ? " disabled" : "";
  return `
    <button class="terminal-role-button ${role}" type="button" data-terminal-role="${escapeAttr(role)}"${disabled} title="跳转到下一处 ${escapeAttr(label)}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(activeCount))}/${escapeHtml(String(totalCount))}</strong>
    </button>
  `;
}

function renderTerminalBlock(block, query) {
  const selected = state.selectedTerminalBlockId === block.id ? " selected" : "";
  const meta = [`第 ${block.turnIndex + 1} 轮`, formatDate(block.timestamp), block.item?.name, block.item?.status]
    .filter(Boolean)
    .join(" · ");
  const body =
    block.role === "user" || block.role === "assistant"
      ? renderMarkdownMessage(block.text, query)
      : `<pre>${highlight(escapeHtml(block.text || ""), query)}</pre>`;
  return `
    <section class="terminal-block role-${escapeAttr(block.role)}${selected}" role="button" tabindex="0" data-terminal-block-id="${escapeAttr(block.id)}">
      <div class="terminal-block-strip" aria-hidden="true"></div>
      <div class="terminal-block-main">
        <div class="terminal-block-head">
          <strong>${escapeHtml(block.title || block.role)}</strong>
          <span>${escapeHtml(meta)}</span>
        </div>
        <div class="terminal-block-body">${body}</div>
        ${block.item?.truncated ? renderTruncationNotice(block.item, terminalVisibleFieldsForBlock(block)) : ""}
      </div>
    </section>
  `;
}

function selectTerminalBlock(id) {
  const block = buildTerminalBlocks(state.detail).find((candidate) => candidate.id === id);
  if (!block) return;
  state.selectedTerminalBlockId = id;
  state.selectedTraceNodeId = null;
  state.selectedEventIndex = null;
  state.selectedItemRef = block.itemRef || null;
  els.terminalContent.querySelectorAll(".terminal-block.selected").forEach((row) => row.classList.remove("selected"));
  const active = els.terminalContent.querySelector(`[data-terminal-block-id="${cssEscape(id)}"]`);
  active?.classList.add("selected");
}

function jumpTerminalRole(role) {
  const candidates = [...els.terminalContent.querySelectorAll(`[data-terminal-block-id].role-${cssEscape(role)}`)];
  if (role === "tool") {
    candidates.push(...els.terminalContent.querySelectorAll("[data-terminal-block-id].role-output"));
  }
  if (candidates.length === 0) return;
  const currentIndex = candidates.findIndex((el) => el.dataset.terminalBlockId === state.selectedTerminalBlockId);
  const next = candidates[(currentIndex + 1) % candidates.length];
  next.scrollIntoView({ behavior: preferredScrollBehavior(), block: "center" });
  selectTerminalBlock(next.dataset.terminalBlockId);
}
