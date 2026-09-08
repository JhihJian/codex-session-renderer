(function () {
  function attachAuditRowsToAgentMessages(rows, turn, turnIndex, helpers) {
    const resolvedHelpers = auditViewModelHelpers(helpers);
    const sourceRows = Array.isArray(rows) ? rows : [];
    const agentRows = (turn?.items || [])
      .map((item, itemIndex) =>
        item.type === "assistant-message" && String(item.text || "").trim()
          ? auditAgentMessageRowFromItem(item, turnIndex, itemIndex, resolvedHelpers)
          : null,
      )
      .filter(Boolean);

    if (!agentRows.length) {
      if (!sourceRows.length) return [];
      const parent = auditImplicitAgentMessageRow(turn, turnIndex);
      return linkAuditExecutionHierarchy([parent, ...sourceRows.map((row) => auditExecutionChildRow(row, parent))]);
    }

    if (!sourceRows.length) return linkAuditExecutionHierarchy(agentRows);

    const childrenByAgentId = new Map(agentRows.map((row) => [row.id, []]));
    for (const row of sourceRows) {
      const parent = auditAgentParentForExecutionRow(row, agentRows);
      if (parent) {
        childrenByAgentId.get(parent.id)?.push(auditExecutionChildRow(row, parent));
      }
    }

    const result = agentRows.flatMap((row) => [row, ...(childrenByAgentId.get(row.id) || [])]);
    return linkAuditExecutionHierarchy(result);
  }

  function auditAgentMessageRowFromItem(item, turnIndex, itemIndex, helpers) {
    const resolvedHelpers = auditViewModelHelpers(helpers);
    const phase = item.phase || null;
    const title = phase === "final" || phase === "final_answer" ? "助手最终回复" : "助手消息";
    return {
      id: `agent-message:${turnIndex}:${itemIndex}:${item.id || "assistant"}`,
      traceNodeId: null,
      itemRef: resolvedHelpers.itemRef({ ...item, turnIndex, itemIndex }),
      itemIndex,
      type: "agent_message",
      icon: "assistant",
      label: "助手消息",
      title,
      subtitle: resolvedHelpers.firstLine(item.text || "", 180),
      status: phase || "observed",
      timestamp: item.timestamp || null,
      completedAt: item.completedAt || null,
      durationMs: null,
      durationEstimated: false,
      depth: 0,
      auditNodes: [],
      childRowIds: [],
      contextUsage: item.contextUsage || null,
    };
  }

  function auditImplicitAgentMessageRow(turn, turnIndex) {
    return {
      id: `agent-message:${turnIndex}:implicit`,
      traceNodeId: null,
      itemRef: null,
      itemIndex: -1,
      type: "agent_message",
      icon: "assistant",
      label: "助手消息",
      title: "助手消息 · 未记录正文",
      subtitle: "此轮次有执行动作，但原始日志没有对应的助手消息正文。",
      status: turn?.status || "observed",
      timestamp: turn?.startedAt || null,
      completedAt: turn?.completedAt || null,
      durationMs: null,
      durationEstimated: false,
      depth: 0,
      auditNodes: [],
      childRowIds: [],
      synthetic: true,
    };
  }

  function auditExecutionChildRow(row, parent) {
    return {
      ...row,
      parentRowId: parent.id,
      agentMessageItemRef: parent.itemRef || null,
      depth: (parent.depth || 0) + 1 + (row.depth || 0),
    };
  }

  function auditAgentParentForExecutionRow(row, agentRows) {
    const agents = Array.isArray(agentRows) ? agentRows.filter(Boolean) : [];
    if (!agents.length) return null;

    const itemIndex = Number.isInteger(row?.itemIndex) ? row.itemIndex : itemIndexFromItemRef(row?.itemRef);
    if (Number.isInteger(itemIndex)) {
      const previous = [...agents].reverse().find((agent) => agent.itemIndex <= itemIndex);
      return previous || agents.find((agent) => agent.itemIndex > itemIndex) || agents[0];
    }

    const rowTime = dateMs(row?.timestamp);
    if (rowTime != null) {
      const previous = [...agents].reverse().find((agent) => {
        const agentTime = dateMs(agent.timestamp);
        return agentTime != null && agentTime <= rowTime;
      });
      return (
        previous ||
        agents.find((agent) => {
          const agentTime = dateMs(agent.timestamp);
          return agentTime != null && agentTime > rowTime;
        }) ||
        agents[0]
      );
    }

    return agents[0];
  }

  function linkAuditExecutionHierarchy(rows) {
    const linked = (Array.isArray(rows) ? rows : []).map((row) => ({
      ...row,
      childRowIds: uniqueChildRowIds(row.childRowIds),
    }));
    const byId = new Map(linked.map((row) => [row.id, row]));
    for (const row of linked) {
      if (!row.parentRowId) continue;
      const parent = byId.get(row.parentRowId);
      if (parent && !parent.childRowIds.includes(row.id)) parent.childRowIds.push(row.id);
    }
    return linked;
  }

  function flattenAuditExecutionRows(nodes, depth = 0) {
    const rows = [];
    for (const node of nodes || []) {
      const isExecution = auditTraceNodeIsExecution(node);
      if (isExecution) rows.push(auditExecutionRowFromTraceNode(node, depth));
      rows.push(...flattenAuditExecutionRows(node.children || [], isExecution ? depth + 1 : depth));
    }
    return rows;
  }

  function auditTraceNodeIsExecution(node) {
    return ["tool", "handoff", "subagent", "embedded-subagent", "lazy-child"].includes(node?.type);
  }

  function auditExecutionRowFromTraceNode(node, depth = 0) {
    const item = node?.detail?.item || {};
    const ref = itemRefFromTraceNode(node);
    const itemIndex = itemIndexFromItemRef(ref);
    return {
      id: node.id,
      traceNodeId: node.id,
      itemRef: ref,
      itemIndex,
      type: node.type,
      icon: node.icon || node.type,
      label: node.label,
      title: node.title || item.name || node.label || node.id,
      subtitle: node.subtitle || "",
      status: node.status || item.status || "",
      timestamp: node.timestamp || item.timestamp || null,
      completedAt: node.completedAt || item.completedAt || null,
      durationMs: node.durationMs,
      durationEstimated: node.durationEstimated,
      depth,
      auditNodes: [],
    };
  }

  function auditExecutionRowFromItem(item, turnIndex, helpers) {
    const resolvedHelpers = auditViewModelHelpers(helpers);
    const source = item || {};
    const itemIndex = source.itemIndex ?? 0;
    const embeddedSubagents = source.embeddedSubagents || null;
    const isHandoff = ["spawn_agent", "wait_agent", "handoff"].includes(source.name);
    const isEmbeddedSubagent = Boolean(embeddedSubagents);
    const taskCount = embeddedSubagents?.results?.length || embeddedSubagents?.requested?.length || 0;
    return {
      id: `item:${turnIndex}:${itemIndex}:${source.id || source.type}`,
      traceNodeId: `item:${turnIndex}:${itemIndex}:${source.id || source.type}`,
      itemRef: resolvedHelpers.itemRef(source),
      itemIndex,
      type: isEmbeddedSubagent ? "embedded-subagent" : isHandoff ? "handoff" : "tool",
      icon: isEmbeddedSubagent ? "agent" : isHandoff ? "handoff" : "tool",
      label: isEmbeddedSubagent ? "内嵌子代理批次" : isHandoff ? "委派" : "工具调用",
      title: isEmbeddedSubagent ? `${embeddedSubagents.mode || "single"} · ${taskCount} 个任务` : source.name || source.callId || "未知工具",
      subtitle: [embeddedSubagents?.agentScope ? `范围：${embeddedSubagents.agentScope}` : "", embeddedSubagents?.status || source.status, resolvedHelpers.formatDate(source.timestamp)].filter(Boolean).join(" · "),
      status: embeddedSubagents?.status || source.status || "",
      timestamp: source.timestamp || null,
      completedAt: source.completedAt || null,
      durationMs: resolvedHelpers.durationBetween(source.timestamp, source.completedAt),
      durationEstimated: !source.completedAt,
      depth: 0,
      auditNodes: [],
    };
  }

  function itemRefFromTraceNode(node) {
    const match = String(node?.id || "").match(/^item:(\d+):(\d+):/);
    const type = node?.detail?.item?.type;
    if (!match || !type) return null;
    return `${match[1]}:${match[2]}:${type}`;
  }

  function itemIndexFromItemRef(ref) {
    const match = String(ref || "").match(/^\d+:(\d+):/);
    if (!match) return null;
    const value = Number(match[1]);
    return Number.isInteger(value) ? value : null;
  }

  function dateMs(value) {
    if (!value) return null;
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : null;
  }

  function uniqueChildRowIds(childRowIds) {
    const result = [];
    for (const id of Array.isArray(childRowIds) ? childRowIds : []) {
      if (id && !result.includes(id)) result.push(id);
    }
    return result;
  }

  function auditViewModelHelpers(helpers) {
    return {
      itemRef: typeof helpers?.itemRef === "function" ? helpers.itemRef : defaultItemRef,
      firstLine: typeof helpers?.firstLine === "function" ? helpers.firstLine : defaultFirstLine,
      formatDate: typeof helpers?.formatDate === "function" ? helpers.formatDate : defaultFormatDate,
      durationBetween: typeof helpers?.durationBetween === "function" ? helpers.durationBetween : defaultDurationBetween,
    };
  }

  function defaultItemRef(item) {
    return `${item?.turnIndex ?? "x"}:${item?.itemIndex ?? item?.id ?? "x"}:${item?.type || "item"}`;
  }

  function defaultDurationBetween(start, end) {
    const startMs = dateMs(start);
    const endMs = dateMs(end);
    if (startMs == null || endMs == null || endMs < startMs) return null;
    return endMs - startMs;
  }

  function defaultFormatDate(value) {
    const time = dateMs(value);
    return time == null ? "" : new Date(time).toISOString();
  }

  function defaultFirstLine(text, limit) {
    const normalized = String(text || "").replace(/\s+/g, " ").trim();
    const max = Number.isInteger(limit) && limit > 0 ? limit : 180;
    return normalized.length > max ? normalized.slice(0, max) : normalized;
  }

  const api = {
    attachAuditRowsToAgentMessages,
    auditAgentMessageRowFromItem,
    auditAgentParentForExecutionRow,
    auditExecutionChildRow,
    auditExecutionRowFromItem,
    auditExecutionRowFromTraceNode,
    auditTraceNodeIsExecution,
    auditImplicitAgentMessageRow,
    dateMs,
    flattenAuditExecutionRows,
    itemIndexFromItemRef,
    itemRefFromTraceNode,
    linkAuditExecutionHierarchy,
  };

  globalThis.AuditViewModel = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
