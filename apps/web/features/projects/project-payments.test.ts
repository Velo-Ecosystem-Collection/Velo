import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./project-payments.tsx", import.meta.url), "utf8");
const route = fs.readFileSync(
  new URL("../../app/projects/[projectId]/payments/page.tsx", import.meta.url),
  "utf8",
);

test("Payments Hub is project-scoped and uses owner payment interfaces", () => {
  assert.match(route, /ProjectPayments projectId=\{projectId\}/);
  assert.match(source, /payment_intents\.queries\.listOwnerPage/);
  assert.match(source, /payment_intents\.queries\.findOwnerIntent/);
  assert.match(source, /payment_intents\.mutations\.createFromDashboard/);
});

test("Payments Hub exposes its required operational states and actions", () => {
  for (const copy of [
    "Total payments",
    "Paid volume",
    "Exact intent ID or transaction hash",
    "Payment lifecycle",
    "Create payment",
    "Payment creation is disabled",
    "Connect the owner wallet",
    "Project unavailable",
  ]) {
    assert.match(source, new RegExp(copy));
  }
  assert.doesNotMatch(source, /mutations\.updateStatus/);
  assert.doesNotMatch(source, /markVerifiedPaid/);
  assert.match(source, /New payments are disabled while this project uses a legacy PDAX default/);
});
