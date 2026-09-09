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

test("执行过程展示工具参数和中文执行状态，点击后显示返回结果", async ({ page }) => {
  await page.goto("/");
  await page.locator("#traceViewButton").click();
  for (let index = 0; index < 8 && await page.locator('.trace-row[data-trace-node-id]', { hasText: "exec_command" }).count() === 0; index += 1) {
    const toggles = page.locator("[data-trace-toggle-id]");
    if (await toggles.count() === 0) break;
    await toggles.last().click();
  }
  const tool = page.locator('.trace-row[data-trace-node-id]', { hasText: "exec_command" }).first();
  await expect(tool).toContainText("npm test");
  await expect(tool).toContainText("执行成功");
  await tool.click();
  await expect(page.locator("#detailsPanel")).toBeVisible();
  await expect(page.locator("#toolDetailsContent")).toContainText("调用参数");
  await expect(page.locator("#toolDetailsContent")).toContainText('"cmd": "npm test"');
  await expect(page.locator("#toolDetailsContent")).toContainText("返回结果");
  await expect(page.locator("#toolDetailsContent")).toContainText("FULL_TOOL_OUTPUT_END");
  await expect(page.locator("#toolDetailsContent .tool-details-status")).toHaveText("执行成功");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-panel-target="thread"]').click();
  const traceWidth = await page.locator(".trace-shell").evaluate((element) => ({ client: element.clientWidth, scroll: element.scrollWidth }));
  expect(traceWidth.scroll).toBeLessThanOrEqual(traceWidth.client);
  await page.locator('[data-panel-target="details"]').click();
  await expect(page.locator("#toolDetailsContent .tool-details-status")).toHaveText("执行成功");
});
