import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

async function openCheckoutDocs(page: import("@playwright/test").Page) {
  await page.goto("/docs");
  await page
    .getByRole("navigation", { name: "Documentation sections" })
    .getByRole("button", { name: "Checkout Sessions", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Checkout Sessions", exact: true })).toBeVisible();
}

const cardSelector = 'section[aria-labelledby="checkout-sessions-integration-prompt-title"]';

test("copies the exact Checkout prompt with keyboard access and announces success", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          Reflect.set(window, "__copiedCheckoutPrompt", value);
        },
      },
    });
  });

  await openCheckoutDocs(page);
  const card = page.locator(cardSelector);
  const preview = card.locator("details pre");
  const expectedPrompt = await preview.textContent();
  expect(expectedPrompt).toContain("# Integrate Velo Checkout Sessions into this project");

  const copyButton = page.getByRole("button", {
    name: "Copy Checkout Sessions integration prompt",
  });
  await copyButton.focus();
  await expect(copyButton).toBeFocused();
  await page.keyboard.press("Enter");

  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "__copiedCheckoutPrompt")))
    .toBe(expectedPrompt);
  const announcement = page.getByText("Checkout Sessions integration prompt copied", {
    exact: true,
  });
  await expect(announcement).toBeAttached();
  await expect(announcement).toHaveAttribute("aria-live", "polite");
  await expect(copyButton).toContainText("Copied");
});

test("announces clipboard permission denial and provides manual-copy instructions", async ({
  page,
}) => {
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

  await openCheckoutDocs(page);
  await page.getByRole("button", { name: "Copy Checkout Sessions integration prompt" }).click();

  const announcement = page.getByText("Could not copy Checkout Sessions integration prompt", {
    exact: true,
  });
  await expect(announcement).toBeAttached();
  await expect(announcement).toHaveAttribute("aria-live", "polite");
  await expect(
    page.getByText(
      "If clipboard access fails, open the preview and copy the prompt text manually.",
    ),
  ).toBeVisible();
});

test("handles an unavailable clipboard and keeps the manual preview selectable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
  });

  await openCheckoutDocs(page);
  await page.getByRole("button", { name: "Copy Checkout Sessions integration prompt" }).click();
  await expect(
    page.getByText("Could not copy Checkout Sessions integration prompt", { exact: true }),
  ).toBeAttached();

  const card = page.locator(cardSelector);
  const summary = card.locator("details > summary");
  await summary.focus();
  await page.keyboard.press("Enter");
  const preview = card.locator("details pre");
  await expect(preview).toBeVisible();
  await preview.selectText();
  const selectedText = await page.evaluate(() => window.getSelection()?.toString());
  expect(selectedText?.trimEnd()).toBe((await preview.textContent())?.trimEnd());
});

test("fits a narrow viewport without page overflow and has no serious accessibility violations", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/docs");
  await page.getByLabel("Documentation section", { exact: true }).selectOption("checkouts");
  await expect(page.getByRole("heading", { name: "Checkout Sessions", exact: true })).toBeVisible();
  await expect(page.locator(cardSelector)).toBeVisible();

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
