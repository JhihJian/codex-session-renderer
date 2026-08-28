const state = { data: null, selected: null };
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));

async function load() {
  const response = await fetch("/api/review-contexts");
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  state.data = data;
  state.selected = null;
  render();
  if (data.contexts[0]) void detail(data.contexts[0].id);
}
function render() {
  const contexts = state.data?.contexts || [];
  $("count").textContent = `${contexts.length} 项`;
  $("list").innerHTML = contexts.length ? contexts.map((item) => `<button class="queue-row ${item.id === state.selected ? "active" : ""}" data-id="${esc(item.id)}"><span class="queue-row-title">${esc(firstLine(item.correction.text))}</span><span class="queue-row-meta"><span class="status unassessed">待人工复盘</span><span>${esc(firstLine(item.task.text))}</span></span></button>`).join("") : empty("尚无待复盘上下文", "扫描冻结会话后，用户明确纠正此前交付的记录会出现在这里。");
  document.querySelectorAll(".queue-row").forEach((button) => button.addEventListener("click", () => { void detail(button.dataset.id); }));
  if (!state.selected) $("detail").innerHTML = empty("选择一条上下文", "页面只展示用户原话和可追溯的此前交付，不自动给出根因。 ");
}
async function detail(id) {
  const response = await fetch(`/api/review-contexts/${encodeURIComponent(id)}?revision=${encodeURIComponent(state.data.revision)}`);
  if (response.status === 409) return load();
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  state.selected = id;
  const context = data.context;
  $("detail").innerHTML = `<header class="detail-header"><div><p class="detail-id">${esc(context.id)}</p><h2>用户纠正后的任务复盘</h2><p class="detail-date">${esc(context.correction.timestamp || "时间未保留")}</p></div></header><section class="case-review"><div class="case-section"><h3>用户原话</h3><pre class="raw-error">${esc(context.correction.text)}</pre></div><div class="case-section"><h3>当时任务</h3><pre class="raw-error">${esc(context.task.text)}</pre></div><div class="case-section"><h3>被纠正前的交付</h3><pre class="raw-error">${esc(context.priorAssistant?.text || "此前助手交付未保留。")}</pre></div><div class="case-section"><h3>关联工具记录</h3><pre class="raw-error">${esc(JSON.stringify(context.relatedActions || [], null, 2))}</pre></div><div class="case-section"><h3>为什么进入复盘</h3><p>${esc(context.trigger.reason)}</p></div><div class="case-section"><h3>上下文边界</h3><p>${context.contextComplete ? "已定位任务、此前交付与用户纠正原话。" : "部分上下文未能可靠定位，不能据此推断原因。"}</p></div></section>`;
  render();
}
function firstLine(value) { return String(value || "").split(/\r?\n/)[0].slice(0, 140); }
function empty(title, copy) { return `<div class="empty"><h2>${esc(title)}</h2><p>${esc(copy)}</p></div>`; }
$("refresh").addEventListener("click", () => { void load().catch((error) => { $("detail").innerHTML = empty("无法读取复盘上下文", error.message); }); });
void load().catch((error) => { $("detail").innerHTML = empty("无法读取复盘上下文", error.message); });