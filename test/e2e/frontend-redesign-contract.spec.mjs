import { expect, test } from "@playwright/test";

const sessionTitle = /(?:验证工作台的 Chromium 交互契约|确定性 Chromium 验证会话)/;

async function openWorkbench(page) {
  await page.goto("/");
  await expect(page.locator("#sessionTitle")).toHaveText(sessionTitle);
}

test("默认会话路径先给出派生交接结论，诊断保持二级语义", async ({ page }) => {
  await openWorkbench(page);
  const handoff = page.locator("#sessionHandoff");
  const diagnosticSwitch = page.locator("#diagnosticSwitch");
  await expect(handoff).toBeVisible();
  await expect(handoff.getByRole("button")).toHaveCount(7);
  await expect(handoff).toContainText("目标");
  await expect(handoff).toContainText("验证");
  await expect(handoff).toContainText("风险 / 缺口");
  await expect(page.locator(".view-switch [role=tab]")).toHaveCount(3);
  await expect(page.locator("#statsStrip")).toBeHidden();
  await expect(diagnosticSwitch).toBeHidden();
  await expect(diagnosticSwitch).toHaveJSProperty("inert", true);
  await expect(page.locator("#statsViewButton")).toHaveAttribute("tabindex", "-1");
  await expect(handoff.locator(".handoff-fact").nth(5)).toHaveAttribute("aria-label", /改动范围：.+/);
  await expect(handoff.locator(".handoff-copy em").first()).toHaveCSS("white-space", "normal");
  expect(await handoff.locator(".handoff-grid").evaluate((element) => globalThis.getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(2);

  await page.locator("#diagnosticViewButton").click();
  await expect(diagnosticSwitch).toBeVisible();
  await expect(diagnosticSwitch).toHaveJSProperty("inert", false);
  await expect(diagnosticSwitch.locator('[role=tab][aria-selected=true]')).toHaveCount(1);
  await expect(page.locator("#diagnosticContent")).toBeVisible();
  await expect(page.locator("#statsContent")).toBeVisible();
  await expect(page.locator("#statsContent .timing-section")).toContainText("会话时间花在哪里");
  await expect(page.locator("#statsContent .timing-bucket").filter({ hasText: "工具执行" })).toHaveCount(1);
  await expect(page.locator("#statsContent .timing-bucket").filter({ hasText: "LLM 响应" })).toHaveCount(1);
  await page.locator("#rawViewButton").click();
  await expect(page.locator("#rawContent")).toBeVisible();
  await expect(diagnosticSwitch.locator('[role=tab][aria-selected=true]')).toHaveCount(1);
  await page.locator("#auditViewButton").click();
  await expect(diagnosticSwitch).toBeHidden();
  await expect(diagnosticSwitch).toHaveJSProperty("inert", true);
});

test("证据刻度在会话、复盘和复核对象之间保留结构定位", async ({ page }) => {
  await openWorkbench(page);
  await page.locator('[data-session-id="88888888-8888-4888-8888-888888888888"]').click();
  const sessionEvidenceId = await page.locator("#sessionList .session-row[aria-current=true]").getAttribute("data-evidence-id");
  expect(sessionEvidenceId).toMatch(/^source:[^|]+\|session:[^|]+\|thread:root\|object:session$/);
  await expect(page.locator("#compactContent [data-evidence-id]").first()).toHaveAttribute("data-evidence-id", sessionEvidenceId);
  const compactTurn = page.locator('#compactContent [data-evidence-id*="|object:turn"]').first();
  const compactTurnEvidenceId = await compactTurn.getAttribute("data-evidence-id");
  expect(compactTurnEvidenceId).toMatch(/\|thread:root\|turn:1\|object:turn$/);

  await page.locator("#auditViewButton").click();
  const firstTurn = page.locator("#auditContent [data-audit-turn-key]").first();
  await firstTurn.click();
  await expect(page.locator("#auditContent .audit-turn.selected")).toHaveAttribute("data-evidence-id", compactTurnEvidenceId);
  await expect(page.locator("#sessionDetails .review-object-head")).toHaveAttribute("data-evidence-id", compactTurnEvidenceId);

  await page.locator("#diagnosticViewButton").click();
  await page.locator("#rawViewButton").click();
  const rawEvent = page.locator("#rawContent [data-raw-event-index]").first();
  const rawEventEvidenceId = await rawEvent.getAttribute("data-evidence-id");
  expect(rawEventEvidenceId).toMatch(/^source:[^|]+\|session:[^|]+\|thread:root\|event:\d+\|object:event$/);
  await rawEvent.click();
  await expect(page.locator("#sessionDetails .review-object-head")).toHaveAttribute("data-evidence-id", rawEventEvidenceId);
});

test("1024 复核台按需打开后保留对象标题和键盘滚动入口", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  await openWorkbench(page);
  await page.locator('[data-session-id="88888888-8888-4888-8888-888888888888"]').click();
  const toggle = page.locator("#toggleRight");
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#inspectorPanel")).toBeVisible();
  await expect(page.locator("#selectionDetails")).toBeFocused();
  await expect(page.locator("#selectionDetails")).toHaveAttribute("tabindex", "0");
  await expect(page.locator("#selectionDetails")).toHaveAttribute("aria-label", /Page Up\/Page Down/);
  const context = page.locator("#sessionDetails");
  await expect(context).toHaveAttribute("tabindex", "0");
  await expect(context).toHaveAttribute("aria-label", /当前复核对象.*Page Up\/Page Down/);
  await expect(context.locator(".review-object-title")).toContainText("Chromium 标题前缀");
  const contextMetrics = await context.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    scrollTop: element.scrollTop,
  }));
  expect(contextMetrics.clientHeight).toBeGreaterThan(44);
  expect(contextMetrics.scrollHeight).toBeGreaterThan(contextMetrics.clientHeight);
  await context.focus();
  await expect(context).toBeFocused();
  await page.keyboard.press("PageDown");
  await expect.poll(() => context.evaluate((element) => element.scrollTop)).toBeGreaterThan(contextMetrics.scrollTop);

  const [tabsBox, selectionBox] = await Promise.all([
    page.locator("#reviewTabs").boundingBox(),
    page.locator("#selectionDetails").boundingBox(),
  ]);
  expect(tabsBox.y).toBeGreaterThanOrEqual(0);
  expect(tabsBox.y + tabsBox.height).toBeLessThanOrEqual(800);
  expect(selectionBox.height).toBeGreaterThanOrEqual(64);
  expect(await page.locator("#selectionDetails").evaluate((element) => globalThis.getComputedStyle(element).overflowY)).toBe("auto");
  await page.locator("#selectionDetails").focus();
  await expect(page.locator("#selectionDetails")).toBeFocused();
});

test("减少动画偏好不会保留工作台过渡", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await openWorkbench(page);
  await expect(page.locator("body")).toHaveCSS("color", "rgb(245, 245, 247)");
  const transitionDuration = await page.locator("#toast").evaluate((element) => globalThis.getComputedStyle(element).transitionDuration);
  expect(Number.parseFloat(transitionDuration)).toBeLessThanOrEqual(0.01);
  await page.locator('[data-session-id="88888888-8888-4888-8888-888888888888"]').click();
  await page.locator("#compactContent [data-compact-nav-target]").first().click();
  await expect(page.locator("#compactContent")).toBeVisible();
});

test("输出浅深色三视口审阅图", async ({ page }) => {
  const viewports = [
    [1440, 900],
    [1024, 800],
    [390, 844],
  ];
  for (const colorScheme of ["light", "dark"]) {
    for (const [width, height] of viewports) {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.setViewportSize({ width, height });
      await openWorkbench(page);
      if (width === 390) await page.locator("[data-panel-target=sessions]").click();
      await page.locator('[data-session-id="88888888-8888-4888-8888-888888888888"]').click();
      if (width === 1024) await page.locator("#toggleRight").click();
      await expect(page.locator("#sessionTitle")).toContainText("Chromium 标题前缀");
      if (width === 1024) {
        const [tabsBox, selectionBox] = await Promise.all([
          page.locator("#reviewTabs").boundingBox(),
          page.locator("#selectionDetails").boundingBox(),
        ]);
        expect(tabsBox.y).toBeGreaterThanOrEqual(0);
        expect(tabsBox.y + tabsBox.height).toBeLessThanOrEqual(height);
        expect(selectionBox.height).toBeGreaterThanOrEqual(64);
        expect(await page.locator("#sessionDetails").evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
      }
      await page.screenshot({ path: `test-results/frontend-redesign-review/${colorScheme}-${width}x${height}.png`, fullPage: false });
      expect(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth)).toBe(true);
    }
  }
});