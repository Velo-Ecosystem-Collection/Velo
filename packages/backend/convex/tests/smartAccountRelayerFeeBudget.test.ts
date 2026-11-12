/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, test } from "vitest";

import { WALLET_AUTH_SERVICE_SUBJECT } from "../auth.constants";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");
const reserveBudget = makeFunctionReference<
  "mutation",
  { feeStroops: number; dailyLimitStroops: number },
  boolean
>("smart_account_auth/fee_budget:reserve");

function asService(t: ReturnType<typeof convexTest>) {
  return t.withIdentity({
    subject: WALLET_AUTH_SERVICE_SUBJECT,
    issuer: "http://localhost:3000",
    tokenIdentifier: `http://localhost:3000|${WALLET_AUTH_SERVICE_SUBJECT}`,
  });
}

test("smart-account relayer reservations enforce a shared UTC daily fee cap", async () => {
  const service = asService(convexTest(schema, modules));
  await expect(
    service.mutation(reserveBudget, { feeStroops: 50_000_000, dailyLimitStroops: 80_000_000 }),
  ).resolves.toBe(true);
  await expect(
    service.mutation(reserveBudget, { feeStroops: 30_000_000, dailyLimitStroops: 80_000_000 }),
  ).resolves.toBe(true);
  await expect(
    service.mutation(reserveBudget, { feeStroops: 1, dailyLimitStroops: 80_000_000 }),
  ).resolves.toBe(false);
});

test("smart-account relayer fee budgets reject untrusted callers and invalid bounds", async () => {
  const t = convexTest(schema, modules);
  const user = t.withIdentity({
    subject: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    issuer: "http://localhost:3000",
    tokenIdentifier: "http://localhost:3000|user",
  });
  await expect(
    user.mutation(reserveBudget, { feeStroops: 10, dailyLimitStroops: 100 }),
  ).rejects.toThrow("Unauthorized");

  const service = asService(t);
  await expect(
    service.mutation(reserveBudget, { feeStroops: 100_000_001, dailyLimitStroops: 200_000_000 }),
  ).rejects.toThrow("Invalid smart-account relayer fee reservation");
  await expect(
    service.mutation(reserveBudget, { feeStroops: 10, dailyLimitStroops: 1_000_000_001 }),
  ).rejects.toThrow("Invalid smart-account daily fee budget");
});
