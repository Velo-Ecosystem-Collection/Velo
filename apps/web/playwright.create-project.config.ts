import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /create-project\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  outputDir: "playwright-report/create-project-test-results",
  use: {
    baseURL: "http://127.0.0.1:3201",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "android-chromium",
      use: { ...devices["Pixel 7"], browserName: "chromium" },
    },
    { name: "ios-webkit", use: { ...devices["iPhone 13"], browserName: "webkit" } },
  ],
  webServer: {
    command: "VELO_GAS_E2E_FIXTURES=1 node_modules/.bin/next dev --hostname 127.0.0.1 --port 3201",
    url: "http://127.0.0.1:3201/projects/project-gas-owner/settings",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
