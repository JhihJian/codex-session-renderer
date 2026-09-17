const rawEventCacheLimits = {
  maxEntries: 24,
  maxBytes: 8 * 1024 * 1024,
};

const { createRawEventCache } = window.RawEventCache;

const state = {
  sources: [],
  selectedSourceId: "local",
  sessions: [],
  filteredSessions: [],
  collapsedSessionDirectoryKeys: new Set(),
  sessionsLoading: false,
  sessionsLoadError: "",
  healthLoadError: "",
  sessionsRequestKey: "",
  sessionsRequestSeq: 0,
  sessionsAbortController: null,
  historyLoading: false,
  historyLoadError: "",
  historyLoaded: false,
  historyRequestKey: "",
  historyRequestSeq: 0,
  historyAbortController: null,
  sessionListScopeVersion: 0,

  mobilePanelNavigationVersion: 0,
  sessionLoading: false,
  sessionLoadError: "",
  sessionRequestKey: "",
  pendingSessionTitle: "",
  selectedSessionId: null,
  selectedSessionKey: null,
  detail: null,
  selectedItemRef: null,
  selectedEventIndex: null,
  selectedRawEvent: null,
  selectedDetailsNodeId: null,

  selectedTraceNodeId: null,

  selectedTerminalBlockId: null,
  expandedTraceNodeIds: new Set(),
  rawEventCache: createRawEventCache(rawEventCacheLimits),
  rawDiagnostic: null,
  viewMode: "compact",
  diagnosticMode: "stats",
  toolContextQuery: "",
  toolContextSort: "output-bytes",
  toolContextListExpanded: false,
  toolContextShowAll: false,

  sessionTimeFilter: "realtime",
  visibleEvents: 40,
  visibleThreadItems: 140,

  summaryRules: [],
  settingsView: "summary",
  settingsInitialSnapshot: "",
  settingsValidationErrors: [],
  settingsValidationMessage: "",
  settingsFeedbackMessage: "",
  settingsFeedbackStatus: "",
  settingsDialogOpener: null,


  alternateLocalSource: null,
  alternateLocalSourceLoading: false,
  alternateLocalSourceRequestKey: "",
  alternateLocalSourceScope: "",
  workbenchStatus: { key: "initial", message: "等待首次加载" },
  lastAnnouncement: "",
};

const {
  buildSessionDirectoryTree,
  compactNumber,
  cssEscape,
  escapeAttr,
  escapeHtml,
  firstLine,
  formatBytes,
  formatDate,
  formatShortDate,
  highlight,
  highlightHtmlText,
  nestSessionChains,
  normalizeMarkdownForRendering,
  prettyMaybeJson,
  sessionTimeBucket,
  shortPath,
} = window.AppFormat;
const { buildEvidenceId } = window.EvidenceId;

const markdownCache = new Map();
let sessionAbortController = null;
let rawDiagnosticAbortController = null;
let rawEventAbortController = null;

let alternateLocalSourceAbortController = null;
let sessionSearchTimer = null;
let compactTimelineObserver = null;
let compactTimelineJumpTarget = "";
const markdownCacheLimit = 700;

const visibleViewModes = new Set(["compact", "trace", "diagnostic"]);
let overflowTooltipFrame = 0;
const markdownRenderer = window.markdownit?.({
  html: false,
  linkify: true,
  breaks: false,
});
if (markdownRenderer) {
  const defaultLinkOpen =
    markdownRenderer.renderer.rules.link_open ||
    ((tokens, index, options, env, self) => self.renderToken(tokens, index, options));
  markdownRenderer.renderer.rules.link_open = (tokens, index, options, env, self) => {
    const token = tokens[index];
    const hrefIndex = token.attrIndex("href");
    const href = hrefIndex >= 0 ? token.attrs[hrefIndex][1] : "";
    if (/^https?:\/\//i.test(href)) {
      token.attrSet("target", "_blank");
      token.attrSet("rel", "noreferrer");
    }
    return defaultLinkOpen(tokens, index, options, env, self);
  };
  markdownRenderer.renderer.rules.fence = (...args) => window.SessionWorkbench.renderMarkdownFence(...args);
}

const localServiceUnavailableMessage = "无法连接本机服务。请确认服务已启动后点击刷新列表重试。";

const clientErrorMessages = new Map([
  ["Bad Request", "请求无效"],
  ["Bad request", "请求无效"],
  ["Data source not found", "数据源不存在"],
  ["Event not found", "事件不存在"],
  ["Forbidden", "禁止访问该资源"],
  ["Internal Server Error", "服务内部错误"],
  ["Internal server error", "服务内部错误"],

  ["Invalid JSON body", "请求体不是有效 JSON"],
  ["Method Not Allowed", "请求方法不允许"],
  ["Method not allowed", "请求方法不允许"],
  ["Not Found", "未找到资源"],
  ["Not found", "未找到资源"],
  ["Request body too large", "请求体过大"],
  ["Session not found", "会话不存在"],
  ["Unauthorized", "未授权访问"],
]);

const statusErrorMessages = new Map([
  [400, "请求无效"],
  [401, "未授权访问"],
  [403, "禁止访问该资源"],
  [404, "未找到资源"],
  [405, "请求方法不允许"],
  [413, "请求体过大"],
  [500, "服务内部错误"],
  [502, "上游服务不可用"],
  [503, "服务暂不可用"],
  [504, "上游服务响应超时"],
]);

const els = {
  appShell: document.getElementById("appShell"),
  healthStatus: document.getElementById("healthStatus"),
  sessionsPanel: document.getElementById("sessionsPanel"),
  threadPanel: document.getElementById("threadPanel"),
  toolDetailsContent: document.getElementById("toolDetailsContent"),




  sessionCount: document.getElementById("sessionCount"),
  sessionList: document.getElementById("sessionList"),
  sessionSearch: document.getElementById("sessionSearch"),
  sessionTimeFilter: document.getElementById("sessionTimeFilter"),
  sessionTypeFilter: document.getElementById("sessionTypeFilter"),

  itemSearch: document.getElementById("itemSearch"),
  itemTypeFilter: document.getElementById("itemTypeFilter"),
  importantOnly: document.getElementById("importantOnly"),
  importantOnlyControl: document.getElementById("importantOnlyControl"),
  importantOnlyLabel: document.getElementById("importantOnlyLabel"),
  sessionMetaLabel: document.getElementById("sessionMetaLabel"),
  sessionTitle: document.getElementById("sessionTitle"),
  sessionLineage: document.getElementById("sessionLineage"),
  sessionHandoff: document.getElementById("sessionHandoff"),
  sessionFilterNotice: document.getElementById("sessionFilterNotice"),
  sessionFilterNoticeText: document.getElementById("sessionFilterNoticeText"),
  clearSessionFiltersButton: document.getElementById("clearSessionFiltersButton"),
  returnRealtimeButton: document.getElementById("returnRealtimeButton"),
  statsStrip: document.getElementById("statsStrip"),

  threadContent: document.getElementById("threadContent"),
  compactContent: document.getElementById("compactContent"),
  terminalContent: document.getElementById("terminalContent"),
  executionWorkspace: document.getElementById("executionWorkspace"),

  statsContent: document.getElementById("statsContent"),
  diagnosticContent: document.getElementById("diagnosticContent"),
  traceContent: document.getElementById("traceContent"),
  rawContent: document.getElementById("rawContent"),

  toast: document.getElementById("toast"),

  refreshButton: document.getElementById("refreshButton"),
  sourceSelect: document.getElementById("sourceSelect"),
  sourceStatus: document.getElementById("sourceStatus"),
  settingsButton: document.getElementById("settingsButton"),
  settingsDialog: document.getElementById("settingsDialog"),
  settingsForm: document.getElementById("settingsForm"),
  closeSettingsDialogButton: document.getElementById("closeSettingsDialogButton"),
  settingsOverview: document.getElementById("settingsOverview"),
  settingsTabs: document.getElementById("settingsTabs"),
  summaryRuleList: document.getElementById("summaryRuleList"),
  defaultSummaryRuleList: document.getElementById("defaultSummaryRuleList"),

  addSummaryRuleButton: document.getElementById("addSummaryRuleButton"),
  resetSummaryRulesButton: document.getElementById("resetSummaryRulesButton"),

  saveSettingsButton: document.getElementById("saveSettingsButton"),
  cancelSettingsButton: document.getElementById("cancelSettingsButton"),
  settingsStatus: document.getElementById("settingsStatus"),

  statusSource: document.getElementById("statusSource"),
  statusSession: document.getElementById("statusSession"),
  statusEvents: document.getElementById("statusEvents"),
  statusUpdated: document.getElementById("statusUpdated"),
  statusbar: document.getElementById("statusbar"),
  workbenchOperationStatus: document.getElementById("workbenchOperationStatus"),
  workbenchAnnouncements: document.getElementById("workbenchAnnouncements"),

  compactViewButton: document.getElementById("compactViewButton"),
  traceViewButton: document.getElementById("traceViewButton"),
  statsViewButton: document.getElementById("statsViewButton"),
  rawViewButton: document.getElementById("rawViewButton"),
  diagnosticViewButton: document.getElementById("diagnosticViewButton"),
  diagnosticSwitch: document.getElementById("diagnosticSwitch"),
  viewSwitch: document.querySelector(".view-switch"),
  toggleLeft: document.getElementById("toggleLeft"),
};

const standardItemTypeOptions = [
  ["all", "全部内容"],
  ["message", "用户/助手消息"],
  ["tool", "工具与命令"],
  ["output", "工具输出"],
  ["reasoning", "推理摘要"],
  ["compact", "上下文压缩"],
  ["system", "系统事件"],
  ["error", "错误事件"],
];

const rawItemTypeOptions = standardItemTypeOptions.map(([value, label]) => [value, value === "all" ? "全部事件" : label]);

const settingsViewOptions = [
  { id: "summary", label: "摘要规则" },
  { id: "structured", label: "结构化展示" },
];
const settingsViewIds = new Set(settingsViewOptions.map((view) => view.id));

window.SessionWorkbench = window.SessionWorkbench || {};
Object.assign(window.SessionWorkbench, {
  state,
  els,
  rawEventCacheLimits,
  standardItemTypeOptions,
  rawItemTypeOptions,
  settingsViewOptions,
  settingsViewIds,
});
