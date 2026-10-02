import path from "node:path";

import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  testMatch: "wallet-auth.spec.ts",
  fullyParallel: true,
  use: { baseURL: "http://127.0.0.1:3107", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3107",
    url: "http://127.0.0.1:3107/dashboard",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VELO_WALLET_AUTH_E2E_FIXTURES: "1",
      NEXT_PUBLIC_CONVEX_URL: "https://wallet-auth-fixture.convex.cloud",
      // The shared UI package owns the PostCSS plugin used by the root layout.
      NODE_PATH: [path.resolve("../../packages/ui/node_modules"), process.env.NODE_PATH]
        .filter(Boolean)
        .join(path.delimiter),
    },
  },
});
