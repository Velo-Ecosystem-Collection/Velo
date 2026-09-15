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

test.describe("Gas telemetry development fixtures", () => {
  test("updates reactively and exposes exact table values at supported widths", async ({
    page,
  }, testInfo) => {
    await page.goto("/dev/gas-telemetry-fixture");

    await expect(page.getByRole("heading", { name: "Fee telemetry" })).toBeVisible();
    await expect(page.getByText("1.2345678 XLM", { exact: true })).toHaveCount(3);
    await expect(page.getByRole("table", { name: /Daily confirmed fees/ })).toBeVisible();
    await expect(page.getByRole("row")).toHaveCount(8);
    await expect(page.getByRole("row", { name: /2026-09-10/ })).toContainText("0.0000000 XLM");
    await expect(page.getByRole("row", { name: /2026-09-09/ })).toContainText("Unavailable");

    await page.getByRole("button", { name: "Simulate reactive fee update" }).click();
    await expect(page.getByText("1.2345679 XLM", { exact: true })).toHaveCount(3);

    await page.getByRole("button", { name: "Settled fees" }).focus();
    await expect(page.locator(":focus")).toHaveAccessibleName("Settled fees");

    for (const viewport of [
      { width: 320, height: 900 },
      { width: 768, height: 900 },
      { width: 1440, height: 1_000 },
    ]) {
      await page.setViewportSize(viewport);
      await expectNoHorizontalOverflow(page);
    }

    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    );
    expect(serious).toEqual([]);

    if (testInfo.project.name === "chromium") {
      await page.setViewportSize({ width: 1440, height: 1_000 });
      await page.screenshot({ path: screenshotPath("gas-telemetry-settled.png"), fullPage: true });
    }
  });

  test("distinguishes loading, disconnected, missing-policy, and blocked states", async ({
    page,
  }) => {
    await page.goto("/dev/gas-telemetry-fixture");

    await page.getByRole("button", { name: "Loading state" }).click();
    await expect(page.getByText("Loading fee telemetry", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Show loaded state" }).click();

    await page.getByRole("button", { name: "Simulate disconnected" }).click();
    await expect(page.getByText("Potentially stale", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Displayed accounting data may be stale", { exact: false }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Reconnect" }).click();

    await page.getByRole("button", { name: "Missing policy" }).click();
    await expect(page.getByText("No Gas policy is configured", { exact: false })).toBeVisible();
    await expect(
      page.getByText("Seven-day history is unavailable", { exact: false }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Blocked accounting" }).click();
    await expect(page.getByText("Accounting is blocked", { exact: true })).toBeVisible();
    await expect(page.getByText(/valid history remains visible/i)).toBeVisible();
  });

  test("rechecks the UTC reporting day on reconnect and resume events", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-09-15T12:00:00.000Z") });
    await page.goto("/dev/gas-telemetry-fixture");
    await expect(page.locator("p").filter({ hasText: "UTC boundary probe:" })).toContainText(
      "2026-09-15",
    );

    await page.getByRole("button", { name: "Simulate disconnected" }).click();
    await page.clock.setFixedTime(new Date("2026-09-16T12:00:00.000Z"));
    await page.getByRole("button", { name: "Reconnect" }).click();
    await expect(page.locator("p").filter({ hasText: "UTC boundary probe:" })).toContainText(
      "2026-09-16",
    );

    await page.clock.setFixedTime(new Date("2026-09-17T12:00:00.000Z"));
    await page.evaluate(() => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("online"));
    });
    await expect(page.locator("p").filter({ hasText: "UTC boundary probe:" })).toContainText(
      "2026-09-17",
    );
  });

  test("refreshes its UTC day at midnight and supports pending/empty evidence", async ({
    page,
  }, testInfo) => {
    await page.clock.install({ time: new Date("2026-09-15T23:00:00.000Z") });
    await page.goto("/dev/gas-telemetry-fixture");
    await expect(page.locator("p").filter({ hasText: "UTC boundary probe:" })).toContainText(
      "2026-09-15",
    );

    await page.clock.fastForward(3_600_001);
    await expect(page.locator("p").filter({ hasText: "UTC boundary probe:" })).toContainText(
      "2026-09-16",
    );

    await page.getByRole("button", { name: "Simulate UTC midnight" }).click();
    await expect(page.locator("p").filter({ hasText: "UTC reporting day:" })).toContainText(
      "2026-09-16",
    );
    await expect(page.getByRole("row", { name: /2026-09-16/ })).toBeVisible();

    if (testInfo.project.name === "chromium") {
      await page.getByRole("button", { name: "Pending hold" }).click();
      await expect(page.getByText("0.2500000 XLM", { exact: true })).toBeVisible();
      await page.screenshot({
        path: screenshotPath("gas-telemetry-pending-hold.png"),
        fullPage: true,
      });

      await page.getByRole("button", { name: "Initialized empty" }).click();
      await expect(page.getByText("0.0000000 XLM", { exact: true }).first()).toBeVisible();
      await page.screenshot({
        path: screenshotPath("gas-telemetry-initialized-empty.png"),
        fullPage: true,
      });
    }
  });
});
