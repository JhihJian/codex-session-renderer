import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

function readProjectFile(pathname) {
  return readFile(new URL(`../${pathname}`, import.meta.url), "utf8");
}

function contrastRatio(foreground, background) {
  const luminance = (hex) => {
    const channels = hex.match(/[a-f\d]{2}/gi).map((channel) => Number.parseInt(channel, 16) / 255);
    const linear = channels.map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
  return (lighter + 0.05) / (darker + 0.05);
}

test("workbench status and mobile panel semantics remain accessible", async () => {
  const [html, app, css] = await Promise.all([
    readProjectFile("public/index.html"),
    readProjectFile("public/app.js"),
    readProjectFile("public/styles.css"),
  ]);

  assert.match(html, /id="workbenchOperationStatus"/);
  assert.match(html, /id="workbenchAnnouncements" role="status" aria-live="polite"/);
  assert.match(html, /id="mobileSessionsTab"[^>]*role="tab"[^>]*aria-controls="sessionsPanel"/);
  assert.match(html, /id="threadPanel" role="tabpanel" aria-labelledby="mobileThreadTab"/);
  assert.match(app, /function setWorkbenchStatus\(key, message, \{ announce = false \} = \{\}\)/);
  assert.match(app, /function syncAsyncAccessibility\(\)/);
  assert.match(app, /function syncMobilePanelNavigation\(\)/);
  assert.match(app, /button\.setAttribute\("aria-current", "page"\)/);
  assert.match(app, /panel\.inert = !open/);
  assert.match(app, /已取消任务归档读取/);
  assert.match(app, /重试读取会话/);
  assert.match(css, /--text-3: #6b6b70;/);
  assert.ok(contrastRatio("#6b6b70", "#fbfbfd") >= 4.5);
  assert.ok(contrastRatio("#6b6b70", "#f5f5f7") >= 4.5);
});

test("remote data source copy keeps saved-test and index-only boundaries explicit", async () => {
  const [html, app, readme] = await Promise.all([
    readProjectFile("public/index.html"),
    readProjectFile("public/app.js"),
    readProjectFile("README.md"),
  ]);

  assert.match(html, /测试已保存连接/);
  assert.match(app, /表单草稿不会被测试/);
  assert.match(app, /拉取远端实时快照默认只补最近 3 小时/);
  assert.match(app, /历史正文需要远端扩大共享窗口或额外同步后再拉取/);
  assert.match(app, /本机数据源：3 小时到 1 天内的本机会话，可直接打开正文/);
  assert.match(app, /当前会话已被筛选隐藏/);
  assert.match(app, /正在检索远端历史索引/);
  assert.match(app, /历史索引失败/);
  assert.match(app, /正文未同步/);
  assert.match(app, /会话列表加载失败/);
  assert.match(app, /会话或数据源已切换，已取消本次 Markdown 下载/);
  assert.match(app, /测试不可用：/);
  assert.match(app, /本机已拉取的缓存快照不会随此操作删除/);
  assert.match(app, /需要拉取新快照/);
  assert.match(app, /旧来源的会话、归档和导出不会用于当前来源/);
  assert.match(readme, /页面管理的数据源访问令牌保存在本机私有/);
  assert.match(readme, /来源版本/);
  assert.match(readme, /source_snapshot_changed/);
  assert.match(readme, /查询参数/);
  assert.match(readme, /高级环境变量模式从运行时环境读取 token/);
  assert.match(readme, /旧版本留下的非法证据风险规则/);
  assert.match(readme, /状态条在远端历史模式下显示“历史索引 N 条 · 正文未同步”/);
});

test("settings rule feedback copy and dynamic field attrs stay trustworthy", async () => {
  const [app, readme] = await Promise.all([
    readProjectFile("public/app.js"),
    readProjectFile("README.md"),
  ]);

  assert.match(app, /展示规则已保存，但当前会话重新读取失败：/);
  assert.match(app, /保存展示规则失败：/);
  assert.match(app, /evidenceRiskRules: settingsEvidenceRiskSnapshotRules\(\)/);
  assert.match(app, /function settingsEvidenceRiskSnapshotRules\(\)/);
  assert.match(app, /customRulesFromMerged\(rules\)/);
  assert.match(app, /defaultRules\?\.\(\)/);
  assert.match(readme, /单纯为了编辑器展示而注入的内置证据风险规则不会启用保存按钮/);
  assert.match(readme, /展示规则已保存，但当前会话重新读取失败：/);
  assert.doesNotMatch(app, /placeholder="[^"\r\n]*"\$\{settingsFieldAttrs/g);
  assert.doesNotMatch(app, /spellcheck="false"\$\{settingsFieldAttrs/g);
  assert.doesNotMatch(app, /return ` aria-invalid=/);
  assert.match(app, /placeholder="exec_command 或 \*" \$\{settingsFieldAttrs\("summary", index, "tool"\)\}/);
  assert.equal((app.match(/window\.confirm/g) || []).length, 3);
});

test("health and copy failure feedback stay Chinese and actionable", async () => {
  const [app, readme] = await Promise.all([
    readProjectFile("public/app.js"),
    readProjectFile("README.md"),
  ]);

  assert.match(app, /接口不可用/);
  assert.match(app, /无法连接本机服务/);
  assert.match(app, /请允许浏览器访问剪贴板，或手动选中文本复制/);
  assert.match(app, /浏览器剪贴板响应超时/);
  assert.match(app, /clipboardWriteTextWithTimeout/);
  assert.doesNotMatch(app, /Clipboard API/);
  assert.doesNotMatch(app, /execCommand fallback/);
  assert.match(readme, /接口不可用/);
  assert.match(readme, /无法连接本机服务/);
  assert.match(readme, /请求方法不允许/);
});

test("review and filtering copy keeps noisy interactions explicit", async () => {
  const [html, app, css, readme] = await Promise.all([
    readProjectFile("public/index.html"),
    readProjectFile("public/app.js"),
    readProjectFile("public/styles.css"),
    readProjectFile("README.md"),
  ]);

  assert.match(app, /\["all", "全部内容"\]/);
  assert.match(app, /value === "all" \? "全部事件" : label/);
  assert.match(app, /\["all", "全部节点"\]/);
  assert.match(html, /<option value="all">全部内容<\/option>/);
  assert.match(app, /currentFirstLabel === options\[0\]\?\.\[1\]/);
  assert.match(app, /loadedSessionKey === rowSessionKey && !state\.sessionLoading/);
  assert.match(app, /row\.focus\(\)/);
  assert.match(app, /heading\.textContent = "复核对象"/);
  assert.match(html, /<p class="eyebrow">复核台<\/p>\s*<h2>复核对象<\/h2>/);
  assert.match(app, /copyRawButton\.addEventListener\("click", \(\) => copyReviewReference\(\)\)/);
  assert.match(app, /context\.kind === "session" \? "已复制会话引用" : "已复制对象引用"/);
  assert.match(app, /const outlineRows = Array\.from\(els\.compactContent\.querySelectorAll\("\[data-compact-nav-target\]"\)\)/);
  assert.match(app, /event\.key === "ArrowDown"/);
  assert.match(app, /focusCompactOutlineRow\(outlines?Rows\.length - 1\)|focusCompactOutlineRow\(outlineRows\.length - 1\)/);
  assert.match(app, /class="compact-outline-item thread" role="button" tabindex="-1"/);
  assert.match(app, /class="compact-outline-item compact-event" role="button" tabindex="-1"/);
  assert.match(app, /上下文压缩摘要/);
  assert.match(app, /function buildEventTypeStats\(detail\)/);
  assert.match(app, /function renderStatsInfoView\(\)/);
  assert.match(app, /state\.viewMode === "stats"/);
  assert.match(html, /id="statsViewButton"/);
  assert.match(html, /id="statsContent"/);
  assert.match(app, /data-audit-minimal-toggle/);
  assert.match(app, /function auditMinimalSegmentHeightShares\(entries\)/);
  assert.match(app, /function auditMinimalTrackHeight\(entries = \[\]\)/);
  assert.match(app, /function renderAuditMinimalSidePanel/);
  assert.match(app, /function renderAuditMinimalTypeDistribution/);
  assert.match(app, /function auditMinimalEntryIsSelected/);
  assert.match(app, /--segment-height/);
  assert.match(app, /--track-height/);
  assert.match(app, /审计链极简纵向上下文占用条/);
  assert.doesNotMatch(app, /audit-minimal-segment-label/);
  assert.match(css, /\.audit-minimal-entry \{/);
  assert.match(css, /\.audit-minimal-side \{/);
  assert.match(css, /\.audit-minimal-type-bar \{/);
  assert.match(css, /grid-template-columns: minmax\(120px, 158px\) 114px minmax\(240px, 1fr\)/);
  assert.doesNotMatch(css, /audit-minimal-segment-label/);
  assert.match(css, /flex-direction: column-reverse/);
  assert.match(css, /width: 72px/);
  assert.match(css, /\.audit-minimal-turn \+ \.audit-minimal-turn/);
  assert.match(css, /calc\(var\(--segment-height\) \* 1%\)/);
  assert.match(css, /\.stats-event-table \{/);
  assert.match(css, /\.stats-view-metrics \{/);
  assert.match(app, /function bindRovingTablist\(tablist, selector, activate\)/);
  assert.match(app, /"ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"/);
  assert.match(app, /bindRovingTablist\(els\.sessionTimeFilter, "\[data-session-time\]"/);
  assert.match(app, /bindRovingTablist\(els\.viewSwitch, "\[data-view-mode\]"/);
  assert.match(app, /bindRovingTablist\(els\.reviewTabs, "\[data-review-tab\]"/);
  assert.match(app, /bindRovingTablist\(els\.settingsTabs, "\[data-settings-view\]"/);
  assert.match(app, /function syncPanelVisibilityState\(\)/);
  assert.match(app, /panel\.inert = !open/);
  assert.match(app, /setAttribute\("aria-hidden", "true"\)/);
  assert.match(app, /settingsDialogOpener/);
  assert.match(app, /closeSettingsDialogAndRestoreFocus\(\)/);
  assert.match(css, /\.settings-footer \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto auto;/);
  assert.match(css, /\.settings-footer \{[\s\S]*position: sticky;[\s\S]*bottom: 0;/);
  assert.match(css, /\.primary-button:disabled,[\s\S]*\.primary-button:disabled:hover/);
  assert.match(readme, /重复点击当前会话行只聚焦当前行/);
  assert.match(readme, /隐藏区域会同步退出键盘焦点序列/);
  assert.match(readme, /方向键与 Home\/End 切换/);
  assert.match(readme, /设置弹窗关闭后焦点回到打开入口/);
  assert.match(readme, /全部内容 \/ 全部节点 \/ 全部事件/);
  assert.match(readme, /每类原始事件的数量和按事件体积估算的约 token 量进入独立统计视图/);
  assert.match(readme, /统计视图：负责事件类型分析/);
  assert.match(readme, /左侧“执行层级”目录会在对应轮次下显示“上下文压缩摘要 \/ 上下文压缩完成”节点/);
  assert.match(readme, /极简模式/);
  assert.match(readme, /固定宽度纵向上下文占用条/);
  assert.match(readme, /上下连接/);
  assert.match(readme, /轮次交界处只增加细分界线/);
  assert.match(readme, /色段高度按该操作约 token 量归一化/);
  assert.match(readme, /伴随面板/);
  assert.match(readme, /类型 token 分布/);
  assert.match(readme, /点击色段后，伴随面板切换为选中操作/);
  assert.match(readme, /图内不显示文字/);
  assert.match(readme, /复核台 \/ 复核对象/);
  assert.match(readme, /证据风险页内容较长时只滚动编辑区/);
  assert.match(readme, /1280px 以下会把复核台收进正文下方/);
});
