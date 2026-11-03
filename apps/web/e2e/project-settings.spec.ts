import { expect, test, type Page } from "@playwright/test";

import { GAS_E2E_STORAGE_KEY, type GasFixtureSession } from "./fixtures/store";

async function openSettings(page: Page, session: GasFixtureSession = "settings-owner") {
  await page.addInitScript(
    ({ storageKey, fixtureSession }) => {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ session: fixtureSession, projectId: "project-gas-owner" }),
      );
    },
    { storageKey: GAS_E2E_STORAGE_KEY, fixtureSession: session },
  );
  await page.goto("/projects/project-gas-owner/settings");
  await expect(page.getByRole("heading", { name: "Project settings" })).toBeVisible();
}

async function openDeleteDialog(page: Page) {
  const deleteSection = page
    .getByRole("heading", { name: "Delete project" })
    .locator("..")
    .locator("..");
  await deleteSection.getByRole("button", { name: "Delete project" }).click();
  return page.getByRole("dialog");
}

async function resolveRetirement(page: Page) {
  await page.waitForFunction(() =>
    window.__veloGasE2E
      ?.getCalls()
      .some(
        (call) => call.functionName === "projects/mutation:retire" && call.status === "pending",
      ),
  );
  await page.evaluate(() => window.__veloGasE2E?.resolveNext("projects/mutation:retire"));
}

test("Project Settings navigation and duplicate-name project slugs are visible", async ({
  page,
}) => {
  await page.addInitScript(
    ({ storageKey }) => {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ session: "settings-owner", projectId: "project-gas-owner" }),
      );
    },
    { storageKey: GAS_E2E_STORAGE_KEY },
  );
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  const switcher = page.getByRole("button", { name: /Owner Gas Project/ }).first();
  await expect(switcher).toContainText("/owner-gas-project");
  await switcher.click();
  const projectChoices = page.getByRole("menuitem", { name: /Owner Gas Project/ });
  await expect(projectChoices).toHaveCount(2);
  await expect(projectChoices.nth(0)).toContainText("/owner-gas-project");
  await expect(projectChoices.nth(1)).toContainText("/member-only-gas-project");
  await page.keyboard.press("Escape");

  const userMenuTrigger = page.getByRole("button", { name: /Settings-owner operator/ });
  await userMenuTrigger.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: "Project Settings" }).click();
  await expect(page).toHaveURL(/\/projects\/project-gas-owner\/settings$/);
  await expect(page.getByRole("heading", { name: "Project settings" })).toBeVisible();
  await expect(page.getByText("project-gas-owner", { exact: true })).toBeVisible();
  await expect(page.getByText("/owner-gas-project", { exact: true })).toBeVisible();
});

test("owners can add, update, and remove project members with accessible mutation errors", async ({
  page,
}) => {
  await openSettings(page);
  const ownerAddress = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
  const memberAddress = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHG";
  const members = page.getByRole("region", { name: "Project members" });

  await expect(members.getByText(ownerAddress, { exact: true })).toBeVisible();
  await expect(
    members.getByRole("listitem").first().getByText("Owner", { exact: true }).first(),
  ).toBeVisible();
  await expect(members.getByRole("button", { name: `Remove ${ownerAddress}` })).toHaveCount(0);

  await members.getByLabel("Stellar wallet address").fill(memberAddress);
  await members.getByRole("button", { name: "Add or update member" }).click();
  await page.waitForFunction(() =>
    window.__veloGasE2E
      ?.getCalls()
      .some(
        (call) =>
          call.functionName === "playground_projects/mutations:upsertMember" &&
          call.status === "pending",
      ),
  );
  await page.evaluate(() =>
    window.__veloGasE2E?.rejectNext(
      "playground_projects/mutations:upsertMember",
      "Member update unavailable",
    ),
  );
  await expect(members.getByRole("alert")).toContainText("Member update unavailable");

  await members.getByLabel("Stellar wallet address").fill(memberAddress);
  await members.getByRole("button", { name: "Add or update member" }).click();
  await page.waitForFunction(() =>
    window.__veloGasE2E
      ?.getCalls()
      .some(
        (call) =>
          call.functionName === "playground_projects/mutations:upsertMember" &&
          call.status === "pending",
      ),
  );
  await page.evaluate(() =>
    window.__veloGasE2E?.resolveNext("playground_projects/mutations:upsertMember"),
  );

  const member = members.getByText(memberAddress, { exact: true });
  await expect(member).toBeVisible();
  await members.getByRole("combobox", { name: `Role for ${memberAddress}` }).selectOption("viewer");
  await page.waitForFunction(
    () =>
      window.__veloGasE2E
        ?.getCalls()
        .filter((call) => call.functionName === "playground_projects/mutations:upsertMember")
        .length === 3,
  );
  await page.evaluate(() =>
    window.__veloGasE2E?.resolveNext("playground_projects/mutations:upsertMember"),
  );
  await expect(members.getByRole("combobox", { name: `Role for ${memberAddress}` })).toHaveValue(
    "viewer",
  );

  await members.getByRole("button", { name: `Remove ${memberAddress}` }).click();
  await page.waitForFunction(() =>
    window.__veloGasE2E
      ?.getCalls()
      .some(
        (call) =>
          call.functionName === "playground_projects/mutations:removeMember" &&
          call.status === "pending",
      ),
  );
  await page.evaluate(() =>
    window.__veloGasE2E?.resolveNext("playground_projects/mutations:removeMember"),
  );
  await expect(members.getByText(memberAddress, { exact: true })).toHaveCount(0);
});

test("retirement dialog traps focus, disables conflicting changes, and keeps errors accessible", async ({
  page,
}) => {
  await openSettings(page);
  const dialog = await openDeleteDialog(page);
  const confirmation = dialog.getByLabel("Type the project name to confirm");
  await expect(confirmation).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  const trigger = page
    .getByRole("heading", { name: "Delete project" })
    .locator("..")
    .locator("..")
    .getByRole("button", { name: "Delete project" });
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(dialog).toBeVisible();

  await confirmation.fill("owner gas project");
  const confirmButton = dialog.getByRole("button", { name: "Delete project" });
  await expect(confirmButton).toBeDisabled();
  await confirmation.fill("Owner Gas Project");
  await confirmButton.click();

  await expect(dialog.getByRole("button", { name: "Deleting project..." })).toBeDisabled();
  await expect(page.locator("#settings-project-name")).toBeDisabled();
  const settingsForm = page.locator("form").filter({ has: page.locator("#settings-project-name") });
  await expect(settingsForm.locator('button[type="submit"]')).toBeDisabled();
  await page.evaluate(() =>
    window.__veloGasE2E?.rejectNext("projects/mutation:retire", "Project changed while deleting"),
  );

  await expect(dialog.getByRole("alert")).toHaveText("Project changed while deleting");
  await expect(dialog).toBeVisible();
  await expect(confirmation).toHaveAttribute("aria-invalid", "true");
});

test("successful retirement selects the remaining project and clears the retired saved selection", async ({
  page,
}) => {
  await openSettings(page);
  await (
    await openDeleteDialog(page)
  )
    .getByLabel("Type the project name to confirm")
    .fill("Owner Gas Project");
  await page.getByRole("dialog").getByRole("button", { name: "Delete project" }).click();
  await resolveRetirement(page);

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(
    page.getByText("Telemetry for Owner Gas Project /member-only-gas-project"),
  ).toBeVisible();
  const selection = await page.evaluate(() =>
    localStorage.getItem(
      "velo:selected-project:GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    ),
  );
  expect(selection).toBe("project-gas-member");
});

test("retiring the last project shows the existing empty state", async ({ page }) => {
  await openSettings(page, "settings-last-project");
  await (
    await openDeleteDialog(page)
  )
    .getByLabel("Type the project name to confirm")
    .fill("Owner Gas Project");
  await page.getByRole("dialog").getByRole("button", { name: "Delete project" }).click();
  await resolveRetirement(page);

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText("No projects available", { exact: true })).toBeVisible();
  const selection = await page.evaluate(() =>
    localStorage.getItem(
      "velo:selected-project:GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    ),
  );
  expect(selection).toBeNull();
});
