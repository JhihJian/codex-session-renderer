import { firstLine, normalizeText } from "./text-utils.mjs";
import { safeStringifyRedacted } from "./session-normalizer.mjs";
import { cleanUserMessageText, isUsefulUserMessageText } from "./user-message-cleanup.mjs";
import {
  addTruncatedField,
  compactTraceInfo,
  contextUsageForAssistantMessage,
  contextUsageFromTokenInfo,
  limitText,
  toMs,
} from "./session-projection-shared.mjs";

function compactTurnsForClient(turns) {
  return turns.map((turn, turnIndex) => ({
    ...turn,
    turnNumber: turnIndex + 1,
    items: turn.items.map((item, itemIndex) =>
      compactItemForClient(item, turnIndex, itemIndex, {
        contextUsage: item.type === "assistant-message" ? contextUsageForAssistantMessage(turn.items, itemIndex) : null,
      }),
    ),
  }));
}

function compactItemForClient(item, turnIndex, itemIndex, options = {}) {
  const base = {
    id: item.id,
    type: item.type,
    turnIndex,
    itemIndex,
  };
  if (item.sourceIndex != null) base.sourceIndex = item.sourceIndex;
  if (item.outputSourceIndex != null) base.outputSourceIndex = item.outputSourceIndex;
  if (item.timestamp) base.timestamp = item.timestamp;
  if (item.completedAt) base.completedAt = item.completedAt;
  if (item.phase) base.phase = item.phase;
  if (item.role) base.role = item.role;
  if (item.name) base.name = item.name;
  if (item.callId) base.callId = item.callId;
  if (item.messageId) base.messageId = item.messageId;
  if (item.status) base.status = item.status;
  if (item.eventType) base.eventType = item.eventType;
  if (item.responseType) base.responseType = item.responseType;
  if (item.encrypted) base.encrypted = true;
  if (item.reasoning) {
    base.reasoning = item.reasoning;
    if (item.reasoning.encrypted) base.encrypted = true;
  }
  if (item.compact) base.compact = item.compact;
  if (item.embeddedSubagents) base.embeddedSubagents = item.embeddedSubagents;
  if (item.attachments?.length) base.attachments = item.attachments;
  const info = compactTraceInfo(item.info);
  if (info) base.info = info;
  if (item.tokenUsage) base.tokenUsage = item.tokenUsage;
  if (options.contextUsage) base.contextUsage = options.contextUsage;

  if (item.text != null) {
    const text = String(item.text);
    base.text = text;
    base.textLength = text.length;
  }
  if (item.arguments != null) {
    const args = String(item.arguments);
    base.arguments = args;
    base.argumentsLength = args.length;
  }
  if (item.output != null) {
    const output = String(item.output);
    base.output = output;
    base.outputLength = output.length;
  }
  if (item.payload != null || item.info != null) {
    const source = item.payload ?? item.info;
    const limited = limitText(safeStringifyRedacted(source, 2));
    base.payloadPreview = limited.text;
    base.payloadLength = limited.originalLength;
    if (limited.truncated) addTruncatedField(base, "payload");
  }
  if (base.truncatedFields?.length) base.truncated = true;
  return base;
}

function compactTurnForView(turn, turnIndex, children, context = {}) {
  const turnLookup = context.turnLookup || compactReplacementTurnLookup(context.turns);
  const compressionRefsByItem = context.compressionRefsByItem || compactCompressionRefsByItem(context.turns);
  const userMessages = turn.items
    .map((item, itemIndex) =>
      item.type === "user-message" && normalizeText(item.text)
        ? compactUserMessageForView(item, { turnIndex, itemIndex, compressionRefs: compactCompressionRefsForItem(compressionRefsByItem, turnIndex, itemIndex) })
        : null,
    )
    .filter(Boolean);
  const assistantMessages = turn.items
    .map((item, itemIndex) =>
      item.type === "assistant-message" && normalizeText(item.text)
        ? compactMessageForView(item, {
            turnIndex,
            itemIndex,
            contextUsage: contextUsageForAssistantMessage(turn.items, itemIndex),
            compressionRefs: compactCompressionRefsForItem(compressionRefsByItem, turnIndex, itemIndex),
          })
        : null,
    )
    .filter(Boolean);
  const assistant = assistantMessages.at(-1) || null;
  const contextEvents = compactContextEventsForTurn(turn, { turnLookup, turns: context.turns });
  const compactEvents = contextEvents.filter((event) => event.contextKind === "compaction");
  const embeddedSubagents = turn.items
    .map((item, itemIndex) => (item.embeddedSubagents ? compactEmbeddedSubagentsForView(item, turnIndex, itemIndex) : null))
    .filter(Boolean);
  const metrics = compactTurnMetrics(turn.items, context.timing);
  return {
    id: turn.id,
    turnNumber: turnIndex + 1,
    startedAt: turn.startedAt || null,
    completedAt: turn.completedAt || null,
    status: turn.status || null,
    userMessages,
    assistantMessages,
    assistantMessage: assistant,
    compactEvents,
    contextEvents,
    embeddedSubagents,
    metrics,
    children,
  };
}

function compactTurnMetrics(items = [], timing = null) {
  const endingContextUsage = [...items]
    .reverse()
    .map((item) => item.type === "token-count" ? contextUsageFromTokenInfo(item.info) : null)
    .find(Boolean) || null;
  const generatedTokens = items.reduce((total, item) => {
    const value = Number(item.tokenUsage?.generatedTokens);
    return Number.isFinite(value) ? total + value : total;
  }, 0);
  const metrics = { endingContextUsage, generatedTokens: generatedTokens || null };
  if (Number.isFinite(timing?.activeRunMs) && timing.confidence !== "unavailable") {
    metrics.activeRunMs = timing.activeRunMs;
    metrics.executionConfidence = timing.confidence || "unavailable";
  }
  return metrics;
}

function compactContextEventsForTurn(turn, context = {}) {
  return (turn.items || []).flatMap((item) => {
    if (item.type === "context-compact") {
      return [{ ...compactContextEventForView(item, context), contextKind: "compaction" }];
    }
    if (item.skillDeclaration) return [compactSkillDeclarationForView(item)];
    if (item.skillRead) return [compactSkillReadForView(item)];
    return [];
  });
}

function compactSkillDeclarationForView(item) {
  const declaration = item.skillDeclaration || {};
  return {
    contextKind: "skill-declaration",
    timestamp: item.timestamp || null,
    sourceIndex: item.sourceIndex ?? null,
    skill: { name: declaration.name || "未命名 Skill", sourceFile: declaration.sourceFile || "SKILL.md" },
    instruction: limitText(declaration.instruction || ""),
    userText: limitText(declaration.userText || ""),
  };
}

function compactSkillReadForView(item) {
  const read = item.skillRead || {};
  const state = item.output == null ? "attempted" : item.status === "failed" ? "failed" : "confirmed";
  return {
    contextKind: "skill-read",
    timestamp: item.timestamp || null,
    completedAt: item.completedAt || null,
    sourceIndex: item.sourceIndex ?? null,
    outputSourceIndex: item.outputSourceIndex ?? null,
    state,
    skill: { name: read.skillNameHint || null, sourceFile: read.sourceFile || "SKILL.md" },
  };
}

function compactEmbeddedSubagentsForView(item, turnIndex, itemIndex) {
  const batch = item.embeddedSubagents;
  return {
    id: item.id,
    callId: item.callId || null,
    turnIndex,
    itemIndex,
    sourceIndex: item.sourceIndex ?? null,
    outputSourceIndex: item.outputSourceIndex ?? null,
    timestamp: item.timestamp || null,
    completedAt: item.completedAt || null,
    mode: batch.mode || "single",
    agentScope: batch.agentScope || null,
    status: batch.status || "unknown",
    requested: batch.requested || [],
    results: batch.results || [],
  };
}

function compactUserMessageForView(item, options = {}) {
  const text = cleanCompactUserText(item.skillDeclaration?.userText || item.text);
  if (!isUsefulCompactUserText(text)) return null;
  return compactMessageForView({ ...item, text }, options);
}

function compactMessageForView(item, options = {}) {
  const limited = limitText(item.text || "");
  const message = {
    id: item.id,
    type: item.type,
    timestamp: item.timestamp || null,
    phase: item.phase || null,
    role: item.role || null,
    text: limited.text,
    textLength: limited.originalLength,
    truncated: limited.truncated,
  };
  if (item.sourceIndex != null) message.sourceIndex = item.sourceIndex;
  if (Number.isInteger(options.turnIndex)) message.turnIndex = options.turnIndex;
  if (Number.isInteger(options.itemIndex)) message.itemIndex = options.itemIndex;
  if (item.messageId) message.messageId = item.messageId;
  if (options.contextUsage) message.contextUsage = options.contextUsage;
  if (options.compressionRefs?.length) message.compressionRefs = options.compressionRefs;
  return message;
}

function compactContextEventForView(item, context = {}) {
  const compact = item.compact || {};
  const text = item.text || compact.message || "";
  const limited = limitText(text);
  return {
    id: item.id,
    type: item.type,
    timestamp: item.timestamp || null,
    eventType: item.eventType || compact.kind || null,
    sourceIndex: item.sourceIndex ?? null,
    text: limited.text,
    textLength: limited.originalLength,
    truncated: limited.truncated,
    compact: compactForView(compact, context),
  };
}

function compactForView(compact, context = {}) {
  const replacementHistoryPreview = Array.isArray(compact.replacementHistoryPreview)
    ? compact.replacementHistoryPreview.map((entry) => compactReplacementEntryForView(entry, context))
    : [];
  const roleCounts = compactReplacementRoleCounts(replacementHistoryPreview);
  const turnNumbers = [
    ...new Set(
      replacementHistoryPreview
        .map((entry) => entry.turnNumber)
        .filter((value) => Number.isInteger(value)),
    ),
  ].sort((left, right) => left - right);
  return {
    ...compact,
    message: undefined,
    replacementHistoryPreview,
    replacementRoleCounts: roleCounts,
    replacementTurnNumbers: turnNumbers,
  };
}

function compactReplacementTurnLookup(turns = []) {
  const lookup = new Map();
  for (const [index, turn] of (turns || []).entries()) {
    if (!turn?.id) continue;
    const user = (turn.items || []).find((item) => item.type === "user-message" && normalizeText(item.text));
    const assistant = [...(turn.items || [])].reverse().find((item) => item.type === "assistant-message" && normalizeText(item.text));
    lookup.set(turn.id, {
      turnIndex: index,
      turnNumber: index + 1,
      turnStatus: turn.status || null,
      turnStartedAt: turn.startedAt || null,
      turnCompletedAt: turn.completedAt || null,
      userPreview: user ? firstLine(cleanCompactUserText(user.text || "")) : "",
      assistantPreview: assistant ? firstLine(assistant.text || "") : "",
    });
  }
  return lookup;
}

function compactReplacementEntryForView(entry, context = {}) {
  const turnLookup = context.turnLookup;
  if (!entry || !turnLookup || !entry.turnId) return entry;
  const turn = turnLookup.get(entry.turnId);
  if (!turn) return entry;
  const result = {
    ...entry,
    ...turn,
  };
  const target = compactReplacementTargetForView(context.turns, entry, turn);
  if (target) result.replacementTarget = target;
  return result;
}

function compactReplacementTargetForView(turns = [], entry = {}, turn = null) {
  const target = compactReplacementTargetItem(turns, entry);
  if (!target) {
    return Number.isInteger(turn?.turnIndex)
      ? {
          turnIndex: turn.turnIndex,
          turnNumber: turn.turnNumber,
          itemIndex: null,
          ownerItemIndex: null,
          itemType: null,
          ownerItemType: null,
        }
      : null;
  }
  const ownerItemIndex = compactCompressionOwnerItemIndex(target.turn.items, target.itemIndex);
  const ownerItem = Number.isInteger(ownerItemIndex) ? target.turn.items[ownerItemIndex] : null;
  return {
    turnIndex: target.turnIndex,
    turnNumber: target.turnIndex + 1,
    itemIndex: target.itemIndex,
    ownerItemIndex: Number.isInteger(ownerItemIndex) ? ownerItemIndex : null,
    itemType: target.item?.type || null,
    ownerItemType: ownerItem?.type || null,
  };
}

function compactReplacementRoleCounts(preview) {
  const counts = {};
  for (const entry of preview || []) {
    const key = entry?.role || entry?.type || "item";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function compactCompressionRefsByItem(turns = []) {
  const refs = new Map();
  for (const [compactTurnIndex, turn] of (turns || []).entries()) {
    for (const item of turn?.items || []) {
      const preview = item.compact?.replacementHistoryPreview;
      if (item.type !== "context-compact" || !Array.isArray(preview) || preview.length === 0) continue;
      for (const entry of preview) {
        const target = compactReplacementTargetItem(turns, entry);
        if (!target) continue;
        const ownerIndex = compactCompressionOwnerItemIndex(target.turn.items, target.itemIndex);
        if (!Number.isInteger(ownerIndex)) continue;
        const ref = {
          compactTurnNumber: compactTurnIndex + 1,
          eventIndex: item.sourceIndex ?? null,
          eventType: item.eventType || item.compact?.kind || null,
          replacementIndex: entry.index ?? null,
          replacementRole: entry.role || null,
          replacementType: entry.type || null,
          replacementItemType: target.item?.type || null,
          windowNumber: item.compact?.windowNumber ?? null,
          timestamp: item.timestamp || null,
          summaryPreview: firstLine(item.text || item.compact?.message || ""),
          replacementPreview: firstLine(entry.preview || ""),
        };
        const key = compactCompressionItemKey(target.turnIndex, ownerIndex);
        const existing = refs.get(key) || [];
        if (!existing.some((candidate) => candidate.eventIndex === ref.eventIndex && candidate.replacementIndex === ref.replacementIndex)) {
          existing.push(ref);
        }
        refs.set(key, existing);
      }
    }
  }
  return refs;
}

function compactCompressionRefsForItem(refsByItem, turnIndex, itemIndex) {
  if (!refsByItem || !Number.isInteger(turnIndex) || !Number.isInteger(itemIndex)) return [];
  return refsByItem.get(compactCompressionItemKey(turnIndex, itemIndex)) || [];
}

function compactCompressionItemKey(turnIndex, itemIndex) {
  return `${turnIndex}:${itemIndex}`;
}

function compactReplacementTargetItem(turns = [], entry = {}) {
  if (!entry?.turnId) return null;
  const turnIndex = turns.findIndex((turn) => turn?.id === entry.turnId);
  if (turnIndex < 0) return null;
  const turn = turns[turnIndex];
  const itemIndex = compactReplacementTargetItemIndex(turn.items || [], entry);
  if (!Number.isInteger(itemIndex)) return null;
  return { turn, turnIndex, itemIndex, item: turn.items[itemIndex] };
}

function compactReplacementTargetItemIndex(items = [], entry = {}) {
  const messageId = normalizeText(entry.messageId);
  if (messageId) {
    const index = items.findIndex((item) => item.messageId === messageId || item.id === messageId);
    if (index >= 0) return index;
  }

  const callId = normalizeText(entry.callId);
  if (callId) {
    const index = items.findIndex((item) => item.callId === callId || item.id === callId);
    if (index >= 0) return index;
  }

  const candidates = compactReplacementCandidateIndexes(items, entry);
  if (!candidates.length) return null;
  const preview = normalizeText(entry.preview).toLowerCase();
  if (preview) {
    const matched = candidates.find((index) => compactReplacementItemSearchText(items[index]).includes(preview) || preview.includes(firstLine(compactReplacementItemSearchText(items[index]), 80)));
    if (Number.isInteger(matched)) return matched;
  }
  if (candidates.length === 1) return candidates[0];

  const timestamp = toMs(entry.timestamp);
  if (timestamp != null) {
    const before = [...candidates].reverse().find((index) => {
      const itemTime = toMs(items[index]?.timestamp);
      return itemTime != null && itemTime <= timestamp;
    });
    if (Number.isInteger(before)) return before;
  }

  const role = String(entry.role || "").toLowerCase();
  if (role === "assistant") return candidates.at(-1);
  return candidates[0];
}

function compactReplacementCandidateIndexes(items = [], entry = {}) {
  const role = String(entry.role || "").toLowerCase();
  const type = String(entry.type || "").toLowerCase();
  const contentKinds = Array.isArray(entry.contentKinds) ? entry.contentKinds.map((kind) => String(kind).toLowerCase()) : [];

  return items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => {
      if (role === "user") return item.type === "user-message";
      if (role === "assistant") return item.type === "assistant-message";
      if (role === "tool") return item.type === "tool-call";
      if (/function|tool|call/.test(type) || contentKinds.some((kind) => /tool|function|call/.test(kind))) return item.type === "tool-call";
      if (/reasoning/.test(type)) return item.type === "reasoning";
      return item.type === "user-message" || item.type === "assistant-message" || item.type === "tool-call" || item.type === "reasoning";
    })
    .map(({ index }) => index);
}

function compactReplacementItemSearchText(item = {}) {
  return [item.text, item.arguments, item.output, item.name, item.callId, item.messageId].filter(Boolean).join(" ").toLowerCase();
}

function compactCompressionOwnerItemIndex(items = [], itemIndex) {
  const item = items[itemIndex];
  if (!item) return null;
  if (item.type === "user-message" || item.type === "assistant-message") return itemIndex;
  const previousAssistant = items
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate, index }) => index <= itemIndex && candidate.type === "assistant-message" && normalizeText(candidate.text))
    .at(-1);
  if (previousAssistant) return previousAssistant.index;
  const nextAssistant = items.findIndex((candidate, index) => index > itemIndex && candidate.type === "assistant-message" && normalizeText(candidate.text));
  return nextAssistant >= 0 ? nextAssistant : null;
}


function cleanCompactUserText(text) {
  return cleanUserMessageText(text);
}

function isUsefulCompactUserText(text) {
  return isUsefulUserMessageText(text);
}


export { compactTurnsForClient, compactTurnForView };
