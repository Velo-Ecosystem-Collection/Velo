import { expect, test } from "@playwright/test";

const address = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
function result() {
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString("base64url");
  return { address, token: `fixture.${payload}.fixture` };
}
test.beforeEach(async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByTestId("wallet-status")).toHaveText("ready");
});

test("one wallet approval starts an authenticated console session", async ({ page }) => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/auth/wallet/session", async (route) => {
    await gate;
    await route.fulfill({ json: result() });
  });
  await page.getByRole("button", { name: "Connect wallet", exact: true }).dblclick();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await page.getByText("Approve simulated pairing").click();
  await expect(page.getByTestId("wallet-status")).toHaveText("connected");
  await expect(page.getByTestId("auth-status")).toHaveText("unauthenticated");
  release();
  await expect(page.getByTestId("auth-status")).toHaveText("authenticated");
  await expect(page.getByText("Protected console available")).toBeVisible();
  await page.getByRole("button", { name: "Disconnect wallet", exact: true }).click();
  await expect(page.getByTestId("auth-status")).toHaveText("unauthenticated");
  expect(await page.evaluate(() => sessionStorage.getItem("velo:convex-token"))).toBeNull();
});

test("cancelling wallet connection leaves login usable", async ({ page }) => {
  await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
  await page.getByText("Cancel simulated pairing").click();
  await expect(page.getByTestId("wallet-status")).toHaveText("rejected");
  await page.route("**/api/auth/wallet/session", (route) => route.fulfill({ json: result() }));
  await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
  await page.getByText("Approve simulated pairing").click();
  await expect(page.getByTestId("wallet-status")).toHaveText("connected");
  await expect(page.getByTestId("auth-status")).toHaveText("authenticated");
});

test("disconnect invalidates a pending wallet session response", async ({ page }) => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/auth/wallet/session", async (route) => {
    await gate;
    await route.fulfill({ json: result() });
  });
  await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
  const request = page.waitForRequest("**/api/auth/wallet/session");
  await page.getByText("Approve simulated pairing").click();
  await request;
  await page.getByRole("button", { name: "Disconnect wallet", exact: true }).click();
  const response = page.waitForResponse("**/api/auth/wallet/session");
  release();
  await response;
  await expect(page.getByTestId("auth-status")).toHaveText("unauthenticated");
  expect(await page.evaluate(() => sessionStorage.getItem("velo:convex-token"))).toBeNull();
});

test("reload requires reconnect and then reuses a valid address-bound token", async ({ page }) => {
  let sessions = 0;
  await page.route("**/api/auth/wallet/session", async (route) => {
    sessions++;
    await route.fulfill({ json: result() });
  });
  await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
  await page.getByText("Approve simulated pairing").click();
  await expect(page.getByTestId("auth-status")).toHaveText("authenticated");
  await page.reload();
  await expect(page.getByTestId("wallet-status")).toHaveText("stale");
  await expect(page.getByTestId("auth-status")).toHaveText("unauthenticated");
  await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
  await page.getByText("Approve simulated pairing").click();
  await expect(page.getByTestId("auth-status")).toHaveText("authenticated");
  expect(sessions).toBe(1);
});
