import { expect, test } from "@playwright/test";

const sessionId = "33333333-3333-4333-8333-333333333333";

function promptResponse() {
  return {
    source: { id: "local", label: "本机 Codex Home", kind: "local" },
    scope: "recent24h",
    entries: [{
      id: `local:${sessionId}`,
      sourceId: "local",
      sourceLabel: "本机 Codex Home",
      sessionId,
      sessionTitle: "归档打开会话",
      cwd: "/workspace/chromium-contract",
      projectKey: "local:/workspace/chromium-contract",
      projectLabel: "/workspace/chromium-contract",
      promptState: "found",
      promptText: "保持复核面板",
      promptPreview: "保持复核面板",
      promptEventIndex: 2,
      updatedAt: "2025-01-02T03:04:11.000Z",
    }],
    projects: [],
    page: { candidateFrom: 1, candidateTo: 1, candidatesScanned: 1, entriesReturned: 1, limit: 200, hasMoreCandidates: false, nextPageToken: null },
  };
}

test("从归档打开会话后，详情响应不会覆盖用户后续的移动复核导航", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("#sessionTitle")).toContainText("验证工作台的 Chromium 交互契约");
  await page.route("**/api/sources/local/prompts?*", async (route) => route.fulfill({ json: promptResponse() }));
  let releaseDetail;
  const detailRelease = new Promise((resolve) => {
    releaseDetail = resolve;
  });
  await page.route(`**/api/sources/local/sessions/${sessionId}*`, async (route) => {
    await detailRelease;
    await route.continue();
  });

  await page.locator("[data-panel-target=sessions]").click();
  await page.locator("#promptsModeButton").click();
  const requestedDetail = page.waitForRequest(`**/api/sources/local/sessions/${sessionId}*`);
  await page.locator("[data-prompt-session-id]").click();
  await requestedDetail;
  await page.locator("[data-panel-target=inspector]").click();
  releaseDetail();
  await expect(page.locator("#sessionDetails")).not.toContainText("任务归档未打开会话");
  await expect(page.locator("#appShell")).toHaveAttribute("data-panel", "inspector");
});

test("Pi 大会话在有界前缀找到首任务后可搜索和按项目筛选", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#sessionTitle")).toHaveText(/(?:验证工作台的 Chromium 交互契约|确定性 Chromium 验证会话)/);
  await page.locator("#sourceSelect").selectOption("pi-agent");
  await page.locator("#promptsModeButton").click();
  await expect(page.locator("#promptArchiveContent")).toContainText("Pi 大会话前缀任务可被归档");
  await expect(page.locator("#promptArchiveContent")).toContainText("未命名会话");
  await page.locator("#promptArchiveSearch").fill("前缀任务");
  await expect(page.locator("#promptArchiveContent")).toContainText("Pi 大会话前缀任务可被归档");
  await page.locator('[data-prompt-project="pi-agent:/workspace/pi-agent-large"]').click();
  await expect(page.locator("#promptArchiveContent")).toContainText("Pi 大会话前缀任务可被归档");
  await expect(page.locator("#promptArchiveContent")).not.toContainText("Pi 来源可读会话");
});