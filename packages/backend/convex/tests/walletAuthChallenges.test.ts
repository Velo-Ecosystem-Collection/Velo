import { Keypair } from "@repo/stellar";
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, test } from "vitest";

import { WALLET_AUTH_SERVICE_SUBJECT } from "../auth.constants";
import schema from "../schema";
import { consumeWalletAuthChallenge, issueWalletAuthChallenge } from "../wallet_auth/references";

const modules = import.meta.glob("../**/*.ts");
const WALLET = Keypair.random().publicKey();
const OTHER_WALLET = Keypair.random().publicKey();
const getCurrentOrganization = makeFunctionReference<"query">("organizations/queries:getCurrent");
const CHALLENGE_ID = "A".repeat(43);
const TRANSACTION_HASH = "a".repeat(64);

function asService(t: ReturnType<typeof convexTest>) {
  return t.withIdentity({
    subject: WALLET_AUTH_SERVICE_SUBJECT,
    issuer: "http://localhost:3000",
    tokenIdentifier: `http://localhost:3000|${WALLET_AUTH_SERVICE_SUBJECT}`,
  });
}

test("wallet challenges bind address and hash, expire, and can only be consumed once", async () => {
  const t = convexTest(schema, modules);
  const service = asService(t);
  const expiresAt = Date.now() + 30_000;

  await service.mutation(issueWalletAuthChallenge, {
    challengeId: CHALLENGE_ID,
    address: WALLET,
    transactionHash: TRANSACTION_HASH,
    expiresAt,
  });

  expect(
    await service.mutation(consumeWalletAuthChallenge, {
      challengeId: CHALLENGE_ID,
      address: OTHER_WALLET,
      transactionHash: TRANSACTION_HASH,
    }),
  ).toBe(false);
  expect(
    await service.mutation(consumeWalletAuthChallenge, {
      challengeId: CHALLENGE_ID,
      address: WALLET,
      transactionHash: "b".repeat(64),
    }),
  ).toBe(false);
  expect(
    await service.mutation(consumeWalletAuthChallenge, {
      challengeId: CHALLENGE_ID,
      address: WALLET,
      transactionHash: TRANSACTION_HASH,
    }),
  ).toBe(true);
  expect(
    await service.mutation(consumeWalletAuthChallenge, {
      challengeId: CHALLENGE_ID,
      address: WALLET,
      transactionHash: TRANSACTION_HASH,
    }),
  ).toBe(false);
});

test("wallet challenge expiry and request validation are enforced", async () => {
  const t = convexTest(schema, modules);
  const service = asService(t);

  await expect(
    service.mutation(issueWalletAuthChallenge, {
      challengeId: CHALLENGE_ID,
      address: "G" + "A".repeat(55),
      transactionHash: TRANSACTION_HASH,
      expiresAt: Date.now() + 30_000,
    }),
  ).rejects.toThrow("Invalid Stellar public key");
  await expect(
    service.mutation(issueWalletAuthChallenge, {
      challengeId: CHALLENGE_ID,
      address: WALLET,
      transactionHash: "invalid",
      expiresAt: Date.now() + 30_000,
    }),
  ).rejects.toThrow("Invalid transaction hash");
  await expect(
    service.mutation(issueWalletAuthChallenge, {
      challengeId: CHALLENGE_ID,
      address: WALLET,
      transactionHash: TRANSACTION_HASH,
      expiresAt: Date.now() + 6 * 60_000,
    }),
  ).rejects.toThrow("Invalid challenge expiry");

  const expiredId = "B".repeat(43);
  await service.mutation(issueWalletAuthChallenge, {
    challengeId: expiredId,
    address: WALLET,
    transactionHash: TRANSACTION_HASH,
    expiresAt: Date.now() + 30_000,
  });
  await t.run(async (ctx) => {
    const challenge = await ctx.db
      .query("walletAuthChallenges")
      .withIndex("by_challenge_id", (q) => q.eq("challengeId", expiredId))
      .unique();
    if (!challenge) throw new Error("Test challenge not found");
    await ctx.db.patch(challenge._id, { expiresAt: Date.now() - 1 });
  });
  expect(
    await service.mutation(consumeWalletAuthChallenge, {
      challengeId: expiredId,
      address: WALLET,
      transactionHash: TRANSACTION_HASH,
    }),
  ).toBe(false);
});

test("only the wallet auth service can issue or consume challenges", async () => {
  const t = convexTest(schema, modules);
  const wallet = t.withIdentity({
    subject: WALLET,
    issuer: "http://localhost:3000",
    tokenIdentifier: `http://localhost:3000|${WALLET}`,
  });

  await expect(
    wallet.mutation(issueWalletAuthChallenge, {
      challengeId: CHALLENGE_ID,
      address: WALLET,
      transactionHash: TRANSACTION_HASH,
      expiresAt: Date.now() + 30_000,
    }),
  ).rejects.toThrow("Unauthorized");
});

test("wallet auth service identity cannot access normal authenticated queries", async () => {
  const t = convexTest(schema, modules);
  const service = asService(t);

  await expect(service.query(getCurrentOrganization, {})).rejects.toThrow("Not authenticated");
});
