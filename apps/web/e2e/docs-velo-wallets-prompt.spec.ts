import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const cardSelector = 'section[aria-labelledby="velo-wallets-integration-prompt-title"]';

async function openWalletsQuickstart(page: import("@playwright/test").Page) {
  await page.goto("/docs");
  const narrowSectionPicker = page.getByLabel("Documentation section", { exact: true });
  if (await narrowSectionPicker.isVisible()) {
    await narrowSectionPicker.selectOption("wallets-overview");
  } else {
    await page
      .getByRole("navigation", { name: "Documentation sections" })
      .getByRole("button", { name: "Wallets Quickstart", exact: true })
      .click();
  }

  await expect(
    page.getByRole("heading", { name: "Wallets Quickstart", exact: true }),
  ).toBeVisible();
  const card = page.locator(cardSelector);
  await expect(card).toBeVisible();
  await expect(card.locator("h2")).toHaveText("Integrate Velo Wallets with your coding agent");
  return card;
}

test("copies the exact preview with keyboard access and announces success", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => Reflect.set(window, "__copiedWalletsPrompt", value),
      },
    });
  });

  const card = await openWalletsQuickstart(page);
  const preview = card.locator("details pre");
  const expectedPrompt = await preview.textContent();
  expect(expectedPrompt).toContain("# Integrate Velo Wallets into this project");
  expect(expectedPrompt).toContain("@carts1024/velo-wallets@1.0.0");

  const copyButton = page.getByRole("button", { name: "Copy Velo Wallets integration prompt" });
  await copyButton.focus();
  await expect(copyButton).toBeFocused();
  await page.keyboard.press("Enter");
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "__copiedWalletsPrompt")))
    .toBe(expectedPrompt);

  const announcement = page.getByText("Velo Wallets integration prompt copied", { exact: true });
  await expect(announcement).toBeAttached();
  await expect(announcement).toHaveAttribute("aria-live", "polite");
  await expect(copyButton).toContainText("Copied");
});

test("announces clipboard errors and offers a selectable manual preview", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("Clipboard permission denied");
        },
      },
    });
  });

  const card = await openWalletsQuickstart(page);
  await page.getByRole("button", { name: "Copy Velo Wallets integration prompt" }).click();
  const announcement = page.getByText("Could not copy Velo Wallets integration prompt", {
    exact: true,
  });
  await expect(announcement).toBeAttached();
  await expect(announcement).toHaveAttribute("aria-live", "polite");
  await expect(
    page.getByText(
      "If clipboard access fails, open the preview and copy the prompt text manually.",
    ),
  ).toBeVisible();

  const summary = card.locator("details > summary");
  await summary.focus();
  await page.keyboard.press("Enter");
  const preview = card.locator("details pre");
  await expect(preview).toBeVisible();
  await preview.selectText();
  expect((await page.evaluate(() => window.getSelection()?.toString()))?.trimEnd()).toBe(
    (await preview.textContent())?.trimEnd(),
  );
});

test("keeps the prompt preview keyboard-selectable when clipboard is unavailable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  });

  const card = await openWalletsQuickstart(page);
  await page.getByRole("button", { name: "Copy Velo Wallets integration prompt" }).click();
  await expect(
    page.getByText("Could not copy Velo Wallets integration prompt", { exact: true }),
  ).toBeAttached();

  const summary = card.locator("details > summary");
  await summary.focus();
  await page.keyboard.press("Enter");
  const preview = card.locator("details pre");
  await preview.selectText();
  expect((await page.evaluate(() => window.getSelection()?.toString()))?.trimEnd()).toBe(
    (await preview.textContent())?.trimEnd(),
  );
});

test("fits narrow screens and has no serious prompt-card accessibility violations", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await openWalletsQuickstart(page);

  const hasHorizontalPageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalPageOverflow).toBe(false);

  const results = await new AxeBuilder({ page }).include(cardSelector).analyze();
  const serious = results.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  expect(serious).toEqual([]);
});
