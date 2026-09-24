import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

async function openGasDocs(page: import("@playwright/test").Page) {
  await page.goto("/docs");
  await page
    .getByRole("navigation", { name: "Documentation sections" })
    .getByRole("button", { name: "Gas Station", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Gas Station", exact: true })).toBeVisible();
}

test("copies the exact prompt from the keyboard and announces success", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          Reflect.set(window, "__copiedGasPrompt", value);
        },
      },
    });
  });

  await openGasDocs(page);
  const preview = page.locator("details pre");
  const expectedPrompt = await preview.textContent();
  expect(expectedPrompt).toContain("# Integrate Velo Gas Station into this project");

  const copyButton = page.getByRole("button", { name: "Copy Gas Station integration prompt" });
  await copyButton.focus();
  await expect(copyButton).toBeFocused();
  await page.keyboard.press("Enter");

  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "__copiedGasPrompt")))
    .toBe(expectedPrompt);
  const announcement = page.getByText("Gas Station integration prompt copied", { exact: true });
  await expect(announcement).toBeAttached();
  await expect(announcement).toHaveAttribute("aria-live", "polite");
  await expect(copyButton).toContainText("Copied");
});

test("announces clipboard denial and points users to the manual preview", async ({ page }) => {
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

  await openGasDocs(page);
  await page.getByRole("button", { name: "Copy Gas Station integration prompt" }).click();

  const announcement = page.getByText("Could not copy Gas Station integration prompt", {
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

test("opens and selects the preview with keyboard access at a narrow width", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/docs");
  await page.getByLabel("Documentation section", { exact: true }).selectOption("gas-station");
  await expect(page.getByRole("heading", { name: "Gas Station", exact: true })).toBeVisible();

  const previewToggle = page.locator("details > summary");
  await previewToggle.focus();
  await page.keyboard.press("Enter");
  const details = page.locator("details");
  await expect(details).toHaveJSProperty("open", true);

  const promptText = page.locator("details pre");
  await expect(promptText).toBeVisible();
  await promptText.selectText();
  const selectedText = await page.evaluate(() => window.getSelection()?.toString());
  expect(selectedText?.trimEnd()).toBe((await promptText.textContent())?.trimEnd());

  const hasHorizontalPageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalPageOverflow).toBe(false);

  const results = await new AxeBuilder({ page })
    .include('[aria-labelledby="gas-station-integration-prompt-title"]')
    .analyze();
  const serious = results.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  expect(serious).toEqual([]);
});
