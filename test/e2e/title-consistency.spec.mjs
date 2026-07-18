import { expect, test } from "@playwright/test";

test("严格 Goal 标题在列表、ARIA 与移动端详情保持投影后的同一标题", async ({ page }) => {
  const objective = "Codex Goal 默认阅读只显示这个真实目标";
  await page.goto("/");
  const row = page.locator("#sessionList .session-row", { hasText: objective });
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("aria-label", objective);
  await expect(row).not.toHaveAttribute("aria-label", /Goal-mode rules|Tokens remaining/);
  await row.click();
  await expect(page.locator("#sessionTitle")).toHaveText(objective);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("[data-panel-target=sessions]").click();
  const mobileRow = page.locator("#sessionList .session-row", { hasText: objective });
  await expect(mobileRow).toBeVisible();
  await expect(mobileRow).toHaveAttribute("aria-label", `${objective}，当前会话`);
  await expect(mobileRow).toHaveAttribute("aria-current", "true");
  await page.locator("[data-panel-target=thread]").click();
  await expect(page.locator("#threadPanel")).toBeVisible();
  await expect(page.locator("#sessionTitle")).toHaveText(objective);
});

test("长标题后段在服务端定位，列表和选择反馈保持有界而详情保留完整标题", async ({ page }) => {
  const suffix = "CHROMIUM_LONG_TITLE_SUFFIX";
  await page.goto("/");
  const searchRequest = page.waitForRequest((request) => request.url().includes("/api/sources/local/sessions?") && request.url().includes(`q=${suffix}`));
  await page.locator("#sessionSearch").fill(suffix);
  await searchRequest;
  const row = page.locator('[data-session-id="88888888-8888-4888-8888-888888888888"]');
  await expect(row).toBeVisible();
  await expect(row).not.toContainText(suffix);
  await expect(row).toHaveAttribute("aria-label", /标题已截断/);
  expect((await row.getAttribute("aria-label")).length).toBeLessThanOrEqual(180);
  await row.click();
  await expect(row).toHaveAttribute("aria-current", "true");
  await expect(page.locator("#sessionTitle")).toContainText(suffix);
  await expect(page.locator("#workbenchAnnouncements")).not.toContainText(suffix);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("[data-panel-target=sessions]").click();
  const mobileRow = page.locator('[data-session-id="88888888-8888-4888-8888-888888888888"]');
  await expect(mobileRow).toBeVisible();
  await expect(mobileRow).not.toContainText(suffix);
  expect((await mobileRow.getAttribute("aria-label")).length).toBeLessThanOrEqual(180);
  await page.locator("[data-panel-target=thread]").click();
  await expect(page.locator("#sessionTitle")).toContainText(suffix);
});