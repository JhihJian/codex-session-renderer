(function evidenceIdModule(global) {
  function evidencePart(value, fallback) {
    const normalized = String(value ?? "").trim() || fallback;
    return encodeURIComponent(normalized);
  }

  function buildEvidenceId({
    sourceId,
    sessionId,
    threadPath,
    threadNodeId,
    turnNumber,
    eventIndex,
    nodeId,
    entity = "object",
  } = {}) {
    const parts = [
      `source:${evidencePart(sourceId, "unknown")}`,
      `session:${evidencePart(sessionId, "unknown")}`,
      `thread:${evidencePart(threadPath || threadNodeId, "root")}`,
    ];
    if (turnNumber != null) parts.push(`turn:${evidencePart(turnNumber, "unknown")}`);
    if (eventIndex != null) parts.push(`event:${evidencePart(eventIndex, "unknown")}`);
    if (nodeId) parts.push(`node:${evidencePart(nodeId, "unknown")}`);
    parts.push(`object:${evidencePart(entity, "object")}`);
    return parts.join("|");
  }

  global.EvidenceId = { buildEvidenceId };
})(typeof window === "undefined" ? globalThis : window);