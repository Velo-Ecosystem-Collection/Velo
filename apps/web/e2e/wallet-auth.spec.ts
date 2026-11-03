import { expect, test } from "@playwright/test";

const address = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const challenge = "fixture-wallet-challenge-xdr";
const challengeId = "C".repeat(43);
function result() {
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString("base64url");
  return { address, token: `fixture.${payload}.fixture` };
}
test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/wallet/challenge", (route) =>
    route.fulfill({ json: { challengeId, challenge, expiresAt: Date.now() + 300_000 } }),
  );
  await page.goto("/dashboard");
  await expect(page.getByTestId("wallet-status")).toHaveText("ready");
});

async function connectAndApproveChallenge(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
  await page.getByText("Approve simulated pairing").click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await page.getByText("Approve simulated signature").click();
}

test("a wallet challenge signature starts an authenticated console session", async ({ page }) => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/auth/wallet/session", async (route) => {
    await gate;
    await route.fulfill({ json: result() });
  });
  await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await page.getByText("Approve simulated pairing").click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await page.getByText("Approve simulated signature").click();
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
  await connectAndApproveChallenge(page);
  await expect(page.getByTestId("wallet-status")).toHaveText("connected");
  await expect(page.getByTestId("auth-status")).toHaveText("authenticated");
});

test("rejecting the wallet signature cancels auth and allows a retry", async ({ page }) => {
  let sessions = 0;
  await page.route("**/api/auth/wallet/session", (route) => {
    sessions++;
    return route.fulfill({ json: result() });
  });
  await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
  await page.getByText("Approve simulated pairing").click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await page.getByText("Cancel simulated signature").click();
  await expect(page.getByTestId("wallet-status")).toHaveText("rejected");
  expect(sessions).toBe(0);

  await connectAndApproveChallenge(page);
  await expect(page.getByTestId("auth-status")).toHaveText("authenticated");
  expect(sessions).toBe(1);
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
  await page.getByText("Approve simulated pairing").click();
  const request = page.waitForRequest("**/api/auth/wallet/session");
  await page.getByText("Approve simulated signature").click();
  await request;
  await page.getByRole("button", { name: "Disconnect wallet", exact: true }).click();
  const response = page.waitForResponse("**/api/auth/wallet/session");
  release();
  await response;
  await expect(page.getByTestId("auth-status")).toHaveText("unauthenticated");
  expect(await page.evaluate(() => sessionStorage.getItem("velo:convex-token"))).toBeNull();
});

test("reload restores the selected wallet and reuses its valid address-bound token", async ({
  page,
}) => {
  let sessions = 0;
  await page.route("**/api/auth/wallet/session", async (route) => {
    sessions++;
    await route.fulfill({ json: result() });
  });
  await connectAndApproveChallenge(page);
  await expect(page.getByTestId("auth-status")).toHaveText("authenticated");
  await page.reload();
  await expect(page.getByTestId("wallet-status")).toHaveText("connected");
  await expect(page.getByTestId("auth-status")).toHaveText("authenticated");
  expect(sessions).toBe(1);
});

test("an address-only token from the old signing key requires a fresh signature", async ({
  page,
}) => {
  let sessions = 0;
  await page.route("**/api/auth/wallet/session", async (route) => {
    sessions++;
    await route.fulfill({ json: result() });
  });
  await connectAndApproveChallenge(page);
  await expect(page.getByTestId("auth-status")).toHaveText("authenticated");
  expect(sessions).toBe(1);

  await page.evaluate(() => {
    const stored = JSON.parse(sessionStorage.getItem("velo:convex-token") ?? "null");
    sessionStorage.setItem(
      "velo:convex-token",
      JSON.stringify({ ...stored, keyId: "velo-wallet-auth-v2" }),
    );
  });
  await page.reload();
  await expect(page.getByTestId("wallet-status")).toHaveText("connected");
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await page.getByText("Approve simulated signature").click();
  await expect(page.getByTestId("auth-status")).toHaveText("authenticated");
  expect(sessions).toBe(2);
});

test("reload does not restore a wallet when its active account differs", async ({ page }) => {
  await page.route("**/api/auth/wallet/session", (route) => route.fulfill({ json: result() }));
  await connectAndApproveChallenge(page);
  await expect(page.getByTestId("auth-status")).toHaveText("authenticated");

  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("velo:last-wallet-session") ?? "{}");
    localStorage.setItem(
      "velo:last-wallet-session",
      JSON.stringify({
        ...saved,
        address: "GA54SPC34JL3I57ENALTO2V26XOFFG4VGQLFQXDGF6KJ5TJY7ODY56ST",
      }),
    );
  });
  await page.reload();

  await expect(page.getByTestId("wallet-status")).toHaveText("stale");
  await expect(page.getByTestId("auth-status")).toHaveText("unauthenticated");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
