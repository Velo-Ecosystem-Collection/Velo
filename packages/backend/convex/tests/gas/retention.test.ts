/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";

import type { DataModel, Doc, Id } from "../../_generated/dataModel";
import type { TestConvexForDataModelAndIdentity } from "convex-test";

import { internal } from "../../_generated/api";
import { GAS_DECISION_CODES, GAS_LIFECYCLE_STATES } from "../../gas/types";
import schema from "../../schema";

const modules = import.meta.glob("../../**/*.ts");
type TestContext = TestConvexForDataModelAndIdentity<DataModel>;

const NOW = Date.parse("2026-09-03T12:34:56.789Z");
const RETENTION_PERIOD_MS = 30 * 24 * 60 * 60 * 1_000;
const RETENTION_WORKER_NAME = "gas/retention:expireLogs";

type GasLogInput = Omit<Doc<"gasLogs">, "_id" | "_creationTime">;

async function withFixedTime<T>(callback: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  try {
    return await callback();
  } finally {
    vi.useRealTimers();
  }
}

async function createProject(t: TestContext): Promise<Id<"projects">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("projects", {
      name: "Gas retention test project",
      slug: "gas-retention-test",
      description: "Gas retention tests",
      metadataJson: "{}",
      metadataHash: "0".repeat(64),
      ownerAddress: "gas-retention-owner",
      status: "draft",
      createdAt: NOW,
      updatedAt: NOW,
    }),
  );
}

function logInput(
  projectId: Id<"projects">,
  requestId: string,
  options: Pick<GasLogInput, "lifecycle" | "retentionExpiresAt" | "expiresAt">,
): GasLogInput {
  const createdAt = options.retentionExpiresAt - RETENTION_PERIOD_MS;
  const isRejected = options.lifecycle === GAS_LIFECYCLE_STATES.rejected;
  return {
    projectId,
    requestId,
    idempotencyKeyHash: `idempotency-${requestId}`,
    requestFingerprint: `fingerprint-${requestId}`,
    decisionCode: isRejected ? GAS_DECISION_CODES.rejected : GAS_DECISION_CODES.reserved,
    ...(isRejected ? { rejectionCode: "policy_disabled" as const } : {}),
    lifecycle: options.lifecycle,
    expiresAt: options.expiresAt,
    retentionExpiresAt: options.retentionExpiresAt,
    createdAt,
    updatedAt: createdAt,
  };
}

async function insertLogs(t: TestContext, logs: readonly GasLogInput[]): Promise<void> {
  await t.run(async (ctx) => {
    for (const log of logs) await ctx.db.insert("gasLogs", log);
  });
}

async function readLogs(t: TestContext): Promise<Doc<"gasLogs">[]> {
  return await t.run(async (ctx) =>
    ctx.db.query("gasLogs").withIndex("by_retention_expires_at").collect(),
  );
}

test("deletes logs at or before retention expiry regardless of lifecycle or reservation expiry", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const projectId = await createProject(t);

    await insertLogs(t, [
      logInput(projectId, "eligible-reserved", {
        lifecycle: GAS_LIFECYCLE_STATES.reserved,
        expiresAt: NOW + 60 * 60_000,
        retentionExpiresAt: NOW - 1,
      }),
      logInput(projectId, "eligible-rejected", {
        lifecycle: GAS_LIFECYCLE_STATES.rejected,
        expiresAt: NOW + 60 * 60_000,
        retentionExpiresAt: NOW,
      }),
      logInput(projectId, "eligible-expired", {
        lifecycle: GAS_LIFECYCLE_STATES.expired,
        expiresAt: NOW + 60 * 60_000,
        retentionExpiresAt: NOW,
      }),
      logInput(projectId, "future-retention-expired-reservation", {
        lifecycle: GAS_LIFECYCLE_STATES.reserved,
        expiresAt: NOW - 1,
        retentionExpiresAt: NOW + 1,
      }),
    ]);

    const deleted = await t.mutation(internal.gas.retention.expireLogs, {});

    expect(deleted).toBe(3);
    expect((await readLogs(t)).map((log) => log.requestId)).toEqual([
      "future-retention-expired-reservation",
    ]);
  });
});

test("deletes bounded pages and schedules immediate continuation for the remainder", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const projectId = await createProject(t);
    const eligibleLogs = Array.from({ length: 105 }, (_, index) =>
      logInput(projectId, `eligible-${index}`, {
        lifecycle: GAS_LIFECYCLE_STATES.expired,
        expiresAt: NOW - 1,
        retentionExpiresAt: NOW,
      }),
    );
    const ineligibleLogs = [
      logInput(projectId, "future-retention-one", {
        lifecycle: GAS_LIFECYCLE_STATES.reserved,
        expiresAt: NOW - 1,
        retentionExpiresAt: NOW + 1,
      }),
      logInput(projectId, "future-retention-two", {
        lifecycle: GAS_LIFECYCLE_STATES.rejected,
        expiresAt: NOW - 1,
        retentionExpiresAt: NOW + 1,
      }),
    ];
    await insertLogs(t, [...eligibleLogs, ...ineligibleLogs]);

    const deleted = await t.mutation(internal.gas.retention.expireLogs, {});

    expect(deleted).toBe(100);
    expect((await readLogs(t)).map((log) => log.requestId)).toHaveLength(7);

    const scheduled = await t.run(async (ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(scheduled).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: RETENTION_WORKER_NAME,
          scheduledTime: NOW,
          state: { kind: "pending" },
        }),
      ]),
    );

    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    expect((await readLogs(t)).map((log) => log.requestId)).toEqual([
      "future-retention-one",
      "future-retention-two",
    ]);
  });
});
