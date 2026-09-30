import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /project-settings\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  outputDir: "playwright-report/project-settings-test-results",
  use: {
    baseURL: "http://127.0.0.1:3200",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "VELO_GAS_E2E_FIXTURES=1 node_modules/.bin/next dev --hostname 127.0.0.1 --port 3200",
    url: "http://127.0.0.1:3200/projects/project-gas-owner/settings",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
