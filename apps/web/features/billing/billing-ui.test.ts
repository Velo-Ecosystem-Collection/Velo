import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./billing-dashboard.tsx", import.meta.url), "utf8");
const paymentIntentRouteSource = readFileSync(
  new URL("../../core/api/payment-intent-route-handlers.ts", import.meta.url),
  "utf8",
);

test("billing dashboard exposes merchant balances, history, receipts, and disclosures", () => {
  assert.match(source, /Available/);
  assert.match(source, /Reserved/);
  assert.match(source, /Promotional/);
  assert.match(source, /Ledger/);
  assert.match(source, /Receipts/);
  assert.match(source, /PDAX and off-ramp charges/);
  assert.match(source, /merchant-customer refunds do not automatically restore/i);
});

test("operator controls are rendered only for authorized billing operators", () => {
  assert.match(source, /operatorAccess\.isOperator && <TabsTrigger value="operations">/);
  assert.match(source, /operatorAccess\.isOperator && \(/);
  assert.match(source, /Operator wallets/);
  assert.match(source, /Sandbox enforcement/);
  assert.match(source, /Open reconciliation exceptions/);
});

test("an operator without a merchant organization can still open Operations", () => {
  assert.match(source, /billing\/operators:getAccess/);
  assert.match(source, /billing === null && operatorAccess\.isOperator/);
  assert.match(source, /<OperatorPanel \/>/);
});

test("offer activation lets operators choose configured USDC or native XLM", () => {
  assert.match(source, /name="offerAsset"/);
  assert.match(source, /<NativeSelectOption value="USDC"[\s\S]*?>\s*USDC\s*<\/NativeSelectOption>/);
  assert.match(source, /<NativeSelectOption value="XLM">XLM<\/NativeSelectOption>/);
  assert.match(source, /resolveBillingOfferAsset/);
  assert.doesNotMatch(source, /name="issuerAddress"/);
});

test("merchant top-up controls reflect platform safety policy", () => {
  assert.match(source, /topupsEnabled: boolean/);
  assert.match(source, /billing\.topupsUnavailableReason/);
  assert.match(source, /disabled=\{topupPending \|\| !topupsAvailable\}/);
  assert.match(source, /Test treasury top-ups.*ON.*kill switch.*OFF/s);
});

test("top-up flow uses the server-created PaymentIntent", () => {
  assert.match(source, /billing\/topups:create/);
  assert.match(source, /router\.push\(`\/pay\/\$\{result\.paymentIntentId\}`\)/);
});

test("insufficient billing credits return a structured payment-required response", () => {
  assert.match(paymentIntentRouteSource, /status: 402/);
  assert.match(paymentIntentRouteSource, /insufficient_billing_credits/);
});

test("Sprint 3 operations expose gated Mainnet readiness, cohort grace, finance, and mirror state", () => {
  assert.match(source, /Mainnet launch readiness/);
  assert.match(source, /Required approvals/);
  assert.match(source, /Grace deadline/);
  assert.match(source, /Finance and margin reporting/);
  assert.match(source, /PayAccess display mirror/);
  assert.match(source, /Mainnet remains disabled until every launch gate passes/);
});
