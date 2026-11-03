/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, test, vi } from "vitest";

import type { Doc } from "../_generated/dataModel";

import { api, internal } from "../_generated/api";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

const currentOrganization = makeFunctionReference<"query">("organizations/queries:getCurrent");
const verifyOrganization = makeFunctionReference<"mutation">("organizations/mutations:verify");
const grantPromotion = makeFunctionReference<"mutation">("billing/mutations:grantPromotion");
const reserve = makeFunctionReference<"mutation">("billing/mutations:reserve");
const consume = makeFunctionReference<"mutation">("billing/mutations:consume");
const release = makeFunctionReference<"mutation">("billing/mutations:release");
const recoverExpired = makeFunctionReference<"mutation">(
  "billing/mutations:recoverExpiredReservations",
);
const expireCreditLots = makeFunctionReference<"mutation">("billing/mutations:expireCreditLots");
const updatePolicy = makeFunctionReference<"mutation">("billing/mutations:updatePolicy");
const setOrganizationPolicy = makeFunctionReference<"mutation">(
  "billing/mutations:setOrganizationPolicy",
);
const reconcile = makeFunctionReference<"query">("billing/queries:reconcile");
const listShadowDecisions = makeFunctionReference<"query">("billing/queries:listShadowDecisions");
const evaluateShadow = makeFunctionReference<"mutation">("billing/shadow:evaluate");

function asOwner(t: ReturnType<typeof convexTest>, address: string) {
  return t.withIdentity({
    subject: address,
    issuer: "http://localhost:3000",
    tokenIdentifier: `http://localhost:3000|${address}`,
  });
}

async function createProject(
  owner: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>,
  slug: string,
) {
  return await owner.mutation(api.projects.mutation.createDraft, {
    name: slug,
    slug,
    description: slug,
    metadataJson: "{}",
    metadataHash: "0".repeat(64),
    ownerAddress: "GOWNER",
  });
}

test("projects from one authenticated owner share one provisional organization", async () => {
  const t = convexTest(schema, modules);
  const owner = asOwner(t, "GOWNER");

  const firstProjectId = await createProject(owner, "first-project");
  const secondProjectId = await createProject(owner, "second-project");
  const organization = await owner.query(currentOrganization, {});

  expect(organization.verificationStatus).toBe("provisional");
  expect(organization.projectIds.sort()).toEqual([firstProjectId, secondProjectId].sort());
  expect(organization.trialState).toBe("pending_verification");
});

test("promotion requires verification and is exactly once", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-26T00:00:00Z"));
  try {
    const t = convexTest(schema, modules);
    const owner = asOwner(t, "GOWNER");
    await createProject(owner, "trial-project");
    const organization = await owner.query(currentOrganization, {});

    await expect(
      t.mutation(grantPromotion, {
        organizationId: organization._id,
        book: "shadow",
        idempotencyKey: "promo:trial",
        actor: "operator:test",
      }),
    ).rejects.toThrow("verified");

    await t.mutation(verifyOrganization, {
      organizationId: organization._id,
      evidenceType: "manual_review",
      evidenceReference: "review-123",
      actor: "operator:test",
      reason: "Approved fixture",
    });

    const first = await t.mutation(grantPromotion, {
      organizationId: organization._id,
      book: "shadow",
      idempotencyKey: "promo:trial",
      actor: "operator:test",
    });
    const replay = await t.mutation(grantPromotion, {
      organizationId: organization._id,
      book: "shadow",
      idempotencyKey: "promo:trial",
      actor: "operator:test",
    });

    expect(first.applied).toBe(true);
    expect(replay).toEqual(expect.objectContaining({ applied: false }));
    expect(first.expiresAt).toBe(Date.now() + 60 * 24 * 60 * 60_000);

    const state = await t.query(reconcile, {
      organizationId: organization._id,
      book: "shadow",
    });
    expect(state.matches).toBe(true);
    expect(state.materialized.promoAvailable).toBe(100n);

    vi.advanceTimersByTime(61 * 24 * 60 * 60_000);
    expect(await t.mutation(expireCreditLots, { limit: 25 })).toEqual({ expired: 1 });
    const expired = await t.query(reconcile, {
      organizationId: organization._id,
      book: "shadow",
    });
    expect(expired.matches).toBe(true);
    expect(expired.materialized.promoAvailable).toBe(0n);
    expect(expired.materialized.promoExpired).toBe(100n);
  } finally {
    vi.useRealTimers();
  }
});

test("reservations are atomic, promo-first, and terminal transitions are idempotent", async () => {
  const t = convexTest(schema, modules);
  const owner = asOwner(t, "GOWNER");
  const projectId = await createProject(owner, "reservation-project");
  const organization = await owner.query(currentOrganization, {});

  await t.mutation(verifyOrganization, {
    organizationId: organization._id,
    evidenceType: "manual_review",
    evidenceReference: "review-456",
    actor: "operator:test",
    reason: "Approved fixture",
  });
  await t.mutation(grantPromotion, {
    organizationId: organization._id,
    book: "shadow",
    idempotencyKey: "promo:reservation",
    actor: "operator:test",
  });

  const expiresAt = Date.now() + 30 * 60_000;
  const attempts = await Promise.all([
    t.mutation(reserve, {
      organizationId: organization._id,
      projectId,
      book: "shadow",
      amount: 100n,
      idempotencyKey: "reserve:first",
      expiresAt,
      network: "public",
      actor: "shadow",
      reason: "would_reserve",
    }),
    t.mutation(reserve, {
      organizationId: organization._id,
      projectId,
      book: "shadow",
      amount: 100n,
      idempotencyKey: "reserve:second",
      expiresAt,
      network: "public",
      actor: "shadow",
      reason: "would_reserve",
    }),
  ]);
  const first = attempts.find((attempt) => attempt.applied);
  const second = attempts.find((attempt) => !attempt.applied);
  if (!first?.reservationId) throw new Error("Expected one successful reservation");

  expect(attempts.filter((attempt) => attempt.applied)).toHaveLength(1);
  expect(first.creditClass).toBe("promotional");
  expect(second).toEqual(
    expect.objectContaining({ applied: false, reason: "insufficient_balance" }),
  );

  const consumed = await t.mutation(consume, {
    reservationId: first.reservationId,
    idempotencyKey: "consume:first",
    actor: "shadow",
    reason: "verified_success",
  });
  const replay = await t.mutation(consume, {
    reservationId: first.reservationId,
    idempotencyKey: "consume:first",
    actor: "shadow",
    reason: "verified_success",
  });

  expect(consumed.applied).toBe(true);
  expect(replay.applied).toBe(false);
  await expect(
    t.mutation(release, {
      reservationId: first.reservationId,
      idempotencyKey: "release:first",
      actor: "shadow",
      reason: "late_failure",
    }),
  ).rejects.toThrow("consumed");

  const state = await t.query(reconcile, {
    organizationId: organization._id,
    book: "shadow",
  });
  expect(state.matches).toBe(true);
  expect(state.materialized.promoAvailable).toBe(0n);
  expect(state.materialized.promoReserved).toBe(0n);
  expect(state.materialized.promoConsumed).toBe(100n);
});

test("expired reservations recover once", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-26T00:00:00Z"));
  try {
    const t = convexTest(schema, modules);
    const owner = asOwner(t, "GOWNER");
    const projectId = await createProject(owner, "expiry-project");
    const organization = await owner.query(currentOrganization, {});
    await t.mutation(verifyOrganization, {
      organizationId: organization._id,
      evidenceType: "manual_review",
      evidenceReference: "review-789",
      actor: "operator:test",
      reason: "Approved fixture",
    });
    await t.mutation(grantPromotion, {
      organizationId: organization._id,
      book: "shadow",
      idempotencyKey: "promo:expiry",
      actor: "operator:test",
    });
    const reservation = await t.mutation(reserve, {
      organizationId: organization._id,
      projectId,
      book: "shadow",
      amount: 1n,
      idempotencyKey: "reserve:expiry",
      expiresAt: Date.now() + 1_000,
      network: "public",
      actor: "shadow",
      reason: "would_reserve",
    });

    vi.advanceTimersByTime(2_000);
    expect(await t.mutation(recoverExpired, { limit: 25 })).toEqual({ recovered: 1 });
    expect(await t.mutation(recoverExpired, { limit: 25 })).toEqual({ recovered: 0 });

    const state = await t.query(reconcile, {
      organizationId: organization._id,
      book: "shadow",
    });
    expect(state.matches).toBe(true);
    expect(state.materialized.promoAvailable).toBe(100n);
    expect(reservation.applied).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

test("existing Testnet payment creation records a fee-exempt shadow decision", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-26T00:00:00Z"));
  try {
    const t = convexTest(schema, modules);
    const owner = asOwner(t, "GOWNER");
    const projectId = await createProject(owner, "shadow-testnet-project");
    await owner.mutation(api.projects.mutation.markPaymentAccessActive, {
      id: projectId,
      checkoutCredits: 3,
    });
    const { rawKey } = await owner.mutation(api.projects.mutation.generateApiKey, {
      id: projectId,
      label: "Shadow",
    });
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey));
    const apiKeyHash = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const { paymentIntentId } = await t.mutation(
      api.payment_intents.mutations.createPaymentIntent,
      {
        apiKeyHash,
        correlationId: "shadow-testnet-correlation",
        amount: "1",
        asset: "native",
      },
    );

    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const decisions = await t.query(listShadowDecisions, { projectId });
    expect(decisions).toEqual([
      expect.objectContaining({
        paymentIntentId,
        phase: "would_reserve",
        outcome: "fee_exempt",
        reason: "testnet_is_free",
        legacyCheckoutCredits: 3,
      }),
    ]);
    const organizationId = decisions[0]?.organizationId;
    if (!organizationId) throw new Error("Expected organization-scoped decision");
    const ledger = await t.query(reconcile, {
      organizationId,
      book: "shadow",
    });
    expect(ledger.entryCount).toBe(0);
    expect(ledger.matches).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

test("Mainnet shadow lifecycle reserves and consumes without enforcing legacy access", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-26T00:00:00Z"));
  try {
    const t = convexTest(schema, modules);
    const owner = asOwner(t, "GOWNER");
    const projectId = await createProject(owner, "shadow-mainnet-project");
    const organization = await owner.query(currentOrganization, {});
    await t.mutation(verifyOrganization, {
      organizationId: organization._id,
      evidenceType: "manual_review",
      evidenceReference: "mainnet-review",
      actor: "operator:test",
      reason: "Approved fixture",
    });
    await t.mutation(grantPromotion, {
      organizationId: organization._id,
      book: "shadow",
      idempotencyKey: "promo:mainnet",
      actor: "operator:test",
    });
    await t.mutation(updatePolicy, {
      billingLedgerWrite: true,
      billingShadowMode: true,
      mainnetCreditEnforcement: false,
      billingTopupsEnabled: false,
      promoGrantEnabled: false,
      billingKillSwitch: false,
      actor: "operator:test",
    });
    await t.mutation(setOrganizationPolicy, {
      organizationId: organization._id,
      enforcementEnabled: false,
      shadowEnabled: true,
      actor: "operator:test",
    });
    await owner.mutation(api.projects.mutation.markPaymentAccessActive, {
      id: projectId,
      checkoutCredits: 2,
    });
    const { rawKey } = await owner.mutation(api.projects.mutation.generateApiKey, {
      id: projectId,
      label: "Shadow Mainnet",
    });
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey));
    const apiKeyHash = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const { paymentIntentId } = await t.mutation(
      api.payment_intents.mutations.createPaymentIntent,
      {
        apiKeyHash,
        correlationId: "shadow-mainnet-correlation",
        amount: "1",
        asset: "native",
      },
    );
    await t.run(async (ctx) => {
      await ctx.db.patch(paymentIntentId, { network: "public" });
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    await t.mutation(api.payment_intents.mutations.updateStatus, {
      paymentIntentId,
      status: "pending",
      txHash: "a".repeat(64),
    });
    await expect(
      t.mutation(internal.payment_intents.mutations.markVerifiedPaid, {
        paymentIntentId,
        txHash: "a".repeat(64),
        verifiedNetwork: "testnet",
        verifiedPayment: {
          source: "GPAYER",
          destination: "GOWNER",
          amount: "1.0000000",
          asset: "native",
        },
      }),
    ).rejects.toThrow("network");
    await t.mutation(internal.payment_intents.mutations.markVerifiedPaid, {
      paymentIntentId,
      txHash: "a".repeat(64),
      verifiedNetwork: "public",
      verifiedPayment: {
        source: "GPAYER",
        destination: "GOWNER",
        amount: "1.0000000",
        asset: "native",
      },
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const intent = await t.query(api.payment_intents.queries.getPaymentIntent, {
      paymentIntentId,
    });
    const decisions = await t.query(listShadowDecisions, { projectId });
    const state = await t.query(reconcile, {
      organizationId: organization._id,
      book: "shadow",
    });
    expect(intent?.status).toBe("paid");
    expect(
      decisions.map((decision: Doc<"shadowBillingDecisions">) => [
        decision.phase,
        decision.outcome,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ["would_reserve", "applied"],
        ["would_consume", "applied"],
      ]),
    );
    expect(state.matches).toBe(true);
    expect(state.materialized.promoAvailable).toBe(99n);
    expect(state.materialized.promoConsumed).toBe(1n);
  } finally {
    vi.useRealTimers();
  }
});

test("legacy PDAX shadow billing is disabled and does not write new financial entries", async () => {
  const t = convexTest(schema, modules);
  const owner = asOwner(t, "GPDAXLEGACY");
  const projectId = await createProject(owner, "pdax-shadow-project");
  const paymentIntentId = await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("paymentIntents", {
      projectId,
      network: "public",
      intentType: "merchant_payment",
      amount: "10",
      asset: "USDC:GISSUER",
      receiverAddress: "G-HISTORICAL-DEPOSIT",
      merchantName: "Historical merchant",
      status: "paid",
      anchor: "pdax",
      expiresAt: now + 30 * 60_000,
      createdAt: now,
      updatedAt: now,
    });
  });

  const result = await t.mutation(evaluateShadow, {
    phase: "would_consume",
    projectId,
    paymentIntentId,
    route: "pdax",
    idempotencyKey: "legacy-pdax-shadow-disabled",
  });
  expect(result).toEqual({ applied: false, outcome: "disabled" });

  const state = await t.run(async (ctx) => ({
    decisions: await ctx.db.query("shadowBillingDecisions").collect(),
    economics: await ctx.db.query("billingPdaxEconomics").collect(),
  }));
  expect(state.decisions).toHaveLength(0);
  expect(state.economics).toHaveLength(0);
});
