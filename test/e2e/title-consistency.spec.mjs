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
  await expect(mobileRow).toHaveAttribute("aria-label", objective);
  await page.locator("[data-panel-target=thread]").click();
  await expect(page.locator("#threadPanel")).toBeVisible();
  await expect(page.locator("#sessionTitle")).toHaveText(objective);
});