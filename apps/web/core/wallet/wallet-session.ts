import { assertValidPublicKey } from "@repo/stellar/validation";

type WalletKitInitializer = () => Promise<typeof import("@creit-tech/stellar-wallets-kit")>;

/** Restores only wallet sessions that can be checked without opening a wallet prompt. */
export async function restoreWalletSession(
  walletId: string,
  expectedAddress: string,
  initializeKit: WalletKitInitializer,
  testnetPassphrase: string,
): Promise<string | null> {
  const { StellarWalletsKit } = await initializeKit();
  StellarWalletsKit.setWallet(walletId);
  const selectedModule = StellarWalletsKit.selectedModule;
  let restored: { address: string } | null = null;

  if (walletId === "wallet_connect") {
    const walletConnectModule = selectedModule as typeof selectedModule & {
      restoreSession?: (address: string) => Promise<{ address: string } | null>;
    };
    if (!walletConnectModule.restoreSession) return null;
    restored = await walletConnectModule.restoreSession(expectedAddress);
  } else if (walletId === "freighter" || walletId === "cactuslink") {
    restored = await selectedModule.getAddress({ skipRequestAccess: true });
    if (!selectedModule.getNetwork) return null;
    const network = await selectedModule.getNetwork();
    if (network.networkPassphrase !== testnetPassphrase) return null;
  } else {
    return null;
  }

  if (!restored || restored.address !== expectedAddress) return null;
  assertValidPublicKey(restored.address);

  const { activeAddress } = await import("@creit-tech/stellar-wallets-kit/state");
  activeAddress.value = restored.address;
  return restored.address;
}
