import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const docs = fs.readFileSync("app/docs/page.tsx", "utf8");
const integrationPrompt = fs.readFileSync(
  "features/docs/velo-wallets-integration-prompt.ts",
  "utf8",
);

test("Docs page gives Velo Wallets its own beginner navigation", () => {
  assert.match(docs, /title: "Wallets Quickstart", category: "Velo Wallets"/);
  assert.match(docs, /title: "Configure & Publish", category: "Velo Wallets"/);
  assert.match(docs, /title: "Use with HTML", category: "Velo Wallets"/);
  assert.match(docs, /title: "Use with React", category: "Velo Wallets"/);
  assert.match(docs, /title: "Methods & Troubleshooting", category: "Velo Wallets"/);
});

test("Wallets guide covers the safe configure, publish, and diagnostics journey", () => {
  assert.match(docs, /Keep the Testnet preset/);
  assert.match(docs, /Add allowed origins/);
  assert.match(docs, /Save draft/);
  assert.match(docs, /Publish revision/);
  assert.match(docs, /Mainnet requires extra confirmation/);
  assert.match(docs, /isolated diagnostics page/);
  assert.match(docs, /never submitted/);
  assert.match(docs, /first save creates the public project key/);
  assert.match(docs, /Test the publication before editing your app/);
  assert.match(docs, /transaction-signing check only while the published\s+network is Testnet/);
});

test("Wallets guide includes complete HTML and React examples", () => {
  assert.match(docs, /https:\/\/www\.velo-build\.dev\/wallets\/v1\/velo-wallet\.js/);
  assert.match(docs, /api-base="https:\/\/www\.velo-build\.dev"/);
  assert.match(docs, /<velo-wallet\s+project-key=/);
  assert.match(docs, /velo:wallet-connected/);
  assert.match(docs, /VeloWalletProvider/);
  assert.match(docs, /WalletWidget/);
  assert.match(docs, /useVeloWallet/);
  assert.match(docs, /signTransaction/);
  assert.match(docs, /Content-Security-Policy/);
});

test("Wallets guide clearly separates public browser keys from private server keys", () => {
  assert.match(docs, /Never put a private Velo API key in a wallet component/);
  assert.match(docs, /Signing stays in the browser/);
  assert.match(docs, /does not receive your transaction XDR/);
  assert.match(docs, /Stable npm package/);
  assert.match(
    docs,
    /supports all\s+wallet\s+IDs offered in project configuration, including Noir/,
  );
});

test("Wallets prompt covers setup, both runtimes, signing boundaries, and Testnet checks", () => {
  for (const detail of [
    "Select the project and open its Wallets page",
    "allowed website origin exactly",
    "Save the draft",
    "Publish the revision",
    "isolated Testnet diagnostics",
    "@carts1024/velo-wallets@1.0.0",
    "VeloWalletProvider",
    "<velo-wallet project-key=",
    "velo:wallet-connected",
    "www.velo-build.dev/wallets/v1/velo-wallet.js",
    "api-base",
    "including Noir",
    "Velo Wallets does not receive signing inputs",
    "or submit it.",
    "message-signing request handles both approval and rejection",
  ]) {
    assert.ok(integrationPrompt.includes(detail), `missing wallet prompt detail: ${detail}`);
  }
  assert.match(docs, /VeloWalletsIntegrationPromptCard/);
});

test("Wallets reference documents complete public contracts and accessible docs feedback", () => {
  assert.match(docs, /connect\(\): Promise/);
  assert.match(docs, /\{ version: 1, address \}/);
  assert.match(docs, /Use one project key per browser document/);
  assert.match(docs, /CONFIG_INCOMPATIBLE/);
  assert.match(docs, /POPUP_BLOCKED/);
  assert.match(docs, /SIGNING_FAILED/);
  assert.match(docs, /aria-current=/);
  assert.match(docs, /Code copied to clipboard/);
  assert.match(docs, /sectionHeadingRef/);
});
