async function selectCodexSource(page) {
  await page.locator("#sourceSelect").selectOption("local", { force: true });
}

export { selectCodexSource };