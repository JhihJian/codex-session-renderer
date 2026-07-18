import { expect, test } from "@playwright/test";

const sessionTitle = /(?:验证工作台的 Chromium 交互契约|确定性 Chromium 验证会话)/;

async function openWorkbench(page) {
  await page.goto("/");
  await expect(page.locator("#sessionTitle")).toHaveText(sessionTitle);
}

function promptResponse(prompt) {
  return {
    source: { id: "local", label: "本机 Codex Home", kind: "local" },
    scope: "recent24h",
    entries: [{
      id: "local:33333333-3333-4333-8333-333333333333",
      sourceId: "local",
      sessionId: "33333333-3333-4333-8333-333333333333",
      sessionTitle: "当前任务",
      projectKey: "local:/workspace/chromium-contract",
      projectLabel: "/workspace/chromium-contract",
      promptState: "found",
      promptText: prompt,
      promptPreview: prompt,
    }],
    projects: [],
    page: { candidateFrom: 1, candidateTo: 1, candidatesScanned: 1, entriesReturned: 1, limit: 200, hasMoreCandidates: false, nextPageToken: null },
  };
}

test("来源作用域响应缺失或冲突会失败关闭并释放可重试入口", async ({ page }) => {
  await openWorkbench(page);
  await page.route("**/api/sources/local/sessions?*", async (route) => {
    await route.fulfill({ json: { scope: "recent24h", sessions: [] } });
  });
  await page.locator("#refreshButton").click();
  await expect(page.locator("#sessionsPanel")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#refreshButton")).toBeEnabled();
  await expect(page.locator("#sessionList")).toContainText("来源响应校验失败，请重试。");
  await page.unroute("**/api/sources/local/sessions?*");

  await page.route("**/api/sources/local/prompts?*", async (route) => {
    const response = promptResponse("不应采用冲突归档");
    response.entries[0].sourceId = "office";
    await route.fulfill({ json: response });
  });
  await page.locator("#promptsModeButton").click();
  await expect(page.locator("#promptArchiveContent")).toContainText("任务归档读取失败");
  await expect(page.locator("#promptArchiveContent")).toContainText("来源响应校验失败，请重试。");
  await expect(page.locator("#promptArchiveContent")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#promptArchiveContent [data-session-empty-action=retry-prompts]")).toBeEnabled();
});

test("远端历史索引拒绝顶层和条目来源冲突", async ({ page }) => {
  await openWorkbench(page);
  await page.locator("#sourceSelect").selectOption("office");
  let calls = 0;
  await page.route("**/api/sources/office/index?*", async (route) => {
    calls += 1;
    const source = calls === 1 ? { id: "local", label: "错误来源", kind: "local" } : { id: "office", label: "办公室", kind: "remote" };
    const sessions = calls === 1 ? [] : [{ id: "conflicting-index", sourceId: "local", displayTitle: "不应采用", updatedAt: "2025-01-02T03:04:11.000Z" }];
    await route.fulfill({ json: { source, page: { total: 0, limit: 100, cursor: "0", nextCursor: null }, sessions } });
  });

  await page.locator("#sessionTimeFilter [data-session-time=earlier]").click();
  await expect(page.locator("#sessionsPanel")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#sessionList")).toContainText("来源响应校验失败，请重试。");
  await page.locator("#sessionSearch").fill("再次请求");
  await expect(page.locator("#sessionsPanel")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#sessionList")).toContainText("来源响应校验失败，请重试。");
  expect(calls).toBe(2);
});

test("详情响应缺少匹配来源时会释放加载状态并可重试", async ({ page }) => {
  await openWorkbench(page);
  let intercepted = false;
  await page.route((url) => /\/api\/sources\/local\/sessions\/[^/?]+(?:\?.*)?$/.test(url.toString()), async (route) => {
    intercepted = true;
    await route.fulfill({ json: { session: { id: "wrong-source", sourceId: "office" } } });
  });
  await page.locator("#sessionList .session-row").nth(1).click();
  await expect(page.locator("#threadPanel")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#sessionTitle")).toHaveText("无法读取目标会话");
  await expect(page.locator("#threadPanel")).toContainText("来源响应校验失败，请重试。");
  expect(intercepted).toBe(true);
});

test("820px 边界及其最近可用宽度始终让布局与面板语义一致", async ({ page }) => {
  await page.goto("/");
  for (const [requestedWidth, viewportWidth] of [[820, 820], [820.5, 821], [821, 821]]) {
    await page.setViewportSize({ width: viewportWidth, height: 844 });
    const actualWidth = await page.evaluate(() => globalThis.innerWidth);
    const mobile = actualWidth <= 820;
    await expect(page.locator("#appShell")).toHaveAttribute("data-panel", "thread");
    await expect(page.locator("#threadPanel")).toHaveJSProperty("inert", false);
    if (mobile) {
      await expect(page.locator("#threadPanel")).toHaveAttribute("role", "tabpanel");
      await expect(page.locator("#sessionsPanel")).toHaveAttribute("aria-hidden", "true");
      await expect(page.locator("#sessionsPanel")).toHaveJSProperty("inert", true);
    } else {
      await expect(page.locator("#threadPanel")).not.toHaveAttribute("role");
      await expect(page.locator("#sessionsPanel")).not.toHaveAttribute("aria-hidden");
      await expect(page.locator("#sessionsPanel")).toHaveJSProperty("inert", false);
    }
    expect(actualWidth).toBe(viewportWidth);
    expect(requestedWidth === 820.5 ? actualWidth : requestedWidth).toBe(actualWidth);
  }
});