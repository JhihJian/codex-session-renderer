import { expect, test } from "@playwright/test";

test("Harness 页面以验证关口组织队列，并按需展示技术证据", async ({ page }) => {
  await page.goto("/harness.html");
  await expect(page.locator("h1")).toHaveText("Harness 验证工作台");
  await expect(page.locator("#statusFilters").getByRole("button", { name: /待可信复现/ })).toContainText("1 项");
  await expect(page.locator(".queue-row").filter({ hasText: "观察 3 次" })).toHaveCount(1);
  await page.locator(".queue-row").filter({ hasText: "观察 3 次" }).click();
  await expect(page.locator("#detail")).toContainText("这代表什么");
  await expect(page.locator("#detail")).toContainText("400: Unsupported value: minimal");
  await expect(page.locator("#detail")).toContainText("未采集的进程退出码");

  await page.locator("#statusFilters").getByRole("button", { name: /已阻塞/ }).click();
  await expect(page.locator(".queue-row")).toHaveCount(1);
  await page.locator(".queue-row").click();
  await expect(page.locator("#detail")).toContainText("需要可验证的可信 sandbox。");
  await expect(page.locator("#detail details.technical")).not.toHaveAttribute("open", "");

  await page.locator("#defectsTab").click();
  await expect(page.locator("#statusFilters")).toContainText("已通过的验证证据");
  await page.locator(".queue-row").click();
  await expect(page.locator("#detail")).toContainText("事件 “tool_execution_end” 的次数必须为 0。");
  await expect(page.locator("#detail")).not.toContainText("[object Object]");
  await page.locator("#detail details.technical").click();
  await expect(page.locator("#detail")).toContainText("归档 SHA-256");
  expect(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/harness-workbench-desktop.png", fullPage: false });

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/harness-workbench-mobile.png", fullPage: false });
});