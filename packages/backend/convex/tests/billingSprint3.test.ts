/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, test, vi } from "vitest";

import type { Id } from "../_generated/dataModel";

import { api } from "../_generated/api";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

const bootstrapOperator = makeFunctionReference<"mutation">("billing/operators:bootstrap");
const initializePolicy = makeFunctionReference<"mutation">("billing/admin:initializePolicy");
const recordApproval = makeFunctionReference<"mutation">("billing/launch:recordApproval");
const configureTreasury = makeFunctionReference<"mutation">("billing/launch:configureTreasury");
const getReadiness = makeFunctionReference<"query">("billing/launch:getReadiness");
const activatePlatform = makeFunctionReference<"mutation">("billing/launch:activatePlatform");
const configureCohort = makeFunctionReference<"mutation">("billing/cohort:configure");
const createCostPeriod = makeFunctionReference<"mutation">("billing/finance:createCostPeriod");
const approveCostPeriod = makeFunctionReference<"mutation">("billing/finance:approveCostPeriod");
const generateReport = makeFunctionReference<"mutation">("billing/finance:generateReport");
const backfillExceptions = makeFunctionReference<"mutation">(
  "billing/exceptions:backfillOperationalFields",
);
const assignException = makeFunctionReference<"mutation">("billing/exceptions:assign");
const createOffer = makeFunctionReference<"mutation">("billing/offers:create");
const updatePolicy = makeFunctionReference<"mutation">("billing/mutations:updatePolicy");
const verifyOrganization = makeFunctionReference<"mutation">("organizations/mutations:verify");
const grantPromotion = makeFunctionReference<"mutation">("billing/mutations:grantPromotion");
const runDailyReplay = makeFunctionReference<"mutation">("billing/reconciliation:runDailyReplay");
const retryMirrorVerification = makeFunctionReference<"mutation">(
  "billing/mirror:retryVerification",
);

function asWallet(t: ReturnType<typeof convexTest>, address: string) {
  return t.withIdentity({
    subject: address,
    issuer: "http://localhost:3000",
    tokenIdentifier: `http://localhost:3000|${address}`,
  });
}

async function setupOperator(t: ReturnType<typeof convexTest>) {
  await t.mutation(bootstrapOperator, { walletAddress: "GOPERATOR", actor: "test-bootstrap" });
  const operator = asWallet(t, "GOPERATOR");
  await operator.mutation(initializePolicy, {});
  return operator;
}

test("Mainnet launch remains disabled until every append-only approval and treasury control exists", async () => {
  const t = convexTest(schema, modules);
  const operator = await setupOperator(t);

  await expect(operator.mutation(activatePlatform, { action: "arm_mainnet" })).rejects.toThrow(
    /not ready/i,
  );

  const treasuryId = (await operator.mutation(configureTreasury, {
    network: "public",
    address: "GTREASURY",
    asset: "USDC:GISSUER",
    verificationEvidenceReference: "evidence://verification",
    signerPolicyReference: "policy://signer",
    withdrawalPolicyReference: "policy://withdrawal",
    monitoringOwner: "security",
    reconciliationOwner: "finance",
    incidentProcedureReference: "runbook://treasury",
    active: true,
  })) as Id<"billingTreasuries">;

  await expect(
    operator.mutation(createOffer, {
      sku: "invalid-mainnet",
      creditQuantity: 100n,
      priceAmount: "20",
      asset: "USDC:GISSUER",
      network: "public",
      treasuryAddress: "GTREASURY",
      activeFrom: Date.now() - 1,
      refundPolicy: "Approved refund policy",
      activate: false,
    }),
  ).rejects.toThrow(/production treasury/i);

  await operator.mutation(createOffer, {
    sku: "credits-100",
    creditQuantity: 100n,
    priceAmount: "20",
    asset: "USDC:GISSUER",
    network: "public",
    treasuryAddress: "GTREASURY",
    treasuryId,
    activeFrom: Date.now() - 1,
    refundPolicy: "Approved refund policy",
    activate: true,
  });

  for (const area of [
    "product",
    "finance",
    "legal",
    "tax",
    "compliance",
    "security",
    "operations",
  ] as const) {
    await operator.mutation(recordApproval, {
      area,
      status: "approved",
      evidenceReference: `evidence://${area}`,
      notes: `${area} approved`,
      policyDigest: "sha256:launch-v1",
    });
  }

  const readiness = await operator.query(getReadiness, { now: Date.now() });
  expect(readiness.approvalsReady).toBe(true);
  expect(readiness.treasury?._id).toBe(treasuryId);
  expect(readiness.ready).toBe(false);
  expect(readiness.blockers).toContain("Deployment environment is not production");

  await operator.mutation(recordApproval, {
    area: "security",
    status: "revoked",
    evidenceReference: "evidence://security-revoked",
    notes: "Key rotation required",
    policyDigest: "sha256:launch-v1",
  });
  const revoked = await operator.query(getReadiness, { now: Date.now() });
  expect(revoked.approvalsReady).toBe(false);
});

test("cohort enforcement requires verification, notices, and an explicit grace deadline", async () => {
  const t = convexTest(schema, modules);
  const operator = await setupOperator(t);
  const owner = asWallet(t, "GOWNER");
  await owner.mutation(api.projects.mutation.createDraft, {
    name: "Cohort",
    slug: "cohort",
    description: "Cohort",
    metadataJson: "{}",
    metadataHash: "0".repeat(64),
    ownerAddress: "GOWNER",
  });
  const organization = await t.run(async (ctx) => ctx.db.query("organizations").unique());
  expect(organization).not.toBeNull();

  await expect(
    operator.mutation(configureCohort, {
      organizationId: organization!._id,
      cohortStage: "design_partner",
      enforcementEnabled: true,
      graceUntil: Date.now() + 86_400_000,
      payAccessMirrorEnabled: false,
    }),
  ).rejects.toThrow(/verified/i);
});

test("approved period costs produce an immutable zero-revenue report with null margins", async () => {
  const t = convexTest(schema, modules);
  const operator = await setupOperator(t);
  const periodId = (await operator.mutation(createCostPeriod, {
    periodStart: Date.UTC(2026, 6, 1),
    periodEnd: Date.UTC(2026, 7, 1),
    infrastructureCostUsd: "10.50",
    fullyLoadedCostUsd: "25.00",
    evidenceReference: "finance://july-costs",
  })) as Id<"billingCostPeriods">;
  await operator.mutation(approveCostPeriod, { periodId, note: "Approved close inputs" });
  const reportId = (await operator.mutation(generateReport, {
    periodId,
  })) as Id<"billingFinanceReports">;
  const report = await t.run(async (ctx) => ctx.db.get(reportId));

  expect(report).toMatchObject({
    cashCollectedUsd: "0",
    recognizedRevenueUsd: "0",
    infrastructureCostUsd: "10.5",
    fullyLoadedCostUsd: "25",
  });
  expect(report?.infrastructureMarginBps).toBeUndefined();
  expect(report?.fullyLoadedMarginBps).toBeUndefined();
});

test("legacy exceptions receive severity and SLA before assignment", async () => {
  const t = convexTest(schema, modules);
  const operator = await setupOperator(t);
  const createdAt = Date.now() - 1_000;
  const exceptionId = await t.run(async (ctx) =>
    ctx.db.insert("billingExceptions", {
      exceptionType: "ledger_mismatch",
      status: "open",
      dedupeKey: "legacy:sprint-2",
      summary: "Legacy mismatch",
      evidenceJson: "{}",
      createdAt,
      updatedAt: createdAt,
    }),
  );

  await operator.mutation(backfillExceptions, { limit: 10 });
  await operator.mutation(assignException, {
    exceptionId,
    assignee: "GOPERATOR",
    note: "Finance owns investigation",
  });
  const exception = await t.run(async (ctx) => ctx.db.get(exceptionId));
  expect(exception?.severity).toBe("medium");
  expect(exception?.slaDueAt).toBe(createdAt + 24 * 60 * 60_000);
  expect(exception?.assignee).toBe("GOPERATOR");
  expect(exception?.investigationStatus).toBe("investigating");
});

test("commercial balance changes coalesce into display-only PayAccess mirror state", async () => {
  const t = convexTest(schema, modules);
  await setupOperator(t);
  const owner = asWallet(t, "GMIRROROWNER");
  const projectId = await owner.mutation(api.projects.mutation.createDraft, {
    name: "Mirror",
    slug: "mirror",
    description: "Mirror",
    metadataJson: "{}",
    metadataHash: "1".repeat(64),
    ownerAddress: "GMIRROROWNER",
  });
  const organization = await t.run(async (ctx) => ctx.db.query("organizations").unique());
  await t.run(async (ctx) => {
    await ctx.db.patch(projectId, { registryProjectId: 42 });
    await ctx.db.insert("organizationBillingSettings", {
      organizationId: organization!._id,
      enforcementEnabled: false,
      shadowEnabled: false,
      sandboxEnforcementEnabled: false,
      payAccessMirrorEnabled: true,
      updatedBy: "test",
      updatedAt: Date.now(),
    });
  });
  await t.mutation(updatePolicy, {
    billingLedgerWrite: true,
    billingShadowMode: false,
    mainnetCreditEnforcement: false,
    billingTopupsEnabled: false,
    promoGrantEnabled: true,
    pdaxBillingEnabled: false,
    billingKillSwitch: true,
    actor: "test",
  });
  await t.mutation(verifyOrganization, {
    organizationId: organization!._id,
    evidenceType: "manual_review",
    evidenceReference: "test",
    actor: "test",
    reason: "Mirror test",
  });
  await t.mutation(grantPromotion, {
    organizationId: organization!._id,
    book: "commercial",
    idempotencyKey: "mirror-promo",
    actor: "test",
  });

  const mirror = await t.run(async (ctx) => ctx.db.query("payAccessMirrorStates").unique());
  expect(mirror).toMatchObject({
    projectId,
    registryProjectId: 42,
    desiredCredits: 100n,
    desiredVersion: 1,
    status: "pending",
  });
  const attemptId = await t.run(async (ctx) =>
    ctx.db.insert("payAccessMirrorAttempts", {
      mirrorStateId: mirror!._id,
      projectId,
      desiredCredits: 100n,
      desiredVersion: 1,
      transactionHash: "a".repeat(64),
      status: "submitted",
      submittedBy: "GOPERATOR",
      submittedAt: Date.now(),
      verificationAttempts: 4,
    }),
  );
  await t.mutation(retryMirrorVerification, {
    attemptId,
    error: "Finality unavailable",
  });
  const failedAttempt = await t.run(async (ctx) => ctx.db.get(attemptId));
  expect(failedAttempt?.status).toBe("failed");
  expect(
    await t.run(async (ctx) =>
      ctx.db
        .query("billingExceptions")
        .withIndex("by_organization_id_and_created_at", (q) =>
          q.eq("organizationId", organization!._id),
        )
        .unique(),
    ),
  ).toMatchObject({ severity: "high", assignee: "billing-operations" });
});

test("daily replay detects a corrupted materialized balance without repairing it", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  const organizationId = await t.run(async (ctx) =>
    ctx.db.insert("organizations", {
      ownerTokenIdentifier: "issuer|replay",
      ownerAddress: "GREPLAY",
      displayName: "Replay",
      verificationStatus: "verified",
      trialState: "eligible",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
  const balanceId = await t.run(async (ctx) =>
    ctx.db.insert("billingBalances", {
      organizationId,
      book: "commercial",
      promoAvailable: 11n,
      promoReserved: 0n,
      promoConsumed: 0n,
      promoExpired: 0n,
      paidAvailable: 0n,
      paidReserved: 0n,
      paidConsumed: 0n,
      paidExpired: 0n,
      version: 1,
      updatedAt: Date.now(),
    }),
  );
  await t.run(async (ctx) => {
    await ctx.db.insert("billingLedgerEntries", {
      organizationId,
      book: "commercial",
      creditClass: "promotional",
      entryType: "promo_grant",
      amount: 10n,
      idempotencyKey: "replay-grant",
      actor: "test",
      reason: "test",
      environment: "development",
      network: "testnet",
      calculationVersion: 1,
      occurredAt: Date.now(),
    });
  });
  const runId = await t.run(async (ctx) =>
    ctx.db.insert("billingReplayRuns", {
      runDate: "manual-corruption-test",
      status: "running",
      processedBalances: 0,
      discrepancies: 0,
      digest: "fnv1a32:811c9dc5",
      startedAt: Date.now(),
    }),
  );
  const result = await t.mutation(runDailyReplay, { runId, limit: 25 });
  expect(result.status).toBe("running");
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  const replay = await t.run(async (ctx) => ctx.db.get(runId));
  expect(replay?.status).toBe("failed");
  const balance = await t.run(async (ctx) => ctx.db.get(balanceId));
  expect(balance?.promoAvailable).toBe(11n);
  const exception = await t.run(async (ctx) =>
    ctx.db
      .query("billingExceptions")
      .withIndex("by_organization_id_and_created_at", (q) => q.eq("organizationId", organizationId))
      .unique(),
  );
  expect(exception?.severity).toBe("high");
  vi.useRealTimers();
});
