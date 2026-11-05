import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_WALLET_CONFIG } from "@carts1024/velo-wallets/config";

import {
  draftFromDocument,
  parseOriginLines,
  walletIntegrationSnippets,
} from "./wallet-config-form.ts";

test("origin editor removes empty lines and surrounding whitespace", () => {
  assert.deepEqual(parseOriginLines(" http://localhost:3000 \n\nhttps://app.example.com\n"), [
    "http://localhost:3000",
    "https://app.example.com",
  ]);
});

test("draft hydration keeps selector logo and defaults older records to Velo", () => {
  const oldDraft = {
    ...DEFAULT_WALLET_CONFIG,
    selectorLogo: undefined,
  };
  const hydratedOldDraft = draftFromDocument(oldDraft);
  assert.equal(hydratedOldDraft.selectorLogo, "velo");

  const hydratedProjectDraft = draftFromDocument({ ...oldDraft, selectorLogo: "project" });
  assert.equal(hydratedProjectDraft.selectorLogo, "project");
});

test("generated integration snippets use the active key and configured endpoints", () => {
  const snippets = walletIntegrationSnippets({
    projectKey: "vw_pk_example",
    cdnBaseUrl: "https://wallets.velo.dev/",
    apiBaseUrl: "https://app.velo.dev/",
  });
  assert.match(snippets.html, /https:\/\/wallets\.velo\.dev\/v1\/velo-wallet\.js/);
  assert.match(snippets.html, /project-key="vw_pk_example"/);
  assert.match(snippets.html, /api-base="https:\/\/app\.velo\.dev"/);
  assert.match(snippets.html, /velo:wallet-error/);
  assert.match(snippets.react, /VeloWalletProvider projectKey="vw_pk_example"/);
  assert.match(snippets.react, /apiBaseUrl="https:\/\/app\.velo\.dev"/);
  assert.match(snippets.react, /WalletWidget/);
  assert.doesNotMatch(snippets.react, /useVeloWallet|signMessage|<button/);
  assert.equal(snippets.install, "pnpm add @carts1024/velo-wallets@alpha");
  assert.equal(
    snippets.csp,
    "script-src 'self' https://wallets.velo.dev; connect-src 'self' https://app.velo.dev",
  );
});
