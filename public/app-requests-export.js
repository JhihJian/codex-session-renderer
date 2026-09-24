{
  const api = window.SessionWorkbench;
  const { state } = api;
  const temporarySessionUrl = (...args) => api.temporarySessionUrl(...args);
  const responseError = (...args) => api.responseError(...args);
  const showToast = (...args) => api.showToast(...args);
  const setWorkbenchStatus = (...args) => api.setWorkbenchStatus(...args);
  const renderTrace = (...args) => api.renderTrace(...args);

  function executionExportUrl(sessionId = state.selectedSessionId, sourceId = state.selectedSourceId) {
    if (sourceId === "temporary") return temporarySessionUrl("/execution-export");
    return `/api/sources/${encodeURIComponent(sourceId)}/sessions/${encodeURIComponent(sessionId)}/execution-export`;
  }

  async function exportExecutionText() {
    if (!state.selectedSessionId || state.executionExportLoading) return;
    state.executionExportLoading = true;
    renderTrace();
    try {
      const response = await fetch(executionExportUrl(), { cache: "no-store" });
      if (!response.ok) throw responseError(await response.text(), response.statusText, response.status);
      const blob = await response.blob();
      downloadExport(blob, downloadFilename(response.headers.get("content-disposition"), state.selectedSessionId));
      const bytes = new Intl.NumberFormat("zh-CN").format(blob.size);
      const message = `执行文本已导出，${bytes} 字节`;
      setWorkbenchStatus(`execution-export:${Date.now()}`, message, { announce: true });
      showToast(message);
    } catch (error) {
      const message = `导出执行文本失败：${error.message || "请求失败"}`;
      setWorkbenchStatus(`execution-export-error:${Date.now()}`, message, { announce: true });
      showToast(message);
    } finally {
      state.executionExportLoading = false;
      renderTrace();
    }
  }

  function downloadExport(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function downloadFilename(header, sessionId) {
    const filename = String(header || "").match(/filename="?([^";]+)"?/i)?.[1];
    return filename || `execution-${sessionId || "session"}.md`;
  }

  Object.assign(api, { executionExportUrl, exportExecutionText, downloadFilename });
}