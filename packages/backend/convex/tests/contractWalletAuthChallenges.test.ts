/// <reference types="vite/client" />
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, test } from "vitest";

import { WALLET_AUTH_SERVICE_SUBJECT } from "../auth.constants";
import schema from "../schema";
import {
  consumeContractAccountAuthChallenge,
  issueContractAccountAuthChallenge,
} from "../wallet_auth/references";

const modules = import.meta.glob("../**/*.ts");
const ACCOUNT = StrKey.encodeContract(Keypair.random().rawPublicKey());
const OTHER_ACCOUNT = StrKey.encodeContract(Keypair.random().rawPublicKey());
const challengeId = "C".repeat(43);
const nonce = "n".repeat(43);
const challengeHash = "a".repeat(64);
const getCurrentOrganization = makeFunctionReference<"query">("organizations/queries:getCurrent");

function asService(t: ReturnType<typeof convexTest>) {
  return t.withIdentity({
    subject: WALLET_AUTH_SERVICE_SUBJECT,
    issuer: "http://localhost:3000",
    tokenIdentifier: `http://localhost:3000|${WALLET_AUTH_SERVICE_SUBJECT}`,
  });
}

test("contract account challenges bind address, nonce and hash and are consumed once", async () => {
  const service = asService(convexTest(schema, modules));

  await service.mutation(issueContractAccountAuthChallenge, {
    challengeId,
    address: ACCOUNT,
    nonce,
    challengeHash,
    expiresAt: Date.now() + 30_000,
  });

  expect(
    await service.mutation(consumeContractAccountAuthChallenge, {
      address: OTHER_ACCOUNT,
      nonce,
      challengeHash,
    }),
  ).toBe(false);
  expect(
    await service.mutation(consumeContractAccountAuthChallenge, {
      address: ACCOUNT,
      nonce: "x".repeat(43),
      challengeHash,
    }),
  ).toBe(false);
  expect(
    await service.mutation(consumeContractAccountAuthChallenge, {
      address: ACCOUNT,
      nonce,
      challengeHash: "b".repeat(64),
    }),
  ).toBe(false);
  expect(
    await service.mutation(consumeContractAccountAuthChallenge, {
      address: ACCOUNT,
      nonce,
      challengeHash,
    }),
  ).toBe(true);
  expect(
    await service.mutation(consumeContractAccountAuthChallenge, {
      address: ACCOUNT,
      nonce,
      challengeHash,
    }),
  ).toBe(false);
});

test("contract account challenges reject invalid addresses and expired records", async () => {
  const t = convexTest(schema, modules);
  const service = asService(t);
  await expect(
    service.mutation(issueContractAccountAuthChallenge, {
      challengeId,
      address: "C" + "A".repeat(55),
      nonce,
      challengeHash,
      expiresAt: Date.now() + 30_000,
    }),
  ).rejects.toThrow("Invalid Stellar account address");

  const expiredId = "D".repeat(43);
  await service.mutation(issueContractAccountAuthChallenge, {
    challengeId: expiredId,
    address: ACCOUNT,
    nonce,
    challengeHash,
    expiresAt: Date.now() + 30_000,
  });
  await t.run(async (ctx) => {
    const challenge = await ctx.db
      .query("contractAccountAuthChallenges")
      .withIndex("by_challenge_id", (q) => q.eq("challengeId", expiredId))
      .unique();
    if (!challenge) throw new Error("Test challenge not found");
    await ctx.db.patch(challenge._id, { expiresAt: Date.now() - 1 });
  });

  expect(
    await service.mutation(consumeContractAccountAuthChallenge, {
      address: ACCOUNT,
      nonce,
      challengeHash,
    }),
  ).toBe(false);
});

test("only the wallet auth service can consume contract account challenges", async () => {
  const t = convexTest(schema, modules);
  const identity = t.withIdentity({
    subject: ACCOUNT,
    issuer: "http://localhost:3000",
    tokenIdentifier: `http://localhost:3000|${ACCOUNT}`,
  });

  await expect(identity.query(getCurrentOrganization, {})).resolves.toBeNull();
  await expect(
    identity.mutation(issueContractAccountAuthChallenge, {
      challengeId,
      address: ACCOUNT,
      nonce,
      challengeHash,
      expiresAt: Date.now() + 30_000,
    }),
  ).rejects.toThrow("Unauthorized");
});
