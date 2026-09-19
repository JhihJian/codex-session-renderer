import { expect, test } from "@playwright/test";
import { selectCodexSource } from "./source-helpers.mjs";

test("实时模式展示当前会话的连续消息和可观察状态", async ({ page }) => {
  await page.goto("/");
  await selectCodexSource(page);
  const toggle = page.locator("#liveModeToggle");
  await expect(toggle).toBeVisible();
  await toggle.check();

  await expect(page.locator("#compactContent .live-transcript")).toBeVisible();
  await expect(page.locator("#compactContent")).toContainText("验证工作台的 Chromium 交互契约");
  await expect(page.locator("#compactContent")).toContainText("已使用固定隔离样本加载工作台。");
  await expect(page.locator("#liveStatus")).toContainText("实时同步");
  await expect(page.locator("#liveStatus")).toContainText("已完成");

  await toggle.uncheck();
  await expect(page.locator("#compactContent .live-transcript")).toHaveCount(0);
  await expect(page.locator("#compactContent")).toContainText("第 1 轮");
});