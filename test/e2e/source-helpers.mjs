async function selectCodexSource(page) {
  await page.locator("#sourceSelect").selectOption("local", { force: true });
}

async function openSessionFilters(page) {
  const filters = page.locator(".session-filters");
  if (await filters.evaluate((element) => !element.open)) await filters.locator("summary").click();
}

export { openSessionFilters, selectCodexSource };