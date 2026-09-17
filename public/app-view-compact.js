function renderMainContent() {
  syncViewControls();
  const placeholder = sessionPlaceholderState();
  if (placeholder) {
    renderSessionPlaceholder(placeholder.title, placeholder.subtitle);
    return;
  }
  renderCompact();
  if (state.viewMode === "diagnostic") {
    if (state.diagnosticMode === "raw") renderRawView();
    else renderStatsInfoView();
  } else if (state.viewMode === "trace") {
    renderTrace();
  }
}

function renderThread() {
  const detail = state.detail;
  if (!detail) {
    els.threadContent.innerHTML = emptyState("选择一个会话", "左侧列表展示本机 Codex 会话。");
    return;
  }
  const query = els.itemSearch.value.trim().toLowerCase();
  const typeFilter = els.itemTypeFilter.value;
  let totalItems = 0;
  let visibleItems = 0;
  const turns = [];
  for (const turn of detail.turns) {
    const matchedItems = turn.items.filter((item) => itemMatches(item, query, typeFilter));
    totalItems += matchedItems.length;
    if (visibleItems >= state.visibleThreadItems) continue;
    const remaining = state.visibleThreadItems - visibleItems;
    const shownItems = matchedItems.slice(0, remaining);
    visibleItems += shownItems.length;
    if (shownItems.length > 0) turns.push({ ...turn, items: shownItems });
  }

  if (turns.length === 0) {
    els.threadContent.innerHTML = emptyState("没有匹配的内容", "调整内容搜索或类型过滤。");
    return;
  }
  const moreHtml =
    totalItems > visibleItems
      ? `<div class="load-more-wrap">
          <button class="ghost-button" type="button" data-show-more-thread>显示更多内容 (${visibleItems}/${totalItems})</button>
        </div>`
      : "";
  els.threadContent.innerHTML = turns.map((turn) => renderTurn(turn, turn.turnNumber ?? 1, query)).join("") + moreHtml;
  els.threadContent.querySelectorAll("[data-item-ref]").forEach((itemEl) => {
    itemEl.addEventListener("click", (event) => {
      if (event.target.closest("a, button")) return;
      selectItemRef(itemEl.dataset.itemRef);
    });
    itemEl.addEventListener("keydown", (event) => {
      if (event.target.closest("a, button")) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      selectItemRef(itemEl.dataset.itemRef);
    });
  });
  const moreButton = els.threadContent.querySelector("[data-show-more-thread]");
  if (moreButton) {
    moreButton.addEventListener("click", () => {
      state.visibleThreadItems += 160;
      renderThread();
    });
  }
}

function renderCompact() {
  compactTimelineObserver?.disconnect();
  compactTimelineObserver = null;
  const compact = state.detail?.compact || buildCompactFallback(state.detail);
  if (!compact) {
    els.compactContent.innerHTML = emptyState("选择一个会话", "左侧列表展示本机 Codex 会话。");
    return;
  }
  const query = els.itemSearch.value.trim().toLowerCase();
  const typeFilter = els.itemTypeFilter.value;
  const filtered = filterCompactNode(compact, query, typeFilter, true);
  if (!filtered || (filtered.turns.length === 0 && filtered.children.length === 0)) {
    els.compactContent.innerHTML = emptyState("没有匹配的阅读内容", "阅读视图包含用户输入、全部助手消息和子代理层级。");
    return;
  }
  const timeline = renderCompactTimeline(filtered);
  els.compactContent.innerHTML = `
    <div class="compact-shell">
      <div class="compact-reading-layout${timeline ? " has-timeline" : ""}">
        ${timeline}
        <div class="compact-main">
          ${renderCompactThread(filtered, { depth: 0, root: true, path: "root", query })}
        </div>
      </div>
    </div>
  `;
  els.compactContent.querySelectorAll("[data-compact-session-id]").forEach((button) => {
    button.addEventListener("click", () => selectSession(button.dataset.compactSessionId));
  });
  els.compactContent.querySelectorAll("[data-compact-event-index]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const index = Number(button.dataset.compactEventIndex);
      if (!Number.isFinite(index)) return;
      await openRawEvent(index);
    });
  });
  els.compactContent.querySelectorAll("[data-compact-ref-event-index]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      scrollToCompactEvent(button.dataset.compactRefEventIndex);
    });
  });
  els.compactContent.querySelectorAll("[data-compact-replacement-target]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      scrollToCompactReplacementTarget(button);
    });
  });
  bindCompactTimeline();
  const outlineRows = Array.from(els.compactContent.querySelectorAll("[data-compact-nav-target]"));
  const focusCompactOutlineRow = (index) => {
    if (!outlineRows.length) return;
    const nextIndex = Math.min(outlineRows.length - 1, Math.max(0, index));
    outlineRows.forEach((candidate, candidateIndex) => {
      candidate.tabIndex = candidateIndex === nextIndex ? 0 : -1;
    });
    outlineRows[nextIndex]?.focus();
  };
  outlineRows.forEach((row, index) => {
    row.tabIndex = index === 0 ? 0 : -1;
    row.addEventListener("focus", () => {
      outlineRows.forEach((candidate) => {
        candidate.tabIndex = candidate === row ? 0 : -1;
      });
    });
    row.addEventListener("click", (event) => {
      if (event.target.closest("a")) return;
      scrollToCompactTarget(row.dataset.compactNavTarget);
    });
    row.addEventListener("keydown", (event) => {
      if (event.target.closest("a")) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        focusCompactOutlineRow(index + 1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        focusCompactOutlineRow(index - 1);
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        focusCompactOutlineRow(0);
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        focusCompactOutlineRow(outlineRows.length - 1);
        return;
      }
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      scrollToCompactTarget(row.dataset.compactNavTarget);
    });
  });
}

function renderCompactTimeline(node) {
  const entries = compactTimelineEntries(node);
  if (entries.length < 2) return "";
  return `
    <nav class="compact-timeline" aria-label="正文轮次导航">
      ${entries.map((entry, index) => renderCompactTimelineEntry(entry, index, entries.length)).join("")}
    </nav>
  `;
}

function compactTimelineEntries(node) {
  const timingByTurn = new Map((state.detail?.timing?.turns || []).map((turn) => [turn.turnNumber, turn.durationMs]));
  const entries = (node.turns || []).map((turn, index) => compactTimelineEntry(turn, index, timingByTurn));
  const reduced = entries.length > 24 ? aggregateCompactTimelineEntries(entries) : entries;
  return withCompactTimelineWeights(reduced);
}

function compactTimelineEntry(turn, index, timingByTurn) {
  const contextEvents = contextEventsForTurn(turn);
  const timingDuration = Number(timingByTurn.get(turn.turnNumber));
  return {
    targetId: compactElementId("turn", `root-turn-${index}`),
    startTurn: turn.turnNumber || index + 1,
    endTurn: turn.turnNumber || index + 1,
    durationMs: Number.isFinite(timingDuration) && timingDuration > 0 ? timingDuration : compactTurnDuration(turn),
    hasCompaction: contextEvents.some((event) => event.contextKind === "compaction"),
    subagentCount: (turn.embeddedSubagents?.length || 0) + (turn.children?.length || 0),
  };
}

function compactTurnDuration(turn) {
  const start = new Date(turn.startedAt || "").getTime();
  const end = new Date(turn.completedAt || "").getTime();
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? end - start : null;
}

function aggregateCompactTimelineEntries(entries) {
  const result = [];
  let ordinary = [];
  const flushOrdinary = () => {
    while (ordinary.length) {
      const group = ordinary.splice(0, 5);
      result.push({
        ...group[0],
        endTurn: group.at(-1).endTurn,
        durationMs: group.reduce((total, entry) => total + (entry.durationMs || 0), 0) || null,
        grouped: group.length > 1,
      });
    }
  };
  for (const entry of entries) {
    if (!entry.hasCompaction && entry.subagentCount === 0) {
      ordinary.push(entry);
      continue;
    }
    flushOrdinary();
    result.push(entry);
  }
  flushOrdinary();
  return result;
}

function withCompactTimelineWeights(entries) {
  const known = entries.map((entry) => entry.durationMs).filter((duration) => Number.isFinite(duration) && duration > 0);
  const fallback = known.length ? known.reduce((sum, duration) => sum + duration, 0) / known.length : 1;
  const minimum = Math.max(1, fallback * 0.08);
  return entries.map((entry) => ({ ...entry, timelineWeight: Math.max(minimum, entry.durationMs || fallback) }));
}

function renderCompactTimelineEntry(entry, index, total) {
  const label = entry.startTurn === entry.endTurn ? String(entry.startTurn) : `${entry.startTurn}-${entry.endTurn}`;
  const classes = [
    "compact-timeline-node",
    entry.hasCompaction ? "has-compaction" : "",
    entry.subagentCount ? "has-subagent" : "",
    index === total - 1 ? "is-last" : "",
  ].filter(Boolean).join(" ");
  const signals = [
    entry.hasCompaction ? "含上下文压缩" : "",
    entry.subagentCount ? `含 ${entry.subagentCount} 次子代理调用` : "",
  ].filter(Boolean);
  const range = entry.grouped ? `第 ${entry.startTurn} 至 ${entry.endTurn} 轮，共 ${entry.endTurn - entry.startTurn + 1} 轮` : `第 ${entry.startTurn} 轮`;
  const duration = entry.durationMs ? `记录时长 ${formatTimingDuration(entry.durationMs)}` : "";
  const ariaLabel = [range, duration, ...signals].filter(Boolean).join("，");
  return `
    <button class="${classes}" type="button" style="--timeline-weight:${escapeAttr(String(entry.timelineWeight))}" data-compact-timeline-target="${escapeAttr(entry.targetId)}" aria-label="${escapeAttr(ariaLabel)}" title="${escapeAttr(ariaLabel)}" tabindex="${index === 0 ? "0" : "-1"}">
      <span class="compact-timeline-label">${escapeHtml(label)}</span>
      <span class="compact-timeline-dot" aria-hidden="true"></span>
    </button>
  `;
}

function bindCompactTimeline() {
  const buttons = Array.from(els.compactContent.querySelectorAll("[data-compact-timeline-target]"));
  if (!buttons.length) return;
  setCompactTimelineReadingTarget(buttons[0].dataset.compactTimelineTarget || "");
  buttons.forEach((button, index) => {
    button.addEventListener("click", () => {
      const targetId = button.dataset.compactTimelineTarget || "";
      compactTimelineJumpTarget = targetId;
      setCompactTimelineReadingTarget(targetId);
      scrollToCompactTarget(targetId);
      window.setTimeout(() => {
        if (compactTimelineJumpTarget === targetId) compactTimelineJumpTarget = "";
      }, 700);
    });
    button.addEventListener("keydown", (event) => handleCompactTimelineKeydown(event, buttons, index));
  });
  observeCompactTimelineTargets(buttons);
}

function handleCompactTimelineKeydown(event, buttons, index) {
  if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const nextIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? buttons.length - 1
      : Math.min(buttons.length - 1, Math.max(0, index + (event.key === "ArrowUp" ? -1 : 1)));
  buttons.forEach((button, buttonIndex) => { button.tabIndex = buttonIndex === nextIndex ? 0 : -1; });
  buttons[nextIndex]?.focus({ preventScroll: true });
}

function observeCompactTimelineTargets(buttons) {
  if (typeof IntersectionObserver === "undefined") return;
  compactTimelineObserver = new IntersectionObserver((observations) => {
    if (compactTimelineJumpTarget) return;
    const visible = observations.filter((entry) => entry.isIntersecting);
    if (!visible.length) return;
    visible.sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top);
    setCompactTimelineReadingTarget(visible[0].target.id);
  }, { root: els.compactContent, rootMargin: "0px 0px -62% 0px", threshold: 0.01 });
  buttons.forEach((button) => {
    const target = els.compactContent.querySelector(`#${cssEscape(button.dataset.compactTimelineTarget || "")}`);
    if (target) compactTimelineObserver.observe(target);
  });
}

function setCompactTimelineReadingTarget(targetId) {
  if (!targetId) return;
  const buttons = els.compactContent.querySelectorAll("[data-compact-timeline-target]");
  buttons.forEach((button) => {
    const active = button.dataset.compactTimelineTarget === targetId;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "location" : "false");
    if (!els.compactContent.contains(document.activeElement)) button.tabIndex = active ? 0 : -1;
  });
}

function buildCompactFallback(detail) {
  if (!detail?.turns) return null;
  return {
    session: detail.session || {},
    turns: detail.turns.map((turn, index) => compactTurnFallback(turn, index)),
    children: [],
  };
}

function compactTurnFallback(turn, index) {
  const items = turn.items || [];
  const userMessages = items
    .map((item, itemIndex) => (item.type === "user-message" && String(item.text || "").trim() ? compactMessageFallback(item, index, itemIndex) : null))
    .filter(Boolean);
  const assistantMessages = items
    .map((item, itemIndex) => (item.type === "assistant-message" && String(item.text || "").trim() ? compactMessageFallback(item, index, itemIndex) : null))
    .filter(Boolean);
  const compactEvents = items.filter((item) => item.type === "context-compact").map(compactEventFallback);
  return {
    id: turn.id || `turn-${index}`,
    turnNumber: turn.turnNumber ?? index + 1,
    status: turn.status,
    startedAt: turn.startedAt,
    completedAt: turn.completedAt,
    userMessages,
    assistantMessages,
    assistantMessage: assistantMessages.at(-1) || null,
    compactEvents,
    children: [],
  };
}

function compactMessageFallback(item, turnIndex = null, itemIndex = null) {
  return {
    id: item.id,
    type: item.type,
    text: item.text || "",
    timestamp: item.timestamp,
    phase: item.phase,
    sourceIndex: item.sourceIndex ?? null,
    turnIndex,
    itemIndex,
    messageId: item.messageId || null,
    truncated: item.truncated,
    textLength: item.textLength,
    contextUsage: item.contextUsage || null,
    compressionRefs: item.compressionRefs || [],
  };
}

function compactEventFallback(item) {
  const text = item.text || item.compact?.message || "";
  return {
    id: item.id,
    type: item.type,
    timestamp: item.timestamp,
    eventType: item.eventType || item.compact?.kind || "",
    sourceIndex: item.sourceIndex ?? null,
    text,
    textLength: item.textLength ?? text.length,
    truncated: item.truncated,
    compact: item.compact || null,
  };
}

function filterCompactNode(node, query, typeFilter, isRoot = false) {
  const turns = (node.turns || [])
    .map((turn) => filterCompactTurn(turn, query, typeFilter))
    .filter(Boolean);
  const children = (node.children || [])
    .map((child) => filterCompactNode(child, query, typeFilter, false))
    .filter(Boolean);
  const matchesSelf = compactSearchText(node).includes(query || "") && compactNodeMatchesType(node, typeFilter);
  if (isRoot || matchesSelf || turns.length > 0 || children.length > 0) {
    return { ...node, turns, children };
  }
  return null;
}

function filterCompactTurn(turn, query, typeFilter) {
  const children = (turn.children || [])
    .map((child) => filterCompactNode(child, query, typeFilter, false))
    .filter(Boolean);
  const matchesSelf = compactTurnMatches(turn, query, typeFilter);
  if (matchesSelf || children.length > 0) return { ...turn, children };
  return null;
}

function compactTurnMatches(turn, query, typeFilter) {
  const special = compactSpecialTurnMatch(turn, query, typeFilter);
  return special == null ? compactStandardTurnMatch(turn, query, typeFilter) : special;
}

function compactSpecialTurnMatch(turn, query, typeFilter) {
  if (typeFilter === "tool") return Boolean(turn.children?.length);
  const { hasCompact, hasContext } = compactContextEventFlags(turn);
  if (typeFilter === "compact") return hasCompact && compactTurnQueryMatches(turn, query);
  if (typeFilter === "system") return hasContext && compactTurnQueryMatches(turn, query);
  return null;
}

function compactStandardTurnMatch(turn, query, typeFilter) {
  if (![
    "all",
    "message",
    "error",
  ].includes(typeFilter)) return false;
  const hasMessage = turn.userMessages?.length || compactAssistantMessages(turn).length;
  if (typeFilter === "message" && !hasMessage) return false;
  const haystack = compactTurnSearchText(turn);
  if (typeFilter === "error" && !/error|failed|失败|错误/i.test(haystack)) return false;
  return !query || haystack.includes(query);
}

function compactTurnQueryMatches(turn, query) {
  return !query || compactTurnSearchText(turn).includes(query);
}

function compactContextEventFlags(turn) {
  const events = contextEventsForTurn(turn);
  return { hasCompact: events.some((event) => event.contextKind === "compaction"), hasContext: events.length > 0 };
}

function compactNodeMatchesType(node, typeFilter) {
  if (typeFilter === "all") return true;
  if (typeFilter === "message") return Boolean(node.turns?.some((turn) => turn.userMessages?.length || compactAssistantMessages(turn).length));
  if (typeFilter === "tool") return !node.session || Boolean(node.edgeStatus || node.spawnEvent || node.notificationEvent);
  if (typeFilter === "compact") return Boolean(node.turns?.some((turn) => contextEventsForTurn(turn).some((event) => event.contextKind === "compaction")));
  if (typeFilter === "system") return Boolean(node.turns?.some((turn) => contextEventsForTurn(turn).length > 0));
  if (typeFilter === "error") return /error|failed|失败|错误/i.test(compactSearchText(node));
  return false;
}

function compactSearchText(node) {
  const session = node.session || {};
  const parts = [
    session.id,
    session.title,
    session.agentNickname,
    session.agentRole,
    session.cwd,
    node.edgeStatus,
    node.unavailableReason,
    node.spawnEvent?.preview,
    node.notificationEvent?.preview,
    node.notificationSummary?.label,
    node.notificationSummary?.body,
    ...(node.turns || []).map(compactTurnSearchText),
    ...(node.children || []).map(compactSearchText),
  ];
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function compactTurnSearchText(turn) {
  const parts = [
    turn.id,
    turn.status,
    ...(turn.userMessages || []).flatMap((message) => compactMessageSearchParts(message)),
    ...compactAssistantMessages(turn).flatMap((message) => compactMessageSearchParts(message)),
    ...contextEventsForTurn(turn).flatMap(compactContextEventSearchParts),
    ...(turn.children || []).map(compactSearchText),
  ];
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function compactContextEventSearchParts(event = {}) {
  return [
    event.contextKind,
    event.eventType,
    event.text,
    event.instruction?.text,
    event.userText?.text,
    event.skill?.name,
    event.skill?.sourceFile,
    event.state,
    event.compact?.kind,
    event.compact?.phase,
    event.compact?.windowNumber,
    event.compact?.windowId,
    event.compact?.previousWindowId,
    event.compact?.firstWindowId,
    ...(event.compact?.replacementHistoryPreview || []).flatMap((entry) => [
      entry.type,
      entry.role,
      entry.name,
      entry.turnId,
      entry.messageId,
      entry.preview,
    ]),
  ];
}

// The renderer stays isolated while its interaction model is migrated into analysis.
// eslint-disable-next-line no-unused-vars
function renderCompactOutline(node, context) {
  const stats = compactOutlineStats(node);
  return `
    <nav class="compact-outline" aria-label="阅读视图层级目录">
      <div class="compact-outline-section">
        <div class="compact-outline-head">
          <strong>执行层级</strong>
          <span>${escapeHtml([`${stats.threads} 线程`, `${stats.turns} 轮次`, stats.compacts ? `${stats.compacts} 压缩` : ""].filter(Boolean).join(" · "))}</span>
        </div>
        <div class="compact-outline-tree">
          ${renderCompactExecutionDirectory(node, { ...context, seen: new Set() })}
        </div>
      </div>
    </nav>
  `;
}

function renderCompactExecutionDirectory(node, context) {
  const session = node.session || {};
  const evidenceScope = evidenceScopeForSession(session, context.evidenceScope);
  const depth = Math.min(context.depth ?? 0, 7);
  const name = session.agentNickname || session.title || session.id || "当前会话";
  const targetId = compactElementId("thread", context.path);
  const threadId = session.id || targetId;
  const seen = new Set(context.seen || []);
  const repeated = seen.has(threadId);
  seen.add(threadId);
  const turns = (node.turns || [])
    .map((turn, index) =>
      renderCompactOutlineTurn(turn, {
        depth: depth + 1,
        path: `${context.path}-turn-${index}`,
        query: context.query,
        seen,
        allowChildren: !repeated,
        evidenceScope,
        threadPath: context.path,
      }),
    )
    .join("");
  const unanchoredChildren = repeated
    ? ""
    : (node.children || [])
        .map((child, index) =>
          renderCompactExecutionDirectory(child, {
            depth: depth + 1,
            path: `${context.path}-child-${index}`,
            query: context.query,
            root: false,
            seen,
            evidenceScope,
          }),
        )
        .join("");
  const repeatedNotice = repeated ? `<div class="compact-outline-note" style="--depth:${depth + 1}">已出现过，停止展开</div>` : "";
  const unanchoredTitle =
    unanchoredChildren && (node.turns || []).length
      ? `<div class="compact-outline-note" style="--depth:${depth + 1}">未定位到具体轮次的子代理</div>`
      : "";
  return `
    <div class="compact-outline-group">
      <button class="compact-outline-item thread" role="button" tabindex="-1" type="button" style="--depth:${depth}" data-compact-nav-target="${escapeAttr(targetId)}" data-evidence-id="${escapeAttr(buildEvidenceId({ ...evidenceScope, threadPath: context.path, entity: "session" }))}" aria-label="${escapeAttr(`${context.root ? "根会话" : "子代理"}：${name}`)}">
        <span class="compact-outline-indent" aria-hidden="true"></span>
        <span class="compact-outline-icon">${context.root ? "R" : "A"}</span>
        <span class="compact-outline-copy">
          <strong class="markdown-inline-title">${renderMarkdownTitle(name, context.query)}</strong>
          <em>${escapeHtml([session.agentRole, node.notificationSummary?.label, `${(node.turns || []).length} 轮次`].filter(Boolean).join(" · "))}</em>
        </span>
      </button>
      ${repeatedNotice}
      ${repeated ? "" : turns}
      ${unanchoredTitle}
      ${unanchoredChildren}
    </div>
  `;
}

function renderCompactOutlineThreadUnderTurn(node, context) {
  return renderCompactExecutionDirectory(node, {
    depth: context.depth,
    path: context.path,
    query: context.query,
    root: false,
    seen: context.seen,
    evidenceScope: context.evidenceScope,
  });
}

function renderCompactOutlineTurn(turn, context) {
  const depth = Math.min(context.depth ?? 0, 8);
  const targetId = compactElementId("turn", context.path);
  const compactEvents = compactEventsForTurn(turn)
    .map((event, index) =>
      renderCompactOutlineContextEvent(event, {
        depth: depth + 1,
        path: `${context.path}-compact-${index}`,
        query: context.query,
        evidenceScope: context.evidenceScope,
        threadPath: context.threadPath,
      }),
    )
    .join("");
  const embeddedSubagents = renderCompactOutlineEmbeddedSubagents(turn.embeddedSubagents || [], {
    depth: depth + 1,
    path: context.path,
    query: context.query,
    evidenceScope: context.evidenceScope,
    threadPath: context.threadPath,
  });
  const children =
    context.allowChildren === false
      ? ""
      : (turn.children || [])
          .map((child, index) =>
            renderCompactOutlineThreadUnderTurn(child, {
              depth: depth + 1,
              path: `${context.path}-child-${index}`,
              query: context.query,
              seen: context.seen,
              evidenceScope: context.evidenceScope,
            }),
          )
          .join("");
  return `
    <div class="compact-outline-group">
      <button class="compact-outline-item turn" role="button" tabindex="-1" type="button" style="--depth:${depth}" data-compact-nav-target="${escapeAttr(targetId)}" data-evidence-id="${escapeAttr(buildEvidenceId({ ...context.evidenceScope, threadPath: context.threadPath, turnNumber: turn.turnNumber, entity: "turn" }))}" aria-label="${escapeAttr(`第 ${turn.turnNumber || ""} 轮：${compactTurnOutlineTitle(turn)}`)}">
        <span class="compact-outline-indent" aria-hidden="true"></span>
        <span class="compact-outline-icon">T</span>
        <span class="compact-outline-copy">
          <strong>第 ${escapeHtml(String(turn.turnNumber || ""))} 轮</strong>
          <em>${highlight(escapeHtml(compactTurnOutlineTitle(turn)), context.query)}</em>
        </span>
      </button>
      ${compactEvents}
      ${embeddedSubagents}
      ${children}
    </div>
  `;
}

function renderCompactOutlineEmbeddedSubagents(batches, context) {
  if (!batches.length) return "";
  const targetId = compactEmbeddedSubagentTargetId(context.path);
  return batches
    .map((batch, batchIndex) => {
      const status = batch.status || "unknown";
      const tasks = compactEmbeddedTaskViews(batch);
      const eventIndex = batch.outputSourceIndex ?? batch.sourceIndex ?? batchIndex;
      const runLabel = `内嵌调用 ${batchIndex + 1}`;
      const taskNodes = tasks
        .map((task, taskIndex) => {
          const taskStatus = task.status || status;
          const taskLabel = `子代理：${task.agent || "未指定代理"}`;
          const taskMeta = [compactEmbeddedSubagentStatusLabel(taskStatus), compactEmbeddedTaskTitle(task.task)].filter(Boolean).join(" · ");
          return `<button class="compact-outline-item embedded-subagent status-${escapeAttr(taskStatus)}" role="button" tabindex="-1" type="button" style="--depth:${Math.min(context.depth + 1, 9)}" data-compact-nav-target="${escapeAttr(targetId)}" data-evidence-id="${escapeAttr(buildEvidenceId({ ...context.evidenceScope, threadPath: context.threadPath, eventIndex: `${eventIndex}:${taskIndex}`, entity: "embedded-subagent-task" }))}" aria-label="${escapeAttr(`${taskLabel}：${taskMeta}`)}"><span class="compact-outline-indent" aria-hidden="true"></span><span class="compact-outline-icon">A</span><span class="compact-outline-copy"><strong>${highlight(escapeHtml(taskLabel), context.query)}</strong><em>${highlight(escapeHtml(taskMeta), context.query)}</em></span></button>`;
        })
        .join("");
      return `<div class="compact-outline-group"><button class="compact-outline-item embedded-subagent-run status-${escapeAttr(status)}" role="button" tabindex="-1" type="button" style="--depth:${Math.min(context.depth, 8)}" data-compact-nav-target="${escapeAttr(targetId)}" data-evidence-id="${escapeAttr(buildEvidenceId({ ...context.evidenceScope, threadPath: context.threadPath, eventIndex, entity: "embedded-subagent" }))}" aria-label="${escapeAttr(`${runLabel}：${compactEmbeddedSubagentStatusLabel(status)}`)}"><span class="compact-outline-indent" aria-hidden="true"></span><span class="compact-outline-icon">A</span><span class="compact-outline-copy"><strong>${escapeHtml(runLabel)}</strong><em>${escapeHtml(compactEmbeddedSubagentStatusLabel(status))}</em></span></button>${taskNodes}</div>`;
    })
    .join("");
}

function renderCompactOutlineContextEvent(event, context) {
  const compact = event.compact || {};
  const depth = Math.min(context.depth ?? 0, 9);
  const targetId = compactElementId("event", context.path || `event-${event.sourceIndex ?? event.id ?? "compact"}`);
  const isSummary = compact.kind === "compacted" || event.eventType === "compacted";
  const label = isSummary ? "上下文压缩摘要" : "上下文压缩完成";
  const meta = [
    compact.windowNumber != null ? `窗口 ${compact.windowNumber}` : "",
    compact.replacementHistoryCount ? `替换 ${compact.replacementHistoryCount}` : "",
    formatDate(event.timestamp),
  ]
    .filter(Boolean)
    .join(" · ");
  return `
    <button class="compact-outline-item compact-event" role="button" tabindex="-1" type="button" style="--depth:${depth}" data-compact-nav-target="${escapeAttr(targetId)}" data-evidence-id="${escapeAttr(buildEvidenceId({ ...context.evidenceScope, threadPath: context.threadPath, eventIndex: event.sourceIndex ?? event.id, entity: "event" }))}" aria-label="${escapeAttr(label)}">
      <span class="compact-outline-indent" aria-hidden="true"></span>
      <span class="compact-outline-icon">C</span>
      <span class="compact-outline-copy">
        <strong>${highlight(escapeHtml(label), context.query)}</strong>
        <em>${highlight(escapeHtml(meta || "压缩事件"), context.query)}</em>
      </span>
    </button>
  `;
}

function compactNodeChildren(node) {
  return [
    ...(node.children || []),
    ...(node.turns || []).flatMap((turn) => turn.children || []),
  ];
}

function compactNodeChildEntries(node, basePath) {
  const direct = (node.children || []).map((child, index) => ({ node: child, path: `${basePath}-child-${index}` }));
  const anchored = (node.turns || []).flatMap((turn, turnIndex) =>
    (turn.children || []).map((child, childIndex) => ({ node: child, path: `${basePath}-turn-${turnIndex}-child-${childIndex}` })),
  );
  return [...direct, ...anchored];
}

function compactTurnOutlineTitle(turn) {
  const text = turn.userMessages?.[0]?.text || compactAssistantMessages(turn)[0]?.text || turn.status || "";
  return text || "无消息";
}

function compactOutlineStats(node, seen = new Set()) {
  const sessionId = node.session?.id || node.session?.title || "";
  if (sessionId && seen.has(sessionId)) return { turns: 0, threads: 0 };
  const nextSeen = new Set(seen);
  if (sessionId) nextSeen.add(sessionId);
  return compactNodeChildren(node).reduce(
    (stats, child) => {
      const childStats = compactOutlineStats(child, nextSeen);
      stats.turns += childStats.turns;
      stats.threads += childStats.threads;
      stats.compacts += childStats.compacts;
      return stats;
    },
    { turns: (node.turns || []).length, threads: 1, compacts: (node.turns || []).reduce((count, turn) => count + compactEventsForTurn(turn).length, 0) },
  );
}

function compactElementId(kind, path) {
  return `compact-${kind}-${String(path || "root").replace(/[^a-z0-9_-]/gi, "-")}`;
}

function scrollToCompactTarget(targetId) {
  if (!targetId) return;
  const target = els.compactContent.querySelector(`#${cssEscape(targetId)}`);
  if (!target) return;
  setCompactTimelineReadingTarget(targetId);
  target.scrollIntoView({ behavior: preferredScrollBehavior(), block: "start" });
  target.classList.remove("compact-jump-highlight");
  if (prefersReducedMotion()) return;
  window.setTimeout(() => {
    target.classList.add("compact-jump-highlight");
    window.setTimeout(() => target.classList.remove("compact-jump-highlight"), 1400);
  }, 80);
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function preferredScrollBehavior() {
  return prefersReducedMotion() ? "auto" : "smooth";
}

function scrollToCompactEvent(sourceIndex) {
  if (sourceIndex == null || sourceIndex === "") return;
  const target = els.compactContent.querySelector(`[data-compact-source-index="${cssEscape(String(sourceIndex))}"]`);
  if (!target) return;
  scrollToCompactTarget(target.id);
}

function scrollToCompactReplacementTarget(source) {
  if (!source) return;
  const scope = source.closest(".compact-thread") || els.compactContent;
  const turnIndex = source.dataset.compactReplacementTurnIndex;
  const ownerItemIndex = source.dataset.compactReplacementOwnerItemIndex;
  const itemIndex = source.dataset.compactReplacementItemIndex;
  const turnNumber = source.dataset.compactReplacementTurnNumber;
  const target =
    compactReplacementTargetElement(scope, turnIndex, ownerItemIndex) ||
    compactReplacementTargetElement(scope, turnIndex, itemIndex) ||
    (turnNumber ? scope.querySelector(`[data-compact-turn-number="${cssEscape(turnNumber)}"]`) : null);
  if (!target?.id) return;
  scrollToCompactTarget(target.id);
}

function compactReplacementTargetElement(scope, turnIndex, itemIndex) {
  if (!scope || turnIndex == null || turnIndex === "" || itemIndex == null || itemIndex === "") return null;
  return scope.querySelector(`[data-compact-turn-index="${cssEscape(String(turnIndex))}"][data-compact-item-index="${cssEscape(String(itemIndex))}"]`);
}

function renderCompactThread(node, context) {
  const session = node.session || {};
  const depth = Math.min(context.depth ?? 0, 6);
  const path = context.path || "root";
  const targetId = compactElementId("thread", path);
  const name = session.agentNickname || session.title || session.id || "当前会话";
  const role = [session.agentRole, session.model].filter(Boolean).join(" · ");
  const meta = [role, formatDate(session.updatedAt), node.notificationSummary?.label || node.edgeStatus].filter(Boolean).join(" · ");
  const openButton =
    !context.root && session.id
      ? `<button class="ghost-button small" type="button" data-compact-session-id="${escapeAttr(session.id)}">打开会话</button>`
      : "";
  const unavailable = node.unavailable
    ? `<div class="compact-unavailable">子代理详情未载入：${escapeHtml(node.unavailableReason || "未知原因")}</div>`
    : "";
  const report = renderCompactSubagentReport(node.notificationSummary, context.query);
  const turnHtml = (node.turns || [])
    .map((turn, index) => renderCompactTurn(turn, { depth, path: `${path}-turn-${index}`, query: context.query }))
    .join("");
  const childHtml = (node.children || [])
    .map((child, index) => renderCompactThread(child, { depth: depth + 1, path: `${path}-child-${index}`, query: context.query }))
    .join("");

  return `
    <article class="compact-thread${context.root ? " root" : ""}" id="${escapeAttr(targetId)}" tabindex="-1" style="--depth:${depth}">
      <header class="compact-thread-head">
        <span class="compact-thread-line" aria-hidden="true"></span>
        <span class="compact-agent-mark">${context.root ? "R" : "A"}</span>
        <span class="compact-thread-title">
          <strong class="markdown-inline-title">${renderMarkdownTitle(name, context.query)}</strong>
          <em>${highlight(escapeHtml(meta || session.id || ""), context.query)}</em>
        </span>
        ${openButton}
      </header>
      <div class="compact-thread-body">
        ${unavailable}
        ${report}
        ${turnHtml || (!childHtml ? `<div class="compact-empty">没有可展示的用户/助手消息。</div>` : "")}
        ${childHtml ? `<div class="compact-orphans">${childHtml}</div>` : ""}
      </div>
    </article>
  `;
}

function renderCompactSubagentReport(summary, query) {
  if (!summary) return "";
  const meta = [summary.label, formatDate(summary.timestamp), summary.truncated ? `已截断 ${compactNumber(summary.bodyLength || 0)} 字符` : ""]
    .filter(Boolean)
    .join(" · ");
  const rawButton =
    summary.eventIndex != null
      ? `<button class="ghost-button small" type="button" data-compact-event-index="${escapeAttr(String(summary.eventIndex))}">查看原始事件</button>`
      : "";
  const body = summary.body
    ? renderMarkdownMessage(summary.body, query)
    : `<div class="compact-subagent-empty">收到子代理状态通知，未包含可展示正文。</div>`;
  return `
    <section class="compact-subagent-report status-${escapeAttr(summary.state || "unknown")}">
      <div class="compact-subagent-report-head">
        <span class="compact-subagent-report-icon" aria-hidden="true">A</span>
        <span class="compact-subagent-report-title">
          <strong>子代理回报</strong>
          <em>${escapeHtml(meta)}</em>
        </span>
        ${rawButton}
      </div>
      <div class="compact-subagent-report-body">
        ${body}
      </div>
    </section>
  `;
}

function renderCompactTurn(turn, context) {
  const path = context.path || `turn-${turn.turnNumber || 0}`;
  const targetId = compactElementId("turn", path);
  const meta = [turn.status, formatDate(turn.startedAt), turn.completedAt ? `结束 ${formatDate(turn.completedAt)}` : ""]
    .filter(Boolean)
    .join(" · ");
  const users = turn.userMessages?.length
    ? turn.userMessages.map((message, index) => renderCompactMessage("user", "用户", message, context.query, `${path}-user-${index}`)).join("")
    : `<div class="compact-missing">本轮没有可展示的用户输入。</div>`;
  const assistantMessages = compactAssistantMessages(turn);
  const assistant = assistantMessages.length
    ? assistantMessages.map((message, index) => renderCompactMessage("assistant", compactAssistantMessageLabel(message, index, assistantMessages.length), message, context.query, `${path}-assistant-${index}`)).join("")
    : `<div class="compact-missing">本轮没有助手消息。</div>`;
  const contextEvents = contextEventsForTurn(turn)
    .map((event, index) => renderCompactContextEvent(event, context.query, `${path}-compact-${index}`))
    .join("");
  const embeddedSubagents = renderCompactEmbeddedSubagents(turn.embeddedSubagents || [], context.query, compactEmbeddedSubagentTargetId(path));
  const metrics = renderCompactTurnMetrics(turn.metrics);
  const children = (turn.children || [])
    .map((child, index) =>
      renderCompactThread(child, { depth: context.depth + 1, path: `${path}-child-${index}`, query: context.query }),
    )
    .join("");
  return `
    <section class="compact-turn" id="${escapeAttr(targetId)}" tabindex="-1" data-compact-turn-number="${escapeAttr(String(turn.turnNumber || ""))}">
      <div class="compact-turn-head">
        <strong>第 ${escapeHtml(String(turn.turnNumber || ""))} 轮</strong>
        <span>${escapeHtml(meta)}</span>
      </div>
      <div class="compact-message-pair">
        ${users}
        ${assistant}
      </div>
      ${metrics}
      ${contextEvents ? `<div class="compact-system-group">${contextEvents}</div>` : ""}
      ${embeddedSubagents ? `<div class="compact-embedded-subagents">${embeddedSubagents}</div>` : ""}
      ${children ? `<div class="compact-child-group">${children}</div>` : ""}
    </section>
  `;
}

function renderCompactTurnMetrics(metrics = {}) {
  const usage = metrics.endingContextUsage;
  const usagePercent = contextUsagePercent(usage);
  const runtime = metrics.activeRunMs;
  const rows = [
    Number.isFinite(usagePercent)
      ? `<div><span>轮末上下文</span><strong>${escapeHtml(`${usage?.used != null && usage?.limit != null ? `${compactNumber(usage.used)} / ${compactNumber(usage.limit)} · ` : ""}${usagePercent}%`)}</strong></div>`
      : "",
    Number.isFinite(metrics.generatedTokens)
      ? `<div><span>生成 Token</span><strong>${escapeHtml(compactNumber(metrics.generatedTokens))}</strong></div>`
      : "",
    Number.isFinite(runtime) && metrics.executionConfidence !== "unavailable"
      ? `<div title="工具与 LLM 可关联区间的并集"><span>实际执行</span><strong>${escapeHtml(formatTimingDuration(runtime))}</strong>${metrics.executionConfidence !== "observed" && timingKindLabel(metrics.executionConfidence) ? `<em>${escapeHtml(timingKindLabel(metrics.executionConfidence))}</em>` : ""}</div>`
      : "",
  ].filter(Boolean);
  return rows.length ? `<section class="compact-turn-metrics" aria-label="本轮结束指标">${rows.join("")}</section>` : "";
}

function compactEmbeddedSubagentTargetId(path) {
  return compactElementId("embedded-subagents", path);
}

function renderCompactEmbeddedSubagents(batches, query, targetId) {
  if (!batches.length) return "";
  const summary = compactEmbeddedSubagentGroupSummary(batches);
  return `<section class="compact-embedded-subagent-group" id="${escapeAttr(targetId)}" tabindex="-1" aria-label="子代理执行，${escapeAttr(summary)}"><header class="compact-embedded-group-head"><span><strong>子代理执行</strong><em>${escapeHtml(summary)}</em></span></header><ol class="compact-embedded-run-list">${batches.map((batch, index) => renderCompactEmbeddedRun(batch, index, query)).join("")}</ol></section>`;
}

function renderCompactEmbeddedRun(batch, index, query) {
  const status = batch.status || "unknown";
  const eventIndex = batch.outputSourceIndex ?? batch.sourceIndex;
  const rawButton = eventIndex != null
    ? `<button class="ghost-button small compact-embedded-raw" type="button" data-compact-event-index="${escapeAttr(String(eventIndex))}" aria-label="查看第 ${index + 1} 次子代理调用的原始结果事件">原始记录</button>`
    : "";
  const tasks = compactEmbeddedTaskViews(batch);
  const taskRows = tasks.map((task) => renderCompactEmbeddedTask(task, batch, index, query, tasks.length > 1)).join("");
  return `<li class="compact-embedded-run status-${escapeAttr(status)}"><div class="compact-embedded-run-head"><span class="compact-embedded-run-index">调用 ${index + 1}</span><span class="compact-embedded-status">${escapeHtml(compactEmbeddedSubagentStatusLabel(status))}</span>${rawButton}</div><div class="compact-embedded-task-list">${taskRows || `<div class="compact-embedded-empty">本次调用没有可展示任务。</div>`}</div></li>`;
}

function renderCompactEmbeddedTask(task, batch, runIndex, query, showTaskStatus) {
  const status = task.status || batch.status || "unknown";
  const meta = task.exitCode != null && task.exitCode !== 0 ? `退出 ${task.exitCode}` : "";
  const taskTitle = compactEmbeddedTaskTitle(task.task);
  const reportId = `embedded-report-${batch.turnIndex}-${batch.itemIndex}-${task.index}`;
  const report = task.summary
    ? `<div id="${escapeAttr(reportId)}" class="compact-embedded-report">${renderMarkdownMessage(task.summary, query)}</div>`
    : "";
  return `<article class="compact-embedded-task${showTaskStatus ? "" : " single-task"} status-${escapeAttr(status)}">${showTaskStatus ? `<span class="compact-embedded-task-status">${escapeHtml(compactEmbeddedSubagentStatusLabel(status))}</span>` : ""}<div class="compact-embedded-task-body"><div class="compact-embedded-task-main"><strong>${highlight(escapeHtml(task.agent || "未指定代理"), query)}</strong>${taskTitle ? `<span>${highlight(escapeHtml(taskTitle), query)}</span>` : ""}</div>${meta ? `<em>${escapeHtml(meta)}</em>` : ""}${report}</div></article>`;
}

function compactEmbeddedTaskViews(batch) {
  const requested = Array.isArray(batch.requested) ? batch.requested : [];
  const results = Array.isArray(batch.results) ? batch.results : [];
  const resultsByIndex = new Map(results.map((result) => [result.index, result]));
  const indexes = new Set([...requested.map((task) => task.index), ...results.map((task) => task.index)]);
  return [...indexes].sort((left, right) => left - right).map((index) => {
    const request = requested.find((task) => task.index === index) || {};
    const result = resultsByIndex.get(index) || {};
    return { ...request, ...result, index, agent: result.agent || request.agent || "未指定代理", task: request.task || null };
  });
}

function compactEmbeddedSubagentGroupSummary(batches) {
  const counts = new Map();
  for (const batch of batches) counts.set(batch.status || "unknown", (counts.get(batch.status || "unknown") || 0) + 1);
  const outcomes = [...counts.entries()].map(([status, count]) => `${count} ${compactEmbeddedSubagentStatusLabel(status)}`);
  return [`${batches.length} 次调用`, ...outcomes].join(" · ");
}

function compactEmbeddedTaskTitle(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function compactEmbeddedSubagentStatusLabel(status) {
  return ({ succeeded: "成功", failed: "失败", invalid_request: "请求无效", rate_limited: "限流", partial: "部分完成", pending: "等待中", unknown: "结果未知" })[status] || status;
}

function compactEventsForTurn(turn) {
  return Array.isArray(turn?.compactEvents) ? turn.compactEvents : (turn?.items || []).filter((item) => item.type === "context-compact");
}

function contextEventsForTurn(turn) {
  if (Array.isArray(turn?.contextEvents)) return turn.contextEvents;
  return compactEventsForTurn(turn).map((event) => ({ ...event, contextKind: "compaction" }));
}

function compactAssistantMessages(turn) {
  if (Array.isArray(turn?.assistantMessages)) return turn.assistantMessages.filter((message) => String(message?.text || "").trim());
  return turn?.assistantMessage && String(turn.assistantMessage.text || "").trim() ? [turn.assistantMessage] : [];
}

function compactAssistantMessageLabel(message, index, count) {
  if (message?.phase === "final") return count > 1 ? `助手消息 ${index + 1} · 最终` : "助手最终消息";
  return count > 1 ? `助手消息 ${index + 1}` : "助手消息";
}

function contextUsageLabel(usage) {
  const percent = contextUsagePercent(usage);
  if (!Number.isFinite(percent)) return "";
  return `上下文 ${percent}%`;
}

function contextUsagePercent(usage) {
  const percent = Number(usage?.percent);
  if (!Number.isFinite(percent)) return null;
  return Math.max(1, Math.min(100, Math.round(percent)));
}

function contextUsageLevel(usage) {
  const percent = contextUsagePercent(usage);
  if (!Number.isFinite(percent)) return "";
  return percent > 70 ? "high" : "normal";
}

function renderContextUsageBadge(usage) {
  const label = contextUsageLabel(usage);
  if (!label) return "";
  const level = contextUsageLevel(usage);
  const detail = [usage?.used != null && usage?.limit != null ? `${compactNumber(usage.used)} / ${compactNumber(usage.limit)} tokens` : "", level === "high" ? "超过 70%" : ""]
    .filter(Boolean)
    .join(" · ");
  return `<strong class="context-usage-badge level-${escapeAttr(level)}" title="${escapeAttr(detail || label)}">${escapeHtml(label)}</strong>`;
}

function renderCompressionRefBadge(refs = []) {
  const valid = Array.isArray(refs) ? refs.filter(Boolean) : [];
  if (!valid.length) return "";
  const first = valid[0];
  const eventIndexes = [...new Set(valid.map((ref) => ref.eventIndex).filter((value) => value != null))];
  const label = `被替换 ${valid.length} 条`;
  const suffix = eventIndexes.length === 1 ? ` · 事件 ${eventIndexes[0]}` : eventIndexes.length > 1 ? ` · ${eventIndexes.length} 个事件` : "";
  const detail = [
    `当前消息组被替换 ${valid.length} 条`,
    first.compactTurnNumber ? `压缩发生在第 ${first.compactTurnNumber} 轮` : "",
    eventIndexes.length ? `事件 ${eventIndexes.join(", ")}` : "",
    first.replacementIndex != null ? `替换记录 ${first.replacementIndex}` : "",
    first.windowNumber != null ? `窗口 ${first.windowNumber}` : "",
    first.replacementItemType ? `关联项 ${first.replacementItemType}` : "",
    first.replacementRole ? `角色 ${first.replacementRole}` : "",
    formatDate(first.timestamp),
    first.summaryPreview,
  ]
    .filter(Boolean)
    .join(" · ");
  const content = `${label}${suffix}`;
  if (first.eventIndex != null) {
    return `<button class="compression-ref-badge" type="button" title="${escapeAttr(detail || content)}" data-compact-ref-event-index="${escapeAttr(String(first.eventIndex))}">${escapeHtml(content)}</button>`;
  }
  return `<strong class="compression-ref-badge" title="${escapeAttr(detail || content)}">${escapeHtml(content)}</strong>`;
}

function renderCompactMessage(kind, label, message, query, path) {
  const meta = [formatDate(message.timestamp), message.phase, message.truncated ? `已截断 ${compactNumber(message.textLength || 0)} 字符` : ""]
    .filter(Boolean)
    .join(" · ");
  const targetId = compactElementId("message", path || `${kind}-${message.turnIndex ?? "x"}-${message.itemIndex ?? message.id ?? "message"}`);
  const targetAttrs = [
    Number.isInteger(message.turnIndex) ? `data-compact-turn-index="${escapeAttr(String(message.turnIndex))}"` : "",
    Number.isInteger(message.itemIndex) ? `data-compact-item-index="${escapeAttr(String(message.itemIndex))}"` : "",
    message.sourceIndex != null ? `data-compact-message-source-index="${escapeAttr(String(message.sourceIndex))}"` : "",
    message.messageId ? `data-compact-message-id="${escapeAttr(String(message.messageId))}"` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return `
    <section class="compact-message ${kind}" id="${escapeAttr(targetId)}" tabindex="-1" ${targetAttrs}>
      <div class="compact-message-label">
        <span class="compact-message-role">${escapeHtml(label)}</span>
        ${renderContextUsageBadge(message.contextUsage)}
        ${renderCompressionRefBadge(message.compressionRefs)}
        <em>${escapeHtml(meta)}</em>
      </div>
      ${renderMarkdownMessage(message.text || "", query)}
    </section>
  `;
}

function compactMessageSearchParts(message = {}) {
  return [
    message.text,
    ...(message.compressionRefs || []).flatMap((ref) => [
      ref.compactTurnNumber != null ? `被替换到第 ${ref.compactTurnNumber} 轮` : "",
      ref.eventIndex != null ? `事件 ${ref.eventIndex}` : "",
      ref.replacementIndex != null ? `替换记录 ${ref.replacementIndex}` : "",
      ref.replacementRole,
      ref.replacementType,
      ref.replacementItemType,
      ref.replacementPreview,
      ref.summaryPreview,
    ]),
  ];
}

function renderCompactContextEvent(event, query, path) {
  if (event.contextKind === "skill-declaration" || event.contextKind === "skill-read") {
    return renderCompactSkillContextEvent(event, query, path);
  }
  const compact = event.compact || {};
  const eventPath = path || `event-${event.sourceIndex ?? event.id ?? "compact"}`;
  const targetId = compactElementId("event", eventPath);
  const sourceAttr = event.sourceIndex != null ? ` data-compact-source-index="${escapeAttr(String(event.sourceIndex))}"` : "";
  const isPiCompaction = compact.source === "pi" || compact.kind === "pi_compaction";
  const isSummary = isPiCompaction || compact.kind === "compacted" || event.eventType === "compacted";
  const label = isPiCompaction ? "Pi 上下文压缩" : isSummary ? "上下文压缩摘要" : "上下文压缩完成";
  const meta = [
    formatDate(event.timestamp),
    compact.tokensBefore != null ? `压缩前 ${compactNumber(compact.tokensBefore)} tokens` : "",
    compact.windowNumber != null ? `窗口 ${compact.windowNumber}` : "",
    compact.retainedTailCount != null ? `保留 ${compact.retainedTailCount} 条` : "",
    compact.replacementHistoryCount ? `替换历史 ${compact.replacementHistoryCount}` : "",
    event.truncated ? `已截断 ${compactNumber(event.textLength || 0)} 字符` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const rawButton =
    event.sourceIndex != null
      ? `<button class="ghost-button small" type="button" data-compact-event-index="${escapeAttr(String(event.sourceIndex))}">查看原始事件</button>`
      : "";
  const body = event.text
    ? renderMarkdownMessage(event.text, query)
    : `<div class="compact-missing">压缩完成事件没有携带摘要正文；摘要正文通常在相邻的 compacted 事件里。</div>`;
  return `
    <section class="compact-context-event phase-${escapeAttr(compact.phase || "event")}" id="${escapeAttr(targetId)}" tabindex="-1"${sourceAttr}>
      <div class="compact-context-head">
        <span class="compact-context-icon" aria-hidden="true">C</span>
        <span class="compact-context-title">
          <strong>${escapeHtml(label)}</strong>
          <em>${escapeHtml(meta)}</em>
        </span>
        ${rawButton}
      </div>
      ${renderCompactContextMeta(compact)}
      <div class="compact-context-body">${body}</div>
      ${renderCompactReplacementHistory(compact, query, "compact")}
    </section>
  `;
}

function renderCompactSkillContextEvent(event, query, path) {
  if (event.contextKind === "skill-declaration") return renderCompactSkillDeclaration(event, query, path);
  return renderCompactSkillRead(event, query, path);
}

function renderCompactSkillDeclaration(event, query, path) {
  const targetId = compactElementId("context", path || `${event.contextKind}-${event.sourceIndex ?? "x"}`);
  const sourceAttr = contextSourceAttribute(event.sourceIndex);
  const rawButton = contextRawButton(event.sourceIndex);
  const meta = [formatDate(event.timestamp), event.skill?.sourceFile || "SKILL.md"].filter(Boolean).join(" · ");
  const instruction = event.instruction?.text
    ? `<details class="compact-skill-instruction"><summary>Skill 指令</summary><div>${renderMarkdownMessage(event.instruction.text, query)}</div></details>`
    : "";
  const userText = event.userText?.text ? `<div class="compact-skill-user-text">${renderMarkdownMessage(event.userText.text, query)}</div>` : "";
  return `
    <section class="compact-context-event phase-skill" id="${escapeAttr(targetId)}" tabindex="-1"${sourceAttr}>
      <div class="compact-context-head">
        <span class="compact-context-icon" aria-hidden="true">S</span>
        <span class="compact-context-title"><strong>检测到 Skill 指令块</strong><em>${escapeHtml(meta)}</em></span>
        ${rawButton}
      </div>
      <div class="compact-skill-name">${highlight(escapeHtml(event.skill?.name || "未命名 Skill"), query)}</div>
      ${instruction}
      ${userText}
    </section>
  `;
}

function renderCompactSkillRead(event, query, path) {
  const targetId = compactElementId("context", path || `${event.contextKind}-${event.sourceIndex ?? "x"}`);
  const sourceIndex = event.outputSourceIndex ?? event.sourceIndex;
  const state = skillReadStateLabel(event.state);
  const meta = [formatDate(event.timestamp), event.completedAt ? `结束 ${formatDate(event.completedAt)}` : "", event.skill?.sourceFile || "SKILL.md", skillReadResultLabel(event.state)].filter(Boolean).join(" · ");
  const name = event.skill?.name ? `：${event.skill.name}` : "";
  return `
    <section class="compact-context-event phase-skill-read state-${escapeAttr(event.state || "attempted")}" id="${escapeAttr(targetId)}" tabindex="-1"${contextSourceAttribute(sourceIndex)}>
      <div class="compact-context-head">
        <span class="compact-context-icon" aria-hidden="true">S</span>
        <span class="compact-context-title"><strong>${escapeHtml(state)}</strong><em>${escapeHtml(meta)}</em></span>
        ${contextRawButton(sourceIndex)}
      </div>
      <div class="compact-skill-name">${highlight(escapeHtml(`${event.skill?.sourceFile || "SKILL.md"}${name}`), query)}</div>
    </section>
  `;
}

function contextSourceAttribute(sourceIndex) {
  return sourceIndex != null ? ` data-compact-source-index="${escapeAttr(String(sourceIndex))}"` : "";
}

function contextRawButton(sourceIndex) {
  return sourceIndex != null
    ? `<button class="ghost-button small" type="button" title="查看原始记录" aria-label="查看原始记录" data-compact-event-index="${escapeAttr(String(sourceIndex))}">原始记录</button>`
    : "";
}

function skillReadStateLabel(state) {
  if (state === "confirmed") return "检测到 Skill 定义读取记录";
  if (state === "failed") return "检测到 Skill 定义读取失败记录";
  return "检测到未完成的 Skill 定义读取记录";
}

function skillReadResultLabel(state) {
  if (state === "confirmed") return "工具结果成功";
  if (state === "failed") return "工具结果失败";
  return "未见工具结果";
}

function renderCompactContextMeta(compact = {}) {
  const rows = [
    ["当前窗口", compact.windowId],
    ["上一窗口", compact.previousWindowId],
    ["首个窗口", compact.firstWindowId],
  ].filter(([, value]) => value);
  if (!rows.length) return "";
  return `<div class="compact-context-meta">${rows
    .map(([label, value]) => `<span><strong>${escapeHtml(label)}</strong>${escapeHtml(String(value))}</span>`)
    .join("")}</div>`;
}

function renderCompactReplacementHistory(compact = {}, query = "", variant = "compact") {
  const preview = Array.isArray(compact.replacementHistoryPreview) ? compact.replacementHistoryPreview : [];
  const total = Number.isFinite(Number(compact.replacementHistoryCount)) ? Number(compact.replacementHistoryCount) : preview.length;
  if (!preview.length) {
    return total
      ? `<div class="compact-replacement-empty ${escapeAttr(variant)}">替换历史包含 ${escapeHtml(String(total))} 条记录；当前接口未提供可展示预览，可在原始 JSON 中查看完整原始内容。</div>`
      : "";
  }
  const more = Math.max(0, total - preview.length);
  const countLabel = `${preview.length}${more ? ` / ${total}` : ""}`;
  const coverage = compactReplacementCoverageSummary(compact, preview, total);
  return `
    <details class="compact-replacement ${escapeAttr(variant)}" open>
      <summary>
        <span>被替换的对话</span>
        <strong>${escapeHtml(countLabel)}</strong>
        ${compact.replacementHistoryPreviewTruncated || more ? `<em>还有 ${escapeHtml(String(more))} 条在原始 JSON</em>` : ""}
      </summary>
      ${coverage ? `<div class="compact-replacement-coverage">${coverage.map((item) => `<span><strong>${escapeHtml(item.value)}</strong>${escapeHtml(item.label)}</span>`).join("")}</div>` : ""}
      <div class="compact-replacement-list">
        ${preview.map((entry) => renderCompactReplacementEntry(entry, query)).join("")}
      </div>
    </details>
  `;
}

function compactReplacementCoverageSummary(compact = {}, preview = [], total = preview.length) {
  if (!preview.length) return [];
  const roles = compact.replacementRoleCounts || roleCountsFromReplacementPreview(preview);
  const roleLabel = Object.entries(roles)
    .sort((left, right) => right[1] - left[1])
    .map(([role, count]) => `${compactReplacementRoleLabel(role)} ${count}`)
    .join(" / ");
  const turnNumbers = Array.isArray(compact.replacementTurnNumbers)
    ? compact.replacementTurnNumbers
    : [
        ...new Set(
          preview
            .map((entry) => entry.turnNumber)
            .filter((value) => Number.isInteger(value)),
        ),
      ].sort((left, right) => left - right);
  const turnLabel = compactReplacementTurnRangeLabel(turnNumbers);
  const longest = preview.reduce((current, entry) => (Number(entry.textLength || 0) > Number(current?.textLength || 0) ? entry : current), preview[0]);
  const rows = [
    turnLabel ? { label: "覆盖范围", value: turnLabel } : null,
    roleLabel ? { label: "角色构成", value: roleLabel } : null,
    total ? { label: "替换条目", value: String(total) } : null,
    longest?.textLength ? { label: "最长条目", value: `替换记录 ${longest.index ?? "?"} · ${compactNumber(longest.textLength)} 字符` } : null,
  ].filter(Boolean);
  return rows;
}

function roleCountsFromReplacementPreview(preview = []) {
  const counts = {};
  for (const entry of preview) {
    const key = entry.role || entry.type || "item";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function compactReplacementTurnRangeLabel(turnNumbers = []) {
  if (!turnNumbers.length) return "";
  if (turnNumbers.length === 1) return `第 ${turnNumbers[0]} 轮`;
  const ranges = [];
  let start = turnNumbers[0];
  let previous = turnNumbers[0];
  for (const value of turnNumbers.slice(1)) {
    if (value === previous + 1) {
      previous = value;
      continue;
    }
    ranges.push(start === previous ? `第 ${start} 轮` : `第 ${start}-${previous} 轮`);
    start = value;
    previous = value;
  }
  ranges.push(start === previous ? `第 ${start} 轮` : `第 ${start}-${previous} 轮`);
  return ranges.join(", ");
}

function renderCompactReplacementEntry(entry = {}, query = "") {
  const role = String(entry.role || "unknown").toLowerCase();
  const roleLabel = compactReplacementRoleLabel(entry.role);
  const turnLabel = Number.isInteger(entry.turnNumber) ? `第 ${entry.turnNumber} 轮` : "";
  const typeLabel = [entry.type, ...(entry.contentKinds || [])].filter(Boolean).join(" / ");
  const meta = [
    entry.textLength != null ? `${compactNumber(entry.textLength)} 字符` : "",
    typeLabel,
    entry.truncated ? "已截断" : "",
    entry.turnId ? `轮次 ID ${compactReplacementShortId(entry.turnId)}` : "",
    entry.messageId ? `消息 ID ${compactReplacementShortId(entry.messageId)}` : "",
    formatDate(entry.timestamp),
  ]
    .filter(Boolean)
    .join(" · ");
  const preview = entry.preview || "[无文本内容]";
  const context = [turnLabel, entry.turnStatus, formatDate(entry.turnStartedAt)].filter(Boolean).join(" · ");
  const assistantPreview = entry.assistantPreview && entry.assistantPreview !== preview ? entry.assistantPreview : "";
  const targetAttrs = compactReplacementTargetAttrs(entry);
  const tag = targetAttrs ? "button" : "div";
  return `
    <${tag} class="compact-replacement-row role-${escapeAttr(role)}${targetAttrs ? " actionable" : ""}" ${targetAttrs || ""}>
      <span class="compact-replacement-index">替换记录 ${escapeHtml(String(entry.index ?? ""))}</span>
      <span class="compact-replacement-role">${escapeHtml(roleLabel)}</span>
      <span class="compact-replacement-copy">
        ${context ? `<strong>${escapeHtml(context)}</strong>` : ""}
        <em>${highlight(escapeHtml(preview), query)}</em>
      </span>
      <span class="compact-replacement-meta">${escapeHtml(meta)}</span>
      ${assistantPreview ? `<span class="compact-replacement-outcome"><strong>最后回复</strong>${highlight(escapeHtml(assistantPreview), query)}</span>` : ""}
    </${tag}>
  `;
}

function compactReplacementTargetAttrs(entry = {}) {
  const target = entry.replacementTarget;
  if (!target || !Number.isInteger(target.turnIndex)) return "";
  const attrs = [
    `type="button"`,
    `data-compact-replacement-target="1"`,
    `data-compact-replacement-turn-index="${escapeAttr(String(target.turnIndex))}"`,
    target.turnNumber != null ? `data-compact-replacement-turn-number="${escapeAttr(String(target.turnNumber))}"` : "",
    Number.isInteger(target.itemIndex) ? `data-compact-replacement-item-index="${escapeAttr(String(target.itemIndex))}"` : "",
    Number.isInteger(target.ownerItemIndex) ? `data-compact-replacement-owner-item-index="${escapeAttr(String(target.ownerItemIndex))}"` : "",
    `title="定位到原始消息"`,
  ];
  return attrs.filter(Boolean).join(" ");
}

function compactReplacementRoleLabel(role) {
  const value = String(role || "").toLowerCase();
  if (value === "user") return "User";
  if (value === "assistant") return "Assistant";
  if (value === "system") return "System";
  if (value === "developer") return "Developer";
  if (value === "tool") return "Tool";
  return role ? String(role) : "Item";
}

function compactReplacementShortId(value) {
  const text = String(value || "");
  if (text.length <= 18) return text;
  return `${text.slice(0, 8)}…${text.slice(-6)}`;
}
