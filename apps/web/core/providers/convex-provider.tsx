"use client";

import { WalletError, useWallet } from "@/core/wallet/wallet-provider";
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

type WalletChallengeResponse = {
  challengeId: string;
  challenge: string;
};

type WalletSessionResponse = {
  token: string;
  address: string;
};

function isWalletChallengeResponse(value: unknown): value is WalletChallengeResponse {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return (
    typeof result.challengeId === "string" &&
    typeof result.challenge === "string" &&
    result.challengeId.length <= 64 &&
    result.challenge.length <= 16_384
  );
}

function isWalletSessionResponse(value: unknown): value is WalletSessionResponse {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return typeof result.token === "string" && typeof result.address === "string";
}

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

  // The connected wallet address identifies the session; retain its cached token while
  // reconnecting and clear it on rejection, disconnect, or an unavailable/error state.
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
            throw new WalletError(
              "WALLET_AUTH_FAILED",
              "Velo could not start wallet verification.",
            );
          }
          const challengeResult: unknown = await challengeResponse.json();
          if (!isWalletChallengeResponse(challengeResult)) {
            throw new WalletError(
              "WALLET_AUTH_FAILED",
              "Velo returned an invalid wallet challenge.",
            );
          }
          if (!isCurrent()) return null;

          const signedChallenge = await signTransaction(challengeResult.challenge);
          if (!isCurrent()) return null;

          const sessionResponse = await fetch("/api/auth/wallet/session", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              address: walletAddress,
              challengeId: challengeResult.challengeId,
              signedChallenge,
            }),
          });
          if (!sessionResponse.ok) {
            throw new WalletError(
              "WALLET_AUTH_FAILED",
              "Velo could not verify the wallet signature.",
            );
          }
          const authResult: unknown = await sessionResponse.json();
          if (!isWalletSessionResponse(authResult)) {
            throw new WalletError("WALLET_AUTH_FAILED", "Velo returned an invalid wallet session.");
          }
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
        } catch (error) {
          if (!isCurrent()) return null;
          tokenRef.current = null;
          writeStoredConvexToken(null);
          setTokenState(null);
          pendingPromiseRef.current = null;
          const reason =
            error instanceof WalletError
              ? error
              : new WalletError(
                  "WALLET_AUTH_FAILED",
                  "Wallet verification failed. Reconnect and try again.",
                );
          void disconnect({ code: reason.code, message: reason.message }).catch(() => {});
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
