import { expect, test } from "@playwright/test";

const sessionTitle = /(?:验证工作台的 Chromium 交互契约|确定性 Chromium 验证会话)/;

async function openWorkbench(page) {
  await page.goto("/");
  await expect(page.locator("#sessionTitle")).toHaveText(sessionTitle);
  await expect(page.locator("#compactContent")).toBeVisible();
}

async function expectDesktopAccessibilityContracts(page, { sidebar, thread, inspector }) {
  const timeFilters = page.locator("#sessionTimeFilter [role=radio]");
  await timeFilters.first().focus();
  await page.keyboard.press("End");
  await expect(timeFilters.last()).toHaveAttribute("aria-checked", "true");
  await expect(timeFilters.last()).toBeFocused();
  await expect(page.locator("#sessionTimeFilter")).toHaveAttribute("role", "radiogroup");
  await expect(page.locator(".sidebar-mode-switch")).toHaveAttribute("role", "toolbar");
  await expect(page.locator("#sessionTimeFilter [role=tab]")).toHaveCount(0);
  await expect(page.locator(".sidebar-mode-switch [role=tab]")).toHaveCount(0);
  await expect(page.locator("#promptsModeButton")).toHaveAttribute("aria-pressed", "false");
  await expect(sidebar).not.toHaveAttribute("role", "tabpanel");
  await expect(thread).not.toHaveAttribute("role", "tabpanel");
  await expect(inspector).not.toHaveAttribute("role", "tabpanel");
}

async function expectTabPanels(page, tabs) {
  for (const tab of await tabs.all()) {
    const panelId = await tab.getAttribute("aria-controls");
    const panel = page.locator(`#${panelId}`);
    await expect(panel).toHaveAttribute("role", "tabpanel");
    await expect(panel).toHaveAttribute("aria-labelledby", await tab.getAttribute("id"));
  }
}

function promptResponse(prompt, title = "当前任务", page = {}) {
  return {
    source: { id: "local", label: "本机 Codex Home", kind: "local" },
    scope: "recent24h",
    entries: [
      {
        id: "local:33333333-3333-4333-8333-333333333333",
        sourceId: "local",
        sourceLabel: "本机 Codex Home",
        sessionId: "33333333-3333-4333-8333-333333333333",
        sessionTitle: title,
        cwd: "/workspace/chromium-contract",
        projectKey: "local:/workspace/chromium-contract",
        projectLabel: "/workspace/chromium-contract",
        promptState: "found",
        promptText: prompt,
        promptPreview: prompt,
        promptEventIndex: 2,
        updatedAt: "2025-01-02T03:04:11.000Z",
      },
    ],
    projects: [],
    page: {
      candidateFrom: 1,
      candidateTo: 1,
      candidatesScanned: 1,
      entriesReturned: 1,
      limit: 200,
      hasMoreCandidates: false,
      nextPageToken: null,
      ...page,
    },
    serverTime: "2025-01-02T03:04:11.000Z",
  };
}

test("桌面三栏、复核台调整与真实 tab/panel 契约同步", async ({ page }) => {
  await openWorkbench(page);
  const sidebar = page.locator("#sessionsPanel");
  const thread = page.locator("#threadPanel");
  const inspector = page.locator("#inspectorPanel");
  const resizer = page.locator("#inspectorResizer");
  const [sidebarBox, threadBox, inspectorBox] = await Promise.all([sidebar.boundingBox(), thread.boundingBox(), inspector.boundingBox()]);

  expect(sidebarBox.x + sidebarBox.width).toBeLessThanOrEqual(threadBox.x);
  expect(threadBox.x + threadBox.width).toBeLessThanOrEqual(inspectorBox.x);
  await expect(resizer).toBeVisible();
  const widthBefore = Number(await resizer.getAttribute("aria-valuenow"));
  await resizer.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(resizer).toHaveAttribute("aria-valuenow", String(widthBefore + 24));

  await expectDesktopAccessibilityContracts(page, { sidebar, thread, inspector });

  const viewTabs = page.locator(".view-switch [role=tab]");
  await viewTabs.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#auditViewButton")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#auditContent")).toBeVisible();
  await expectTabPanels(page, viewTabs);

  await page.locator("#diagnosticViewButton").click();
  const diagnosticTabs = page.locator("#diagnosticSwitch [role=tab]");
  await expect(page.locator("#diagnosticContent")).toBeVisible();
  await expectTabPanels(page, diagnosticTabs);
  await diagnosticTabs.last().click();
  await expect(page.locator("#rawContent")).toBeVisible();

  const reviewTabs = page.locator("#reviewTabs [role=tab]");
  await reviewTabs.first().focus();
  await page.keyboard.press("End");
  await expect(reviewTabs.last()).toHaveAttribute("aria-selected", "true");
  await expect(reviewTabs.last()).toBeFocused();
  await expectTabPanels(page, reviewTabs);

  await page.locator("#settingsButton").click();
  const settingsTabs = page.locator("#settingsTabs [role=tab]");
  await settingsTabs.first().focus();
  await page.keyboard.press("End");
  await expect(settingsTabs.last()).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#settingsSectionStructured")).toBeVisible();
  await expectTabPanels(page, settingsTabs);
  await page.keyboard.press("Escape");
});

test("窄屏按需打开复核区，移动端仅展示当前三面板", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  await openWorkbench(page);
  await expect(page.locator("#inspectorPanel")).toBeHidden();
  await expect(page.locator("#inspectorPanel")).toHaveJSProperty("inert", true);
  await page.locator("#toggleRight").click();
  const [threadBox, inspectorBox] = await Promise.all([page.locator("#threadPanel").boundingBox(), page.locator("#inspectorPanel").boundingBox()]);
  expect(inspectorBox.y).toBeGreaterThanOrEqual(threadBox.y + threadBox.height);
  await expect(page.locator("#inspectorPanel")).toHaveJSProperty("inert", false);
  await expect(page.locator("#inspectorResizer")).toBeHidden();

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileTabs = page.locator(".mobile-tabs [role=tab]");
  await expect(mobileTabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await page.locator("[data-panel-target=sessions]").click();
  await expect(page.locator("#sessionsPanel")).toBeVisible();
  await expect(page.locator("#threadPanel")).toBeHidden();
  await expect(mobileTabs.first()).toHaveAttribute("aria-selected", "true");
  await expect(mobileTabs.first()).toHaveAttribute("aria-controls", "sessionsPanel");
  await expect(page.locator("#sessionsPanel")).toHaveAttribute("role", "tabpanel");
  await expect(page.locator("#sessionsPanel")).toHaveAttribute("aria-labelledby", "mobileSessionsTab");
  await expect(page.locator("#threadPanel")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator("#threadPanel")).toHaveJSProperty("inert", true);
  await mobileTabs.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(mobileTabs.nth(1)).toBeFocused();
  await expect(page.locator("#appShell")).toHaveAttribute("data-panel", "thread");
  await page.locator("[data-panel-target=inspector]").click();
  await expect(page.locator("#inspectorPanel")).toBeVisible();
  await expect(page.locator("#sessionsPanel")).toBeHidden();
  await expect(page.locator("#appShell")).toHaveAttribute("data-panel", "inspector");
});

test("移动端隐藏桌面左右面板开关，跨断点后恢复桌面真实状态", async ({ page }) => {
  await openWorkbench(page);
  const leftToggle = page.locator("#toggleLeft");
  const rightToggle = page.locator("#toggleRight");
  await expect(leftToggle).toBeVisible();
  await expect(rightToggle).toBeVisible();
  await expect(leftToggle).toHaveAttribute("aria-expanded", "true");
  await expect(rightToggle).toHaveAttribute("aria-expanded", "true");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(leftToggle).toBeHidden();
  await expect(rightToggle).toBeHidden();
  await expect(leftToggle).toHaveAttribute("hidden", "");
  await expect(rightToggle).toHaveAttribute("hidden", "");
  await expect(leftToggle).toHaveAttribute("aria-expanded", "false");
  await expect(rightToggle).toHaveAttribute("aria-expanded", "false");
  expect(await leftToggle.evaluate((button) => button.tabIndex)).toBe(-1);
  expect(await rightToggle.evaluate((button) => button.tabIndex)).toBe(-1);
  await expect(page.locator(".mobile-tabs [role=tab]")).toHaveCount(3);

  await page.setViewportSize({ width: 1281, height: 844 });
  await expect(leftToggle).toBeVisible();
  await expect(rightToggle).toBeVisible();
  await expect(leftToggle).toHaveAttribute("aria-expanded", "true");
  await expect(rightToggle).toHaveAttribute("aria-expanded", "true");
});

test("隐藏面板迁移焦点，设置弹窗关闭后恢复入口焦点", async ({ page }) => {
  await openWorkbench(page);
  await page.locator("#sessionsModeButton").focus();
  await page.locator("#toggleLeft").click();
  await expect(page.locator("#sessionsPanel")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator("#toggleLeft")).toBeFocused();
  await expect(page.locator("#sessionsPanel")).toHaveJSProperty("inert", true);

  await page.locator("#toggleLeft").click();
  await page.locator("#reviewTabs [role=tab]").first().focus();
  await page.locator("#toggleRight").click();
  await expect(page.locator("#inspectorPanel")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator("#toggleRight")).toBeFocused();

  await page.locator("#settingsButton").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#settingsDialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#settingsDialog")).toBeHidden();
  await expect(page.locator("#settingsButton")).toBeFocused();

  await page.locator("#settingsButton").click();
  await page.locator("#closeSettingsDialogButton").click();
  await expect(page.locator("#settingsButton")).toBeFocused();
});

test("任务归档取消加载，并隔离过期响应", async ({ page }) => {
  await openWorkbench(page);
  let calls = 0;
  let resolveFirstRequest;
  let resolveStaleResponse;
  let resolveStaleSettled;
  let firstFailed = false;
  const firstRequest = new Promise((resolve) => {
    resolveFirstRequest = resolve;
  });
  const staleResponse = new Promise((resolve) => {
    resolveStaleResponse = resolve;
  });
  const staleSettled = new Promise((resolve) => {
    resolveStaleSettled = resolve;
  });
  page.on("requestfailed", (request) => {
    if (request.url().includes("/api/sources/local/prompts")) firstFailed = true;
  });
  await page.route("**/api/sources/local/prompts?*", async (route) => {
    calls += 1;
    if (calls === 1) {
      resolveFirstRequest();
      await staleResponse;
      await route.fulfill({ json: promptResponse("过期响应不得写入页面", "过期任务") }).catch(() => {});
      resolveStaleSettled();
      return;
    }
    await route.fulfill({ json: promptResponse("当前请求结果", "当前任务") });
  });

  await page.locator("#promptsModeButton").click();
  await firstRequest;
  await expect(page.locator("#sessionList").getByText("正在整理任务归档")).toBeVisible();
  const failedRequest = page.waitForEvent("requestfailed", (request) => request.url().includes("/api/sources/local/prompts"));
  await page.locator("#sessionsModeButton").click();
  await failedRequest;
  expect(firstFailed).toBe(true);
  await expect(page.locator("#workbenchOperationStatus")).toContainText("已取消任务归档读取");
  await expect(page.locator("#workbenchAnnouncements")).toHaveText("正在整理当前批任务归档");

  await page.locator("#promptsModeButton").click();
  await expect(page.locator("#promptArchiveContent summary")).toHaveText("当前请求结果");
  resolveStaleResponse();
  await staleSettled;
  await expect(page.locator("#promptArchiveContent").getByText("过期响应不得写入页面")).toHaveCount(0);
});

test("移动端任务归档可打开复核状态，退出后恢复会话复核", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openWorkbench(page);
  await page.route("**/api/sources/local/prompts?*", async (route) => {
    await route.fulfill({ json: promptResponse("归档复核状态", "移动端归档") });
  });

  await page.locator("[data-panel-target=sessions]").click();
  await page.locator("#promptsModeButton").click();
  await expect(page.locator("#promptArchiveContent")).toContainText("归档复核状态");
  await page.locator("[data-panel-target=inspector]").click();
  await expect(page.locator("#inspectorPanel")).toBeVisible();
  await expect(page.locator("#inspectorPanel")).toHaveCSS("opacity", "1");
  await expect(page.locator("#sessionDetails")).toContainText("任务归档未打开会话");
  await expect(page.locator("#selectionDetails")).toContainText("当前正在浏览任务归档");
  await expect(page.locator("#copyRawButton")).toBeDisabled();
  await expect(page.locator("#inspectorPanel")).toHaveJSProperty("inert", false);
  await expect(page.locator("#inspectorPanel")).not.toHaveAttribute("aria-hidden");
  await expect(page.locator("#toggleRight")).toBeHidden();
  await expect(page.locator("#toggleRight")).toBeDisabled();

  await page.locator("[data-panel-target=sessions]").click();
  await page.locator("#sessionsModeButton").click();
  await page.locator("[data-panel-target=inspector]").click();
  await expect(page.locator("#sessionDetails")).not.toContainText("任务归档未打开会话");
  await expect(page.locator("#copyRawButton")).toBeEnabled();
});

test("本机 Codex 空列表会有界发现 Pi 可读会话并显式切换", async ({ page }) => {
  await page.route("**/api/sources/local/sessions?*", async (route) => {
    await route.fulfill({ json: { source: { id: "local", label: "本机 Codex Home", kind: "local" }, scope: "recent24h", sessions: [] } });
  });
  const piProbe = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname === "/api/sources/pi-agent/sessions" && url.searchParams.get("scope") === "recent24h" && url.searchParams.get("type") === "all";
  });
  await page.goto("/");
  await expect(page.locator("#sourceSelect")).toHaveValue("local");
  await piProbe;
  await expect(page.locator("[data-session-empty-action=select-alternate-local-source]")).toHaveText("切换查看 Pi Agent Sessions");
  const piSelection = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname === "/api/sources/pi-agent/sessions" && url.searchParams.get("scope") === "recent24h" && url.searchParams.get("type") === "all";
  });
  await page.locator("[data-session-empty-action=select-alternate-local-source]").click();
  await piSelection;
  await expect(page.locator("#sourceSelect")).toHaveValue("pi-agent");
  await expect(page.locator("#sessionTitle")).toHaveText("Pi 可切换会话");
});

test("远端索引延迟、失败和状态公告保留可恢复结果", async ({ page }) => {
  await openWorkbench(page);
  await page.locator("#sourceSelect").selectOption("office");

  let releaseSuccess;
  const delayedSuccess = new Promise((resolve) => {
    releaseSuccess = resolve;
  });
  await page.route("**/api/sources/office/index?*", async (route) => {
    await delayedSuccess;
    await route.continue();
  });
  const request = page.waitForRequest("**/api/sources/office/index?*");
  await page.locator("#sessionTimeFilter [data-session-time=earlier]").click();
  await request;
  await expect(page.locator("#sessionsPanel")).toHaveAttribute("aria-busy", "true");
  await expect(page.locator("#workbenchOperationStatus")).toContainText("正在检索更早历史索引");
  await expect(page.locator("#workbenchAnnouncements")).toHaveText("正在检索更早历史索引");
  releaseSuccess();
  await expect(page.locator("#sessionsPanel")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#workbenchOperationStatus")).toContainText("更早历史索引已加载：101 条");
  await expect(page.locator("#workbenchAnnouncements")).toHaveText("更早历史索引已加载：101 条");

  await page.unroute("**/api/sources/office/index?*");
  await page.route("**/api/sources/office/index?*", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "远端索引暂不可用" }),
    });
  });
  await page.locator("#sessionSearch").fill("失败查询");
  await expect(page.locator("#sessionsPanel")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#workbenchOperationStatus")).toContainText("远端历史索引失败：远端索引暂不可用。可重试或返回实时。");
  await expect(page.locator("#workbenchAnnouncements")).toHaveText("远端历史索引失败：远端索引暂不可用。可重试或返回实时。");
  await expect(page.locator("[data-session-empty-action=retry-remote-index]")).toBeVisible();
});

test("任务归档诚实显示扫描范围，并可继续定位第201项唯一命中", async ({ page }) => {
  await openWorkbench(page);
  let calls = 0;
  await page.route("**/api/sources/local/prompts?*", async (route) => {
    calls += 1;
    const url = new URL(route.request().url());
    if (url.searchParams.get("pageToken") === "next-200") {
      await route.fulfill({ json: promptResponse("第201项唯一命中", "更早任务", {
        candidateFrom: 201,
        candidateTo: 201,
        candidatesScanned: 1,
        entriesReturned: 1,
      }) });
      return;
    }
    await route.fulfill({ json: {
      ...promptResponse("当前批其他任务", "当前任务", {
        candidateFrom: 1,
        candidateTo: 200,
        candidatesScanned: 200,
        entriesReturned: 0,
        hasMoreCandidates: true,
        nextPageToken: "next-200",
      }),
      entries: [],
      projects: [],
    } });
  });

  await page.locator("#promptsModeButton").click();
  await expect(page.locator("[data-prompt-archive-page-info]")).toHaveText("已扫描候选第 1-200 个 · 本批 0 条归档");
  await page.locator("#promptArchiveSearch").fill("第201项唯一命中");
  await expect(page.locator("#promptArchiveContent")).toContainText("当前已扫描范围没有符合搜索或筛选条件的任务");
  await expect(page.locator("#promptArchiveContent")).toContainText("更早候选尚未扫描");
  const continuation = page.waitForRequest((request) => request.url().includes("/api/sources/local/prompts?") && request.url().includes("pageToken=next-200"));
  await page.locator("[data-prompt-archive-page-action=next]").click();
  await continuation;
  await expect(page.locator("[data-prompt-archive-page-info]")).toHaveText("已扫描候选第 201-201 个 · 本批 1 条归档");
  await expect(page.locator("#promptArchiveContent")).toContainText("第201项唯一命中");
  await expect(page.locator("[data-prompt-archive-page-status]")).toHaveText("已扫描到当前时间范围最早任务");
  await expect(page.locator("[data-prompt-archive-page-action=next]")).toBeDisabled();
  expect(calls).toBe(2);
});

test("任务归档续页变化后清空旧批并从首批恢复", async ({ page }) => {
  await openWorkbench(page);
  let calls = 0;
  await page.route("**/api/sources/local/prompts?*", async (route) => {
    calls += 1;
    const url = new URL(route.request().url());
    if (url.searchParams.get("pageToken") === "changing-token") {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: "任务归档候选范围已变化，请从最近任务重新开始定位。", details: { code: "prompt_archive_snapshot_changed" } }),
      });
      return;
    }
    await route.fulfill({ json: promptResponse(calls === 1 ? "旧批内容" : "恢复后的首批内容", calls === 1 ? "旧批" : "恢复后", {
      candidateFrom: 1,
      candidateTo: 200,
      candidatesScanned: 200,
      entriesReturned: 1,
      hasMoreCandidates: calls === 1,
      nextPageToken: calls === 1 ? "changing-token" : null,
    }) });
  });

  await page.locator("#promptsModeButton").click();
  await expect(page.locator("#promptArchiveContent")).toContainText("旧批内容");
  const restarted = page.waitForRequest((request) => request.url().includes("/api/sources/local/prompts?") && !request.url().includes("pageToken="));
  await page.locator("[data-prompt-archive-page-action=next]").click();
  await restarted;
  await expect(page.locator("#toast")).toContainText("已从最近任务重新开始定位");
  await expect(page.locator("#promptArchiveContent")).toContainText("恢复后的首批内容");
  await expect(page.locator("#promptArchiveContent")).not.toContainText("旧批内容");
  expect(calls).toBe(3);
});

test("远端历史索引版本变化后从首页恢复，不混合旧页", async ({ page }) => {
  await openWorkbench(page);
  await page.locator("#sourceSelect").selectOption("office");
  await page.locator("#sessionTimeFilter [data-session-time=earlier]").click();
  await expect(page.locator("[data-remote-index-page-info]")).toHaveText("第 1 页 · 当前范围第 1-100 条 / 共 101 条");
  let rejectedContinuation = false;
  await page.route("**/api/sources/office/index?*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!rejectedContinuation && url.searchParams.get("cursor") === "100") {
      rejectedContinuation = true;
      expect(url.searchParams.get("snapshot")).toMatch(/^[A-Za-z0-9_-]{20,}$/);
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: "远端历史索引已变化，请重新开始定位。", details: { code: "index_snapshot_changed" } }),
      });
      return;
    }
    await route.continue();
  });
  const restarted = page.waitForRequest((request) => request.url().includes("/api/sources/office/index?") && request.url().includes("cursor=0"));
  await page.locator("[data-remote-index-page-action=next]").click();
  await restarted;
  await expect(page.locator("#toast")).toContainText("已从第一页重新开始定位");
  await expect(page.locator("[data-remote-index-page-info]")).toHaveText("第 1 页 · 当前范围第 1-100 条 / 共 101 条");
  expect(rejectedContinuation).toBe(true);
});

test("远端历史新查询取消旧请求且不写入过期页", async ({ page }) => {
  await openWorkbench(page);
  await page.locator("#sourceSelect").selectOption("office");
  await page.locator("#sessionTimeFilter [data-session-time=earlier]").click();
  await expect(page.locator("[data-remote-index-page-info]")).toBeVisible();

  let calls = 0;
  let releaseStale;
  let resolveStaleRequest;
  const staleRequest = new Promise((resolve) => {
    resolveStaleRequest = resolve;
  });
  const release = new Promise((resolve) => {
    releaseStale = resolve;
  });
  await page.route("**/api/sources/office/index?*", async (route) => {
    calls += 1;
    if (calls === 1) {
      resolveStaleRequest();
      await release;
      await route.fulfill({ json: {
        source: { id: "office", label: "办公室", kind: "remote" },
        page: { total: 1, limit: 100, cursor: 0, nextCursor: null },
        sessions: [{ id: "stale-index", displayTitle: "旧查询过期历史索引", titleTruncated: false }],
      } }).catch(() => {});
      return;
    }
    await route.fulfill({ json: {
      source: { id: "office", label: "办公室", kind: "remote" },
      page: { total: 1, limit: 100, cursor: 0, nextCursor: null },
      sessions: [{ id: "current-index", displayTitle: "新查询当前历史索引", titleTruncated: false }],
    } });
  });

  await page.locator("#sessionSearch").fill("旧查询");
  await staleRequest;
  const failedRequest = page.waitForEvent("requestfailed", (request) => request.url().includes("/api/sources/office/index?") && request.url().includes("q=%E6%97%A7%E6%9F%A5%E8%AF%A2"));
  await page.locator("#sessionSearch").fill("新查询");
  await failedRequest;
  await expect(page.locator("#sessionList")).toContainText("当前历史索引");
  releaseStale();
  await expect(page.locator("#sessionList")).not.toContainText("过期历史索引");
});

test("离开有界诊断会取消请求，过期页不会写回新视图", async ({ page }) => {
  await openWorkbench(page);
  let release;
  const delayed = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/api/sources/local/query/sessions/33333333-3333-4333-8333-333333333333/events?*", async (route) => {
    await delayed;
    await route.fulfill({ json: { events: [{ index: 99, kind: "event", preview: "过期诊断页" }], page: { cursor: 0, nextCursor: 1, hasMore: false, snapshot: "old" } } }).catch(() => {});
  });
  const request = page.waitForRequest("**/api/sources/local/query/sessions/33333333-3333-4333-8333-333333333333/events?*");
  await page.locator("#diagnosticViewButton").click();
  await page.locator("#rawViewButton").click();
  await request;
  const failed = page.waitForEvent("requestfailed", (candidate) => candidate.url().includes("/query/sessions/") && candidate.url().includes("/events?"));
  await page.locator("#compactViewButton").click();
  await failed;
  release();
  await expect(page.locator("#compactContent")).toContainText("验证工作台的 Chromium 交互契约");
  await expect(page.locator("#rawContent")).not.toContainText("过期诊断页");
});