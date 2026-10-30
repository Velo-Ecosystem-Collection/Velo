/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, test, vi } from "vitest";

import type { Id } from "../_generated/dataModel";

import { api, internal } from "../_generated/api";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

const bootstrapOperator = makeFunctionReference<"mutation">("billing/operators:bootstrap");
const setOperator = makeFunctionReference<"mutation">("billing/operators:setOperator");
const createOffer = makeFunctionReference<"mutation">("billing/offers:create");
const getMerchantBilling = makeFunctionReference<"query">("billing/merchant:get");
const createTopup = makeFunctionReference<"mutation">("billing/topups:create");
const expireCreditLots = makeFunctionReference<"mutation">("billing/mutations:expireCreditLots");
const verifyOrganization = makeFunctionReference<"mutation">("organizations/mutations:verify");
const grantPromotion = makeFunctionReference<"mutation">("billing/mutations:grantPromotion");
const updatePolicy = makeFunctionReference<"mutation">("billing/mutations:updatePolicy");
const setOrganizationPolicy = makeFunctionReference<"mutation">(
  "billing/mutations:setOrganizationPolicy",
);
const listExceptions = makeFunctionReference<"query">("billing/exceptions:list");
const runReconciliation = makeFunctionReference<"mutation">("billing/reconciliation:run");

function asWallet(t: ReturnType<typeof convexTest>, address: string) {
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

async function configureOperatorAndOffer(t: ReturnType<typeof convexTest>, creditQuantity = 100n) {
  const operator = asWallet(t, "GOPERATOR");
  await t.mutation(bootstrapOperator, {
    walletAddress: "GOPERATOR",
    actor: "test-bootstrap",
  });
  const offerId = (await operator.mutation(createOffer, {
    sku: "credits-100",
    creditQuantity,
    priceAmount: "20",
    asset: "USDC:GISSUER",
    network: "testnet",
    treasuryAddress: "GTREASURY",
    activeFrom: Date.now() - 1,
    refundPolicy:
      "Top-ups are prepaid. Verified Velo billing errors receive auditable adjustments.",
    activate: true,
  })) as Id<"billingOffers">;
  return { operator, offerId };
}

test("wallet allowlisted operators manage immutable offer versions", async () => {
  const t = convexTest(schema, modules);
  const { operator, offerId } = await configureOperatorAndOffer(t);
  const owner = asWallet(t, "GOWNER");
  await createProject(owner, "offer-project");

  const billing = await owner.query(getMerchantBilling, {});
  expect(billing?.activeOffer).toEqual(
    expect.objectContaining({
      _id: offerId,
      sku: "credits-100",
      creditQuantity: 100n,
      priceAmount: "20",
      asset: "USDC:GISSUER",
      treasuryAddress: "GTREASURY",
    }),
  );

  await expect(
    owner.mutation(createOffer, {
      sku: "unauthorized",
      creditQuantity: 1n,
      priceAmount: "1",
      asset: "USDC:GISSUER",
      network: "testnet",
      treasuryAddress: "GTREASURY",
      activeFrom: Date.now(),
      refundPolicy: "No.",
      activate: false,
    }),
  ).rejects.toThrow("operator");

  await operator.mutation(createOffer, {
    sku: "credits-100",
    creditQuantity: 120n,
    priceAmount: "20",
    asset: "USDC:GISSUER",
    network: "testnet",
    treasuryAddress: "GTREASURY",
    activeFrom: Date.now(),
    refundPolicy: "Updated terms.",
    activate: true,
  });
  const updated = await owner.query(getMerchantBilling, {});
  expect(updated?.activeOffer?.version).toBe(2);
  expect(updated?.activeOffer?.creditQuantity).toBe(120n);
});

test("offer creation accepts a Testnet USDC issuer and stores a canonical asset", async () => {
  const t = convexTest(schema, modules);
  const operator = asWallet(t, "GOPERATOR");
  await t.mutation(bootstrapOperator, {
    walletAddress: "GOPERATOR",
    actor: "test-bootstrap",
  });

  const offerId = (await operator.mutation(createOffer, {
    sku: "issuer-input",
    creditQuantity: 100n,
    priceAmount: "20",
    asset: "gissuer",
    network: "testnet",
    treasuryAddress: "GTREASURY",
    activeFrom: Date.now(),
    refundPolicy: "Test policy.",
    activate: true,
  })) as Id<"billingOffers">;

  const offer = await t.run(async (ctx) => await ctx.db.get(offerId));
  expect(offer?.asset).toBe("USDC:GISSUER");
});

test("offer creation accepts XLM and stores the canonical native asset", async () => {
  const t = convexTest(schema, modules);
  const operator = asWallet(t, "GOPERATOR");
  await t.mutation(bootstrapOperator, {
    walletAddress: "GOPERATOR",
    actor: "test-bootstrap",
  });

  const offerId = (await operator.mutation(createOffer, {
    sku: "xlm-offer",
    creditQuantity: 100n,
    priceAmount: "10",
    asset: "XLM",
    network: "testnet",
    treasuryAddress: "GTREASURY",
    activeFrom: Date.now(),
    refundPolicy: "Test policy.",
    activate: true,
  })) as Id<"billingOffers">;

  const offer = await t.run(async (ctx) => await ctx.db.get(offerId));
  expect(offer?.asset).toBe("native");
});

test("merchant billing reports whether platform safety controls allow top-ups", async () => {
  const t = convexTest(schema, modules);
  const { operator } = await configureOperatorAndOffer(t);
  const owner = asWallet(t, "GOWNER");
  await createProject(owner, "topup-availability");

  const disabled = await owner.query(getMerchantBilling, {});
  expect(disabled?.topupsEnabled).toBe(false);
  expect(disabled?.topupsUnavailableReason).toContain("not configured");

  await operator.mutation(updatePolicy, {
    billingLedgerWrite: true,
    billingShadowMode: false,
    mainnetCreditEnforcement: false,
    billingTopupsEnabled: true,
    promoGrantEnabled: true,
    billingKillSwitch: false,
    actor: "operator:test",
  });

  const enabled = await owner.query(getMerchantBilling, {});
  expect(enabled?.topupsEnabled).toBe(true);
  expect(enabled?.topupsUnavailableReason).toBeNull();
});

test("top-up settlement snapshots the offer and grants paid credits exactly once", async () => {
  const t = convexTest(schema, modules);
  const { operator } = await configureOperatorAndOffer(t);
  const owner = asWallet(t, "GOWNER");
  await createProject(owner, "topup-project");
  const organization = await owner.query(api.organizations.queries.getCurrent, {});

  await operator.mutation(updatePolicy, {
    billingLedgerWrite: true,
    billingShadowMode: false,
    mainnetCreditEnforcement: false,
    billingTopupsEnabled: true,
    promoGrantEnabled: true,
    billingKillSwitch: false,
    actor: "operator:test",
  });

  const created = await owner.mutation(createTopup, {});
  const intent = await owner.query(api.payment_intents.queries.getPaymentIntent, {
    paymentIntentId: created.paymentIntentId,
  });
  expect(intent).toEqual(
    expect.objectContaining({
      intentType: "billing_topup",
      amount: "20",
      asset: "USDC:GISSUER",
      receiverAddress: "GTREASURY",
    }),
  );

  await t.run(async (ctx) => {
    await ctx.db.patch(created.paymentIntentId, {
      status: "pending",
      payerAddress: "GOWNER",
      txHash: "a".repeat(64),
    });
  });
  const first = await t.mutation(internal.payment_intents.mutations.markVerifiedPaid, {
    paymentIntentId: created.paymentIntentId,
    txHash: "a".repeat(64),
    verifiedNetwork: "testnet",
    verifiedPayment: {
      source: "GOWNER",
      destination: "GTREASURY",
      amount: "20.0000000",
      asset: "USDC:GISSUER",
    },
  });
  const replay = await t.mutation(internal.payment_intents.mutations.markVerifiedPaid, {
    paymentIntentId: created.paymentIntentId,
    txHash: "a".repeat(64),
    verifiedNetwork: "testnet",
    verifiedPayment: {
      source: "GOWNER",
      destination: "GTREASURY",
      amount: "20",
      asset: "USDC:GISSUER",
    },
  });

  expect(first.applied).toBe(true);
  expect(replay.applied).toBe(false);
  const billing = await owner.query(getMerchantBilling, {});
  expect(billing?.balance.paidAvailable).toBe(100n);
  expect(billing?.topups).toHaveLength(1);
  expect(billing?.topups[0]).toEqual(
    expect.objectContaining({ status: "settled", creditQuantity: 100n }),
  );
  expect(billing?.receipts).toHaveLength(1);
  expect(billing?.receipts[0]?.organizationId).toBe(organization?._id);
});

test("cancelling a later top-up preserves credits from an earlier settled top-up", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-27T00:00:00Z"));
  try {
    const t = convexTest(schema, modules);
    const { operator } = await configureOperatorAndOffer(t, 5n);
    const owner = asWallet(t, "GOWNER");
    await createProject(owner, "cancelled-repeat-topup-project");

    await operator.mutation(updatePolicy, {
      billingLedgerWrite: true,
      billingShadowMode: false,
      mainnetCreditEnforcement: false,
      billingTopupsEnabled: true,
      promoGrantEnabled: true,
      billingKillSwitch: false,
      actor: "operator:test",
    });

    const settledTopup = await owner.mutation(createTopup, {});
    await t.run(async (ctx) => {
      await ctx.db.patch(settledTopup.paymentIntentId, {
        status: "pending",
        payerAddress: "GOWNER",
        txHash: "e".repeat(64),
      });
    });
    await t.mutation(internal.payment_intents.mutations.markVerifiedPaid, {
      paymentIntentId: settledTopup.paymentIntentId,
      txHash: "e".repeat(64),
      verifiedNetwork: "testnet",
      verifiedPayment: {
        source: "GOWNER",
        destination: "GTREASURY",
        amount: "20",
        asset: "USDC:GISSUER",
      },
    });

    const beforeCancellation = await owner.query(getMerchantBilling, {});
    expect(beforeCancellation?.balance.paidAvailable).toBe(5n);

    const cancelledTopup = await owner.mutation(createTopup, {});
    await owner.mutation(api.payment_intents.mutations.updateStatus, {
      paymentIntentId: cancelledTopup.paymentIntentId,
      status: "cancelled",
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(await t.mutation(expireCreditLots, { limit: 25 })).toEqual({ expired: 0 });

    const afterCancellation = await owner.query(getMerchantBilling, {});
    expect(afterCancellation?.balance.paidAvailable).toBe(5n);
    expect(afterCancellation?.topups).toEqual([
      expect.objectContaining({ _id: cancelledTopup.topupId, status: "cancelled" }),
      expect.objectContaining({ _id: settledTopup.topupId, status: "settled" }),
    ]);
    const topupShadowDecisions = await t.run(async (ctx) => {
      const decisions = await ctx.db
        .query("shadowBillingDecisions")
        .withIndex("by_payment_intent_id", (q) =>
          q.eq("paymentIntentId", cancelledTopup.paymentIntentId),
        )
        .take(10);
      return decisions;
    });
    expect(topupShadowDecisions).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});

test("sandbox enforcement reserves and consumes commercial trial credit", async () => {
  const t = convexTest(schema, modules);
  const { operator } = await configureOperatorAndOffer(t);
  const owner = asWallet(t, "GOWNER");
  const projectId = await createProject(owner, "sandbox-project");
  const organization = await owner.query(api.organizations.queries.getCurrent, {});
  if (!organization) throw new Error("Expected organization");

  await t.mutation(verifyOrganization, {
    organizationId: organization._id,
    evidenceType: "manual_review",
    evidenceReference: "sandbox-review",
    actor: "operator:test",
    reason: "Internal sandbox",
  });
  await operator.mutation(updatePolicy, {
    billingLedgerWrite: true,
    billingShadowMode: false,
    mainnetCreditEnforcement: false,
    billingTopupsEnabled: true,
    promoGrantEnabled: true,
    billingKillSwitch: false,
    actor: "operator:test",
  });
  await operator.mutation(setOrganizationPolicy, {
    organizationId: organization._id,
    enforcementEnabled: false,
    shadowEnabled: false,
    sandboxEnforcementEnabled: true,
    actor: "operator:test",
  });
  await t.mutation(grantPromotion, {
    organizationId: organization._id,
    book: "commercial",
    idempotencyKey: `promo:${organization._id}`,
    actor: "operator:test",
  });
  await owner.mutation(api.projects.mutation.markPaymentAccessActive, {
    id: projectId,
    checkoutCredits: 10,
  });
  const { rawKey } = await owner.mutation(api.projects.mutation.generateApiKey, {
    id: projectId,
    label: "Sandbox",
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey));
  const apiKeyHash = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  const created = await t.mutation(api.payment_intents.mutations.createPaymentIntent, {
    apiKeyHash,
    amount: "1",
    asset: "native",
  });
  let billing = await owner.query(getMerchantBilling, {});
  expect(billing?.balance.promoAvailable).toBe(99n);
  expect(billing?.balance.promoReserved).toBe(1n);

  await t.run(async (ctx) => {
    await ctx.db.patch(created.paymentIntentId, {
      status: "pending",
      payerAddress: "GPAYER",
      txHash: "b".repeat(64),
    });
  });
  await t.mutation(internal.payment_intents.mutations.markVerifiedPaid, {
    paymentIntentId: created.paymentIntentId,
    txHash: "b".repeat(64),
    verifiedNetwork: "testnet",
    verifiedPayment: {
      source: "GPAYER",
      destination: "GOWNER",
      amount: "1",
      asset: "native",
    },
  });
  billing = await owner.query(getMerchantBilling, {});
  expect(billing?.balance.promoReserved).toBe(0n);
  expect(billing?.balance.promoConsumed).toBe(1n);
});

test("the final active operator cannot remove their own wallet", async () => {
  const t = convexTest(schema, modules);
  const { operator } = await configureOperatorAndOffer(t);

  await expect(
    operator.mutation(setOperator, {
      walletAddress: "GOPERATOR",
      active: false,
    }),
  ).rejects.toThrow("final active operator");
});

test("mismatched treasury payments create durable exceptions and grant nothing", async () => {
  const t = convexTest(schema, modules);
  const { operator } = await configureOperatorAndOffer(t);
  const owner = asWallet(t, "GOWNER");
  await createProject(owner, "mismatch-project");
  await operator.mutation(updatePolicy, {
    billingLedgerWrite: true,
    billingShadowMode: false,
    mainnetCreditEnforcement: false,
    billingTopupsEnabled: true,
    promoGrantEnabled: true,
    billingKillSwitch: false,
    actor: "operator:test",
  });
  const created = await owner.mutation(createTopup, {});
  await t.run(async (ctx) => {
    await ctx.db.patch(created.paymentIntentId, { status: "pending" });
  });
  const result = await t.mutation(internal.payment_intents.mutations.markVerifiedPaid, {
    paymentIntentId: created.paymentIntentId,
    txHash: "c".repeat(64),
    verifiedNetwork: "testnet",
    verifiedPayment: {
      source: "GOWNER",
      destination: "GTREASURY",
      amount: "19",
      asset: "USDC:GISSUER",
    },
  });

  expect(result).toEqual(expect.objectContaining({ applied: false, exception: true }));
  const billing = await owner.query(getMerchantBilling, {});
  expect(billing?.balance.paidAvailable).toBe(0n);
  expect(billing?.topups[0]?.status).toBe("exception");
  const exceptions = await operator.query(listExceptions, { status: "open" });
  expect(exceptions).toEqual([
    expect.objectContaining({ exceptionType: "topup_mismatch", status: "open" }),
  ]);
});

test("reconciliation detects a seeded receipt discrepancy without changing balance", async () => {
  const t = convexTest(schema, modules);
  const { operator } = await configureOperatorAndOffer(t);
  const owner = asWallet(t, "GOWNER");
  await createProject(owner, "reconciliation-project");
  await operator.mutation(updatePolicy, {
    billingLedgerWrite: true,
    billingShadowMode: false,
    mainnetCreditEnforcement: false,
    billingTopupsEnabled: true,
    promoGrantEnabled: true,
    billingKillSwitch: false,
    actor: "operator:test",
  });
  const created = await owner.mutation(createTopup, {});
  await t.run(async (ctx) => {
    await ctx.db.patch(created.paymentIntentId, { status: "pending" });
  });
  await t.mutation(internal.payment_intents.mutations.markVerifiedPaid, {
    paymentIntentId: created.paymentIntentId,
    txHash: "d".repeat(64),
    verifiedNetwork: "testnet",
    verifiedPayment: {
      source: "GOWNER",
      destination: "GTREASURY",
      amount: "20",
      asset: "USDC:GISSUER",
    },
  });
  await t.run(async (ctx) => {
    const receipt = await ctx.db
      .query("treasuryReceipts")
      .withIndex("by_transaction_hash", (q) => q.eq("transactionHash", "d".repeat(64)))
      .unique();
    if (!receipt) throw new Error("Expected receipt");
    await ctx.db.delete(receipt._id);
  });

  expect(await t.mutation(runReconciliation, { limit: 25 })).toEqual({ discrepancies: 1 });
  const billing = await owner.query(getMerchantBilling, {});
  expect(billing?.balance.paidAvailable).toBe(100n);
  const exceptions = await operator.query(listExceptions, { status: "open" });
  expect(exceptions[0]).toEqual(
    expect.objectContaining({ exceptionType: "receipt_mismatch", status: "open" }),
  );
});

test("sandbox enforcement rejects overspending and releases failed reservations", async () => {
  const t = convexTest(schema, modules);
  const { operator } = await configureOperatorAndOffer(t);
  const owner = asWallet(t, "GOWNER");
  const projectId = await createProject(owner, "balance-gate-project");
  const organization = await owner.query(api.organizations.queries.getCurrent, {});
  if (!organization) throw new Error("Expected organization");
  await t.mutation(verifyOrganization, {
    organizationId: organization._id,
    evidenceType: "manual_review",
    evidenceReference: "balance-review",
    actor: "operator:test",
    reason: "Internal sandbox",
  });
  await operator.mutation(updatePolicy, {
    billingLedgerWrite: true,
    billingShadowMode: false,
    mainnetCreditEnforcement: false,
    billingTopupsEnabled: true,
    promoGrantEnabled: true,
    billingKillSwitch: false,
    promoCredits: 1n,
    actor: "operator:test",
  });
  await operator.mutation(setOrganizationPolicy, {
    organizationId: organization._id,
    enforcementEnabled: false,
    shadowEnabled: false,
    sandboxEnforcementEnabled: true,
    actor: "operator:test",
  });
  await t.mutation(grantPromotion, {
    organizationId: organization._id,
    book: "commercial",
    idempotencyKey: `promo:one:${organization._id}`,
    actor: "operator:test",
  });
  await owner.mutation(api.projects.mutation.markPaymentAccessActive, {
    id: projectId,
    checkoutCredits: 10,
  });
  const { rawKey } = await owner.mutation(api.projects.mutation.generateApiKey, {
    id: projectId,
    label: "Balance gate",
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey));
  const apiKeyHash = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const first = await t.mutation(api.payment_intents.mutations.createPaymentIntent, {
    apiKeyHash,
    amount: "1",
    asset: "native",
  });
  await expect(
    t.mutation(api.payment_intents.mutations.createPaymentIntent, {
      apiKeyHash,
      amount: "1",
      asset: "native",
    }),
  ).rejects.toThrow("INSUFFICIENT_BILLING_CREDITS");

  await t.mutation(api.payment_intents.mutations.updateStatus, {
    paymentIntentId: first.paymentIntentId,
    status: "failed",
  });
  const afterRelease = await owner.query(getMerchantBilling, {});
  expect(afterRelease?.balance.promoAvailable).toBe(1n);
  expect(afterRelease?.balance.promoReserved).toBe(0n);
  await expect(
    t.mutation(api.payment_intents.mutations.createPaymentIntent, {
      apiKeyHash,
      amount: "1",
      asset: "native",
    }),
  ).resolves.toEqual(expect.objectContaining({ paymentIntentId: expect.any(String) }));
});
