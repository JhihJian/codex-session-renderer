{
  const api = window.SessionWorkbench;
  const { state, els } = api;
  const escapeAttr = (...args) => api.escapeAttr(...args);
  const escapeHtml = (...args) => api.escapeHtml(...args);
  const errorTextFromError = (...args) => api.errorTextFromError(...args);
  const fetchJson = (...args) => api.fetchJson(...args);
  const showToast = (...args) => api.showToast(...args);
  const loadHealthAndSources = (...args) => api.loadHealthAndSources(...args);
  const clearSelectedSession = (...args) => api.clearSelectedSession(...args);
  const renderSettingsDialog = (...args) => api.renderSettingsDialog(...args);
  const closeSettingsDialogAndRestoreFocus = (...args) => api.closeSettingsDialogAndRestoreFocus(...args);

const dataSourceRootTypeOptions = [
  ["sessions", "会话根 sessions"],
  ["tasks", "任务根 tasks"],
  ["evaluations", "评估根 evaluations"],
];

function dataSourceRootTypeLabel(type) {
  return dataSourceRootTypeOptions.find(([value]) => value === type)?.[1] || type || "";
}

function dataSourceOverviewValue() {
  const config = state.dataSourceConfig;
  if (!config) return "…";
  return config.override ? dataSourceRootTypeLabel(config.override.type) : "环境默认";
}

function dataSourceOverviewDetail() {
  const config = state.dataSourceConfig;
  if (!config) return "读取根加载中";
  if (config.override) return `覆盖：${config.override.path}`;
  return config.envDefault ? `环境变量：${config.envDefault.path}` : "未配置 Pi 根";
}

function resetDataSourcePanelState() {
  state.dataSourceDraft = null;
  state.dataSourceLoadError = "";
  state.dataSourceSaving = false;
  state.dataSourceFieldErrors = [];
  state.dataSourceFeedback = "";
}

function initDataSourceDraft(config) {
  if (config.override) return { mode: "override", type: config.override.type, path: config.override.path };
  const fallbackType = config.envDefault?.type || "sessions";
  return { mode: "clear", type: fallbackType, path: "" };
}

async function loadDataSourceConfig() {
  try {
    state.dataSourceConfig = await fetchJson("/api/data-source-config");
    state.dataSourceLoadError = "";
    state.dataSourceDraft = initDataSourceDraft(state.dataSourceConfig);
  } catch (error) {
    state.dataSourceConfig = null;
    state.dataSourceDraft = null;
    state.dataSourceLoadError = errorTextFromError(error);
  }
  if (els.settingsDialog?.open) renderSettingsDialog();
}

function dataSourceEffectiveDescription(config) {
  if (config.override) return `覆盖生效：${dataSourceRootTypeLabel(config.override.type)} · ${config.override.path}`;
  if (config.envDefault) return `环境默认：${dataSourceRootTypeLabel(config.envDefault.type)} · ${config.envDefault.path}`;
  return "当前未配置 Pi 根，默认使用本机 Codex Home。";
}

function renderDataSourcePanel() {
  if (!els.dataSourceConfigBody) return;
  const config = state.dataSourceConfig;
  if (state.dataSourceLoadError) {
    els.dataSourceConfigBody.innerHTML = `<div class="rule-empty">数据源配置读取失败：${escapeHtml(state.dataSourceLoadError)}</div>`;
    return;
  }
  if (!config) {
    els.dataSourceConfigBody.innerHTML = `<div class="rule-empty">数据源配置加载中…</div>`;
    return;
  }
  if (!config.configPath) {
    els.dataSourceConfigBody.innerHTML = `
      <div class="rule-empty">
        界面配置未启用：服务未设置 CODEX_SESSION_RENDERER_CONFIG_PATH。
        ${escapeHtml(dataSourceEffectiveDescription(config))}
      </div>`;
    return;
  }
  const draft = state.dataSourceDraft || initDataSourceDraft(config);
  const writableNote = config.writable ? "" : `<div class="rule-field-error" role="alert">配置文件目录不可写，保存会失败。</div>`;
  const parseErrorNote = config.parseError ? `<div class="rule-field-error" role="alert">配置文件解析失败，已回退环境默认：${escapeHtml(config.parseError)}</div>` : "";
  const modeNote = draft.mode === "clear"
    ? `<div class="rule-empty compact">已选择恢复环境变量默认；保存后将清除界面覆盖。</div>`
    : "";
  els.dataSourceConfigBody.innerHTML = `
    <div class="default-rule-row">
      <strong>当前生效</strong>
      <span>${escapeHtml(dataSourceEffectiveDescription(config))}</span>
      <code>${escapeHtml(config.configPath)}${config.writable ? "" : "（目录不可写）"}</code>
    </div>
    ${parseErrorNote}
    ${writableNote}
    <fieldset class="summary-rule-card" ${state.dataSourceSaving ? "disabled" : ""}>
      <legend class="field-label">根类型</legend>
      <div class="command-capability-list" role="radiogroup" aria-label="根类型">
        ${dataSourceRootTypeOptions.map(([value, label]) => `
          <label class="toggle-control">
            <input type="radio" name="dataSourceRootType" value="${escapeAttr(value)}" ${draft.type === value ? "checked" : ""} data-data-source-field="type" />
            <span>${escapeHtml(label)}</span>
          </label>
        `).join("")}
      </div>
      <label>
        <span class="field-label">根目录绝对路径</span>
        <input class="text-input" type="text" value="${escapeAttr(draft.path)}" data-data-source-field="path" placeholder="/srv/report-agent/tasks/sw" spellcheck="false" ${dataSourceFieldAttrs("path")} />
        ${renderDataSourceFieldError("path")}
      </label>
      ${modeNote}
      <div class="settings-actions">
        <button class="ghost-button" type="button" data-data-source-action="restore-env" ${config.envDefault ? "" : "disabled"}>恢复环境变量默认</button>
        <button class="primary-button" type="button" data-data-source-action="save" ${state.dataSourceSaving ? "disabled" : ""}>${state.dataSourceSaving ? "保存中…" : "保存数据源"}</button>
      </div>
      ${state.dataSourceFeedback ? `<div class="rule-field-error" role="alert">${escapeHtml(state.dataSourceFeedback)}</div>` : ""}
    </fieldset>
  `;
  bindDataSourcePanelEvents();
}

function dataSourceFieldAttrs(field) {
  return state.dataSourceFieldErrors?.some((error) => error.field === field) ? `aria-invalid="true"` : "";
}

function renderDataSourceFieldError(field) {
  const error = state.dataSourceFieldErrors?.find((candidate) => candidate.field === field);
  return error ? `<span class="rule-field-error" role="alert">${escapeHtml(error.message)}</span>` : "";
}

function bindDataSourcePanelEvents() {
  const body = els.dataSourceConfigBody;
  body.querySelectorAll("[data-data-source-field]").forEach((input) => {
    const handler = () => updateDataSourceDraftFromInput(input);
    input.addEventListener("change", handler);
    if (input.type === "text") input.addEventListener("input", handler);
  });
  body.querySelectorAll("[data-data-source-action]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.dataSourceAction === "restore-env") restoreDataSourceEnvDefault();
      else void saveDataSourceConfig();
    });
  });
}

function updateDataSourceDraftFromInput(input) {
  const draft = state.dataSourceDraft;
  if (!draft) return;
  const field = input.dataset.dataSourceField;
  if (field === "type") draft.type = input.value;
  if (field === "path") draft.path = input.value;
  draft.mode = "override";
  state.dataSourceFieldErrors = [];
  state.dataSourceFeedback = "";
  renderDataSourcePanel();
}

function restoreDataSourceEnvDefault() {
  const config = state.dataSourceConfig;
  if (!config?.configPath) return;
  state.dataSourceDraft = { mode: "clear", type: config.envDefault?.type || "sessions", path: "" };
  state.dataSourceFieldErrors = [];
  state.dataSourceFeedback = "";
  renderDataSourcePanel();
}

function validateDataSourceDraft(draft) {
  if (draft.mode === "clear") return [];
  const errors = [];
  if (!dataSourceRootTypeOptions.some(([value]) => value === draft.type)) {
    errors.push({ field: "type", message: "根类型必须是 sessions、tasks 或 evaluations。" });
  }
  const rootPath = String(draft.path || "").trim();
  if (!rootPath) errors.push({ field: "path", message: "根目录绝对路径不能为空。" });
  else if (!rootPath.startsWith("/")) errors.push({ field: "path", message: "根目录必须是绝对路径。" });
  return errors;
}

async function saveDataSourceConfig() {
  const config = state.dataSourceConfig;
  const draft = state.dataSourceDraft;
  if (!config?.configPath || !draft || state.dataSourceSaving) return;
  const errors = validateDataSourceDraft(draft);
  if (errors.length) {
    state.dataSourceFieldErrors = errors;
    renderDataSourcePanel();
    return;
  }
  state.dataSourceSaving = true;
  state.dataSourceFeedback = "";
  renderDataSourcePanel();
  const requestBody = draft.mode === "clear" ? null : { type: draft.type, path: String(draft.path).trim() };
  try {
    const result = await fetchJson("/api/data-source-config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ piAgentRoot: requestBody }),
    });
    state.dataSourceConfig = {
      configPath: result.configPath,
      writable: result.writable,
      override: result.override ?? null,
      envDefault: result.envDefault ?? null,
      parseError: result.parseError ?? null,
    };
    state.dataSourceDraft = initDataSourceDraft(state.dataSourceConfig);
  } catch (error) {
    state.dataSourceSaving = false;
    state.dataSourceFeedback = errorTextFromError(error);
    renderDataSourcePanel();
    showToast(`数据源保存失败：${errorTextFromError(error)}`);
    return;
  }
  state.dataSourceSaving = false;
  clearSelectedSession();
  closeSettingsDialogAndRestoreFocus();
  showToast("数据源已更新，会话列表已刷新");
  try {
    await loadHealthAndSources({ announce: true });
  } catch (error) {
    showToast(`数据源已更新，但刷新来源失败：${errorTextFromError(error)}`);
  }
}

  Object.assign(api, { dataSourceRootTypeLabel, dataSourceOverviewValue, dataSourceOverviewDetail, resetDataSourcePanelState, loadDataSourceConfig, renderDataSourcePanel, updateDataSourceDraftFromInput, restoreDataSourceEnvDefault, saveDataSourceConfig });
}
