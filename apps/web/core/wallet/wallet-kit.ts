import { env } from "../config/env";
import { walletConnectMetadata } from "./wallet-connect-policy.ts";

let initialization: Promise<typeof import("@creit-tech/stellar-wallets-kit")> | undefined;

export function initializeWalletKit() {
  initialization ??= (async () => {
    const [kit, { defaultModules }] = await Promise.all([
      import("@creit-tech/stellar-wallets-kit"),
      import("@creit-tech/stellar-wallets-kit/modules/utils"),
    ]);
    const modules = defaultModules();
    if (env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID) {
      const [{ VeloWalletConnectModule }, { WalletConnectTargetChain }] = await Promise.all([
        import("./wallet-connect-module"),
        import("@creit-tech/stellar-wallets-kit/modules/wallet-connect"),
      ]);
      modules.push(
        new VeloWalletConnectModule({
          projectId: env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
          metadata: walletConnectMetadata(env.NEXT_PUBLIC_APP_URL),
          allowedChains: [WalletConnectTargetChain.TESTNET],
        }),
      );
    }
    kit.StellarWalletsKit.init({
      modules,
      network: kit.Networks.TESTNET,
      authModal: { showInstallLabel: true, hideUnsupportedWallets: false },
    });
    return kit;
  })().catch((error: unknown) => {
    initialization = undefined;
    throw error;
  });
  return initialization;
}
