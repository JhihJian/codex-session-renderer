import { expect, test } from "@playwright/test";

const sessionTitle = /(?:验证工作台的 Chromium 交互契约|确定性 Chromium 验证会话)/;
const sessionId = "33333333-3333-4333-8333-333333333333";

async function openWorkbench(page) {
  await page.goto("/");
  await expect(page.locator("#sessionTitle")).toHaveText(sessionTitle);
  await expect(page.locator("#compactContent")).toBeVisible();
}

test("受限诊断复用前进缓存，不重复请求或追加页面", async ({ page }) => {
  await openWorkbench(page);
  await expect(page.locator("#compactContent")).toContainText("会话详情超过读取上限");
  let fullEventReads = 0;
  const diagnosticPageCursors = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!url.pathname.includes("/api/sources/local/query/sessions/") || !url.pathname.endsWith("/events")) return;
    diagnosticPageCursors.push(url.searchParams.get("cursor"));
  });
  await page.route(`**/api/sources/local/sessions/${sessionId}/events/*`, async (route) => {
    fullEventReads += 1;
    await route.continue();
  });

  const firstPage = page.waitForRequest((request) => request.url().includes("/api/sources/local/query/sessions/") && request.url().includes("/events?") && request.url().includes("cursor=0"));
  await page.locator("#rawViewButton").click();
  await firstPage;
  await expect(page.locator("#rawContent")).toContainText("有界原始事件诊断");
  await expect(page.locator("#rawContent [data-raw-event-index]").first()).toBeVisible();
  expect(diagnosticPageCursors).toEqual(["0"]);
  expect(fullEventReads).toBe(0);

  const firstIndex = await page.locator("#rawContent [data-raw-event-index]").first().getAttribute("data-raw-event-index");
  await page.locator("#rawContent [data-raw-event-index]").first().click();
  await page.locator("#reviewTabs [data-review-tab=source]").click();
  const fullRead = page.waitForRequest((request) => request.url().includes(`/api/sources/local/sessions/${sessionId}/events/${firstIndex}`) && request.url().includes("snapshot="));
  await page.locator("#selectionDetails [data-review-source]").click();
  await fullRead;
  expect(fullEventReads).toBe(1);

  const nextPage = page.waitForRequest((request) => request.url().includes("/api/sources/local/query/sessions/") && request.url().includes("/events?") && request.url().includes("cursor=100") && request.url().includes("snapshot="));
  await page.locator("#rawContent [data-next-raw-page]").click();
  await nextPage;
  await expect(page.locator("#rawContent")).toContainText("第 2 页");
  expect(diagnosticPageCursors).toEqual(["0", "100"]);

  const laterIndex = await page.locator("#rawContent [data-raw-event-index]").first().getAttribute("data-raw-event-index");
  await page.locator("#rawContent [data-raw-event-index]").first().click();
  const laterRead = page.waitForRequest((request) => request.url().includes(`/api/sources/local/sessions/${sessionId}/events/${laterIndex}`) && request.url().includes("snapshot="));
  await page.locator("#selectionDetails [data-review-source]").click();
  await laterRead;
  expect(Number(laterIndex)).toBeGreaterThan(4);
  expect(fullEventReads).toBe(2);

  await page.locator("#rawContent [data-previous-raw-page]").click();
  await expect(page.locator("#rawContent")).toContainText("第 1 页");
  let cachedForwardRequests = 0;
  await page.route(`**/api/sources/local/query/sessions/${sessionId}/events?*`, async (route) => {
    cachedForwardRequests += 1;
    await route.abort();
  });
  await page.locator("#rawContent [data-next-raw-page]").click();
  await expect(page.locator("#rawContent")).toContainText("第 2 页");
  expect(cachedForwardRequests).toBe(0);
  expect(diagnosticPageCursors).toEqual(["0", "100"]);
});

test("刷新列表会中止在途诊断页并清空旧缓存", async ({ page }) => {
  await openWorkbench(page);
  let releaseDelayedPage;
  const delayedPage = new Promise((resolve) => {
    releaseDelayedPage = resolve;
  });
  await page.route(`**/api/sources/local/query/sessions/${sessionId}/events?*`, async (route) => {
    if (new URL(route.request().url()).searchParams.get("cursor") !== "100") {
      await route.continue();
      return;
    }
    await delayedPage;
    await route.continue().catch(() => {});
  });
  await page.locator("#rawViewButton").click();
  await expect(page.locator("#rawContent [data-raw-event-index]").first()).toBeVisible();
  const pageTwoRequest = page.waitForRequest((request) => request.url().includes("/events?") && request.url().includes("cursor=100"));
  await page.locator("#rawContent [data-next-raw-page]").click();
  await pageTwoRequest;
  const pageTwoCancelled = page.waitForEvent("requestfailed", (request) => request.url().includes("/events?") && request.url().includes("cursor=100"));
  await page.locator("#refreshButton").click();
  await pageTwoCancelled;
  releaseDelayedPage();
  await expect(page.locator("#rawContent")).not.toContainText("第 2 页");
});