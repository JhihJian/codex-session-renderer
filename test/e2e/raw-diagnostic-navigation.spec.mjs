import { expect, test } from "@playwright/test";

const sessionId = "33333333-3333-4333-8333-333333333333";
const alternateSessionId = "77777777-7777-4777-8777-777777777777";
const sessionTitle = /(?:验证工作台的 Chromium 交互契约|确定性 Chromium 验证会话)/;

async function openRawDiagnostic(page) {
  await page.locator("#diagnosticViewButton").click();
  await page.locator("#rawViewButton").click();
}

async function openRawSource(page) {
  await page.goto("/");
  await expect(page.locator("#sessionTitle")).toHaveText(sessionTitle);
  await openRawDiagnostic(page);
  await page.locator("#rawContent [data-raw-event-index]").first().click();
  await page.locator("#reviewTabs [data-review-tab=source]").click();
}

async function captureUnhandledRejections(page) {
  await page.addInitScript(() => {
    globalThis.__rawDiagnosticNavigationUnhandledRejections = [];
    globalThis.addEventListener("unhandledrejection", (event) => {
      globalThis.__rawDiagnosticNavigationUnhandledRejections.push(String(event.reason?.message || event.reason));
      event.preventDefault();
    });
  });
}

async function expectNoUnhandledRejections(page) {
  await expect.poll(() => page.evaluate(() => globalThis.__rawDiagnosticNavigationUnhandledRejections)).toEqual([]);
}

async function delayRawSourceRead(page) {
  let releaseRead;
  const readReleased = new Promise((resolve) => {
    releaseRead = resolve;
  });
  await page.route(`**/api/sources/local/sessions/${sessionId}/events/*`, async (route) => {
    await readReleased;
    await route.continue().catch(() => {});
  });
  return { releaseRead };
}

async function startRawSourceRead(page) {
  const rawRead = page.waitForRequest((request) => request.url().includes(`/api/sources/local/sessions/${sessionId}/events/`));
  await page.locator("#selectionDetails [data-review-source]").click();
  await rawRead;
}

async function releaseAndAssertNoStalePreview(page, releaseRead) {
  releaseRead();
  await page.evaluate(() => new Promise((resolve) => {
    globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve));
  }));
  await expect(page.locator("#selectionDetails")).not.toContainText("读取完整事件失败");
  await expectNoUnhandledRejections(page);
}

test("切换数据源会失效延迟来源展开，不向新来源写入旧预览", async ({ page }) => {
  await captureUnhandledRejections(page);
  const { releaseRead } = await delayRawSourceRead(page);
  await openRawSource(page);
  await startRawSourceRead(page);
  await page.locator("#sourceSelect").selectOption("pi-agent");
  await expect(page.locator("#sourceSelect")).toHaveValue("pi-agent");
  await releaseAndAssertNoStalePreview(page, releaseRead);
});

test("切换会话会失效延迟来源展开，不向新会话写入旧预览", async ({ page }) => {
  await captureUnhandledRejections(page);
  const { releaseRead } = await delayRawSourceRead(page);
  await openRawSource(page);
  await startRawSourceRead(page);
  await page.locator(`[data-session-id="${alternateSessionId}"]`).click();
  await expect(page.locator(`[data-session-id="${alternateSessionId}"]`)).toHaveAttribute("aria-current", "true");
  await releaseAndAssertNoStalePreview(page, releaseRead);
});

test("移动端离开复核台会取消来源展开且迟到响应不写入失败提示", async ({ page }) => {
  await captureUnhandledRejections(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const { releaseRead } = await delayRawSourceRead(page);
  await page.goto("/");
  await expect(page.locator("#sessionTitle")).toHaveText(sessionTitle);
  await openRawDiagnostic(page);
  await page.locator("#rawContent [data-raw-event-index]").first().click();
  await page.locator("[data-panel-target=inspector]").click();
  await page.locator("#reviewTabs [data-review-tab=source]").click();
  await startRawSourceRead(page);
  await page.locator("[data-panel-target=thread]").click();
  await expect(page.locator("#inspectorPanel")).toHaveAttribute("aria-hidden", "true");
  releaseRead();
  await page.evaluate(() => new Promise((resolve) => {
    globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve));
  }));

  await expect(page.locator("#selectionDetails")).not.toContainText("读取完整事件失败");
  await expect(page.locator("#selectionDetails")).not.toContainText("会话已切换");
  await expectNoUnhandledRejections(page);
});