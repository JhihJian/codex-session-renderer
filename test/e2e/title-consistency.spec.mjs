import { expect, test } from "@playwright/test";
import { openSessionFilters, selectCodexSource } from "./source-helpers.mjs";

test("严格 Goal 标题在列表、ARIA 与移动端详情保持投影后的同一标题", async ({ page }) => {
  const objective = "Codex Goal 默认阅读只显示这个真实目标";
  await page.goto("/");
  await selectCodexSource(page);
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

test("详情头部元信息显示会话文件位置而不是用户输入", async ({ page }) => {
  const userInput = "验证工作台的 Chromium 交互契约";
  await page.goto("/");
  await selectCodexSource(page);
  await page.locator("#sessionList .session-row", { hasText: "确定性 Chromium 验证会话" }).click();

  await expect(page.locator("#sessionMetaLabel")).toHaveText("sessions/isolated/rollout-2025-01-02T03-04-05-33333333-3333-4333-8333-333333333333.jsonl");
  await expect(page.locator("#sessionMetaLabel")).not.toHaveText(userInput);
});

test("长标题在列表、ARIA 与详情中完整保留", async ({ page }) => {
  const suffix = "CHROMIUM_LONG_TITLE_SUFFIX";
  await page.goto("/");
  await selectCodexSource(page);
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
  await selectCodexSource(page);
  await page.locator("#sessionSearch").fill(suffix);
  const title = page.locator('[data-session-id="88888888-8888-4888-8888-888888888888"] .session-title');
  await expect(title).toBeVisible();
  await expect(title).toHaveCSS("text-overflow", "ellipsis");
  await expect(title).toHaveAttribute("title", new RegExp(suffix));
  expect(await title.evaluate((element) => (
    element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1
  ))).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("[data-panel-target=sessions]").click();
  await expect(title).toContainText(suffix);
});

test("侧边栏 Markdown 标题链接不会离开工作台，并照常选择会话", async ({ page }) => {
  await page.goto("/");
  await selectCodexSource(page);
  const row = page.locator('[data-session-id="99999999-9999-4999-8999-999999999999"]');
  const link = row.locator(".session-title a");
  await expect(link).toHaveAttribute("href", "https://example.test/sidebar-title");
  const initialUrl = page.url();

  await link.click();

  await expect.poll(() => page.url()).toBe(initialUrl);
  await expect(row).toHaveAttribute("aria-current", "true");
  await expect(page.locator("#sessionTitle")).toContainText("外部跳转");
});

test("长标题后段类型筛选由服务端完成", async ({ page }) => {
  const localSuffix = "CHROMIUM_LONG_TITLE_ERROR_TOOL_AFTER_DISPLAY_LIMIT";
  await page.goto("/");
  await selectCodexSource(page);
  await openSessionFilters(page);
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

});