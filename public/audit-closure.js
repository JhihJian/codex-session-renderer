(function () {
  const riskRank = { none: 0, low: 1, medium: 2, high: 3 };

  function buildClosureReview(turn, options = {}) {
    const auditNodes = Array.isArray(options.auditNodes) ? options.auditNodes : turn?.auditNodes || [];
    const visibleNodes = Array.isArray(options.visibleNodes) ? options.visibleNodes : auditNodes;
    const executionRows = Array.isArray(options.executionRows) ? options.executionRows : turn?.executionRows || [];
    const visibleExecutionRows = Array.isArray(options.visibleExecutionRows) ? options.visibleExecutionRows : turn?.visibleExecutionRows || executionRows;
    const stats = turn?.stats || {};
    const counts = countTypes(auditNodes);
    const visibleCounts = countTypes(visibleNodes);
    const hasExecution = counts.action > 0 || executionRows.length > 0;
    const signals = closureSignals({ auditNodes, counts, executionRows, hasExecution, stats });
    const score = closureScore({ counts, hasExecution, signals });
    const status = closureStatus({ counts, hasExecution, signals, stats });
    const filtersActive = Boolean(options.filtersActive);
    const supportTotal = counts.evidence + counts.verification;
    const visibleSupport = visibleCounts.evidence + visibleCounts.verification;

    return {
      key: turn?.key || "",
      status,
      label: statusLabel(status),
      headline: closureHeadline(status, { counts, hasExecution, signals, stats }),
      summary: closureSummary({ counts, hasExecution, signals, stats }),
      countLabel: closureCountLabel({ status, supportTotal, visibleSupport, filtersActive, score, signals }),
      score,
      metrics: closureMetrics({ counts, hasExecution, signals, stats }),
      lanes: closureLanes({ auditNodes, visibleNodes, counts, visibleCounts, filtersActive, signals, stats }),
      actions: closureActions({ counts, hasExecution, signals, stats }),
      filtersActive,
      visibleNodeCount: visibleNodes.length,
      totalNodeCount: auditNodes.length,
      visibleExecutionCount: visibleExecutionRows.length,
      totalExecutionCount: executionRows.length,
    };
  }

  function closureSignals({ auditNodes, counts, hasExecution, stats }) {
    const riskNodes = uniqueNodes(auditNodes.filter(isRiskNode));
    const gapNodes = uniqueNodes(auditNodes.filter(isGapNode));
    const highRiskNodes = riskNodes.filter((node) => nodeRiskRank(node) >= riskRank.high);
    const mediumRiskNodes = riskNodes.filter((node) => nodeRiskRank(node) === riskRank.medium);
    const lowRiskNodes = riskNodes.filter((node) => nodeRiskRank(node) === riskRank.low);
    const missingOutputNodes = gapNodes.filter((node) => nodeTags(node).includes("missing-output"));
    const missingVerificationNodes = gapNodes.filter((node) => nodeTags(node).includes("missing-verification"));
    const failedVerificationNodes = auditNodes.filter(isFailedVerification);
    const blockingNodes = uniqueNodes([...highRiskNodes, ...missingOutputNodes, ...failedVerificationNodes]);
    const reviewNodes = uniqueNodes([...mediumRiskNodes, ...lowRiskNodes, ...missingVerificationNodes]);
    const verificationStatus = String(stats.verificationStatus || derivedVerificationStatus(counts, missingVerificationNodes, failedVerificationNodes));

    return {
      blockingNodes,
      failedVerificationNodes,
      gapNodes,
      highRiskNodes,
      lowRiskNodes,
      mediumRiskNodes,
      missingOutputNodes,
      missingVerificationNodes,
      reviewNodes,
      riskNodes,
      verificationStatus,
      needsEvidence: hasExecution && counts.evidence === 0,
      needsVerification: missingVerificationNodes.length > 0,
    };
  }

  function closureStatus({ counts, hasExecution, signals, stats }) {
    if (!counts.total) return "unknown";
    if (!counts.final) return "blocked";
    if (signals.blockingNodes.length) return "blocked";
    if (!counts.intent) return "review";
    if (signals.reviewNodes.length) return "review";
    if (signals.needsEvidence || signals.needsVerification) return "review";
    return "closed";
  }

  function closureScore({ counts, hasExecution, signals }) {
    const checks = [
      { key: "intent", ok: counts.intent > 0 },
      { key: "final", ok: counts.final > 0 },
      { key: "risk", ok: signals.blockingNodes.length === 0 },
    ];
    if (hasExecution) {
      checks.push({ key: "action", ok: counts.action > 0 });
      checks.push({ key: "evidence", ok: counts.evidence > 0 });
    }
    if (counts.verification > 0 || signals.needsVerification || signals.failedVerificationNodes.length) {
      checks.push({ key: "verification", ok: counts.verification > 0 && !signals.failedVerificationNodes.length });
    }
    const passed = checks.filter((check) => check.ok).length;
    return { passed, total: checks.length, label: `${passed}/${checks.length}` };
  }

  function closureMetrics({ counts, hasExecution, signals, stats }) {
    return [
      {
        key: "intent",
        label: "目标",
        value: counts.intent ? "已捕获" : "缺失",
        detail: `${counts.intent} 个意图节点`,
        state: counts.intent ? "ok" : "warn",
      },
      {
        key: "final",
        label: "结论",
        value: counts.final ? "有最终回复" : "缺失",
        detail: `${counts.final} 个最终节点`,
        state: counts.final ? "ok" : "block",
      },
      {
        key: "support",
        label: "支撑",
        value: `${counts.evidence + counts.verification} 条`,
        detail: `证据 ${counts.evidence} · 验证 ${counts.verification}`,
        state: hasExecution && counts.evidence === 0 ? "warn" : "ok",
      },
      {
        key: "verification",
        label: "验证",
        value: signals.verificationStatus || "未验证",
        detail: stats.verificationStatus || derivedVerificationStatus(counts, signals.missingVerificationNodes, signals.failedVerificationNodes),
        state: verificationMetricState(signals, stats),
      },
      {
        key: "risk",
        label: "风险/缺口",
        value: signals.blockingNodes.length ? `${signals.blockingNodes.length} 阻断` : signals.riskNodes.length ? `${signals.riskNodes.length} 需复核` : "无阻断",
        detail: `风险 ${signals.riskNodes.length} · 缺口 ${signals.gapNodes.length}`,
        state: signals.blockingNodes.length ? "block" : signals.riskNodes.length || signals.gapNodes.length ? "warn" : "ok",
      },
    ];
  }

  function closureLanes({ auditNodes, visibleNodes, counts, visibleCounts, filtersActive, signals, stats }) {
    const visibleClaimNodes = nodesOfTypes(visibleNodes, ["intent", "final"]);
    const visibleSupportNodes = sortSupportNodes(nodesOfTypes(visibleNodes, ["verification", "evidence"]));
    const visibleRiskNodes = uniqueNodes([...visibleNodes.filter(isRiskNode), ...visibleNodes.filter(isGapNode), ...visibleNodes.filter(isFailedVerification)]);
    const visibleContextNodes = nodesOfTypes(visibleNodes, ["reasoning"]);

    return [
      {
        key: "claim",
        label: "声明边界",
        caption: laneCaption(filtersActive, visibleClaimNodes.length, counts.intent + counts.final, "目标/结论"),
        state: counts.intent && counts.final ? "ok" : "warn",
        nodes: visibleClaimNodes,
        emptyText: filtersActive ? "当前筛选未显示目标或最终回复" : "没有可复核的目标或最终回复",
      },
      {
        key: "support",
        label: "证据支撑",
        caption: laneCaption(filtersActive, visibleSupportNodes.length, counts.evidence + counts.verification, "证据/验证"),
        state: supportLaneState({ counts, signals, stats }),
        nodes: visibleSupportNodes,
        emptyText: filtersActive ? "当前筛选未显示证据或验证节点" : "没有工具输出证据或验证结果",
      },
      {
        key: "risk",
        label: "阻断风险",
        caption: laneCaption(filtersActive, visibleRiskNodes.length, signals.riskNodes.length + signals.gapNodes.length, "风险/缺口"),
        state: signals.blockingNodes.length ? "block" : signals.riskNodes.length || signals.gapNodes.length ? "warn" : "ok",
        nodes: sortRiskNodes(visibleRiskNodes),
        emptyText: signals.riskNodes.length || signals.gapNodes.length ? "当前筛选隐藏了风险节点" : "没有阻断风险或缺口信号",
      },
      {
        key: "context",
        label: "判断依据",
        caption: laneCaption(filtersActive, visibleContextNodes.length, visibleCounts.reasoning, "推理/说明"),
        state: visibleContextNodes.length ? "ok" : "neutral",
        nodes: visibleContextNodes,
        emptyText: filtersActive ? "当前筛选未显示过程判断" : "没有可展示的过程判断摘要",
      },
    ];
  }

  function closureActions({ counts, hasExecution, signals, stats }) {
    const actions = [];
    if (!counts.final) {
      actions.push({ tone: "block", title: "补最终结论", body: "没有最终回复节点，无法判断本 Turn 是否完成交付。" });
    }
    if (!counts.intent) {
      actions.push({ tone: "warn", title: "确认目标边界", body: "缺少意图节点，最终回复是否答中用户目标不可判定。" });
    }
    if (signals.highRiskNodes.length) {
      actions.push({ tone: "block", title: "先处理高风险", body: `${signals.highRiskNodes.length} 个高风险信号会阻断闭环判定。` });
    }
    if (signals.missingOutputNodes.length) {
      actions.push({ tone: "block", title: "补齐工具输出", body: `${signals.missingOutputNodes.length} 个执行动作缺少对应输出。` });
    }
    if (signals.failedVerificationNodes.length) {
      actions.push({ tone: "block", title: "修复失败验证", body: "已有验证节点显示失败或带风险，不能直接归档为完成。" });
    } else if (String(stats.verificationStatus || "") === "验证不足") {
      actions.push({ tone: "warn", title: "复核验证风险", body: "验证节点存在风险信号，需要确认是否影响最终结论。" });
    } else if (signals.missingVerificationNodes.length || signals.needsVerification) {
      actions.push({ tone: "warn", title: "补声明验证", body: "最终回复包含验证或完成声明，但没有对应验证证据。" });
    }
    if (signals.needsEvidence) {
      actions.push({ tone: "warn", title: "补证据来源", body: "执行链存在动作，但闭环区没有工具输出证据。" });
    }
    if (!actions.length && signals.reviewNodes.length) {
      actions.push({ tone: "warn", title: "人工复核风险", body: `${signals.reviewNodes.length} 个低/中风险信号需要确认是否影响结论。` });
    }
    if (!actions.length) {
      actions.push({ tone: "ok", title: "可归档", body: "目标、结论、证据和风险检查均未发现阻断项。" });
    }
    return actions.slice(0, 4);
  }

  function closureHeadline(status, { counts, hasExecution, signals, stats }) {
    if (status === "closed") return counts.verification ? "最终回复有证据和验证支撑" : "最终回复有证据支撑";
    if (status === "blocked") {
      if (!counts.final) return "缺少最终回复，闭环中断";
      if (signals.highRiskNodes.length) return "存在高风险信号，不能判定闭环";
      if (signals.failedVerificationNodes.length) return "验证失败，结论不能采信";
      if (signals.missingOutputNodes.length) return "执行缺少输出证据";
      return "存在阻断项，不能直接归档";
    }
    if (status === "review") {
      if (String(stats.verificationStatus || "") === "验证不足") return "验证带风险，需要复核";
      if (signals.needsVerification) return "声明缺少验证证据";
      if (signals.needsEvidence) return "缺少输出证据，支撑不足";
      if (!counts.intent) return "目标边界不清，需要复核";
      if (signals.reviewNodes.length) return "存在风险信号，需要复核";
      if (hasExecution) return "执行已记录，但闭环支撑不完整";
      return "结论存在但支撑不足";
    }
    return "没有足够审计节点";
  }

  function closureSummary({ counts, hasExecution, signals, stats }) {
    const parts = [];
    parts.push(`目标 ${counts.intent} · 结论 ${counts.final}`);
    if (hasExecution) parts.push(`执行 ${counts.action} · 证据 ${counts.evidence} · 验证 ${counts.verification}`);
    if (signals.blockingNodes.length) parts.push(`阻断 ${signals.blockingNodes.length}`);
    if (!signals.blockingNodes.length && signals.reviewNodes.length) parts.push(`复核 ${signals.reviewNodes.length}`);
    if (!signals.riskNodes.length && !signals.gapNodes.length) parts.push("无风险缺口");
    if (stats.verificationStatus && stats.verificationStatus !== "未验证") parts.push(stats.verificationStatus);
    return parts.join("；");
  }

  function closureCountLabel({ status, supportTotal, visibleSupport, filtersActive, score, signals }) {
    const chunks = [statusLabel(status), `闭环度 ${score.label}`];
    chunks.push(filtersActive ? `显示支撑 ${visibleSupport}/${supportTotal}` : `支撑 ${supportTotal}`);
    if (signals.blockingNodes.length) chunks.push(`阻断 ${signals.blockingNodes.length}`);
    return chunks.join(" · ");
  }

  function statusLabel(status) {
    if (status === "closed") return "已闭环";
    if (status === "blocked") return "未闭环";
    if (status === "review") return "需复核";
    return "信息不足";
  }

  function verificationMetricState(signals, stats) {
    if (signals.failedVerificationNodes.length) return "block";
    if (
      signals.missingVerificationNodes.length ||
      signals.needsVerification ||
      String(stats.verificationStatus || "") === "缺少验证" ||
      String(stats.verificationStatus || "") === "验证不足"
    ) {
      return "warn";
    }
    if (String(stats.verificationStatus || "") === "已验证") return "ok";
    return "neutral";
  }

  function supportLaneState({ counts, signals, stats }) {
    if (signals.failedVerificationNodes.length) return "block";
    if (!counts.evidence || signals.missingVerificationNodes.length) return "warn";
    if (String(stats.verificationStatus || "") === "验证不足") return "warn";
    return "ok";
  }

  function laneCaption(filtersActive, visible, total, label) {
    if (filtersActive) return `${label} ${visible}/${total} 可见`;
    return `${label} ${total}`;
  }

  function countTypes(nodes) {
    return (nodes || []).reduce(
      (counts, node) => {
        if (node?.type in counts) counts[node.type] += 1;
        counts.total += 1;
        return counts;
      },
      { intent: 0, reasoning: 0, action: 0, evidence: 0, verification: 0, risk: 0, final: 0, total: 0 },
    );
  }

  function nodesOfTypes(nodes, types) {
    const set = new Set(types);
    return (nodes || []).filter((node) => set.has(node?.type));
  }

  function sortSupportNodes(nodes) {
    const priority = { verification: 0, evidence: 1 };
    return [...(nodes || [])].sort((left, right) => (priority[left.type] ?? 9) - (priority[right.type] ?? 9) || nodeRiskRank(right) - nodeRiskRank(left));
  }

  function sortRiskNodes(nodes) {
    return uniqueNodes(nodes).sort((left, right) => nodeRiskRank(right) - nodeRiskRank(left));
  }

  function isRiskNode(node) {
    return node?.type === "risk" || nodeRiskRank(node) > riskRank.none;
  }

  function isGapNode(node) {
    const tags = nodeTags(node);
    return tags.includes("missing-output") || tags.includes("missing-verification");
  }

  function isFailedVerification(node) {
    if (node?.type !== "verification") return false;
    const status = String(node.status || "").toLowerCase();
    return status === "failed" || status === "error" || nodeRiskRank(node) >= riskRank.high;
  }

  function nodeRiskRank(node) {
    const level = node?.riskLevel || (node?.type === "risk" ? "low" : "none");
    return riskRank[level] || riskRank.none;
  }

  function nodeTags(node) {
    return Array.isArray(node?.tags) ? node.tags : [];
  }

  function uniqueNodes(nodes) {
    const seen = new Set();
    const result = [];
    for (const node of nodes || []) {
      const key = node?.id || `${node?.type || "node"}:${result.length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(node);
    }
    return result;
  }

  function derivedVerificationStatus(counts, missingVerificationNodes, failedVerificationNodes) {
    if (failedVerificationNodes.length) return "验证不足";
    if (missingVerificationNodes.length) return "缺少验证";
    return counts.verification ? "已验证" : "未验证";
  }

  const api = {
    buildClosureReview,
    countTypes,
    statusLabel,
  };

  globalThis.AuditClosure = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
