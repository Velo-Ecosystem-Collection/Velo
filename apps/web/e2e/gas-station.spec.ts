import path from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import type {
  GasFixtureBrowserApi,
  GasFixtureCall,
  GasFixtureConfig,
  GasFixtureScenario,
} from "./fixtures/store";

const GAS_E2E_STORAGE_KEY = "velo:e2e:gas-fixture";
const screenshotPath = (name: string) =>
  path.resolve(process.cwd(), "../../docs/screenshots", name);

const ownerProjectUrl = "/projects/project-gas-owner/gas";
const memberProjectUrl = "/projects/project-gas-member/gas";
const validContractId = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
const managedRelayerPublicKey = "GA54SPC34JL3I57ENALTO2V26XOFFG4VGQLFQXDGF6KJ5TJY7ODY56ST";
const updatedRelayerPublicKey = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

declare global {
  interface Window {
    __veloGasE2E?: GasFixtureBrowserApi;
  }
}

async function seedFixture(page: Page, config: GasFixtureConfig) {
  await page.addInitScript(() => {
    let clipboardValue = "";
    Object.defineProperty(Navigator.prototype, "clipboard", {
      configurable: true,
      get: () => ({
        readText: async () => clipboardValue,
        writeText: async (value: string) => {
          clipboardValue = value;
        },
      }),
    });
  });
  await page.addInitScript(
    ({ key, value }) => {
      if (!window.localStorage.getItem(key)) {
        window.localStorage.setItem(key, JSON.stringify(value));
      }
    },
    { key: GAS_E2E_STORAGE_KEY, value: config },
  );
  await page
    .evaluate(({ key, value }) => window.localStorage.setItem(key, JSON.stringify(value)), {
      key: GAS_E2E_STORAGE_KEY,
      value: config,
    })
    .catch(() => undefined);
}

async function gotoGas(page: Page, config: GasFixtureConfig, url = ownerProjectUrl) {
  await seedFixture(page, config);
  await page.goto(url);
  await expect.poll(() => page.evaluate(() => Boolean(window.__veloGasE2E))).toBe(true);
}

type FixtureCommand =
  | "reactive-update"
  | "stored-policy-update"
  | "provisioning-commit"
  | "disconnect"
  | "connect";

async function fixture(page: Page, command: FixtureCommand) {
  await page.evaluate((action) => {
    const api = window.__veloGasE2E;
    if (!api) throw new Error("Gas E2E fixture API was not installed");
    switch (action) {
      case "reactive-update":
        api.simulateReactiveUpdate();
        return;
      case "stored-policy-update":
        api.simulateStoredPolicyUpdate();
        return;
      case "provisioning-commit":
        api.simulateProvisioningCommit();
        return;
      case "disconnect":
        api.setConnection(false);
        return;
      case "connect":
        api.setConnection(true);
        return;
    }
  }, command);
}

async function configureFixture(page: Page, config: GasFixtureConfig) {
  await page.evaluate((value) => {
    const api = window.__veloGasE2E;
    if (!api) throw new Error("Gas E2E fixture API was not installed");
    api.configure(value);
  }, config);
}

async function setScenario(page: Page, scenario: GasFixtureScenario) {
  await page.evaluate((value) => {
    const api = window.__veloGasE2E;
    if (!api) throw new Error("Gas E2E fixture API was not installed");
    api.setScenario(value);
  }, scenario);
}

async function calls(page: Page): Promise<GasFixtureCall[]> {
  return page.evaluate(() => window.__veloGasE2E?.getCalls() ?? []);
}

async function resolveNext(page: Page, functionName?: string, value?: unknown) {
  await page.evaluate(
    ({ name, result }) => {
      const api = window.__veloGasE2E;
      if (!api) throw new Error("Gas E2E fixture API was not installed");
      api.resolveNext(name, result);
    },
    { name: functionName, result: value },
  );
}

async function rejectNext(page: Page, functionName?: string, message?: string) {
  await page.evaluate(
    ({ name, rejection }) => {
      const api = window.__veloGasE2E;
      if (!api) throw new Error("Gas E2E fixture API was not installed");
      api.rejectNext(name, rejection);
    },
    { name: functionName, rejection: message },
  );
}

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

function activityRows(page: Page) {
  return page.locator('section[aria-labelledby="gas-activity-title"]').getByRole("row");
}

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return route.continue();
    }
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
      return route.continue();
    }
    return route.abort();
  });
});

test.describe("integrated Gas Station simulated browser regressions", () => {
  test("covers owner/editor/viewer access and sidebar navigation", async ({ page }, testInfo) => {
    await seedFixture(page, {
      session: "owner",
      projectId: "project-gas-owner",
    });
    await page.goto("/projects/project-gas-owner/api-keys");
    await expect.poll(() => page.evaluate(() => Boolean(window.__veloGasE2E))).toBe(true);

    await page.getByRole("button", { name: "Pay", exact: true }).click();
    const gasLink = page.locator(`a[href="${ownerProjectUrl}"]`).first();
    await expect(gasLink).toBeVisible();
    await gasLink.click();
    await expect(page).toHaveURL(new RegExp(`${ownerProjectUrl}$`));
    await expect(page.getByRole("heading", { name: "Gas Station" })).toBeVisible();
    await expect(page.getByText("owner access", { exact: true })).toBeVisible();
    await expect(page.getByText("Owner Gas Project", { exact: true }).first()).toBeVisible();

    if (testInfo.project.name === "chromium") {
      await page.screenshot({
        path: screenshotPath("gas-station-policy-balance-simulated.png"),
        fullPage: true,
      });
    }

    await gotoGas(page, { session: "editor", projectId: "project-gas-owner" }, ownerProjectUrl);
    await expect(page.getByText("editor access", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save policy" })).toBeVisible();
    await expect(page.getByText("No projects", { exact: true })).toBeVisible();
    await page.getByLabel("Hourly wallet quota").fill("61");
    await page.getByRole("button", { name: "Save policy" }).click();
    await resolveNext(page, "gas/mutations:updatePolicy");
    await expect(page.getByText("Policy saved.", { exact: false })).toBeVisible();

    await gotoGas(page, { session: "viewer", projectId: "project-gas-member" }, memberProjectUrl);
    await expect(page.getByText("viewer access", { exact: true })).toBeVisible();
    await expect(page.getByText("Member-only Gas Project", { exact: true })).toBeVisible();
    await expect(page.getByText("Read only", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save policy" })).toHaveCount(0);
    await expect(page.getByText("No projects", { exact: true })).toBeVisible();
    await expect(page.locator(`a[href="${memberProjectUrl}"]`).first()).toBeVisible();
  });

  test("denies nonmembers and redirects disconnected sessions", async ({ page }) => {
    await gotoGas(
      page,
      { session: "nonmember", projectId: "project-gas-member" },
      memberProjectUrl,
    );
    await expect(page.getByRole("heading", { name: "Project unavailable" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Policy controls" })).toHaveCount(0);
    const nonmemberCalls = await calls(page);
    expect(nonmemberCalls.map((call) => call.functionName)).not.toContain(
      "gas/mutations:updatePolicy",
    );
    expect(nonmemberCalls.map((call) => call.functionName)).not.toContain(
      "gas/queries:getTelemetry",
    );

    await gotoGas(
      page,
      { session: "disconnected", projectId: "project-gas-owner" },
      ownerProjectUrl,
    );
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Connect to Console" })).toBeVisible();
  });

  test("lets owners add or update public relayer metadata and keeps the form owner-only", async ({
    page,
  }) => {
    await gotoGas(page, { session: "owner", projectId: "project-gas-owner" });

    const publicKey = page.getByRole("textbox", { name: "Relayer public address" });
    await expect(publicKey).toBeVisible();
    await expect(publicKey).toHaveValue("GA54SPC34JL3I57ENALTO2V26XOFFG4VGQLFQXDGF6KJ5TJY7ODY56ST");

    await publicKey.fill(` ${updatedRelayerPublicKey.toLowerCase()} `);
    await page.getByLabel("Relayer metadata status").selectOption("disabled");
    await page.getByRole("button", { name: "Save relayer configuration" }).click();

    await expect
      .poll(async () => {
        const savedCalls = (await calls(page)).filter(
          (call) => call.functionName === "gas/mutations:updateRelayerAccount",
        );
        return savedCalls.length;
      })
      .toBe(1);

    const mutation = (await calls(page)).find(
      (call) => call.functionName === "gas/mutations:updateRelayerAccount",
    );
    expect(mutation?.status).toBe("pending");
    expect(mutation?.args).toEqual({
      projectId: "project-gas-owner",
      publicKey: updatedRelayerPublicKey,
      status: "disabled",
    });

    await resolveNext(page, "gas/mutations:updateRelayerAccount");
    await expect(page.getByText("Relayer configuration saved.", { exact: true })).toBeVisible();
    await expect(publicKey).toHaveValue(updatedRelayerPublicKey);
    await expect(page.getByText("Metadata disabled", { exact: true }).first()).toBeVisible();

    await gotoGas(page, { session: "editor", projectId: "project-gas-owner" });
    await expect(page.getByRole("textbox", { name: "Relayer public address" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save relayer configuration" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Refresh balance" })).toBeVisible();
  });

  test("lets owners generate a wallet for an older project and publishes it after custody commits", async ({
    page,
  }) => {
    await gotoGas(page, {
      session: "owner",
      projectId: "project-gas-owner",
      scenario: "existing-project-no-relayer",
    });

    await expect(
      page.getByRole("heading", { name: "Generate a Testnet relayer wallet" }),
    ).toBeVisible();
    await expect(
      page.getByText(/Velo generates and stores the signer in encrypted custody/i),
    ).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Relayer public address" })).toHaveCount(0);

    const advanced = page.getByText("Advanced: configure an existing relayer", { exact: true });
    await advanced.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("textbox", { name: "Relayer public address" })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("textbox", { name: "Relayer public address" })).toHaveCount(0);

    const generate = page.getByRole("button", { name: "Generate Testnet relayer wallet" });
    await generate.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Queuing wallet generation…" })).toBeDisabled();
    await rejectNext(page, "gas/mutations:retryProvisioning", "fixture queue failure");
    await expect(
      page.getByRole("alert").filter({ hasText: "Wallet generation could not be queued" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Generate Testnet relayer wallet" }),
    ).toBeEnabled();

    await page.getByRole("button", { name: "Generate Testnet relayer wallet" }).click();
    await expect(page.getByRole("button", { name: "Queuing wallet generation…" })).toBeDisabled();
    await resolveNext(page, "gas/mutations:retryProvisioning");
    await expect(
      page.getByText("Relayer wallet generation in progress", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Generating wallet…" })).toBeDisabled();
    await expect(page.getByText(managedRelayerPublicKey, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Prepare funding" })).toHaveCount(0);

    const provisioningCalls = (await calls(page)).filter(
      (call) => call.functionName === "gas/mutations:retryProvisioning",
    );
    expect(provisioningCalls).toHaveLength(2);
    expect(provisioningCalls.map((call) => call.status).sort()).toEqual(["fulfilled", "rejected"]);

    await fixture(page, "provisioning-commit");
    await expect(page.getByText(managedRelayerPublicKey, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Prepare funding" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Review sponsorship settings" })).toBeVisible();

    await configureFixture(page, {
      session: "editor",
      projectId: "project-gas-owner",
      scenario: "existing-project-no-relayer",
    });
    await expect(
      page.getByRole("heading", { name: "Generate a Testnet relayer wallet" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Generate Testnet relayer wallet" })).toHaveCount(
      0,
    );

    await configureFixture(page, {
      session: "viewer",
      projectId: "project-gas-member",
      scenario: "existing-project-no-relayer",
    });
    await page.goto(memberProjectUrl);
    await expect(
      page.getByRole("heading", { name: "Generate a Testnet relayer wallet" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Generate Testnet relayer wallet" })).toHaveCount(
      0,
    );
  });

  test("shows deployment configuration failures and manual setup inside the no-relayer card", async ({
    page,
  }) => {
    await gotoGas(page, {
      session: "owner",
      projectId: "project-gas-owner",
      scenario: "existing-project-config-error",
    });

    await expect(
      page.getByRole("heading", { name: "Generate a Testnet relayer wallet" }),
    ).toBeVisible();
    await expect(
      page.getByText(/deployment encryption keyring or deployment identity is not configured/i),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry wallet generation" })).toBeEnabled();
    await expect(
      page.getByText("Advanced: configure an existing relayer", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Relayer public address" })).toHaveCount(0);
  });

  test("saves normalized policy arguments once and applies stored readback", async ({ page }) => {
    await gotoGas(page, { session: "owner", projectId: "project-gas-owner" });

    await page.getByLabel("Daily cap (XLM)").fill("12.3456789");
    await page.getByLabel("Hourly wallet quota").fill("4");
    await page.getByLabel("Allowed contract IDs").fill(`${validContractId}\n\n${validContractId}`);

    const saveButton = page.getByRole("button", { name: "Save policy" });
    await saveButton.click();
    await expect(page.getByRole("button", { name: "Saving…" })).toBeDisabled();
    await expect
      .poll(async () => {
        const savedCalls = (await calls(page)).filter(
          (call) => call.functionName === "gas/mutations:updatePolicy",
        );
        return savedCalls.length;
      })
      .toBe(1);

    const mutation = (await calls(page)).find(
      (call) => call.functionName === "gas/mutations:updatePolicy",
    );
    expect(mutation?.status).toBe("pending");
    expect(mutation?.args).toEqual({
      projectId: "project-gas-owner",
      enabled: true,
      dailyCapStroops: "123456789",
      walletHourlyLimit: 4,
      allowedContractIds: [validContractId],
    });

    await resolveNext(page, "gas/mutations:updatePolicy");
    await expect(page.getByText("Policy saved.", { exact: false })).toBeVisible();
    await expect(page.getByLabel("Daily cap (XLM)")).toHaveValue("12.3456789");
    await expect(page.getByLabel("Hourly wallet quota")).toHaveValue("4");
    expect(
      (await calls(page)).find((call) => call.functionName === "gas/mutations:updatePolicy")
        ?.status,
    ).toBe("fulfilled");
  });

  test("retains drafts on sanitized denial and exposes invalid-input errors", async ({ page }) => {
    await gotoGas(page, {
      session: "owner",
      projectId: "project-gas-owner",
      scenario: "policy-denial",
    });

    const dailyCap = page.getByLabel("Daily cap (XLM)");
    await dailyCap.fill("9");
    await page.getByRole("button", { name: "Save policy" }).click();
    await resolveNext(page, "gas/mutations:updatePolicy");
    await expect(
      page.getByText(/daily cap cannot be lower than current effective usage/i),
    ).toBeVisible();
    await expect(dailyCap).toHaveValue("9");
    await expect(page.getByText(/daily_cap_below_effective_usage/i)).toHaveCount(0);

    await dailyCap.fill("1.23456789");
    await dailyCap.blur();
    await expect(page.getByText(/with at most 7 decimal places/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Save policy" })).toBeDisabled();

    const quota = page.getByLabel("Hourly wallet quota");
    await quota.fill("-1");
    await quota.blur();
    await expect(page.getByText(/non-negative whole number/i)).toBeVisible();
  });

  test("keeps clean forms reactive, preserves dirty conflicts, and resets identity state", async ({
    page,
  }) => {
    await gotoGas(page, { session: "owner", projectId: "project-gas-owner" });

    await expect(page.getByLabel("Daily cap (XLM)")).toHaveValue("20");
    await fixture(page, "stored-policy-update");
    await expect(page.getByLabel("Daily cap (XLM)")).toHaveValue("21");

    await page.getByLabel("Daily cap (XLM)").fill("8");
    await fixture(page, "stored-policy-update");
    await expect(page.getByLabel("Daily cap (XLM)")).toHaveValue("8");
    await expect(
      page.getByText(/stored policy changed while this draft was being edited/i),
    ).toBeVisible();
    await page.getByRole("button", { name: "Reset to stored values" }).click();
    await expect(page.getByLabel("Daily cap (XLM)")).toHaveValue("22");

    await page.getByRole("button", { name: "View receipt details for gas-e2e-001" }).click();
    await expect(page.getByRole("heading", { name: "Gas receipt detail" })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByLabel("Daily cap (XLM)").fill("8");
    await page.getByRole("button", { name: "Save policy" }).click();
    await configureFixture(page, { session: "viewer", projectId: "project-gas-member" });
    await expect(page.getByRole("heading", { name: "Project unavailable" })).toBeVisible();
    await resolveNext(page, "gas/mutations:updatePolicy");
    await expect(page.getByText("Policy saved.", { exact: false })).toHaveCount(0);

    await page.goto(memberProjectUrl);
    await expect(page.getByText("viewer access", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Daily cap (XLM)")).toHaveValue("10");
    await expect(page.getByRole("heading", { name: "Gas receipt detail" })).toHaveCount(0);
    await expect(activityRows(page)).toHaveCount(3);
  });

  test("refreshes relayer balance, preserves failures, and enforces cooldown", async ({ page }) => {
    await gotoGas(page, { session: "owner", projectId: "project-gas-owner" });
    await expect(page.getByText("4.2000000 XLM", { exact: true })).toBeVisible();

    const refresh = page.getByRole("button", { name: "Refresh balance" });
    await refresh.click();
    await expect(page.getByRole("button", { name: "Verifying balance…" })).toBeDisabled();
    await resolveNext(page, "gas/balance_action:refreshRelayerBalance");
    await expect(page.getByText("4.3000000 XLM", { exact: true })).toBeVisible();
    await expect(page.getByText(/Balance verification completed/i)).toBeVisible();

    await gotoGas(page, {
      session: "owner",
      projectId: "project-gas-owner",
      scenario: "balance-failure",
    });
    await page.getByRole("button", { name: "Refresh balance" }).click();
    await resolveNext(page, "gas/balance_action:refreshRelayerBalance");
    await expect(page.getByText(/temporarily unavailable/i)).toBeVisible();
    await expect(page.getByText("4.2000000 XLM", { exact: true })).toBeVisible();
    await expect(page.getByText("provider_failure", { exact: true })).toHaveCount(0);

    await gotoGas(page, {
      session: "owner",
      projectId: "project-gas-owner",
      scenario: "balance-cooldown",
    });
    const cooldownRefresh = page.getByRole("button", { name: "Refresh balance" });
    await cooldownRefresh.click();
    await resolveNext(page, "gas/balance_action:refreshRelayerBalance");
    await expect(page.getByText(/shared refresh cooldown is active/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Refresh available in \d+s/ })).toBeDisabled();
  });

  test("lets owners review, fund, activate, pause, and withdraw a managed Testnet relayer", async ({
    page,
  }) => {
    await gotoGas(page, {
      session: "owner",
      projectId: "project-gas-owner",
      scenario: "managed-relayer",
    });

    await expect(page.getByRole("heading", { name: "Review sponsorship settings" })).toBeVisible();
    await expect(page.getByText("10.0000000 XLM", { exact: true })).toBeVisible();
    await expect(page.getByText("100 requests per UTC hour", { exact: true })).toBeVisible();
    await expect(page.getByText(validContractId, { exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: "Prepare funding" }).click();
    await resolveNext(page, "gas/balance_action:prepareRelayerFunding");
    await expect(page.getByRole("button", { name: "Sign and fund" })).toBeVisible();
    await page.getByRole("button", { name: "Sign and fund" }).click();
    await resolveNext(page, "gas/balance_action:submitRelayerFunding", { status: "verified" });
    await expect(
      page.getByText("Funding is verified on Stellar Testnet.", { exact: true }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Get Testnet funds" }).click();
    await resolveNext(page, "gas/balance_action:requestTestnetRelayerFunds");
    await expect(
      page.getByText("Testnet funds are visible in the relayer account.", { exact: true }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Enable sponsorship with these settings" }).click();
    await resolveNext(page, "gas/mutations:activateManagedSponsorship");
    await expect(
      page.getByText(
        "Sponsorship is enabled with the reviewed limits and active linked contracts.",
        {
          exact: true,
        },
      ),
    ).toBeVisible();

    await page.getByRole("button", { name: "Pause sponsorship" }).click();
    await resolveNext(page, "gas/mutations:setManagedRelayerStatus");
    await expect(page.getByRole("button", { name: "Resume relayer" })).toBeVisible();
    await page.getByRole("button", { name: "Resume relayer" }).click();
    await resolveNext(page, "gas/mutations:setManagedRelayerStatus");
    await expect(page.getByRole("button", { name: "Pause sponsorship" })).toBeVisible();

    await page.getByRole("button", { name: "Prepare withdrawal" }).click();
    await resolveNext(page, "gas/balance_action:prepareRelayerWithdrawal");
    await expect(page.getByRole("button", { name: "Review and authorize" })).toBeVisible();
    await page.getByRole("button", { name: "Review and authorize" }).click();
    await resolveNext(page, "gas/balance_action:confirmRelayerWithdrawal");
    await expect(
      page.getByText(
        "The withdrawal is verified on Stellar Testnet. Sponsorship remains paused until you resume it.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Resume relayer" })).toBeVisible();
  });

  test("keeps managed controls owner-only and sponsorship disabled without linked contracts", async ({
    page,
  }) => {
    await gotoGas(page, {
      session: "editor",
      projectId: "project-gas-owner",
      scenario: "managed-relayer",
    });
    await expect(page.getByText("Owner funding controls", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Pause sponsorship" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Prepare withdrawal" })).toHaveCount(0);

    await gotoGas(page, {
      session: "owner",
      projectId: "project-gas-owner",
      scenario: "managed-no-contracts",
    });
    await expect(page.getByText("No active contracts are linked", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Enable sponsorship with these settings" }),
    ).toHaveCount(0);
  });

  test("blocks account actions when managed custody belongs to another deployment", async ({
    page,
  }) => {
    await gotoGas(page, {
      session: "owner",
      projectId: "project-gas-owner",
      scenario: "managed-relayer-context-mismatch",
    });

    await expect(
      page.getByRole("alert").filter({ hasText: "Custody deployment context does not match" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Prepare funding" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Review sponsorship settings" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Pause sponsorship" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Resume relayer" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Prepare withdrawal" })).toHaveCount(0);
  });

  test("protects pending completions when the wallet identity changes", async ({ page }) => {
    await gotoGas(page, { session: "owner", projectId: "project-gas-owner" });
    await page.getByLabel("Daily cap (XLM)").fill("8");
    await page.getByRole("button", { name: "Save policy" }).click();
    await expect(page.getByRole("button", { name: "Saving…" })).toBeDisabled();

    await configureFixture(page, { session: "viewer", projectId: "project-gas-member" });
    await expect(page.getByRole("heading", { name: "Project unavailable" })).toBeVisible();
    await resolveNext(page, "gas/mutations:updatePolicy");
    await expect(page.getByRole("heading", { name: "Project unavailable" })).toBeVisible();

    await page.goto(memberProjectUrl);
    await expect(page.getByText("viewer access", { exact: true })).toBeVisible();
    await expect(page.getByText("Policy saved.", { exact: false })).toHaveCount(0);
    await expect(page.getByLabel("Daily cap (XLM)")).toHaveValue("10");

    await configureFixture(page, { session: "owner", projectId: "project-gas-owner" });
    await page.goto(ownerProjectUrl);
    await expect(page.getByText("owner access", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Refresh balance" }).click();
    await expect(page.getByRole("button", { name: "Verifying balance…" })).toBeDisabled();

    await configureFixture(page, { session: "viewer", projectId: "project-gas-member" });
    await expect(page.getByRole("heading", { name: "Project unavailable" })).toBeVisible();
    await resolveNext(page, "gas/balance_action:refreshRelayerBalance");
    await page.goto(memberProjectUrl);
    await expect(page.getByText("viewer access", { exact: true })).toBeVisible();
    await expect(
      page
        .getByText("Native XLM balance", { exact: true })
        .locator("..")
        .getByText("0.0000000 XLM", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/Balance verification completed/i)).toHaveCount(0);
  });

  test("shows owner-only Gas integration guidance with placeholder configuration and keyboard copy", async ({
    page,
  }) => {
    await gotoGas(
      page,
      { session: "owner", projectId: "project-gas-owner" },
      "/projects/project-gas-owner/integration",
    );

    const gasSection = page.locator('section[aria-labelledby="gas-station-integration-title"]');
    await expect(gasSection).toBeVisible();
    await expect(gasSection.getByRole("heading", { name: "Gas Station" })).toBeVisible();
    await expect(gasSection.getByText("VELO_GAS_API_KEY", { exact: true })).toBeVisible();
    await expect(gasSection.getByText("VELO_BASE_URL", { exact: true })).toBeVisible();
    await expect(gasSection.locator("pre")).toHaveCount(2);
    const snippets = (await gasSection.locator("pre").allTextContents()).join("\n");
    expect(snippets).toContain("VELO_GAS_API_KEY");
    expect(snippets).toContain("VELO_BASE_URL");
    expect(snippets).not.toContain("sk_live_");
    expect(snippets).not.toContain("tk_live_");

    const copyButton = gasSection.getByRole("button", { name: "Copy sponsor and submit snippet" });
    await copyButton.focus();
    await page.keyboard.press("Enter");
    await expect(gasSection.locator('[aria-live="polite"]').first()).toHaveText(
      "sponsor and submit snippet copied",
    );

    await configureFixture(page, { session: "editor", projectId: "project-gas-owner" });
    await page.goto("/projects/project-gas-owner/integration");
    await expect(page.getByRole("heading", { name: "Access Denied" })).toBeVisible();
    await expect(
      page.locator('section[aria-labelledby="gas-station-integration-title"]'),
    ).toHaveCount(0);
  });

  test("generates a Gas-only Testnet API key once for the project owner", async ({ page }) => {
    await gotoGas(
      page,
      { session: "owner", projectId: "project-gas-owner" },
      "/projects/project-gas-owner/api-keys",
    );

    await expect(page.getByRole("heading", { name: "API keys" })).toBeVisible();
    await page.getByRole("button", { name: "Generate key" }).first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Generate API key" })).toBeVisible();
    await dialog.getByLabel("API access").selectOption("gas");
    await dialog.getByLabel("Key label").fill("Express Gas server");
    await expect(dialog.getByLabel("Payment routing")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Generate key" }).click();
    await resolveNext(page, "projects/mutation:generateApiKey");

    await expect(page.getByText("Save your API key")).toBeVisible();
    await expect(page.getByText("VELO_GAS_API_KEY", { exact: true })).toBeVisible();
    const rawKey = await page.locator(".select-all").first().textContent();
    expect(rawKey).toMatch(/^tg_test_[a-f0-9]{32}$/);

    const keyCalls = (await calls(page)).filter(
      (call) => call.functionName === "projects/mutation:generateApiKey",
    );
    expect(keyCalls).toHaveLength(1);
    expect(keyCalls[0]?.args).toMatchObject({
      id: "project-gas-owner",
      label: "Express Gas server",
      purpose: "gas",
    });
    expect(keyCalls[0]?.args).not.toHaveProperty("paymentAnchor");

    const keyRow = page.getByRole("row").filter({ hasText: "Express Gas server" });
    await expect(keyRow.getByText("Gas Station · Testnet", { exact: true })).toBeVisible();
    await expect(keyRow.getByText("tg_test_eeee...eeee", { exact: true })).toBeVisible();
    expect(JSON.stringify(await calls(page))).not.toContain(rawKey);
    expect(JSON.stringify(await calls(page))).not.toContain("keyHash");

    await page.getByRole("button", { name: "I have copied the key" }).click();
    await expect(page.getByText("Save your API key")).toHaveCount(0);
    await expect(page.getByText(rawKey!, { exact: true })).toHaveCount(0);
    await expect(keyRow.getByText("tg_test_eeee...eeee", { exact: true })).toBeVisible();
  });

  test("renders twenty-row pagination, reactive telemetry, and receipt lifecycle distinctions", async ({
    page,
  }, testInfo) => {
    await gotoGas(page, { session: "owner", projectId: "project-gas-owner" });

    await expect(page.getByRole("heading", { name: "Fee telemetry" })).toBeVisible();
    await expect(page.getByText("1.2345678 XLM", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("0.2500000 XLM", { exact: true })).toBeVisible();
    await expect(page.getByText("Unknown", { exact: true }).first()).toBeVisible();
    await expect(activityRows(page)).toHaveCount(21);

    await fixture(page, "reactive-update");
    await expect(page.getByText("1.2345679 XLM", { exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: "Load more activity" }).click();
    await expect(activityRows(page)).toHaveCount(41);
    const pageCalls = (await calls(page)).filter(
      (call) => call.functionName === "gas/queries:listLogsPage",
    );
    expect(
      pageCalls.map((call) => {
        const args = call.args as {
          projectId: string;
          paginationOpts: { numItems: number; cursor: string | null };
        };
        return {
          projectId: args.projectId,
          paginationOpts: {
            numItems: args.paginationOpts.numItems,
            cursor: args.paginationOpts.cursor,
          },
        };
      }),
    ).toEqual([
      {
        projectId: "project-gas-owner",
        paginationOpts: { numItems: 20, cursor: null },
      },
      {
        projectId: "project-gas-owner",
        paginationOpts: { numItems: 20, cursor: "cursor:20" },
      },
    ]);

    const detailButton = page.getByRole("button", {
      name: "View receipt details for gas-e2e-001",
    });
    await detailButton.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Gas receipt detail" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Inner transaction lookup" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Outer FeeBump lookup" })).toBeVisible();
    await expect(page.getByText(/only execution status treated as success/i)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "Gas receipt detail" })).toBeHidden();
    await expect(page.locator(":focus")).toHaveAccessibleName(
      "View receipt details for gas-e2e-001",
    );

    if (testInfo.project.name === "chromium") {
      await page.screenshot({
        path: screenshotPath("gas-station-telemetry-activity-simulated.png"),
        fullPage: true,
      });
      await detailButton.click();
      await page.screenshot({
        path: screenshotPath("gas-station-receipt-simulated.png"),
        fullPage: true,
      });
    }
  });

  test("sanitizes read failures and disconnected warnings", async ({ page }) => {
    await gotoGas(page, {
      session: "owner",
      projectId: "project-gas-owner",
      scenario: "telemetry-read-error",
    });
    await expect(page.getByRole("heading", { name: "Gas Station unavailable" })).toBeVisible();
    await expect(page.getByText("fixture telemetry provider failure", { exact: true })).toHaveCount(
      0,
    );

    await gotoGas(page, { session: "owner", projectId: "project-gas-owner" });
    await setScenario(page, "activity-read-error");
    await expect(page.getByText("Gas activity unavailable", { exact: true })).toBeVisible();
    await expect(page.getByText("fixture activity provider failure", { exact: true })).toHaveCount(
      0,
    );

    await setScenario(page, "default");
    await fixture(page, "disconnect");
    await expect(page.getByText("Potentially stale", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/may be stale while disconnected/i).first()).toBeVisible();
    await fixture(page, "connect");
  });

  test("supports keyboard operation, layout widths, and representative accessibility states", async ({
    page,
  }, testInfo) => {
    await gotoGas(page, { session: "owner", projectId: "project-gas-owner" });

    await page.getByLabel("Daily cap (XLM)").focus();
    await expect(page.locator(":focus")).toHaveAccessibleName("Daily cap (XLM)");
    await page.getByRole("button", { name: "View receipt details for gas-e2e-001" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Gas receipt detail" })).toBeVisible();
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
      await page.getByRole("button", { name: "View receipt details for gas-e2e-001" }).click();
      await page.screenshot({
        path: screenshotPath("gas-station-mobile-simulated.png"),
        fullPage: true,
      });
    }
  });
});
