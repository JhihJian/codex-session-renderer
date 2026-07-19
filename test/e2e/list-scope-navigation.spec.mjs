import { expect, test } from "@playwright/test";

const earlierSession = {
  id: "history-scope-session",
  sourceId: "local",
  displayTitle: "范围内更早会话",
  updatedAt: "2020-01-02T03:04:11.000Z",
  cwd: "/workspace/history",
};

test("过期 recent 列表不会污染更早范围、自动打开详情或提前释放刷新状态", async ({ page }) => {
  let releaseRecent;
  const recentReleased = new Promise((resolve) => { releaseRecent = resolve; });
  let releaseHistory;
  const historyReleased = new Promise((resolve) => { releaseHistory = resolve; });
  let recentRequests = 0;
  let detailRequests = 0;

  await page.route("**/api/sources/local/sessions?*", async (route) => {
    const url = new URL(route.request().url());
    const scope = url.searchParams.get("scope");
    if (scope === "recent24h") {
      recentRequests += 1;
      if (recentRequests === 1) {
        await route.fulfill({ json: { source: { id: "local", label: "本机 Codex Home", kind: "local" }, scope, sessions: [] } });
        return;
      }
      await recentReleased;
      await route.fulfill({ json: {
        source: { id: "local", label: "本机 Codex Home", kind: "local" },
        scope,
        sessions: [{ id: "stale-recent-session", sourceId: "local", displayTitle: "不得越界的最近会话", updatedAt: "2025-01-02T03:04:11.000Z" }],
      } }).catch(() => {});
      return;
    }
    if (scope === "history") {
      await historyReleased;
      await route.fulfill({ json: { source: { id: "local", label: "本机 Codex Home", kind: "local" }, scope, sessions: [earlierSession] } });
      return;
    }
    await route.continue();
  });
  await page.route((url) => /\/api\/sources\/local\/sessions\/[^/?]+(?:\?.*)?$/.test(url.toString()), async (route) => {
    detailRequests += 1;
    await route.continue();
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("#refreshButton")).toBeEnabled();
  await page.locator("#refreshButton").click();
  await expect(page.locator("#refreshButton")).toBeDisabled();
  await page.locator("[data-panel-target=sessions]").click();
  await page.locator("#sessionTimeFilter [data-session-time=earlier]").click();
  await expect(page.locator("#sessionsPanel")).toHaveAttribute("aria-busy", "true");
  releaseRecent();
  await expect(page.locator("#refreshButton")).toBeDisabled();
  await expect(page.locator("#sessionsPanel")).toHaveAttribute("aria-busy", "true");
  await expect(page.locator("#sessionList")).not.toContainText("不得越界的最近会话");
  expect(detailRequests).toBe(0);

  releaseHistory();
  await expect(page.locator('[data-session-id="history-scope-session"]')).toBeVisible();
  await expect(page.locator("#sessionList")).not.toContainText("不得越界的最近会话");
  await expect(page.locator("#refreshButton")).toBeEnabled();
  await expect(page.locator("#sessionsPanel")).toHaveAttribute("aria-busy", "false");
  expect(detailRequests).toBe(1);
});

test("桌面端切换到更早范围时，过期 recent 响应不会释放当前历史读取", async ({ page }) => {
  let releaseRecent;
  const recentReleased = new Promise((resolve) => { releaseRecent = resolve; });
  let releaseHistory;
  const historyReleased = new Promise((resolve) => { releaseHistory = resolve; });
  let recentRequests = 0;
  await page.route("**/api/sources/local/sessions?*", async (route) => {
    const scope = new URL(route.request().url()).searchParams.get("scope");
    if (scope === "recent24h") {
      recentRequests += 1;
      if (recentRequests === 1) {
        await route.fulfill({ json: { source: { id: "local", label: "本机 Codex Home", kind: "local" }, scope, sessions: [] } });
      } else {
        await recentReleased;
        await route.fulfill({ json: { source: { id: "local", label: "本机 Codex Home", kind: "local" }, scope, sessions: [{ ...earlierSession, id: "stale-desktop-recent", displayTitle: "桌面端不得显示的最近会话" }] } }).catch(() => {});
      }
      return;
    }
    await historyReleased;
    await route.fulfill({ json: { source: { id: "local", label: "本机 Codex Home", kind: "local" }, scope, sessions: [earlierSession] } });
  });
  await page.goto("/");
  await page.locator("#refreshButton").click();
  await page.locator("#sessionTimeFilter [data-session-time=earlier]").click();
  releaseRecent();
  await expect(page.locator("#refreshButton")).toBeDisabled();
  await expect(page.locator("#sessionsPanel")).toHaveAttribute("aria-busy", "true");
  await expect(page.locator("#sessionList")).not.toContainText("桌面端不得显示的最近会话");
  releaseHistory();
  await expect(page.locator('[data-session-id="history-scope-session"]')).toBeVisible();
  await expect(page.locator("#refreshButton")).toBeEnabled();
});

test("列表和归档的 scope 响应错配会失败关闭并保留可重试状态", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#sessionTitle")).toContainText(/Chromium|验证工作台/);
  await page.route("**/api/sources/local/sessions?*", async (route) => {
    await route.fulfill({ json: { source: { id: "local", label: "本机 Codex Home", kind: "local" }, scope: "day", sessions: [] } });
  });
  await page.locator("#refreshButton").click();
  await expect(page.locator("#sessionList")).toContainText("来源响应校验失败，请重试。");
  await expect(page.locator("#refreshButton")).toBeEnabled();

  await page.locator("#sessionTimeFilter [data-session-time=earlier]").click();
  await expect(page.locator("#sessionList")).toContainText("历史会话读取失败：来源响应校验失败，请重试。");
  await expect(page.locator("[data-session-empty-action=retry-history]")).toBeEnabled();

  await page.route("**/api/sources/local/prompts?*", async (route) => {
    await route.fulfill({ json: {
      source: { id: "local", label: "本机 Codex Home", kind: "local" },
      scope: "recent24h",
      entries: [],
      projects: [],
      page: { candidateFrom: 0, candidateTo: 0, candidatesScanned: 0, entriesReturned: 0, hasMoreCandidates: false, nextPageToken: null },
    } });
  });
  await page.locator("#promptsModeButton").click();
  await expect(page.locator("#promptArchiveContent")).toContainText("任务归档读取失败");
  await expect(page.locator("#promptArchiveContent")).toContainText("来源响应校验失败，请重试。");
  await expect(page.locator("#promptArchiveContent [data-session-empty-action=retry-prompts]")).toBeEnabled();
  await expect(page.locator("#promptArchiveContent")).toHaveAttribute("aria-busy", "false");
});
