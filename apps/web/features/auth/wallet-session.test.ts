import assert from "node:assert/strict";
import test from "node:test";

import { restoreWalletSession } from "../../core/wallet/wallet-session.ts";

const address = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const testnet = "Test SDF Network ; September 2015";

type RestorableModule = {
  getAddress?: (params?: { skipRequestAccess?: boolean }) => Promise<{ address: string }>;
  getNetwork?: () => Promise<{ network: string; networkPassphrase: string }>;
  restoreSession?: (expectedAddress: string) => Promise<{ address: string } | null>;
};

function createKitInitializer(selectedModule: RestorableModule) {
  let selectedWallet: string | null = null;
  const kit = {
    setWallet(walletId: string) {
      selectedWallet = walletId;
    },
    get selectedModule() {
      return selectedModule;
    },
  };
  const initializeKit = async () =>
    ({ StellarWalletsKit: kit }) as unknown as typeof import("@creit-tech/stellar-wallets-kit");
  return {
    initializeKit,
    get selectedWallet() {
      return selectedWallet;
    },
  };
}

test("Freighter restoration reads without requesting access and checks Testnet", async () => {
  let skipRequestAccess: boolean | undefined;
  const fixture = createKitInitializer({
    async getAddress(params) {
      skipRequestAccess = params?.skipRequestAccess;
      return { address };
    },
    async getNetwork() {
      return { network: "TESTNET", networkPassphrase: testnet };
    },
  });

  const restored = await restoreWalletSession("freighter", address, fixture.initializeKit, testnet);

  assert.equal(restored, address);
  assert.equal(skipRequestAccess, true);
  assert.equal(fixture.selectedWallet, "freighter");
});

test("restoration rejects a changed account or non-Testnet wallet", async () => {
  const changedAccount = createKitInitializer({
    async getAddress() {
      return { address: "GA54SPC34JL3I57ENALTO2V26XOFFG4VGQLFQXDGF6KJ5TJY7ODY56ST" };
    },
    async getNetwork() {
      return { network: "TESTNET", networkPassphrase: testnet };
    },
  });
  const wrongNetwork = createKitInitializer({
    async getAddress() {
      return { address };
    },
    async getNetwork() {
      return {
        network: "PUBLIC",
        networkPassphrase: "Public Global Stellar Network ; September 2015",
      };
    },
  });

  assert.equal(
    await restoreWalletSession("freighter", address, changedAccount.initializeKit, testnet),
    null,
  );
  assert.equal(
    await restoreWalletSession("cactuslink", address, wrongNetwork.initializeKit, testnet),
    null,
  );
});

test("WalletConnect restoration reuses only a session for the saved account", async () => {
  let requestedAddress: string | null = null;
  const fixture = createKitInitializer({
    async restoreSession(expectedAddress) {
      requestedAddress = expectedAddress;
      return { address };
    },
  });

  const restored = await restoreWalletSession(
    "wallet_connect",
    address,
    fixture.initializeKit,
    testnet,
  );

  assert.equal(restored, address);
  assert.equal(requestedAddress, address);
});
