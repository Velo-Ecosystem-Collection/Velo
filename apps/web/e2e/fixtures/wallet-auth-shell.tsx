"use client";
import { useWallet } from "@/core/wallet/wallet-provider";
import { useConvexAuth } from "convex/react";

import type { ReactNode } from "react";
export function AppShell(_props: { children: ReactNode }) {
  const wallet = useWallet();
  const auth = useConvexAuth();
  return (
    <main>
      <p data-testid="wallet-status">{wallet.status}</p>
      <p data-testid="auth-status">{auth.isAuthenticated ? "authenticated" : "unauthenticated"}</p>
      {auth.isAuthenticated && <p>Protected console available</p>}
      <p role="status">{wallet.error}</p>
      <button onClick={() => void wallet.connect()}>Connect wallet</button>
      <button onClick={() => void wallet.disconnect()}>Disconnect wallet</button>
    </main>
  );
}

export function useSelectedProject() {
  throw new Error("Project UI is outside the authentication fixture");
}
