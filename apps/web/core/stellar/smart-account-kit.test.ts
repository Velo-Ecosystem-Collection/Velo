import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

import { Address, xdr } from "@stellar/stellar-sdk";

const fixture = { submissionMethod: "relayer" as "rpc" | "relayer" };
Object.assign(globalThis, { __veloSmartAccountKitFixture: fixture });

const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "./smart-account-config") {
      return { url: "velo-smart-account-kit-test:config", shortCircuit: true };
    }
    if (specifier === "smart-account-kit") {
      return { url: "velo-smart-account-kit-test:package", shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === "velo-smart-account-kit-test:config") {
      return {
        format: "module",
        source:
          "const fixture = globalThis.__veloSmartAccountKitFixture; export function assertPasskeyBrowserConfiguration() {} export function getSmartAccountConfig() { return {}; } export async function getSmartAccountSubmissionMethod() { return fixture.submissionMethod; }",
        shortCircuit: true,
      };
    }
    if (url !== "velo-smart-account-kit-test:package") return next(url, context);
    return {
      format: "module",
      source: `
        export function getCredentialIdFromSigner(signer) {
          if (signer.tag !== "External") return null;
          const keyData = signer.values[1];
          if (keyData.length <= 65) return null;
          return keyData.subarray(65).toString("base64url");
        }
        export class IndexedDBStorage {}
        export class IndexerError extends Error {}
        export class LocalStorageAdapter {}
        export class SmartAccountKit {}
      `,
      shortCircuit: true,
    };
  },
});

const {
  createVeloPasskeyAccount,
  buildContextAwareAuthDigest,
  buildContextAwareAuthPayload,
  normalizeDiscoveredAccounts,
  normalizeDefaultContextRuleForSignerLookup,
  reconnectPasskeyAccount,
  resolvePasskeyAccountDiscovery,
} = await import("./smart-account-kit.ts");
const { getCredentialIdFromSigner } = await import("smart-account-kit");

const FIRST_ACCOUNT = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
const SECOND_ACCOUNT = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA2ZMN";

test("passkey creation uses the configured relayer and verifies its new signer", async () => {
  fixture.submissionMethod = "relayer";
  let createArgs: unknown[] = [];
  const kit = {
    createWallet: async (...args: unknown[]) => {
      createArgs = args;
      return {
        contractId: FIRST_ACCOUNT,
        credentialId: "credential-id",
        submitResult: { success: true },
      };
    },
  } as unknown as Parameters<typeof createVeloPasskeyAccount>[0];
  const verified: Array<{ contractId: string; credentialId: string }> = [];

  const result = await createVeloPasskeyAccount(kit, async ({ contractId, credentialId }) => {
    verified.push({ contractId, credentialId });
  });

  assert.equal(createArgs[0], "Velo");
  assert.match(String(createArgs[1]), /^velo-[a-z0-9]+$/);
  assert.deepEqual(createArgs[2], {
    autoSubmit: true,
    forceMethod: "relayer",
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  });
  assert.equal(result.contractId, FIRST_ACCOUNT);
  assert.deepEqual(verified, [{ contractId: FIRST_ACCOUNT, credentialId: "credential-id" }]);
});

test("passkey creation rejects deployment failures and preserves user cancellation", async () => {
  fixture.submissionMethod = "relayer";
  const failedDeployment = {
    createWallet: async () => ({
      contractId: FIRST_ACCOUNT,
      credentialId: "credential-id",
      submitResult: { success: false, error: "Relayer rejected deployment." },
    }),
  } as unknown as Parameters<typeof createVeloPasskeyAccount>[0];
  await assert.rejects(
    createVeloPasskeyAccount(failedDeployment, async () => undefined),
    /Relayer rejected deployment/,
  );

  const canceled = {
    createWallet: async () => {
      throw new DOMException("The operation was canceled", "NotAllowedError");
    },
  } as unknown as Parameters<typeof createVeloPasskeyAccount>[0];
  await assert.rejects(
    createVeloPasskeyAccount(canceled, async () => undefined),
    {
      name: "NotAllowedError",
    },
  );
});

test("passkey creation falls back to direct Testnet RPC when no relayer is configured", async () => {
  fixture.submissionMethod = "rpc";
  let createArgs: unknown[] = [];
  const kit = {
    createWallet: async (...args: unknown[]) => {
      createArgs = args;
      return {
        contractId: FIRST_ACCOUNT,
        credentialId: "credential-id",
        submitResult: { success: true },
      };
    },
  } as unknown as Parameters<typeof createVeloPasskeyAccount>[0];

  let feePayerVerified = false;
  await createVeloPasskeyAccount(
    kit,
    async () => undefined,
    async () => {
      feePayerVerified = true;
    },
  );

  assert.deepEqual(createArgs[2], {
    autoSubmit: true,
    forceMethod: "rpc",
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  });
  assert.equal(feePayerVerified, true);
});

test("passkey reconnect verifies the restored account and reports missing or stale sessions", async () => {
  const missingSession = {
    connectWallet: async () => null,
  } as unknown as Parameters<typeof reconnectPasskeyAccount>[0];
  assert.equal(await reconnectPasskeyAccount(missingSession), null);

  const restoredSession = {
    connectWallet: async () => ({ contractId: FIRST_ACCOUNT, credentialId: "credential-id" }),
  } as unknown as Parameters<typeof reconnectPasskeyAccount>[0];
  const verified: Array<{ contractId: string; credentialId: string }> = [];
  const result = await reconnectPasskeyAccount(
    restoredSession,
    async ({ contractId, credentialId }) => {
      verified.push({ contractId, credentialId });
    },
  );
  assert.equal(result?.contractId, FIRST_ACCOUNT);
  assert.deepEqual(verified, [{ contractId: FIRST_ACCOUNT, credentialId: "credential-id" }]);

  await assert.rejects(
    reconnectPasskeyAccount(restoredSession, async () => {
      throw new Error("This passkey is not an active signer on the selected Velo smart account.");
    }),
    /not an active signer/,
  );
});

test.after(() => hooks.deregister());
test.after(() => Reflect.deleteProperty(globalThis, "__veloSmartAccountKitFixture"));

test("multiple discovered Velo accounts require explicit selection", () => {
  const accounts = normalizeDiscoveredAccounts([
    { contract_id: FIRST_ACCOUNT, last_seen_ledger: 10 },
    { contract_id: SECOND_ACCOUNT, last_seen_ledger: 20 },
  ] as never);

  assert.deepEqual(resolvePasskeyAccountDiscovery(accounts), { kind: "select", accounts });
  assert.deepEqual(resolvePasskeyAccountDiscovery([accounts[0]!]), {
    kind: "connect",
    contractId: FIRST_ACCOUNT,
  });
  assert.deepEqual(resolvePasskeyAccountDiscovery([]), { kind: "connect", contractId: undefined });
});

test("verified Soroban tuple signers normalize to the SDK signer shape", () => {
  const credentialBytes = Buffer.from("passkey-credential");
  const keyData = Buffer.concat([Buffer.alloc(65, 1), credentialBytes]);
  const verifierAddress = "CVERIFIER";
  const normalized = normalizeDefaultContextRuleForSignerLookup({
    context_type: ["Default"],
    name: "Default passkey signer",
    signers: [
      ["External", verifierAddress, new Uint8Array(keyData)],
      ["Delegated", "GDELEGATED"],
    ],
  });

  assert.ok(normalized);
  assert.equal(normalized.context_type.tag, "Default");
  assert.equal(normalized.signers[0]?.tag, "External");
  if (normalized.signers[0]?.tag !== "External") {
    assert.fail("Expected the tuple signer to normalize as External.");
  }
  assert.equal(Buffer.isBuffer(normalized.signers[0].values[1]), true);
  assert.equal(
    getCredentialIdFromSigner(normalized.signers[0]),
    credentialBytes.toString("base64url"),
  );
  assert.equal(normalized.signers[1]?.tag, "Delegated");
  assert.equal(
    normalizeDefaultContextRuleForSignerLookup({ context_type: ["CallContract"] }),
    null,
  );
});

test("smart-account auth payload carries context IDs and nested WebAuthn signature bytes", () => {
  const signer = {
    tag: "External",
    values: ["CATPTBRWVMH5ZCIKO5HN2F4FMPXVZEXC56RKGHRXCM7EEZGGXK7PICEH", Buffer.from([1, 2, 3])],
  } as const;
  const signatureData = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("authenticator_data"),
      val: xdr.ScVal.scvBytes(Buffer.from("authenticator")),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("client_data"),
      val: xdr.ScVal.scvBytes(Buffer.from("client")),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("signature"),
      val: xdr.ScVal.scvBytes(Buffer.from("compact-signature")),
    }),
  ]).toXDR();
  const payload = buildContextAwareAuthPayload([0], [{ signer, signature: signatureData }]);

  assert.equal(payload.switch().name, "scvMap");
  const fields = new Map(
    (payload.map() ?? []).map((entry) => [entry.key().sym().toString(), entry.val()]),
  );
  const contextRuleIds = fields.get("context_rule_ids");
  const signers = fields.get("signers");
  assert.equal(contextRuleIds?.switch().name, "scvVec");
  assert.deepEqual(
    contextRuleIds?.vec()?.map((id) => id.u32()),
    [0],
  );
  assert.equal(signers?.switch().name, "scvMap");
  assert.equal(signers?.map()?.length, 1);
  const signerEntry = signers?.map()?.[0];
  assert.equal(signerEntry?.key().switch().name, "scvVec");
  assert.equal(signerEntry?.val().switch().name, "scvBytes");
  const decodedSignature = xdr.ScVal.fromXDR(signerEntry!.val().bytes());
  assert.equal(decodedSignature.switch().name, "scvMap");
  assert.deepEqual(
    (decodedSignature.map() ?? []).map((field) => field.key().sym().toString()),
    ["authenticator_data", "client_data", "signature"],
  );
});

test("smart-account auth challenge digest binds the selected context rule IDs", () => {
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: Address.fromString(
          "CBPX3F3JSPEWPB3K53U23SNAVFMTUZB75ITIC3UCKK7YPFLI6YJXS4SV",
        ).toScAddress(),
        functionName: "web_auth_verify",
        args: [xdr.ScVal.scvVoid()],
      }),
    ),
    subInvocations: [],
  });
  const entry = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: Address.fromString(FIRST_ACCOUNT).toScAddress(),
        nonce: xdr.Int64.fromString("1"),
        signatureExpirationLedger: 100,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: invocation,
  });

  const withDefaultRule = buildContextAwareAuthDigest(
    "Test SDF Network ; September 2015",
    entry,
    100,
    [0],
  );
  const withDifferentRule = buildContextAwareAuthDigest(
    "Test SDF Network ; September 2015",
    entry,
    100,
    [1],
  );
  assert.equal(withDefaultRule.equals(withDifferentRule), false);
});
