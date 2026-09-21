{
  const api = window.SessionWorkbench;
  const { state, els } = api;
  const syncViewControls = (...args) => api.syncViewControls(...args);
  const sessionPlaceholderState = (...args) => api.sessionPlaceholderState(...args);
  const renderSessionPlaceholder = (...args) => api.renderSessionPlaceholder(...args);
  const renderRawView = (...args) => api.renderRawView(...args);
  const renderStatsInfoView = (...args) => api.renderStatsInfoView(...args);
  const renderTrace = (...args) => api.renderTrace(...args);
  const emptyState = (...args) => api.emptyState(...args);
  const itemMatches = (...args) => api.itemMatches(...args);
  const renderTurn = (...args) => api.renderTurn(...args);
  const selectItemRef = (...args) => api.selectItemRef(...args);
  let compactTimelineObserver = api.compactTimelineObserver;
  const filterCompactNode = (...args) => api.filterCompactNode(...args);
  const renderCompactThread = (...args) => api.renderCompactThread(...args);
  const selectSession = (...args) => api.selectSession(...args);
  const openRawEvent = (...args) => api.openRawEvent(...args);
  const scrollToCompactEvent = (...args) => api.scrollToCompactEvent(...args);
  const scrollToCompactReplacementTarget = (...args) => api.scrollToCompactReplacementTarget(...args);
  const scrollToCompactTarget = (...args) => api.scrollToCompactTarget(...args);
  const contextEventsForTurn = (...args) => api.contextEventsForTurn(...args);
  const compactElementId = (...args) => api.compactElementId(...args);
  const formatTimingDuration = (...args) => api.formatTimingDuration(...args);
  const escapeAttr = (...args) => api.escapeAttr(...args);
  const escapeHtml = (...args) => api.escapeHtml(...args);
  let compactTimelineJumpTarget = api.compactTimelineJumpTarget;
  const cssEscape = (...args) => api.cssEscape(...args);
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

  Object.assign(api, { renderMainContent, renderThread, renderCompact, renderCompactTimeline, compactTimelineEntries, compactTimelineEntry, compactTurnDuration, aggregateCompactTimelineEntries, withCompactTimelineWeights, renderCompactTimelineEntry, bindCompactTimeline, handleCompactTimelineKeydown, observeCompactTimelineTargets, setCompactTimelineReadingTarget, buildCompactFallback, compactTurnFallback, compactMessageFallback, compactEventFallback });
}
