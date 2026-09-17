{
  const api = window.SessionWorkbench;
  const compactAssistantMessages = (...args) => api.compactAssistantMessages(...args);
  const contextEventsForTurn = (...args) => api.contextEventsForTurn(...args);
  const compactMessageSearchParts = (...args) => api.compactMessageSearchParts(...args);
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


  Object.assign(api, { filterCompactNode, filterCompactTurn, compactTurnMatches, compactSpecialTurnMatch, compactStandardTurnMatch, compactTurnQueryMatches, compactContextEventFlags, compactNodeMatchesType, compactSearchText, compactTurnSearchText, compactContextEventSearchParts });
}
