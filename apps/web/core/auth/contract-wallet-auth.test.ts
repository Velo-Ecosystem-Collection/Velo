import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { after, test } from "node:test";

import { Account, Address, Keypair, StrKey, rpc, xdr } from "@stellar/stellar-sdk";

const WEB_AUTH_CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 8));
const ACCOUNT = StrKey.encodeContract(Buffer.alloc(32, 9));
const WRONG_ACCOUNT = StrKey.encodeContract(Buffer.alloc(32, 10));
const serverKeypair = Keypair.random();
const fixture = { serverKeypair };
Object.assign(globalThis, { __veloContractWalletAuthFixture: fixture });

const sources: Record<string, string> = {
  "../config/env": `export const env = { NEXT_PUBLIC_ENABLE_PASSKEYS: true, NEXT_PUBLIC_VELO_WEB_AUTH_CONTRACT_ID: ${JSON.stringify(WEB_AUTH_CONTRACT)} };`,
  "../config/stellar": `export const stellarConfig = { network: "testnet", rpcUrl: "https://soroban-testnet.stellar.org", networkPassphrase: "Test SDF Network ; September 2015" };`,
  "./wallet-jwt":
    "export function walletAuthIssuer() { return 'https://velo.example'; } export function walletAuthServerKeypair() { return fixture.serverKeypair; }",
  "@repo/stellar/validation": `export function assertValidContractId(value) { if (value !== ${JSON.stringify(WEB_AUTH_CONTRACT)}) throw new Error("Invalid contract ID"); return value; }`,
};

const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier in sources) {
      return { url: `velo-contract-wallet-auth:${specifier}`, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (!url.startsWith("velo-contract-wallet-auth:")) return next(url, context);
    return {
      format: "module",
      source: `const fixture = globalThis.__veloContractWalletAuthFixture; ${sources[url.slice("velo-contract-wallet-auth:".length)]}`,
      shortCircuit: true,
    };
  },
});

const { verifyContractAccountAuthorization } = await import("./contract-wallet-auth.ts");
const { encodeSep45Entries } = await import("./sep45-client.ts");

function invocationArgs(overrides: Record<string, string> = {}) {
  const args = {
    account: ACCOUNT,
    home_domain: "velo.example",
    nonce: "challenge-nonce",
    web_auth_domain: "velo.example",
    web_auth_domain_account: serverKeypair.publicKey(),
    ...overrides,
  };
  return xdr.ScVal.scvMap(
    Object.entries(args).map(
      ([key, value]) =>
        new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val: xdr.ScVal.scvString(value) }),
    ),
  );
}

function authorizationEntry(
  signer: string,
  args: xdr.ScVal,
  expirationLedger = 160,
): xdr.SorobanAuthorizationEntry {
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: Address.fromString(WEB_AUTH_CONTRACT).toScAddress(),
        functionName: "web_auth_verify",
        args: [args],
      }),
    ),
    subInvocations: [],
  });
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: Address.fromString(signer).toScAddress(),
        nonce: xdr.Int64.fromString("1"),
        signatureExpirationLedger: expirationLedger,
        signature: xdr.ScVal.scvVec([xdr.ScVal.scvVoid()]),
      }),
    ),
    rootInvocation: invocation,
  });
}

function authorizationXdr(
  options: {
    account?: string;
    accountArgs?: Record<string, string>;
    serverArgs?: Record<string, string>;
    accountExpiration?: number;
    serverExpiration?: number;
  } = {},
) {
  const account = options.account ?? ACCOUNT;
  const entries = [
    authorizationEntry(account, invocationArgs(options.accountArgs), options.accountExpiration),
    authorizationEntry(
      serverKeypair.publicKey(),
      invocationArgs(options.serverArgs),
      options.serverExpiration,
    ),
  ];
  const count = Buffer.alloc(4);
  count.writeUInt32BE(entries.length);
  return Buffer.concat([count, ...entries.map((entry) => entry.toXDR())]).toString("base64");
}

test("SEP-45 browser authorization serialization round-trips the XDR vararray", () => {
  const entries = [authorizationEntry(ACCOUNT, invocationArgs())];
  const encoded = encodeSep45Entries(entries);
  const decoded = Array.from(xdr.SorobanAuthorizationEntries.fromXDR(encoded, "base64"));
  assert.deepEqual(
    decoded.map((entry) => entry.toXDR("base64")),
    entries.map((entry) => entry.toXDR("base64")),
  );
});

async function withRpc<T>(simulate: () => Promise<unknown>, run: () => Promise<T>) {
  const originals = {
    getLatestLedger: rpc.Server.prototype.getLatestLedger,
    getAccount: rpc.Server.prototype.getAccount,
    simulateTransaction: rpc.Server.prototype.simulateTransaction,
  };
  rpc.Server.prototype.getLatestLedger = async () => ({ sequence: 100 }) as never;
  rpc.Server.prototype.getAccount = async () => new Account(serverKeypair.publicKey(), "1");
  rpc.Server.prototype.simulateTransaction = simulate as never;
  try {
    return await run();
  } finally {
    rpc.Server.prototype.getLatestLedger = originals.getLatestLedger;
    rpc.Server.prototype.getAccount = originals.getAccount;
    rpc.Server.prototype.simulateTransaction = originals.simulateTransaction;
  }
}

test("SEP-45 verifies the exact account, Velo domain, and authorization pair through RPC", async () => {
  const result = await withRpc(
    async () => ({ result: { retval: xdr.ScVal.scvVoid() } }),
    () => verifyContractAccountAuthorization(authorizationXdr()),
  );
  assert.equal(result.account, ACCOUNT);
  assert.equal(result.nonce, "challenge-nonce");
  assert.match(result.challengeHash, /^[a-f0-9]{64}$/);
});

test("SEP-45 rejects the wrong contract account and altered authorization values", async () => {
  await assert.rejects(
    withRpc(
      async () => ({ result: { retval: xdr.ScVal.scvVoid() } }),
      () => verifyContractAccountAuthorization(authorizationXdr({ account: WRONG_ACCOUNT })),
    ),
    /signed by the wrong account/,
  );

  await assert.rejects(
    verifyContractAccountAuthorization(
      authorizationXdr({ accountArgs: { home_domain: "attacker.example" } }),
    ),
    /does not match this Velo domain/,
  );

  await assert.rejects(
    verifyContractAccountAuthorization(
      authorizationXdr({ serverArgs: { nonce: "altered-nonce" } }),
    ),
    /mismatched account or nonce/,
  );
});

test("SEP-45 rejects expired credentials and fails closed when RPC cannot verify", async () => {
  await assert.rejects(
    withRpc(
      async () => ({ result: { retval: xdr.ScVal.scvVoid() } }),
      () =>
        verifyContractAccountAuthorization(
          authorizationXdr({ accountExpiration: 100, serverExpiration: 160 }),
        ),
    ),
    /expired or is too long-lived/,
  );

  await assert.rejects(
    withRpc(
      async () => ({ error: "RPC unavailable" }),
      () => verifyContractAccountAuthorization(authorizationXdr()),
    ),
    /could not verify the signed SEP-45 authorization/,
  );
});

after(() => {
  hooks.deregister();
  Reflect.deleteProperty(globalThis, "__veloContractWalletAuthFixture");
});
