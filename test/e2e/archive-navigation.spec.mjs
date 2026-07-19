import { expect, test } from "@playwright/test";

const sessionId = "33333333-3333-4333-8333-333333333333";
const longTitleSessionId = "88888888-8888-4888-8888-888888888888";
const piGoalSessionId = "66666666-6666-4666-8666-666666666666";
const codexGoalSessionId = "77777777-7777-4777-8777-777777777777";

function promptResponse(prompt = "保持复核面板") {
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
      promptText: prompt,
      promptPreview: prompt,
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

test("列表刷新会失效同来源归档批次，重新进入只显示新结果", async ({ page }) => {
  await page.goto("/");
  let promptRequests = 0;
  await page.route("**/api/sources/local/prompts?*", async (route) => {
    promptRequests += 1;
    await route.fulfill({ json: promptResponse(promptRequests === 1 ? "刷新前归档任务" : "刷新后归档任务") });
  });

  await page.locator("#promptsModeButton").click();
  await expect(page.locator("#promptArchiveContent")).toContainText("刷新前归档任务");
  await page.locator("#sessionsModeButton").click();
  const refreshed = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname === "/api/sources/local/sessions" && url.searchParams.get("scope") === "recent24h";
  });
  await page.locator("#refreshButton").click();
  await refreshed;
  await expect(page.locator("#refreshButton")).toBeEnabled();

  const reloadedArchive = page.waitForRequest("**/api/sources/local/prompts?*");
  await page.locator("#promptsModeButton").click();
  await reloadedArchive;
  await expect(page.locator("#promptArchiveContent")).toContainText("刷新后归档任务");
  await expect(page.locator("#promptArchiveContent")).not.toContainText("刷新前归档任务");
  expect(promptRequests).toBe(2);
});

test("移动端筛选只更新列表，用户显式激活后才打开另一会话", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("#sessionTitle")).toContainText("确定性 Chromium 验证会话");
  await expect(page.locator("#compactContent")).toContainText("会话详情超过读取上限");
  await expect(page.locator(`[data-session-id="${sessionId}"]`)).toHaveAttribute("aria-current", "true");
  await page.locator("[data-panel-target=sessions]").click();
  const filteredResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/sources/local/sessions" && url.searchParams.get("q") === "CHROMIUM_LONG_TITLE_SUFFIX";
  });
  await page.locator("#sessionSearch").fill("CHROMIUM_LONG_TITLE_SUFFIX");
  await filteredResponse;
  await expect(page.locator("#sessionCount")).toHaveText("1");
  const longTitleRow = page.locator(`[data-session-id="${longTitleSessionId}"]`);
  await expect(longTitleRow).toBeVisible();
  await expect(longTitleRow).not.toHaveAttribute("aria-current");
  await expect(page.locator("#appShell")).toHaveAttribute("data-panel", "sessions");
  await expect(page.locator("#sessionTitle")).toContainText("确定性 Chromium 验证会话");
  await expect(page.locator("#sessionFilterNotice")).not.toHaveAttribute("hidden");

  await longTitleRow.click();
  await expect(page.locator("#appShell")).toHaveAttribute("data-panel", "thread");
  await expect(page.locator("#sessionTitle")).toContainText("Chromium 标题前缀");
});

test("本机更早会话失败可真实重试 history，并保持当前 recent 详情", async ({ page }) => {
  let historyRequests = 0;
  await page.route("**/api/sources/local/sessions?*", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("scope") !== "history") {
      await route.continue();
      return;
    }
    historyRequests += 1;
    expect(url.searchParams.get("q")).toBe("历史重试");
    if (historyRequests === 1) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "历史索引暂不可用" }) });
      return;
    }
    await route.fulfill({ json: {
      source: { id: "local", label: "本机 Codex Home", kind: "local" },
      scope: "history",
      sessions: [{
        id: "history-retry-session",
        sourceId: "local",
        displayTitle: "历史重试目标",
        updatedAt: "2020-01-02T03:04:11.000Z",
        cwd: "/workspace/history-retry",
      }],
    } });
  });
  await page.goto("/");
  await expect(page.locator("#sessionTitle")).toContainText("确定性 Chromium 验证会话");
  const searched = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname === "/api/sources/local/sessions" && url.searchParams.get("scope") === "recent24h" && url.searchParams.get("q") === "历史重试";
  });
  await page.locator("#sessionSearch").fill("历史重试");
  await searched;
  await page.locator("#sessionTimeFilter [data-session-time=earlier]").click();
  await expect(page.locator("[data-session-empty-action=retry-history]")).toHaveText("重试更早会话");
  await page.locator("[data-session-empty-action=retry-history]").click();
  await expect(page.locator('[data-session-id="history-retry-session"]')).toBeVisible();
  await expect(page.locator("#sessionTitle")).toContainText("确定性 Chromium 验证会话");
  expect(historyRequests).toBe(2);
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

test("普通会话迟到详情不会覆盖用户后续的移动复核导航", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  let releaseDetail;
  const detailRelease = new Promise((resolve) => {
    releaseDetail = resolve;
  });
  await page.route(`**/api/sources/local/sessions/${longTitleSessionId}*`, async (route) => {
    await detailRelease;
    await route.continue();
  });

  await page.locator("[data-panel-target=sessions]").click();
  const requestedDetail = page.waitForRequest(`**/api/sources/local/sessions/${longTitleSessionId}*`);
  await page.locator(`[data-session-id="${longTitleSessionId}"]`).click();
  await requestedDetail;
  await expect(page.locator("#appShell")).toHaveAttribute("data-panel", "thread");
  await page.locator("[data-panel-target=inspector]").click();
  releaseDetail();

  await expect(page.locator("#threadPanel")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#compactContent")).toContainText("Chromium 长标题详情");
  await expect(page.locator("#appShell")).toHaveAttribute("data-panel", "inspector");
});

test("普通会话详情完成后保持内容面板", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  let releaseDetail;
  const detailRelease = new Promise((resolve) => {
    releaseDetail = resolve;
  });
  await page.route(`**/api/sources/local/sessions/${longTitleSessionId}*`, async (route) => {
    await detailRelease;
    await route.continue();
  });

  await page.locator("[data-panel-target=sessions]").click();
  const requestedDetail = page.waitForRequest(`**/api/sources/local/sessions/${longTitleSessionId}*`);
  await page.locator(`[data-session-id="${longTitleSessionId}"]`).click();
  await requestedDetail;
  await expect(page.locator("#appShell")).toHaveAttribute("data-panel", "thread");
  releaseDetail();

  await expect(page.locator("#threadPanel")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#compactContent")).toContainText("Chromium 长标题详情");
  await expect(page.locator("#appShell")).toHaveAttribute("data-panel", "thread");
});

test("远端历史索引仅作静态列表项，分页显示范围、末页并复用已访问页", async ({ page }) => {
  await page.goto("/");
  let remoteIndexRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/sources/office/index?")) remoteIndexRequests += 1;
  });

  await page.locator("#sourceSelect").selectOption("office");
  await page.locator("#sessionTimeFilter [data-session-time=earlier]").click();
  await expect(page.locator("[data-remote-index-page-info]")).toHaveText("第 1 页 · 当前范围第 1-100 条 / 共 101 条");
  await expect(page.locator("#sessionCount")).toHaveText("101");
  const indexOnlyRows = page.locator("#sessionList .session-row.index-only");
  await expect(indexOnlyRows).toHaveCount(100);
  await expect(indexOnlyRows.first()).toBeVisible();
  expect(await indexOnlyRows.evaluateAll((rows) => rows.every((row) => (
    row.getAttribute("role") === "listitem" &&
    !row.hasAttribute("tabindex") &&
    !row.hasAttribute("aria-disabled") &&
    !row.querySelector('[role="button"], [tabindex], [aria-disabled]')
  )))).toBe(true);
  await expect(indexOnlyRows.first()).toHaveAccessibleName(/仅索引，未同步正文，无法直接打开/);
  await expect(page.locator("[data-remote-index-page-action=previous]")).toBeDisabled();

  const secondPage = page.waitForRequest((request) => request.url().includes("/api/sources/office/index?") && request.url().includes("cursor=100"));
  await page.locator("[data-remote-index-page-action=next]").click();
  await secondPage;
  await expect(page.locator("[data-remote-index-page-info]")).toHaveText("第 2 页 · 当前范围第 101-101 条 / 共 101 条");
  await expect(page.locator("[data-remote-index-page-status]")).toHaveText("已到末页，无更多索引结果");
  await expect(page.locator("[data-remote-index-page-action=next]")).toBeDisabled();
  expect(remoteIndexRequests).toBe(2);

  await page.locator("[data-remote-index-page-action=previous]").click();
  await expect(page.locator("[data-remote-index-page-info]")).toHaveText("第 1 页 · 当前范围第 1-100 条 / 共 101 条");
  expect(remoteIndexRequests).toBe(2);
  await page.locator("#sessionTypeFilter").focus();
  await page.keyboard.press("Tab");
  await expect(page.locator("[data-remote-index-page-action=next]")).toBeFocused();
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