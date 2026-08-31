import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const contractId = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
const contract = {
  schemaVersion: 1,
  network: "testnet",
  contractId,
  wasmHash: "a".repeat(64),
  specHash: "b".repeat(64),
  latestLedger: 1,
  loadedAt: "2026-07-27T00:00:00.000Z",
  correlationId: "playground-e2e-correlation",
  playgroundRequestId: "playground-e2e-request",
  functions: [
    {
      name: "hello",
      documentation: "Return a greeting.",
      parameters: [{ name: "to", documentation: "Greeting target.", type: { kind: "symbol" } }],
      outputs: [{ index: 0, type: { kind: "symbol" } }],
      source: { index: 0, xdr: "" },
    },
  ],
  customTypes: [],
  errors: [],
  events: [],
  rawEntries: [],
  invocation: { eligible: true, functionName: "hello", reason: "E2E fixture" },
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/telemetry/playground", (route) =>
    route.fulfill({ status: 202, body: "" }),
  );
  await page.route("**/api/v1/playground/contracts/load", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(contract),
    }),
  );
});

test("public alpha loader, history, codegen, keyboard, and accessibility", async ({ page }) => {
  await page.goto("/playground");
  await page.getByLabel("Contract ID").fill(contractId);
  await page.getByRole("button", { name: "Load contract" }).click();

  await expect(page.getByText("Contract overview", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reproducible code" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reopen contract" })).toBeVisible();
  await page.getByRole("tab", { name: "Stellar CLI" }).click();
  await expect(page.getByRole("tabpanel", { name: "cli generated code" })).toContainText(
    "stellar contract invoke",
  );

  for (const viewport of [
    { width: 320, height: 800 },
    { width: 768, height: 900 },
    { width: 1440, height: 1_000 },
  ]) {
    await page.setViewportSize(viewport);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  }

  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  expect(serious).toEqual([]);
});

test("corrupt storage cannot block the empty state", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("velo:playground:history:v1", "{broken"));
  await page.goto("/playground");
  await expect(page.getByText("No local Playground history yet.")).toBeVisible();
  await expect(page.getByText("No contract specification loaded.")).toBeVisible();
});
