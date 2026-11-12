"use client";

import { Buffer } from "buffer";

import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  hash,
  nativeToScVal,
  rpc,
  scValToNative,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import {
  getCredentialIdFromSigner,
  IndexedDBStorage,
  IndexerError,
  LocalStorageAdapter,
  SmartAccountKit,
} from "smart-account-kit";

import type {
  ContextRule,
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
const DEFAULT_CONTEXT_RULE_ID = 0;
let kitInstance: TSmartAccountKit | null = null;
const verifiedDefaultContextRules = new Map<string, ContextRule>();
const contextAwareSigningKits = new WeakSet<TSmartAccountKit>();

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
  installContextAwareSigning(kitInstance);
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
  verifiedDefaultContextRules.clear();
}

export async function discoverPasskeyAccounts(kit: TSmartAccountKit, credentialId: string) {
  try {
    return await kit.discoverContractsByCredential(credentialId);
  } catch (error) {
    if (error instanceof IndexerError) return null;
    throw error;
  }
}

type PasskeySignatureOptions = {
  credentialId?: string;
  expiration?: number;
};

type WebAuthnAssertion = {
  id: string;
  response: {
    authenticatorData: string;
    clientDataJSON: string;
    signature: string;
  };
};

type SmartAccountSigningRuntime = {
  webAuthn?: {
    startAuthentication(options: {
      optionsJSON: {
        challenge: string;
        rpId: string;
        userVerification: "preferred";
        timeout: number;
        allowCredentials: Array<{ id: string; type: "public-key" }>;
      };
    }): Promise<WebAuthnAssertion>;
  };
  storage?: StorageAdapter;
  rpId?: string;
  calculateExpiration?: () => Promise<number>;
};

type AuthPayload = {
  contextRuleIds: number[];
  signers: Map<string, { signer: ContractSigner; signature: Buffer }>;
};

function decodeBase64Url(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="), "base64");
}

function encodeBase64Url(value: Uint8Array) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function compactEcdsaSignature(derSignature: Buffer) {
  if (
    derSignature.length < 8 ||
    derSignature[0] !== 0x30 ||
    derSignature[1] !== derSignature.length - 2
  ) {
    throw new Error("The authenticator returned an invalid WebAuthn signature.");
  }

  const readInteger = (offset: number) => {
    if (derSignature[offset] !== 0x02) {
      throw new Error("The authenticator returned an invalid WebAuthn signature.");
    }
    const length = derSignature[offset + 1];
    const start = offset + 2;
    const end = start + (length ?? 0);
    if (!length || end > derSignature.length || length > 33) {
      throw new Error("The authenticator returned an invalid WebAuthn signature.");
    }
    let bytes = derSignature.subarray(start, end);
    while (bytes.length > 32 && bytes[0] === 0) bytes = bytes.subarray(1);
    if (bytes.length > 32) {
      throw new Error("The authenticator returned an invalid WebAuthn signature.");
    }
    return { bytes, next: end };
  };

  const r = readInteger(2);
  const s = readInteger(r.next);
  if (s.next !== derSignature.length) {
    throw new Error("The authenticator returned an invalid WebAuthn signature.");
  }

  const curveOrder = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
  const rValue = BigInt(`0x${r.bytes.toString("hex")}`);
  let sValue = BigInt(`0x${s.bytes.toString("hex")}`);
  if (rValue <= 0n || rValue >= curveOrder || sValue <= 0n || sValue >= curveOrder) {
    throw new Error("The authenticator returned an invalid WebAuthn signature.");
  }
  if (sValue > curveOrder / 2n) sValue = curveOrder - sValue;

  return Buffer.concat([
    Buffer.alloc(32 - r.bytes.length),
    r.bytes,
    Buffer.from(sValue.toString(16).padStart(64, "0"), "hex"),
  ]);
}

function signerScVal(signer: ContractSigner) {
  if (signer.tag === "Delegated") {
    return xdr.ScVal.scvVec([
      xdr.ScVal.scvSymbol("Delegated"),
      xdr.ScVal.scvAddress(Address.fromString(signer.values[0]).toScAddress()),
    ]);
  }
  return xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol("External"),
    xdr.ScVal.scvAddress(Address.fromString(signer.values[0]).toScAddress()),
    xdr.ScVal.scvBytes(Buffer.from(signer.values[1])),
  ]);
}

function parseSignerScVal(value: xdr.ScVal): ContractSigner {
  if (value.switch().name !== "scvVec")
    throw new Error("AuthPayload contains an invalid signer key.");
  const [variant, address, keyData] = value.vec() ?? [];
  if (
    !variant ||
    !address ||
    variant.switch().name !== "scvSymbol" ||
    address.switch().name !== "scvAddress"
  ) {
    throw new Error("AuthPayload contains an invalid signer key.");
  }
  if (variant.sym().toString() === "Delegated") {
    return { tag: "Delegated", values: [Address.fromScAddress(address.address()).toString()] };
  }
  if (variant.sym().toString() === "External" && keyData?.switch().name === "scvBytes") {
    return {
      tag: "External",
      values: [Address.fromScAddress(address.address()).toString(), Buffer.from(keyData.bytes())],
    };
  }
  throw new Error("AuthPayload contains an unsupported signer key.");
}

function signerKey(signer: ContractSigner) {
  return signerScVal(signer).toXDR("hex");
}

function readAuthPayload(signature: xdr.ScVal): AuthPayload {
  const payload: AuthPayload = { contextRuleIds: [], signers: new Map() };
  if (signature.switch().name === "scvVoid") return payload;
  if (signature.switch().name !== "scvMap") {
    throw new Error("This smart account uses an unsupported authorization payload format.");
  }

  for (const field of signature.map() ?? []) {
    if (field.key().switch().name !== "scvSymbol") continue;
    const name = field.key().sym().toString();
    if (name === "context_rule_ids") {
      if (field.val().switch().name !== "scvVec") {
        throw new Error("AuthPayload context rule IDs are malformed.");
      }
      payload.contextRuleIds = (field.val().vec() ?? []).map((id) => {
        if (id.switch().name !== "scvU32")
          throw new Error("AuthPayload context rule IDs are malformed.");
        return id.u32();
      });
    } else if (name === "signers") {
      if (field.val().switch().name !== "scvMap") {
        throw new Error("AuthPayload signers are malformed.");
      }
      for (const entry of field.val().map() ?? []) {
        if (entry.val().switch().name !== "scvBytes") {
          throw new Error("AuthPayload signer signatures are malformed.");
        }
        const signer = parseSignerScVal(entry.key());
        payload.signers.set(signerKey(signer), {
          signer,
          signature: Buffer.from(entry.val().bytes()),
        });
      }
    }
  }
  return payload;
}

function webAuthnSignatureScVal(assertion: WebAuthnAssertion) {
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("authenticator_data"),
      val: xdr.ScVal.scvBytes(decodeBase64Url(assertion.response.authenticatorData)),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("client_data"),
      val: xdr.ScVal.scvBytes(decodeBase64Url(assertion.response.clientDataJSON)),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("signature"),
      val: xdr.ScVal.scvBytes(compactEcdsaSignature(decodeBase64Url(assertion.response.signature))),
    }),
  ]);
}

export function buildContextAwareAuthPayload(
  contextRuleIds: readonly number[],
  signers: readonly { signer: ContractSigner; signature: Uint8Array }[],
) {
  const signerEntries = signers
    .map(
      (value) =>
        new xdr.ScMapEntry({
          key: signerScVal(value.signer),
          val: xdr.ScVal.scvBytes(Buffer.from(value.signature)),
        }),
    )
    .sort((left, right) => left.key().toXDR("hex").localeCompare(right.key().toXDR("hex")));
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("context_rule_ids"),
      val: xdr.ScVal.scvVec(contextRuleIds.map((id) => xdr.ScVal.scvU32(id))),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("signers"),
      val: xdr.ScVal.scvMap(signerEntries),
    }),
  ]);
}

function invocationContextKeys(entry: xdr.SorobanAuthorizationEntry) {
  const keys = new Set<string>();
  const walk = (invocation: xdr.SorobanAuthorizedInvocation) => {
    const fn = invocation.function();
    if (fn.switch().name === "sorobanAuthorizedFunctionTypeContractFn") {
      const call = fn.contractFn();
      const args = call.args();
      const target =
        call.functionName().toString() === "execute" &&
        args.length >= 3 &&
        args[0]?.switch().name === "scvAddress" &&
        (args[1]?.switch().name === "scvSymbol" || args[1]?.switch().name === "scvString") &&
        args[2]?.switch().name === "scvVec"
          ? Address.fromScAddress(args[0]!.address()).toString()
          : Address.fromScAddress(call.contractAddress()).toString();
      keys.add(`CallContract:${target}`);
    }
    for (const subInvocation of invocation.subInvocations()) walk(subInvocation);
  };
  walk(entry.rootInvocation());
  return [...keys];
}

export function buildContextAwareAuthDigest(
  networkPassphrase: string,
  entry: xdr.SorobanAuthorizationEntry,
  expiration: number,
  contextRuleIds: readonly number[],
) {
  const credentials = entry.credentials().address();
  const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId: hash(Buffer.from(networkPassphrase)),
      nonce: credentials.nonce(),
      signatureExpirationLedger: expiration,
      invocation: entry.rootInvocation(),
    }),
  );
  const authorizationPayload = hash(preimage.toXDR());
  const contextPayload = xdr.ScVal.scvVec(contextRuleIds.map((id) => xdr.ScVal.scvU32(id))).toXDR();
  return hash(Buffer.concat([authorizationPayload, contextPayload]));
}

async function signWithContextAwarePayload(
  kit: TSmartAccountKit,
  entry: Parameters<TSmartAccountKit["signAuthEntry"]>[0],
  options?: PasskeySignatureOptions,
) {
  const contractId = kit.contractId;
  const credentialId = options?.credentialId ?? kit.credentialId;
  if (!contractId || !credentialId || !kit.wallet) {
    throw new Error("Connect a Velo smart account before signing.");
  }
  const verifiedDefaultRule = verifiedDefaultContextRules.get(contractId);
  if (!verifiedDefaultRule || verifiedDefaultRule.context_type.tag !== "Default") {
    throw new Error("The selected smart account's default passkey rule has not been verified.");
  }
  const signer = verifiedDefaultRule.signers.find((value) =>
    externalSignerMatches(value, credentialId, getSmartAccountConfig().webauthnVerifierAddress),
  );
  if (!signer || signer.tag !== "External") {
    throw new Error("This passkey is not an active signer on the selected Velo smart account.");
  }
  if (verifiedDefaultRule.id !== DEFAULT_CONTEXT_RULE_ID) {
    throw new Error("Velo could not resolve the verified default smart-account context rule.");
  }

  const runtime = kit as unknown as SmartAccountSigningRuntime;
  if (!runtime.webAuthn || !runtime.rpId || !runtime.storage || !runtime.calculateExpiration) {
    throw new Error("The installed smart-account kit does not support Velo's auth payload format.");
  }
  const normalizedEntry = xdr.SorobanAuthorizationEntry.fromXDR(entry.toXDR());
  if (normalizedEntry.credentials().switch().name !== "sorobanCredentialsAddress") {
    throw new Error("Passkey signing requires address authorization credentials.");
  }
  const credentials = normalizedEntry.credentials().address();
  const expiration = options?.expiration ?? (await runtime.calculateExpiration.call(kit));
  credentials.signatureExpirationLedger(expiration);

  const contextKeys = invocationContextKeys(normalizedEntry);
  const contextRuleIds = (contextKeys.length > 0 ? contextKeys : ["Default"]).map(
    () => DEFAULT_CONTEXT_RULE_ID,
  );
  const challenge = buildContextAwareAuthDigest(
    kit.networkPassphrase,
    normalizedEntry,
    expiration,
    contextRuleIds,
  );
  const assertion = await runtime.webAuthn.startAuthentication({
    optionsJSON: {
      challenge: encodeBase64Url(challenge),
      rpId: runtime.rpId,
      userVerification: "preferred",
      timeout: 60_000,
      allowCredentials: [{ id: credentialId, type: "public-key" }],
    },
  });
  if (normalizeCredentialId(assertion.id) !== normalizeCredentialId(credentialId)) {
    throw new Error("The authenticator returned a different credential than the selected account.");
  }

  const signatureData = webAuthnSignatureScVal(assertion).toXDR();
  const payload = readAuthPayload(credentials.signature());
  if (
    payload.contextRuleIds.length > 0 &&
    payload.contextRuleIds.join(",") !== contextRuleIds.join(",")
  ) {
    throw new Error("The authorization entry uses different smart-account context rules.");
  }
  payload.contextRuleIds = contextRuleIds;
  payload.signers.set(signerKey(signer), { signer, signature: Buffer.from(signatureData) });
  credentials.signature(
    buildContextAwareAuthPayload(contextRuleIds, Array.from(payload.signers.values())),
  );
  await runtime.storage.update(credentialId, { lastUsedAt: Date.now() }).catch(() => undefined);
  return normalizedEntry;
}

function installContextAwareSigning(kit: TSmartAccountKit) {
  if (contextAwareSigningKits.has(kit)) return;
  kit.signAuthEntry = (entry, options) => signWithContextAwarePayload(kit, entry, options);
  contextAwareSigningKits.add(kit);
}

export async function signPasskeyAuthorizationEntry(
  kit: TSmartAccountKit,
  entry: Parameters<TSmartAccountKit["signAuthEntry"]>[0],
  expiration: number,
) {
  return signWithContextAwarePayload(kit, entry, { expiration });
}

function normalizeContractSigner(signer: unknown): ContractSigner | null {
  const normalizedSigner = Array.isArray(signer)
    ? signer[0] === "External"
      ? { tag: "External", values: [signer[1], signer[2]] }
      : signer[0] === "Delegated"
        ? { tag: "Delegated", values: [signer[1]] }
        : null
    : signer;
  if (
    !normalizedSigner ||
    typeof normalizedSigner !== "object" ||
    !("tag" in normalizedSigner) ||
    !("values" in normalizedSigner) ||
    !Array.isArray(normalizedSigner.values)
  ) {
    return null;
  }

  if (normalizedSigner.tag === "External") {
    if (
      typeof normalizedSigner.values[0] !== "string" ||
      !(normalizedSigner.values[1] instanceof Uint8Array)
    ) {
      return null;
    }
    return {
      tag: "External",
      values: [normalizedSigner.values[0], Buffer.from(normalizedSigner.values[1])],
    };
  }
  if (normalizedSigner.tag === "Delegated" && typeof normalizedSigner.values[0] === "string") {
    return { tag: "Delegated", values: [normalizedSigner.values[0]] };
  }
  return null;
}

function externalSignerMatches(signer: unknown, credentialId: string, verifierAddress: string) {
  const normalizedSigner = normalizeContractSigner(signer);
  if (!normalizedSigner || normalizedSigner.tag !== "External") return false;
  if (normalizedSigner.values[0].toUpperCase() !== verifierAddress) return false;
  const id = getCredentialIdFromSigner(normalizedSigner);
  return id !== null && normalizeCredentialId(id) === normalizeCredentialId(credentialId);
}

function contextRuleTypeTag(value: unknown) {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  if (value && typeof value === "object" && "tag" in value && typeof value.tag === "string") {
    return value.tag;
  }
  return null;
}

type RawDefaultContextRule = Record<string, unknown> & {
  context_type: unknown;
  signers: unknown[];
};

function isDefaultContextRule(value: unknown): value is RawDefaultContextRule {
  return (
    !!value &&
    typeof value === "object" &&
    "context_type" in value &&
    contextRuleTypeTag(value.context_type) === "Default" &&
    "signers" in value &&
    Array.isArray(value.signers)
  );
}

export function normalizeDefaultContextRuleForSignerLookup(value: unknown): ContextRule | null {
  if (!isDefaultContextRule(value)) return null;

  const signers = value.signers
    .map(normalizeContractSigner)
    .filter((signer): signer is ContractSigner => signer !== null);
  return {
    ...(value as unknown as ContextRule),
    context_type: { tag: "Default", values: undefined },
    id: typeof value.id === "number" ? value.id : DEFAULT_CONTEXT_RULE_ID,
    signers,
  };
}

export async function ensurePasskeySigner(params: {
  kit: TSmartAccountKit;
  contractId: string;
  credentialId: string;
}) {
  verifiedDefaultContextRules.delete(params.contractId);
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
  const normalizedRule = normalizeDefaultContextRuleForSignerLookup(value);
  if (!normalizedRule) {
    throw new Error("The smart account default signer rule could not be read.");
  }
  const signer = normalizedRule.signers.find((item) =>
    externalSignerMatches(item, params.credentialId, config.webauthnVerifierAddress),
  );
  if (!signer) {
    throw new Error("This passkey is not an active signer on the selected Velo smart account.");
  }
  verifiedDefaultContextRules.set(params.contractId, normalizedRule);
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
