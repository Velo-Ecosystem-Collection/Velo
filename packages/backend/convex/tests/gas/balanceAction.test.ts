/// <reference types="vite/client" />

import { Networks } from "@stellar/stellar-sdk";
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";

import type { DataModel, Id } from "../../_generated/dataModel";
import type { TestConvexForDataModelAndIdentity } from "convex-test";

import { api, internal } from "../../_generated/api";
import {
  RELAYER_BALANCE_REFRESH_COOLDOWN_MS,
  relayerBalanceRefreshScopeKey,
} from "../../gas/balance_internal";
import { GAS_NETWORK, GAS_RELAYER_STATUSES } from "../../gas/types";
import schema from "../../schema";

const modules = import.meta.glob("../../**/*.ts");
type TestContext = TestConvexForDataModelAndIdentity<DataModel>;

const ISSUER = "http://localhost:3000";
const OWNER = "GD7O2C226SF2677PFFUVD6O2ICFOBNCWPI5Z46N43ZSFQGLM65U3I2SP";
const EDITOR = "GBNHK3TLWWXBCEGNFHB45Z66R4AI5YUALKUFBP4WF7YK5JLZIAAG2DLI";
const VIEWER = "GDFWQCS3C72IWT5QV6CJYCMCQZ4WQ2QELSE6ABWI5Q3XRZ6BPGRS6LZV";
const OTHER_OWNER = "GCZCSOTTJVGJNVXKUUEPGZRWWEB4HOFCQLMZJX6VIP4C4ZURI4HVOIMA";
const RELAYER = "GAI7NKM2MASZ4OJH2LQNMXL4VEUVOWPVDNRVTB6XQRWYYRX3JD4KX4ZI";
const ROTATED_RELAYER = EDITOR;

function asWallet(t: TestContext, address: string) {
  return t.withIdentity({
    subject: address,
    issuer: ISSUER,
    tokenIdentifier: `${ISSUER}|${address}`,
  });
}

async function createProject(t: TestContext, ownerAddress = OWNER): Promise<Id<"projects">> {
  return await t.run(
    async (ctx) =>
      await ctx.db.insert("projects", {
        name: `Balance refresh ${ownerAddress.slice(1, 7)}`,
        slug: `balance-refresh-${ownerAddress.slice(1, 7).toLowerCase()}-${crypto.randomUUID()}`,
        description: "Balance refresh test project",
        metadataJson: "{}",
        metadataHash: "0".repeat(64),
        ownerAddress,
        ownerTokenIdentifier: `${ISSUER}|${ownerAddress}`,
        status: "draft",
        createdAt: Date.now(),
        updatedAt: Date.now(),
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
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
}

async function configureRelayer(
  t: TestContext,
  projectId: Id<"projects">,
  publicKey = RELAYER,
  status: "active" | "disabled" = "active",
  callerAddress = OWNER,
) {
  await asWallet(t, callerAddress).mutation(api.gas.mutations.updateRelayerAccount, {
    projectId,
    publicKey,
    status,
  });
  const relayer = await t.run(
    async (ctx) =>
      await ctx.db
        .query("relayerAccounts")
        .withIndex("by_project_id_and_network", (q) =>
          q.eq("projectId", projectId).eq("network", GAS_NETWORK),
        )
        .unique(),
  );
  if (!relayer) throw new Error("Missing configured relayer");
  return relayer;
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function networkResponse(): Response {
  return jsonResponse({ network_passphrase: Networks.TESTNET });
}

function accountResponse(address: string, balance: string): Response {
  return jsonResponse({
    account_id: address,
    balances: [{ asset_type: "native", balance }],
  });
}

async function withFetch<T>(
  responses: Array<Response | Error>,
  callback: (calls: string[]) => Promise<T>,
): Promise<T> {
  const previousFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
    calls.push(input.toString());
    const response = responses.shift();
    if (response === undefined) throw new Error("unexpected balance fetch");
    if (response instanceof Error) throw response;
    return response;
  }) as unknown as typeof fetch;
  try {
    return await callback(calls);
  } finally {
    globalThis.fetch = previousFetch;
  }
}

async function getStoredRelayer(t: TestContext, relayerId: Id<"relayerAccounts">) {
  return await t.run(async (ctx) => ctx.db.get("relayerAccounts", relayerId));
}

test("viewer, editor, and owner can refresh the configured active or disabled relayer", async () => {
  const t = convexTest(schema, modules);
  const projectId = await createProject(t);
  await addMembership(t, projectId, EDITOR, "editor");
  await addMembership(t, projectId, VIEWER, "viewer");
  const configured = await configureRelayer(t, projectId, RELAYER, "disabled");

  for (const caller of [asWallet(t, OWNER), asWallet(t, EDITOR), asWallet(t, VIEWER)]) {
    await t.run(async (ctx) => {
      const bucket = await ctx.db
        .query("rateLimitBuckets")
        .withIndex("by_scope_key", (q) =>
          q.eq("scopeKey", `${relayerBalanceRefreshScopeKey(projectId)}#0`),
        )
        .take(1);
      if (bucket[0]) {
        await ctx.db.patch(bucket[0]._id, {
          tokens: 1,
          updatedAt: Date.now() - RELAYER_BALANCE_REFRESH_COOLDOWN_MS - 1,
        });
      }
    });

    const result = await withFetch([networkResponse(), accountResponse(RELAYER, "0")], () =>
      caller.action(api.gas.balance_action.refreshRelayerBalance, { projectId }),
    );
    expect(result.status).toBe("success");
  }

  const stored = await getStoredRelayer(t, configured._id);
  expect(stored).toMatchObject({ publicKey: RELAYER });
});

test("persists exact balances including zero and exposes only the safe projection", async () => {
  const t = convexTest(schema, modules);
  const owner = asWallet(t, OWNER);
  const projectId = await createProject(t);
  const configured = await configureRelayer(t, projectId);

  const result = await withFetch([networkResponse(), accountResponse(RELAYER, "1.2345678")], () =>
    owner.action(api.gas.balance_action.refreshRelayerBalance, { projectId }),
  );
  expect(result).toMatchObject({
    status: "success",
    relayer: {
      publicKey: RELAYER,
      network: GAS_NETWORK,
      status: GAS_RELAYER_STATUSES.active,
      balanceStroops: "12345678",
    },
  });
  if (result.status !== "success") throw new Error("Expected a successful refresh");
  expect(Object.keys(result.relayer).sort()).toEqual([
    "balanceStroops",
    "balanceUpdatedAt",
    "createdAt",
    "network",
    "publicKey",
    "status",
    "updatedAt",
  ]);
  expect(result.relayer).not.toHaveProperty("refreshToken");

  await t.run(async (ctx) => {
    await ctx.db.patch(configured._id, {
      balanceStroops: 99n,
      balanceUpdatedAt: Date.now() - 10_000,
    });
    const bucket = await ctx.db
      .query("rateLimitBuckets")
      .withIndex("by_scope_key", (q) =>
        q.eq("scopeKey", `${relayerBalanceRefreshScopeKey(projectId)}#0`),
      )
      .unique();
    if (!bucket) throw new Error("Missing refresh bucket");
    await ctx.db.patch(bucket._id, {
      tokens: 1,
      updatedAt: Date.now() - RELAYER_BALANCE_REFRESH_COOLDOWN_MS - 1,
    });
  });
  const zero = await withFetch([networkResponse(), accountResponse(RELAYER, "0")], () =>
    owner.action(api.gas.balance_action.refreshRelayerBalance, { projectId }),
  );
  expect(zero).toMatchObject({ status: "success", relayer: { balanceStroops: "0" } });
});

test("failed provider reads and account-not-found preserve the last verified snapshot", async () => {
  for (const secondResponse of [
    new Response(null, { status: 404 }),
    new Response(null, { status: 503 }),
  ]) {
    const t = convexTest(schema, modules);
    const owner = asWallet(t, OWNER);
    const projectId = await createProject(t);
    const configured = await configureRelayer(t, projectId);
    const oldTimestamp = Date.now() - 60_000;
    await t.run(async (ctx) => {
      await ctx.db.patch(configured._id, {
        balanceStroops: 77n,
        balanceUpdatedAt: oldTimestamp,
      });
    });

    const result = await withFetch([networkResponse(), secondResponse], () =>
      owner.action(api.gas.balance_action.refreshRelayerBalance, { projectId }),
    );
    expect(result).toMatchObject({
      status: secondResponse.status === 404 ? "account_not_found" : "reader_failure",
      relayer: { balanceStroops: "77", balanceUpdatedAt: oldTimestamp },
    });
    const stored = await getStoredRelayer(t, configured._id);
    expect(stored).toMatchObject({ balanceStroops: 77n, balanceUpdatedAt: oldTimestamp });
    expect(stored?.refreshToken).toBeUndefined();
    expect(stored?.refreshStartedAt).toBeUndefined();
  }
});

test("authorization and extra arguments are rejected before any provider request", async () => {
  const t = convexTest(schema, modules);
  const projectId = await createProject(t);
  await configureRelayer(t, projectId);
  const otherProjectId = await createProject(t, OTHER_OWNER);
  await configureRelayer(t, otherProjectId, ROTATED_RELAYER, "active", OTHER_OWNER);
  const calls: string[] = [];

  const attempt = async (work: () => Promise<unknown>) => {
    await expect(work()).rejects.toThrow();
  };

  await withFetch([], async (fetchCalls) => {
    calls.push(...fetchCalls);
    await attempt(() => t.action(api.gas.balance_action.refreshRelayerBalance, { projectId }));
    await attempt(() =>
      asWallet(t, EDITOR).action(api.gas.balance_action.refreshRelayerBalance, { projectId }),
    );
    await attempt(() =>
      asWallet(t, OWNER).action(api.gas.balance_action.refreshRelayerBalance, {
        projectId: otherProjectId,
      }),
    );
    await attempt(() =>
      asWallet(t, OWNER).action(api.gas.balance_action.refreshRelayerBalance, {
        projectId,
        publicKey: RELAYER,
      } as never),
    );
    expect(fetchCalls).toHaveLength(0);
  });
  expect(calls).toHaveLength(0);
});

test("the project cooldown is shared across members and expires without a new bucket", async () => {
  const t = convexTest(schema, modules);
  const owner = asWallet(t, OWNER);
  const editor = asWallet(t, EDITOR);
  const projectId = await createProject(t);
  await addMembership(t, projectId, EDITOR, "editor");
  await configureRelayer(t, projectId);

  await withFetch([networkResponse(), accountResponse(RELAYER, "1")], () =>
    owner.action(api.gas.balance_action.refreshRelayerBalance, { projectId }),
  );
  const cooldown = await withFetch([], (calls) =>
    editor.action(api.gas.balance_action.refreshRelayerBalance, { projectId }).then((result) => {
      expect(result).toMatchObject({ status: "cooldown", retryAfterMs: expect.any(Number) });
      expect(calls).toHaveLength(0);
      return result;
    }),
  );
  expect(cooldown.status).toBe("cooldown");

  await t.run(async (ctx) => {
    const bucket = await ctx.db
      .query("rateLimitBuckets")
      .withIndex("by_scope_key", (q) =>
        q.eq("scopeKey", `${relayerBalanceRefreshScopeKey(projectId)}#0`),
      )
      .unique();
    if (!bucket) throw new Error("Missing refresh bucket");
    await ctx.db.patch(bucket._id, {
      updatedAt: Date.now() - RELAYER_BALANCE_REFRESH_COOLDOWN_MS - 1,
    });
  });

  await expect(
    withFetch([networkResponse(), accountResponse(RELAYER, "2")], () =>
      editor.action(api.gas.balance_action.refreshRelayerBalance, { projectId }),
    ),
  ).resolves.toMatchObject({ status: "success", relayer: { balanceStroops: "20000000" } });
});

test("concurrent claims serialize to one claim and one cooldown", async () => {
  const t = convexTest(schema, modules);
  const owner = asWallet(t, OWNER);
  const projectId = await createProject(t);
  await configureRelayer(t, projectId);

  const [first, second] = await Promise.all([
    owner.mutation(internal.gas.balance_internal.claim, { projectId }),
    owner.mutation(internal.gas.balance_internal.claim, { projectId }),
  ]);
  expect([first.status, second.status].sort()).toEqual(["claimed", "cooldown"]);
  const bucket = await t.run(
    async (ctx) =>
      await ctx.db
        .query("rateLimitBuckets")
        .withIndex("by_scope_key", (q) =>
          q.eq("scopeKey", `${relayerBalanceRefreshScopeKey(projectId)}#0`),
        )
        .unique(),
  );
  // The second mutation may run a few milliseconds later and legitimately
  // retain a fractional refill, but it must remain below one token.
  expect(bucket?.tokens).toBeGreaterThanOrEqual(0);
  expect(bucket?.tokens).toBeLessThan(1);
});

test("expired and duplicate completions are stale, while a later claim fences an older result", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_757_000_000_000);
  try {
    const t = convexTest(schema, modules);
    const owner = asWallet(t, OWNER);
    const projectId = await createProject(t);
    const relayer = await configureRelayer(t, projectId);

    const firstClaim = await owner.mutation(internal.gas.balance_internal.claim, { projectId });
    if (firstClaim.status !== "claimed") throw new Error("Expected first refresh claim");
    vi.setSystemTime(1_757_000_000_000 + RELAYER_BALANCE_REFRESH_COOLDOWN_MS);
    const expired = await owner.mutation(internal.gas.balance_internal.complete, {
      projectId,
      relayerId: firstClaim.relayerId,
      publicKey: firstClaim.publicKey,
      network: firstClaim.network,
      relayerStatus: firstClaim.relayerStatus,
      refreshToken: firstClaim.refreshToken,
      refreshStartedAt: firstClaim.refreshStartedAt,
      authorization: firstClaim.authorization,
      observation: { status: "success", address: RELAYER, balanceStroops: "1" },
    });
    expect(expired).toEqual({ status: "stale_refresh" });
    expect(
      await owner.mutation(internal.gas.balance_internal.complete, {
        projectId,
        relayerId: firstClaim.relayerId,
        publicKey: firstClaim.publicKey,
        network: firstClaim.network,
        relayerStatus: firstClaim.relayerStatus,
        refreshToken: firstClaim.refreshToken,
        refreshStartedAt: firstClaim.refreshStartedAt,
        authorization: firstClaim.authorization,
        observation: { status: "success", address: RELAYER, balanceStroops: "9" },
      }),
    ).toEqual({ status: "stale_refresh" });

    const secondClaim = await owner.mutation(internal.gas.balance_internal.claim, { projectId });
    if (secondClaim.status !== "claimed") throw new Error("Expected second refresh claim");

    expect(
      await owner.mutation(internal.gas.balance_internal.complete, {
        projectId,
        relayerId: firstClaim.relayerId,
        publicKey: firstClaim.publicKey,
        network: firstClaim.network,
        relayerStatus: firstClaim.relayerStatus,
        refreshToken: firstClaim.refreshToken,
        refreshStartedAt: firstClaim.refreshStartedAt,
        authorization: firstClaim.authorization,
        observation: { status: "success", address: RELAYER, balanceStroops: "1" },
      }),
    ).toEqual({ status: "stale_refresh" });
    expect(
      await owner.mutation(internal.gas.balance_internal.complete, {
        projectId,
        relayerId: secondClaim.relayerId,
        publicKey: secondClaim.publicKey,
        network: secondClaim.network,
        relayerStatus: secondClaim.relayerStatus,
        refreshToken: secondClaim.refreshToken,
        refreshStartedAt: secondClaim.refreshStartedAt,
        authorization: secondClaim.authorization,
        observation: { status: "success", address: RELAYER, balanceStroops: "2" },
      }),
    ).toMatchObject({ status: "success", relayer: { balanceStroops: "2" } });
    expect(await getStoredRelayer(t, relayer._id)).toMatchObject({ balanceStroops: 2n });
  } finally {
    vi.useRealTimers();
  }
});

test("status changes invalidate pending claims but preserve history, while key rotation clears history", async () => {
  const t = convexTest(schema, modules);
  const owner = asWallet(t, OWNER);
  const projectId = await createProject(t);
  const relayer = await configureRelayer(t, projectId);
  await t.run(async (ctx) => {
    await ctx.db.patch(relayer._id, {
      balanceStroops: 8n,
      balanceUpdatedAt: Date.now() - 5_000,
    });
  });

  const claim = await owner.mutation(internal.gas.balance_internal.claim, { projectId });
  if (claim.status !== "claimed") throw new Error("Expected refresh claim");
  await configureRelayer(t, projectId, RELAYER, "disabled");
  const disabled = await getStoredRelayer(t, relayer._id);
  expect(disabled).toMatchObject({
    status: "disabled",
    balanceStroops: 8n,
  });
  expect(disabled?.balanceUpdatedAt).toBeDefined();
  expect(disabled?.refreshToken).toBeUndefined();
  expect(disabled?.refreshStartedAt).toBeUndefined();

  await configureRelayer(t, projectId, ROTATED_RELAYER, "active");
  const rotated = await getStoredRelayer(t, relayer._id);
  expect(rotated).toMatchObject({
    publicKey: ROTATED_RELAYER,
    status: "active",
  });
  expect(rotated?.balanceStroops).toBeUndefined();
  expect(rotated?.balanceUpdatedAt).toBeUndefined();
});

test("rotation, status changes, deletion, role changes, and access revocation fence a blocked refresh", async () => {
  const cases: Array<"rotation" | "status" | "delete" | "role" | "revoke"> = [
    "rotation",
    "status",
    "delete",
    "role",
    "revoke",
  ];

  for (const change of cases) {
    const t = convexTest(schema, modules);
    const editor = asWallet(t, EDITOR);
    const projectId = await createProject(t);
    await addMembership(t, projectId, EDITOR, "editor");
    const configured = await configureRelayer(t, projectId);
    let resolveAccount!: (response: Response) => void;
    let accountRequested!: () => void;
    const requested = new Promise<void>((resolve) => {
      accountRequested = resolve;
    });
    const accountPending = new Promise<Response>((resolve) => (resolveAccount = resolve));
    const previousFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      calls.push(input.toString());
      if (calls.length === 1) return networkResponse();
      accountRequested();
      return await accountPending;
    }) as unknown as typeof fetch;
    const pending = editor.action(api.gas.balance_action.refreshRelayerBalance, { projectId });
    await requested;

    if (change === "rotation") {
      await configureRelayer(t, projectId, ROTATED_RELAYER);
      await configureRelayer(t, projectId, RELAYER);
    } else if (change === "status") {
      await configureRelayer(t, projectId, RELAYER, "disabled");
    } else if (change === "delete") {
      await t.run(async (ctx) => ctx.db.delete(configured._id));
    } else {
      await t.run(async (ctx) => {
        const membership = await ctx.db
          .query("projectMemberships")
          .withIndex("by_project_and_wallet_address", (q) =>
            q.eq("projectId", projectId).eq("walletAddress", EDITOR),
          )
          .unique();
        if (!membership) throw new Error("Missing editor membership");
        if (change === "role") await ctx.db.patch(membership._id, { role: "viewer" });
        else await ctx.db.delete(membership._id);
      });
    }

    resolveAccount(accountResponse(RELAYER, "3"));
    try {
      await expect(pending).resolves.toEqual({ status: "stale_refresh" });
    } finally {
      globalThis.fetch = previousFetch;
    }
    const stored = await t.run(async (ctx) =>
      ctx.db
        .query("relayerAccounts")
        .withIndex("by_project_id_and_network", (q) =>
          q.eq("projectId", projectId).eq("network", GAS_NETWORK),
        )
        .take(2),
    );
    if (change === "delete") expect(stored).toHaveLength(0);
    else expect(stored[0]?.balanceStroops).toBeUndefined();
    expect(accountRequested).toBeDefined();
    expect(calls).toHaveLength(2);
  }
});

test("ambiguous relayer records fail closed before the reader and malformed completions cannot write", async () => {
  const t = convexTest(schema, modules);
  const owner = asWallet(t, OWNER);
  const projectId = await createProject(t);
  await t.run(async (ctx) => {
    for (const publicKey of [RELAYER, ROTATED_RELAYER]) {
      await ctx.db.insert("relayerAccounts", {
        projectId,
        publicKey,
        network: GAS_NETWORK,
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
  });

  await withFetch([], async (calls) => {
    await expect(
      owner.action(api.gas.balance_action.refreshRelayerBalance, { projectId }),
    ).rejects.toThrow("Multiple Gas relayers exist for project");
    expect(calls).toHaveLength(0);
  });

  const persistence = convexTest(schema, modules);
  const persistenceOwner = asWallet(persistence, OWNER);
  const persistenceProjectId = await createProject(persistence);
  const persistenceRelayer = await configureRelayer(persistence, persistenceProjectId);
  await persistence.run(async (ctx) => {
    await ctx.db.patch(persistenceRelayer._id, {
      balanceStroops: 77n,
      balanceUpdatedAt: 123,
    });
  });
  const claim = await persistenceOwner.mutation(internal.gas.balance_internal.claim, {
    projectId: persistenceProjectId,
  });
  if (claim.status !== "claimed") throw new Error("Expected persistence claim");
  const malformed = await persistenceOwner.mutation(internal.gas.balance_internal.complete, {
    projectId: persistenceProjectId,
    relayerId: claim.relayerId,
    publicKey: claim.publicKey,
    network: claim.network,
    relayerStatus: claim.relayerStatus,
    refreshToken: claim.refreshToken,
    refreshStartedAt: claim.refreshStartedAt,
    authorization: claim.authorization,
    observation: { status: "success", address: RELAYER, balanceStroops: "01" },
  });
  expect(malformed).toMatchObject({
    status: "reader_failure",
    reason: "malformed_response",
    relayer: { balanceStroops: "77", balanceUpdatedAt: 123 },
  });
  await expect(
    persistenceOwner.mutation(internal.gas.balance_internal.complete, {
      projectId: persistenceProjectId,
      relayerId: claim.relayerId,
      publicKey: claim.publicKey,
      network: claim.network,
      relayerStatus: claim.relayerStatus,
      refreshToken: claim.refreshToken,
      refreshStartedAt: claim.refreshStartedAt,
      authorization: claim.authorization,
      observation: { status: "success", address: RELAYER, balanceStroops: "2" },
    }),
  ).resolves.toEqual({ status: "stale_refresh" });
});
