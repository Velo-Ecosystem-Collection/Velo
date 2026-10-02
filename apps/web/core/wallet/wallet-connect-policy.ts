export const WALLET_CONNECT_TESTNET = "stellar:testnet";

type Session = {
  topic: string;
  expiry: number;
  namespaces: Record<string, { accounts: string[]; methods: string[] }>;
};

export function walletConnectMetadata(appUrl: string) {
  const origin = new URL(appUrl).origin;
  return {
    name: "Velo",
    description: "Infrastructure for builders on Stellar",
    url: origin,
    icons: [new URL("/logo.png", origin).href],
  };
}

export function testnetSessionAddress(session: Session, address?: string): string {
  if (session.expiry * 1000 <= Date.now())
    throw new Error("WalletConnect session expired. Reconnect your wallet.");
  // WalletConnect allows either an unqualified or chain-qualified namespace key.
  const namespace = session.namespaces[WALLET_CONNECT_TESTNET] ?? session.namespaces.stellar;
  if (!namespace?.methods.includes("stellar_signXDR")) {
    throw new Error("WalletConnect wallet must support Testnet transaction signing.");
  }
  const accounts = namespace.accounts
    .filter((account) => account.startsWith(`${WALLET_CONNECT_TESTNET}:`))
    .map((account) => account.slice(`${WALLET_CONNECT_TESTNET}:`.length));
  const selected = address ?? accounts[0];
  if (!selected || !accounts.includes(selected)) {
    throw new Error("WalletConnect session does not authorize this Stellar Testnet account.");
  }
  return selected;
}

export function walletErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return "Wallet request failed";
}

/** Invalidates async work without allowing an older completion to clear newer work. */
export class WalletRequestScope {
  private version = 0;
  invalidate() {
    this.version += 1;
  }
  capture() {
    const version = this.version;
    return () => version === this.version;
  }
}
