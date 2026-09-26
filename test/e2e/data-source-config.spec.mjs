import { expect, test } from "@playwright/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function createOverrideRoot(label) {
  const root = await mkdtemp(path.join(os.tmpdir(), `csr-e2e-ds-${label}-`));
  const sessionsRoot = path.join(root, "sessions");
  await mkdir(sessionsRoot, { recursive: true });
  const sessionId = `${label}-pi-session`;
  await writeFile(
    path.join(sessionsRoot, `2026-07-20T00-00-00-000Z_${sessionId}.jsonl`),
    `${[
      { type: "session", version: 3, id: `${label}-id`, timestamp: new Date().toISOString(), cwd: `/workspace/${label}` },
      { type: "message", id: `${label}-user`, timestamp: new Date().toISOString(), message: { role: "user", content: [{ type: "text", text: `界面切换数据源后的会话 ${label}` }] } },
    ].map((event) => JSON.stringify(event)).join("\n")}\n`,
    "utf8",
  );
  return { root, sessionsRoot, sessionId };
}

async function describeConfig(request) {
  return (await (await request.get("/api/data-source-config")).json());
}

async function putConfig(request, piAgentRoot) {
  const response = await request.put("/api/data-source-config", { data: { piAgentRoot } });
  expect(response.status()).toBe(200);
  return response.json();
}

async function openDataSourceSettingsTab(page) {
  await page.locator(".topbar-more summary").click();
  await page.locator("#settingsButton").click();
  await page.locator("#settingsTabs [data-settings-view='dataSource']").click();
}

async function saveDataSourceFromPanel(page) {
  await page.getByRole("button", { name: "保存数据源" }).click();
  await expect(page.locator("#settingsDialog")).not.toBeVisible();
}

test("设置页可切换 Pi 会话根，取消不落盘", async ({ page, request }) => {
  const config = await describeConfig(request);
  expect(config.configPath).toBeTruthy();
  expect(config.override).toBeNull();
  const envDefault = config.envDefault;

  const first = await createOverrideRoot("first");
  const second = await createOverrideRoot("second");
  test.setTimeout(30_000);
  try {
    await page.goto("/");
    await expect(page.locator("#sourceSelect")).toHaveValue("pi-agent");

    await openDataSourceSettingsTab(page);
    await expect(page.locator("#dataSourceConfigBody")).toContainText("环境默认");
    await expect(page.locator("#dataSourceConfigBody")).toContainText(envDefault.path);
    await page.locator("[data-data-source-field='path']").fill(first.sessionsRoot);
    await saveDataSourceFromPanel(page);

    await expect(page.locator(".session-row")).toHaveCount(1);
    await expect(page.locator(".session-row").first()).toContainText("界面切换数据源后的会话 first");
    expect((await (await request.get("/api/health")).json()).sessionsRoot).toBe(first.sessionsRoot);
    expect((await describeConfig(request)).override).toEqual({ type: "sessions", path: first.sessionsRoot });

    await openDataSourceSettingsTab(page);
    await expect(page.locator("#dataSourceConfigBody")).toContainText("覆盖生效");
    await page.locator("[data-data-source-field='path']").fill(second.sessionsRoot);
    await page.getByRole("button", { name: "取消" }).click();
    expect((await describeConfig(request)).override).toEqual({ type: "sessions", path: first.sessionsRoot });

    await openDataSourceSettingsTab(page);
    await page.getByRole("button", { name: "恢复环境变量默认" }).click();
    await saveDataSourceFromPanel(page);

    await expect(page.locator(".session-row").filter({ hasText: "Pi 可切换会话" })).toHaveCount(1);
    expect((await (await request.get("/api/health")).json()).sessionsRoot).toBe(envDefault.path);
    expect((await describeConfig(request)).override).toBeNull();
  } finally {
    await putConfig(request, null).catch(() => {});
    await rm(first.root, { recursive: true, force: true });
    await rm(second.root, { recursive: true, force: true });
  }
});
