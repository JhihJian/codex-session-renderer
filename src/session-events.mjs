import {
  classifyEvent,
  extractTitleFromEvents,
  isImportantEvent,
  summarizeEventPreview,
  summarizeEventTitle,
  summarizeSessionEvents,
} from "./event-summary.mjs";
import {
  eventTime,
  extractContentText,
  fileTimeMs,
  firstLine,
  normalizeSlash,
  normalizeText,
  sessionIdFromFile,
  sessionStartedFromFile,
  toIso,
} from "./text-utils.mjs";
import { coalesceNormalizedEvents, normalizeSessionEvent, safeStringifyRedacted } from "./session-normalizer.mjs";
import {
  isStandaloneToolEvent,
  isToolCallOutput,
  isToolCallStart,
  mergeToolOutput,
  toolArgumentsFromPayload,
  toolNameFromPayload,
  toolOutputFromPayload,
} from "./tool-events.mjs";
export { renderConversationMarkdown } from "./markdown-export.mjs";
export {
  classifyEvent,
  eventTime,
  extractContentText,
  extractTitleFromEvents,
  fileTimeMs,
  firstLine,
  isImportantEvent,
  normalizeSlash,
  normalizeText,
  sessionIdFromFile,
  sessionStartedFromFile,
  summarizeEventPreview,
  summarizeEventTitle,
  summarizeSessionEvents,
  toIso,
  normalizeSessionEvent,
};

const previewLimits = {
  message: 1800,
  toolArguments: 800,
  toolOutput: 800,
  payload: 700,
  traceText: 160,
  traceArguments: 160,
  traceOutput: 160,
  compactMessage: 2400,
};

function compactTurnsForClient(turns) {
  return turns.map((turn, turnIndex) => ({
    ...turn,
    turnNumber: turnIndex + 1,
    items: turn.items.map((item, itemIndex) => compactItemForClient(item, turnIndex, itemIndex)),
  }));
}

function compactItemForClient(item, turnIndex, itemIndex) {
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
  if (item.status) base.status = item.status;
  if (item.eventType) base.eventType = item.eventType;
  if (item.responseType) base.responseType = item.responseType;
  if (item.encrypted) base.encrypted = true;
  if (item.reasoning) {
    base.reasoning = item.reasoning;
    if (item.reasoning.encrypted) base.encrypted = true;
  }
  if (item.attachments?.length) base.attachments = item.attachments;
  const info = compactTraceInfo(item.info);
  if (info) base.info = info;

  if (item.text != null) {
    const limited = limitText(item.text, previewLimits.message);
    base.text = limited.text;
    base.textLength = limited.originalLength;
    if (limited.truncated) addTruncatedField(base, "text");
  }
  if (item.arguments != null) {
    const limited = limitText(item.arguments, previewLimits.toolArguments);
    base.arguments = limited.text;
    base.argumentsLength = limited.originalLength;
    if (limited.truncated) addTruncatedField(base, "arguments");
  }
  if (item.output != null) {
    const output = String(item.output);
    base.output = output;
    base.outputLength = output.length;
  }
  if (item.payload != null || item.info != null) {
    const source = item.payload ?? item.info;
    const limited = limitText(safeStringifyRedacted(source, 2), previewLimits.payload);
    base.payloadPreview = limited.text;
    base.payloadLength = limited.originalLength;
    if (limited.truncated) addTruncatedField(base, "payload");
  }
  if (base.truncatedFields?.length) base.truncated = true;
  return base;
}

function compactTurnForView(turn, turnIndex, children) {
  const userMessages = turn.items
    .filter((item) => item.type === "user-message" && normalizeText(item.text))
    .map(compactUserMessageForView)
    .filter(Boolean);
  const assistant = [...turn.items]
    .reverse()
    .find((item) => item.type === "assistant-message" && normalizeText(item.text));
  return {
    id: turn.id,
    turnNumber: turnIndex + 1,
    startedAt: turn.startedAt || null,
    completedAt: turn.completedAt || null,
    status: turn.status || null,
    userMessages,
    assistantMessage: assistant ? compactMessageForView(assistant) : null,
    children,
  };
}

function compactUserMessageForView(item) {
  const text = cleanCompactUserText(item.text);
  if (!isUsefulCompactUserText(text)) return null;
  return compactMessageForView({ ...item, text });
}

function compactMessageForView(item) {
  const limited = limitText(item.text || "", previewLimits.compactMessage);
  return {
    id: item.id,
    type: item.type,
    timestamp: item.timestamp || null,
    phase: item.phase || null,
    role: item.role || null,
    text: limited.text,
    textLength: limited.originalLength,
    truncated: limited.truncated,
  };
}

function cleanCompactUserText(text) {
  const raw = String(text || "").trim();
  const latestRequest = raw.match(/## My request for Codex:\s*([\s\S]*)$/i)?.[1];
  let value = latestRequest || raw;
  value = value
    .replace(/^# In app browser:[\s\S]*?## My request for Codex:\s*/i, "")
    .replace(/^# Files mentioned by the user:[\s\S]*?## My request for Codex:\s*/i, "")
    .replace(/^#?\s*AGENTS\.md instructions[\s\S]*?(?:<\/environment_context>|$)\s*/i, "")
    .replace(/^<environment_context>[\s\S]*?<\/environment_context>\s*/i, "")
    .trim();
  return value;
}

function isUsefulCompactUserText(text) {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  if (/^#?\s*AGENTS\.md instructions/i.test(normalized)) return false;
  if (/^Continue working toward the active thread goal/i.test(normalized)) return false;
  if (/^In app browser:/i.test(normalized)) return false;
  if (/^Files mentioned by the user:/i.test(normalized)) return false;
  if (/^<environment_context>/i.test(normalized)) return false;
  return true;
}

function compactChildBase(child, context) {
  const thread = child.thread || {};
  return {
    id: child.childThreadId,
    edgeStatus: child.status || null,
    depth: context.depth + 1,
    spawnEvent: compactCompactEvent(context.spawnEvent),
    notificationEvent: compactCompactEvent(context.notificationEvent),
    session: compactCompactSession(thread),
  };
}

function compactChildPlaceholder(child, context) {
  return {
    ...compactChildBase(child, { ...context, depth: context.depth ?? 0 }),
    unavailable: true,
    unavailableReason: context.reason || "not-loaded",
    turns: [],
    children: [],
  };
}

function compactCompactSession(session) {
  if (!session) return null;
  return {
    id: session.id,
    title: session.title || "未命名会话",
    cwd: session.cwd || null,
    model: session.model || null,
    reasoningEffort: session.reasoningEffort || null,
    agentNickname: session.agentNickname || null,
    agentRole: session.agentRole || null,
    startedAt: session.startedAt || null,
    updatedAt: session.updatedAt || null,
    relativePath: session.relativePath || null,
  };
}

function compactCompactEvent(event) {
  if (!event) return null;
  return {
    index: event.index,
    timestamp: event.timestamp,
    kind: event.kind,
    title: event.title,
    preview: firstLine(event.preview || "", 220),
  };
}

function addTruncatedField(target, field) {
  if (!target.truncatedFields) target.truncatedFields = [];
  target.truncatedFields.push(field);
}

function limitText(value, max) {
  if (value == null) return { text: value, originalLength: 0, truncated: false };
  const text = String(value);
  if (text.length <= max) return { text, originalLength: text.length, truncated: false };
  return {
    text: text.slice(0, max),
    originalLength: text.length,
    truncated: true,
  };
}

function buildTrace(session, rawEvents, normalizedEvents, turns, hierarchy) {
  const rootStartedAt = turns[0]?.startedAt || session.startedAt || normalizedEvents[0]?.timestamp || null;
  const rootEndedAt =
    turns.at(-1)?.completedAt || normalizedEvents.at(-1)?.timestamp || session.updatedAt || session.fileModifiedAt || null;
  const childById = new Map(hierarchy.children.map((child) => [child.childThreadId, child]));
  const spawnByChildId = findSpawnAgentEvents(normalizedEvents, childById);
  const notificationByChildId = findSubagentNotifications(normalizedEvents, childById);

  const root = {
    id: `thread:${session.id}`,
    type: "thread",
    label: session.agentNickname ? `${session.agentNickname} / ${session.agentRole || "agent"}` : "Root Thread",
    title: session.title || "未命名会话",
    subtitle: session.id,
    timestamp: rootStartedAt,
    completedAt: rootEndedAt,
    durationMs: durationMs(rootStartedAt, rootEndedAt),
    durationEstimated: true,
    status: "open",
    icon: "thread",
    detail: {
      kind: "thread",
      session: compactTraceSession(session),
      hierarchy,
      note: "根线程节点。duration 基于首末事件估算。",
    },
    children: [],
  };

  for (const [turnIndex, turn] of turns.entries()) {
    const turnSummary = summarizeTurnForTrace(turn, hierarchy);
    const turnNode = {
      id: `turn:${turn.id}:${turnIndex}`,
      type: "turn",
      label: `Turn ${turnIndex + 1}`,
      title: turnSummary.title,
      subtitle: [turnSummary.subtitle, formatIsoForTrace(turn.startedAt), turn.cwd ? shortPathServer(turn.cwd) : ""]
        .filter(Boolean)
        .join(" · "),
      timestamp: turn.startedAt,
      completedAt: turn.completedAt,
      durationMs: durationMs(turn.startedAt, turn.completedAt),
      durationEstimated: !turn.completedAt,
      status: turn.status || "running",
      icon: "turn",
      detail: {
        kind: "turn",
        turn: compactTraceTurn(turn, turnSummary),
      },
      children: [],
    };

    for (const [itemIndex, item] of turn.items.entries()) {
      const itemNode = traceNodeFromItem(item, turnIndex, itemIndex);
      if (itemNode && isDefaultTraceNodeForPayload(itemNode)) turnNode.children.push(itemNode);
    }

    const turnStart = toMs(turn.startedAt) ?? -Infinity;
    const turnEnd = toMs(turn.completedAt) ?? Infinity;
    for (const child of hierarchy.children) {
      const spawnEvent = spawnByChildId.get(child.childThreadId);
      const notificationEvent = notificationByChildId.get(child.childThreadId);
      const anchor = spawnEvent || notificationEvent;
      const anchorMs = toMs(anchor?.timestamp);
      if (anchor && anchorMs != null && anchorMs >= turnStart && anchorMs <= turnEnd) {
        turnNode.children.push(traceNodeFromChildThread(child, anchor, notificationEvent));
      }
    }

    root.children.push(turnNode);
  }

  const placedChildIds = new Set(
    root.children.flatMap((turn) => turn.children.filter((node) => node.type === "subagent").map((node) => node.threadId)),
  );
  for (const child of hierarchy.children) {
    if (!placedChildIds.has(child.childThreadId)) {
      root.children.push(traceNodeFromChildThread(child, spawnByChildId.get(child.childThreadId), notificationByChildId.get(child.childThreadId)));
    }
  }

  return {
    root,
    hierarchy,
    timing: {
      startedAt: rootStartedAt,
      completedAt: rootEndedAt,
      durationMs: root.durationMs,
      estimated: true,
    },
  };
}

function isDefaultTraceNodeForPayload(node) {
  return ["tool", "handoff", "subagent", "lazy-child"].includes(node.type);
}

function traceNodeFromItem(item, turnIndex, itemIndex) {
  const base = {
    id: `item:${turnIndex}:${itemIndex}:${item.id || item.type}`,
    timestamp: item.timestamp || null,
    completedAt: item.completedAt || null,
    durationMs: durationMs(item.timestamp, item.completedAt),
    durationEstimated: !item.completedAt,
    status: item.status || null,
    children: [],
    detail: {
      kind: "item",
      item: compactTraceItem(item),
    },
  };

  if (item.type === "user-message") {
    return {
      ...base,
      type: "message",
      icon: "user",
      label: "User message",
      title: firstLine(item.text || "用户消息", 80),
      subtitle: formatIsoForTrace(item.timestamp),
    };
  }
  if (item.type === "assistant-message") {
    return {
      ...base,
      type: "message",
      icon: "assistant",
      label: item.phase === "final" || item.phase === "final_answer" ? "Final answer" : "Assistant response",
      title: firstLine(item.text || "助手消息", 80),
      subtitle: [item.phase, formatIsoForTrace(item.timestamp)].filter(Boolean).join(" · "),
    };
  }
  if (item.type === "tool-call") {
    const isHandoff = ["spawn_agent", "wait_agent", "handoff"].includes(item.name);
    return {
      ...base,
      type: isHandoff ? "handoff" : "tool",
      icon: isHandoff ? "handoff" : "tool",
      label: isHandoff ? "Handoff" : `Tool call`,
      title: item.name || item.callId || "tool",
      subtitle: [item.status, formatIsoForTrace(item.timestamp)].filter(Boolean).join(" · "),
    };
  }
  if (item.type === "reasoning") {
    return {
      ...base,
      type: "reasoning",
      icon: "reasoning",
      label: "Reasoning",
      title: item.text ? firstLine(item.text, 80) : item.encrypted ? "推理内容已加密存储" : "无明文摘要",
      subtitle: item.encrypted ? "encrypted_content" : "summary",
    };
  }
  if (item.type === "token-count") {
    return {
      ...base,
      type: "metric",
      icon: "metric",
      label: "Token usage",
      title: "Token 统计",
      subtitle: formatIsoForTrace(item.timestamp),
    };
  }
  if (item.type === "event" || item.type === "response-item") {
    return {
      ...base,
      type: "event",
      icon: "event",
      label: item.eventType || item.responseType || "Event",
      title: item.eventType || item.responseType || item.type,
      subtitle: formatIsoForTrace(item.timestamp),
    };
  }
  return null;
}

function traceNodeFromChildThread(child, spawnEvent, notificationEvent) {
  const thread = child.thread || {};
  const timestamp = spawnEvent?.timestamp || thread.updatedAt || null;
  const completedAt = notificationEvent?.timestamp || thread.updatedAt || null;
  return {
    id: `subagent:${child.childThreadId}`,
    type: "subagent",
    threadId: child.childThreadId,
    icon: "agent",
    label: `Subagent: ${thread.agentNickname || child.childThreadId}`,
    title: [thread.agentNickname, thread.agentRole].filter(Boolean).join(" / ") || thread.title || child.childThreadId,
    subtitle: thread.title || child.status || "",
    timestamp,
    completedAt,
    durationMs: durationMs(timestamp, completedAt),
    durationEstimated: true,
    status: child.status,
    lazy: true,
    children: [
      {
        id: `subagent:${child.childThreadId}:placeholder`,
        type: "lazy-child",
        icon: "thread",
        label: "Child thread",
        title: "点击子代理节点加载完整会话",
        subtitle: thread.relativePath || "",
        timestamp: null,
        completedAt: null,
        durationMs: null,
        durationEstimated: false,
        status: "lazy",
        children: [],
        detail: {
          kind: "lazy-child",
          thread,
        },
      },
    ],
    detail: {
      kind: "subagent",
      edge: child,
      thread,
      spawnEvent: compactTraceEvent(spawnEvent),
      notificationEvent: compactTraceEvent(notificationEvent),
      note: "子代理正文按需通过会话详情接口加载，不内嵌在父会话响应里。",
    },
  };
}

function compactTraceSession(session) {
  return {
    id: session.id,
    title: session.title,
    cwd: session.cwd,
    model: session.model,
    reasoningEffort: session.reasoningEffort,
    agentNickname: session.agentNickname,
    agentRole: session.agentRole,
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
    relativePath: session.relativePath,
  };
}

function summarizeTurnForTrace(turn, hierarchy) {
  const userSubagentNotice = turn.items
    .filter((item) => item.type === "user-message" && normalizeText(item.text))
    .map((item) => summarizeSubagentNotificationText(item.text, hierarchy))
    .find(Boolean);
  if (userSubagentNotice) {
    return userSubagentNotice;
  }

  const user = turn.items
    .filter((item) => item.type === "user-message" && normalizeText(item.text))
    .map((item) => ({ item, title: cleanTurnTitle(item.text) }))
    .find(({ title }) => isUsefulTurnTitle(title));
  if (user) {
    return {
      title: firstLine(user.title, 96) || "用户请求",
      subtitle: "用户请求",
      source: "user-message",
    };
  }

  const subagentNotice = turn.items
    .filter((item) => item.type === "event" && item.payload)
    .map((item) => summarizeSubagentNotification(item.payload, hierarchy))
    .find(Boolean);
  if (subagentNotice) {
    return subagentNotice;
  }

  const handoff = turn.items.find((item) => item.type === "tool-call" && ["spawn_agent", "wait_agent", "handoff"].includes(item.name));
  if (handoff) {
    return {
      title: firstLine(summarizeHandoffTool(handoff, hierarchy), 96),
      subtitle: "子代理委派",
      source: "handoff",
    };
  }

  const toolNames = [...new Set(turn.items.filter((item) => item.type === "tool-call" && item.name).map((item) => item.name))];
  if (toolNames.length > 0) {
    return {
      title: firstLine(`工具执行：${toolNames.slice(0, 3).join(", ")}${toolNames.length > 3 ? ` +${toolNames.length - 3}` : ""}`, 96),
      subtitle: "工具执行",
      source: "tool-call",
    };
  }

  const assistant = turn.items
    .filter((item) => item.type === "assistant-message" && normalizeText(item.text))
    .map((item) => ({ item, title: cleanTurnTitle(item.text) }))
    .find(({ title }) => isUsefulTurnTitle(title));
  if (assistant) {
    return {
      title: firstLine(assistant.title, 96) || "助手回复",
      subtitle: "助手回复",
      source: "assistant-message",
    };
  }

  return {
    title: turn.status || "turn",
    subtitle: "无可用摘要",
    source: "fallback",
  };
}

function summarizeSubagentNotification(payload, hierarchy) {
  const agentId = payload?.agent_path || payload?.agent_id || payload?.thread_id;
  if (!agentId) return null;
  const child = hierarchy.children.find((candidate) => candidate.childThreadId === agentId) || hierarchy.siblings?.find((candidate) => candidate.childThreadId === agentId);
  const thread = child?.thread || {};
  const name = [thread.agentNickname, thread.agentRole].filter(Boolean).join(" / ") || thread.title || agentId;
  return {
    title: firstLine(`子代理回执：${name}`, 96),
    subtitle: "子代理回执",
    source: "subagent-notification",
  };
}

function summarizeSubagentNotificationText(text, hierarchy) {
  const parsed = parseJsonObject(text);
  if (parsed) return summarizeSubagentNotification(parsed, hierarchy);
  const agentId = String(text || "").match(/"agent_path"\s*:\s*"([^"]+)"/)?.[1];
  return agentId ? summarizeSubagentNotification({ agent_path: agentId }, hierarchy) : null;
}

function summarizeHandoffTool(item, hierarchy) {
  const args = parseJsonObject(item.arguments);
  const explicitId = args?.agent_id || args?.thread_id || args?.target;
  const child = explicitId
    ? hierarchy.children.find((candidate) => candidate.childThreadId === explicitId) || hierarchy.siblings?.find((candidate) => candidate.childThreadId === explicitId)
    : null;
  const thread = child?.thread || {};
  const name = [thread.agentNickname, thread.agentRole].filter(Boolean).join(" / ") || thread.title || explicitId || item.name || "handoff";
  return item.name === "wait_agent" ? `等待子代理：${name}` : `委派子代理：${name}`;
}

function cleanTurnTitle(text) {
  const raw = String(text || "");
  const latestRequest = raw.match(/## My request for Codex:\s*([\s\S]*)$/i)?.[1];
  const withoutGoalWrapper = (latestRequest || raw)
    .replace(/#\s*AGENTS\.md instructions[\s\S]*?(?:<\/environment_context>|$)/i, "")
    .replace(/^Continue working toward the active thread goal\.[\s\S]*?(?=\n#{1,3}\s|\n\S|$)/i, "")
    .replace(/^# In app browser:[\s\S]*?## My request for Codex:\s*/i, "")
    .replace(/^# Files mentioned by the user:[\s\S]*?## My request for Codex:\s*/i, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\[[^\]]+\]\([^)]+\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return withoutGoalWrapper || firstLine(raw, 120);
}

function isUsefulTurnTitle(title) {
  const text = normalizeText(title);
  if (!text) return false;
  if (/^#?\s*AGENTS\.md instructions/i.test(text)) return false;
  if (/^Continue working toward the active thread goal/i.test(text)) return false;
  if (/^In app browser:/i.test(text)) return false;
  if (/^Files mentioned by the user:/i.test(text)) return false;
  return true;
}

function compactTraceTurn(turn, summary) {
  return {
    id: turn.id,
    startedAt: turn.startedAt,
    completedAt: turn.completedAt,
    status: turn.status,
    cwd: turn.cwd,
    context: turn.context,
    itemCount: turn.items.length,
    summary,
  };
}

function compactTraceItem(item) {
  const text = limitText(item.text, previewLimits.traceText);
  const args = limitText(item.arguments, previewLimits.traceArguments);
  const output = limitText(item.output, previewLimits.traceOutput);
  return {
    id: item.id,
    type: item.type,
    timestamp: item.timestamp,
    completedAt: item.completedAt || null,
    phase: item.phase || null,
    role: item.role || null,
    name: item.name || null,
    callId: item.callId || null,
    status: item.status || null,
    eventType: item.eventType || null,
    responseType: item.responseType || null,
    encrypted: item.encrypted || false,
    text: text.text,
    textLength: text.originalLength || null,
    arguments: args.text,
    argumentsLength: args.originalLength || null,
    output: output.text,
    outputLength: output.originalLength || null,
    truncated: text.truncated || args.truncated || output.truncated,
    info: compactTraceInfo(item.info),
  };
}

function compactTraceEvent(event) {
  if (!event) return null;
  return {
    index: event.index,
    timestamp: event.timestamp,
    kind: event.kind,
    important: event.important,
    type: event.type,
    payloadType: event.payloadType,
    role: event.role,
    title: event.title,
    preview: truncateTraceText(event.preview, 1500),
  };
}

function compactTraceInfo(info) {
  if (!info) return null;
  const total = info.total_token_usage || info.totalTokenUsage || info.total_tokens || null;
  const last = info.last_token_usage || info.lastTokenUsage || null;
  return { total_token_usage: total, last_token_usage: last };
}

function truncateTraceText(value, max) {
  return limitText(value, max).text;
}

function findSpawnAgentEvents(events, childById) {
  const byChild = new Map();
  for (const event of events) {
    if (event.kind !== "function_call") continue;
    const payload = event.payload ?? {};
    if (payload.name !== "spawn_agent") continue;
    const args = parseJsonObject(payload.arguments);
    const explicitId = args?.agent_id || args?.thread_id || args?.target;
    if (explicitId && childById.has(explicitId)) {
      byChild.set(explicitId, event);
      continue;
    }
    const message = String(args?.message || args?.prompt || "");
    for (const [childId, child] of childById.entries()) {
      const nickname = child.thread?.agentNickname;
      const role = child.thread?.agentRole;
      const title = child.thread?.title;
      if (
        !byChild.has(childId) &&
        ((nickname && message.includes(nickname)) || (role && message.includes(role)) || (title && message.includes(title)))
      ) {
        byChild.set(childId, event);
        break;
      }
    }
  }
  return byChild;
}

function findSubagentNotifications(events, childById) {
  const byChild = new Map();
  for (const event of events) {
    const preview = String(event.preview || "");
    const payloadText = JSON.stringify(event.payload || {});
    const text = `${preview}\n${payloadText}`;
    if (!/subagent_notification|agent_path/i.test(text)) continue;
    for (const childId of childById.keys()) {
      if (text.includes(childId)) byChild.set(childId, event);
    }
  }
  return byChild;
}

function parseJsonObject(value) {
  if (!value || typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function flattenTrace(root) {
  const nodes = [];
  const walk = (node, depth, parentId) => {
    nodes.push({ ...node, depth, parentId, children: undefined, childCount: node.children?.length || 0 });
    for (const child of node.children || []) walk(child, depth + 1, node.id);
  };
  walk(root, 0, null);
  return nodes;
}

function durationMs(start, end) {
  const startMs = toMs(start);
  const endMs = toMs(end);
  if (startMs == null || endMs == null || endMs < startMs) return null;
  return endMs - startMs;
}

function toMs(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function formatIsoForTrace(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().replace("T", " ").slice(5, 16);
}

function shortPathServer(value) {
  const parts = String(value || "")
    .replace(/^\\\\\?\\/, "")
    .split(/[\\/]+/)
    .filter(Boolean);
  if (parts.length <= 3) return String(value || "");
  return `${parts[0]}/${parts[1]}/…/${parts.at(-1)}`;
}

function buildTurns(events) {
  const normalizedEvents = coalesceNormalizedEvents(events);
  const turns = [];
  let current = null;
  let activeCall = new Map();

  function ensureTurn(event) {
    const turnId = event.payload?.turn_id || current?.id || `turn-${turns.length + 1}`;
    if (!current || current.id !== turnId) {
      current = {
        id: turnId,
        startedAt: eventTime(event),
        completedAt: null,
        status: "running",
        cwd: event.payload?.cwd ?? null,
        items: [],
      };
      turns.push(current);
      activeCall = new Map();
    }
    return current;
  }

  for (const [eventIndex, event] of normalizedEvents.entries()) {
    const sourceIndex = event.index ?? eventIndex;
    const payload = event.payload ?? {};
    if (event.kind === "meta" || event.semanticKind === "meta") continue;
    if (payload.type === "task_started") {
      current = {
        id: payload.turn_id || `turn-${turns.length + 1}`,
        startedAt: eventTime(event),
        completedAt: null,
        status: "running",
        cwd: null,
        items: [],
      };
      turns.push(current);
      activeCall = new Map();
      continue;
    }
    if (event.kind === "context") {
      const turn = ensureTurn(event);
      turn.cwd = payload.cwd ?? turn.cwd;
      turn.context = {
        model: payload.model,
        approvalPolicy: payload.approval_policy,
        sandbox: payload.sandbox_policy?.type,
        timezone: payload.timezone,
      };
      continue;
    }
    if (!current && shouldStartImplicitTurn(event)) ensureTurn(event);
    if (!current) continue;

    if (event.semanticKind === "diagnostic") {
      current.items.push({
        id: `item-${current.items.length}`,
        type: "event",
        sourceIndex,
        timestamp: event.timestamp,
        eventType: event.kind,
        payload,
      });
      continue;
    }

    if (event.kind === "user_message" || (event.semanticKind === "message" && event.role === "user")) {
      if (!event.attachments?.length && isDuplicateUserMessage(current, event.text)) continue;
      current.items.push({
        id: `item-${current.items.length}`,
        type: "user-message",
        sourceIndex,
        timestamp: event.timestamp,
        text: event.text ?? "",
        attachments: event.attachments,
      });
      continue;
    }

    if (event.kind === "agent_message" || (event.semanticKind === "message" && event.role === "assistant")) {
      if (!event.attachments?.length && isDuplicateAssistantMessage(current, event.text)) continue;
      current.items.push({
        id: `item-${current.items.length}`,
        type: "assistant-message",
        sourceIndex,
        timestamp: event.timestamp,
        phase: payload.phase ?? null,
        text: event.text ?? "",
        attachments: event.attachments,
      });
      continue;
    }

    if (payload.type === "token_count") {
      current.items.push({
        id: `item-${current.items.length}`,
        type: "token-count",
        sourceIndex,
        timestamp: event.timestamp,
        info: payload.info ?? {},
      });
      continue;
    }

    if (event.semanticKind === "tool_call") {
      registerToolCall(current, activeCall, event, sourceIndex);
      continue;
    }

    if (event.semanticKind === "tool_result") {
      registerToolOutput(current, activeCall, event, sourceIndex);
      continue;
    }

    if (payload.type === "task_complete" || payload.type === "task_failed") {
      current.completedAt = event.timestamp;
      current.status = payload.type === "task_failed" ? "failed" : "completed";
      if (payload.last_agent_message && !hasAssistantMessage(current, payload.last_agent_message)) {
        current.items.push({
          id: `item-${current.items.length}`,
          type: "assistant-message",
          sourceIndex,
          timestamp: event.timestamp,
          phase: "final",
          text: payload.last_agent_message,
        });
      }
      continue;
    }

    if (event.semanticKind === "reasoning") {
      current.items.push({
        id: `item-${current.items.length}`,
        type: "reasoning",
        sourceIndex,
        timestamp: event.timestamp,
        text: event.reasoning?.summary || event.text || "",
        encrypted: Boolean(event.reasoning?.encrypted),
        reasoning: event.reasoning,
      });
      continue;
    }

    current.items.push({
      id: `item-${current.items.length}`,
      type: event.rawType === "response_item" ? "response-item" : "event",
      sourceIndex,
      timestamp: event.timestamp,
      eventType: payload.type ?? event.kind ?? "event",
      responseType: payload.type ?? event.kind ?? "response",
      payload,
      attachments: event.attachments,
    });
  }

  return turns.filter((turn) => turn.items.length > 0 || turn.context);
}

function shouldStartImplicitTurn(event) {
  const payloadType = event.payload?.type;
  return event.rawType === "event_msg" || event.rawType === "response_item" || payloadType === "user_message" || event.semanticKind === "message" || event.semanticKind === "tool_call" || event.semanticKind === "tool_result" || event.semanticKind === "diagnostic";
}

function hasAssistantMessage(turn, text) {
  const normalized = normalizeText(text);
  return turn.items.some((item) => item.type === "assistant-message" && normalizeText(item.text) === normalized);
}

function isDuplicateAssistantMessage(turn, text) {
  const normalized = normalizeText(text);
  if (!normalized) return true;
  return turn.items.some((item) => item.type === "assistant-message" && normalizeText(item.text) === normalized);
}

function isDuplicateUserMessage(turn, text) {
  const normalized = normalizeText(text);
  if (!normalized) return true;
  return turn.items.some((item) => item.type === "user-message" && normalizeText(item.text) === normalized);
}

function registerToolCall(turn, activeCall, event, sourceIndex) {
  const payload = event.payload ?? {};
  const callId = event.callId || payload.call_id || `item-${turn.items.length}`;
  const item = {
    id: callId,
    type: "tool-call",
    sourceIndex,
    timestamp: event.timestamp,
    name: event.toolName || toolNameFromPayload(payload),
    callId,
    status: payload.status || "started",
    arguments: event.toolInput ?? toolArgumentsFromPayload(payload),
    output: null,
  };
  activeCall.set(callId, item);
  turn.items.push(item);
}

function registerToolOutput(turn, activeCall, event, sourceIndex) {
  const payload = event.payload ?? {};
  const callId = event.callId || payload.call_id || `item-${turn.items.length}`;
  const target = activeCall.get(callId);
  const output = event.toolOutput ?? toolOutputFromPayload(payload);
  if (target) {
    target.output = mergeToolOutput(target.output, output);
    target.status = payload.status || (payload.success === false ? "failed" : "completed");
    target.completedAt = event.timestamp;
    target.outputSourceIndex = sourceIndex;
    return;
  }

  turn.items.push({
    id: callId,
    type: "tool-call",
    sourceIndex,
    timestamp: event.timestamp,
    name: event.toolName || toolNameFromPayload(payload),
    callId,
    status: payload.status || (payload.success === false ? "failed" : "completed"),
    arguments: event.toolInput ?? toolArgumentsFromPayload(payload),
    output,
  });
}

export {
  buildTrace,
  buildTurns,
  compactChildBase,
  compactChildPlaceholder,
  compactCompactSession,
  compactTurnsForClient,
  compactTurnForView,
  findSpawnAgentEvents,
  findSubagentNotifications,
  limitText,
  parseJsonObject,
  toMs,
};
