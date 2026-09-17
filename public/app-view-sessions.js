function renderSessionList() {
  const query = els.sessionSearch.value.trim().toLowerCase();
  const filter = els.sessionTypeFilter.value;
  syncSessionTimeFilter();
  if (state.sessionsLoading && state.sessions.length === 0) {
    state.filteredSessions = [];
    els.sessionCount.textContent = "0";
    els.sessionList.innerHTML = emptyState("正在加载会话列表", (selectedSource()?.label || "当前数据源") + " · 请稍候。");
    renderStatusbar();
    return;
  }
  if (state.healthLoadError && state.sessions.length === 0) {
    state.filteredSessions = [];
    els.sessionCount.textContent = "0";
    els.sessionList.innerHTML = emptyState("接口不可用", state.healthLoadError);
    renderStatusbar();
    return;
  }
  if (state.sessionsLoadError && state.sessions.length === 0) {
    state.filteredSessions = [];
    els.sessionCount.textContent = "0";
    els.sessionList.innerHTML = emptyState("无法加载会话列表", (selectedSource()?.label || "当前数据源") + " · " + state.sessionsLoadError);
    renderStatusbar();
    return;
  }
  const sessions = state.sessions.filter((session) => {
    if (sessionTimeBucket(session) !== state.sessionTimeFilter) return false;
    if (filter === "project" && !session.cwd) return false;
    if (filter === "projectless" && session.cwd) return false;
    return true;
  });
  state.filteredSessions = sessions;
  renderSessionFilterNotice();
  els.sessionCount.textContent = String(sessions.length);
  if (!sessions.length) {
    if (state.sessionTimeFilter === "earlier" && state.historyLoading) {
      els.sessionList.innerHTML = renderSessionListActionEmptyState("正在读取更早会话", "历史会话仅在切换到该分类后读取。", []);
    } else if (state.sessionTimeFilter === "earlier" && state.historyLoadError) {
      els.sessionList.innerHTML = renderSessionListActionEmptyState("历史会话读取失败：" + state.historyLoadError, "可重试更早会话，或点击刷新列表重试。", [{ action: "retry-history", label: "重试更早会话" }]);
      bindSessionListEmptyActions();
    } else {
      els.sessionList.innerHTML = emptyState("没有匹配的会话", "调整搜索或过滤条件。");
    }
    renderStatusbar();
    return;
  }
  els.sessionList.innerHTML = renderSessionDirectoryTree(sessions, query);
  bindSessionDirectoryTree();
  els.sessionList.querySelectorAll("[data-session-id]").forEach((row) => {
    const activate = () => selectSession(row.dataset.sessionId, { immediateMobilePanel: true });
    row.addEventListener("click", (event) => { if (!event.target.closest("a")) activate(); });
    row.addEventListener("keydown", (event) => {
      if (event.target.closest("a") || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      activate();
    });
  });
  renderStatusbar();
}

function renderSessionListActionEmptyState(title, subtitle, actions = []) {
  const actionHtml = actions.length
    ? `<div class="empty-actions">${actions
        .map((action) => `<button class="ghost-button small" type="button" data-session-empty-action="${escapeAttr(action.action)}">${escapeHtml(action.label)}</button>`)
        .join("")}</div>`
    : "";
  return `<div class="empty-state"><div><strong>${escapeHtml(title)}</strong><br /><span>${escapeHtml(subtitle)}</span>${actionHtml}</div></div>`;
}

function bindSessionListEmptyActions(container = els.sessionList) {
  container.querySelectorAll("[data-session-empty-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.sessionEmptyAction;
      if (action === "return-realtime") {
        returnToRealtimeSessions();
      } else if (action === "retry-history") {
        void loadHistoricalSessions({ announce: true });
      } else if (action === "select-alternate-local-source" && state.alternateLocalSource) {
        void selectSource(state.alternateLocalSource.id);
      } else if (action === "clear-session-filters") {
        els.sessionSearch.value = "";
        els.sessionTypeFilter.value = "all";
        reloadCurrentSessionListForFilters();
      }
    });
  });
}

function mergedVisibleSessions() {
  return state.sessions;
}

function findSessionSummary(id, sourceId = state.selectedSourceId) {
  const key = sessionKey({ id, sourceId });
  return state.sessions.find((session) => sessionKey(session) === key) || state.sessions.find((session) => session.id === id) || null;
}

function currentSessionFilteredOut() {
  if (!state.selectedSessionKey) return false;
  return !state.filteredSessions.some((session) => sessionKey(session) === state.selectedSessionKey);
}

function clearSessionFiltersForSelectedSession() {
  invalidateSessionListRequests();
  els.sessionSearch.value = "";
  els.sessionTypeFilter.value = "all";
  const previousTimeFilter = state.sessionTimeFilter;
  if (state.detail?.session) {
    state.sessionTimeFilter = sessionTimeBucket(state.detail.session);
  }
  reloadCurrentSessionListForFilters();
}

function returnToRealtimeSessions() {
  const changed = state.sessionTimeFilter !== "realtime";
  if (changed) invalidateSessionListRequests();
  state.sessionTimeFilter = "realtime";
  reloadCurrentSessionListForFilters();
}

function reloadCurrentSessionListForFilters() {
  if (state.sessionTimeFilter === "earlier") {
    state.sessions = state.sessions.filter((session) => sessionTimeBucket(session) !== "earlier");
    state.historyLoaded = false;
    void loadHistoricalSessions({ announce: true });
    return;
  }
  void loadSessions({ announce: true });
}

function renderSessionFilterNotice(filteredOut = currentSessionFilteredOut()) {
  if (!els.sessionFilterNotice) return;
  els.sessionFilterNotice.hidden = !filteredOut;
  if (!filteredOut) return;
  els.sessionFilterNoticeText.textContent = "左侧列表不再包含当前正文；清除搜索、类型和时间筛选后，可重新对齐左侧索引与中间正文。";
  els.clearSessionFiltersButton.title = "清除搜索和类型筛选，并切回当前会话所属时间分类";
  els.clearSessionFiltersButton.setAttribute("aria-label", els.clearSessionFiltersButton.title);
  els.returnRealtimeButton.hidden = state.sessionTimeFilter === "realtime";
}

function selectedSessionDisplayTitle() {
  const title = state.pendingSessionTitle || findSessionSummary(state.selectedSessionId)?.displayTitle || state.selectedSessionId || "目标会话";
  return title;
}

function sessionPlaceholderState() {
  const target = selectedSessionDisplayTitle();
  if (state.healthLoadError && !state.detail?.session) return { title: "接口不可用", subtitle: state.healthLoadError };
  if (state.sessionLoading) return { title: "正在读取目标会话", subtitle: `${target} · 正在解析当前数据源中的 JSONL 事件流。` };
  if (state.sessionLoadError) return { title: "无法读取目标会话", subtitle: `${target} · ${state.sessionLoadError}` };
  if (state.sessionsLoadError && !state.detail?.session) {
    return { title: "会话列表加载失败", subtitle: `${selectedSource()?.label || "当前数据源"} · ${state.sessionsLoadError}。请确认服务仍在运行后重试。` };
  }
  return null;
}

function renderSessionPlaceholder(title, subtitle) {
  const actions = [];
  if (state.sessionLoadError && state.selectedSessionId) actions.push('<button class="ghost-button" type="button" data-session-placeholder-action="retry-detail">重新读取会话</button>');
  const action = actions.length ? `<div class="empty-state-actions">${actions.join("")}</div>` : "";
  const html = emptyState(title, subtitle, action);
  [els.threadContent, els.compactContent, els.terminalContent, els.statsContent, els.traceContent, els.rawContent]
    .filter(Boolean)
    .forEach((container) => {
      container.innerHTML = html;
      container.querySelectorAll("[data-session-placeholder-action=retry-detail]").forEach((button) => {
        button.addEventListener("click", () => selectSession(state.selectedSessionId));
      });
    });
}

function syncSessionTimeFilter() {
  els.sessionTimeFilter.querySelectorAll("[data-session-time]").forEach((button) => {
    const active = button.dataset.sessionTime === state.sessionTimeFilter;
    const copy = sessionTimeFilterCopy(button.dataset.sessionTime || "realtime");
    button.classList.toggle("active", active);
    button.setAttribute("aria-checked", active ? "true" : "false");
    button.title = copy.title;
    button.setAttribute("aria-label", copy.ariaLabel);
    button.tabIndex = active ? 0 : -1;
  });
}

function sessionTimeFilterCopy(bucket) {
  if (bucket === "realtime") return { title: "最近 3 小时内的本机会话，可直接打开正文", ariaLabel: "本机实时，小于 3 小时，可打开正文" };
  if (bucket === "day") return { title: "3 小时到 1 天内的本机会话，可直接打开正文", ariaLabel: "本机近一天，可打开正文" };
  return { title: "1 天前或未知时间的本机会话，可直接打开正文", ariaLabel: "本机更早，可打开正文" };
}

function renderSessionDirectoryTree(sessions, query) {
  const nodes = buildSessionDirectoryTree(sessions);
  return `<div class="session-directory-tree">${nodes.map((node) => renderSessionDirectoryNode(node, query)).join("")}</div>`;
}

function renderSessionDirectoryNode(node, query) {
  const key = sessionDirectoryKey(node.path);
  const forcedOpen = Boolean(query) || directoryContainsSelectedSession(node);
  const open = forcedOpen || !state.collapsedSessionDirectoryKeys.has(key);
  const directRows = nestSessionChains(node.sessions).map(({ session, depth }) => renderSessionRow(session, query, depth)).join("");
  const children = node.children.map((child) => renderSessionDirectoryNode(child, query)).join("");
  const label = node.projectless ? "无项目" : node.label;
  const countLabel = `${node.sessionCount} 个会话`;
  return `
    <details class="session-directory-node${node.projectless ? " projectless" : ""}" data-directory-key="${escapeAttr(key)}" data-directory-forced="${forcedOpen ? "true" : "false"}" ${open ? "open" : ""}>
      <summary aria-label="${escapeAttr(`${label}，${countLabel}`)}">
        <span class="session-directory-label"><span class="directory-chevron" aria-hidden="true">›</span><strong data-overflow-tooltip>${escapeHtml(label)}</strong></span>
        <span class="session-directory-count" title="${escapeAttr(countLabel)}" aria-label="${escapeAttr(countLabel)}">${node.sessionCount}</span>
      </summary>
      <div class="session-directory-contents">
        ${directRows ? `<div class="session-directory-list">${directRows}</div>` : ""}
        ${children ? `<div class="session-directory-children">${children}</div>` : ""}
      </div>
    </details>
  `;
}

function sessionDirectoryKey(path) {
  return JSON.stringify([state.selectedSourceId, path]);
}

function directoryContainsSelectedSession(node) {
  const selectedKey = state.selectedSessionKey;
  if (!selectedKey) return false;
  if (node.sessions.some((session) => sessionKey(session) === selectedKey)) return true;
  return node.children.some((child) => directoryContainsSelectedSession(child));
}

function bindSessionDirectoryTree() {
  els.sessionList.querySelectorAll("details[data-directory-key]").forEach((directory) => {
    directory.addEventListener("toggle", () => {
      const key = directory.dataset.directoryKey;
      if (!key) return;
      if (directory.dataset.directoryForced === "true") {
        if (!directory.open) directory.open = true;
        return;
      }
      if (directory.open) state.collapsedSessionDirectoryKeys.delete(key);
      else state.collapsedSessionDirectoryKeys.add(key);
    });
  });
}

function renderSessionRow(session, query, chainDepth = 0) {
  const active = sessionKey(session) === state.selectedSessionKey ? " active" : "";
  const chainChild = chainDepth > 0 ? " chain-child chain-depth-" + Math.min(chainDepth, 4) : "";
  const cwd = session.cwd ? shortPath(session.cwd) : "无项目";
  const agentName = session.agentNickname || "Codex";
  const agent = session.agentNickname ? session.agentNickname + "/" + (session.agentRole || "agent") : "Codex";
  const model = session.model || session.modelProvider || "";
  const status = sessionStatusLabel(session.status);
  const chainLabel = chainDepth > 0 ? "分叉链第 " + String(chainDepth + 1) + " 节点" : "";
  const displayTitle = session.displayTitle || "未命名会话";
  const ariaLabel = displayTitle + (chainLabel ? "，" + chainLabel : "") + (active ? "，当前会话" : "");
  const title = chainLabel ? ' title="' + escapeAttr(chainLabel) + '"' : "";
  return '<div class="session-row' + active + chainChild + '" role="button" tabindex="0"' + (active ? ' aria-current="true"' : "") + ' data-session-id="' + escapeAttr(session.id) + '" data-evidence-id="' + escapeAttr(sessionEvidenceId(session)) + '"' + title + ' aria-label="' + escapeAttr(ariaLabel) + '">'
    + '<span class="agent-dot" data-agent="' + escapeAttr(agentName.toLowerCase()) + '" aria-hidden="true"></span>'
    + '<span class="session-title-wrap"><span class="session-title markdown-inline-title" data-overflow-tooltip>' + renderMarkdownTitle(displayTitle, query) + '</span>' + (chainDepth > 0 ? '<span class="session-chain-badge" aria-hidden="true">分叉</span>' : "") + '</span>'
    + '<span class="session-date">' + formatShortDate(session.updatedAt || session.fileModifiedAt) + '</span>'
    + '<span class="session-meta"><span data-overflow-tooltip>' + escapeHtml(agent) + '</span>' + (model ? '<span data-overflow-tooltip>' + escapeHtml(model) + '</span>' : "") + (status ? '<span data-overflow-tooltip>' + escapeHtml(status) + '</span>' : "") + '<span data-overflow-tooltip>' + escapeHtml(cwd) + '</span></span>'
    + '<span class="session-source" data-overflow-tooltip>' + escapeHtml(session.sourceLabel || selectedSource()?.label || "") + '</span></div>';
}

function evidenceScopeForSession(session = {}, inherited = {}) {
  const activeSession = state.detail?.session || {};
  return {
    sourceId: session.sourceId || inherited.sourceId || activeSession.sourceId || state.selectedSourceId,
    sessionId: session.id || inherited.sessionId || activeSession.id || state.selectedSessionId,
  };
}

function sessionEvidenceId(session) {
  return buildEvidenceId({ ...evidenceScopeForSession(session), threadPath: "root", entity: "session" });
}

function rawEventEvidenceId(event) {
  return buildEvidenceId({ ...evidenceScopeForSession(), threadPath: "root", eventIndex: event.index, entity: "event" });
}

function traceNodeEvidenceId(node) {
  const item = node.detail?.item || {};
  return buildEvidenceId({
    ...evidenceScopeForSession(),
    threadNodeId: node.id,
    turnNumber: item.turnIndex == null ? undefined : item.turnIndex + 1,
    eventIndex: item.sourceIndex ?? item.outputSourceIndex,
    entity: "trace-node",
  });
}

function itemEvidenceId(item) {
  return buildEvidenceId({
    ...evidenceScopeForSession(),
    threadPath: "root",
    turnNumber: item.turnIndex == null ? undefined : item.turnIndex + 1,
    eventIndex: item.sourceIndex ?? item.outputSourceIndex,
    entity: "item",
  });
}

function sessionStatusLabel(status) {
  if (status === "completed") return "已完成";
  if (status === "failed") return "失败";
  if (status === "aborted") return "已中断";
  if (status === "waiting") return "等待输入";
  if (status === "running") return "运行中";
  return "";
}

function renderThreadHeader() {
  const session = state.detail?.session;
  if (!session) {
    const placeholder = sessionPlaceholderState();
    els.sessionTitle.textContent = placeholder?.title || "选择一个会话";
    els.sessionMetaLabel.textContent = placeholder?.subtitle || selectedSource()?.label || "未选择";
    renderSessionLineage();
    renderSessionHandoff();
    return;
  }
  els.sessionTitle.innerHTML = renderMarkdownTitle(session.title || "未命名会话");
  const parts = [session.sourceLabel || selectedSource()?.label, session.model, session.reasoningEffort, formatDate(session.updatedAt)].filter(Boolean);
  els.sessionMetaLabel.textContent = parts.join(" · ") || session.id;
  renderSessionLineage();
  renderSessionHandoff();
}

function renderSessionLineage() {
  const container = els.sessionLineage;
  if (!container) return;
  const related = state.detail?.related;
  if (!related || (!related.parentId && !related.children?.length)) {
    container.hidden = true;
    container.innerHTML = "";
    return;
  }
  const segments = [];
  if (related.parentId) {
    const label = related.parent?.title || `${String(related.parentId).slice(0, 8)}…`;
    segments.push(
      related.parent
        ? `<button class="lineage-link" type="button" data-lineage-session="${escapeAttr(related.parent.id)}" title="${escapeAttr(`打开父会话：${label}`)}">⤴ 分叉自 ${escapeHtml(label)}</button>`
        : `<span class="lineage-plain">⤴ 分叉自 ${escapeHtml(label)}（不在当前目录）</span>`,
    );
  }
  if (related.chain?.length > 0) {
    segments.push(`<span class="lineage-plain">链上第 ${related.chain.length + 1} 段</span>`);
  }
  if (related.children?.length) {
    const childLinks = related.children
      .map((child) => `<button class="lineage-link" type="button" data-lineage-session="${escapeAttr(child.id)}" title="${escapeAttr(`打开分叉会话：${child.title}`)}">${escapeHtml(child.title)}</button>`)
      .join("");
    segments.push(`<span class="lineage-plain">分叉出 ${related.children.length} 个会话：</span>${childLinks}`);
  }
  container.hidden = false;
  container.innerHTML = segments.join("");
  container.querySelectorAll("[data-lineage-session]").forEach((button) => {
    button.addEventListener("click", () => {
      selectSession(button.dataset.lineageSession, { immediateMobilePanel: true });
    });
  });
}

function renderStats() {
  if (state.viewMode !== "diagnostic") {
    els.statsStrip.innerHTML = "";
    els.statsStrip.hidden = true;
    return;
  }
  const stats = state.detail?.stats;
  if (!stats) {
    els.statsStrip.innerHTML = "";
    els.statsStrip.hidden = true;
    return;
  }
  els.statsStrip.hidden = false;
  const tokenUsage = latestTokenUsage(state.detail.turns);
  const contextTokens = tokenUsageTotal(tokenUsage);
  const rows = [
    ["事件", stats.eventCount, "事件流"],
    ["工具", countItems("tool-call"), "工具调用"],
    ...(Number.isFinite(contextTokens) ? [["占用", compactNumber(contextTokens), "上下文占用"]] : []),
  ];
  els.statsStrip.innerHTML = rows
    .map(
      ([label, value, hint]) => `
        <div class="stat">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(String(value))}</strong>
          <em>${escapeHtml(hint)}</em>
        </div>
      `,
    )
    .join("");
}

function renderSessionHandoff() {
  if (!els.sessionHandoff) return;
  const detail = state.detail;
  if (!detail) {
    els.sessionHandoff.hidden = true;
    els.sessionHandoff.innerHTML = "";
    return;
  }
  const facts = sessionHandoffFacts(detail);
  els.sessionHandoff.hidden = false;
  els.sessionHandoff.innerHTML = `
    <div class="handoff-head"><span>交接摘要</span><em>基于当前会话派生数据</em></div>
    <div class="handoff-grid">${facts.map((fact, index) => renderHandoffFact(fact, index + 1)).join("")}</div>
  `;
  els.sessionHandoff.querySelectorAll("[data-handoff-target]").forEach((button) => {
    button.addEventListener("click", () => openHandoffFact(button.dataset.handoffTarget));
  });
}

function sessionHandoffFacts(detail) {
  const turns = detail.turns || [];
  const items = turns.flatMap((turn) => turn.items || []);
  const firstUser = items.find((item) => item.type === "user-message" && String(item.text || "").trim());
  const lastAssistant = [...items].reverse().find((item) => item.type === "assistant-message" && String(item.text || "").trim());
  const tools = items.filter((item) => item.type === "tool-call");
  return [
    ...(firstUser ? [handoffFact("目标", firstUser.text, "compact")] : []),
    ...(handoffSessionStatus(detail) ? [handoffFact("当前状态", handoffSessionStatus(detail), "compact")] : []),
    ...(lastAssistant ? [handoffFact("最新回复", lastAssistant.text, "compact")] : []),
    handoffFact("执行", tools.length ? String(tools.length) + " 次工具调用" : "没有工具调用", "trace"),
    handoffFact("轮次", String(turns.length) + " 轮对话", "compact"),
    handoffFact("子代理", handoffChildText(detail), "trace"),
  ];
}

function handoffSessionStatus(detail) {
  const latestTurn = detail.turns?.at(-1) || {};
  return sessionStatusLabel(latestTurn.status || detail.session?.status);
}

function handoffChildText(detail) {
  const childCount = detail.trace?.hierarchy?.children?.length || 0;
  const embeddedCount = (detail.turns || []).flatMap((turn) => turn.items || []).filter((item) => item.embeddedSubagents).length;
  const parts = [childCount ? `${childCount} 个子会话` : "无独立子会话"];
  if (embeddedCount) parts.push(`${embeddedCount} 次内嵌调用`);
  return parts.join(" · ");
}

function handoffFact(label, value, target) {
  return { label, value: String(value || ""), target };
}

function tokenUsageTotal(usage) {
  for (const value of [usage?.total_tokens, usage?.totalTokens]) {
    const total = Number(value);
    if (Number.isFinite(total)) return total;
  }
  return null;
}
