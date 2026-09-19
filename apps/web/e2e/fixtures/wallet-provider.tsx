"use client";

import { useSyncExternalStore, type ReactNode } from "react";

import { getGasFixtureStore, installGasFixtureBrowserApi } from "./store";

export type WalletErrorCode =
  | "WALLET_NOT_CONNECTED"
  | "WALLET_UNAVAILABLE"
  | "WALLET_REJECTED"
  | "WALLET_UNSUPPORTED"
  | "WALLET_STALE_SESSION"
  | "WALLET_NETWORK_MISMATCH"
  | "WALLET_SIGNING_FAILED";

export class WalletError extends Error {
  constructor(
    public readonly code: WalletErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WalletError";
  }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  installGasFixtureBrowserApi(getGasFixtureStore());
  return children;
}

export function useWallet() {
  const store = getGasFixtureStore();
  installGasFixtureBrowserApi(store);
  useSyncExternalStore(store.subscribe, store.getRevision, store.getRevision);
  const snapshot = store.getWalletSnapshot();

  return {
    ...snapshot,
    connect: store.connect,
    disconnect: store.disconnect,
    signTransaction: store.signTransaction,
    signMessage: store.signMessage,
  };
}
