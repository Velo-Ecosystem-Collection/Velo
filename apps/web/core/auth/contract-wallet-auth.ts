import { Buffer } from "node:buffer";
import { createHash, randomBytes } from "node:crypto";

import { assertValidContractId } from "@repo/stellar/validation";
import {
  Address,
  authorizeEntry,
  BASE_FEE,
  Contract,
  hash,
  Keypair,
  rpc,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";

import { env } from "../config/env";
import { stellarConfig } from "../config/stellar";
import { walletAuthIssuer, walletAuthServerKeypair } from "./wallet-jwt";

const SEP45_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const AUTH_ENTRY_EXPIRATION_LEDGERS = 60;
const MAX_AUTH_ENTRY_EXPIRATION_LEDGERS = 75;
const AUTH_ENTRY_LIMIT = 2;
const SMART_ACCOUNT_KIT_SIMULATION_SOURCE = Keypair.fromRawEd25519Seed(
  hash(Buffer.from("openzeppelin-smart-account-kit")),
).publicKey();

type Sep45Arguments = {
  account: string;
  home_domain: string;
  nonce: string;
  web_auth_domain: string;
  web_auth_domain_account: string;
};

function configuredWebAuthContractId() {
  if (!env.NEXT_PUBLIC_ENABLE_PASSKEYS) {
    throw new Error("Velo passkey authentication is disabled.");
  }
  const contractId = env.NEXT_PUBLIC_VELO_WEB_AUTH_CONTRACT_ID?.trim();
  if (!contractId) throw new Error("Velo SEP-45 Web Auth contract is not configured.");
  return assertValidContractId(contractId);
}

function domain() {
  return new URL(walletAuthIssuer()).host;
}

function challengeHash(address: string, nonce: string, args: Sep45Arguments, contractId: string) {
  return createHash("sha256")
    .update(
      [
        address,
        nonce,
        contractId,
        args.home_domain,
        args.web_auth_domain,
        args.web_auth_domain_account,
        stellarConfig.networkPassphrase,
      ].join("\n"),
    )
    .digest("hex");
}

function invocationArgs(args: Sep45Arguments) {
  return xdr.ScVal.scvMap(
    Object.entries(args).map(
      ([key, value]) =>
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol(key),
          val: xdr.ScVal.scvString(value),
        }),
    ),
  );
}

function accountAddress(entry: xdr.SorobanAuthorizationEntry) {
  if (entry.credentials().switch().name !== "sorobanCredentialsAddress") return null;
  return Address.fromScAddress(entry.credentials().address().address()).toString();
}

function parseInvocation(entry: xdr.SorobanAuthorizationEntry) {
  const root = entry.rootInvocation();
  if (root.subInvocations().length !== 0) {
    throw new Error("SEP-45 authorization entries must not contain sub-invocations.");
  }

  const authorizedFunction = root.function();
  if (authorizedFunction.switch().name !== "sorobanAuthorizedFunctionTypeContractFn") {
    throw new Error("SEP-45 authorization entry has an unsupported invocation type.");
  }

  const call = authorizedFunction.contractFn();
  if (Address.fromScAddress(call.contractAddress()).toString() !== configuredWebAuthContractId()) {
    throw new Error("SEP-45 authorization entry targets an unexpected Web Auth contract.");
  }
  if (call.functionName().toString() !== "web_auth_verify" || call.args().length !== 1) {
    throw new Error("SEP-45 authorization entry has an unexpected function or arguments.");
  }

  const map = call.args()[0]?.map();
  if (!map) throw new Error("SEP-45 authorization arguments are missing.");
  const result = new Map<string, string>();
  for (const item of map) {
    if (item.key().switch().name !== "scvSymbol" || item.val().switch().name !== "scvString") {
      throw new Error("SEP-45 authorization arguments must map symbols to strings.");
    }
    const key = item.key().sym().toString();
    if (result.has(key)) throw new Error("SEP-45 authorization arguments contain duplicate keys.");
    result.set(key, item.val().str().toString());
  }

  const expectedKeys = [
    "account",
    "home_domain",
    "nonce",
    "web_auth_domain",
    "web_auth_domain_account",
  ];
  if (result.size !== expectedKeys.length || expectedKeys.some((key) => !result.has(key))) {
    throw new Error("SEP-45 authorization arguments do not match the supported request.");
  }

  return {
    call,
    args: Object.fromEntries(result) as Sep45Arguments,
  };
}

function assertSignaturePresent(entry: xdr.SorobanAuthorizationEntry) {
  if (entry.credentials().switch().name !== "sorobanCredentialsAddress") {
    throw new Error("SEP-45 authorization entry is missing address credentials.");
  }
  const signature = entry.credentials().address().signature();
  const signatureValues = signature.switch().name === "scvVec" ? signature.vec() : null;
  if (!signatureValues || signatureValues.length === 0) {
    throw new Error("SEP-45 authorization entry has not been signed.");
  }
}

function parseEntries(entriesXdr: string) {
  if (entriesXdr.length > 16_384) throw new Error("SEP-45 authorization entries are too large.");
  let decoded: xdr.SorobanAuthorizationEntry[];
  try {
    decoded = Array.from(xdr.SorobanAuthorizationEntries.fromXDR(entriesXdr, "base64"));
  } catch {
    throw new Error("SEP-45 authorization entries are not valid XDR.");
  }
  if (decoded.length !== AUTH_ENTRY_LIMIT) {
    throw new Error("SEP-45 authorization entries must contain the account and Velo signer.");
  }
  return decoded;
}

function encodeAuthorizationEntries(entries: readonly xdr.SorobanAuthorizationEntry[]) {
  const count = Buffer.alloc(4);
  count.writeUInt32BE(entries.length);
  return Buffer.concat([count, ...entries.map((entry) => entry.toXDR())]).toString("base64");
}

export async function createContractAccountChallenge(account: string) {
  const normalizedAccount = Address.fromString(account.trim().toUpperCase()).toString();
  if (!normalizedAccount.startsWith("C")) {
    throw new Error("SEP-45 authentication only supports Stellar contract accounts.");
  }

  const webAuthContractId = configuredWebAuthContractId();
  const webAuthDomain = domain();
  const serverKeypair = walletAuthServerKeypair();
  const nonce = randomBytes(32).toString("base64url");
  const args: Sep45Arguments = {
    account: normalizedAccount,
    home_domain: webAuthDomain,
    nonce,
    web_auth_domain: webAuthDomain,
    web_auth_domain_account: serverKeypair.publicKey(),
  };

  const server = new rpc.Server(stellarConfig.rpcUrl, { timeout: 30_000 });
  const [sourceAccount, latestLedger] = await Promise.all([
    server.getAccount(SMART_ACCOUNT_KIT_SIMULATION_SOURCE),
    server.getLatestLedger(),
  ]);
  const operation = new Contract(webAuthContractId).call("web_auth_verify", invocationArgs(args));
  const transaction = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: stellarConfig.networkPassphrase,
  })
    .addOperation(operation)
    .setTimeout(30)
    .build();

  const simulation = await server.simulateTransaction(transaction);
  if (rpc.Api.isSimulationError(simulation) || !simulation.result) {
    throw new Error("Stellar RPC could not prepare the SEP-45 challenge.");
  }
  const entries = simulation.result.auth;
  const clientEntry = entries.find((entry) => accountAddress(entry) === normalizedAccount);
  const serverEntry = entries.find((entry) => accountAddress(entry) === serverKeypair.publicKey());
  if (entries.length !== AUTH_ENTRY_LIMIT || !clientEntry || !serverEntry) {
    throw new Error("Stellar RPC returned an incomplete SEP-45 challenge.");
  }

  const expirationLedger = latestLedger.sequence + AUTH_ENTRY_EXPIRATION_LEDGERS;
  const signedServerEntry = await authorizeEntry(
    serverEntry,
    serverKeypair,
    expirationLedger,
    stellarConfig.networkPassphrase,
  );
  const signedServerEntries = entries.map((entry) =>
    entry === serverEntry ? signedServerEntry : entry,
  );

  return {
    account: normalizedAccount,
    nonce,
    challengeHash: challengeHash(normalizedAccount, nonce, args, webAuthContractId),
    challengeId: randomBytes(32).toString("base64url"),
    expiresAt: Date.now() + SEP45_CHALLENGE_TTL_MS,
    authorizationEntries: encodeAuthorizationEntries(signedServerEntries),
    networkPassphrase: stellarConfig.networkPassphrase,
    signatureExpirationLedger: expirationLedger,
  };
}

export async function verifyContractAccountAuthorization(entriesXdr: string) {
  const entries = parseEntries(entriesXdr);
  const parsed = entries.map((entry) => ({ entry, ...parseInvocation(entry) }));
  const first = parsed[0];
  if (!first) throw new Error("SEP-45 authorization entries are missing.");

  const serverKeypair = walletAuthServerKeypair();
  const webAuthContractId = configuredWebAuthContractId();
  const webAuthDomain = domain();
  const args = first.args;
  if (
    args.home_domain !== webAuthDomain ||
    args.web_auth_domain !== webAuthDomain ||
    args.web_auth_domain_account !== serverKeypair.publicKey() ||
    !args.nonce ||
    Address.fromString(args.account).toString() !== args.account ||
    !args.account.startsWith("C")
  ) {
    throw new Error("SEP-45 authorization does not match this Velo domain and account.");
  }

  if (
    parsed.some((value) => value.args.account !== args.account || value.args.nonce !== args.nonce)
  ) {
    throw new Error("SEP-45 authorization entries contain mismatched account or nonce values.");
  }
  const serverEntries = parsed.filter(
    (value) => accountAddress(value.entry) === serverKeypair.publicKey(),
  );
  const accountEntries = parsed.filter((value) => accountAddress(value.entry) === args.account);
  if (serverEntries.length !== 1 || accountEntries.length !== 1) {
    throw new Error("SEP-45 authorization entries are signed by the wrong account.");
  }
  for (const { entry } of parsed) assertSignaturePresent(entry);

  const server = new rpc.Server(stellarConfig.rpcUrl, { timeout: 30_000 });
  const latestLedger = await server.getLatestLedger();
  for (const { entry } of parsed) {
    const credentials = entry.credentials();
    if (credentials.switch().name !== "sorobanCredentialsAddress") {
      throw new Error("SEP-45 authorization entry is missing address credentials.");
    }
    const expiration = credentials.address().signatureExpirationLedger();
    if (
      expiration <= latestLedger.sequence ||
      expiration > latestLedger.sequence + MAX_AUTH_ENTRY_EXPIRATION_LEDGERS
    ) {
      throw new Error("SEP-45 authorization signature has expired or is too long-lived.");
    }
  }

  const operation = new Contract(webAuthContractId).call("web_auth_verify", first.call.args()[0]!);
  operation.body().invokeHostFunctionOp().auth(entries);
  const sourceAccount = await server.getAccount(SMART_ACCOUNT_KIT_SIMULATION_SOURCE);
  const transaction = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: stellarConfig.networkPassphrase,
  })
    .addOperation(operation)
    .setTimeout(30)
    .build();
  const simulation = await server.simulateTransaction(transaction);
  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error("Stellar RPC could not verify the signed SEP-45 authorization.");
  }

  return {
    account: args.account,
    nonce: args.nonce,
    challengeHash: challengeHash(args.account, args.nonce, args, webAuthContractId),
  };
}

export function getContractWebAuthDiscoveryConfig() {
  return {
    endpoint: `${walletAuthIssuer()}/api/auth/wallet/contract`,
    contractId: configuredWebAuthContractId(),
    signingKey: walletAuthServerKeypair().publicKey(),
  };
}
