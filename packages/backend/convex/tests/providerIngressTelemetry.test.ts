/// <reference types="vite/client" />
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { expect, test } from "vitest";

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("PDAX callback ingress, route package, and recurring provider jobs are removed", () => {
  const convexHttp = read("../http.ts");
  const crons = read("../crons.ts");
  const packageManifest = read("../../package.json");

  expect(convexHttp).not.toMatch(/\/api\/webhooks\/pdax/);
  expect(crons).not.toMatch(
    /provider_operations|provider_events|recoverPdaxRouteJobs|pollPendingPayouts/,
  );
  expect(packageManifest).not.toMatch(/@repo\/pdax/);
  assert.equal(existsSync(new URL("../../../../packages/pdax/", import.meta.url)), false);
  assert.equal(
    existsSync(new URL("../../../../apps/web/app/api/webhooks/pdax/route.ts", import.meta.url)),
    false,
  );
});

test("provider compatibility modules contain no network client calls", () => {
  const compatibilityModules = [
    read("../payment_intents/actions.ts"),
    read("../provider_events/processing.ts"),
    read("../provider_operations/actions.ts"),
    read("../settlement/actions.ts"),
  ];
  for (const source of compatibilityModules) {
    expect(source).not.toMatch(/@repo\/pdax|fetch\s*\(|PdaxClient/);
  }
});
