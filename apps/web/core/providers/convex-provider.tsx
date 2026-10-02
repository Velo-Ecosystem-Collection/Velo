"use client";

import { useWallet } from "@/core/wallet/wallet-provider";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { usePathname } from "next/navigation";
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  isCurrentWalletAuthKeyId,
  isPublicRoute,
  shouldReportWalletAuthenticated,
  shouldReuseWalletToken,
} from "../auth/convex-auth";
import { WALLET_AUTH_KEY_ID } from "../auth/wallet-auth-constants";
import { env } from "../config/env";
import { WalletRequestScope } from "../wallet/wallet-connect-policy";

const convex = new ConvexReactClient(env.NEXT_PUBLIC_CONVEX_URL!, {
  initialAuthTokenReuse: true,
});
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

type WalletToken = {
  token: string;
  address: string;
  keyId?: string;
};

function jwtExpiresAt(token: string) {
  const [, payload] = token.split(".");
  if (!payload) {
    return 0;
  }

  try {
    const claims = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as {
      exp?: number;
    };
    return claims.exp ? claims.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

function readStoredConvexToken(): WalletToken | null {
  if (typeof window === "undefined") {
    return null;
  }
  const stored = window.sessionStorage.getItem("velo:convex-token");
  if (!stored) {
    return null;
  }
  try {
    return JSON.parse(stored) as WalletToken;
  } catch {
    window.sessionStorage.removeItem("velo:convex-token");
    return null;
  }
}

function writeStoredConvexToken(token: WalletToken | null) {
  if (typeof window === "undefined") {
    return;
  }
  if (token) {
    window.sessionStorage.setItem("velo:convex-token", JSON.stringify(token));
  } else {
    window.sessionStorage.removeItem("velo:convex-token");
  }
}

function validTokenForWallet(
  token: WalletToken | null,
  address: string | null,
): token is WalletToken {
  if (!token || !address || token.address !== address) {
    return false;
  }

  return (
    isCurrentWalletAuthKeyId(token.keyId) &&
    jwtExpiresAt(token.token) - Date.now() > TOKEN_REFRESH_MARGIN_MS
  );
}

function useWalletConvexAuth() {
  const { address: walletAddress, status: walletStatus, disconnect, signTransaction } = useWallet();
  const tokenRef = useRef<WalletToken | null>(null);
  const pendingPromiseRef = useRef<Promise<string | null> | null>(null);
  const requestScope = useRef(new WalletRequestScope());
  const identity = `${walletStatus}:${walletAddress ?? ""}`;
  const previousIdentity = useRef(identity);
  if (previousIdentity.current !== identity) {
    previousIdentity.current = identity;
    requestScope.current.invalidate();
    tokenRef.current = null;
    pendingPromiseRef.current = null;
  }
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const [tokenState, setTokenState] = useState<WalletToken | null>(null);

  useEffect(
    () => () => {
      requestScope.current.invalidate();
      pendingPromiseRef.current = null;
    },
    [],
  );

  // Sync tokenState with sessionStorage on mount / wallet address change
  useEffect(() => {
    setTokenState(walletAddress ? readStoredConvexToken() : null);
  }, [walletAddress]);

  // Pairing cannot authenticate; retain an address-bound cache until reconnect finishes.
  // Clear it on rejection, disconnect, or an unavailable/error state.
  useEffect(() => {
    if (
      walletStatus !== "connected" &&
      walletStatus !== "initializing" &&
      walletStatus !== "stale" &&
      walletStatus !== "connecting"
    ) {
      tokenRef.current = null;
      pendingPromiseRef.current = null;
      writeStoredConvexToken(null);
      setTokenState(null);
    }
  }, [walletStatus]);

  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      if (walletStatus !== "connected") {
        return null;
      }

      if (!walletAddress) {
        tokenRef.current = null;
        pendingPromiseRef.current = null;
        return null;
      }

      const cached = tokenRef.current || readStoredConvexToken();
      if (
        validTokenForWallet(cached, walletAddress) &&
        shouldReuseWalletToken({ forceRefreshToken, hasValidToken: true })
      ) {
        tokenRef.current = cached;
        setTokenState(cached);
        return cached.token;
      }

      if (isPublicRoute(pathnameRef.current) && !forceRefreshToken) {
        return null;
      }

      if (pendingPromiseRef.current) {
        return pendingPromiseRef.current;
      }

      const isCurrent = requestScope.current.capture();
      const fetchPromise = (async () => {
        try {
          const challengeResponse = await fetch("/api/auth/wallet/challenge", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ address: walletAddress }),
          });
          if (!challengeResponse.ok) {
            throw new Error("Unable to create wallet auth challenge");
          }
          const challenge = (await challengeResponse.json()) as {
            challenge: string;
          };
          if (!isCurrent()) return null;
          const signedTxXdr = await signTransaction(challenge.challenge);
          if (!isCurrent()) return null;
          const verifyResponse = await fetch("/api/auth/wallet/verify", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              address: walletAddress,
              challenge: signedTxXdr,
            }),
          });
          if (!verifyResponse.ok) {
            const errorBody = (await verifyResponse.json().catch(() => null)) as {
              error?: string;
            } | null;
            throw new Error(errorBody?.error ?? "Unable to verify wallet auth signature");
          }
          const authResult = (await verifyResponse.json()) as { token: string; address: string };
          if (!isCurrent()) return null;
          if (authResult.address !== walletAddress) throw new Error("Wallet auth address mismatch");
          const result: WalletToken = {
            ...authResult,
            keyId: WALLET_AUTH_KEY_ID,
          };
          tokenRef.current = result;
          writeStoredConvexToken(result);
          setTokenState(result);
          return result.token;
        } catch {
          if (!isCurrent()) return null;
          tokenRef.current = null;
          writeStoredConvexToken(null);
          setTokenState(null);
          void disconnect().catch(() => {});
          return null;
        } finally {
          if (isCurrent()) pendingPromiseRef.current = null;
        }
      })();

      pendingPromiseRef.current = fetchPromise;
      return fetchPromise;
    },
    [disconnect, signTransaction, walletAddress, walletStatus],
  );

  const hasValidToken = validTokenForWallet(tokenState, walletAddress);

  // Convex only calls fetchAccessToken after the auth provider reports an
  // authenticated user. Bootstrap the wallet JWT separately so that the
  // provider can safely remain unauthenticated until a token exists.
  useEffect(() => {
    if (
      walletStatus !== "connected" ||
      !walletAddress ||
      isPublicRoute(pathname) ||
      hasValidToken
    ) {
      return;
    }

    void fetchAccessToken({ forceRefreshToken: false });
  }, [fetchAccessToken, hasValidToken, pathname, walletAddress, walletStatus]);

  return useMemo(
    () => ({
      isLoading:
        walletStatus === "initializing" ||
        walletStatus === "connecting" ||
        (walletStatus === "connected" && !isPublicRoute(pathname) && !hasValidToken),
      isAuthenticated: shouldReportWalletAuthenticated({
        walletStatus,
        walletAddress,
        hasValidToken,
      }),
      fetchAccessToken,
    }),
    [fetchAccessToken, hasValidToken, pathname, walletAddress, walletStatus],
  );
}

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <ConvexProviderWithAuth client={convex} useAuth={useWalletConvexAuth}>
      {children}
    </ConvexProviderWithAuth>
  );
}
