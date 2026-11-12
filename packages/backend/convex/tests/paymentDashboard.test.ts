/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";

import { api } from "../_generated/api";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

const OWNER = "GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR";
const OTHER_OWNER = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

function asWallet(t: ReturnType<typeof convexTest>, address: string) {
  return t.withIdentity({
    subject: address,
    issuer: "http://localhost:3000",
    tokenIdentifier: `http://localhost:3000|${address}`,
  });
}

async function createProject(
  t: ReturnType<typeof convexTest>,
  options: { active?: boolean; defaultAnchor?: "inhouse"; slug: string },
) {
  const owner = asWallet(t, OWNER);
  const projectId = await owner.mutation(api.projects.mutation.createDraft, {
    name: `Dashboard Merchant ${options.slug}`,
    slug: options.slug,
    description: "Merchant payment operations",
    metadataJson: "{}",
    metadataHash: "0".repeat(64),
    ownerAddress: OWNER,
    defaultPaymentAnchor: options.defaultAnchor,
  });
  if (options.active !== false) {
    await owner.mutation(api.projects.mutation.markPaymentAccessActive, {
      id: projectId,
      checkoutCredits: 100,
    });
  }
  return { owner, projectId };
}

test("owner dashboard creation is idempotent and validates project access", async () => {
  const t = convexTest(schema, modules);
  const { owner, projectId } = await createProject(t, { slug: "dashboard-create" });

  const first = await owner.mutation(api.payment_intents.mutations.createFromDashboard, {
    projectId,
    requestId: "create-1",
    amount: "12.50",
    asset: "native",
    description: "Invoice 1001",
  });
  const replay = await owner.mutation(api.payment_intents.mutations.createFromDashboard, {
    projectId,
    requestId: "create-1",
    amount: "12.50",
    asset: "native",
    description: "Invoice 1001",
  });

  expect(first.status).toBe("success");
  expect(replay.status).toBe("idempotency_replay");
  expect(replay.intent._id).toBe(first.intent._id);
  expect(first.intent.anchor).toBe("inhouse");
  expect(first.intent.expiresAt - first.intent.createdAt).toBe(30 * 60 * 1000);

  await expect(
    asWallet(t, OTHER_OWNER).mutation(api.payment_intents.mutations.createFromDashboard, {
      projectId,
      requestId: "not-owner",
      amount: "1",
      asset: "native",
    }),
  ).rejects.toThrow("Unauthorized");

  const inactive = await createProject(t, { active: false, slug: "dashboard-inactive" });
  await expect(
    inactive.owner.mutation(api.payment_intents.mutations.createFromDashboard, {
      projectId: inactive.projectId,
      requestId: "inactive",
      amount: "1",
      asset: "native",
    }),
  ).rejects.toThrow("Payment access is not activated");
});

test("owner dashboard list paginates, filters, and finds exact identifiers", async () => {
  const t = convexTest(schema, modules);
  const { owner, projectId } = await createProject(t, { slug: "dashboard-list" });

  const created = [];
  for (const [index, amount] of ["1", "2", "3"].entries()) {
    created.push(
      await owner.mutation(api.payment_intents.mutations.createFromDashboard, {
        projectId,
        requestId: `list-${index}`,
        amount,
        asset: "native",
      }),
    );
  }

  await t.mutation(api.payment_intents.mutations.updateStatus, {
    paymentIntentId: created[0].intent._id,
    status: "pending",
    payerAddress: OTHER_OWNER,
    txHash: "a".repeat(64),
  });

  const firstPage = await owner.query(api.payment_intents.queries.listOwnerPage, {
    projectId,
    paginationOpts: { numItems: 2, cursor: null },
  });
  expect(firstPage.page).toHaveLength(2);
  expect(firstPage.isDone).toBe(false);

  const pendingPage = await owner.query(api.payment_intents.queries.listOwnerPage, {
    projectId,
    status: "pending",
    paginationOpts: { numItems: 20, cursor: null },
  });
  expect(pendingPage.page).toHaveLength(1);
  expect(pendingPage.page[0]._id).toBe(created[0].intent._id);

  const byId = await owner.query(api.payment_intents.queries.findOwnerIntent, {
    projectId,
    term: created[1].intent._id,
  });
  const byHash = await owner.query(api.payment_intents.queries.findOwnerIntent, {
    projectId,
    term: "A".repeat(64),
  });
  expect(byId?._id).toBe(created[1].intent._id);
  expect(byHash?._id).toBe(created[0].intent._id);

  await expect(
    asWallet(t, OTHER_OWNER).query(api.payment_intents.queries.listOwnerPage, {
      projectId,
      paginationOpts: { numItems: 20, cursor: null },
    }),
  ).rejects.toThrow("Unauthorized");
});

test("dashboard creation rejects a legacy PDAX default until the owner switches to in-house", async () => {
  const t = convexTest(schema, modules);
  const { owner, projectId } = await createProject(t, { slug: "dashboard-pdax" });
  await t.run(async (ctx) => {
    await ctx.db.patch(projectId, { defaultPaymentAnchor: "pdax" });
  });

  await expect(
    owner.mutation(api.payment_intents.mutations.createFromDashboard, {
      projectId,
      requestId: "pdax-disconnected",
      amount: "5",
      asset: "USDC",
    }),
  ).rejects.toThrow(/PDAX payment routing is no longer available/);

  await owner.mutation(api.projects.mutation.updateSettings, {
    id: projectId,
    name: "Dashboard Merchant dashboard-pdax",
    description: "Switched to in-house",
    defaultPaymentAnchor: "inhouse",
  });
  const result = await owner.mutation(api.payment_intents.mutations.createFromDashboard, {
    projectId,
    requestId: "inhouse-after-switch",
    amount: "5",
    asset: "USDC",
  });
  expect(result.intent.anchor).toBe("inhouse");
  expect(result.intent.status).toBe("created");
});
