import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 20_000,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  outputDir: "test-results",
  use: {
    baseURL: "http://127.0.0.1:4799",
    channel: "chromium",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/e2e-server.mjs",
    port: 4799,
    reuseExistingServer: false,
    timeout: 20_000,
  },
});