import { expect, test } from "@playwright/test";

function sourceResponse() {
  return {
    id: "office",
    label: "办公室",
    kind: "remote",
    status: { refreshable: true, snapshotAvailable: true },
  };
}

function indexResponse(cursor, { bucket = "earlier", generation = "旧索引", total = 101 } = {}) {
  const start = Number(cursor);
  const updatedAt = bucket === "day" ? new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString() : "2020-01-02T03:04:11.000Z";
  const sessions = Array.from({ length: Math.min(100, total - start) }, (_, index) => ({
    id: `office-index-${generation}-${start + index}`,
    sourceId: "office",
    displayTitle: `${generation}${bucket === "day" ? "近一天" : "更早"}历史索引 ${start + index + 1}`,
    updatedAt,
  }));
  return {
    source: sourceResponse(),
    page: {
      total,
      limit: 100,
      cursor: String(start),
      nextCursor: start + sessions.length < total ? String(start + sessions.length) : null,
      snapshot: `${generation}-snapshot`,
    },
    sessions,
  };
}

async function openSecondIndexPage(page, bucket) {
  await page.goto("/");
  await page.locator("#sourceSelect").selectOption("office");
  await page.locator(`#sessionTimeFilter [data-session-time=${bucket}]`).click();
  await expect(page.locator("[data-remote-index-page-info]")).toHaveText("第 1 页 · 当前范围第 1-100 条 / 共 101 条");
  const next = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/sources/office/index" && new URL(request.url()).searchParams.get("cursor") === "100");
  await page.locator("[data-remote-index-page-action=next]").click();
  await next;
  await expect(page.locator("[data-remote-index-page-info]")).toHaveText("第 2 页 · 当前范围第 101-101 条 / 共 101 条");
}

test("远端历史列表刷新重读 index 首页，不回退 sessions 并保留索引分页", async ({ page }) => {
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

for (const bucket of ["day", "earlier"]) {
  test(`拉取远端快照后在${bucket === "day" ? "近一天" : "更早"}索引重建首页，不回退 sessions，后续分页绑定新快照`, async ({ page }) => {
    let generation = "旧索引";
    const indexUrls = [];
    let officeSessionRequests = 0;
    await page.route("**/api/sources/office/index?*", async (route) => {
      const url = new URL(route.request().url());
      indexUrls.push(url);
      const response = generation === "旧索引"
        ? indexResponse(url.searchParams.get("cursor") || "0", { bucket })
        : indexResponse(url.searchParams.get("cursor") || "0", { bucket, generation, total: 102 });
      await route.fulfill({ json: response });
    });
    await page.route("**/api/sources/office/sessions?*", async (route) => {
      officeSessionRequests += 1;
      await route.continue();
    });
    await page.route("**/api/sources/office/refresh", async (route) => {
      generation = "新索引";
      await route.fulfill({ json: { ok: true, source: sourceResponse() } });
    });

    await openSecondIndexPage(page, bucket);
    await expect(page.locator("#sessionList")).toContainText(`旧索引${bucket === "day" ? "近一天" : "更早"}历史索引 101`);
    const sessionsBeforeRefresh = officeSessionRequests;
    const indexesBeforeRefresh = indexUrls.length;

    await page.locator("#refreshRemoteButton").click();
    await expect(page.locator("[data-remote-index-page-info]")).toHaveText("第 1 页 · 当前范围第 1-100 条 / 共 102 条");
    await expect(page.locator("#sessionList")).toContainText(`新索引${bucket === "day" ? "近一天" : "更早"}历史索引 1`);
    await expect(page.locator("#sessionList")).not.toContainText(`旧索引${bucket === "day" ? "近一天" : "更早"}历史索引 101`);
    await expect(page.locator("#sessionsPanel")).toHaveAttribute("aria-busy", "false");
    expect(officeSessionRequests).toBe(sessionsBeforeRefresh);
    expect(indexUrls).toHaveLength(indexesBeforeRefresh + 1);
    const rebuiltFirstPage = indexUrls.at(-1);
    expect(rebuiltFirstPage.searchParams.get("bucket")).toBe(bucket);
    expect(rebuiltFirstPage.searchParams.get("cursor")).toBe("0");
    expect(rebuiltFirstPage.searchParams.has("snapshot")).toBe(false);

    const next = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return url.pathname === "/api/sources/office/index" && url.searchParams.get("cursor") === "100" && url.searchParams.get("snapshot") === "新索引-snapshot";
    });
    await page.locator("[data-remote-index-page-action=next]").click();
    await next;
    await expect(page.locator("[data-remote-index-page-info]")).toHaveText("第 2 页 · 当前范围第 101-102 条 / 共 102 条");
  });
}

test("远端快照拉取失败时保留当前历史索引页、分页和既有快照令牌", async ({ page }) => {
  const indexUrls = [];
  let officeSessionRequests = 0;
  await page.route("**/api/sources/office/index?*", async (route) => {
    const url = new URL(route.request().url());
    indexUrls.push(url);
    await route.fulfill({ json: indexResponse(url.searchParams.get("cursor") || "0") });
  });
  await page.route("**/api/sources/office/sessions?*", async (route) => {
    officeSessionRequests += 1;
    await route.continue();
  });
  await page.route("**/api/sources/office/refresh", async (route) => {
    await route.fulfill({ status: 502, json: { error: "模拟快照拉取失败" } });
  });

  await openSecondIndexPage(page, "earlier");
  const pageInfo = await page.locator("[data-remote-index-page-info]").textContent();
  const sessionsBeforeRefresh = officeSessionRequests;
  const indexesBeforeRefresh = indexUrls.length;

  await page.locator("#refreshRemoteButton").click();
  await expect(page.locator("[data-remote-index-page-info]")).toHaveText(pageInfo || "");
  await expect(page.locator("#sessionList")).toContainText("旧索引更早历史索引 101");
  await expect(page.locator("#refreshRemoteButton")).toBeEnabled();
  await expect(page.locator("#sessionsPanel")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#sourceStatus")).toContainText("拉取失败：模拟快照拉取失败。可再次拉取");
  expect(officeSessionRequests).toBe(sessionsBeforeRefresh);
  expect(indexUrls).toHaveLength(indexesBeforeRefresh);
});
