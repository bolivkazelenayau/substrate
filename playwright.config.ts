import { defineConfig, devices } from "@playwright/test";

const e2ePort = Number(process.env.E2E_PREVIEW_PORT ?? 4173);
const e2eBaseUrl = `http://127.0.0.1:${e2ePort}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  outputDir: "test-results",
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "light",
    baseURL: e2eBaseUrl,
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    trace: "on-first-retry",
    extraHTTPHeaders: { "Cache-Control": "no-cache" },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: process.env.E2E_MANAGED_PREVIEW
    ? undefined
    : {
        command: "node scripts/e2ePreviewServer.mjs",
        url: e2eBaseUrl,
        reuseExistingServer: false,
        timeout: 60_000,
      },
});
