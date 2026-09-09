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

test("长标题在列表、ARIA 与详情中完整保留", async ({ page }) => {
  const suffix = "CHROMIUM_LONG_TITLE_SUFFIX";
  await page.goto("/");
  const searchRequest = page.waitForRequest((request) => request.url().includes("/api/sources/local/sessions?") && request.url().includes(`q=${suffix}`));
  await page.locator("#sessionSearch").fill(suffix);
  await searchRequest;
  const row = page.locator('[data-session-id="88888888-8888-4888-8888-888888888888"]');
  await expect(row).toBeVisible();
  await expect(row).toContainText(suffix);
  await expect(row).toHaveAttribute("aria-label", new RegExp(suffix));
  await row.click();
  await expect(row).toHaveAttribute("aria-current", "true");
  await expect(page.locator("#sessionTitle")).toContainText(suffix);
  await expect(page.locator("#workbenchAnnouncements")).toContainText(suffix);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("[data-panel-target=sessions]").click();
  const mobileRow = page.locator('[data-session-id="88888888-8888-4888-8888-888888888888"]');
  await expect(mobileRow).toBeVisible();
  await expect(mobileRow).toContainText(suffix);
  await expect(mobileRow).toHaveAttribute("aria-label", new RegExp(suffix));
  await page.locator("[data-panel-target=thread]").click();
  await expect(page.locator("#sessionTitle")).toContainText(suffix);
});

test("被截断的会话标题保留完整原文提示", async ({ page }) => {
  const suffix = "CHROMIUM_LONG_TITLE_SUFFIX";
  await page.goto("/");
  await page.locator("#sessionSearch").fill(suffix);
  const title = page.locator('[data-session-id="88888888-8888-4888-8888-888888888888"] .session-title');
  await expect(title).toBeVisible();
  await expect(title).toHaveCSS("text-overflow", "ellipsis");
  await expect(title).toHaveAttribute("title", new RegExp(suffix));
  expect(await title.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("[data-panel-target=sessions]").click();
  await expect(title).toHaveAttribute("title", new RegExp(suffix));
});

test("长标题后段类型筛选由服务端完成，并在本机和远端历史完整展示", async ({ page }) => {
  const localSuffix = "CHROMIUM_LONG_TITLE_ERROR_TOOL_AFTER_DISPLAY_LIMIT";
  const remoteSuffix = "CHROMIUM_REMOTE_LONG_TITLE_ERROR_TOOL_AFTER_DISPLAY_LIMIT";
  await page.goto("/");
  const localTypeRequest = page.waitForRequest((request) => request.url().includes("/api/sources/local/sessions?") && request.url().includes("type=error"));
  await page.locator("#sessionTypeFilter").selectOption("error");
  await localTypeRequest;
  const localRow = page.locator('[data-session-id="88888888-8888-4888-8888-888888888888"]');
  await expect(localRow).toBeVisible();
  await expect(localRow).toContainText(localSuffix);
  await expect(localRow).toHaveAttribute("aria-label", new RegExp(localSuffix));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("[data-panel-target=sessions]").click();
  await expect(localRow).toBeVisible();
  await expect(localRow).toContainText(localSuffix);
  await expect(localRow).toHaveAttribute("aria-label", new RegExp(localSuffix));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator("#sourceSelect").selectOption("office");
  await page.locator("#sessionTimeFilter [data-session-time=earlier]").click();
  const remoteRow = page.locator('[data-session-id="00000000-0000-4000-8000-000000000101"]');
  await expect(remoteRow).toBeVisible();
  await expect(page.locator("#sessionCount")).toHaveText("1");
  await expect(remoteRow).toContainText(remoteSuffix);
  await expect(remoteRow).toHaveAttribute("aria-label", new RegExp(remoteSuffix));

  const remoteToolRequest = page.waitForRequest((request) => request.url().includes("/api/sources/office/index?") && request.url().includes("type=tool") && request.url().includes("cursor=0"));
  await page.locator("#sessionTypeFilter").selectOption("tool");
  await remoteToolRequest;
  await expect(remoteRow).toBeVisible();
  await expect(page.locator("#sessionCount")).toHaveText("1");
  await expect(remoteRow).toContainText(remoteSuffix);
});