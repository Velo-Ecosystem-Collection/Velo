"use client";

import { stellarConfig, STELLAR_TESTNET_NETWORK_PASSPHRASE } from "@/core/config/stellar";
import { initializeWalletKit } from "@/core/wallet/wallet-kit";
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { WalletRequestScope, walletErrorMessage } from "./wallet-connect-policy";

type WalletStatus =
  | "initializing"
  | "ready"
  | "connected"
  | "connecting"
  | "disconnected"
  | "unavailable"
  | "rejected"
  | "unsupported"
  | "stale"
  | "error";

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

type SupportedWallet = {
  id: string;
  name: string;
  isAvailable: boolean;
};

type WalletState = {
  address: string | null;
  walletId: string | null;
  walletName: string | null;
  status: WalletStatus;
  error: string | null;
  errorCode: WalletErrorCode | null;
  supportedWallets: SupportedWallet[];
  staleAddress: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  signTransaction: (xdr: string) => Promise<string>;
  signMessage: (message: string) => Promise<string>;
};

const WalletContext = createContext<WalletState | null>(null);

const LAST_SESSION_KEY = "velo:last-wallet-session";

function isRejected(error: unknown) {
  return /reject|denied|cancel|closed the modal/i.test(walletErrorMessage(error));
}

function walletName(wallets: SupportedWallet[], walletId: string | null) {
  return wallets.find((wallet) => wallet.id === walletId)?.name ?? walletId;
}

function readStoredSession() {
  if (typeof window === "undefined") {
    return null;
  }

  const storedSession = window.localStorage.getItem(LAST_SESSION_KEY);
  if (!storedSession) {
    return null;
  }

  try {
    return JSON.parse(storedSession) as { address?: string; walletId?: string };
  } catch {
    window.localStorage.removeItem(LAST_SESSION_KEY);
    return null;
  }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [walletId, setWalletId] = useState<string | null>(null);
  const [status, setStatus] = useState<WalletStatus>("initializing");
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<WalletErrorCode | null>(null);
  const [supportedWallets, setSupportedWallets] = useState<SupportedWallet[]>([]);
  const [staleAddress, setStaleAddress] = useState<string | null>(null);

  const requestScope = useRef(new WalletRequestScope());
  const connecting = useRef(false);
  const connectedAddress = useRef<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const unsubscribers: Array<() => void> = [];

    async function initializeWalletsKit() {
      if (typeof window === "undefined") {
        return;
      }

      try {
        const { StellarWalletsKit, KitEventType } = await initializeWalletKit();
        const wallets = await StellarWalletsKit.refreshSupportedWallets();
        if (!isMounted) {
          return;
        }

        setSupportedWallets(
          wallets.map((wallet) => ({
            id: wallet.id,
            name: wallet.name,
            isAvailable: wallet.isAvailable,
          })),
        );

        const storedSession = readStoredSession();
        if (storedSession) {
          setStaleAddress(storedSession.address ?? null);
          setWalletId(storedSession.walletId ?? null);
          setStatus("stale");
          setErrorCode("WALLET_STALE_SESSION");
        } else {
          setStatus("ready");
        }

        unsubscribers.push(
          StellarWalletsKit.on(KitEventType.STATE_UPDATED, (event) => {
            // A pairing event is not acceptance: connect() validates its result first.
            if (!connectedAddress.current || connecting.current) return;
            if (
              event.payload.networkPassphrase !== STELLAR_TESTNET_NETWORK_PASSPHRASE ||
              event.payload.address !== connectedAddress.current
            ) {
              requestScope.current.invalidate();
              connectedAddress.current = null;
              setAddress(null);
              setStatus("stale");
              setErrorCode("WALLET_STALE_SESSION");
              setError(`Reconnect a wallet on ${stellarConfig.networkLabel}.`);
              window.localStorage.removeItem(LAST_SESSION_KEY);
            }
          }),
          StellarWalletsKit.on(KitEventType.WALLET_SELECTED, (event) => {
            setWalletId(event.payload.id ?? null);
          }),
          StellarWalletsKit.on(KitEventType.DISCONNECT, () => {
            requestScope.current.invalidate();
            connecting.current = false;
            connectedAddress.current = null;
            setWalletId(null);
            setAddress(null);
            setStaleAddress(null);
            setStatus("disconnected");
            setError(null);
            setErrorCode(null);
            window.localStorage.removeItem(LAST_SESSION_KEY);
          }),
        );
      } catch (initError) {
        if (!isMounted) {
          return;
        }

        setStatus("unavailable");
        setErrorCode("WALLET_UNAVAILABLE");
        setError(walletErrorMessage(initError));
      }
    }

    initializeWalletsKit();

    return () => {
      isMounted = false;
      requestScope.current.invalidate();
      connecting.current = false;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !address) {
      return;
    }

    window.localStorage.setItem(LAST_SESSION_KEY, JSON.stringify({ address, walletId }));
  }, [address, walletId]);

  const connect = useCallback(async () => {
    if (typeof window === "undefined") {
      return;
    }

    if (connecting.current) return;
    connecting.current = true;
    requestScope.current.invalidate();
    const isCurrent = requestScope.current.capture();
    connectedAddress.current = null;
    setAddress(null);
    setStatus("connecting");
    setError(null);
    setErrorCode(null);

    try {
      const { StellarWalletsKit } = await initializeWalletKit();
      await StellarWalletsKit.refreshSupportedWallets();
      if (!isCurrent()) return;
      const result = await StellarWalletsKit.authModal();
      if (!isCurrent()) return;
      const selectedWalletId = StellarWalletsKit.selectedModule?.productId ?? walletId;

      connectedAddress.current = result.address;
      setAddress(result.address);
      setWalletId(selectedWalletId);
      setStaleAddress(null);
      setStatus("connected");
      window.localStorage.setItem(
        LAST_SESSION_KEY,
        JSON.stringify({ address: result.address, walletId: selectedWalletId }),
      );
    } catch (connectError) {
      if (!isCurrent()) return;
      connectedAddress.current = null;
      setAddress(null);
      window.localStorage.removeItem(LAST_SESSION_KEY);
      const rejected = isRejected(connectError);
      setStatus(rejected ? "rejected" : "error");
      setErrorCode(rejected ? "WALLET_REJECTED" : "WALLET_UNAVAILABLE");
      setError(walletErrorMessage(connectError));
    } finally {
      if (isCurrent()) connecting.current = false;
    }
  }, [walletId]);

  const disconnect = useCallback(async () => {
    if (typeof window === "undefined") {
      return;
    }

    requestScope.current.invalidate();
    connecting.current = false;
    connectedAddress.current = null;
    setAddress(null);
    setWalletId(null);
    setStatus("disconnected");
    try {
      const { StellarWalletsKit } = await import("@creit-tech/stellar-wallets-kit");
      await StellarWalletsKit.disconnect();
    } finally {
      setAddress(null);
      setStaleAddress(null);
      setStatus("disconnected");
      setError(null);
      setErrorCode(null);
      window.localStorage.removeItem(LAST_SESSION_KEY);
    }
  }, []);

  const signTransaction = useCallback(
    async (xdr: string) => {
      if (!address) {
        throw new WalletError("WALLET_NOT_CONNECTED", "Connect a wallet before signing.");
      }

      try {
        const isCurrent = requestScope.current.capture();
        const { StellarWalletsKit } = await import("@creit-tech/stellar-wallets-kit");
        if (!isCurrent() || connectedAddress.current !== address) {
          throw new WalletError("WALLET_STALE_SESSION", "Reconnect your wallet before signing.");
        }
        const result = await StellarWalletsKit.signTransaction(xdr, {
          networkPassphrase: STELLAR_TESTNET_NETWORK_PASSPHRASE,
          address,
        });
        if (!isCurrent() || connectedAddress.current !== address) {
          throw new WalletError(
            "WALLET_STALE_SESSION",
            "Wallet changed while signing. Reconnect to continue.",
          );
        }
        return result.signedTxXdr;
      } catch (signError) {
        if (signError instanceof WalletError) throw signError;
        throw new WalletError(
          isRejected(signError) ? "WALLET_REJECTED" : "WALLET_SIGNING_FAILED",
          isRejected(signError)
            ? "Wallet request rejected."
            : "The wallet could not sign this Testnet transaction.",
          { cause: signError },
        );
      }
    },
    [address],
  );

  const signMessage = useCallback(
    async (message: string) => {
      if (!address) {
        throw new Error("Connect a wallet before signing");
      }

      const { StellarWalletsKit } = await import("@creit-tech/stellar-wallets-kit");
      const result = await StellarWalletsKit.signMessage(message, {
        networkPassphrase: STELLAR_TESTNET_NETWORK_PASSPHRASE,
        address,
      });

      return result.signedMessage;
    },
    [address],
  );

  const value = useMemo<WalletState>(
    () => ({
      address,
      walletId,
      walletName: walletName(supportedWallets, walletId),
      status,
      error,
      errorCode,
      supportedWallets,
      staleAddress,
      connect,
      disconnect,
      signTransaction,
      signMessage,
    }),
    [
      address,
      walletId,
      status,
      error,
      errorCode,
      supportedWallets,
      staleAddress,
      connect,
      disconnect,
      signTransaction,
      signMessage,
    ],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const wallet = useContext(WalletContext);

  if (!wallet) {
    throw new Error("useWallet must be used inside WalletProvider");
  }

  return wallet;
}
