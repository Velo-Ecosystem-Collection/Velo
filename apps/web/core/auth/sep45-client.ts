import { Buffer } from "buffer";

import { Address, hash, Keypair, StrKey, xdr } from "@stellar/stellar-sdk";

export type Sep45DiscoveryConfig = {
  endpoint: string;
  contractId: string;
  signingKey: string;
};

export type Sep45Challenge = {
  authorization_entries: string;
  network_passphrase: string;
  signature_expiration_ledger: number;
};

function authorizationEntries(entriesXdr: string) {
  try {
    return Array.from(xdr.SorobanAuthorizationEntries.fromXDR(entriesXdr, "base64"));
  } catch {
    throw new Error("Velo returned malformed SEP-45 authorization entries.");
  }
}

function authAddress(entry: xdr.SorobanAuthorizationEntry) {
  if (entry.credentials().switch().name !== "sorobanCredentialsAddress") return null;
  return Address.fromScAddress(entry.credentials().address().address()).toString();
}

function invocation(entry: xdr.SorobanAuthorizationEntry, expectedContract: string) {
  if (entry.rootInvocation().subInvocations().length !== 0) {
    throw new Error("Velo returned an SEP-45 challenge with unexpected sub-invocations.");
  }
  const fn = entry.rootInvocation().function();
  if (fn.switch().name !== "sorobanAuthorizedFunctionTypeContractFn") {
    throw new Error("Velo returned an unsupported SEP-45 challenge invocation.");
  }
  const call = fn.contractFn();
  if (Address.fromScAddress(call.contractAddress()).toString() !== expectedContract) {
    throw new Error("Velo's SEP-45 challenge targets an untrusted contract.");
  }
  if (call.functionName().toString() !== "web_auth_verify" || call.args().length !== 1) {
    throw new Error("Velo's SEP-45 challenge contains unexpected arguments.");
  }
  const values = new Map<string, string>();
  const map = call.args()[0]?.map();
  if (!map) throw new Error("Velo's SEP-45 challenge arguments are missing.");
  for (const item of map) {
    if (item.key().switch().name !== "scvSymbol" || item.val().switch().name !== "scvString") {
      throw new Error("Velo's SEP-45 challenge arguments have an invalid type.");
    }
    values.set(item.key().sym().toString(), item.val().str().toString());
  }
  const required = [
    "account",
    "home_domain",
    "nonce",
    "web_auth_domain",
    "web_auth_domain_account",
  ];
  if (values.size !== required.length || required.some((key) => !values.has(key))) {
    throw new Error("Velo's SEP-45 challenge is missing a required value.");
  }
  return { call, args: Object.fromEntries(values) as Record<string, string> };
}

function verifyServerSignature(
  entry: xdr.SorobanAuthorizationEntry,
  signingKey: string,
  networkPassphrase: string,
) {
  if (authAddress(entry) !== signingKey)
    throw new Error("Velo's SEP-45 server authorization is missing.");
  const credentials = entry.credentials().address();
  const signatures = credentials.signature();
  const signatureValues = signatures.switch().name === "scvVec" ? signatures.vec() : null;
  if (!signatureValues || signatureValues.length !== 1) {
    throw new Error("Velo's SEP-45 server authorization signature is malformed.");
  }
  const signatureFields = signatureValues[0]?.map();
  if (!signatureFields) throw new Error("Velo's SEP-45 server signature is malformed.");
  const values = new Map<string, Buffer>();
  for (const field of signatureFields) {
    if (field.key().switch().name !== "scvSymbol" || field.val().switch().name !== "scvBytes") {
      throw new Error("Velo's SEP-45 server signature contains invalid fields.");
    }
    values.set(field.key().sym().toString(), Buffer.from(field.val().bytes()));
  }
  const publicKey = values.get("public_key");
  const signature = values.get("signature");
  const expectedPublicKey = Buffer.from(StrKey.decodeEd25519PublicKey(signingKey));
  if (!publicKey || !signature || !publicKey.equals(expectedPublicKey)) {
    throw new Error("Velo's SEP-45 server signature does not match its published signing key.");
  }

  const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId: hash(Buffer.from(networkPassphrase)),
      nonce: credentials.nonce(),
      signatureExpirationLedger: credentials.signatureExpirationLedger(),
      invocation: entry.rootInvocation(),
    }),
  );
  if (!Keypair.fromPublicKey(signingKey).verify(hash(preimage.toXDR()), signature)) {
    throw new Error("Velo's SEP-45 challenge signature could not be verified.");
  }
}

export async function discoverSep45Config(): Promise<Sep45DiscoveryConfig> {
  const response = await fetch("/.well-known/stellar.toml", { cache: "no-store" });
  if (!response.ok) throw new Error("Velo's SEP-45 discovery configuration is unavailable.");
  const body = await response.text();
  const fields = new Map<string, string>();
  for (const match of body.matchAll(/^([A-Z0-9_]+)\s*=\s*"([^"]+)"\s*$/gm)) {
    if (match[1] && match[2]) fields.set(match[1], match[2]);
  }
  const endpoint = fields.get("WEB_AUTH_FOR_CONTRACTS_ENDPOINT");
  const contractId = fields.get("WEB_AUTH_CONTRACT_ID");
  const signingKey = fields.get("SIGNING_KEY");
  if (!endpoint || !contractId || !signingKey) {
    throw new Error("Velo's SEP-45 discovery configuration is incomplete.");
  }
  const parsedEndpoint = new URL(endpoint, window.location.origin);
  if (parsedEndpoint.origin !== window.location.origin) {
    throw new Error("Velo's SEP-45 endpoint does not match the current Velo domain.");
  }
  return {
    endpoint: parsedEndpoint.toString(),
    contractId: Address.fromString(contractId).toString(),
    signingKey,
  };
}

export function validateSep45Challenge(params: {
  account: string;
  challenge: Sep45Challenge;
  config: Sep45DiscoveryConfig;
  networkPassphrase: string;
  homeDomain: string;
}) {
  if (params.challenge.network_passphrase !== params.networkPassphrase) {
    throw new Error("Velo's SEP-45 challenge is for a different Stellar network.");
  }
  if (
    !Number.isSafeInteger(params.challenge.signature_expiration_ledger) ||
    params.challenge.signature_expiration_ledger <= 0
  ) {
    throw new Error("Velo returned an invalid SEP-45 signature expiration.");
  }

  const entries = authorizationEntries(params.challenge.authorization_entries);
  if (entries.length !== 2) throw new Error("Velo returned an incomplete SEP-45 challenge.");
  const parsed = entries.map((entry) => ({
    entry,
    ...invocation(entry, params.config.contractId),
  }));
  const first = parsed[0];
  if (!first) throw new Error("Velo returned an empty SEP-45 challenge.");
  const expectedAccount = Address.fromString(params.account).toString();
  if (!expectedAccount.startsWith("C"))
    throw new Error("SEP-45 authentication requires a contract account.");

  for (const item of parsed) {
    if (
      item.args.account !== expectedAccount ||
      item.args.home_domain !== params.homeDomain ||
      item.args.web_auth_domain !== params.homeDomain ||
      item.args.web_auth_domain_account !== params.config.signingKey ||
      item.args.nonce !== first.args.nonce
    ) {
      throw new Error("Velo's SEP-45 challenge does not match this account and domain.");
    }
  }

  const serverEntries = parsed.filter(
    (item) => authAddress(item.entry) === params.config.signingKey,
  );
  const accountEntries = parsed.filter((item) => authAddress(item.entry) === expectedAccount);
  if (serverEntries.length !== 1 || accountEntries.length !== 1) {
    throw new Error("Velo's SEP-45 challenge contains unexpected signer accounts.");
  }
  verifyServerSignature(
    serverEntries[0]!.entry,
    params.config.signingKey,
    params.networkPassphrase,
  );

  return {
    entries,
    accountEntry: accountEntries[0]!.entry,
    expirationLedger: params.challenge.signature_expiration_ledger,
  };
}

export function encodeSep45Entries(entries: readonly xdr.SorobanAuthorizationEntry[]) {
  const count = Buffer.alloc(4);
  count.writeUInt32BE(entries.length);
  return Buffer.concat([count, ...entries.map((entry) => entry.toXDR())]).toString("base64");
}
