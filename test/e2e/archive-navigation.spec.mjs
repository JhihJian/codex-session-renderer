import { expect, test } from "@playwright/test";

const sessionId = "33333333-3333-4333-8333-333333333333";
const piGoalSessionId = "66666666-6666-4666-8666-666666666666";
const codexGoalSessionId = "77777777-7777-4777-8777-777777777777";

function promptResponse() {
  return {
    source: { id: "local", label: "本机 Codex Home", kind: "local" },
    scope: "recent24h",
    entries: [{
      id: `local:${sessionId}`,
      sourceId: "local",
      sourceLabel: "本机 Codex Home",
      sessionId,
      sessionTitle: "归档打开会话",
      cwd: "/workspace/chromium-contract",
      projectKey: "local:/workspace/chromium-contract",
      projectLabel: "/workspace/chromium-contract",
      promptState: "found",
      promptText: "保持复核面板",
      promptPreview: "保持复核面板",
      promptEventIndex: 2,
      updatedAt: "2025-01-02T03:04:11.000Z",
    }],
    projects: [],
    page: { candidateFrom: 1, candidateTo: 1, candidatesScanned: 1, entriesReturned: 1, limit: 200, hasMoreCandidates: false, nextPageToken: null },
  };
}

test("桌面任务归档隔离不可见复核台，并恢复进入前的开闭状态", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#sessionTitle")).toContainText("确定性 Chromium 验证会话");
  const inspector = page.locator("#inspectorPanel");
  const reviewSummary = page.locator("#reviewTabSummary");
  const toggle = page.locator("#toggleRight");

  await reviewSummary.focus();
  await page.locator("#promptsModeButton").click();
  await expect(inspector).toHaveJSProperty("inert", true);
  await expect(inspector).toHaveAttribute("aria-hidden", "true");
  await expect(toggle).toBeDisabled();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(await reviewSummary.evaluate((element) => {
    element.focus();
    return globalThis.document.activeElement?.id;
  })).not.toBe("reviewTabSummary");

  await page.locator("#sessionsModeButton").click();
  await expect(inspector).toHaveJSProperty("inert", false);
  await expect(inspector).not.toHaveAttribute("aria-hidden");
  await expect(toggle).toBeEnabled();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(await reviewSummary.evaluate((element) => {
    element.focus();
    return globalThis.document.activeElement?.id;
  })).toBe("reviewTabSummary");

  await toggle.click();
  await expect(inspector).toHaveJSProperty("inert", true);
  await page.locator("#promptsModeButton").click();
  await page.locator("#sessionsModeButton").click();
  await expect(toggle).toBeEnabled();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(inspector).toHaveJSProperty("inert", true);
});

test("内容类型筛选在各主视图保留稳定可访问名称", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#sessionTitle")).toContainText("确定性 Chromium 验证会话");
  const filter = page.getByLabel("内容类型筛选", { exact: true });
  await expect(filter).toHaveValue("all");
  for (const viewId of ["auditViewButton", "statsViewButton", "rawViewButton", "compactViewButton"]) {
    await page.locator(`#${viewId}`).click();
    await expect(filter).toHaveAccessibleName("内容类型筛选");
  }
});

test("来源切换后过期远端刷新不会污染当前来源或导航状态", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#sessionTitle")).toContainText("确定性 Chromium 验证会话");
  await page.locator("#sourceSelect").selectOption("office");
  await expect(page.locator("#refreshRemoteButton")).toBeVisible();

  let releaseRefresh;
  const refreshStarted = new Promise((resolve) => {
    releaseRefresh = resolve;
  });
  let beginRefresh;
  const refreshCanFinish = new Promise((resolve) => {
    beginRefresh = resolve;
  });
  await page.route("**/api/sources/office/refresh", async (route) => {
    releaseRefresh();
    await refreshCanFinish;
    await route.fulfill({ json: {
      source: {
        id: "office",
        label: "过期刷新不得写入来源缓存",
        kind: "remote",
        status: { refreshable: true, snapshotAvailable: true },
      },
    } });
  });

  await page.locator("#refreshRemoteButton").click();
  await refreshStarted;
  await page.locator("#sourceSelect").selectOption("local");
  await expect(page.locator("#sourceSelect")).toHaveValue("local");
  beginRefresh();
  await expect(page.locator("#sessionTitle")).toContainText("确定性 Chromium 验证会话");
  await expect(page.locator("#workbenchOperationStatus")).not.toContainText("远端快照已拉取到本机缓存");
  await expect(page.locator("#sourceSelect").locator("option[value=office]")).not.toContainText("过期刷新不得写入来源缓存");
});

test("同一远端来源的导航变化会丢弃刷新结果但恢复刷新入口", async ({ page }) => {
  await page.goto("/");
  await page.locator("#sourceSelect").selectOption("office");
  let releaseRefresh;
  const refreshStarted = new Promise((resolve) => {
    releaseRefresh = resolve;
  });
  let allowRefresh;
  const refreshFinished = new Promise((resolve) => {
    allowRefresh = resolve;
  });
  await page.route("**/api/sources/office/refresh", async (route) => {
    releaseRefresh();
    await refreshFinished;
    await route.fulfill({ json: {
      ok: true,
      source: { id: "office", label: "过期结果不能写回", kind: "remote", status: { refreshable: true, snapshotAvailable: true } },
    } });
  });

  await page.locator("#refreshRemoteButton").click();
  await refreshStarted;
  await page.locator("#auditViewButton").click();
  await page.locator("#statsViewButton").click();
  await page.locator("#rawViewButton").click();
  await page.locator("#reviewTabEvidence").click();
  allowRefresh();

  await expect(page.locator("#refreshRemoteButton")).toBeEnabled();
  await expect(page.locator("#refreshRemoteButton")).toHaveText("拉取远端快照");
  await expect(page.locator("#sessionsPanel")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#sourceStatus")).toContainText("拉取已取消，可再次拉取");
  await expect(page.locator("#workbenchOperationStatus")).toContainText("远端快照拉取已取消，可再次拉取");
  await expect(page.locator("#workbenchOperationStatus")).not.toContainText("远端快照已拉取到本机缓存");
  await expect(page.locator("#sourceSelect").locator("option[value=office]")).not.toContainText("过期结果不能写回");
});

test("刷新成功响应缺少来源标识时失败关闭并恢复再次拉取", async ({ page }) => {
  await page.goto("/");
  await page.locator("#sourceSelect").selectOption("office");
  await page.route("**/api/sources/office/refresh", async (route) => {
    await route.fulfill({ json: { ok: true } });
  });

  await page.locator("#refreshRemoteButton").click();
  await expect(page.locator("#refreshRemoteButton")).toBeEnabled();
  await expect(page.locator("#refreshRemoteButton")).toHaveText("拉取远端快照");
  await expect(page.locator("#sessionsPanel")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#sourceStatus")).toContainText("拉取失败：来源响应校验失败，请重试。可再次拉取");
  await expect(page.locator("#workbenchOperationStatus")).not.toContainText("远端快照已拉取到本机缓存");
});

test("从归档打开会话后，详情响应不会覆盖用户后续的移动复核导航", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("#sessionTitle")).toContainText("确定性 Chromium 验证会话");
  await page.route("**/api/sources/local/prompts?*", async (route) => route.fulfill({ json: promptResponse() }));
  let releaseDetail;
  const detailRelease = new Promise((resolve) => {
    releaseDetail = resolve;
  });
  await page.route(`**/api/sources/local/sessions/${sessionId}*`, async (route) => {
    await detailRelease;
    await route.continue();
  });

  await page.locator("[data-panel-target=sessions]").click();
  await page.locator("#promptsModeButton").click();
  const requestedDetail = page.waitForRequest(`**/api/sources/local/sessions/${sessionId}*`);
  await page.locator("[data-prompt-session-id]").click();
  await requestedDetail;
  await page.locator("[data-panel-target=inspector]").click();
  releaseDetail();
  await expect(page.locator("#sessionDetails")).not.toContainText("任务归档未打开会话");
  await expect(page.locator("#appShell")).toHaveAttribute("data-panel", "inspector");
});

test("移动端归档响应在复核导航后会取消并提供重新整理入口", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  let releaseArchive;
  const archiveStarted = new Promise((resolve) => {
    releaseArchive = resolve;
  });
  let allowArchive;
  const archiveCanFinish = new Promise((resolve) => {
    allowArchive = resolve;
  });
  let calls = 0;
  await page.route("**/api/sources/local/prompts?*", async (route) => {
    calls += 1;
    if (calls === 1) {
      releaseArchive();
      await archiveCanFinish;
      await route.fulfill({ json: promptResponse() });
      return;
    }
    await route.fulfill({ json: promptResponse() });
  });

  await page.locator("[data-panel-target=sessions]").click();
  await page.locator("#promptsModeButton").click();
  await archiveStarted;
  await page.locator("[data-panel-target=inspector]").click();
  await page.locator("#reviewTabEvidence").click();
  allowArchive();

  await expect(page.locator("#promptArchiveContent")).toHaveAttribute("aria-busy", "false");
  await page.locator("[data-panel-target=thread]").click();
  await expect(page.locator("#promptArchiveContent")).toContainText("任务归档读取已取消");
  const retry = page.locator("#promptArchiveContent [data-session-empty-action=retry-prompts]");
  await expect(retry).toHaveText("重新整理");
  await expect(page.locator("#promptArchiveContent")).not.toContainText("任务归档读取失败");
  await retry.click();
  await expect(page.locator("#promptArchiveContent")).toContainText("保持复核面板");
  expect(calls).toBe(2);
});

test("Pi 大会话在有界前缀找到首任务后可搜索和按项目筛选", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#sessionTitle")).toHaveText(/(?:验证工作台的 Chromium 交互契约|确定性 Chromium 验证会话)/);
  await page.locator("#sourceSelect").selectOption("pi-agent");
  await page.locator("#promptsModeButton").click();
  await expect(page.locator("#promptArchiveContent")).toContainText("Pi 大会话前缀任务可被归档");
  await expect(page.locator("#promptArchiveContent")).toContainText("未命名会话");
  await page.locator("#promptArchiveSearch").fill("前缀任务");
  await expect(page.locator("#promptArchiveContent")).toContainText("Pi 大会话前缀任务可被归档");
  await page.locator('[data-prompt-project="pi-agent:/workspace/pi-agent-large"]').click();
  await expect(page.locator("#promptArchiveContent")).toContainText("Pi 大会话前缀任务可被归档");
  await expect(page.locator("#promptArchiveContent")).not.toContainText("Pi 来源可读会话");
});

test("Pi Goal 默认视图投影目标而原始单事件仍保留控制包", async ({ page }) => {
  await page.goto("/");
  await page.locator("#sourceSelect").selectOption("pi-agent");
  await page.locator(`[data-session-id="${piGoalSessionId}"]`).click();
  await expect(page.locator("#compactContent")).toContainText("Pi Goal 默认阅读只显示这个目标");
  await expect(page.locator("#compactContent")).not.toContainText("goal_id");
  await expect(page.locator("#compactContent")).not.toContainText("Goal-mode rules:");
  await page.locator("#auditViewButton").click();
  await expect(page.locator("#auditContent")).toContainText("Pi Goal 默认阅读只显示这个目标");
  await expect(page.locator("#auditContent")).not.toContainText("goal_id");

  const raw = await page.request.get(`/api/sources/pi-agent/sessions/${piGoalSessionId}/events/2`);
  await expect(raw).toBeOK();
  await expect(await raw.text()).toContain("goal_id");
});

test("Codex Goal 列表标题和默认阅读投影目标，Raw 单事件保留完整控制包", async ({ page }) => {
  await page.goto("/");
  const row = page.locator(`[data-session-id="${codexGoalSessionId}"]`);
  await expect(row).toContainText("Codex Goal 默认阅读只显示这个真实目标");
  await expect(row).not.toContainText("<codex_internal_context");
  await row.click();
  await expect(page.locator("#sessionTitle")).toContainText("Codex Goal 默认阅读只显示这个真实目标");
  await expect(page.locator("#compactContent")).toContainText("Codex Goal 默认阅读只显示这个真实目标");
  await expect(page.locator("#compactContent")).not.toContainText("Tokens remaining: unbounded");
  await page.locator("#auditViewButton").click();
  await expect(page.locator("#auditContent")).toContainText("Codex Goal 默认阅读只显示这个真实目标");
  await expect(page.locator("#auditContent")).not.toContainText("<codex_internal_context");

  const raw = await page.request.get(`/api/sources/local/sessions/${codexGoalSessionId}/events/3`);
  await expect(raw).toBeOK();
  await expect((await raw.json()).raw.payload.content[0].text).toContain('<codex_internal_context source="goal">');
});