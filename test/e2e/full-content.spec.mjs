import { expect, test } from "@playwright/test";

test("原始事件详情完整展示大型工具输出", async ({ page }) => {
  await page.goto("/");
  await page.locator("#diagnosticViewButton").click();
  await page.locator("#rawViewButton").click();
  const outputEvent = page.locator('[data-raw-event-index="5"]');
  await expect(outputEvent).toBeVisible();
  await outputEvent.click();
  await expect(page.locator("#rawContent .raw-preview")).toContainText("FULL_TOOL_OUTPUT_END", { timeout: 20_000 });
});