import { expect, test } from "@playwright/test";
import { selectCodexSource } from "./source-helpers.mjs";

test("原始事件详情完整展示大型工具输出", async ({ page }) => {
  await page.goto("/");
  await selectCodexSource(page);
  await page.locator("#diagnosticViewButton").click();
  await page.locator("#rawViewButton").click();
  const outputEvent = page.locator('[data-raw-event-index="5"]');
  await expect(outputEvent).toBeVisible();
  const textLayout = await outputEvent.evaluate((row) => {
    const [kind, title, timestamp, preview] = row.children;
    const rect = (element) => element.getBoundingClientRect();
    const metaBottom = Math.max(rect(kind).bottom, rect(timestamp).bottom);
    return {
      titleTop: rect(title).top,
      titleBottom: rect(title).bottom,
      metaBottom,
      previewTop: rect(preview).top,
    };
  });
  // Two-line clamping includes a small baseline allowance in Chromium's box metrics.
  expect(textLayout.metaBottom - textLayout.titleTop).toBeLessThanOrEqual(5);
  expect(textLayout.titleBottom - textLayout.previewTop).toBeLessThanOrEqual(5);
  await outputEvent.click();
  const preview = page.locator("#rawContent .raw-preview");
  await expect(preview).toContainText("FULL_TOOL_OUTPUT_END", { timeout: 20_000 });
  const previewScroll = await preview.evaluate((element) => ({
    clientHeight: element.clientHeight,
    overflowY: element.ownerDocument.defaultView.getComputedStyle(element).overflowY,
    scrollHeight: element.scrollHeight,
  }));
  expect(previewScroll.overflowY).toBe("auto");
  expect(previewScroll.scrollHeight).toBeGreaterThan(previewScroll.clientHeight);
});

test("执行过程展示工具参数和中文执行状态，点击后显示返回结果", async ({ page }) => {
  await page.goto("/");
  await selectCodexSource(page);
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

test("Pi 执行过程区分等待输入、完成工具与缺失时长", async ({ page }) => {
  await page.goto("/");
  await page.locator("#traceViewButton").click();
  await expect(page.locator(".trace-row").first()).toContainText("等待输入");

  for (let index = 0; index < 8 && await page.locator('.trace-row[data-trace-node-id]', { hasText: "bash" }).count() === 0; index += 1) {
    const toggles = page.locator("[data-trace-toggle-id]");
    if (await toggles.count() === 0) break;
    await toggles.last().click();
  }

  const tool = page.locator('.trace-row[data-trace-node-id]', { hasText: "bash" }).first();
  await expect(tool).toContainText("执行成功");
  await expect(page.locator(".trace-duration").filter({ hasText: "未记录" })).not.toContainText("估算");
  expect((await page.locator(".trace-duration").allTextContents()).join(" ")).not.toContain("est");
});
