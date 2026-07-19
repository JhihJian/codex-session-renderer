import { expect, test } from "@playwright/test";

async function expectVisibleUsableFocus(page, expectedId) {
  await expect.poll(() => page.evaluate(() => globalThis.document.activeElement?.id)).toBe(expectedId);
  expect(await page.evaluate(() => {
    const element = globalThis.document.activeElement;
    if (!element) return false;
    const style = globalThis.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && !element.inert && element.getAttribute("aria-hidden") !== "true" && !element.matches(":disabled");
  })).toBe(true);
}

test("inspector 调整条跨 1280 和移动断点时把焦点交给可见入口", async ({ page }) => {
  await page.setViewportSize({ width: 1281, height: 844 });
  await page.goto("/");
  await page.locator("#inspectorResizer").focus();
  await expectVisibleUsableFocus(page, "inspectorResizer");

  await page.setViewportSize({ width: 1280, height: 844 });
  await expectVisibleUsableFocus(page, "toggleRight");

  await page.setViewportSize({ width: 820, height: 844 });
  await expectVisibleUsableFocus(page, "mobileThreadTab");
});
