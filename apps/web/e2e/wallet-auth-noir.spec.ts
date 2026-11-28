import { expect, test } from "@playwright/test";
import { Keypair, Networks, TransactionBuilder, WebAuth } from "@stellar/stellar-sdk";

test("Noir signs a Testnet SEP-10 challenge and restores an authorized session", async ({
  page,
}) => {
  const server = Keypair.random();
  const wallet = Keypair.random();
  const address = wallet.publicKey();
  const challengeId = "N".repeat(43);
  const domain = "localhost";
  const challenge = WebAuth.buildChallengeTx(
    server,
    address,
    domain,
    300,
    Networks.TESTNET,
    domain,
  );
  const signed = TransactionBuilder.fromXDR(challenge, Networks.TESTNET);
  signed.sign(wallet);
  const signedChallenge = signed.toXDR();
  let challengeRequests = 0;
  let sessionRequests = 0;

  await page.addInitScript(
    ({ address, challenge, signedChallenge, testnet }) => {
      window.noir = {
        stellar: {
          isNoir: true,
          isConnected: async () => ({ isConnected: true }),
          isAllowed: async () => ({
            isAllowed: localStorage.getItem("noir-fixture-allowed") === "1",
          }),
          requestAccess: async () => {
            localStorage.setItem("noir-fixture-allowed", "1");
            return { address };
          },
          getAddress: async () => ({ address }),
          getNetwork: async () => ({ network: "Testnet", networkPassphrase: testnet }),
          signTransaction: async (xdr, opts) => {
            if (
              xdr !== challenge ||
              opts?.address !== address ||
              opts.networkPassphrase !== testnet
            ) {
              throw new Error("Unexpected Noir signing request");
            }
            return { signedTxXdr: signedChallenge, signerAddress: address };
          },
          signAuthEntry: async () => {
            throw new Error("Unexpected authorization-entry request");
          },
          signMessage: async () => {
            throw new Error("Unexpected message request");
          },
        },
      };
    },
    { address, challenge, signedChallenge, testnet: Networks.TESTNET },
  );

  await page.route("**/api/auth/wallet/challenge", (route) => {
    challengeRequests++;
    expect(route.request().postDataJSON()).toEqual({ address });
    return route.fulfill({ json: { challengeId, challenge, expiresAt: Date.now() + 300_000 } });
  });
  await page.route("**/api/auth/wallet/session", (route) => {
    sessionRequests++;
    expect(route.request().postDataJSON()).toEqual({ address, challengeId, signedChallenge });
    const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }));
    return route.fulfill({
      json: { address, token: `fixture.${payload.toString("base64url")}.fixture` },
    });
  });

  await page.goto("/dashboard");
  await expect(page.getByTestId("wallet-status")).toHaveText("ready");
  await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
  await page.getByText("Noir", { exact: true }).click();
  await expect(page.getByTestId("auth-status")).toHaveText("authenticated");
  expect(challengeRequests).toBe(1);
  expect(sessionRequests).toBe(1);

  await page.reload();
  await expect(page.getByTestId("wallet-status")).toHaveText("connected");
  await expect(page.getByTestId("auth-status")).toHaveText("authenticated");
  expect(challengeRequests).toBe(1);

  await page.evaluate(() => localStorage.removeItem("noir-fixture-allowed"));
  await page.reload();
  await expect(page.getByTestId("wallet-status")).toHaveText("stale");
  await expect(page.getByTestId("auth-status")).toHaveText("unauthenticated");
  expect(await page.evaluate(() => localStorage.getItem("noir-fixture-allowed"))).toBeNull();
});

test("Velo asks the user to switch Noir to Testnet before login", async ({ page }) => {
  await page.addInitScript(
    ({ networkPassphrase, address }) => {
      Object.defineProperty(window, "noir", {
        value: {
          stellar: {
            isNoir: true,
            requestAccess: async () => ({ address }),
            getNetwork: async () => ({ network: "Mainnet", networkPassphrase }),
          },
        },
      });
    },
    { networkPassphrase: Networks.PUBLIC, address: Keypair.random().publicKey() },
  );
  let challengeRequests = 0;
  await page.route("**/api/auth/wallet/challenge", (route) => {
    challengeRequests++;
    return route.abort();
  });

  await page.goto("/dashboard");
  await expect(page.getByTestId("wallet-status")).toHaveText("ready");
  await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
  await page.getByText("Noir", { exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Switch Noir to Testnet, then reconnect.");
  await expect(page.getByTestId("auth-status")).toHaveText("unauthenticated");
  expect(challengeRequests).toBe(0);
});
