import { expect, test } from "@playwright/test";
import { selectCodexSource } from "./source-helpers.mjs";

test("正文展示 Pi 压缩和 Skill 上下文事件，并可跳转原始记录", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#sessionTitle")).toHaveText("Pi 可切换会话");
  await expect(page.locator("#compactContent")).toContainText("检测到 Skill 指令块");
  await expect(page.locator("#compactContent")).toContainText("release-check");
  await expect(page.locator("#compactContent")).toContainText("检测到 Skill 定义读取记录");
  await expect(page.locator("#compactContent")).toContainText("工具结果成功");
  await expect(page.locator("#compactContent")).toContainText("Pi 上下文压缩");
  await expect(page.locator("#compactContent")).toContainText("保留当前任务、Skill 读取结果和验证结论。");
  await expect(page.locator("#compactContent")).not.toContainText("/workspace/pi-agent/.agents/skills/release-check");
  await page.locator("#compactContent .phase-skill-read [data-compact-event-index]").click();
  await expect(page.locator("#rawContent")).toContainText("pi-skill-output");
});

test("正文在每轮末尾展示上下文、生成 Token 和实际执行时长", async ({ page }) => {
  await page.goto("/");
  await selectCodexSource(page);
  const metrics = page.locator("#compactContent .compact-turn-metrics").first();
  await expect(metrics).toContainText("轮末上下文");
  await expect(metrics).toContainText("64.0K / 128.0K · 50%");
  await expect(metrics).toContainText("生成 Token");
  await expect(metrics).toContainText("400");
  await expect(metrics).toContainText("实际执行");
  await expect(metrics).toContainText("2.5 s");
  const desktopBody = await page.locator(".compact-thread.root > .compact-thread-body").evaluate((element) => {
    const body = element.getBoundingClientRect();
    const thread = element.parentElement.getBoundingClientRect();
    return { bodyWidth: body.width, bodyRight: body.right, threadRight: thread.right };
  });
  expect(desktopBody.bodyWidth).toBeGreaterThan(700);
  expect(Math.abs(desktopBody.bodyRight - desktopBody.threadRight)).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 390, height: 844 });
  const metricLayout = await metrics.locator(":scope > div").evaluateAll((items) => items.map((item) => {
    const rect = item.getBoundingClientRect();
    return { top: rect.top, right: rect.right, parentRight: item.parentElement.getBoundingClientRect().right };
  }));
  expect(metricLayout[1].top).toBeGreaterThan(metricLayout[0].top);
  expect(metricLayout.every((item) => item.right <= item.parentRight + 1)).toBe(true);
});

test("正文左侧固定高度时间线定位轮次并标记压缩和子代理调用", async ({ page }) => {
  await page.goto("/");
  const timeline = page.locator(".compact-timeline");
  await expect(timeline).toBeVisible();
  const layout = await timeline.evaluate((element) => {
    const main = element.parentElement.querySelector(".compact-main");
    return { timeline: element.getBoundingClientRect(), main: main.getBoundingClientRect() };
  });
  expect(layout.timeline.left).toBeLessThan(layout.main.left);
  expect(layout.timeline.height).toBeGreaterThan(300);
  const nodes = timeline.locator("[data-compact-timeline-target]");
  await expect(nodes).toHaveCount(2);
  await expect(nodes.nth(1)).toHaveClass(/has-compaction/);
  await expect(nodes.nth(1)).toHaveClass(/has-subagent/);
  await nodes.nth(1).click();
  await expect(nodes.nth(1)).toHaveAttribute("aria-current", "location");
  await nodes.nth(0).focus();
  await page.keyboard.press("ArrowDown");
  await expect(nodes.nth(1)).toBeFocused();
});

test("原始事件详情完整展示大型工具输出", async ({ page }) => {
  await page.goto("/");
  await selectCodexSource(page);
  await page.locator("#diagnosticViewButton").click();
  await page.locator("#rawViewButton").click();
  const outputEvent = page.locator('[data-raw-event-index="6"]');
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

test("正文、执行和诊断作为完整主工作区互斥切换", async ({ page }) => {
  await page.goto("/");
  await selectCodexSource(page);
  await expect(page.locator("#compactContent")).toBeVisible();
  await expect(page.locator("#executionWorkspace")).toBeHidden();
  await expect(page.locator("#diagnosticContent")).toBeHidden();
  await expect(page.locator(".compact-outline")).toHaveCount(0);
  await page.locator("#traceViewButton").click();
  await expect(page.locator("#compactContent")).toBeHidden();
  await expect(page.locator("#executionWorkspace")).toBeVisible();
  const rootTraceNode = page.locator('.trace-row[data-trace-node-id]', { hasText: "根会话" }).first();
  await rootTraceNode.click();
  await expect(page.locator("#toolDetailsContent")).toBeHidden();
  const traceTitle = page.locator(".trace-session-title");
  await expect(traceTitle).toBeVisible();
  expect(await traceTitle.evaluate((element) => element.ownerDocument.defaultView.getComputedStyle(element).fontWeight)).toBe("520");
  await expect(traceTitle.locator("strong")).toHaveCount(0);
  for (let index = 0; index < 8 && await page.locator('.trace-row[data-trace-node-id]', { hasText: "npm test" }).count() === 0; index += 1) {
    const toggles = page.locator("[data-trace-toggle-id]");
    if (await toggles.count() === 0) break;
    await toggles.last().click();
  }
  const tool = page.locator('.trace-row[data-trace-node-id]', { hasText: "npm test" }).first();
  await expect(tool).toContainText("npm test");
  await expect(tool).toContainText("执行成功");
  await tool.click();
  await expect(page.locator("#toolDetailsContent")).toContainText("调用参数");
  await expect(page.locator("#toolDetailsContent")).toContainText('"cmd": "npm test"');
  await expect(page.locator("#toolDetailsContent")).toContainText("返回结果");
  await expect(page.locator("#toolDetailsContent")).toContainText("FULL_TOOL_OUTPUT_END");
  await expect(page.locator("#toolDetailsContent .tool-details-status")).toHaveText("执行成功");

  await page.setViewportSize({ width: 390, height: 844 });
  const traceWidth = await page.locator(".trace-shell").evaluate((element) => ({ client: element.clientWidth, scroll: element.scrollWidth }));
  expect(traceWidth.scroll).toBeLessThanOrEqual(traceWidth.client);
  await expect(page.locator("#toolDetailsContent .tool-details-status")).toHaveText("执行成功");
  await page.locator("#diagnosticViewButton").click();
  await expect(page.locator("#executionWorkspace")).toBeHidden();
  await expect(page.locator("#diagnosticContent")).toBeVisible();
  await page.locator("#compactViewButton").click();
  await expect(page.locator("#compactContent")).toBeVisible();
});

test("摘要规则只替换执行树的工具节点名称", async ({ page }) => {
  await page.goto("/");
  await selectCodexSource(page);

  await page.locator("#diagnosticViewButton").click();
  await page.locator("#rawViewButton").click();
  const rawTool = page.locator('[data-raw-event-index="7"]');
  await expect(rawTool).toContainText("exec_command");
  await expect(rawTool).not.toContainText("读取文件内容");

  await page.locator("#traceViewButton").click();
  for (let index = 0; index < 8 && (await page.locator('.trace-row[data-trace-node-id]', { hasText: "cat README.md" }).count()) === 0; index += 1) {
    const toggles = page.locator("[data-trace-toggle-id]");
    if ((await toggles.count()) === 0) break;
    await toggles.last().click();
  }
  const traceTool = page.locator('.trace-row[data-trace-node-id]', { hasText: "cat README.md" }).first();
  await expect(traceTool.locator(".trace-title")).toHaveText("读取文件内容");
  await expect(traceTool).toContainText("cat README.md");
  await traceTool.click();
  await expect(page.locator("#toolDetailsContent h3")).toHaveText("exec_command");
  await expect(page.locator("#toolDetailsContent")).toContainText('"cmd": "cat README.md"');
});

test("诊断统计按工具目标汇总上下文占用", async ({ page }) => {
  await page.goto("/");
  await selectCodexSource(page);
  await page.locator("#diagnosticViewButton").click();

  await expect(page.locator(".context-diagnostic-section > .stats-diagnostic-section-head h3")).toHaveText("上下文统计诊断");
  await expect(page.locator(".timing-diagnostic-section > .stats-diagnostic-section-head h3")).toHaveText("时间统计诊断");
  const contextStats = page.locator(".tool-context-stats");
  await expect(contextStats).toContainText("已识别工具上下文");
  await expect(contextStats).not.toContainText("最近上下文窗口");
  await expect(contextStats).toContainText("返回结果");
  await expect(contextStats).not.toContainText("相对最近窗口");
  await expect(contextStats.locator(".tool-context-table")).toHaveCount(0);
  await expect(contextStats.locator("#toolContextQuery")).toHaveCount(0);
  await contextStats.locator("[data-tool-context-list-toggle]").click();
  await expect(contextStats).toContainText("读取文件内容");
  await expect(contextStats).toContainText("README.md");
  const verification = contextStats.locator(".tool-context-row", { hasText: "运行验证" });
  await expect(verification).toContainText("npm test");
  await expect(verification.locator(".tool-context-number").nth(1)).toContainText("KB");
  await page.locator("#toolContextQuery").fill("npm test");
  await expect(contextStats.locator(".tool-context-row:not(.header)")).toHaveCount(1);
  await expect(page.locator('#toolContextSort option[value="context-share"]')).toHaveCount(0);
  await page.locator("#toolContextSort").selectOption("max-output");
  await expect(page.locator("#toolContextSort")).toHaveValue("max-output");
  await page.setViewportSize({ width: 390, height: 844 });
  const layout = await contextStats.locator(".tool-context-table").evaluate((element) => ({ client: element.clientWidth, scroll: element.scrollWidth }));
  expect(layout.scroll).toBeLessThanOrEqual(layout.client);
  await expect(verification.locator(".tool-context-number").first()).toHaveAttribute("data-tool-context-label", "调用参数");
  await verification.locator("[data-tool-context-event-index]").click();
  await expect(page.locator("#rawContent .raw-preview")).toContainText("FULL_TOOL_OUTPUT_END");
});

test("事件统计在工具输出下按摘要规则汇总操作", async ({ page }) => {
  await page.goto("/");
  await selectCodexSource(page);
  await page.locator("#diagnosticViewButton").click();

  const table = page.locator(".stats-event-table");
  const toolOutput = table.locator(".stats-event-row", { hasText: "工具输出" }).first();
  await expect(toolOutput).toContainText("3");
  const operationRows = table.locator(".stats-event-operation-row");
  await expect(operationRows).toHaveCount(3);
  await expect(operationRows.filter({ hasText: "读取文件内容" })).toHaveCount(1);
  await expect(operationRows.filter({ hasText: "搜索文本" })).toHaveCount(1);
  await expect(operationRows.filter({ hasText: "运行验证" })).toHaveCount(1);
  const shareBarsMatchLabels = await table.locator(".stats-event-row:not(.header)").evaluateAll((rows) => rows.every((row) => {
    const bar = Number(row.style.getPropertyValue("--bar"));
    const label = Number(row.querySelector(".stats-event-share em").textContent.replace("%", ""));
    return bar === label;
  }));
  expect(shareBarsMatchLabels).toBe(true);
});

test("缺失窗口或轮次指标时不保留未记录占位", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#compactContent")).not.toContainText("轮末上下文");
  await expect(page.locator("#compactContent")).not.toContainText("生成 Token");
  await expect(page.locator("#compactContent")).not.toContainText("未记录");

  await page.locator("#diagnosticViewButton").click();
  const contextStats = page.locator(".tool-context-stats");
  await expect(contextStats).toContainText("已识别工具上下文");
  await expect(contextStats).not.toContainText("最近上下文窗口");
  await expect(contextStats).not.toContainText("相对最近窗口");
  await expect(contextStats).not.toContainText("未记录");
  await contextStats.locator("[data-tool-context-list-toggle]").click();
  await expect(page.locator('#toolContextSort option[value="context-share"]')).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  const layout = await contextStats.locator(".tool-context-table").evaluate((element) => ({ client: element.clientWidth, scroll: element.scrollWidth }));
  expect(layout.scroll).toBeLessThanOrEqual(layout.client);

  await page.locator("#traceViewButton").click();
  await expect(page.locator(".trace-tree")).not.toContainText("未记录");
});

test("Pi 执行过程区分等待输入、完成工具与缺失时长", async ({ page }) => {
  await page.goto("/");
  await page.locator("#traceViewButton").click();
  await page.locator("[data-trace-toggle-id]").nth(1).click();
  await expect(page.locator('.trace-row', { hasText: "等待输入" }).first()).toBeVisible();
  const tool = page.locator('.trace-row[data-trace-node-id]', { hasText: "bash" }).first();
  await expect(tool).toContainText("执行成功");
  await expect(page.locator(".trace-tree")).not.toContainText("未记录");
  expect((await page.locator(".trace-duration").allTextContents()).join(" ")).not.toContain("est");
});
