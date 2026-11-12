import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

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
        export function getCredentialIdFromSigner() { return null; }
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
  normalizeDiscoveredAccounts,
  reconnectPasskeyAccount,
  resolvePasskeyAccountDiscovery,
} = await import("./smart-account-kit.ts");

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
