import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const panel = fs.readFileSync("features/projects/project-wallets.tsx", "utf8");
const page = fs.readFileSync("app/projects/[projectId]/wallets/page.tsx", "utf8");
const preview = fs.readFileSync("app/wallet-preview/[publicKey]/route.ts", "utf8");
const sidebar = fs.readFileSync(
  "../../packages/ui/src/components/ui-customs/sidebar/app-sidebar.tsx",
  "utf8",
);
const nativeSelect = fs.readFileSync(
  "../../packages/ui/src/components/ui/native-select.tsx",
  "utf8",
);
const tabs = fs.readFileSync("../../packages/ui/src/components/ui/tabs.tsx", "utf8");

test("Wallets panel exposes configuration and publication lifecycle", () => {
  assert.match(panel, /Wallet editor sections/);
  assert.match(panel, /label: "Wallets"/);
  assert.match(panel, /label: "Appearance"/);
  assert.match(panel, /label: "Settings"/);
  assert.match(panel, /activeSection === "wallets"/);
  assert.match(panel, /activeSection === "appearance"/);
  assert.match(panel, /Wallet selector logo/);
  assert.match(panel, /<NativeSelectOption value="velo">Velo logo<\/NativeSelectOption>/);
  assert.match(panel, /<NativeSelectOption value="project">Project logo<\/NativeSelectOption>/);
  assert.match(panel, /<NativeSelectOption value="none">No logo<\/NativeSelectOption>/);
  assert.match(panel, /href=\{`\/projects\/\$\{projectId\}\/settings`\}/);
  assert.match(panel, /selectorLogo=\{draft\.selectorLogo \?\? "velo"\}/);
  assert.match(panel, /projectLogoUrl=\{project\?\.logoUrl\}/);
  assert.match(panel, /activeSection === "settings"/);
  assert.match(panel, /Guided Testnet preset/);
  assert.match(panel, /WALLET_CATALOG/);
  assert.match(panel, /Upgrade consuming apps before publishing Noir/);
  assert.match(panel, /chromewebstore\.google\.com\/detail\/noir/);
  assert.match(panel, /Allowed origins/);
  assert.match(panel, /Save draft/);
  assert.match(panel, /Publish revision/);
  assert.match(panel, /Disable integration/);
  assert.match(panel, /Live wallet preview/);
  assert.match(panel, /Draft preview only\. No wallet request will be sent\./);
  assert.match(panel, /aria-pressed=\{previewState === state\}/);
  assert.match(panel, /WALLET_LOGOS\[item\.id\]/);
  assert.match(panel, /walletIds=\{draft\.walletIds\}/);
  assert.match(panel, /mode=\{draft\.theme === "system" \? paletteTab : draft\.theme\}/);
  assert.match(panel, /Light palette/);
  assert.match(panel, /Dark palette/);
  assert.match(panel, /Button style/);
  assert.match(panel, /Integration instructions/);
  assert.match(panel, /Add each consuming app’s exact origin/);
  assert.match(panel, /public project key is safe to expose/);
  assert.match(panel, /Basic connection does not request a\s+signature/);
  assert.match(panel, /server-generated, expiring challenge/);
  assert.match(panel, /aria-live="polite"/);
});

test("Wallets editor grids respond to their available width", () => {
  assert.match(panel, /grid-cols-1 gap-1 sm:grid-cols-3 md:grid-cols-1/);
  assert.match(panel, /min-w-0[^"]*leading-tight[^"]*break-words/);
  assert.match(
    panel,
    /grid grid-cols-\[repeat\(auto-fit,minmax\(min\(100%,18rem\),1fr\)\)\] gap-3/,
  );
  assert.match(panel, /flex min-w-0 cursor-pointer items-start gap-3/);
  assert.match(panel, /<span className="min-w-0 flex-1">/);
  assert.match(
    panel,
    /grid grid-cols-\[repeat\(auto-fit,minmax\(min\(100%,14rem\),1fr\)\)\] gap-4/,
  );
  assert.match(
    panel,
    /grid min-w-0 grid-cols-\[repeat\(auto-fit,minmax\(min\(100%,13rem\),1fr\)\)\] gap-3/,
  );
});

test("Wallets dropdowns remain legible in light and dark modes", () => {
  assert.match(panel, /NativeSelect/);
  assert.match(panel, /NativeSelectOption/);
  assert.doesNotMatch(panel, /<select/);
  assert.match(nativeSelect, /text-foreground/);
  assert.match(nativeSelect, /bg-background/);
  assert.match(nativeSelect, /dark:\[color-scheme:dark\]/);
  assert.match(nativeSelect, /var\(--popover-foreground\)/);
});

test("Wallets integration instructions contain long snippets on mobile", () => {
  assert.match(tabs, /group\/tabs flex min-w-0 max-w-full/);
  assert.match(tabs, /min-w-0 max-w-full flex-1 outline-none/);
  assert.match(panel, /<Tabs defaultValue="html" className="[^"]*max-w-full[^"]*min-w-0">/);
  assert.match(
    panel,
    /<TabsContent value=\{value\} className="(?=[^"]*min-w-0)(?=[^"]*max-w-full)[^"]*">/,
  );
  assert.match(panel, /<pre className="[^"]*w-full[^"]*min-w-0[^"]*overflow-x-auto/);
  assert.match(panel, /CSP: <code className="break-all">/);
});

test("Wallets route is project-scoped and navigable", () => {
  assert.match(page, /<AppShell>/);
  assert.match(page, /<ProjectWallets projectId=\{projectId\}/);
  assert.match(sidebar, /title: "Wallets"/);
  assert.match(sidebar, /`\$\{projectBaseUrl\}\/wallets`/);
});

test("isolated diagnostics exercises local message and Testnet transaction signing", () => {
  assert.doesNotMatch(preview, /<AppShell>/);
  assert.match(preview, /wallet\.signMessage/);
  assert.match(preview, /wallet\.signTransaction/);
  assert.match(preview, /horizon-testnet\.stellar\.org/);
  assert.match(preview, /NOT submitted/);
});

test("isolated diagnostics emits valid inline JavaScript", () => {
  const template = preview.match(/new Response\(\s*(`[^]*?`),\s*\{ headers:/)?.[1];
  assert.ok(template, "diagnostics document template was not found");

  const render = new Function(
    "cdnBase",
    "safeKey",
    "appBase",
    "scriptData",
    `return ${template}`,
  ) as (...values: string[]) => string;
  const document = render(
    "http://localhost:3000/wallets",
    "vw_pk_00000000000000000000000000000000",
    "http://localhost:3000",
    JSON.stringify({
      publicKey: "vw_pk_00000000000000000000000000000000",
      appBase: "http://localhost:3000",
    }),
  );
  const inlineModule = document.match(/<script type="module">([^]*?)<\/script>/)?.[1];
  assert.ok(inlineModule, "diagnostics inline module was not found");

  assert.doesNotThrow(() => new Function(inlineModule));
});
