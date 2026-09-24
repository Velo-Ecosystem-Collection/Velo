import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const cardSelector = 'section[aria-labelledby="payment-intents-integration-prompt-title"]';

async function openSection(page: import("@playwright/test").Page, title: string) {
  await page
    .getByRole("navigation", { name: "Documentation sections" })
    .getByRole("button", { name: title, exact: true })
    .click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  const card = page.locator(cardSelector);
  await expect(card).toBeVisible();
  expect(await card.evaluate((element) => element.previousElementSibling?.tagName)).toBe("P");
  return card;
}

test("both sections copy the same prompt with keyboard access and an accessible announcement", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          const values = (Reflect.get(window, "__copiedPaymentIntentsPrompts") as string[]) ?? [];
          Reflect.set(window, "__copiedPaymentIntentsPrompts", [...values, value]);
        },
      },
    });
  });

  await page.goto("/docs");
  const checkoutCard = await openSection(page, "Checkout Sessions");
  const checkoutPreview = checkoutCard.locator("details pre");
  const expectedPrompt = await checkoutPreview.textContent();
  expect(expectedPrompt).toContain("# Integrate Velo Payment Intents into this project.");
  expect(await checkoutCard.locator("h2").textContent()).toBe(
    "Integrate Payment Intents with your coding agent",
  );

  const copyButton = page.getByRole("button", {
    name: "Copy Payment Intents integration prompt",
  });
  await copyButton.focus();
  await expect(copyButton).toBeFocused();
  await page.keyboard.press("Enter");
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "__copiedPaymentIntentsPrompts")))
    .toEqual([expectedPrompt]);
  const announcement = page.getByText("Payment Intents integration prompt copied", { exact: true });
  await expect(announcement).toBeAttached();
  await expect(announcement).toHaveAttribute("aria-live", "polite");
  await expect(copyButton).toContainText("Copied");

  const paymentIntentsCard = await openSection(page, "Payment Intents");
  const paymentIntentsPreview = paymentIntentsCard.locator("details pre");
  await expect(paymentIntentsPreview).toHaveText(expectedPrompt ?? "");
  await page.getByRole("button", { name: "Copy Payment Intents integration prompt" }).click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "__copiedPaymentIntentsPrompts")))
    .toEqual([expectedPrompt, expectedPrompt]);
});

test("reports clipboard denial in both sections and offers manual-copy instructions", async ({
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

  await page.goto("/docs");
  for (const title of ["Checkout Sessions", "Payment Intents"]) {
    await openSection(page, title);
    await page.getByRole("button", { name: "Copy Payment Intents integration prompt" }).click();

    const announcement = page.getByText("Could not copy Payment Intents integration prompt", {
      exact: true,
    });
    await expect(announcement).toBeAttached();
    await expect(announcement).toHaveAttribute("aria-live", "polite");
    await expect(
      page.getByText(
        "If clipboard access fails, open the preview and copy the prompt text manually.",
      ),
    ).toBeVisible();
  }
});

test("keeps the preview keyboard accessible and selectable when clipboard is unavailable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
  });

  await page.goto("/docs");
  for (const title of ["Checkout Sessions", "Payment Intents"]) {
    const card = await openSection(page, title);
    await page.getByRole("button", { name: "Copy Payment Intents integration prompt" }).click();
    await expect(
      page.getByText("Could not copy Payment Intents integration prompt", { exact: true }),
    ).toBeAttached();

    const summary = card.locator("details > summary");
    await summary.focus();
    await page.keyboard.press("Enter");
    const preview = card.locator("details pre");
    await expect(preview).toBeVisible();
    await preview.selectText();
    const selectedText = await page.evaluate(() => window.getSelection()?.toString());
    expect(selectedText?.trimEnd()).toBe((await preview.textContent())?.trimEnd());
  }
});

test("both section cards fit narrow screens and have no serious accessibility violations", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/docs");

  const sections = [
    { title: "Checkout Sessions", id: "checkouts" },
    { title: "Payment Intents", id: "intents" },
  ] as const;
  for (const { title, id } of sections) {
    await page.getByLabel("Documentation section", { exact: true }).selectOption(id);
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
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
  }
});
