import { fetchRecentContractEvents } from "@repo/stellar/event-monitor";
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";

import { internal } from "../_generated/api";
import { payAccessContractIdFromEnv } from "../payAccessSync";
import schema from "../schema";

vi.mock("@repo/stellar/event-monitor", () => ({ fetchRecentContractEvents: vi.fn() }));

const modules = import.meta.glob("../**/*.ts");

const BACKEND_PAY_ACCESS_CONTRACT_ID = "CBHDLZYSYWETHPC6KDGH35S4SNBU5P7QWLNNDWYXJRHZMZDTQSKYVOXJ";
const PUBLIC_FALLBACK_CONTRACT_ID = "CBSR5LFHR5Q2X3PO3HSMGXI43YEUYGFTHUPGNVGW6XH2VNOQUEUHIEJR";

test("payAccessContractIdFromEnv prefers the backend contract ID", () => {
  expect(
    payAccessContractIdFromEnv({
      VELO_PAY_ACCESS_CONTRACT_ID: BACKEND_PAY_ACCESS_CONTRACT_ID,
      NEXT_PUBLIC_VELO_PAY_ACCESS_CONTRACT_ID: PUBLIC_FALLBACK_CONTRACT_ID,
    }),
  ).toBe(BACKEND_PAY_ACCESS_CONTRACT_ID);
});

test("payAccessContractIdFromEnv keeps the public fallback for local compatibility", () => {
  expect(
    payAccessContractIdFromEnv({
      NEXT_PUBLIC_VELO_PAY_ACCESS_CONTRACT_ID: PUBLIC_FALLBACK_CONTRACT_ID,
    }),
  ).toBe(PUBLIC_FALLBACK_CONTRACT_ID);
});

test("payAccessContractIdFromEnv rejects missing IDs instead of using a hardcoded fallback", () => {
  expect(() => payAccessContractIdFromEnv({})).toThrow(/VELO_PAY_ACCESS_CONTRACT_ID/);
});

test("PayAccess sync refuses to update duplicate Registry project mappings", async () => {
  const t = convexTest(schema, modules);
  const registryProjectId = 42;
  const projectIds = await t.run(async (ctx) => {
    const firstId = await ctx.db.insert("projects", {
      name: "First duplicate",
      slug: "first-duplicate",
      description: "Legacy duplicate mapping fixture",
      metadataJson: "{}",
      metadataHash: "0".repeat(64),
      ownerAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      status: "registered",
      registryProjectId,
      paymentAccessActive: false,
      checkoutCredits: 5,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const secondId = await ctx.db.insert("projects", {
      name: "Second duplicate",
      slug: "second-duplicate",
      description: "Legacy duplicate mapping fixture",
      metadataJson: "{}",
      metadataHash: "0".repeat(64),
      ownerAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      status: "registered",
      registryProjectId,
      paymentAccessActive: false,
      checkoutCredits: 7,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return [firstId, secondId] as const;
  });

  await expect(
    t.mutation(internal.payAccessSync.updateProjectAccess, {
      registryProjectId,
      paymentAccessActive: true,
      checkoutCredits: 100,
    }),
  ).resolves.toBe("ambiguous");

  const projects = await t.run(async (ctx) =>
    Promise.all(projectIds.map(async (id) => await ctx.db.get(id))),
  );
  expect(projects.map((project) => project?.paymentAccessActive)).toEqual([false, false]);
  expect(projects.map((project) => project?.checkoutCredits)).toEqual([5, 7]);
  expect(projects.every((project) => project?.paymentAccessLastSyncAt === undefined)).toBe(true);
});

test("ambiguous PayAccess mappings leave the event poller cursor unchanged for retry", async () => {
  const t = convexTest(schema, modules);
  const registryProjectId = 43;
  await t.run(async (ctx) => {
    for (const [index, slug] of ["cursor-duplicate-a", "cursor-duplicate-b"].entries()) {
      await ctx.db.insert("projects", {
        name: `Cursor duplicate ${index}`,
        slug,
        description: "Legacy duplicate mapping fixture",
        metadataJson: "{}",
        metadataHash: "0".repeat(64),
        ownerAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        status: "registered",
        registryProjectId,
        paymentAccessActive: false,
        checkoutCredits: 5 + index,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    await ctx.db.insert("pollerState", {
      scope: "global:pay_access",
      lastLedger: 100,
      lastRunAt: Date.now(),
      status: "idle",
      updatedAt: Date.now(),
    });
  });

  const event = {
    eventId: "pay-access-ambiguous-event",
    contractId: BACKEND_PAY_ACCESS_CONTRACT_ID,
    transactionHash: "a".repeat(64),
    ledger: 101,
    topic: "pay",
    topics: ["pay", "activate"],
    type: "contract",
    decoded: { project_id: String(registryProjectId), credits: "100" },
    raw: {},
  } as Awaited<ReturnType<typeof fetchRecentContractEvents>>["events"][number];
  vi.mocked(fetchRecentContractEvents).mockResolvedValue({
    events: [event],
    latestLedger: 101,
    cursor: "next-event-cursor",
  });
  vi.stubEnv("VELO_PAY_ACCESS_CONTRACT_ID", BACKEND_PAY_ACCESS_CONTRACT_ID);
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});

  try {
    await expect(t.action(internal.payAccessSync.syncPayAccessEvents, {})).resolves.toEqual({
      eventCount: 1,
      processedCount: 0,
      retryable: true,
      blockedReason: "ambiguous_project_mapping",
    });
    expect(warning).toHaveBeenCalledWith("pay_access_event_project_mapping_ambiguous");
    const pollerState = await t.run(async (ctx) =>
      ctx.db
        .query("pollerState")
        .withIndex("by_scope", (q) => q.eq("scope", "global:pay_access"))
        .unique(),
    );
    expect(pollerState?.lastLedger).toBe(100);
  } finally {
    warning.mockRestore();
    vi.unstubAllEnvs();
    vi.mocked(fetchRecentContractEvents).mockReset();
  }
});
