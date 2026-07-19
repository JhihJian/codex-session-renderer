import { expect, test } from "@playwright/test";

function indexResponse(cursor) {
  const start = Number(cursor);
  const sessions = Array.from({ length: start === 0 ? 100 : 1 }, (_, index) => ({
    id: `office-index-${start + index}`,
    sourceId: "office",
    displayTitle: `办公室历史索引 ${start + index + 1}`,
    updatedAt: "2020-01-02T03:04:11.000Z",
  }));
  return {
    source: { id: "office", label: "办公室", kind: "remote" },
    page: { total: 101, limit: 100, cursor: String(start), nextCursor: start === 0 ? "100" : null, snapshot: "stable-index" },
    sessions,
  };
}

test("远端历史刷新重读 index 首页，不回退 sessions 并保留索引分页", async ({ page }) => {
  let indexRequests = 0;
  let officeSessionRequests = 0;
  await page.route("**/api/sources/office/index?*", async (route) => {
    indexRequests += 1;
    const url = new URL(route.request().url());
    await route.fulfill({ json: indexResponse(url.searchParams.get("cursor") || "0") });
  });
  await page.route("**/api/sources/office/sessions?*", async (route) => {
    officeSessionRequests += 1;
    await route.continue();
  });

  await page.goto("/");
  await page.locator("#sourceSelect").selectOption("office");
  await page.locator("#sessionTimeFilter [data-session-time=earlier]").click();
  await expect(page.locator("#sessionCount")).toHaveText("101");
  await expect(page.locator("[data-remote-index-page-info]")).toHaveText("第 1 页 · 当前范围第 1-100 条 / 共 101 条");
  const sessionsBeforeRefresh = officeSessionRequests;

  await page.locator("#refreshButton").click();
  await expect(page.locator("#sessionsPanel")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#sessionCount")).toHaveText("101");
  await expect(page.locator("[data-remote-index-page-info]")).toHaveText("第 1 页 · 当前范围第 1-100 条 / 共 101 条");
  expect(indexRequests).toBe(2);
  expect(officeSessionRequests).toBe(sessionsBeforeRefresh);

  const next = page.waitForRequest((request) => request.url().includes("/api/sources/office/index?") && request.url().includes("cursor=100"));
  await page.locator("[data-remote-index-page-action=next]").click();
  await next;
  await expect(page.locator("[data-remote-index-page-info]")).toHaveText("第 2 页 · 当前范围第 101-101 条 / 共 101 条");
});
