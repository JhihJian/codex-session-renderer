{
  const api = window.SessionWorkbench;
  const formatDate = (...args) => api.formatDate(...args);
  const compactNumber = (...args) => api.compactNumber(...args);
  const compactElementId = (...args) => api.compactElementId(...args);
  const escapeAttr = (...args) => api.escapeAttr(...args);
  const escapeHtml = (...args) => api.escapeHtml(...args);
  const renderContextUsageBadge = (...args) => api.renderContextUsageBadge(...args);
  const renderCompressionRefBadge = (...args) => api.renderCompressionRefBadge(...args);
  const renderMarkdownMessage = (...args) => api.renderMarkdownMessage(...args);
  const highlight = (...args) => api.highlight(...args);
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

  Object.assign(api, { renderCompactMessage, compactMessageSearchParts, renderCompactContextEvent, renderCompactSkillContextEvent, renderCompactSkillDeclaration, renderCompactSkillRead, contextSourceAttribute, contextRawButton, skillReadStateLabel, skillReadResultLabel, renderCompactContextMeta, renderCompactReplacementHistory, compactReplacementCoverageSummary, roleCountsFromReplacementPreview, compactReplacementTurnRangeLabel, renderCompactReplacementEntry, compactReplacementTargetAttrs, compactReplacementRoleLabel, compactReplacementShortId });
}
