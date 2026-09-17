{
  const api = window.SessionWorkbench;
  const { els } = api;
  const escapeHtml = (...args) => api.escapeHtml(...args);
  const evidenceScopeForSession = (...args) => api.evidenceScopeForSession(...args);
  const escapeAttr = (...args) => api.escapeAttr(...args);
  const buildEvidenceId = (...args) => api.buildEvidenceId(...args);
  const renderMarkdownTitle = (...args) => api.renderMarkdownTitle(...args);
  const compactEventsForTurn = (...args) => api.compactEventsForTurn(...args);
  const highlight = (...args) => api.highlight(...args);
  const compactEmbeddedSubagentTargetId = (...args) => api.compactEmbeddedSubagentTargetId(...args);
  const compactEmbeddedTaskViews = (...args) => api.compactEmbeddedTaskViews(...args);
  const compactEmbeddedSubagentStatusLabel = (...args) => api.compactEmbeddedSubagentStatusLabel(...args);
  const compactEmbeddedTaskTitle = (...args) => api.compactEmbeddedTaskTitle(...args);
  const formatDate = (...args) => api.formatDate(...args);
  const compactAssistantMessages = (...args) => api.compactAssistantMessages(...args);
  const cssEscape = (...args) => api.cssEscape(...args);
  const setCompactTimelineReadingTarget = (...args) => api.setCompactTimelineReadingTarget(...args);
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

  Object.assign(api, { renderCompactOutline, renderCompactExecutionDirectory, renderCompactOutlineThreadUnderTurn, renderCompactOutlineTurn, renderCompactOutlineEmbeddedSubagents, renderCompactOutlineContextEvent, compactNodeChildren, compactNodeChildEntries, compactTurnOutlineTitle, compactOutlineStats, compactElementId, scrollToCompactTarget, prefersReducedMotion, preferredScrollBehavior, scrollToCompactEvent, scrollToCompactReplacementTarget, compactReplacementTargetElement });
}
