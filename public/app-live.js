{
  const api = window.SessionWorkbench;
  const { state, els } = api;

  function liveUrl(sessionId, sourceId) {
    const encodedId = encodeURIComponent(sessionId);
    if (sourceId && sourceId !== "local") return `/api/sources/${encodeURIComponent(sourceId)}/query/sessions/${encodedId}/live`;
    return `/api/query/sessions/${encodedId}/live?sourceId=${encodeURIComponent(sourceId || "local")}`;
  }

  function liveConnectionLabel(connection) {
    return ({ connecting: "连接中", live: "实时同步", reconnecting: "重连中", stale: "数据可能已过期", stopped: "未开启" })[connection] || "状态未知";
  }

  function liveSessionLabel(status) {
    return ({ running: "执行中", waiting: "等待工具或输入", completed: "已完成", failed: "失败", aborted: "已中断", stopped: "已停止", unknown: "状态未知" })[status] || "状态未知";
  }

  function renderLiveStatus() {
    if (!els.liveModeToggle || !els.liveStatus) return;
    els.liveModeToggle.checked = state.live.enabled;
    const label = state.live.enabled
      ? `${liveConnectionLabel(state.live.connection)} · ${liveSessionLabel(state.live.sessionStatus)}`
      : "未开启";
    els.liveStatus.textContent = label;
    els.liveStatus.dataset.state = state.live.enabled ? state.live.connection : "stopped";
  }

  function stopLiveSession({ keepEnabled = false } = {}) {
    state.live.eventSource?.close();
    state.live.eventSource = null;
    state.live.connection = "stopped";
    state.live.sessionStatus = "unknown";
    state.live.generation = "";
    state.live.nextSequence = 0;
    state.live.events = [];
    state.live.unseenCount = 0;
    state.live.sourceKey = "";
    state.live.lastObservedAt = "";
    if (!keepEnabled) state.live.enabled = false;
    renderLiveStatus();
  }

  function startLiveSession() {
    const sessionId = state.selectedSessionId;
    const sourceId = state.selectedSourceId;
    if (!state.live.enabled || !sessionId) return;
    stopLiveSession({ keepEnabled: true });
    state.live.connection = "connecting";
    state.live.sourceKey = `${sourceId}:${sessionId}`;
    renderLiveStatus();
    const expectedKey = state.live.sourceKey;
    const stream = new EventSource(liveUrl(sessionId, sourceId));
    state.live.eventSource = stream;
    stream.addEventListener("snapshot", (event) => {
      if (!liveStreamIsCurrent(expectedKey, stream)) return;
      const snapshot = parseLivePayload(event);
      if (!snapshot) return;
      state.live.generation = snapshot.generation || "";
      state.live.nextSequence = Number(snapshot.nextSequence) || 0;
      state.live.events = Array.isArray(snapshot.events) ? snapshot.events : [];
      state.live.sessionStatus = snapshot.sessionStatus || "unknown";
      state.live.lastObservedAt = snapshot.observedAt || "";
      state.live.connection = "live";
      state.live.unseenCount = 0;
      renderLiveStatus();
      api.renderMainContent();
    });
    stream.addEventListener("append", (event) => {
      if (!liveStreamIsCurrent(expectedKey, stream)) return;
      const append = parseLivePayload(event);
      if (!append || append.generation !== state.live.generation || Number(append.sequence) !== state.live.nextSequence) {
        state.live.connection = "stale";
        renderLiveStatus();
        return;
      }
      state.live.events.push(append.event);
      state.live.nextSequence += 1;
      state.live.sessionStatus = append.sessionStatus || state.live.sessionStatus;
      state.live.lastObservedAt = append.observedAt || "";
      if (!state.live.following) state.live.unseenCount += 1;
      renderLiveStatus();
      api.renderMainContent();
      if (state.live.sessionStatus === "completed" || state.live.sessionStatus === "aborted") {
        void api.reloadSelectedSessionDetail?.().catch(() => {});
      }
    });
    stream.addEventListener("reset", () => {
      if (!liveStreamIsCurrent(expectedKey, stream)) return;
      state.live.connection = "connecting";
      state.live.events = [];
      state.live.nextSequence = 0;
      state.live.unseenCount = 0;
      renderLiveStatus();
      api.renderMainContent();
    });
    stream.addEventListener("status", (event) => {
      if (!liveStreamIsCurrent(expectedKey, stream)) return;
      const status = parseLivePayload(event);
      state.live.connection = status?.state === "degraded" ? "stale" : state.live.connection;
      renderLiveStatus();
    });
    stream.addEventListener("heartbeat", (event) => {
      if (!liveStreamIsCurrent(expectedKey, stream)) return;
      const heartbeat = parseLivePayload(event);
      if (!heartbeat?.sessionStatus) return;
      state.live.sessionStatus = heartbeat.sessionStatus;
      state.live.lastObservedAt = heartbeat.observedAt || state.live.lastObservedAt;
      renderLiveStatus();
    });
    stream.onerror = () => {
      if (!liveStreamIsCurrent(expectedKey, stream)) return;
      state.live.connection = "reconnecting";
      renderLiveStatus();
    };
  }

  function liveStreamIsCurrent(expectedKey, stream) {
    return state.live.enabled && state.live.sourceKey === expectedKey && state.live.eventSource === stream;
  }

  function parseLivePayload(event) {
    try {
      return JSON.parse(event.data);
    } catch {
      return null;
    }
  }

  function toggleLiveMode() {
    state.live.enabled = Boolean(els.liveModeToggle?.checked);
    state.live.following = true;
    if (state.live.enabled) startLiveSession();
    else {
      stopLiveSession();
    }
    renderLiveStatus();
    api.renderMainContent();
  }

  function liveDisplayItems(events) {
    const items = [];
    const messages = new Map();
    const tools = new Map();
    for (const event of events) {
      if (appendLiveMessage(event, items, messages)) continue;
      if (appendLiveTool(event, items, tools)) continue;
      appendLiveSupplement(event, items);
    }
    return items;
  }

  function appendLiveMessage(event, items, messages) {
    if (event.semanticKind !== "message" || !event.text) return false;
    const key = event.messageId || `message:${event.sourceIndex}`;
    const existing = messages.get(key);
    if (event.isDelta && existing) {
      existing.text += event.text;
      existing.timestamp = event.timestamp || existing.timestamp;
      return true;
    }
    if (existing) return true;
    const item = { type: "message", role: event.role === "user" ? "user" : "assistant", text: event.text, timestamp: event.timestamp, key };
    messages.set(key, item);
    items.push(item);
    return true;
  }

  function appendLiveTool(event, items, tools) {
    if (event.semanticKind === "tool_call") {
      const key = event.callId || `tool:${event.sourceIndex}`;
      const item = { type: "tool", state: "running", name: event.toolName || "工具", timestamp: event.timestamp, key };
      tools.set(key, item);
      items.push(item);
      return true;
    }
    if (event.semanticKind !== "tool_result") return false;
    const item = tools.get(event.callId);
    if (item) {
      item.state = "completed";
      item.output = event.toolOutput || "已收到工具结果";
      item.timestamp = event.timestamp || item.timestamp;
      return true;
    }
    items.push({ type: "tool", state: "completed", name: "工具", output: event.toolOutput || "已收到工具结果", timestamp: event.timestamp, key: `tool-result:${event.sourceIndex}` });
    return true;
  }

  function appendLiveSupplement(event, items) {
    if (event.semanticKind === "reasoning" && event.text) {
      items.push({ type: "reasoning", text: event.text, timestamp: event.timestamp, key: `reasoning:${event.sourceIndex}` });
    }
    if (event.semanticKind === "diagnostic") {
      items.push({ type: "diagnostic", text: event.diagnostic?.message || "会话记录无法解析", timestamp: event.timestamp, key: `diagnostic:${event.sourceIndex}` });
    }
  }

  function renderLiveTranscript() {
    const previousTop = els.compactContent.scrollTop;
    const shouldFollow = state.live.following || isNearLiveBottom();
    const items = liveDisplayItems(state.live.events);
    const status = `${liveConnectionLabel(state.live.connection)} · ${liveSessionLabel(state.live.sessionStatus)}`;
    els.compactContent.innerHTML = `
      <div class="live-transcript" aria-live="polite">
        <div class="live-transcript-head"><strong>实时会话</strong><span>${api.escapeHtml(status)}</span></div>
        <div class="live-transcript-list">
          ${items.map(renderLiveItem).join("") || `<div class="compact-empty">已连接，等待会话写入新内容。</div>`}
        </div>
        ${state.live.unseenCount ? `<button class="live-new-items" type="button" data-live-follow>有 ${state.live.unseenCount} 条新内容</button>` : ""}
      </div>
    `;
    els.compactContent.querySelector("[data-live-follow]")?.addEventListener("click", () => {
      state.live.following = true;
      state.live.unseenCount = 0;
      api.renderMainContent();
    });
    els.compactContent.onscroll = () => {
      const following = isNearLiveBottom();
      if (following !== state.live.following) {
        state.live.following = following;
        if (following) state.live.unseenCount = 0;
      }
    };
    if (shouldFollow) els.compactContent.scrollTop = els.compactContent.scrollHeight;
    else els.compactContent.scrollTop = previousTop;
  }

  function isNearLiveBottom() {
    return els.compactContent.scrollHeight - els.compactContent.scrollTop - els.compactContent.clientHeight < 48;
  }

  function renderLiveItem(item) {
    if (item.type === "message") {
      const label = item.role === "user" ? "用户" : "助手";
      return `<section class="live-message ${item.role}"><div><strong>${label}</strong><span>${api.escapeHtml(api.formatDate(item.timestamp) || "")}</span></div>${api.renderMarkdownMessage(item.text, "")}</section>`;
    }
    if (item.type === "tool") {
      const label = item.state === "running" ? "正在执行" : "已完成";
      return `<section class="live-activity state-${api.escapeAttr(item.state)}"><strong>${api.escapeHtml(label)} · ${api.escapeHtml(item.name)}</strong>${item.output ? `<pre>${api.escapeHtml(item.output)}</pre>` : ""}</section>`;
    }
    if (item.type === "reasoning") return `<section class="live-activity reasoning"><strong>推理摘要</strong><div>${api.renderMarkdownMessage(item.text, "")}</div></section>`;
    return `<section class="live-activity diagnostic"><strong>记录提示</strong><span>${api.escapeHtml(item.text)}</span></section>`;
  }

  Object.assign(api, { liveUrl, liveConnectionLabel, liveSessionLabel, renderLiveStatus, startLiveSession, stopLiveSession, toggleLiveMode, liveDisplayItems, renderLiveTranscript });
}