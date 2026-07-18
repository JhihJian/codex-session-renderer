import { expect, test } from "@playwright/test";

const sessionId = "33333333-3333-4333-8333-333333333333";
const piGoalSessionId = "66666666-6666-4666-8666-666666666666";
const codexGoalSessionId = "77777777-7777-4777-8777-777777777777";

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

test("Pi Goal 默认视图投影目标而原始单事件仍保留控制包", async ({ page }) => {
  await page.goto("/");
  await page.locator("#sourceSelect").selectOption("pi-agent");
  await page.locator(`[data-session-id="${piGoalSessionId}"]`).click();
  await expect(page.locator("#compactContent")).toContainText("Pi Goal 默认阅读只显示这个目标");
  await expect(page.locator("#compactContent")).not.toContainText("goal_id");
  await expect(page.locator("#compactContent")).not.toContainText("Goal-mode rules:");
  await page.locator("#auditViewButton").click();
  await expect(page.locator("#auditContent")).toContainText("Pi Goal 默认阅读只显示这个目标");
  await expect(page.locator("#auditContent")).not.toContainText("goal_id");

  const raw = await page.request.get(`/api/sources/pi-agent/sessions/${piGoalSessionId}/events/2`);
  await expect(raw).toBeOK();
  await expect(await raw.text()).toContain("goal_id");
});

test("Codex Goal 列表标题和默认阅读投影目标，Raw 单事件保留完整控制包", async ({ page }) => {
  await page.goto("/");
  const row = page.locator(`[data-session-id="${codexGoalSessionId}"]`);
  await expect(row).toContainText("Codex Goal 默认阅读只显示这个真实目标");
  await expect(row).not.toContainText("<codex_internal_context");
  await row.click();
  await expect(page.locator("#sessionTitle")).toContainText("Codex Goal 默认阅读只显示这个真实目标");
  await expect(page.locator("#compactContent")).toContainText("Codex Goal 默认阅读只显示这个真实目标");
  await expect(page.locator("#compactContent")).not.toContainText("Tokens remaining: unbounded");
  await page.locator("#auditViewButton").click();
  await expect(page.locator("#auditContent")).toContainText("Codex Goal 默认阅读只显示这个真实目标");
  await expect(page.locator("#auditContent")).not.toContainText("<codex_internal_context");

  const raw = await page.request.get(`/api/sources/local/sessions/${codexGoalSessionId}/events/3`);
  await expect(raw).toBeOK();
  await expect((await raw.json()).raw.payload.content[0].text).toContain('<codex_internal_context source="goal">');
});