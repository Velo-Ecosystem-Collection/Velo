/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, expect, test, vi } from "vitest";

import { api, internal } from "../_generated/api";
import { findVerifiedPayment } from "../payment_intents/verification";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

vi.mock("@repo/stellar/transaction-debugger", () => ({
  lookupTestnetTransaction: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

async function insertProject(t: ReturnType<typeof convexTest>, checkoutCredits = 2) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("projects", {
      name: "Lifecycle Reliability",
      slug: "lifecycle-reliability",
      description: "Sprint 9 lifecycle reliability fixture",
      metadataJson: "{}",
      metadataHash: "0".repeat(64),
      ownerAddress: "GAFVCOWZWSJEAFOKBEBO2B4QITJ2YXN6YIYG6BUURQINVDVW4OPS3OL6",
      status: "draft",
      paymentAccessActive: true,
      checkoutCredits,
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function insertIntent(
  t: ReturnType<typeof convexTest>,
  args: {
    projectId: Awaited<ReturnType<typeof insertProject>>;
    status: "created" | "pending";
    txHash?: string;
  },
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("paymentIntents", {
      projectId: args.projectId,
      amount: "1.00",
      asset: "native",
      receiverAddress: "GDIEVMRSOQV3JKZ2CNUL2RQV4TTNAISKW4NAC25PQUQKGMWJO6DTOAE7",
      merchantName: "Lifecycle Reliability",
      status: args.status,
      ...(args.txHash ? { txHash: args.txHash } : {}),
      expiresAt: now + 30 * 60_000,
      stageTimestamps: { created: now },
      createdAt: now,
      updatedAt: now,
    });
  });
}

function successfulLookup(hash: string) {
  return {
    status: "success" as const,
    hash,
    network: "testnet" as const,
    operations: [
      {
        index: 0,
        type: "payment",
        source: "GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57",
        destination: "GDIEVMRSOQV3JKZ2CNUL2RQV4TTNAISKW4NAC25PQUQKGMWJO6DTOAE7",
        amount: "1.0000000",
        asset: "native",
      },
    ],
    contractCalls: [],
    events: [],
    rawResponse: "{}",
  };
}

test("payment operation matching checks receiver, amount, asset, and reported payer", () => {
  const expectation = {
    receiverAddress: "GDIEVMRSOQV3JKZ2CNUL2RQV4TTNAISKW4NAC25PQUQKGMWJO6DTOAE7",
    payerAddress: "GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57",
    amount: "1.00",
    asset: "XLM",
  };
  const matchingOperation = successfulLookup("a".repeat(64)).operations[0]!;

  expect(findVerifiedPayment([matchingOperation], expectation)).toEqual({
    source: "GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57",
    destination: "GDIEVMRSOQV3JKZ2CNUL2RQV4TTNAISKW4NAC25PQUQKGMWJO6DTOAE7",
    amount: "1.0000000",
    asset: "native",
  });

  for (const mismatch of [
    { ...matchingOperation, source: "GCI2FCQLOQ4BLE5E3FDJK6JARETK7SFNQLEIHG3WIQ2ZXHV2TJFTUNWJ" },
    { ...matchingOperation, destination: "GCI2FCQLOQ4BLE5E3FDJK6JARETK7SFNQLEIHG3WIQ2ZXHV2TJFTUNWJ" },
    { ...matchingOperation, amount: "1.0000001" },
    { ...matchingOperation, asset: "USDC:GISSUER" },
  ]) {
    expect(findVerifiedPayment([mismatch], expectation)).toBeUndefined();
  }
});

test("reportSubmitted same-hash pending replay preserves clocks and schedules one watcher", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-13T00:00:00Z"));
  try {
    const t = convexTest(schema, modules);
    const projectId = await insertProject(t);
    const paymentIntentId = await insertIntent(t, { projectId, status: "created" });
    const txHash = "a".repeat(64);
    const firstReportedAt = Date.now();

    const stellar = await import("@repo/stellar/transaction-debugger");
    vi.mocked(stellar.lookupTestnetTransaction).mockResolvedValue(successfulLookup(txHash));

    const report = {
      hash: txHash,
      paymentIntentId,
      payerAddress: "GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57",
      stageTimestamps: {
        startedSigning: firstReportedAt - 300,
        signed: firstReportedAt - 200,
        submitted: firstReportedAt - 100,
      },
    };
    const firstTransactionId = await t.mutation(api.transactions.mutation.reportSubmitted, report);

    vi.setSystemTime(new Date(firstReportedAt + 5_000));
    const replayTransactionId = await t.mutation(api.transactions.mutation.reportSubmitted, report);

    expect(replayTransactionId).toBe(firstTransactionId);
    const state = await t.run(async (ctx) => {
      const intent = await ctx.db.get(paymentIntentId);
      const transaction = await ctx.db.get(firstTransactionId);
      const jobs = await ctx.db
        .query("paymentReconciliationJobs")
        .withIndex("by_payment_intent", (q) => q.eq("paymentIntentId", paymentIntentId))
        .collect();
      const scheduled = await ctx.db.system.query("_scheduled_functions").collect();
      return { intent, transaction, jobs, scheduled };
    });

    expect(state.intent?.status).toBe("pending");
    expect(state.intent?.stageTimestamps?.submissionReported).toBe(firstReportedAt);
    expect(state.intent?.updatedAt).toBe(firstReportedAt);
    expect(state.transaction?.fetchedAt).toBe(firstReportedAt);
    expect(state.jobs).toHaveLength(1);
    expect(
      state.scheduled.filter((scheduled) => scheduled.name.includes("watchTransaction")),
    ).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});

test("verified paid same-hash replay is a no-op and concurrent watchers decrement once", async () => {
  const t = convexTest(schema, modules);
  const projectId = await insertProject(t, 2);
  const txHash = "b".repeat(64);
  const paymentIntentId = await insertIntent(t, {
    projectId,
    status: "pending",
    txHash,
  });

  const applied = await t.mutation(internal.payment_intents.mutations.markVerifiedPaid, {
    paymentIntentId,
    txHash,
    verifiedPayment: {
      source: "GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57",
      destination: "GDIEVMRSOQV3JKZ2CNUL2RQV4TTNAISKW4NAC25PQUQKGMWJO6DTOAE7",
      amount: "1.0000000",
      asset: "native",
    },
  });
  const paidIntent = await t.run(async (ctx) => await ctx.db.get(paymentIntentId));
  const replay = await t.mutation(internal.payment_intents.mutations.markVerifiedPaid, {
    paymentIntentId,
    txHash,
    verifiedPayment: {
      source: "GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57",
      destination: "GDIEVMRSOQV3JKZ2CNUL2RQV4TTNAISKW4NAC25PQUQKGMWJO6DTOAE7",
      amount: "1.0000000",
      asset: "native",
    },
  });
  const replayedIntent = await t.run(async (ctx) => await ctx.db.get(paymentIntentId));

  expect(applied).toEqual({ applied: true, projectId });
  expect(replay).toEqual({ applied: false, projectId });
  expect(replayedIntent?.updatedAt).toBe(paidIntent?.updatedAt);
  expect(replayedIntent?.stageTimestamps?.confirmed).toBe(paidIntent?.stageTimestamps?.confirmed);

  const secondTxHash = "c".repeat(64);
  const secondIntentId = await insertIntent(t, {
    projectId,
    status: "pending",
    txHash: secondTxHash,
  });
  const stellar = await import("@repo/stellar/transaction-debugger");
  vi.mocked(stellar.lookupTestnetTransaction).mockResolvedValue(successfulLookup(secondTxHash));

  const results = await Promise.all([
    t.action(internal.payment_intents.scanner.watchTransaction, {
      paymentIntentId: secondIntentId,
      txHash: secondTxHash,
    }),
    t.action(internal.payment_intents.scanner.watchTransaction, {
      paymentIntentId: secondIntentId,
      txHash: secondTxHash,
    }),
  ]);
  const project = await t.run(async (ctx) => await ctx.db.get(projectId));

  expect(results.map((result) => result.status)).toEqual(["success", "success"]);
  expect(project?.checkoutCredits).toBe(0);
});

test("ledger payment details must match and one transaction cannot settle two intents", async () => {
  const t = convexTest(schema, modules);
  const projectId = await insertProject(t, 2);
  const mismatchedHash = "e".repeat(64);
  const mismatchedIntentId = await insertIntent(t, {
    projectId,
    status: "pending",
    txHash: mismatchedHash,
  });
  const stellar = await import("@repo/stellar/transaction-debugger");
  vi.mocked(stellar.lookupTestnetTransaction).mockResolvedValue({
    ...successfulLookup(mismatchedHash),
    operations: [
      {
        index: 0,
        type: "payment",
        source: "GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57",
        destination: "GAQEAQHDMTAQ6K7MTQP6KAFBZVGCI7EJ2ZIKAHWX5AWKXKDHQ56CCLKH",
        amount: "1.0000000",
        asset: "native",
      },
    ],
  });

  const mismatch = await t.action(internal.payment_intents.scanner.watchTransaction, {
    paymentIntentId: mismatchedIntentId,
    txHash: mismatchedHash,
  });
  const afterMismatch = await t.run(async (ctx) => ({
    intent: await ctx.db.get(mismatchedIntentId),
    project: await ctx.db.get(projectId),
  }));
  expect(mismatch.status).toBe("failed");
  expect(afterMismatch.intent?.status).toBe("failed");
  expect(afterMismatch.project?.checkoutCredits).toBe(2);

  const sharedHash = "f".repeat(64);
  const firstIntentId = await insertIntent(t, { projectId, status: "pending", txHash: sharedHash });
  const secondIntentId = await insertIntent(t, {
    projectId,
    status: "pending",
    txHash: sharedHash,
  });
  const verifiedPayment = {
    source: "GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57",
    destination: "GDIEVMRSOQV3JKZ2CNUL2RQV4TTNAISKW4NAC25PQUQKGMWJO6DTOAE7",
    amount: "1.0000000",
    asset: "native",
  };

  const claims = await Promise.allSettled([
    t.mutation(internal.payment_intents.mutations.markVerifiedPaid, {
      paymentIntentId: firstIntentId,
      txHash: sharedHash,
      verifiedPayment,
    }),
    t.mutation(internal.payment_intents.mutations.markVerifiedPaid, {
      paymentIntentId: secondIntentId,
      txHash: sharedHash.toUpperCase(),
      verifiedPayment,
    }),
  ]);
  expect(claims.filter((claim) => claim.status === "fulfilled")).toHaveLength(1);
  expect(claims.filter((claim) => claim.status === "rejected")).toHaveLength(1);
  expect(claims.find((claim) => claim.status === "rejected")?.reason).toMatchObject({
    message: expect.stringContaining("already assigned to another intent"),
  });

  const afterDuplicate = await t.run(async (ctx) => ({
    first: await ctx.db.get(firstIntentId),
    second: await ctx.db.get(secondIntentId),
    project: await ctx.db.get(projectId),
  }));
  expect([afterDuplicate.first?.status, afterDuplicate.second?.status].sort()).toEqual([
    "paid",
    "pending",
  ]);
  expect(afterDuplicate.project?.checkoutCredits).toBe(1);
});

test("drain recovers an expired lease, fences the stale worker, and resolves payment", async () => {
  const t = convexTest(schema, modules);
  const projectId = await insertProject(t, 2);
  const txHash = "d".repeat(64);
  const paymentIntentId = await insertIntent(t, {
    projectId,
    status: "pending",
    txHash,
  });
  const staleLeaseToken = "stale-worker";
  const jobId = await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("paymentReconciliationJobs", {
      paymentIntentId,
      projectId,
      txHash,
      state: "leased",
      attemptCount: 1,
      nextAttemptAt: now - 10_000,
      leaseToken: staleLeaseToken,
      leaseGeneration: 1,
      leaseExpiresAt: now - 1,
      expiresAt: now + 30 * 60_000,
      createdAt: now - 10_000,
      updatedAt: now - 10_000,
    });
  });
  const stellar = await import("@repo/stellar/transaction-debugger");
  vi.mocked(stellar.lookupTestnetTransaction).mockResolvedValue(successfulLookup(txHash));

  const result = await t.action(internal.payment_reconciliation_jobs.actions.drain, {
    limit: 10,
  });
  const state = await t.run(async (ctx) => ({
    intent: await ctx.db.get(paymentIntentId),
    project: await ctx.db.get(projectId),
    job: await ctx.db.get(jobId),
  }));

  expect(result).toEqual({
    claimed: 1,
    processed: 1,
    recovered: 1,
    deadLettered: 0,
  });
  expect(state.intent?.status).toBe("paid");
  expect(state.project?.checkoutCredits).toBe(1);
  expect(state.job).toBeNull();

  const staleFinish = await t.mutation(internal.payment_reconciliation_jobs.mutations.finish, {
    jobId,
    leaseToken: staleLeaseToken,
    leaseGeneration: 1,
    resolved: true,
  });
  expect(staleFinish).toBe(false);
});

test("expired lease recovery obeys its page bound", async () => {
  const t = convexTest(schema, modules);
  const projectId = await insertProject(t);
  const paymentIntentId = await insertIntent(t, { projectId, status: "pending" });
  await t.run(async (ctx) => {
    const now = Date.now();
    for (let index = 0; index < 2; index++) {
      await ctx.db.insert("paymentReconciliationJobs", {
        paymentIntentId,
        projectId,
        txHash: `${index}`.repeat(64),
        state: "leased",
        attemptCount: 1,
        nextAttemptAt: now - 10_000,
        leaseToken: `lease-${index}`,
        leaseGeneration: 1,
        leaseExpiresAt: now - 1,
        expiresAt: now + 30 * 60_000,
        createdAt: now - 10_000,
        updatedAt: now - 10_000,
      });
    }
  });

  const result = await t.mutation(
    internal.payment_reconciliation_jobs.mutations.recoverExpiredLeases,
    { limit: 1 },
  );
  const states = await t.run(async (ctx) =>
    (
      await ctx.db
        .query("paymentReconciliationJobs")
        .withIndex("by_payment_intent", (q) => q.eq("paymentIntentId", paymentIntentId))
        .collect()
    ).map((job) => job.state),
  );

  expect(result).toEqual({ inspected: 1, recovered: 1, deadLettered: 0, saturated: true });
  expect(states.filter((state) => state === "pending")).toHaveLength(1);
  expect(states.filter((state) => state === "leased")).toHaveLength(1);
});
