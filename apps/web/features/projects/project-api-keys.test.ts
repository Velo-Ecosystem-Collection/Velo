import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const apiKeysSource = fs.readFileSync("features/projects/project-api-keys.tsx", "utf8");
const apiKeysPageSource = fs.readFileSync("app/projects/[projectId]/api-keys/page.tsx", "utf8");
const appShellSource = fs.readFileSync("core/app-shell.tsx", "utf8");
const integrationSource = fs.readFileSync("features/projects/project-integration.tsx", "utf8");
const projectFeatureSources = [
  "features/projects/project-settings.tsx",
  "features/projects/project-contracts.tsx",
  "features/projects/project-events.tsx",
  "features/projects/project-webhooks.tsx",
]
  .map((file) => fs.readFileSync(file, "utf8"))
  .join("\n");
const sidebarSource = fs.readFileSync(
  "../../packages/ui/src/components/ui-customs/sidebar/app-sidebar.tsx",
  "utf8",
);

test("api keys route renders inside app shell sidebar", () => {
  assert.match(apiKeysPageSource, /import \{ AppShell \}/);
  assert.match(apiKeysPageSource, /import \{ ProjectApiKeys \}/);
  assert.match(apiKeysPageSource, /<AppShell>/);
  assert.match(apiKeysPageSource, /<ProjectApiKeys projectId=\{projectId\} \/>/);
});

test("project api keys page uses existing Convex key APIs", () => {
  assert.match(apiKeysSource, /api\.projects\.query\.getById/);
  assert.match(apiKeysSource, /api\.projects\.query\.listApiKeys/);
  assert.match(apiKeysSource, /api\.projects\.mutation\.generateApiKey/);
  assert.match(apiKeysSource, /api\.projects\.mutation\.revokeApiKey/);
  assert.match(apiKeysSource, /Gas Station · Testnet/);
  assert.match(apiKeysSource, /VELO_GAS_API_KEY/);
  assert.match(apiKeysSource, /purpose: selectedPurpose/);
  assert.match(apiKeysSource, /\/api\/gas\/sponsor/);
  assert.match(apiKeysSource, /\/api\/gas\/submit/);
  assert.match(apiKeysSource, /Save your API key/);
  assert.match(apiKeysSource, /Available API endpoints/);
});

test("legacy API keys without a purpose retain and display both endpoint scopes", () => {
  assert.match(apiKeysSource, /activeKeys\.filter\(\(key\) => key\.purpose !== "gas"\)/);
  assert.match(apiKeysSource, /activeKeys\.filter\(\(key\) => key\.purpose !== "general"\)/);
  assert.match(apiKeysSource, /"Legacy · General \+ Gas"/);
});

test("legacy API keys remain available to the checkout integration selector", () => {
  assert.match(
    integrationSource,
    /apiKeys\?\.filter\(\(k\) => !k\.revoked && k\.purpose !== "gas"\)/,
  );
});

test("project api keys page uses theme-aware color tokens", () => {
  assert.match(apiKeysSource, /bg-card/);
  assert.match(apiKeysSource, /text-card-foreground/);
  assert.match(apiKeysSource, /border-border/);
  assert.match(apiKeysSource, /text-muted-foreground/);
  assert.match(apiKeysSource, /bg-muted\/30/);
  assert.doesNotMatch(apiKeysSource, /\b(?:bg-white|text-zinc-\d+|border-zinc-\d+)\b/);
});

test("sidebar exposes api keys project navigation", () => {
  assert.match(sidebarSource, /KeyIcon/);
  assert.match(sidebarSource, /title: "API Keys"[\s\S]*url: `\$\{projectBaseUrl\}\/api-keys`/);
  assert.match(sidebarSource, /title: "API Keys"[\s\S]*disabled: !activeProject/);
});

test("app shell prefetches api keys and no longer falls back to removed project overview", () => {
  assert.match(appShellSource, /`\/projects\/\$\{activeProject\.id\}\/api-keys`/);
  assert.match(appShellSource, /router\.push\("\/dashboard"\);/);
  assert.doesNotMatch(appShellSource, /router\.push\(`\/projects\/\$\{id\}`\);/);
  assert.doesNotMatch(appShellSource, /`\/projects\/\$\{activeProject\.id\}`,/);
});

test("old project overview route and feature are removed", () => {
  assert.equal(fs.existsSync("app/projects/[projectId]/page.tsx"), false);
  assert.equal(fs.existsSync("features/projects/project-detail.tsx"), false);
  assert.doesNotMatch(integrationSource, /\/projects\/\$\{projectId\}#api-keys/);
  assert.match(integrationSource, /\/projects\/\$\{projectId\}\/api-keys/);
  assert.doesNotMatch(projectFeatureSources, /Project overview/);
  assert.doesNotMatch(projectFeatureSources, /href=\{`\/projects\/\$\{[^}]+\}`\}/);
});
