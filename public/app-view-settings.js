{
  const api = window.SessionWorkbench;
  const { state, els, settingsViewIds, settingsViewOptions } = api;
  const escapeAttr = (...args) => api.escapeAttr(...args);
  const escapeHtml = (...args) => api.escapeHtml(...args);
  const errorTextFromError = (...args) => api.errorTextFromError(...args);
  const showToast = (...args) => api.showToast(...args);
  const reloadSelectedSessionDetail = (...args) => api.reloadSelectedSessionDetail(...args);
  const renderMainContent = (...args) => api.renderMainContent(...args);
function openSettingsDialog() {
  const opener = document.activeElement;
  state.settingsDialogOpener = opener && opener !== document.body ? opener : els.settingsButton;
  clearSettingsValidationState();
  state.summaryRules = window.ToolSummary?.loadCustomRules?.() || [];
  normalizeSettingsView();
  state.settingsInitialSnapshot = settingsSnapshot();
  renderSettingsDialog();
  els.settingsDialog?.showModal();
}

function requestCloseSettingsDialog() {
  if (!els.settingsDialog?.open) return true;
  if (settingsDirty() && !window.confirm("放弃更改？")) {
    syncSettingsDirtyState();
    return false;
  }
  restoreSettingsInitialSnapshot();
  clearSettingsValidationState();
  closeSettingsDialogAndRestoreFocus();
  return true;
}

function closeSettingsDialogAndRestoreFocus() {
  els.settingsDialog?.close();
  restoreSettingsDialogFocus();
}

function restoreSettingsDialogFocus() {
  const opener = state.settingsDialogOpener;
  const target = opener && document.contains(opener) ? opener : els.settingsButton;
  state.settingsDialogOpener = null;
  requestAnimationFrame(() => {
    if (target && document.contains(target) && typeof target.focus === "function") {
      target.focus({ preventScroll: true });
    }
  });
}

function selectSettingsViewFromEvent(event) {
  const button = event.target.closest("[data-settings-view]");
  if (!button) return;
  selectSettingsView(button.dataset.settingsView);
}

function selectSettingsView(view) {
  if (!settingsViewIds.has(view)) return;
  state.settingsView = view;
  renderSettingsDialog();
}

function normalizeSettingsView() {
  if (!settingsViewIds.has(state.settingsView)) state.settingsView = "summary";
}

function renderSettingsDialog() {
  normalizeSettingsView();
  renderSettingsOverview();
  renderSettingsTabs();
  syncSettingsPanelVisibility();
  renderActiveSettingsPanel();
  syncSettingsDirtyState();
}

function settingsSnapshot() {
  return JSON.stringify({ summaryRules: state.summaryRules || [] });
}

function settingsDirty() {
  return Boolean(state.settingsInitialSnapshot && settingsSnapshot() !== state.settingsInitialSnapshot);
}

function stableSettingsJson(value) {
  return JSON.stringify(stableSettingsValue(value));
}

function stableSettingsValue(value) {
  if (Array.isArray(value)) return value.map(stableSettingsValue);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      result[key] = stableSettingsValue(value[key]);
      return result;
    }, {});
}

function restoreSettingsInitialSnapshot() {
  if (!state.settingsInitialSnapshot) return;
  try {
    const snapshot = JSON.parse(state.settingsInitialSnapshot);
    state.summaryRules = Array.isArray(snapshot.summaryRules) ? snapshot.summaryRules : [];
  } catch {
    state.summaryRules = window.ToolSummary?.loadCustomRules?.() || [];
  }
}

function syncSettingsDirtyState() {
  const dirty = settingsDirty();
  if (els.saveSettingsButton) {
    els.saveSettingsButton.disabled = !dirty;
    els.saveSettingsButton.title = dirty ? "保存展示规则更改" : "没有未保存更改";
  }
  if (els.settingsStatus) {
    if (state.settingsValidationMessage) {
      els.settingsStatus.textContent = state.settingsValidationMessage;
      els.settingsStatus.dataset.status = "error";
      els.settingsStatus.setAttribute("role", "alert");
      els.settingsStatus.setAttribute("aria-live", "assertive");
      return;
    }
    if (state.settingsFeedbackMessage) {
      els.settingsStatus.textContent = state.settingsFeedbackMessage;
      els.settingsStatus.dataset.status = state.settingsFeedbackStatus || "info";
      els.settingsStatus.setAttribute("role", state.settingsFeedbackStatus === "error" ? "alert" : "status");
      els.settingsStatus.setAttribute("aria-live", state.settingsFeedbackStatus === "error" ? "assertive" : "polite");
      return;
    }
    delete els.settingsStatus.dataset.status;
    els.settingsStatus.removeAttribute("role");
    els.settingsStatus.removeAttribute("aria-live");
    const currentView = settingsViewOptions.find((view) => view.id === state.settingsView);
    const dirtyLabel = dirty ? "有未保存更改" : "没有未保存更改";
    els.settingsStatus.textContent = `${dirtyLabel} · ${currentView?.label || "展示规则"} · 摘要自定义 ${state.summaryRules.length} 条；配置保存在当前浏览器本地。`;
  }
}

function renderSettingsOverview() {
  if (!els.settingsOverview) return;
  els.settingsOverview.innerHTML = settingsOverviewItems()
    .map(
      (item) => `
        <button class="settings-overview-card ${state.settingsView === item.id ? "active" : ""}" type="button" data-settings-view="${escapeAttr(item.id)}">
          <span>${escapeHtml(item.label)}</span>
          <strong>${escapeHtml(item.value)}</strong>
          <em>${escapeHtml(item.detail)}</em>
        </button>
      `,
    )
    .join("");
}

function settingsOverviewItems() {
  const summaryDefaultCount = window.ToolSummary?.defaultRules?.()?.length || 0;
  const summaryActiveCount = window.ToolSummary?.activeRules?.(state.summaryRules)?.length || summaryDefaultCount;

  return [
    {
      id: "summary",
      label: "摘要规则",
      value: `${summaryActiveCount}`,
      detail: `${state.summaryRules.length} 条自定义 · ${summaryDefaultCount} 条内置`,
    },

    {
      id: "structured",
      label: "结构化展示",
      value: "3",
      detail: "Git、搜索、测试检查结构化视图",
    },
  ];
}

function renderSettingsTabs() {
  if (!els.settingsTabs) return;
  els.settingsTabs.querySelectorAll("[data-settings-view]").forEach((button) => {
    const active = button.dataset.settingsView === state.settingsView;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
    button.tabIndex = active ? 0 : -1;
  });
}

function syncSettingsPanelVisibility() {
  document.querySelectorAll("[data-settings-panel]").forEach((section) => {
    section.hidden = section.dataset.settingsPanel !== state.settingsView;
  });
}

function renderActiveSettingsPanel() {
  if (state.settingsView === "summary") {
    renderSummaryRuleList();
    renderDefaultSummaryRuleList();
  }
}

function clearSettingsValidationState() {
  state.settingsValidationErrors = [];
  state.settingsValidationMessage = "";
  state.settingsFeedbackMessage = "";
  state.settingsFeedbackStatus = "";
}

function clearSettingsValidationFeedback() {
  if (!state.settingsValidationErrors?.length && !state.settingsValidationMessage && !state.settingsFeedbackMessage) return;
  clearSettingsValidationState();
  els.settingsForm?.querySelectorAll("[aria-invalid='true']").forEach((input) => {
    input.removeAttribute("aria-invalid");
    input.removeAttribute("aria-describedby");
  });
  els.settingsForm?.querySelectorAll(".rule-field-error").forEach((error) => error.remove());
}

function settingsFieldError(view, index, field) {
  return (state.settingsValidationErrors || []).find((error) => error.view === view && error.index === index && error.field === field);
}

function settingsFieldErrorId(view, index, field) {
  return `settings-${view}-${index}-${field}-error`;
}

function settingsFieldAttrs(view, index, field) {
  const error = settingsFieldError(view, index, field);
  if (!error) return "";
  return `aria-invalid="true" aria-describedby="${escapeAttr(settingsFieldErrorId(view, index, field))}"`;
}

function renderSettingsFieldError(view, index, field) {
  const error = settingsFieldError(view, index, field);
  if (!error) return "";
  return `<span class="rule-field-error" id="${escapeAttr(settingsFieldErrorId(view, index, field))}" role="alert">${escapeHtml(error.message)}</span>`;
}

function validateSettingsRulesForSave() {
  return [...(window.ToolSummary?.validateRulesForSave?.(state.summaryRules) || []).map((error) => ({ ...error, view: "summary" }))];
}

function settingsValidationMessage(errors) {
  const first = errors[0];
  if (!first) return "";
  const viewLabel = settingsViewOptions.find((view) => view.id === first.view)?.label || "设置";
  return `保存失败：${viewLabel}第 ${Number(first.index) + 1} 条，${first.message} 请修正后再保存。`;
}

function focusSettingsValidationError(error) {
  const input = settingsInputForError(error);
  if (!input) return;
  input.focus({ preventScroll: true });
  input.scrollIntoView({ block: "center", inline: "nearest" });
}

function settingsInputForError(error) {
  if (!error) return null;
  const selectors = {
    summary: `[data-rule-field="${error.field}"][data-rule-index="${error.index}"]`,
  };
  const selector = selectors[error.view];
  return selector ? els.settingsForm?.querySelector(selector) : null;
}

function renderSummaryRuleList() {
  if (!els.summaryRuleList) return;
  if (!state.summaryRules.length) {
    els.summaryRuleList.innerHTML = `<div class="rule-empty">暂无自定义规则。新增后会优先匹配，再回退到内置规则。</div>`;
    return;
  }
  els.summaryRuleList.innerHTML = state.summaryRules.map((rule, index) => renderSummaryRuleEditor(rule, index)).join("");
  els.summaryRuleList.querySelectorAll("[data-rule-field]").forEach((input) => {
    input.addEventListener("input", () => updateSummaryRuleFromInput(input));
    input.addEventListener("change", () => updateSummaryRuleFromInput(input));
  });
  els.summaryRuleList.querySelectorAll("[data-delete-rule]").forEach((button) => {
    button.addEventListener("click", () => {
      clearSettingsValidationState();
      state.summaryRules.splice(Number(button.dataset.deleteRule), 1);
      renderSettingsDialog();
    });
  });
}

function renderSummaryRuleEditor(rule, index) {
  const enabled = rule.enabled !== false;
  return `
    <article class="summary-rule-card">
      <div class="summary-rule-head">
        <label class="toggle-control">
          <input type="checkbox" ${enabled ? "checked" : ""} data-rule-field="enabled" data-rule-index="${escapeAttr(String(index))}" />
          <span>启用</span>
        </label>
        <button class="ghost-button small danger" type="button" data-delete-rule="${escapeAttr(String(index))}">删除</button>
      </div>
      <div class="summary-rule-grid">
        <label>
          <span class="field-label">名称（可选，仅用于管理）</span>
          <input class="text-input" type="text" value="${escapeAttr(rule.label || "")}" data-rule-field="label" data-rule-index="${escapeAttr(String(index))}" placeholder="读取文件" />
        </label>
        <label>
          <span class="field-label">工具</span>
          <input class="text-input" type="text" value="${escapeAttr(rule.tool || "")}" data-rule-field="tool" data-rule-index="${escapeAttr(String(index))}" placeholder="exec_command 或 *" ${settingsFieldAttrs("summary", index, "tool")} />
          ${renderSettingsFieldError("summary", index, "tool")}
        </label>
        <label>
          <span class="field-label">标题模板</span>
          <input class="text-input" type="text" value="${escapeAttr(rule.title || "")}" data-rule-field="title" data-rule-index="${escapeAttr(String(index))}" placeholder="读取文件内容" ${settingsFieldAttrs("summary", index, "title")} />
          ${renderSettingsFieldError("summary", index, "title")}
        </label>
        <label>
          <span class="field-label">摘要模板</span>
          <input class="text-input" type="text" value="${escapeAttr(rule.summary || "")}" data-rule-field="summary" data-rule-index="${escapeAttr(String(index))}" placeholder="{path}" />
        </label>
      </div>
      <label>
        <span class="field-label">匹配正则</span>
        <textarea class="text-input rule-pattern-input" data-rule-field="pattern" data-rule-index="${escapeAttr(String(index))}" spellcheck="false" placeholder="\\bGet-Content\\b" ${settingsFieldAttrs("summary", index, "pattern")}>${escapeHtml(rule.pattern || "")}</textarea>
        ${renderSettingsFieldError("summary", index, "pattern")}
      </label>
    </article>
  `;
}

function renderDefaultSummaryRuleList() {
  if (!els.defaultSummaryRuleList) return;
  const rules = window.ToolSummary?.defaultRules?.() || [];
  els.defaultSummaryRuleList.innerHTML = rules
    .map(
      (rule) => `
        <div class="default-rule-row">
          <strong>${escapeHtml(rule.title || rule.label)}</strong>
          <span>${escapeHtml([rule.tool || "*", rule.label].filter(Boolean).join(" · "))}</span>
          <code>${escapeHtml(rule.pattern || "")}</code>
        </div>
      `,
    )
    .join("");
}

function updateSummaryRuleFromInput(input) {
  clearSettingsValidationFeedback();
  const index = Number(input.dataset.ruleIndex);
  const field = input.dataset.ruleField;
  const rule = state.summaryRules[index];
  if (!rule || !field) return;
  rule[field] = field === "enabled" ? input.checked : input.value;
  syncSettingsDirtyState();
}

async function saveSettingsFromForm(event) {
  event.preventDefault();
  if (!settingsDirty()) {
    syncSettingsDirtyState();
    return;
  }
  const validationErrors = validateSettingsRulesForSave();
  if (validationErrors.length) {
    state.settingsValidationErrors = validationErrors;
    state.settingsValidationMessage = settingsValidationMessage(validationErrors);
    state.settingsView = validationErrors[0].view || state.settingsView;
    renderSettingsDialog();
    requestAnimationFrame(() => focusSettingsValidationError(validationErrors[0]));
    return;
  }
  clearSettingsValidationState();
  let normalized;
  try {
    normalized = window.ToolSummary?.saveCustomRules?.(state.summaryRules) || [];
  } catch (error) {
    const message = `保存展示规则失败：${errorTextFromError(error)}`;
    state.settingsFeedbackMessage = message;
    state.settingsFeedbackStatus = "error";
    syncSettingsDirtyState();
    showToast(message);
    return;
  }

  state.summaryRules = normalized;
  state.settingsInitialSnapshot = settingsSnapshot();
  renderSettingsDialog();
  try {
    if (state.selectedSessionId) {
      await reloadSelectedSessionDetail();
    } else {
      renderMainContent();
    }
  } catch (error) {
    const message = `展示规则已保存，但当前会话重新读取失败：${errorTextFromError(error)}`;
    state.settingsFeedbackMessage = message;
    state.settingsFeedbackStatus = "warning";
    syncSettingsDirtyState();
    showToast(message);
    return;
  }
  showToast("展示规则已保存");
  closeSettingsDialogAndRestoreFocus();
}

function newSummaryRule() {
  return {
    id: `custom-${Date.now()}`,
    label: "自定义规则",
    enabled: true,
    tool: "exec_command",
    pattern: "",
    title: "",
    summary: "{cmd}",
  };
}

  Object.assign(api, { openSettingsDialog, requestCloseSettingsDialog, closeSettingsDialogAndRestoreFocus, restoreSettingsDialogFocus, selectSettingsViewFromEvent, selectSettingsView, normalizeSettingsView, renderSettingsDialog, settingsSnapshot, settingsDirty, stableSettingsJson, stableSettingsValue, restoreSettingsInitialSnapshot, syncSettingsDirtyState, renderSettingsOverview, settingsOverviewItems, renderSettingsTabs, syncSettingsPanelVisibility, renderActiveSettingsPanel, clearSettingsValidationState, clearSettingsValidationFeedback, settingsFieldError, settingsFieldErrorId, settingsFieldAttrs, renderSettingsFieldError, validateSettingsRulesForSave, settingsValidationMessage, focusSettingsValidationError, settingsInputForError, renderSummaryRuleList, renderSummaryRuleEditor, renderDefaultSummaryRuleList, updateSummaryRuleFromInput, saveSettingsFromForm, newSummaryRule });
}
