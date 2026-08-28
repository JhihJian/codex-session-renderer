const state = { kind: "candidates", data: null, selected: null, status: "all" };
const $ = (id) => document.getElementById(id);

const statusOrder = ["external", "unassessed", "candidate", "evidence_ready", "assertion_ready", "fixture_ready", "reproduced", "independently_replicated", "blocked", "inconclusive", "rejected", "confirmed"];
const statusLabels = {
  external: "外部服务异常",
  context_missing: "上下文不足",
  unassessed: "影响待判定",
  candidate: "待冻结证据",
  evidence_ready: "待形成断言",
  assertion_ready: "待准备复现",
  fixture_ready: "待可信复现",
  reproduced: "待独立复现",
  independently_replicated: "待确认决策",
  blocked: "已阻塞",
  inconclusive: "证据不足",
  rejected: "已驳回",
  confirmed: "已确认",
};
const reasonLabels = {
  missing_frozen_manifest: "缺少冻结的断言、fixture 或运行时清单。",
  independent_epochs_required: "需要两个相互独立的执行 epoch。",
  verifiable_sandbox_required: "需要可验证的可信 sandbox。",
  stable_contrast_required: "candidate 与 baseline 尚未形成稳定对照。",
  independent_artifacts_required: "需要十二份彼此独立的执行工件。",
  blind_review_rejected: "盲审没有接受当前结论。",
  blind_review_required: "需要独立盲审重新计算谓词并接受结论。",
  assertion_not_machine_decidable: "当前规则无法形成机器可判定断言。",
  trusted_executor_required: "本地重放只可诊断，不能替代可信执行。",
  legacy_verification_requires_refreeze: "旧记录需要重新冻结证据后才能进入确认流程。",
  all_confirmation_gates_passed: "所有确认关口均已通过。",
};

async function load() {
  const query = $("search").value.trim();
  const response = await fetch(`/api/harness?q=${encodeURIComponent(query)}`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  state.data = body;
  state.selected = null;
  state.status = "all";
  render();
  const first = currentItems()[0];
  if (first) void detail(first.id);
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}

function humanReason(reason) {
  return reasonLabels[reason] || (reason ? String(reason).replaceAll("_", " ") : "");
}

function statusBadge(status, label = statusLabels[status] || status) {
  return `<span class="status ${esc(status)}">${esc(label)}</span>`;
}

function currentItems() {
  return state.data?.[state.kind] || [];
}

function filteredItems() {
  return currentItems().filter((item) => state.status === "all" || item.status === state.status);
}

function render() {
  const data = state.data;
  if (!data || data.state === "missing") {
    $("statusFilters").innerHTML = "";
    $("list").innerHTML = "";
    $("counts").textContent = "";
    $("listScope").textContent = "";
    $("detail").innerHTML = empty("尚未创建验证登记簿", "使用 CLI 建立候选后，这里会按验证关口组织待办工作。");
    return;
  }

  renderStatusFilters();
  const items = filteredItems();
  const total = currentItems().length;
  $("queueHeading").textContent = state.kind === "candidates" ? "按验证关口处理" : state.kind === "externalErrors" ? "不进入 Harness 缺陷验证的 HTTP 服务响应" : "确认结论已通过全部关口";
  $("counts").textContent = state.status === "all" ? `共 ${total} 项` : `显示 ${items.length} / ${total} 项`;
  $("listScope").textContent = state.kind === "candidates" ? "候选线索" : state.kind === "externalErrors" ? "外部依赖" : "确认结论";
  $("listHeading").textContent = state.kind === "candidates" ? "等待核查" : state.kind === "externalErrors" ? "外部服务异常" : "已确认缺陷";
  $("list").innerHTML = items.length ? items.map(renderRow).join("") : empty("当前没有匹配项", "调整状态筛选或搜索条件后再查看。");
  document.querySelectorAll(".queue-row").forEach((button) => {
    button.addEventListener("click", () => { void detail(button.dataset.id); });
  });
  if (!state.selected) $("detail").innerHTML = empty("选择一条记录", "从左侧队列开始。首屏只显示当前结论、规则和下一道验证关口。");
}

function renderStatusFilters() {
  const items = currentItems();
  if (state.kind === "defects" || state.kind === "externalErrors") {
    $("statusFilters").innerHTML = `<p class="queue-context">确认结论保留在此处，便于回看已通过的验证证据。</p>`;
    return;
  }
  const available = statusOrder.filter((status) => items.some((item) => item.status === status));
  const filters = [["all", "全部", items.length], ...available.map((status) => [status, statusLabels[status] || status, items.filter((item) => item.status === status).length])];
  $("statusFilters").innerHTML = filters.map(([status, label, count]) => `<button class="queue-filter ${state.status === status ? "active" : ""}" type="button" data-status="${esc(status)}" aria-pressed="${state.status === status}"><strong>${esc(label)}</strong><span>${count} 项</span></button>`).join("");
  document.querySelectorAll(".queue-filter").forEach((button) => {
    button.addEventListener("click", () => {
      state.status = button.dataset.status;
      state.selected = null;
      render();
    });
  });
}

function renderRow(item) {
  const title = item.title || item.observation || item.id;
  const workflow = item.workflow?.label || statusLabels[item.status] || item.status;
  const source = item.source?.sessionId || item.candidateId || item.id;
  const context = item.memberCount ? `观察 ${item.memberCount} 次` : source;
  return `<button class="queue-row ${state.selected === item.id ? "active" : ""}" type="button" data-id="${esc(item.id)}" aria-current="${state.selected === item.id ? "true" : "false"}"><span class="queue-row-title">${esc(title)}</span><span class="queue-row-meta">${statusBadge(item.status, workflow)}<span title="${esc(source)}">${esc(context)}</span></span></button>`;
}

function empty(title, copy) {
  return `<div class="empty"><h2>${esc(title)}</h2><p>${esc(copy)}</p></div>`;
}

async function detail(id) {
  const revision = state.data.revision;
  const routeKind = state.kind === "externalErrors" ? "candidates" : state.kind;
  const response = await fetch(`/api/harness/${routeKind}/${encodeURIComponent(id)}?revision=${encodeURIComponent(revision)}`);
  if (response.status === 409) {
    await load();
    return;
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  state.selected = id;
  $("detail").innerHTML = renderDetail(data);
  const command = data.defect?.command || data.reproduction?.fixture?.command;
  const copyButton = $("copyCommand");
  if (copyButton && command) {
    copyButton.addEventListener("click", () => {
      void navigator.clipboard.writeText(command).then(() => { copyButton.textContent = "已复制"; });
    });
  }
  render();
  $("detail").focus({ preventScroll: true });
}

// The detail view maps two related API shapes into one human-facing verification summary.
// eslint-disable-next-line complexity
function renderDetail(data) {
  const core = state.kind === "defects" ? data.defect : data.candidate;
  const candidate = data.candidate || core;
  const predicate = core.predicate || data.reproduction?.fixture?.predicate || candidate.suspectedRule;
  const workflow = core.workflow || candidate.workflow || {};
  const command = data.defect?.command || data.reproduction?.fixture?.command;
  return `
    <header class="detail-header">
      <div>
        <p class="detail-id">${esc(core.id)}</p>
        <h2>${esc(core.title || candidate.observation || "未命名验证对象")}</h2>
        <p class="detail-date">登记于 ${esc(formatDate(core.createdAt || candidate.createdAt))}</p>
      </div>
      ${command ? '<button class="detail-action" id="copyCommand" type="button">复制重放命令</button>' : ""}
    </header>
    ${core.case ? renderCaseReview(core.case) : `<section class="decision" aria-labelledby="decisionHeading">
      <h3 id="decisionHeading">当前判断</h3>
      <div class="decision-copy">
        ${statusBadge(core.status, workflow.label || statusLabels[core.status])}
        <p>${esc(workflow.nextStep || "需要人工核查当前验证状态。")}</p>
        ${workflow.reason ? `<p class="reason">原因：${esc(humanReason(workflow.reason))}</p>` : ""}
      </div>
    </section><dl class="facts"><div class="fact"><dt>观察到的问题</dt><dd>${esc(candidate.observation || core.title || "尚未记录")}</dd></div><div class="fact"><dt>应满足的规则</dt><dd>${esc(formatPredicate(predicate))}</dd></div></dl>${renderGates(data)}`}
    ${renderTechnical(data, command)}
  `;
}

function formatPredicate(predicate) {
  if (!predicate) return "尚未形成可判定规则。";
  if (typeof predicate === "string") return predicate;
  if (predicate.type === "event_count" && predicate.eventType && predicate.expected !== undefined) return `事件 “${predicate.eventType}” 的次数必须为 ${predicate.expected}。`;
  if (predicate.id) return `规则 “${predicate.id}”。`;
  return JSON.stringify(predicate);
}

function renderCaseReview(problemCase) {
  const scope = [problemCase.providers?.length ? `服务：${problemCase.providers.join("、")}` : "", problemCase.models?.length ? `模型：${problemCase.models.join("、")}` : "", problemCase.api ? `API：${problemCase.api}` : ""].filter(Boolean).join("；") || "服务和模型信息未完整保留。";
  const observedAt = problemCase.observedAt ? formatDate(problemCase.observedAt) : "原始事件未保留时间";
  return `<section class="case-review"><div class="case-section"><h3>原始内容</h3><pre class="raw-error">${esc(problemCase.errorMessage)}</pre></div><dl class="facts"><div class="fact"><dt>记录范围</dt><dd>${esc(`${problemCase.sourceCount} 个会话，${problemCase.physicalCount} 次同类原始记录`)}</dd></div><div class="fact"><dt>原始记录时间</dt><dd>${esc(observedAt)}</dd></div><div class="fact"><dt>记录中的环境</dt><dd>${esc(scope)}</dd></div>${problemCase.responseId ? `<div class="fact"><dt>响应关联 ID</dt><dd>${esc(problemCase.responseId)}</dd></div>` : ""}${problemCase.precedingEvent ? `<div class="fact"><dt>相邻原始事件</dt><dd>${esc(problemCase.precedingEvent)}</dd></div>` : ""}</dl><div class="case-section"><h3>为什么需要评审</h3><p>${esc(problemCase.reviewReason)}</p></div><div class="case-section"><h3>待核实的问题</h3><p>${esc(problemCase.reviewQuestion)}</p></div></section>`;
}

function formatSource(archive, source) {
  const sourceId = archive?.sourceId || source?.sourceId;
  const sessionId = archive?.sessionId || source?.sessionId;
  return sourceId && sessionId ? `${sourceId} / ${sessionId}` : "尚未关联冻结来源。";
}

function formatDate(value) {
  if (!value) return "未知时间";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });
}

function renderGates(data) {
  const evidence = data.evidence || [];
  const reproductions = data.reproductions || [];
  const reviews = data.reviews || [];
  const trustedEpochs = reproductions.filter((item) => item.trust === "trusted_executor" || item.epochId).length;
  const acceptedReview = reviews.some((review) => review.state === "accept");
  const gates = [
    [Boolean(data.archive), "来源已冻结"],
    [evidence.some((item) => item.kind === "assertion"), "机器断言已冻结"],
    [evidence.some((item) => item.kind === "fixture_manifest"), "复现包已冻结"],
    [trustedEpochs >= 2 || data.candidate?.status === "confirmed", "两个可信执行 epoch 已完成"],
    [acceptedReview || data.defect?.status === "confirmed", "独立盲审已接受"],
  ];
  return `<section class="gates" aria-labelledby="gatesHeading"><h3 id="gatesHeading">确认关口</h3><ul class="gate-list">${gates.map(([complete, label]) => `<li class="gate ${complete ? "complete" : ""}">${esc(label)}</li>`).join("")}</ul></section>`;
}

function renderTechnical(data, command) {
  const candidate = data.candidate || {};
  const reproduction = data.reproduction;
  const reviews = data.reviews || [];
  const evidence = data.evidence || [];
  const detection = candidate.detection;
  return `<details class="technical"><summary>查看技术证据与重放细节</summary>
    <section class="technical-section"><h3>冻结来源</h3><div class="technical-grid"><dl><dt>来源会话</dt><dd>${esc(formatSource(data.archive, candidate.source))}</dd></dl><dl><dt>来源事件</dt><dd>${candidate.eventIndex === undefined ? "未记录" : `第 ${esc(candidate.eventIndex)} 条事件（${esc(candidate.eventType || "未知类型")}）`}</dd></dl><dl><dt>归档 SHA-256</dt><dd><code class="code">${esc(data.archive?.sha256 || candidate.source?.sha256 || "未记录")}</code></dd></dl>${detection ? `<dl><dt>发现范围</dt><dd>${esc(formatDetection(detection))}</dd></dl>` : ""}</div><p class="source-note">归档副本是证据真相。当前会话发生变化时，不能用它替换该归档。</p></section>
    <section class="technical-section"><h3>证据与审查</h3><div class="technical-grid"><dl><dt>冻结证据</dt><dd>${esc(evidence.length ? evidence.map((item) => item.kind).join("、") : "尚无冻结证据")}</dd></dl><dl><dt>盲审结论</dt><dd>${esc(reviews.length ? reviews.map((item) => item.conclusion).join("；") : "尚无盲审回执")}</dd></dl></div></section>
    ${reproduction ? renderReproduction(reproduction) : ""}
    ${command ? `<section class="technical-section"><h3>重放命令</h3><code class="code">${esc(command)}</code></section>` : ""}
  </details>`;
}

function formatDetection(detection) {
  if (detection.exitStatusEvidence === "absent") return `观察到 ${detection.occurrenceCount || 1} 个终态错误，归档未含进程退出码。`;
  return JSON.stringify(detection);
}

function renderReproduction(reproduction) {
  const comparison = reproduction.comparison;
  if (!comparison) return `<section class="technical-section"><h3>可信执行</h3><p>${esc(reproduction.reason ? humanReason(reproduction.reason) : "已登记执行工件，摘要尚不可用。")}</p></section>`;
  const rows = ["candidate", "baseline"].map((variant) => {
    const group = comparison[variant] || {};
    const result = group.failed === true ? "稳定触发" : group.failed === false ? "稳定满足" : "执行异常";
    const runs = group.runs || [];
    return `<tr><td>${variant === "candidate" ? "被测对象" : "基线"}</td><td>${esc(result)}</td><td>${runs.length} 次</td><td>${runs.length ? `<details class="run-details"><summary>查看运行轨迹</summary><pre class="code">${esc(JSON.stringify(runs, null, 2))}</pre></details>` : "未记录"}</td></tr>`;
  }).join("");
  return `<section class="technical-section"><h3>复现对照</h3><table class="reproduction"><thead><tr><th>组别</th><th>结论</th><th>运行</th><th>原始轨迹</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

document.querySelectorAll(".kind-tab").forEach((button) => {
  button.addEventListener("click", () => {
    state.kind = button.dataset.kind;
    state.status = "all";
    state.selected = null;
    document.querySelectorAll(".kind-tab").forEach((tab) => {
      const active = tab === button;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    render();
  });
});

$("refresh").addEventListener("click", () => { void load().catch(renderError); });
$("search").addEventListener("input", () => {
  clearTimeout(window.harnessSearchTimer);
  window.harnessSearchTimer = setTimeout(() => { void load().catch(renderError); }, 250);
});

function renderError(error) {
  $("detail").innerHTML = empty("无法读取登记簿", error.message);
}

void load().catch(renderError);