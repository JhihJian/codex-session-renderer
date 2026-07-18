import { expect, test } from "@playwright/test";

const sessionTitle = /(?:验证工作台的 Chromium 交互契约|确定性 Chromium 验证会话)/;

async function openWorkbench(page) {
  await page.goto("/");
  await expect(page.locator("#sessionTitle")).toHaveText(sessionTitle);
  await expect(page.locator("#compactContent")).toBeVisible();
}

function promptResponse(prompt, title = "当前任务") {
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
    page: { total: 1, returned: 1, limit: 800, truncated: false },
    serverTime: "2025-01-02T03:04:11.000Z",
  };
}

test("桌面三栏、复核台调整与四个 tablist 同步", async ({ page }) => {
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

  const timeTabs = page.locator("#sessionTimeFilter [role=tab]");
  await timeTabs.first().focus();
  await page.keyboard.press("End");
  await expect(timeTabs.last()).toHaveAttribute("aria-selected", "true");
  await expect(timeTabs.last()).toBeFocused();

  const viewTabs = page.locator(".view-switch [role=tab]");
  await viewTabs.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#auditViewButton")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#auditContent")).toBeVisible();

  const reviewTabs = page.locator("#reviewTabs [role=tab]");
  await reviewTabs.first().focus();
  await page.keyboard.press("End");
  await expect(reviewTabs.last()).toHaveAttribute("aria-selected", "true");
  await expect(reviewTabs.last()).toBeFocused();

  await page.locator("#settingsButton").click();
  const settingsTabs = page.locator("#settingsTabs [role=tab]");
  await settingsTabs.first().focus();
  await page.keyboard.press("End");
  await expect(settingsTabs.last()).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#settingsSectionStructured")).toBeVisible();
  await page.keyboard.press("Escape");
});

test("窄屏使用流式复核区，移动端仅展示当前三面板", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  await openWorkbench(page);
  const [threadBox, inspectorBox] = await Promise.all([page.locator("#threadPanel").boundingBox(), page.locator("#inspectorPanel").boundingBox()]);
  expect(inspectorBox.y).toBeGreaterThanOrEqual(threadBox.y + threadBox.height);
  await expect(page.locator("#inspectorResizer")).toBeHidden();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("[data-panel-target=sessions]").click();
  await expect(page.locator("#sessionsPanel")).toBeVisible();
  await expect(page.locator("#threadPanel")).toBeHidden();
  await page.locator("[data-panel-target=inspector]").click();
  await expect(page.locator("#inspectorPanel")).toBeVisible();
  await expect(page.locator("#sessionsPanel")).toBeHidden();
  await expect(page.locator("#appShell")).toHaveAttribute("data-panel", "inspector");
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

  await page.locator("#promptsModeButton").click();
  await expect(page.locator("#promptArchiveContent summary")).toHaveText("当前请求结果");
  resolveStaleResponse();
  await staleSettled;
  await expect(page.locator("#promptArchiveContent").getByText("过期响应不得写入页面")).toHaveCount(0);
});

test("远端历史索引分页显示范围、末页并复用已访问页", async ({ page }) => {
  await openWorkbench(page);
  let remoteIndexRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/sources/office/index?")) remoteIndexRequests += 1;
  });

  await page.locator("#sourceSelect").selectOption("office");
  await page.locator("#sessionTimeFilter [data-session-time=earlier]").click();
  await expect(page.locator("[data-remote-index-page-info]")).toHaveText("第 1 页 · 当前范围第 1-100 条 / 共 101 条");
  await expect(page.locator("#sessionCount")).toHaveText("101");
  await expect(page.locator("#sessionList .session-row.index-only").first()).toBeVisible();
  await expect(page.locator("[data-remote-index-page-action=previous]")).toBeDisabled();

  const secondPage = page.waitForRequest((request) => request.url().includes("/api/sources/office/index?") && request.url().includes("cursor=100"));
  await page.locator("[data-remote-index-page-action=next]").click();
  await secondPage;
  await expect(page.locator("[data-remote-index-page-info]")).toHaveText("第 2 页 · 当前范围第 101-101 条 / 共 101 条");
  await expect(page.locator("[data-remote-index-page-status]")).toHaveText("已到末页，无更多索引结果");
  await expect(page.locator("[data-remote-index-page-action=next]")).toBeDisabled();
  expect(remoteIndexRequests).toBe(2);

  await page.locator("[data-remote-index-page-action=previous]").click();
  await expect(page.locator("[data-remote-index-page-info]")).toHaveText("第 1 页 · 当前范围第 1-100 条 / 共 101 条");
  expect(remoteIndexRequests).toBe(2);
  await page.locator("#sessionList .session-row.index-only").first().click({ force: true });
  await expect(page.locator("#toast")).toContainText("仅含标题、时间、路径等元数据");
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
        page: { total: 1, limit: 100, cursor: 0, nextCursor: null },
        sessions: [{ id: "stale-index", title: "旧查询过期历史索引" }],
      } }).catch(() => {});
      return;
    }
    await route.fulfill({ json: {
      page: { total: 1, limit: 100, cursor: 0, nextCursor: null },
      sessions: [{ id: "current-index", title: "新查询当前历史索引" }],
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

test("详情受限时在工作台内分页诊断，并按需读取完整来源", async ({ page }) => {
  await openWorkbench(page);
  await expect(page.locator("#compactContent")).toContainText("会话详情超过读取上限");
  let fullEventReads = 0;
  await page.route("**/api/sources/local/sessions/33333333-3333-4333-8333-333333333333/events/*", async (route) => {
    fullEventReads += 1;
    await route.continue();
  });
  const firstPage = page.waitForRequest((request) => request.url().includes("/api/sources/local/query/sessions/") && request.url().includes("/events?") && request.url().includes("cursor=0"));
  await page.locator("#rawViewButton").click();
  await firstPage;
  await expect(page.locator("#rawContent")).toContainText("有界原始事件诊断");
  await expect(page.locator("#rawContent")).toContainText("这不是完整会话");
  await expect(page.locator("#rawContent [data-raw-event-index]").first()).toBeVisible();
  expect(fullEventReads).toBe(0);

  const firstIndex = await page.locator("#rawContent [data-raw-event-index]").first().getAttribute("data-raw-event-index");
  await page.locator("#rawContent [data-raw-event-index]").first().click();
  await page.locator("#reviewTabs [data-review-tab=source]").click();
  const fullRead = page.waitForRequest((request) => request.url().includes(`/api/sources/local/sessions/33333333-3333-4333-8333-333333333333/events/${firstIndex}`) && request.url().includes("snapshot="));
  await page.locator("#selectionDetails [data-review-source]").click();
  await fullRead;
  expect(fullEventReads).toBe(1);

  const nextPage = page.waitForRequest((request) => request.url().includes("/api/sources/local/query/sessions/") && request.url().includes("/events?") && request.url().includes("cursor=100") && request.url().includes("snapshot="));
  await page.locator("#rawContent [data-next-raw-page]").click();
  await nextPage;
  await expect(page.locator("#rawContent")).toContainText("第 2 页");
  const laterIndex = await page.locator("#rawContent [data-raw-event-index]").first().getAttribute("data-raw-event-index");
  await page.locator("#rawContent [data-raw-event-index]").first().click();
  const laterRead = page.waitForRequest((request) => request.url().includes(`/api/sources/local/sessions/33333333-3333-4333-8333-333333333333/events/${laterIndex}`) && request.url().includes("snapshot="));
  await page.locator("#selectionDetails [data-review-source]").click();
  await laterRead;
  expect(Number(laterIndex)).toBeGreaterThan(4);
  expect(fullEventReads).toBe(2);
  await page.locator("#rawContent [data-previous-raw-page]").click();
  await expect(page.locator("#rawContent")).toContainText("第 1 页");
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
  await page.locator("#rawViewButton").click();
  await request;
  const failed = page.waitForEvent("requestfailed", (candidate) => candidate.url().includes("/query/sessions/") && candidate.url().includes("/events?"));
  await page.locator("#compactViewButton").click();
  await failed;
  release();
  await expect(page.locator("#compactContent")).toContainText("会话详情超过读取上限");
  await expect(page.locator("#rawContent")).not.toContainText("过期诊断页");
});