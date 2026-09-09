import { expect, test } from "@playwright/test";

test("Pi Agent 会话在可用时默认展示", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("#sourceSelect")).toHaveValue("pi-agent");
  await expect(page.locator("#sessionTitle")).toHaveText("Pi 可切换会话");
});