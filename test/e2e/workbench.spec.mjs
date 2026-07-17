import { expect, test } from "@playwright/test";

const sessionTitle = "验证工作台的 Chromium 交互契约";

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