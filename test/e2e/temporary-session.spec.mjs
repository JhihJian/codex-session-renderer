import { expect, test } from "@playwright/test";
import { sessionId } from "./fixture-session.mjs";

test("可临时打开本机指定 JSONL 会话", async ({ page }) => {
  const health = await (await page.request.get("/api/health")).json();
  const codexHome = health.sources.find((source) => source.id === "local").codexHome;
  const filePath = `${codexHome}/sessions/isolated/rollout-2025-01-02T03-04-05-${sessionId}.jsonl`;

  await page.goto("/");
  await page.locator(".topbar-more summary").click();
  await page.getByRole("button", { name: "打开本机会话" }).click();
  await page.locator("#temporarySessionPath").fill(filePath);
  await page.getByRole("button", { name: "打开", exact: true }).click();

  await expect(page.locator("#sourceSelect")).toHaveValue("temporary");
  await expect(page.locator("#sessionTitle")).toContainText("验证工作台的 Chromium 交互契约");
  await expect(page.locator("#liveModeToggle")).toBeDisabled();

  await page.locator(".topbar-more summary").click();
  await page.locator("#diagnosticViewButton").click();
  await page.locator("#rawViewButton").click();
  await expect(page.locator("#rawContent")).toContainText("session_meta");
});