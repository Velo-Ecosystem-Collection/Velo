import { expect, test } from "@playwright/test";

import { GAS_E2E_STORAGE_KEY } from "./fixtures/store";

test("create project form stays tappable and fits a narrow mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
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

  await page.getByRole("button", { name: "Toggle Sidebar" }).tap();
  const mobileSidebar = page.getByRole("dialog");
  await expect(mobileSidebar).toBeVisible();
  await mobileSidebar.getByRole("button", { name: /Owner Gas Project/ }).tap();
  await page.getByRole("menuitem", { name: "Create project" }).tap();

  await expect(page).toHaveURL(/\/projects\/new$/);
  await expect(mobileSidebar).toBeHidden();
  await expect(page.getByRole("heading", { name: "Create project" })).toBeVisible();

  const name = page.getByLabel("Project name");
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).pointerEvents))
    .toBe("auto");
  await name.tap();
  await expect(name).toBeFocused();
  await name.fill("Mobile project");

  const slug = page.getByLabel("Slug");
  await slug.tap();
  await expect(slug).toBeFocused();
  await slug.fill("mobile-project");

  const description = page.getByLabel("Description");
  await description.tap();
  await expect(description).toBeFocused();
  await description.fill("A project created from a phone.");

  const website = page.getByLabel("Website");
  await website.tap();
  await expect(website).toBeFocused();
  await website.fill("https://example.org");

  for (const field of [name, slug, description, website]) {
    const box = await field.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }

  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);

  const formBox = await page.locator("form").boundingBox();
  const previewBox = await page.getByText("Metadata preview", { exact: true }).boundingBox();
  if (!formBox || !previewBox) {
    throw new Error("Expected the project form and metadata preview to have visible bounds");
  }
  expect(previewBox.y).toBeGreaterThan(formBox.y + formBox.height);
});
