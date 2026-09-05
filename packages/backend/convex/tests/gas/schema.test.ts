/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { convexToJson } from "convex/values";
import { expect, test } from "vitest";

import type { Doc, Id } from "../../_generated/dataModel";

import {
  findExecutionAttemptByIdempotencyKeyHash,
  findExecutionAttemptByInnerTransactionHash,
  findExecutionAttemptByRequestId,
} from "../../gas/execution.ts";
import { projectGasLog, projectGasPolicy, projectRelayerAccount } from "../../gas/projections.ts";
import {
  GAS_DECISION_CODES,
  GAS_LIFECYCLE_STATES,
  GAS_MAX_STROOPS,
  GAS_NETWORK,
  GAS_RELAYER_STATUSES,
} from "../../gas/types.ts";
import schema from "../../schema";

const modules = import.meta.glob("../../**/*.ts");

const OWNER = "GD7O2C226SF2677PFFUVD6O2ICFOBNCWPI5Z46N43ZSFQGLM65U3I2SP";
const SOURCE_WALLET = "GBNHK3TLWWXBCEGNFHB45Z66R4AI5YUALKUFBP4WF7YK5JLZIAAG2DLI";
const CONTRACT_ID = "CC7RENKPGXGF6MMEMGJ4YWUBOBGQYOCGG33PNSONQF56UMMAQ22TWH6R";
const RELAYER_PUBLIC_KEY = "GAI7NKM2MASZ4OJH2LQNMXL4VEUVOWPVDNRVTB6XQRWYYRX3JD4KX4ZI";
const TRANSACTION_HASH = "a".repeat(64);
const NOW = 1_757_000_000_000;

type GasPolicyInput = Omit<Doc<"gasPolicies">, "_id" | "_creationTime">;
type GasLogInput = Omit<Doc<"gasLogs">, "_id" | "_creationTime">;
type RelayerAccountInput = Omit<Doc<"relayerAccounts">, "_id" | "_creationTime">;
type GasExecutionAttemptInput = Omit<Doc<"gasExecutionAttempts">, "_id" | "_creationTime">;

async function createProject(t: ReturnType<typeof convexTest>): Promise<Id<"projects">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("projects", {
      name: "Gas Boundary Test Project",
      slug: "gas-boundary-test",
      description: "Gas boundary tests",
      metadataJson: "{}",
      metadataHash: "0".repeat(64),
      ownerAddress: OWNER,
      status: "draft",
      createdAt: NOW,
      updatedAt: NOW,
    });
  });
}

function policyInput(projectId: Id<"projects">): GasPolicyInput {
  return {
    projectId,
    enabled: true,
    network: GAS_NETWORK,
    dailyCapStroops: 1_000n,
    dailyReservedStroops: 250n,
    dailyWindowKey: "2026-09-03",
    walletHourlyLimit: 12,
    allowedContractIds: [CONTRACT_ID],
    createdAt: NOW,
    updatedAt: NOW + 1,
  };
}

function logInput(projectId: Id<"projects">, overrides: Partial<GasLogInput> = {}): GasLogInput {
  return {
    projectId,
    requestId: "gas-request-1",
    idempotencyKeyHash: "idempotency-hash",
    requestFingerprint: "request-fingerprint",
    transactionHash: TRANSACTION_HASH,
    sourceWallet: SOURCE_WALLET,
    targetContractIds: [CONTRACT_ID],
    innerMaxFeeStroops: 100n,
    reservedStroops: 200n,
    actualFeeStroops: 150n,
    decisionCode: GAS_DECISION_CODES.reserved,
    lifecycle: GAS_LIFECYCLE_STATES.reserved,
    expiresAt: NOW + 900_000,
    retentionExpiresAt: NOW + 30 * 24 * 60 * 60 * 1000,
    createdAt: NOW,
    updatedAt: NOW + 1,
    ...overrides,
  };
}

function relayerAccountInput(projectId: Id<"projects">): RelayerAccountInput {
  return {
    projectId,
    publicKey: RELAYER_PUBLIC_KEY,
    network: GAS_NETWORK,
    status: GAS_RELAYER_STATUSES.active,
    balanceStroops: 9_000n,
    balanceUpdatedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW + 1,
  };
}

function executionAttemptInput(
  projectId: Id<"projects">,
  overrides: Partial<GasExecutionAttemptInput> = {},
): GasExecutionAttemptInput {
  return {
    projectId,
    network: GAS_NETWORK,
    requestId: "gas-request-1",
    idempotencyKeyHash: "idempotency-hash",
    requestFingerprint: "request-fingerprint",
    innerTransactionHash: TRANSACTION_HASH,
    sourceWallet: SOURCE_WALLET,
    targetContractIds: [CONTRACT_ID],
    innerMaxFeeStroops: 100n,
    originalReservationStroops: 200n,
    reservationCreatedAt: NOW,
    reservationExpiresAt: NOW + 900_000,
    accountingDayKey: "2026-09-03",
    lifecycle: GAS_LIFECYCLE_STATES.claimed,
    approvedHoldStroops: 300n,
    feeCeilingStroops: 300n,
    relayerPublicKey: RELAYER_PUBLIC_KEY,
    leaseGeneration: 1,
    sendCount: 0,
    nextCheckAt: NOW,
    reconciliationRequired: false,
    createdAt: NOW,
    updatedAt: NOW + 1,
    ...overrides,
  };
}

test("all four composed Gas tables accept valid records", async () => {
  const t = convexTest(schema, modules);
  const projectId = await createProject(t);

  const stored = await t.run(async (ctx) => {
    const policyId = await ctx.db.insert("gasPolicies", policyInput(projectId));
    const logId = await ctx.db.insert("gasLogs", logInput(projectId));
    const relayerId = await ctx.db.insert("relayerAccounts", relayerAccountInput(projectId));
    const executionAttemptId = await ctx.db.insert(
      "gasExecutionAttempts",
      executionAttemptInput(projectId),
    );

    return {
      policy: await ctx.db.get("gasPolicies", policyId),
      log: await ctx.db.get("gasLogs", logId),
      relayer: await ctx.db.get("relayerAccounts", relayerId),
      executionAttempt: await ctx.db.get("gasExecutionAttempts", executionAttemptId),
    };
  });

  expect(stored.policy).not.toBeNull();
  expect(stored.log).not.toBeNull();
  expect(stored.relayer).not.toBeNull();
  expect(stored.executionAttempt).not.toBeNull();
});

test("safe projections have exact allowlisted shapes and decimal-string amounts", async () => {
  const t = convexTest(schema, modules);
  const projectId = await createProject(t);
  const stored = await t.run(async (ctx) => {
    const policyId = await ctx.db.insert("gasPolicies", policyInput(projectId));
    const logId = await ctx.db.insert("gasLogs", logInput(projectId));
    const relayerId = await ctx.db.insert("relayerAccounts", relayerAccountInput(projectId));
    return {
      policy: await ctx.db.get("gasPolicies", policyId),
      log: await ctx.db.get("gasLogs", logId),
      relayer: await ctx.db.get("relayerAccounts", relayerId),
    };
  });

  if (!stored.policy || !stored.log || !stored.relayer) {
    throw new Error("Gas records were not stored");
  }

  expect(projectGasPolicy(stored.policy)).toEqual({
    enabled: true,
    network: "testnet",
    dailyCapStroops: "1000",
    dailyReservedStroops: "250",
    dailyWindowKey: "2026-09-03",
    walletHourlyLimit: 12,
    allowedContractIds: [CONTRACT_ID],
    createdAt: NOW,
    updatedAt: NOW + 1,
  });
  expect(projectGasLog(stored.log)).toEqual({
    requestId: "gas-request-1",
    transactionHash: TRANSACTION_HASH,
    sourceWallet: SOURCE_WALLET,
    targetContractIds: [CONTRACT_ID],
    innerMaxFeeStroops: "100",
    reservedStroops: "200",
    actualFeeStroops: "150",
    decisionCode: "reserved",
    rejectionCode: null,
    lifecycle: "reserved",
    expiresAt: NOW + 900_000,
    createdAt: NOW,
    updatedAt: NOW + 1,
  });
  expect(projectRelayerAccount(stored.relayer)).toEqual({
    publicKey: RELAYER_PUBLIC_KEY,
    network: "testnet",
    status: "active",
    balanceStroops: "9000",
    balanceUpdatedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW + 1,
  });
});

test("malicious extra input fields never enter any projection", async () => {
  const t = convexTest(schema, modules);
  const projectId = await createProject(t);
  const stored = await t.run(async (ctx) => {
    const policyId = await ctx.db.insert("gasPolicies", policyInput(projectId));
    const logId = await ctx.db.insert("gasLogs", logInput(projectId));
    const relayerId = await ctx.db.insert("relayerAccounts", relayerAccountInput(projectId));
    return {
      policy: await ctx.db.get("gasPolicies", policyId),
      log: await ctx.db.get("gasLogs", logId),
      relayer: await ctx.db.get("relayerAccounts", relayerId),
    };
  });

  if (!stored.policy || !stored.log || !stored.relayer) {
    throw new Error("Gas records were not stored");
  }

  const maliciousPolicy = Object.assign({}, stored.policy, {
    secretKey: "S3CRET",
    rawXdr: "AAAA...=",
    projectId: "project-injected-by-attacker",
  });
  const maliciousLog = Object.assign({}, stored.log, {
    apiCredential: "bearer secret",
    signature: "signature-material",
    rawXdr: "AAAA...=",
    idempotencyKeyHash: "should-not-leak",
    requestFingerprint: "should-not-leak",
    approvedHoldStroops: 300n,
    feeCeilingStroops: 300n,
    relayerPublicKey: RELAYER_PUBLIC_KEY,
    outerTransactionHash: "b".repeat(64),
    leaseToken: "lease-token",
  });
  const maliciousRelayer = Object.assign({}, stored.relayer, {
    secretKey: "S3CRET",
    seedPhrase: "never-store-this",
    credentialReference: "kms-key",
  });

  expect(projectGasPolicy(maliciousPolicy)).toEqual(projectGasPolicy(stored.policy));
  expect(projectGasLog(maliciousLog)).toEqual(projectGasLog(stored.log));
  expect(projectRelayerAccount(maliciousRelayer)).toEqual(projectRelayerAccount(stored.relayer));
});

test("Gas logs accept every D1 and D2 lifecycle without changing decision codes", async () => {
  const t = convexTest(schema, modules);
  const projectId = await createProject(t);
  const lifecycles = Object.values(GAS_LIFECYCLE_STATES);

  await t.run(async (ctx) => {
    for (const [index, lifecycle] of lifecycles.entries()) {
      await ctx.db.insert(
        "gasLogs",
        logInput(projectId, {
          requestId: `lifecycle-${index}`,
          lifecycle,
        }),
      );
    }
  });

  const storedLifecycles = await t.run(async (ctx) =>
    (
      await ctx.db
        .query("gasLogs")
        .withIndex("by_project_id_and_request_id", (q) => q.eq("projectId", projectId))
        .take(lifecycles.length)
    ).map((log) => log.lifecycle),
  );
  expect(storedLifecycles).toEqual(expect.arrayContaining(lifecycles));
  expect(storedLifecycles).toHaveLength(lifecycles.length);
});

test("representative claimed, exposed, and settled attempts are durable", async () => {
  const t = convexTest(schema, modules);
  const projectId = await createProject(t);

  await t.run(async (ctx) => {
    await ctx.db.insert(
      "gasExecutionAttempts",
      executionAttemptInput(projectId, { requestId: "claimed", lifecycle: "claimed" }),
    );
    await ctx.db.insert(
      "gasExecutionAttempts",
      executionAttemptInput(projectId, {
        requestId: "exposed",
        lifecycle: GAS_LIFECYCLE_STATES.submissionUnknown,
        outerTransactionHash: "b".repeat(64),
        sendCount: 1,
        firstPossibleSendAt: NOW,
        reconciliationDeadlineAt: NOW + 24 * 60 * 60 * 1_000,
      }),
    );
    await ctx.db.insert(
      "gasExecutionAttempts",
      executionAttemptInput(projectId, {
        requestId: "settled",
        lifecycle: GAS_LIFECYCLE_STATES.succeeded,
        outerTransactionHash: "c".repeat(64),
        sendCount: 1,
        firstPossibleSendAt: NOW,
        actualFeeStroops: 275n,
        settledAt: NOW + 2_000,
      }),
    );
  });

  const attempts = await t.run(async (ctx) =>
    ctx.db
      .query("gasExecutionAttempts")
      .withIndex("by_project_id_and_request_id", (q) => q.eq("projectId", projectId))
      .take(3),
  );
  expect(attempts.map((attempt) => [attempt.requestId, attempt.lifecycle])).toEqual([
    ["claimed", "claimed"],
    ["exposed", "submission_unknown"],
    ["settled", "succeeded"],
  ]);
  expect(attempts.find((attempt) => attempt.requestId === "exposed")).toMatchObject({
    approvedHoldStroops: 300n,
    feeCeilingStroops: 300n,
    outerTransactionHash: "b".repeat(64),
    reconciliationRequired: false,
  });
  expect(attempts.find((attempt) => attempt.requestId === "settled")).toMatchObject({
    actualFeeStroops: 275n,
    settledAt: NOW + 2_000,
  });
});

test("schema rejects non-Testnet records and invalid enum values", async () => {
  const t = convexTest(schema, modules);
  const projectId = await createProject(t);

  await expect(
    t.run(async (ctx) => {
      const record = policyInput(projectId);
      Reflect.set(record, "network", "mainnet");
      return await ctx.db.insert("gasPolicies", record);
    }),
  ).rejects.toThrow();

  await expect(
    t.run(async (ctx) => {
      const record = relayerAccountInput(projectId);
      Reflect.set(record, "network", "unknown");
      return await ctx.db.insert("relayerAccounts", record);
    }),
  ).rejects.toThrow();

  await expect(
    t.run(async (ctx) => {
      const record = executionAttemptInput(projectId);
      Reflect.set(record, "network", "mainnet");
      return await ctx.db.insert("gasExecutionAttempts", record);
    }),
  ).rejects.toThrow();

  for (const [field, value] of [
    ["decisionCode", "accepted"],
    ["rejectionCode", "secret_leak"],
    ["lifecycle", "not_a_lifecycle"],
  ] as const) {
    await expect(
      t.run(async (ctx) => {
        const record = logInput(projectId);
        Reflect.set(record, field, value);
        return await ctx.db.insert("gasLogs", record);
      }),
    ).rejects.toThrow();
  }

  await expect(
    t.run(async (ctx) => {
      const record = executionAttemptInput(projectId);
      Reflect.set(record, "lifecycle", "accepted");
      return await ctx.db.insert("gasExecutionAttempts", record);
    }),
  ).rejects.toThrow();

  await expect(
    t.run(async (ctx) => {
      const record = relayerAccountInput(projectId);
      Reflect.set(record, "status", "signing");
      return await ctx.db.insert("relayerAccounts", record);
    }),
  ).rejects.toThrow();
});

test("Convex int64 serialization rejects overflow for every Gas table amount field", async () => {
  const t = convexTest(schema, modules);
  const projectId = await createProject(t);
  const overflow = GAS_MAX_STROOPS + 1n;

  const overflowingPolicy = policyInput(projectId);
  Reflect.set(overflowingPolicy, "dailyCapStroops", overflow);
  const overflowingLog = logInput(projectId);
  Reflect.set(overflowingLog, "innerMaxFeeStroops", overflow);
  const overflowingRelayer = relayerAccountInput(projectId);
  Reflect.set(overflowingRelayer, "balanceStroops", overflow);
  const overflowingAttempt = executionAttemptInput(projectId);

  expect(() => convexToJson(overflowingPolicy)).toThrow(/64-bit/);
  expect(() => convexToJson(overflowingLog)).toThrow(/64-bit/);
  expect(() => convexToJson(overflowingRelayer)).toThrow(/64-bit/);
  for (const field of [
    "innerMaxFeeStroops",
    "originalReservationStroops",
    "approvedHoldStroops",
    "feeCeilingStroops",
    "actualFeeStroops",
  ]) {
    Reflect.set(overflowingAttempt, field, overflow);
    expect(() => convexToJson(overflowingAttempt)).toThrow(/64-bit/);
  }
});

test("schema rejects undeclared secret and raw-XDR fields", async () => {
  const t = convexTest(schema, modules);
  const projectId = await createProject(t);

  await expect(
    t.run(async (ctx) => {
      const record = policyInput(projectId);
      Reflect.set(record, "signingSecret", "S3CRET");
      Reflect.set(record, "rawXdr", "AAAA...=");
      return await ctx.db.insert("gasPolicies", record);
    }),
  ).rejects.toThrow();

  await expect(
    t.run(async (ctx) => {
      const record = logInput(projectId);
      Reflect.set(record, "privateKey", "S3CRET");
      Reflect.set(record, "transactionXdr", "AAAA...=");
      return await ctx.db.insert("gasLogs", record);
    }),
  ).rejects.toThrow();

  await expect(
    t.run(async (ctx) => {
      const record = relayerAccountInput(projectId);
      Reflect.set(record, "secretKey", "S3CRET");
      Reflect.set(record, "encryptedSeed", "encrypted");
      return await ctx.db.insert("relayerAccounts", record);
    }),
  ).rejects.toThrow();

  await expect(
    t.run(async (ctx) => {
      const record = executionAttemptInput(projectId);
      Reflect.set(record, "signingSecret", "S3CRET");
      Reflect.set(record, "rawXdr", "AAAA...=");
      return await ctx.db.insert("gasExecutionAttempts", record);
    }),
  ).rejects.toThrow();
});

test("execution identity helpers distinguish missing, unique, cross-project, and duplicate rows", async () => {
  const t = convexTest(schema, modules);
  const projectId = await createProject(t);
  const otherProjectId = await createProject(t);
  const base = executionAttemptInput(projectId);
  const other = executionAttemptInput(otherProjectId, {
    requestId: "other-request",
    idempotencyKeyHash: "other-idempotency-hash",
    innerTransactionHash: "d".repeat(64),
  });

  await t.run(async (ctx) => {
    await ctx.db.insert("gasExecutionAttempts", base);
    await ctx.db.insert("gasExecutionAttempts", other);
  });

  const uniqueAndMissing = await t.run(async (ctx) => ({
    request: await findExecutionAttemptByRequestId(ctx, projectId, base.requestId),
    idempotency: await findExecutionAttemptByIdempotencyKeyHash(
      ctx,
      projectId,
      base.idempotencyKeyHash,
    ),
    inner: await findExecutionAttemptByInnerTransactionHash(
      ctx,
      projectId,
      base.innerTransactionHash,
    ),
    missing: await findExecutionAttemptByRequestId(ctx, projectId, "missing-request"),
    crossProject: await findExecutionAttemptByRequestId(ctx, projectId, other.requestId),
    otherProject: await findExecutionAttemptByRequestId(ctx, otherProjectId, other.requestId),
  }));

  expect(uniqueAndMissing.request).toMatchObject({ requestId: base.requestId });
  expect(uniqueAndMissing.idempotency).toMatchObject({
    idempotencyKeyHash: base.idempotencyKeyHash,
  });
  expect(uniqueAndMissing.inner).toMatchObject({ innerTransactionHash: base.innerTransactionHash });
  expect(uniqueAndMissing.missing).toBeNull();
  expect(uniqueAndMissing.crossProject).toBeNull();
  expect(uniqueAndMissing.otherProject).toMatchObject({ projectId: otherProjectId });

  await t.run(async (ctx) => {
    await ctx.db.insert("gasExecutionAttempts", base);
  });

  const duplicateResults = await t.run(async (ctx) => ({
    request: await findExecutionAttemptByRequestId(ctx, projectId, base.requestId),
    idempotency: await findExecutionAttemptByIdempotencyKeyHash(
      ctx,
      projectId,
      base.idempotencyKeyHash,
    ),
    inner: await findExecutionAttemptByInnerTransactionHash(
      ctx,
      projectId,
      base.innerTransactionHash,
    ),
  }));
  expect(duplicateResults).toEqual({
    request: "ambiguous",
    idempotency: "ambiguous",
    inner: "ambiguous",
  });
});

test("execution facts remain available after the D1 audit row is deleted", async () => {
  const t = convexTest(schema, modules);
  const projectId = await createProject(t);
  const attempt = executionAttemptInput(projectId, {
    lifecycle: GAS_LIFECYCLE_STATES.submissionUnknown,
    outerTransactionHash: "e".repeat(64),
    firstPossibleSendAt: NOW,
    reconciliationRequired: true,
  });
  const log = logInput(projectId, {
    requestId: attempt.requestId,
    idempotencyKeyHash: attempt.idempotencyKeyHash,
    requestFingerprint: attempt.requestFingerprint,
    transactionHash: attempt.innerTransactionHash,
  });

  await t.run(async (ctx) => {
    const logId = await ctx.db.insert("gasLogs", log);
    await ctx.db.insert("gasExecutionAttempts", attempt);
    await ctx.db.delete(logId);
  });

  const stored = await t.run(async (ctx) =>
    findExecutionAttemptByInnerTransactionHash(ctx, projectId, attempt.innerTransactionHash),
  );
  expect(stored).toMatchObject({
    requestId: attempt.requestId,
    outerTransactionHash: attempt.outerTransactionHash,
    reconciliationRequired: true,
  });
});
