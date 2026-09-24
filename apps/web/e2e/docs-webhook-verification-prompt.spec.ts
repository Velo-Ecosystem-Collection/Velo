import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const cardSelector = 'section[aria-labelledby="webhook-verification-integration-prompt-title"]';

async function openWebhookSection(page: import("@playwright/test").Page) {
  await page.goto("/docs");
  const narrowSectionPicker = page.getByLabel("Documentation section", { exact: true });
  if (await narrowSectionPicker.isVisible()) {
    await narrowSectionPicker.selectOption("webhooks");
  } else {
    await page
      .getByRole("navigation", { name: "Documentation sections" })
      .getByRole("button", { name: "Webhook Verification", exact: true })
      .click();
  }
  await expect(
    page.getByRole("heading", { name: "Webhook Verification", exact: true }),
  ).toBeVisible();
  const card = page.locator(cardSelector);
  await expect(card).toBeVisible();
  expect(
    await card.evaluate((element) => element.parentElement?.previousElementSibling?.tagName),
  ).toBe("P");
  await expect(card.locator("h2")).toHaveText(
    "Integrate Webhook Verification with your coding agent",
  );
  return card;
}

test("copies the exact preview with keyboard access and announces success", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => Reflect.set(window, "__copiedWebhookPrompt", value),
      },
    });
  });

  const card = await openWebhookSection(page);
  const preview = card.locator("details pre");
  const expectedPrompt = await preview.textContent();
  expect(expectedPrompt).toContain("# Integrate Velo Webhook Verification into this project");
  expect(expectedPrompt).toContain('express.raw({ type: "application/json" })');

  const copyButton = page.getByRole("button", {
    name: "Copy Webhook Verification integration prompt",
  });
  await copyButton.focus();
  await expect(copyButton).toBeFocused();
  await page.keyboard.press("Enter");
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "__copiedWebhookPrompt")))
    .toBe(expectedPrompt);

  const announcement = page.getByText("Webhook Verification integration prompt copied", {
    exact: true,
  });
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

  const card = await openWebhookSection(page);
  await page.getByRole("button", { name: "Copy Webhook Verification integration prompt" }).click();
  const announcement = page.getByText("Could not copy Webhook Verification integration prompt", {
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
  const selectedText = await page.evaluate(() => window.getSelection()?.toString());
  expect(selectedText?.trimEnd()).toBe((await preview.textContent())?.trimEnd());
});

test("handles unavailable clipboard and keeps a keyboard-selectable preview", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  });

  const card = await openWebhookSection(page);
  await page.getByRole("button", { name: "Copy Webhook Verification integration prompt" }).click();
  await expect(
    page.getByText("Could not copy Webhook Verification integration prompt", { exact: true }),
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
  await openWebhookSection(page);

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
