{
  const api = window.SessionWorkbench;
  const responseScopeMatches = (...args) => api.responseScopeMatches(...args);
  const sourceRequestOwnsState = (...args) => api.sourceRequestOwnsState(...args);
  const sourceNavigationRequestIsCurrent = (...args) => api.sourceNavigationRequestIsCurrent(...args);

  function sourceRequestState({ requestKey, expectedRequestKey, sourceId, context }) {
    if (!sourceRequestOwnsState({ requestKey, expectedRequestKey, sourceId })) return "stale";
    return sourceNavigationRequestIsCurrent({ requestKey, expectedRequestKey, sourceId, context }) ? "current" : "navigation-changed";
  }

  function sourceResponseMatches(data, sourceId, responseKind) {
    const expectedScope = arguments[3];
    if (responseKind === "detail") return data?.session?.sourceId === sourceId;
    if (data?.source?.id !== sourceId) return false;
    if (!responseScopeMatches(data, expectedScope)) return false;
    const collectionKey = responseKind === "prompts" ? "entries" : responseKind === "sessions" ? "sessions" : "";
    const entries = collectionKey ? data?.[collectionKey] : null;
    return !Array.isArray(entries) || entries.every((entry) => !entry?.sourceId || entry.sourceId === sourceId);
  }

  Object.assign(api, { sourceRequestState, sourceResponseMatches });
}