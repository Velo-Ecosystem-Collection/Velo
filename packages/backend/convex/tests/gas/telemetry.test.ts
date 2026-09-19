/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { expect, test } from "vitest";

import type { DataModel, Doc, Id } from "../../_generated/dataModel";
import type { TestConvexForDataModelAndIdentity } from "convex-test";

import { api } from "../../_generated/api";
import { GAS_MAX_STROOPS, GAS_NETWORK } from "../../gas/types";
import schema from "../../schema";

const modules = import.meta.glob("../../**/*.ts");
type TestContext = TestConvexForDataModelAndIdentity<DataModel>;

const OWNER = "GD7O2C226SF2677PFFUVD6O2ICFOBNCWPI5Z46N43ZSFQGLM65U3I2SP";
const EDITOR = "GBNHK3TLWWXBCEGNFHB45Z66R4AI5YUALKUFBP4WF7YK5JLZIAAG2DLI";
const VIEWER = "GDFWQCS3C72IWT5QV6CJYCMCQZ4WQ2QELSE6ABWI5Q3XRZ6BPGRS6LZV";
const OUTSIDER = "GCZCSOTTJVGJNVXKUUEPGZRWWEB4HOFCQLMZJX6VIP4C4ZURI4HVOIMA";
const CONTRACT_ID = "CC7RENKPGXGF6MMEMGJ4YWUBOBGQYOCGG33PNSONQF56UMMAQ22TWH6R";
const RELAYER_PUBLIC_KEY = "GAI7NKM2MASZ4OJH2LQNMXL4VEUVOWPVDNRVTB6XQRWYYRX3JD4KX4ZI";
const INNER_HASH = "a".repeat(64);
const OUTER_HASH = "b".repeat(64);
const NOW = Date.parse("2026-09-15T12:00:00.000Z");
let projectCounter = 0;

function asWallet(t: TestContext, address: string) {
  return t.withIdentity({
    subject: address,
    issuer: "http://localhost:3000",
    tokenIdentifier: `http://localhost:3000|${address}`,
  });
}

async function createProject(t: TestContext, ownerAddress = OWNER): Promise<Id<"projects">> {
  const suffix = `${ownerAddress.slice(1, 7)}-${projectCounter++}`;
  return await t.run(async (ctx) =>
    ctx.db.insert("projects", {
      name: `Gas telemetry ${suffix}`,
      slug: `gas-telemetry-${suffix.toLowerCase()}`,
      description: "Gas telemetry query test project",
      metadataJson: "{}",
      metadataHash: "0".repeat(64),
      ownerAddress,
      ownerTokenIdentifier: `http://localhost:3000|${ownerAddress}`,
      status: "draft",
      createdAt: NOW,
      updatedAt: NOW,
    }),
  );
}

async function addMembership(
  t: TestContext,
  projectId: Id<"projects">,
  walletAddress: string,
  role: "editor" | "viewer",
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("projectMemberships", {
      projectId,
      walletAddress,
      role,
      addedBy: OWNER,
      createdAt: NOW,
      updatedAt: NOW,
    });
  });
}

type PolicyOverrides = Partial<Doc<"gasPolicies">>;

async function addPolicy(
  t: TestContext,
  projectId: Id<"projects">,
  overrides: PolicyOverrides = {},
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("gasPolicies", {
      projectId,
      enabled: true,
      network: GAS_NETWORK,
      dailyCapStroops: 1_000n,
      dailyReservedStroops: 150n,
      dailyWindowKey: "2026-09-15",
      outstandingHoldsStroops: 50n,
      dailyConfirmedSpendStroops: 100n,
      accountingState: "initialized",
      walletHourlyLimit: 10,
      allowedContractIds: [CONTRACT_ID],
      createdAt: NOW,
      updatedAt: NOW + 1,
      ...overrides,
    }),
  );
}

async function addDaily(
  t: TestContext,
  projectId: Id<"projects">,
  accountingDayKey: string,
  confirmedSpendStroops: bigint,
  overrides: Partial<Doc<"gasDailyAccounting">> = {},
): Promise<Id<"gasDailyAccounting">> {
  const timestamp = Date.parse(`${accountingDayKey}T12:00:00.000Z`);
  return await t.run(async (ctx) => {
    return await ctx.db.insert("gasDailyAccounting", {
      projectId,
      accountingDayKey,
      confirmedSpendStroops,
      createdAt: timestamp,
      updatedAt: timestamp + 1,
      ...overrides,
    });
  });
}

type AttemptOverrides = Partial<Doc<"gasExecutionAttempts">>;

async function addAttempt(
  t: TestContext,
  projectId: Id<"projects">,
  requestId: string,
  overrides: AttemptOverrides = {},
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("gasExecutionAttempts", {
      projectId,
      network: GAS_NETWORK,
      requestId,
      idempotencyKeyHash: "c".repeat(64),
      requestFingerprint: "d".repeat(64),
      innerTransactionHash: INNER_HASH,
      sourceWallet: OWNER,
      targetContractIds: [CONTRACT_ID],
      innerMaxFeeStroops: 100n,
      originalReservationStroops: 200n,
      reservationCreatedAt: NOW,
      reservationExpiresAt: NOW + 900_000,
      accountingDayKey: "2026-09-15",
      lifecycle: "claimed",
      approvedHoldStroops: 200n,
      feeCeilingStroops: 200n,
      relayerPublicKey: RELAYER_PUBLIC_KEY,
      leaseGeneration: 1,
      sendCount: 0,
      nextCheckAt: NOW,
      reconciliationRequired: false,
      createdAt: NOW,
      updatedAt: NOW + 1,
      ...overrides,
    }),
  );
}

async function addAuditLog(t: TestContext, projectId: Id<"projects">, requestId: string) {
  return await t.run(async (ctx) =>
    ctx.db.insert("gasLogs", {
      projectId,
      requestId,
      idempotencyKeyHash: "e".repeat(64),
      requestFingerprint: "f".repeat(64),
      transactionHash: INNER_HASH,
      sourceWallet: OWNER,
      targetContractIds: [CONTRACT_ID],
      innerMaxFeeStroops: 100n,
      reservedStroops: 200n,
      actualFeeStroops: 187n,
      decisionCode: "reserved",
      lifecycle: "succeeded",
      expiresAt: NOW + 900_000,
      retentionExpiresAt: NOW + 30 * 24 * 60 * 60 * 1000,
      createdAt: NOW,
      updatedAt: NOW + 1,
    }),
  );
}

async function readState(t: TestContext, projectId: Id<"projects">) {
  return await t.run(async (ctx) => ({
    policy: await ctx.db
      .query("gasPolicies")
      .withIndex("by_project_id", (q) => q.eq("projectId", projectId))
      .collect(),
    daily: await ctx.db
      .query("gasDailyAccounting")
      .withIndex("by_project_id_and_accounting_day_key", (q) => q.eq("projectId", projectId))
      .collect(),
  }));
}

test("telemetry is viewer-scoped, isolated, exact, seven-day, and read-only", async () => {
  const t = convexTest(schema, modules);
  const projectId = await createProject(t);
  const otherProjectId = await createProject(t, OUTSIDER);
  await addMembership(t, projectId, EDITOR, "editor");
  await addMembership(t, projectId, VIEWER, "viewer");
  await addPolicy(t, projectId, {
    dailyCapStroops: GAS_MAX_STROOPS,
    dailyReservedStroops: 9_007_199_254_740_993n,
    outstandingHoldsStroops: 2n,
    dailyConfirmedSpendStroops: 9_007_199_254_740_991n,
  });
  await addDaily(t, projectId, "2026-09-12", 0n);
  await addDaily(t, projectId, "2026-09-14", 7n);
  await addPolicy(t, otherProjectId);
  const before = await readState(t, projectId);

  const result = await asWallet(t, VIEWER).query(api.gas.queries.getTelemetry, {
    projectId,
    utcDayKey: "2026-09-15",
  });

  expect(result).toMatchObject({
    reportingDayKey: "2026-09-15",
    confirmedFeeStroops: "9007199254740991",
    outstandingHoldsStroops: "2",
    effectiveUsageStroops: "9007199254740993",
    policyCapStroops: GAS_MAX_STROOPS.toString(),
    availability: "available",
    reasonCode: null,
  });
  expect(result.history).toHaveLength(7);
  expect(result.history.map((entry) => entry.reportingDayKey)).toEqual([
    "2026-09-09",
    "2026-09-10",
    "2026-09-11",
    "2026-09-12",
    "2026-09-13",
    "2026-09-14",
    "2026-09-15",
  ]);
  expect(result.history[3]).toMatchObject({ confirmedFeeStroops: "0" });
  expect(result.history[5]).toMatchObject({ confirmedFeeStroops: "7" });
  expect(result.history[0]).toMatchObject({ confirmedFeeStroops: null });
  expect(result.historyCompleteness).toBe("partial");
  expect(
    await asWallet(t, OWNER).query(api.gas.queries.getTelemetry, {
      projectId,
      utcDayKey: "2026-09-15",
    }),
  ).toMatchObject({ availability: "available" });
  expect(
    await asWallet(t, EDITOR).query(api.gas.queries.getTelemetry, {
      projectId,
      utcDayKey: "2026-09-15",
    }),
  ).toMatchObject({ availability: "available" });
  expect(await readState(t, projectId)).toEqual(before);

  await expect(
    t.query(api.gas.queries.getTelemetry, { projectId, utcDayKey: "2026-09-15" }),
  ).rejects.toThrow("Not authenticated");
  await expect(
    asWallet(t, OUTSIDER).query(api.gas.queries.getTelemetry, {
      projectId,
      utcDayKey: "2026-09-15",
    }),
  ).rejects.toThrow("Unauthorized");
  await expect(
    asWallet(t, VIEWER).query(api.gas.queries.getTelemetry, {
      projectId: otherProjectId,
      utcDayKey: "2026-09-15",
    }),
  ).rejects.toThrow("Unauthorized");
});

test("telemetry carries holds through UTC rollover and keeps late settlement on its pinned day", async () => {
  const t = convexTest(schema, modules);
  const projectId = await createProject(t);
  await addPolicy(t, projectId, {
    dailyWindowKey: "2026-09-15",
    dailyReservedStroops: 50n,
    outstandingHoldsStroops: 50n,
    dailyConfirmedSpendStroops: 0n,
  });
  const lateSettlementDayId = await addDaily(t, projectId, "2026-09-14", 100n);

  const result = await asWallet(t, OWNER).query(api.gas.queries.getTelemetry, {
    projectId,
    utcDayKey: "2026-09-15",
  });
  expect(result).toMatchObject({
    confirmedFeeStroops: "0",
    outstandingHoldsStroops: "50",
    effectiveUsageStroops: "50",
    availability: "available",
  });
  expect(result.history.find((entry) => entry.reportingDayKey === "2026-09-14")).toMatchObject({
    confirmedFeeStroops: "100",
  });

  await t.run(async (ctx) => {
    await ctx.db.patch(lateSettlementDayId, {
      confirmedSpendStroops: 125n,
      updatedAt: NOW + 2,
    });
  });
  const late = await asWallet(t, OWNER).query(api.gas.queries.getTelemetry, {
    projectId,
    utcDayKey: "2026-09-15",
  });
  expect(late).toMatchObject({
    availability: "available",
    confirmedFeeStroops: "0",
    effectiveUsageStroops: "50",
  });
  expect(late.history.find((entry) => entry.reportingDayKey === "2026-09-14")).toMatchObject({
    confirmedFeeStroops: "125",
  });
});

test("telemetry distinguishes missing, legacy, blocked, inconsistent, overflow, and preceding-day states", async () => {
  const t = convexTest(schema, modules);
  const missingProjectId = await createProject(t);
  const missing = await asWallet(t, OWNER).query(api.gas.queries.getTelemetry, {
    projectId: missingProjectId,
    utcDayKey: "2026-09-15",
  });
  expect(missing).toMatchObject({
    availability: "unavailable",
    reasonCode: "missing_policy",
    policyCapStroops: null,
    historyCompleteness: "unavailable",
  });
  expect(missing.history).toHaveLength(7);

  const legacyProjectId = await createProject(t);
  await addPolicy(t, legacyProjectId, {
    dailyReservedStroops: 10n,
    outstandingHoldsStroops: undefined,
    dailyConfirmedSpendStroops: undefined,
    accountingState: undefined,
  });
  await addDaily(t, legacyProjectId, "2026-09-15", 10n);
  const legacy = await asWallet(t, OWNER).query(api.gas.queries.getTelemetry, {
    projectId: legacyProjectId,
    utcDayKey: "2026-09-15",
  });
  expect(legacy.reasonCode).toBe("uninitialized_accounting");
  expect(legacy.history[6].confirmedFeeStroops).toBe("10");

  const blockedProjectId = await createProject(t);
  await addPolicy(t, blockedProjectId, { accountingBlockReason: "inconsistent_counters" });
  await addDaily(t, blockedProjectId, "2026-09-15", 100n);
  const blocked = await asWallet(t, OWNER).query(api.gas.queries.getTelemetry, {
    projectId: blockedProjectId,
    utcDayKey: "2026-09-15",
  });
  expect(blocked).toMatchObject({
    availability: "unavailable",
    reasonCode: "accounting_blocked",
    accountingBlockReason: "inconsistent_counters",
  });
  expect(blocked.history[6]).toMatchObject({ confirmedFeeStroops: "100" });

  const inconsistentProjectId = await createProject(t);
  await addPolicy(t, inconsistentProjectId, { dailyReservedStroops: 151n });
  const inconsistent = await asWallet(t, OWNER).query(api.gas.queries.getTelemetry, {
    projectId: inconsistentProjectId,
    utcDayKey: "2026-09-15",
  });
  expect(inconsistent.reasonCode).toBe("inconsistent_counters");

  const overflowProjectId = await createProject(t);
  await addPolicy(t, overflowProjectId, {
    dailyCapStroops: GAS_MAX_STROOPS,
    dailyReservedStroops: GAS_MAX_STROOPS,
    outstandingHoldsStroops: 1n,
    dailyConfirmedSpendStroops: GAS_MAX_STROOPS,
  });
  const overflow = await asWallet(t, OWNER).query(api.gas.queries.getTelemetry, {
    projectId: overflowProjectId,
    utcDayKey: "2026-09-15",
  });
  expect(overflow.reasonCode).toBe("overflow");

  const precedingProjectId = await createProject(t);
  await addPolicy(t, precedingProjectId, { dailyWindowKey: "2026-09-15" });
  await addDaily(t, precedingProjectId, "2026-09-12", 12n);
  const preceding = await asWallet(t, OWNER).query(api.gas.queries.getTelemetry, {
    projectId: precedingProjectId,
    utcDayKey: "2026-09-12",
  });
  expect(preceding).toMatchObject({
    availability: "unavailable",
    reasonCode: "requested_day_before_policy_window",
  });
  expect(preceding.history[6].confirmedFeeStroops).toBe("12");
});

test("telemetry rejects non-canonical dates and duplicate daily identities", async () => {
  const t = convexTest(schema, modules);
  const projectId = await createProject(t);
  const duplicatePolicyProjectId = await createProject(t);
  await addPolicy(t, projectId);
  await addDaily(t, projectId, "2026-09-15", 100n);
  await addDaily(t, projectId, "2026-09-15", 100n, { updatedAt: NOW + 2 });
  await addPolicy(t, duplicatePolicyProjectId);
  await addPolicy(t, duplicatePolicyProjectId, { updatedAt: NOW + 2 });

  await expect(
    asWallet(t, OWNER).query(api.gas.queries.getTelemetry, {
      projectId,
      utcDayKey: "2026-9-15",
    }),
  ).rejects.toThrow("Invalid UTC reporting day");
  const duplicate = await asWallet(t, OWNER).query(api.gas.queries.getTelemetry, {
    projectId,
    utcDayKey: "2026-09-15",
  });
  expect(duplicate).toMatchObject({
    availability: "unavailable",
    reasonCode: "ambiguous_accounting_identity",
  });
  const duplicatePolicy = await asWallet(t, OWNER).query(api.gas.queries.getTelemetry, {
    projectId: duplicatePolicyProjectId,
    utcDayKey: "2026-09-15",
  });
  expect(duplicatePolicy).toMatchObject({
    availability: "unavailable",
    reasonCode: "ambiguous_policy_identity",
  });
});

test("execution detail returns the durable sanitized projection after audit deletion", async () => {
  const t = convexTest(schema, modules);
  const projectId = await createProject(t);
  const otherProjectId = await createProject(t, OUTSIDER);
  await addMembership(t, projectId, VIEWER, "viewer");
  const requestId = "gas-execution-detail";
  const attemptId = await addAttempt(t, projectId, requestId, {
    lifecycle: "succeeded",
    outerTransactionHash: OUTER_HASH,
    actualFeeStroops: 187n,
    reconciliationRequired: false,
  });
  const auditId = await addAuditLog(t, projectId, requestId);
  await addAttempt(t, otherProjectId, requestId);

  const detail = await asWallet(t, VIEWER).query(api.gas.queries.getExecutionDetail, {
    projectId,
    requestId: ` ${requestId} `,
  });
  expect(detail).toEqual({
    object: "gas_submit_result",
    requestId,
    transactionHash: INNER_HASH,
    outerTransactionHash: OUTER_HASH,
    status: "succeeded",
    reservedStroops: "200",
    actualFeeStroops: "187",
    expiresAt: new Date(NOW + 900_000).toISOString(),
    reconciliationRequired: false,
  });
  expect(Object.keys(detail ?? {}).sort()).toEqual([
    "actualFeeStroops",
    "expiresAt",
    "object",
    "outerTransactionHash",
    "reconciliationRequired",
    "requestId",
    "reservedStroops",
    "status",
    "transactionHash",
  ]);
  expect(attemptId).toBeDefined();

  await t.run(async (ctx) => {
    await ctx.db.delete(auditId);
  });
  expect(
    await asWallet(t, VIEWER).query(api.gas.queries.getExecutionDetail, {
      projectId,
      requestId,
    }),
  ).toEqual(detail);
  expect(
    await asWallet(t, VIEWER).query(api.gas.queries.getExecutionDetail, {
      projectId,
      requestId: "missing-execution",
    }),
  ).toBeNull();
  await expect(
    asWallet(t, OUTSIDER).query(api.gas.queries.getExecutionDetail, { projectId, requestId }),
  ).rejects.toThrow("Unauthorized");
});

test("execution detail preserves each public lifecycle and nullable fee fields", async () => {
  const t = convexTest(schema, modules);
  const projectId = await createProject(t);
  const statuses = [
    "claimed",
    "submission_unknown",
    "submitted",
    "succeeded",
    "failed",
    "cancelled",
  ] as const;

  for (const [index, status] of statuses.entries()) {
    const requestId = `gas-status-${index}`;
    await addAttempt(t, projectId, requestId, {
      lifecycle: status,
      innerTransactionHash: `${index + 1}`.repeat(64).slice(0, 64),
      actualFeeStroops: undefined,
      outerTransactionHash: undefined,
    });
    const detail = await asWallet(t, OWNER).query(api.gas.queries.getExecutionDetail, {
      projectId,
      requestId,
    });
    expect(detail).toMatchObject({
      requestId,
      status,
      outerTransactionHash: null,
      actualFeeStroops: null,
    });
  }
});

test("execution detail fails closed on duplicate request identity and invalid request IDs", async () => {
  const t = convexTest(schema, modules);
  const projectId = await createProject(t);
  await addAttempt(t, projectId, "duplicate-request");
  await addAttempt(t, projectId, "duplicate-request", { innerTransactionHash: OUTER_HASH });

  await expect(
    asWallet(t, OWNER).query(api.gas.queries.getExecutionDetail, {
      projectId,
      requestId: "duplicate-request",
    }),
  ).rejects.toThrow("Multiple Gas execution attempts exist for request");
  await expect(
    asWallet(t, OWNER).query(api.gas.queries.getExecutionDetail, {
      projectId,
      requestId: "   ",
    }),
  ).rejects.toThrow("Invalid Gas request ID");
  await expect(
    t.query(api.gas.queries.getExecutionDetail, {
      projectId,
      requestId: "duplicate-request",
    }),
  ).rejects.toThrow("Not authenticated");
});
