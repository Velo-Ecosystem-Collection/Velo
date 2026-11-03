import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createCheckoutBenchmarkMarkerDetail } from "./benchmark-markers.ts";
import { formatAmount, formatAsset } from "./format.ts";

const checkoutSource = readFileSync(new URL("./checkout-client.tsx", import.meta.url), "utf8");
const cancelSource = readFileSync(new URL("./cancel-client.tsx", import.meta.url), "utf8");

test("formatAsset returns XLM for native asset", () => {
  assert.equal(formatAsset("native"), "XLM");
  assert.equal(formatAsset("XLM"), "XLM");
});

test("formatAsset extracts code from CODE:ISSUER format", () => {
  assert.equal(formatAsset("USDC:GBX5S..."), "USDC");
  assert.equal(formatAsset("ARST:GBX5S..."), "ARST");
});

test("formatAmount formats numbers with minimum fraction digits and appends formatted asset", () => {
  assert.equal(formatAmount("10", "native"), "10.00 XLM");
  assert.equal(formatAmount("150.5", "USDC:GBX5S..."), "150.50 USDC");
  assert.equal(formatAmount("invalid", "native"), "invalid XLM");
});

test("checkout client does not mark Horizon submission success as paid", () => {
  assert.doesNotMatch(checkoutSource, /status:\s*["']paid["']/);
  assert.match(checkoutSource, /backend scanner confirms settlement/);
});

test("checkout client displays provider-neutral recipient details", () => {
  assert.match(checkoutSource, /Recipient Address/);
  assert.doesNotMatch(checkoutSource, /PDAX Deposit Address/);
  assert.doesNotMatch(checkoutSource, /receiverMemo.*\{intent\.receiverMemo\}/);
  assert.match(checkoutSource, /memo:\s*intent\.receiverMemo/);
});

test("checkout client blocks submissions for legacy PDAX intents", () => {
  assert.match(checkoutSource, /intent\.anchor === "pdax" && intent\.status !== "pending"/);
  assert.match(checkoutSource, /cannot accept a new Stellar transaction/);
  assert.match(checkoutSource, /intent\.anchor !== "pdax"/);
});

test("checkout client keeps unresolved historical routes unavailable", () => {
  assert.match(checkoutSource, /intent\.status === ["']awaiting_route["']/);
  assert.match(checkoutSource, /This payment route is unavailable/);
});

test("cancelled checkout remains terminal and never retries the same payment intent", () => {
  assert.match(
    checkoutSource,
    /intent\.status === ["']cancelled["'][\s\S]*router\.replace\(`\/pay\/\$\{paymentIntentId\}\/cancel`\)/,
  );
  assert.doesNotMatch(cancelSource, /href=\{`\/pay\/\$\{paymentIntentId\}`\}/);
  assert.doesNotMatch(cancelSource, /Retry Checkout Session/);
});

test("cancelled checkout returns to the merchant for a fresh session", () => {
  assert.match(cancelSource, /window\.location\.href = intent\.cancelUrl/);
  assert.match(cancelSource, /href=\{intent\.cancelUrl\}/);
  assert.match(cancelSource, /Return to Merchant to Try Again/);
  assert.match(cancelSource, /request a new payment link from\s+the merchant/i);
});

test("benchmark marker preserves entity, version, and separate clock domains", () => {
  const marker = createCheckoutBenchmarkMarkerDetail({
    entityId: "intent-123",
    state: "paid",
    version: 42,
    serverEventAt: 1_700_000_000_000,
    now: () => 1_700_000_000_125,
    monotonicNow: () => 250.5,
  });

  assert.deepEqual(marker, {
    entityId: "intent-123",
    state: "paid",
    version: 42,
    epochMs: 1_700_000_000_125,
    monotonicMs: 250.5,
    serverEventAt: 1_700_000_000_000,
  });
});

test("checkout navigation marker can preserve the browser navigation origin", () => {
  const marker = createCheckoutBenchmarkMarkerDetail({
    entityId: "intent-navigation",
    state: "loading",
    version: 0,
    now: () => 1_700_000_000_000,
    monotonicNow: () => 0,
  });

  assert.equal(marker.epochMs, 1_700_000_000_000);
  assert.equal(marker.monotonicMs, 0);
});
