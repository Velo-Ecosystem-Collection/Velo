"use client";

import { stellarConfig, STELLAR_TESTNET_NETWORK_PASSPHRASE } from "@/core/config/stellar";
import { initializeWalletKit } from "@/core/wallet/wallet-kit";
import { assertValidPublicKey } from "@repo/stellar/validation";
import { Address, xdr } from "@stellar/stellar-sdk";
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

import { encodeSep45Entries } from "../auth/sep45-client";
import {
  isPasskeyBrowserSupported,
  isPasskeyFeatureEnabled,
} from "../stellar/smart-account-config";
import { WalletRequestScope, walletErrorMessage } from "./wallet-connect-policy";
import { restoreWalletSession } from "./wallet-session";

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
  | "WALLET_SIGNING_FAILED"
  | "WALLET_AUTH_FAILED";

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

export type WalletIdentityType = "classic" | "passkey_smart_account" | null;

export type PasskeyAccountOption = {
  contractId: string;
  lastSeenLedger: number;
};

type WalletState = {
  address: string | null;
  identityType: WalletIdentityType;
  walletId: string | null;
  walletName: string | null;
  status: WalletStatus;
  error: string | null;
  errorCode: WalletErrorCode | null;
  supportedWallets: SupportedWallet[];
  staleAddress: string | null;
  passkeyAccounts: PasskeyAccountOption[];
  passkeyEnabled: boolean;
  connect: () => Promise<void>;
  connectPasskey: () => Promise<void>;
  createPasskeyAccount: () => Promise<void>;
  selectPasskeyAccount: (contractId: string) => Promise<void>;
  disconnect: (reason?: { code: WalletErrorCode; message: string }) => Promise<void>;
  signTransaction: (xdr: string) => Promise<string>;
  signMessage: (message: string) => Promise<string>;
  signContractAuthorizationEntries: (
    entriesXdr: string,
    expirationLedger: number,
  ) => Promise<string>;
};

const WalletContext = createContext<WalletState | null>(null);

const LAST_SESSION_KEY = "velo:last-wallet-session";
const ACTIVE_IDENTITY_KEY = "velo:active-wallet-mode";

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
    const value: unknown = JSON.parse(storedSession);
    if (!value || typeof value !== "object") throw new Error("Invalid wallet session");
    const session = value as Record<string, unknown>;
    if (
      typeof session.address !== "string" ||
      session.address.length > 56 ||
      (typeof session.walletId === "string" && session.walletId.length > 100)
    ) {
      throw new Error("Invalid wallet session");
    }
    assertValidPublicKey(session.address);
    return {
      address: session.address,
      walletId: typeof session.walletId === "string" ? session.walletId : null,
    };
  } catch {
    window.localStorage.removeItem(LAST_SESSION_KEY);
    return null;
  }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [identityTypeState, setIdentityTypeState] = useState<WalletIdentityType>(null);
  const [walletId, setWalletId] = useState<string | null>(null);
  const [status, setStatus] = useState<WalletStatus>("initializing");
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<WalletErrorCode | null>(null);
  const [supportedWallets, setSupportedWallets] = useState<SupportedWallet[]>([]);
  const [staleAddress, setStaleAddress] = useState<string | null>(null);
  const [passkeyAccounts, setPasskeyAccounts] = useState<PasskeyAccountOption[]>([]);

  const requestScope = useRef(new WalletRequestScope());
  const connecting = useRef(false);
  const connectedAddress = useRef<string | null>(null);
  const identityTypeRef = useRef<WalletIdentityType>(null);
  const pendingPasskeyCredential = useRef<string | null>(null);
  const disconnectReason = useRef<{ code: WalletErrorCode; message: string } | null>(null);

  const setIdentityType = useCallback((value: WalletIdentityType) => {
    identityTypeRef.current = value;
    setIdentityTypeState(value);
    if (typeof window !== "undefined") {
      if (value) window.localStorage.setItem(ACTIVE_IDENTITY_KEY, value);
      else window.localStorage.removeItem(ACTIVE_IDENTITY_KEY);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    const unsubscribers: Array<() => void> = [];

    async function initializeWalletsKit() {
      if (typeof window === "undefined") {
        return;
      }

      let passkeyRestoreFailed = false;
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
        const storedIdentityType = window.localStorage.getItem(ACTIVE_IDENTITY_KEY);

        unsubscribers.push(
          StellarWalletsKit.on(KitEventType.STATE_UPDATED, (event) => {
            // A pairing event is not acceptance: connect() validates its result first.
            if (
              identityTypeRef.current !== "classic" ||
              !connectedAddress.current ||
              connecting.current
            )
              return;
            if (
              event.payload.networkPassphrase !== STELLAR_TESTNET_NETWORK_PASSPHRASE ||
              event.payload.address !== connectedAddress.current
            ) {
              requestScope.current.invalidate();
              connectedAddress.current = null;
              setAddress(null);
              setIdentityType(null);
              setStatus("stale");
              setErrorCode("WALLET_STALE_SESSION");
              setError(`Reconnect a wallet on ${stellarConfig.networkLabel}.`);
              window.localStorage.removeItem(LAST_SESSION_KEY);
              window.sessionStorage.removeItem("velo:convex-token");
            }
          }),
          StellarWalletsKit.on(KitEventType.WALLET_SELECTED, (event) => {
            if (identityTypeRef.current === "classic") setWalletId(event.payload.id ?? null);
          }),
          StellarWalletsKit.on(KitEventType.DISCONNECT, () => {
            if (identityTypeRef.current === "passkey_smart_account") return;
            const reason = disconnectReason.current;
            disconnectReason.current = null;
            requestScope.current.invalidate();
            connecting.current = false;
            connectedAddress.current = null;
            setWalletId(null);
            setAddress(null);
            setIdentityType(null);
            setStaleAddress(null);
            setStatus(
              reason?.code === "WALLET_REJECTED" ? "rejected" : reason ? "error" : "disconnected",
            );
            setError(reason?.message ?? null);
            setErrorCode(reason?.code ?? null);
            window.localStorage.removeItem(LAST_SESSION_KEY);
          }),
        );

        if (storedIdentityType === "passkey_smart_account") {
          try {
            const { reconnectPasskeyAccount, getSmartAccountKit } =
              await import("../stellar/smart-account-kit");
            const kit = getSmartAccountKit();
            const result = await reconnectPasskeyAccount(kit);
            if (result) {
              if (!isMounted) return;
              window.localStorage.removeItem(LAST_SESSION_KEY);
              setAddress(result.contractId);
              setIdentityType("passkey_smart_account");
              setWalletId(null);
              setStatus("connected");
              setError(null);
              setErrorCode(null);
              return;
            }
          } catch (restoreError) {
            passkeyRestoreFailed = true;
            if (isMounted) {
              setError(walletErrorMessage(restoreError));
              setErrorCode("WALLET_STALE_SESSION");
            }
          }
          setIdentityType(null);
        }

        if (!storedSession) {
          setStatus(passkeyRestoreFailed ? "stale" : "ready");
          return;
        }

        setStaleAddress(storedSession.address);
        setWalletId(storedSession.walletId);
        connecting.current = true;
        const isCurrent = requestScope.current.capture();
        try {
          const restoredAddress = storedSession.walletId
            ? await restoreWalletSession(
                storedSession.walletId,
                storedSession.address,
                initializeWalletKit,
                STELLAR_TESTNET_NETWORK_PASSPHRASE,
              )
            : null;
          if (!isMounted || !isCurrent()) return;

          if (restoredAddress) {
            connectedAddress.current = restoredAddress;
            setAddress(restoredAddress);
            setIdentityType("classic");
            setStaleAddress(null);
            setStatus("connected");
            setError(null);
            setErrorCode(null);
          } else {
            setIdentityType(null);
            setStatus("stale");
            setErrorCode("WALLET_STALE_SESSION");
            setError(`Reconnect a wallet on ${stellarConfig.networkLabel}.`);
          }
        } catch {
          if (!isMounted || !isCurrent()) return;
          setIdentityType(null);
          setStatus("stale");
          setErrorCode("WALLET_STALE_SESSION");
          setError(`Reconnect a wallet on ${stellarConfig.networkLabel}.`);
        } finally {
          if (isCurrent()) connecting.current = false;
        }
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
  }, [setIdentityType]);

  useEffect(() => {
    if (typeof window === "undefined" || !address || identityTypeState !== "classic") {
      return;
    }

    window.localStorage.setItem(LAST_SESSION_KEY, JSON.stringify({ address, walletId }));
  }, [address, identityTypeState, walletId]);

  const connect = useCallback(async () => {
    if (typeof window === "undefined") {
      return;
    }

    if (connecting.current) return;
    connecting.current = true;
    requestScope.current.invalidate();
    disconnectReason.current = null;
    const isCurrent = requestScope.current.capture();
    connectedAddress.current = null;
    setAddress(null);
    setIdentityType(null);
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
      setIdentityType("classic");
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
      setIdentityType(null);
      window.localStorage.removeItem(LAST_SESSION_KEY);
      const rejected = isRejected(connectError);
      setStatus(rejected ? "rejected" : "error");
      setErrorCode(rejected ? "WALLET_REJECTED" : "WALLET_UNAVAILABLE");
      setError(walletErrorMessage(connectError));
    } finally {
      if (isCurrent()) connecting.current = false;
    }
  }, [setIdentityType, walletId]);

  const finishPasskeyConnection = useCallback(
    (contractId: string) => {
      connectedAddress.current = null;
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(LAST_SESSION_KEY);
        window.sessionStorage.removeItem("velo:convex-token");
      }
      setAddress(Address.fromString(contractId).toString());
      setIdentityType("passkey_smart_account");
      setWalletId(null);
      setStaleAddress(null);
      setPasskeyAccounts([]);
      pendingPasskeyCredential.current = null;
      setStatus("connected");
      setError(null);
      setErrorCode(null);
    },
    [setIdentityType],
  );

  const connectPasskey = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (!isPasskeyBrowserSupported()) {
      setError(
        "Passkeys require WebAuthn support and a secure browser context (HTTPS or localhost).",
      );
      setErrorCode("WALLET_UNSUPPORTED");
      setStatus("unsupported");
      return;
    }
    if (connecting.current) return;
    connecting.current = true;
    requestScope.current.invalidate();
    const isCurrent = requestScope.current.capture();
    setAddress(null);
    setIdentityType(null);
    setStatus("connecting");
    setError(null);
    setErrorCode(null);
    setPasskeyAccounts([]);

    try {
      const {
        discoverPasskeyAccounts,
        getSmartAccountKit,
        normalizeDiscoveredAccounts,
        resolvePasskeyAccountDiscovery,
        connectPasskeyAccount,
      } = await import("../stellar/smart-account-kit");
      const kit = getSmartAccountKit();
      const { credentialId } = await kit.authenticatePasskey();
      if (!isCurrent()) return;
      const candidates = normalizeDiscoveredAccounts(
        await discoverPasskeyAccounts(kit, credentialId),
      );
      if (!isCurrent()) return;
      const discovery = resolvePasskeyAccountDiscovery(candidates);
      if (discovery.kind === "select") {
        pendingPasskeyCredential.current = credentialId;
        setPasskeyAccounts([...discovery.accounts]);
        setStatus("ready");
        return;
      }
      const result = await connectPasskeyAccount({
        credentialId,
        ...(discovery.contractId ? { contractId: discovery.contractId } : {}),
      });
      if (!isCurrent()) return;
      finishPasskeyConnection(result.contractId);
    } catch (connectError) {
      if (!isCurrent()) return;
      const rejected =
        isRejected(connectError) ||
        /notallowederror|cancelled|canceled/i.test(walletErrorMessage(connectError));
      setStatus(rejected ? "rejected" : "error");
      setErrorCode(rejected ? "WALLET_REJECTED" : "WALLET_AUTH_FAILED");
      setError(rejected ? "Passkey request was canceled." : walletErrorMessage(connectError));
    } finally {
      if (isCurrent()) connecting.current = false;
    }
  }, [finishPasskeyConnection, setIdentityType]);

  const createPasskeyAccount = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (!isPasskeyBrowserSupported()) {
      setError(
        "Passkeys require WebAuthn support and a secure browser context (HTTPS or localhost).",
      );
      setErrorCode("WALLET_UNSUPPORTED");
      setStatus("unsupported");
      return;
    }
    if (connecting.current) return;
    connecting.current = true;
    requestScope.current.invalidate();
    const isCurrent = requestScope.current.capture();
    setAddress(null);
    setIdentityType(null);
    setStatus("connecting");
    setError(null);
    setErrorCode(null);

    try {
      const { createVeloPasskeyAccount, getSmartAccountKit } =
        await import("../stellar/smart-account-kit");
      const kit = getSmartAccountKit();
      const result = await createVeloPasskeyAccount(kit);
      if (!isCurrent()) return;
      finishPasskeyConnection(result.contractId);
    } catch (createError) {
      if (!isCurrent()) return;
      const rejected =
        isRejected(createError) ||
        /notallowederror|cancelled|canceled/i.test(walletErrorMessage(createError));
      setStatus(rejected ? "rejected" : "error");
      setErrorCode(rejected ? "WALLET_REJECTED" : "WALLET_AUTH_FAILED");
      setError(rejected ? "Passkey creation was canceled." : walletErrorMessage(createError));
    } finally {
      if (isCurrent()) connecting.current = false;
    }
  }, [finishPasskeyConnection, setIdentityType]);

  const selectPasskeyAccount = useCallback(
    async (contractId: string) => {
      const credentialId = pendingPasskeyCredential.current;
      if (!credentialId || !passkeyAccounts.some((account) => account.contractId === contractId)) {
        setError("Select a smart account discovered for the authenticated passkey.");
        setErrorCode("WALLET_AUTH_FAILED");
        return;
      }
      if (connecting.current) return;
      connecting.current = true;
      requestScope.current.invalidate();
      const isCurrent = requestScope.current.capture();
      setStatus("connecting");
      setError(null);
      setErrorCode(null);
      try {
        const { connectPasskeyAccount } = await import("../stellar/smart-account-kit");
        const result = await connectPasskeyAccount({ credentialId, contractId });
        if (!isCurrent()) return;
        finishPasskeyConnection(result.contractId);
      } catch (selectionError) {
        if (!isCurrent()) return;
        setStatus("error");
        setErrorCode("WALLET_AUTH_FAILED");
        setError(walletErrorMessage(selectionError));
      } finally {
        if (isCurrent()) connecting.current = false;
      }
    },
    [finishPasskeyConnection, passkeyAccounts],
  );

  const disconnect = useCallback(
    async (reason?: { code: WalletErrorCode; message: string }) => {
      if (typeof window === "undefined") {
        return;
      }

      disconnectReason.current = reason ?? null;
      requestScope.current.invalidate();
      connecting.current = false;
      connectedAddress.current = null;
      setAddress(null);
      setIdentityType(null);
      setWalletId(null);
      setPasskeyAccounts([]);
      pendingPasskeyCredential.current = null;
      setStatus(
        reason?.code === "WALLET_REJECTED" ? "rejected" : reason ? "error" : "disconnected",
      );
      setError(reason?.message ?? null);
      setErrorCode(reason?.code ?? null);
      try {
        await Promise.allSettled([
          import("@creit-tech/stellar-wallets-kit").then(({ StellarWalletsKit }) =>
            StellarWalletsKit.disconnect(),
          ),
          import("../stellar/smart-account-kit").then(({ disconnectSmartAccount }) =>
            disconnectSmartAccount(),
          ),
        ]);
      } finally {
        setAddress(null);
        setIdentityType(null);
        setStaleAddress(null);
        setStatus(
          reason?.code === "WALLET_REJECTED" ? "rejected" : reason ? "error" : "disconnected",
        );
        setError(reason?.message ?? null);
        setErrorCode(reason?.code ?? null);
        disconnectReason.current = null;
        window.localStorage.removeItem(LAST_SESSION_KEY);
        window.localStorage.removeItem(ACTIVE_IDENTITY_KEY);
      }
    },
    [setIdentityType],
  );

  const signTransaction = useCallback(
    async (xdr: string) => {
      if (!address || identityTypeState !== "classic") {
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
    [address, identityTypeState],
  );

  const signMessage = useCallback(
    async (message: string) => {
      if (!address || identityTypeState !== "classic") {
        throw new Error("Connect a wallet before signing");
      }

      const { StellarWalletsKit } = await import("@creit-tech/stellar-wallets-kit");
      const result = await StellarWalletsKit.signMessage(message, {
        networkPassphrase: STELLAR_TESTNET_NETWORK_PASSPHRASE,
        address,
      });

      return result.signedMessage;
    },
    [address, identityTypeState],
  );

  const signContractAuthorizationEntries = useCallback(
    async (entriesXdr: string, expirationLedger: number) => {
      if (!address || identityTypeState !== "passkey_smart_account") {
        throw new WalletError(
          "WALLET_NOT_CONNECTED",
          "Connect a Velo passkey smart account before signing.",
        );
      }
      let entries: xdr.SorobanAuthorizationEntry[];
      try {
        entries = Array.from(xdr.SorobanAuthorizationEntries.fromXDR(entriesXdr, "base64"));
      } catch {
        throw new WalletError(
          "WALLET_AUTH_FAILED",
          "Velo returned malformed SEP-45 authorization entries.",
        );
      }
      const matching = entries.filter((entry) => {
        if (entry.credentials().switch().name !== "sorobanCredentialsAddress") return false;
        return (
          Address.fromScAddress(entry.credentials().address().address()).toString() === address
        );
      });
      if (matching.length !== 1) {
        throw new WalletError(
          "WALLET_AUTH_FAILED",
          "SEP-45 authorization is not addressed to this smart account.",
        );
      }
      const { getSmartAccountKit, signPasskeyAuthorizationEntry } =
        await import("../stellar/smart-account-kit");
      const kit = getSmartAccountKit();
      if (kit.contractId !== address) {
        throw new WalletError(
          "WALLET_STALE_SESSION",
          "Reconnect the selected Velo passkey smart account.",
        );
      }
      const signedEntry = await signPasskeyAuthorizationEntry(kit, matching[0]!, expirationLedger);
      return encodeSep45Entries(
        entries.map((entry) => (entry === matching[0] ? signedEntry : entry)),
      );
    },
    [address, identityTypeState],
  );

  const value = useMemo<WalletState>(
    () => ({
      address,
      identityType: identityTypeState,
      walletId,
      walletName:
        identityTypeState === "passkey_smart_account"
          ? "Velo Passkey"
          : walletName(supportedWallets, walletId),
      status,
      error,
      errorCode,
      supportedWallets,
      staleAddress,
      passkeyAccounts,
      passkeyEnabled: isPasskeyFeatureEnabled(),
      connect,
      connectPasskey,
      createPasskeyAccount,
      selectPasskeyAccount,
      disconnect,
      signTransaction,
      signMessage,
      signContractAuthorizationEntries,
    }),
    [
      address,
      identityTypeState,
      walletId,
      status,
      error,
      errorCode,
      supportedWallets,
      staleAddress,
      passkeyAccounts,
      connect,
      connectPasskey,
      createPasskeyAccount,
      selectPasskeyAccount,
      disconnect,
      signTransaction,
      signMessage,
      signContractAuthorizationEntries,
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
