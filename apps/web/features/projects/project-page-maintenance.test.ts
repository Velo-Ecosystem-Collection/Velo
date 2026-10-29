import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { isMaintenanceEnabled } from "../../core/config/maintenance.ts";

const paymentsRoute = fs.readFileSync("app/projects/[projectId]/payments/page.tsx", "utf8");
const settlementRoute = fs.readFileSync("app/projects/[projectId]/settlement/page.tsx", "utf8");
const maintenanceView = fs.readFileSync("features/projects/project-page-maintenance.tsx", "utf8");
const sharedButton = fs.readFileSync("../../packages/ui/src/components/ui/button.tsx", "utf8");

test("maintenance switch enables only for the exact true value", () => {
  for (const value of [undefined, "false", "TRUE", "1", " true", "true "]) {
    assert.equal(isMaintenanceEnabled(value), false);
  }

  assert.equal(isMaintenanceEnabled("true"), true);
});

test("payments and settlement maintenance switches remain independent", () => {
  const combinations = [
    { payments: false, settlement: false },
    { payments: true, settlement: false },
    { payments: false, settlement: true },
    { payments: true, settlement: true },
  ];

  for (const combination of combinations) {
    const paymentsValue = combination.payments ? "true" : "false";
    const settlementValue = combination.settlement ? "true" : "false";

    assert.deepEqual(
      [isMaintenanceEnabled(paymentsValue), isMaintenanceEnabled(settlementValue)],
      [combination.payments, combination.settlement],
    );
  }
});

test("each project route reads its server switch at request time inside AppShell", () => {
  assert.match(paymentsRoute, /await connection\(\)/);
  assert.match(paymentsRoute, /process\.env\.VELO_PAYMENTS_MAINTENANCE/);
  assert.match(paymentsRoute, /<AppShell>[\s\S]*<ProjectPageMaintenance page="payments" \/>/);
  assert.match(paymentsRoute, /<ProjectPayments projectId=\{projectId\} \/>/);

  assert.match(settlementRoute, /await connection\(\)/);
  assert.match(settlementRoute, /process\.env\.VELO_SETTLEMENT_MAINTENANCE/);
  assert.match(settlementRoute, /<AppShell>[\s\S]*<ProjectPageMaintenance page="settlement" \/>/);
  assert.match(settlementRoute, /<ProjectSettlement projectId=\{projectId\} \/>/);
});

test("maintenance view provides labelled page-specific content and a keyboard-focusable return link", () => {
  assert.match(maintenanceView, /payments: "Payments are temporarily unavailable"/);
  assert.match(maintenanceView, /settlement: "Settlement is temporarily unavailable"/);
  assert.match(maintenanceView, /<h1/);
  assert.match(maintenanceView, /aria-labelledby="project-page-maintenance-title"/);
  assert.match(maintenanceView, /We’re upgrading the system/);
  assert.match(maintenanceView, /<Link href="\/dashboard">/);
  assert.match(maintenanceView, /sm:py-12/);
  assert.match(sharedButton, /focus-visible:ring/);
});
