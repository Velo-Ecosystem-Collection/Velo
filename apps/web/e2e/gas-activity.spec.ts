import path from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const screenshotPath = (name: string) =>
  path.resolve(process.cwd(), "../../docs/screenshots", name);

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
}

async function expectNoSeriousAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  expect(serious).toEqual([]);
}

test.describe("Gas activity development fixtures", () => {
  test("paginates reactively, distinguishes receipt hashes, and restores keyboard focus", async ({
    page,
  }, testInfo) => {
    await page.goto("/dev/gas-activity-fixture");

    await expect(page.getByRole("heading", { name: "Gas activity" })).toBeVisible();
    await expect(page.getByRole("row")).toHaveCount(3);
    await expect(page.getByText("1.2345678 XLM", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Load more activity" }).click();
    await expect(page.getByRole("row")).toHaveCount(5);
    await page.getByRole("button", { name: "Load more activity" }).click();
    await expect(page.getByText("No more retained activity to load.")).toBeVisible();
    await expect(page.getByRole("row")).toHaveCount(6);

    await page.getByRole("button", { name: "Simulate reactive fee update" }).click();
    await expect(page.getByText("1.2345679 XLM", { exact: true })).toBeVisible();

    const firstDetailButton = page.getByRole("button", {
      name: "View receipt details for gas-fixture-001",
    });
    await firstDetailButton.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Gas receipt detail" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Inner transaction lookup" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Outer FeeBump lookup" })).toBeVisible();
    await expect(page.getByText(/only execution status treated as success/i)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "Gas receipt detail" })).toBeHidden();
    await expect(page.locator(":focus")).toHaveAccessibleName(
      "View receipt details for gas-fixture-001",
    );

    await page.getByRole("button", { name: "View receipt details for gas-fixture-002" }).click();
    await expect(
      page.getByRole("dialog").getByText("Submitted — unresolved", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("Required — outcome remains unresolved", { exact: true }),
    ).toBeVisible();

    await expectNoSeriousAxeViolations(page);

    if (testInfo.project.name === "chromium") {
      await page.screenshot({
        path: screenshotPath("gas-activity-receipt-fixture.png"),
        fullPage: true,
      });
    }
  });

  test("covers loading, empty, sanitized errors, disconnected snapshots, and identity resets", async ({
    page,
  }) => {
    await page.goto("/dev/gas-activity-fixture");

    await page.getByRole("button", { name: "Loading activity" }).click();
    await expect(page.getByLabel("Loading Gas activity")).toBeVisible();

    await page.getByRole("button", { name: "Empty history" }).click();
    await expect(page.getByText("No retained Gas activity", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Activity read error" }).click();
    await expect(page.getByText("Gas activity unavailable", { exact: true })).toBeVisible();
    await expect(page.getByText(/failure details are hidden/i)).toBeVisible();

    await page.getByRole("button", { name: "Disconnected snapshot" }).click();
    await expect(page.getByText("Potentially stale activity", { exact: true })).toBeVisible();
    await expect(page.getByText(/may be stale while disconnected/i)).toBeVisible();

    await page.getByRole("button", { name: "Loaded history" }).click();
    await page.getByRole("button", { name: "Load more activity" }).click();
    await expect(page.getByRole("row")).toHaveCount(5);
    await page.getByRole("button", { name: "View receipt details for gas-fixture-001" }).click();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Switch fixture identity" }).click();
    await expect(page.getByText("Current fixture project: 2.", { exact: false })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Gas receipt detail" })).toBeHidden();
    await expect(page.getByRole("row")).toHaveCount(3);
  });

  test("keeps missing execution and missing audit states separate across responsive layouts", async ({
    page,
  }, testInfo) => {
    await page.goto("/dev/gas-activity-fixture");

    await page.getByRole("button", { name: "Missing execution" }).click();
    await page.getByRole("button", { name: "View receipt details for gas-fixture-001" }).click();
    await expect(page.getByText("Execution detail not found", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Audit record unavailable" }).click();
    await page.getByRole("button", { name: "View receipt details for gas-fixture-001" }).click();
    await expect(page.getByText("Audit information unavailable", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("dialog").getByText("Succeeded", { exact: true }).first(),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    for (const viewport of [
      { width: 320, height: 900 },
      { width: 768, height: 900 },
      { width: 1440, height: 1_000 },
    ]) {
      await page.setViewportSize(viewport);
      await expectNoHorizontalOverflow(page);
    }

    await expectNoSeriousAxeViolations(page);

    if (testInfo.project.name === "chromium") {
      await page.setViewportSize({ width: 320, height: 900 });
      await page.getByRole("button", { name: "View receipt details for gas-fixture-001" }).click();
      await page.screenshot({
        path: screenshotPath("gas-activity-mobile-fixture.png"),
        fullPage: true,
      });
    }
  });
});
