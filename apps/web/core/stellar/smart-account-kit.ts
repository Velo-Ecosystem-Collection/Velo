"use client";

import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  nativeToScVal,
  rpc,
  scValToNative,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import {
  getCredentialIdFromSigner,
  IndexedDBStorage,
  IndexerError,
  LocalStorageAdapter,
  SmartAccountKit,
} from "smart-account-kit";

import type {
  ConnectWalletResult,
  ContractSigner,
  IndexedContractSummary,
  StorageAdapter,
  StoredCredential,
  StoredSession,
} from "smart-account-kit";

import {
  assertPasskeyBrowserConfiguration,
  getSmartAccountConfig,
  getSmartAccountSubmissionMethod,
  type SmartAccountConfig,
} from "./smart-account-config";

type TSmartAccountKit = InstanceType<typeof SmartAccountKit>;
const STORAGE_PREFIX = "velo-passkey-smart-accounts";
let kitInstance: TSmartAccountKit | null = null;

function normalizeCredentialId(value: string) {
  const clean = value.trim().replace(/^0x/i, "");
  if (/^[a-f0-9]+$/i.test(clean)) return clean.toLowerCase();
  try {
    const base64 = clean.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    return Array.from(decoded, (character) =>
      character.charCodeAt(0).toString(16).padStart(2, "0"),
    ).join("");
  } catch {
    return clean.toLowerCase();
  }
}

function storageKey(config: SmartAccountConfig) {
  return [
    STORAGE_PREFIX,
    config.network,
    config.accountWasmHash.slice(0, 16),
    config.webauthnVerifierAddress.slice(0, 16),
    config.rpId,
  ].join(":");
}

function transientIndexedDbError(error: unknown) {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("indexeddb") ||
    message.includes("transaction") ||
    message.includes("database connection is closing")
  );
}

class ResilientStorage implements StorageAdapter {
  private primary: StorageAdapter;
  private readonly fallback: StorageAdapter;
  private readonly key: string;

  constructor(key: string) {
    this.key = key;
    this.primary = new IndexedDBStorage(key);
    this.fallback = new LocalStorageAdapter(key);
  }

  private async run<T>(operation: (storage: StorageAdapter) => Promise<T>): Promise<T> {
    try {
      return await operation(this.primary);
    } catch (error) {
      if (!transientIndexedDbError(error)) throw error;
      this.primary = new IndexedDBStorage(this.key);
      try {
        return await operation(this.primary);
      } catch (retryError) {
        if (!transientIndexedDbError(retryError)) throw retryError;
        return await operation(this.fallback);
      }
    }
  }

  save(value: StoredCredential) {
    return this.run((storage) => storage.save(value));
  }
  get(id: string) {
    return this.run((storage) => storage.get(id));
  }
  getByContract(id: string) {
    return this.run((storage) => storage.getByContract(id));
  }
  getAll() {
    return this.run((storage) => storage.getAll());
  }
  delete(id: string) {
    return this.run((storage) => storage.delete(id));
  }
  update(id: string, value: Partial<Omit<StoredCredential, "credentialId" | "publicKey">>) {
    return this.run((storage) => storage.update(id, value));
  }
  async clear() {
    await Promise.allSettled([this.primary.clear(), this.fallback.clear()]);
    this.primary = new IndexedDBStorage(this.key);
  }
  saveSession(value: StoredSession) {
    return this.run((storage) => storage.saveSession(value));
  }
  getSession() {
    return this.run((storage) => storage.getSession());
  }
  async clearSession() {
    await Promise.allSettled([this.primary.clearSession(), this.fallback.clearSession()]);
    this.primary = new IndexedDBStorage(this.key);
  }
}

function createStorage(config: SmartAccountConfig): StorageAdapter {
  if (typeof window === "undefined")
    throw new Error("Passkey storage is only available in a browser.");
  const key = storageKey(config);
  return "indexedDB" in window ? new ResilientStorage(key) : new LocalStorageAdapter(key);
}

export function getSmartAccountKit() {
  assertPasskeyBrowserConfiguration();
  if (kitInstance) return kitInstance;
  const config = getSmartAccountConfig();
  kitInstance = new SmartAccountKit({
    rpcUrl: config.rpcUrl,
    networkPassphrase: config.networkPassphrase,
    accountWasmHash: config.accountWasmHash,
    webauthnVerifierAddress: config.webauthnVerifierAddress,
    rpId: config.rpId,
    rpName: config.rpName,
    relayerUrl: config.relayerUrl,
    storage: createStorage(config),
  });
  return kitInstance;
}

export async function assertSmartAccountFeePayerFunded(kit: TSmartAccountKit) {
  const config = getSmartAccountConfig();
  const feePayer = kit.deployerPublicKey;
  const server = new rpc.Server(config.rpcUrl, { timeout: 30_000 });
  try {
    await server.getAccount(feePayer);
  } catch {
    throw new Error(
      `No relayer is configured. Direct Testnet submissions use smart-account-kit fee payer ${feePayer}; fund it with Testnet XLM and verify the configured RPC, or configure a compatible Testnet relayer.`,
    );
  }
}

export async function disconnectSmartAccount() {
  if (kitInstance) await kitInstance.disconnect().catch(() => undefined);
  kitInstance = null;
}

export async function discoverPasskeyAccounts(kit: TSmartAccountKit, credentialId: string) {
  try {
    return await kit.discoverContractsByCredential(credentialId);
  } catch (error) {
    if (error instanceof IndexerError) return null;
    throw error;
  }
}

function externalSignerMatches(signer: unknown, credentialId: string, verifierAddress: string) {
  const normalizedSigner =
    Array.isArray(signer) && signer[0] === "External"
      ? { tag: "External", values: [signer[1], signer[2]] }
      : signer;
  if (
    !normalizedSigner ||
    typeof normalizedSigner !== "object" ||
    !("tag" in normalizedSigner) ||
    normalizedSigner.tag !== "External" ||
    !("values" in normalizedSigner) ||
    !Array.isArray(normalizedSigner.values) ||
    !(normalizedSigner.values[1] instanceof Uint8Array) ||
    typeof normalizedSigner.values[0] !== "string" ||
    normalizedSigner.values[0].toUpperCase() !== verifierAddress
  ) {
    return false;
  }
  const id = getCredentialIdFromSigner(normalizedSigner as ContractSigner);
  return id !== null && normalizeCredentialId(id) === normalizeCredentialId(credentialId);
}

export async function ensurePasskeySigner(params: {
  kit: TSmartAccountKit;
  contractId: string;
  credentialId: string;
}) {
  const config = getSmartAccountConfig();
  const server = new rpc.Server(config.rpcUrl, { timeout: 30_000 });
  const [accountEntries, verifierEntries] = await Promise.all([
    server.getLedgerEntries(new Contract(params.contractId).getFootprint()),
    server.getLedgerEntries(new Contract(config.webauthnVerifierAddress).getFootprint()),
  ]);
  const accountEntry = accountEntries.entries[0]?.val;
  if (!accountEntry)
    throw new Error("The selected smart account is not deployed on the configured Testnet.");
  const executable = accountEntry.contractData().val().instance().executable();
  if (executable.switch().name !== "contractExecutableWasm") {
    throw new Error("The selected smart account does not use a WASM executable.");
  }
  const deployedWasmHash = Array.from(executable.wasmHash(), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  if (deployedWasmHash.toLowerCase() !== config.accountWasmHash) {
    throw new Error(
      "This smart account uses a different WASM version than Velo's configured Testnet account.",
    );
  }
  if (!verifierEntries.entries[0]?.val) {
    throw new Error(
      "Velo's configured Testnet WebAuthn verifier is not deployed or RPC could not find it.",
    );
  }
  const transaction = new TransactionBuilder(new Account(params.kit.deployerPublicKey, "0"), {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(
      new Contract(Address.fromString(params.contractId).toString()).call(
        "get_context_rule",
        nativeToScVal(0, { type: "u32" }),
      ),
    )
    .setTimeout(30)
    .build();
  const simulation = await server.simulateTransaction(transaction);
  if (rpc.Api.isSimulationError(simulation) || !simulation.result?.retval) {
    throw new Error(
      "Could not verify the passkey signer on the smart account through Stellar RPC.",
    );
  }

  const value = scValToNative(simulation.result.retval) as unknown;
  if (
    !value ||
    typeof value !== "object" ||
    !("signers" in value) ||
    !Array.isArray(value.signers)
  ) {
    throw new Error("The smart account default signer rule could not be read.");
  }
  const signer = value.signers.find((item) =>
    externalSignerMatches(item, params.credentialId, config.webauthnVerifierAddress),
  );
  if (!signer) {
    throw new Error("This passkey is not an active signer on the selected Velo smart account.");
  }
}

export async function connectPasskeyAccount(params: {
  credentialId: string;
  contractId?: string;
}): Promise<ConnectWalletResult> {
  const kit = getSmartAccountKit();
  const result = await kit.connectWallet({
    credentialId: params.credentialId,
    ...(params.contractId ? { contractId: Address.fromString(params.contractId).toString() } : {}),
    fresh: true,
  });
  if (!result)
    throw new Error(
      "No smart account was found for this passkey. Create a Velo passkey account first.",
    );
  await ensurePasskeySigner({
    kit,
    contractId: result.contractId,
    credentialId: result.credentialId,
  });
  return result;
}

export async function reconnectPasskeyAccount(
  kit: TSmartAccountKit,
  verifySigner: typeof ensurePasskeySigner = ensurePasskeySigner,
) {
  const result = await kit.connectWallet();
  if (!result) return null;
  await verifySigner({
    kit,
    contractId: result.contractId,
    credentialId: result.credentialId,
  });
  return result;
}

export async function createVeloPasskeyAccount(
  kit: TSmartAccountKit,
  verifySigner: typeof ensurePasskeySigner = ensurePasskeySigner,
  verifyFeePayer: typeof assertSmartAccountFeePayerFunded = assertSmartAccountFeePayerFunded,
) {
  const forceMethod = await getSmartAccountSubmissionMethod();
  if (forceMethod === "rpc") await verifyFeePayer(kit);
  const userName = `velo-${Math.random().toString(36).slice(2, 10)}`;
  const result = await kit.createWallet("Velo", userName, {
    autoSubmit: true,
    forceMethod,
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  });
  if (!result.submitResult?.success) {
    throw new Error(
      result.submitResult?.error ||
        `Velo's Testnet ${forceMethod === "relayer" ? "relayer" : "RPC fee payer"} could not deploy the smart account.`,
    );
  }
  await verifySigner({
    kit,
    contractId: result.contractId,
    credentialId: result.credentialId,
  });
  return result;
}

export type PasskeyAccountOption = {
  contractId: string;
  lastSeenLedger: number;
};

export function resolvePasskeyAccountDiscovery(accounts: readonly PasskeyAccountOption[]) {
  if (accounts.length > 1) return { kind: "select" as const, accounts };
  return { kind: "connect" as const, contractId: accounts[0]?.contractId };
}

export function normalizeDiscoveredAccounts(accounts: readonly IndexedContractSummary[] | null) {
  return (accounts ?? []).map((account) => ({
    contractId: Address.fromString(account.contract_id).toString(),
    lastSeenLedger: account.last_seen_ledger,
  }));
}
