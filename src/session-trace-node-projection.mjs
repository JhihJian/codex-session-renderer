import { firstLine, normalizeText } from "./text-utils.mjs";
import {
  compactTraceInfo,
  durationMs,
  limitText,
  parseJsonObject,
  subagentNotificationAgentIds,
  subagentNotificationPayload,
} from "./session-projection-shared.mjs";

function isDefaultTraceNodeForPayload(node) {
  return ["tool", "handoff", "subagent", "embedded-subagent", "lazy-child"].includes(node.type);
}

function assistantPhaseLabel(phase) {
  switch (phase) {
    case "final":
    case "final_answer":
      return "最终回复";
    case "delta":
      return "增量回复";
    case "message":
      return "消息";
    default:
      return phase ? `阶段：${phase}` : "";
  }
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
      label: "用户消息",
      title: firstLine(item.text || "用户消息"),
      subtitle: formatIsoForTrace(item.timestamp),
    };
  }
  if (item.type === "assistant-message") {
    return {
      ...base,
      type: "message",
      icon: "assistant",
      label: item.phase === "final" || item.phase === "final_answer" ? "最终回复" : "助手回复",
      title: firstLine(item.text || "助手消息"),
      subtitle: [assistantPhaseLabel(item.phase), formatIsoForTrace(item.timestamp)].filter(Boolean).join(" · "),
    };
  }
  if (item.type === "tool-call") {
    if (item.embeddedSubagents) {
      const batch = item.embeddedSubagents;
      const count = batch.results?.length || batch.requested?.length || 0;
      return {
        ...base,
        type: "embedded-subagent",
        icon: "agent",
        status: batch.status || item.status || null,
        label: "内嵌子代理批次",
        title: `${batch.mode || "single"} · ${count} 个任务`,
        subtitle: [batch.agentScope ? `范围：${batch.agentScope}` : "", batch.status, formatIsoForTrace(item.timestamp)].filter(Boolean).join(" · "),
        children: embeddedSubagentTraceTasks(batch, turnIndex, itemIndex),
      };
    }
    const isHandoff = ["spawn_agent", "wait_agent", "handoff"].includes(item.name);
    return {
      ...base,
      type: isHandoff ? "handoff" : "tool",
      icon: isHandoff ? "handoff" : "tool",
      label: isHandoff ? "委派" : "工具调用",
      title: item.name || item.callId || "未知工具",
      subtitle: [item.status, formatIsoForTrace(item.timestamp)].filter(Boolean).join(" · "),
    };
  }
  if (item.type === "reasoning") {
    return {
      ...base,
      type: "reasoning",
      icon: "reasoning",
      label: "推理",
      title: item.text ? firstLine(item.text) : item.encrypted ? "推理内容已加密存储" : "无明文摘要",
      subtitle: item.encrypted ? "已加密" : "摘要",
    };
  }
  if (item.type === "token-count") {
    return {
      ...base,
      type: "metric",
      icon: "metric",
      label: "上下文占用",
      title: "上下文占用统计",
      subtitle: formatIsoForTrace(item.timestamp),
    };
  }
  if (item.type === "event" || item.type === "response-item") {
    return {
      ...base,
      type: "event",
      icon: "event",
      label: item.eventType || item.responseType || "事件",
      title: item.eventType || item.responseType || item.type,
      subtitle: formatIsoForTrace(item.timestamp),
    };
  }
  return null;
}

function embeddedSubagentTraceTasks(batch, turnIndex, itemIndex) {
  const requested = Array.isArray(batch.requested) ? batch.requested : [];
  const results = Array.isArray(batch.results) ? batch.results : [];
  const resultsByIndex = new Map(results.map((result) => [result.index, result]));
  const indexes = new Set([...requested.map((task) => task.index), ...results.map((task) => task.index)]);
  return [...indexes]
    .sort((left, right) => left - right)
    .map((index) => {
      const request = requested.find((task) => task.index === index) || {};
      const result = resultsByIndex.get(index) || {};
      const task = { ...request, ...result, index, agent: result.agent || request.agent || "未指定代理", task: request.task || null };
      return {
        id: `embedded-subagent:${turnIndex}:${itemIndex}:${index}`,
        type: "embedded-subagent-task",
        icon: "agent",
        label: `子代理：${task.agent}`,
        title: firstLine(task.task || task.summary || "任务详情"),
        subtitle: [task.agentSource, task.exitCode != null ? `退出 ${task.exitCode}` : "", task.stopReason].filter(Boolean).join(" · "),
        timestamp: null,
        completedAt: null,
        durationMs: null,
        durationEstimated: false,
        status: task.status || batch.status || "unknown",
        children: [],
        detail: {
          kind: "embedded-subagent-task",
          task,
          batch: { mode: batch.mode || null, agentScope: batch.agentScope || null },
        },
      };
    });
}

function traceNodeFromChildThread(child, spawnEvent, notificationEvent) {
  const thread = child.thread || {};
  const timestamp = spawnEvent?.timestamp || null;
  const completedAt = notificationEvent?.timestamp || null;
  return {
    id: `subagent:${child.childThreadId}`,
    type: "subagent",
    threadId: child.childThreadId,
    icon: "agent",
    label: `子代理：${thread.agentNickname || child.childThreadId}`,
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
        label: "子会话",
        title: "点击子代理节点加载完整会话",
        subtitle: thread.relativePath || "",
        timestamp: null,
        completedAt: null,
        durationMs: null,
        durationEstimated: false,
        status: "按需加载",
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
    title: session.title || "未命名会话",
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
      title: firstLine(user.title) || "用户请求",
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
      title: firstLine(summarizeHandoffTool(handoff, hierarchy)),
      subtitle: "子代理委派",
      source: "handoff",
    };
  }

  const toolNames = [...new Set(turn.items.filter((item) => item.type === "tool-call" && item.name).map((item) => item.name))];
  if (toolNames.length > 0) {
    return {
      title: firstLine(`工具执行：${toolNames.join(", ")}`),
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
      title: firstLine(assistant.title) || "助手回复",
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
    title: firstLine(`子代理回执：${name}`),
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
    .replace(/^# In app browser:[\s\S]*?## My request for Codex:\s*/i, "")
    .replace(/^# Files mentioned by the user:[\s\S]*?## My request for Codex:\s*/i, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\[[^\]]+\]\([^)]+\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return withoutGoalWrapper || firstLine(raw);
}

function isUsefulTurnTitle(title) {
  const text = normalizeText(title);
  if (!text) return false;
  if (/^#?\s*AGENTS\.md instructions/i.test(text)) return false;

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
  const text = limitText(item.text);
  const args = limitText(item.arguments);
  const output = limitText(item.output);
  return {
    id: item.id,
    type: item.type,
    sourceIndex: item.sourceIndex ?? null,
    outputSourceIndex: item.outputSourceIndex ?? null,
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
    embeddedSubagents: item.embeddedSubagents || null,
    info: compactTraceInfo(item.info),
    tokenUsage: item.tokenUsage || null,
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


function truncateTraceText(value) {
  return limitText(value).text;
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
    const payload = subagentNotificationPayload(event);
    if (payload) {
      let matched = false;
      for (const childId of subagentNotificationAgentIds(payload)) {
        if (childById.has(childId)) {
          byChild.set(childId, event);
          matched = true;
        }
      }
      if (matched) continue;
    }
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


export {
  compactTraceSession,
  compactTraceTurn,
  findSpawnAgentEvents,
  findSubagentNotifications,
  formatIsoForTrace,
  isDefaultTraceNodeForPayload,
  shortPathServer,
  summarizeTurnForTrace,
  traceNodeFromChildThread,
  traceNodeFromItem,
};
