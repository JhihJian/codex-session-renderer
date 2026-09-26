{
  const api = window.SessionWorkbench;
  const { els } = api;
  const { state } = api;
  const collapseTopbarMenus = (...args) => api.collapseTopbarMenus(...args);
  const invalidateSessionListRequests = (...args) => api.invalidateSessionListRequests(...args);
  const cancelAlternateLocalSourceDiscovery = (...args) => api.cancelAlternateLocalSourceDiscovery(...args);
  const renderSourceControls = (...args) => api.renderSourceControls(...args);
  const renderAll = (...args) => api.renderAll(...args);
  const renderSessionList = (...args) => api.renderSessionList(...args);
  const clearSelectedSession = (...args) => api.clearSelectedSession(...args);
  const setWorkbenchStatus = (...args) => api.setWorkbenchStatus(...args);
  const setBusy = (...args) => api.setBusy(...args);
  const upsertSource = (...args) => api.upsertSource(...args);
  const fetchJson = (...args) => api.fetchJson(...args);
  const temporarySessionUrl = (...args) => api.temporarySessionUrl(...args);
  const selectSession = (...args) => api.selectSession(...args);
  const showToast = (...args) => api.showToast(...args);

  let opener = null;

  function temporarySource() {
    return { id: "temporary", label: "临时本机会话", kind: "temporary", status: {} };
  }

  async function openTemporarySession(filePath, { announce = true } = {}) {
    const requestedPath = String(filePath || "").trim();
    if (!requestedPath) throw new Error("请输入会话文件绝对路径。");
    invalidateSessionListRequests();
    cancelAlternateLocalSourceDiscovery();
    state.temporarySessionPath = requestedPath;
    state.temporarySessionIsDirectory = false;


    state.sources = state.sources.filter((source) => source.id !== "temporary");
    state.sources.push(temporarySource());
    state.selectedSourceId = "temporary";
    state.sessions = [{ id: "temporary", displayTitle: "正在读取临时会话", sourceId: "temporary", sourceLabel: "临时本机会话", dataSourceKind: "temporary" }];
    state.filteredSessions = [];
    state.sessionsLoadError = "";
    state.sessionTimeFilter = "earlier";
    setBusy(false);
    renderSourceControls();
    const data = await fetchJson(temporarySessionUrl());
    if (Array.isArray(data.sessions)) {
      clearSelectedSession();
      state.temporarySessionIsDirectory = true;
      state.sessions = data.sessions;
      state.sessionTimeFilter = "earlier";
      state.sessionsLoading = false;
      if (data.source) upsertSource(data.source);
      setWorkbenchStatus(`temporary:${Date.now()}`, `临时会话目录已加载：${state.sessions.length} 个会话`, { announce });
      renderSourceControls();
      renderAll();
      renderSessionList();
      return;
    }
    await selectSession("temporary", { announce, immediateMobilePanel: true });
  }

  function openTemporarySessionDialog() {
    opener = document.activeElement;
    collapseTopbarMenus();
    els.temporarySessionStatus.textContent = "";
    els.temporarySessionPath.value = "";
    els.temporarySessionDialog.showModal();
    requestAnimationFrame(() => els.temporarySessionPath.focus());
  }

  function closeTemporarySessionDialog() {
    els.temporarySessionDialog.close();
    const target = opener && document.contains(opener) ? opener : els.openTemporarySessionButton;
    opener = null;
    requestAnimationFrame(() => target?.focus({ preventScroll: true }));
  }

  async function submitTemporarySession(event) {
    event.preventDefault();
    const filePath = els.temporarySessionPath.value.trim();
    if (!filePath) {
      els.temporarySessionStatus.textContent = "请输入会话文件绝对路径。";
      els.temporarySessionPath.focus();
      return;
    }
    els.submitTemporarySessionButton.disabled = true;
    els.temporarySessionStatus.textContent = "正在读取会话文件";
    try {
      await openTemporarySession(filePath, { announce: true });
      closeTemporarySessionDialog();
    } catch (error) {
      els.temporarySessionStatus.textContent = error.message || "无法读取会话文件。";
      showToast(`打开会话失败：${error.message || "无法读取会话文件。"}`);
    } finally {
      els.submitTemporarySessionButton.disabled = false;
    }
  }

  function bindTemporarySessionDialog() {
    els.openTemporarySessionButton?.addEventListener("click", openTemporarySessionDialog);
    els.closeTemporarySessionDialogButton?.addEventListener("click", closeTemporarySessionDialog);
    els.cancelTemporarySessionButton?.addEventListener("click", closeTemporarySessionDialog);
    els.temporarySessionDialog?.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeTemporarySessionDialog();
    });
    els.temporarySessionForm?.addEventListener("submit", (event) => {
      void submitTemporarySession(event);
    });
  }

  Object.assign(api, { bindTemporarySessionDialog, closeTemporarySessionDialog, openTemporarySession, openTemporarySessionDialog, submitTemporarySession });
}