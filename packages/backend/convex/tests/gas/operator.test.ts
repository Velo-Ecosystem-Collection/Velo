/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { expect, test } from "vitest";

import type { DataModel, Id } from "../../_generated/dataModel";
import type { TestConvexForDataModelAndIdentity } from "convex-test";

import { internal } from "../../_generated/api";
import { GAS_NETWORK } from "../../gas/types";
import schema from "../../schema";

const modules = import.meta.glob("../../**/*.ts");
const OWNER = "GD7O2C226SF2677PFFUVD6O2ICFOBNCWPI5Z46N43ZSFQGLM65U3I2SP";
const RELAYER = "GAI7NKM2MASZ4OJH2LQNMXL4VEUVOWPVDNRVTB6XQRWYYRX3JD4KX4ZI";
const CONTRACT = "CC7RENKPGXGF6MMEMGJ4YWUBOBGQYOCGG33PNSONQF56UMMAQ22TWH6R";
const INNER_HASH = "a".repeat(64);
const OUTER_HASH = "b".repeat(64);
const IDEMPOTENCY_HASH = "c".repeat(64);
const REQUEST_ID = "d2-operator-test-request";
const NOW = Date.parse("2026-09-12T04:00:00.000Z");
type TestContext = TestConvexForDataModelAndIdentity<DataModel>;

async function createProject(t: TestContext): Promise<Id<"projects">> {
  return await t.run(
    async (ctx) =>
      await ctx.db.insert("projects", {
        name: "D2 Operator Reader Test",
        slug: "d2-operator-reader-test",
        description: "D2 operator reader test project",
        metadataJson: "{}",
        metadataHash: "0".repeat(64),
        ownerAddress: OWNER,
        ownerTokenIdentifier: `http://localhost:3000|${OWNER}`,
        status: "draft",
        createdAt: NOW,
        updatedAt: NOW,
      }),
  );
}

test("operator snapshot data is scoped and contains no custody material", async () => {
  const t = convexTest(schema, modules);
  const projectId = await createProject(t);

  await t.run(async (ctx) => {
    await ctx.db.insert("gasPolicies", {
      projectId,
      enabled: true,
      network: GAS_NETWORK,
      dailyCapStroops: 100_000n,
      dailyReservedStroops: 0n,
      dailyWindowKey: "2026-09-12",
      outstandingHoldsStroops: 0n,
      dailyConfirmedSpendStroops: 0n,
      accountingState: "initialized",
      walletHourlyLimit: 10,
      allowedContractIds: [CONTRACT],
      createdAt: NOW,
      updatedAt: NOW,
    });
    await ctx.db.insert("relayerAccounts", {
      projectId,
      publicKey: RELAYER,
      network: GAS_NETWORK,
      status: "active",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await ctx.db.insert("gasLogs", {
      projectId,
      requestId: REQUEST_ID,
      idempotencyKeyHash: IDEMPOTENCY_HASH,
      requestFingerprint: "f".repeat(64),
      transactionHash: INNER_HASH,
      sourceWallet: OWNER,
      targetContractIds: [CONTRACT],
      innerMaxFeeStroops: 100n,
      reservedStroops: 200n,
      decisionCode: "reserved",
      lifecycle: "succeeded",
      actualFeeStroops: 150n,
      retentionExpiresAt: NOW + 86_400_000,
      createdAt: NOW,
      updatedAt: NOW + 1,
    });
    await ctx.db.insert("gasExecutionAttempts", {
      projectId,
      network: GAS_NETWORK,
      requestId: REQUEST_ID,
      idempotencyKeyHash: IDEMPOTENCY_HASH,
      requestFingerprint: "f".repeat(64),
      innerTransactionHash: INNER_HASH,
      sourceWallet: OWNER,
      targetContractIds: [CONTRACT],
      innerMaxFeeStroops: 100n,
      originalReservationStroops: 200n,
      reservationCreatedAt: NOW,
      reservationExpiresAt: NOW + 900_000,
      accountingDayKey: "2026-09-12",
      lifecycle: "succeeded",
      approvedHoldStroops: 300n,
      feeCeilingStroops: 300n,
      relayerPublicKey: RELAYER,
      outerTransactionHash: OUTER_HASH,
      outerFeeStroops: 300n,
      leaseGeneration: 1,
      sendCount: 1,
      nextCheckAt: NOW,
      reconciliationRequired: false,
      actualFeeStroops: 150n,
      settledAt: NOW + 2,
      verifiedLedgerEvidence: {
        outerTransactionHash: OUTER_HASH,
        innerTransactionHash: INNER_HASH,
        feeSource: RELAYER,
        ledger: 123,
        resultCode: "txFeeBumpInnerSuccess",
        innerResultCode: "txSuccess",
        chargedStroops: 150n,
        observedAt: NOW + 2,
      },
      createdAt: NOW,
      updatedAt: NOW + 2,
    });
  });

  const snapshot = await t.query(internal.gas.operator.getOperatorSnapshotData, {
    projectId,
    phase: "after-settlement",
    requestId: REQUEST_ID,
    transactionHash: INNER_HASH,
    idempotencyKeyHash: IDEMPOTENCY_HASH,
  });

  expect(snapshot).toMatchObject({
    phase: "after-settlement",
    userPublicKey: OWNER,
    relayer: { publicKey: RELAYER, network: "testnet", status: "active" },
    policy: { enabled: true, network: "testnet", allowedContractIds: [CONTRACT] },
    accounting: {
      accountingDayKey: "2026-09-12",
      outstandingHoldsStroops: "0",
      dailyConfirmedSpendStroops: "0",
    },
    reservedExposureStroops: "0",
    execution: {
      requestId: REQUEST_ID,
      innerTransactionHash: INNER_HASH,
      outerTransactionHash: OUTER_HASH,
      status: "succeeded",
      sendCount: 1,
      reservedStroops: "300",
      actualFeeStroops: "150",
      reconciliationRequired: false,
      feeSource: RELAYER,
      ledgerEvidence: {
        outerTransactionHash: OUTER_HASH,
        innerTransactionHash: INNER_HASH,
        feeSource: RELAYER,
        ledger: 123,
        resultCode: "txFeeBumpInnerSuccess",
        innerResultCode: "txSuccess",
        chargedStroops: "150",
      },
    },
  });
  expect(JSON.stringify(snapshot)).not.toContain("secretKey");
});
