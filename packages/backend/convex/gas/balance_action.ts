"use node";

import { Asset, Horizon, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import type { RelayerBalanceRefreshResult } from "./balance_internal";

import { internal } from "../_generated/api";
import { action, env } from "../_generated/server";
import { readTestnetNativeBalance } from "./balance";
import { relayerBalanceRefreshResultValidator } from "./balance_internal";
import {
  buildOwnerFundingTransaction,
  GAS_FUNDING_INTENT_TTL_MS,
  GAS_FUNDING_MAX_XDR_BYTES,
  GAS_WITHDRAWAL_CONSENT_TTL_MS,
  GAS_WITHDRAWAL_FEE_STROOPS,
  GasFundingTransactionError,
  calculateGasSpendableBalance,
  buildOwnerWithdrawalConsent,
  digestGasWithdrawalConsent,
  validateOwnerFundingTransaction,
  validateManagedWithdrawalTransaction,
  validateOwnerWithdrawalConsent,
} from "./funding_utils";
import { RelayerCustodyError, withManagedTestnetRelayerSigner } from "./relayer";

const GAS_TESTNET_HORIZON_URL = "https://horizon-testnet.stellar.org";
const GAS_TESTNET_FRIENDBOT_URL = "https://friendbot.stellar.org/";
const custodyEnv = env as typeof env & {
  readonly VELO_GAS_CUSTODY_DEPLOYMENT_ID: string | undefined;
};
const fundingOperationValidator = v.union(v.literal("create_account"), v.literal("payment"));

function responseStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("response" in error)) return null;
  const response = error.response;
  if (typeof response !== "object" || response === null || !("status" in response)) return null;
  return typeof response.status === "number" ? response.status : null;
}

function isAuthorizationError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /not authenticated|unauthorized|owner access required/i.test(error.message)
  );
}

async function loadTestnetAccount(
  server: Horizon.Server,
  publicKey: string,
): Promise<Awaited<ReturnType<Horizon.Server["loadAccount"]>> | null> {
  try {
    return await server.loadAccount(publicKey);
  } catch (error) {
    if (responseStatus(error) === 404) return null;
    throw error;
  }
}

async function isTestnetHorizonConfigured(): Promise<boolean> {
  try {
    const response = await fetch(GAS_TESTNET_HORIZON_URL, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return false;
    const payload: unknown = await response.json();
    return (
      typeof payload === "object" &&
      payload !== null &&
      "network_passphrase" in payload &&
      payload.network_passphrase === Networks.TESTNET
    );
  } catch {
    return false;
  }
}

const fundingPrepareResultValidator = v.union(
  v.object({ status: v.literal("unauthorized") }),
  v.object({ status: v.literal("invalid_amount") }),
  v.object({ status: v.literal("source_account_not_found") }),
  v.object({ status: v.literal("missing_relayer") }),
  v.object({ status: v.literal("relayer_disabled") }),
  v.object({ status: v.literal("dependency_unavailable") }),
  v.object({
    status: v.literal("prepared"),
    requestId: v.string(),
    operation: fundingOperationValidator,
    amountStroops: v.string(),
    destinationPublicKey: v.string(),
    expiresAt: v.number(),
    transactionXdr: v.string(),
  }),
);

type FundingPrepareResult =
  | { status: "unauthorized" }
  | { status: "invalid_amount" }
  | { status: "source_account_not_found" }
  | { status: "missing_relayer" }
  | { status: "relayer_disabled" }
  | { status: "dependency_unavailable" }
  | {
      status: "prepared";
      requestId: string;
      operation: "create_account" | "payment";
      amountStroops: string;
      destinationPublicKey: string;
      expiresAt: number;
      transactionXdr: string;
    };

export const prepareRelayerFunding = action({
  args: { projectId: v.id("projects"), amountStroops: v.string() },
  returns: fundingPrepareResultValidator,
  handler: async (ctx, args): Promise<FundingPrepareResult> => {
    if ((await ctx.auth.getUserIdentity()) === null) return { status: "unauthorized" as const };
    let claim;
    try {
      claim = await ctx.runMutation(internal.gas.balance_internal.prepareFunding, args);
    } catch (error) {
      return {
        status: isAuthorizationError(error) ? "unauthorized" : "dependency_unavailable",
      } as const;
    }
    if (claim.status === "amount_invalid") return { status: "invalid_amount" };
    if (claim.status !== "ready") return claim;
    if (!(await isTestnetHorizonConfigured())) return { status: "dependency_unavailable" };

    try {
      const server = new Horizon.Server(GAS_TESTNET_HORIZON_URL);
      const sourceAccount = await loadTestnetAccount(server, claim.sourceWallet);
      if (!sourceAccount) return { status: "source_account_not_found" as const };
      const destinationAccount = await loadTestnetAccount(server, claim.publicKey);
      const built = buildOwnerFundingTransaction({
        sourceAccount,
        sourceWallet: claim.sourceWallet,
        destinationPublicKey: claim.publicKey,
        amountStroops: BigInt(claim.amountStroops),
        destinationExists: destinationAccount !== null,
      });
      const now = Date.now();
      const requestId = globalThis.crypto.randomUUID();
      const expiresAt = now + GAS_FUNDING_INTENT_TTL_MS;
      await ctx.runMutation(internal.gas.balance_internal.storeFundingIntent, {
        projectId: args.projectId,
        requestId,
        operation: built.operation,
        sourceWallet: claim.sourceWallet,
        destinationPublicKey: claim.publicKey,
        relayerId: claim.relayerId,
        amountStroops: claim.amountStroops,
        feeStroops: built.feeStroops,
        preparedTransactionHash: built.transactionHash,
        expiresAt,
      });
      return {
        status: "prepared" as const,
        requestId,
        operation: built.operation,
        amountStroops: claim.amountStroops,
        destinationPublicKey: claim.publicKey,
        expiresAt,
        transactionXdr: built.transactionXdr,
      };
    } catch (error) {
      if (error instanceof GasFundingTransactionError) return { status: "invalid_amount" as const };
      return {
        status: isAuthorizationError(error) ? "unauthorized" : "dependency_unavailable",
      } as const;
    }
  },
});

const fundingSubmitResultValidator = v.union(
  v.object({ status: v.literal("unauthorized") }),
  v.object({ status: v.literal("invalid_request") }),
  v.object({ status: v.literal("invalid_signature") }),
  v.object({ status: v.literal("intent_mismatch") }),
  v.object({ status: v.literal("not_found") }),
  v.object({ status: v.literal("expired") }),
  v.object({ status: v.literal("not_submittable") }),
  v.object({ status: v.literal("relayer_changed") }),
  v.object({ status: v.literal("dependency_unavailable") }),
  v.object({ status: v.literal("submission_unknown"), transactionHash: v.string() }),
  v.object({ status: v.literal("failed"), transactionHash: v.string() }),
  v.object({
    status: v.literal("verified"),
    transactionHash: v.string(),
    ledger: v.number(),
  }),
  v.object({ status: v.literal("already_verified"), transactionHash: v.string() }),
);

type FundingSubmitResult =
  | { status: "unauthorized" }
  | { status: "invalid_request" }
  | { status: "invalid_signature" }
  | { status: "intent_mismatch" }
  | { status: "not_found" }
  | { status: "expired" }
  | { status: "not_submittable" }
  | { status: "relayer_changed" }
  | { status: "dependency_unavailable" }
  | { status: "submission_unknown" | "failed"; transactionHash: string }
  | { status: "verified"; transactionHash: string; ledger: number }
  | { status: "already_verified"; transactionHash: string };

export const submitRelayerFunding = action({
  args: {
    projectId: v.id("projects"),
    requestId: v.string(),
    transactionXdr: v.string(),
  },
  returns: fundingSubmitResultValidator,
  handler: async (ctx, args): Promise<FundingSubmitResult> => {
    if ((await ctx.auth.getUserIdentity()) === null) return { status: "unauthorized" as const };
    if (
      args.transactionXdr.trim() === "" ||
      new TextEncoder().encode(args.transactionXdr).byteLength > GAS_FUNDING_MAX_XDR_BYTES
    ) {
      return { status: "invalid_request" as const };
    }

    let claim;
    try {
      claim = await ctx.runMutation(internal.gas.balance_internal.claimFundingSubmission, {
        projectId: args.projectId,
        requestId: args.requestId,
      });
    } catch (error) {
      return {
        status: isAuthorizationError(error) ? "unauthorized" : "dependency_unavailable",
      } as const;
    }
    if (claim.status !== "ready") return claim;

    let validated;
    try {
      validated = validateOwnerFundingTransaction(args.transactionXdr, {
        operation: claim.intent.operation,
        sourceWallet: claim.intent.sourceWallet,
        destinationPublicKey: claim.intent.destinationPublicKey,
        amountStroops: claim.intent.amountStroops,
        feeStroops: claim.intent.feeStroops,
        preparedTransactionHash: claim.intent.preparedTransactionHash,
      });
    } catch (error) {
      if (error instanceof GasFundingTransactionError) return { status: error.code };
      return { status: "invalid_request" as const };
    }

    if (!(await isTestnetHorizonConfigured())) return { status: "dependency_unavailable" };

    let authorized;
    try {
      authorized = await ctx.runMutation(internal.gas.balance_internal.authorizeFundingSend, {
        projectId: args.projectId,
        requestId: claim.intent.requestId,
        preparedTransactionHash: claim.intent.preparedTransactionHash,
        transactionHash: validated.transactionHash,
      });
    } catch (error) {
      return {
        status: isAuthorizationError(error) ? "unauthorized" : "dependency_unavailable",
      } as const;
    }
    if (authorized === "already_verified") {
      return { status: "already_verified" as const, transactionHash: validated.transactionHash };
    }
    if (authorized !== "authorized") return { status: "intent_mismatch" as const };

    const server = new Horizon.Server(GAS_TESTNET_HORIZON_URL);
    try {
      const submission = await server.submitTransaction(validated.transaction);
      if (submission.hash !== validated.transactionHash) {
        await finishFunding(
          ctx,
          args.projectId,
          claim.intent.requestId,
          validated.transactionHash,
          {
            status: "submission_unknown",
          },
        );
        return {
          status: "submission_unknown" as const,
          transactionHash: validated.transactionHash,
        };
      }
      const verification = await readSubmittedFundingOutcome(server, validated.transactionHash);
      await finishFunding(
        ctx,
        args.projectId,
        claim.intent.requestId,
        validated.transactionHash,
        verification,
      );
      if (verification.status === "verified") {
        return {
          status: "verified" as const,
          transactionHash: validated.transactionHash,
          ledger: verification.ledger,
        };
      }
      return verification.status === "failed"
        ? { status: "failed" as const, transactionHash: validated.transactionHash }
        : { status: "submission_unknown" as const, transactionHash: validated.transactionHash };
    } catch {
      const verification = await readSubmittedFundingOutcome(server, validated.transactionHash);
      await finishFunding(
        ctx,
        args.projectId,
        claim.intent.requestId,
        validated.transactionHash,
        verification,
      );
      if (verification.status === "verified") {
        return {
          status: "verified" as const,
          transactionHash: validated.transactionHash,
          ledger: verification.ledger,
        };
      }
      return verification.status === "failed"
        ? { status: "failed" as const, transactionHash: validated.transactionHash }
        : { status: "submission_unknown" as const, transactionHash: validated.transactionHash };
    }
  },
});

async function readSubmittedFundingOutcome(
  server: Horizon.Server,
  transactionHash: string,
): Promise<
  { status: "verified"; ledger: number } | { status: "failed" } | { status: "submission_unknown" }
> {
  try {
    const outcome = await server.transactions().transaction(transactionHash).call();
    if (!Number.isSafeInteger(outcome.ledger_attr) || outcome.ledger_attr <= 0) {
      return { status: "submission_unknown" };
    }
    return outcome.successful
      ? { status: "verified", ledger: outcome.ledger_attr }
      : { status: "failed" };
  } catch {
    return { status: "submission_unknown" };
  }
}

async function finishFunding(
  ctx: ActionCtx,
  projectId: Id<"projects">,
  requestId: string,
  transactionHash: string,
  outcome:
    | { status: "verified"; ledger: number }
    | { status: "failed" }
    | { status: "submission_unknown" },
): Promise<void> {
  try {
    await ctx.runMutation(internal.gas.balance_internal.finishFundingSubmission, {
      projectId,
      requestId,
      transactionHash,
      outcome,
    });
  } catch {
    // The pre-send transaction hash remains pinned if recording its outcome fails.
  }
}

const withdrawalPreparationResultValidator = v.union(
  v.object({ status: v.literal("unauthorized") }),
  v.object({ status: v.literal("configuration_unavailable") }),
  v.object({ status: v.literal("invalid_amount") }),
  v.object({ status: v.literal("managed_relayer_required") }),
  v.object({ status: v.literal("maintenance_active") }),
  v.object({ status: v.literal("source_account_not_found") }),
  v.object({ status: v.literal("dependency_unavailable") }),
  v.object({
    status: v.literal("prepared"),
    requestId: v.string(),
    ownerWallet: v.string(),
    relayerPublicKey: v.string(),
    amountStroops: v.string(),
    expiresAt: v.number(),
    transactionXdr: v.string(),
  }),
);

type WithdrawalPreparationResult =
  | { status: "unauthorized" }
  | { status: "configuration_unavailable" }
  | { status: "invalid_amount" }
  | { status: "managed_relayer_required" }
  | { status: "maintenance_active" }
  | { status: "source_account_not_found" }
  | { status: "dependency_unavailable" }
  | {
      status: "prepared";
      requestId: string;
      ownerWallet: string;
      relayerPublicKey: string;
      amountStroops: string;
      expiresAt: number;
      transactionXdr: string;
    };

const withdrawalOutcomeValidator = v.union(
  v.object({ status: v.literal("unauthorized") }),
  v.object({ status: v.literal("not_found") }),
  v.object({ status: v.literal("expired") }),
  v.object({ status: v.literal("consent_invalid") }),
  v.object({ status: v.literal("managed_relayer_changed") }),
  v.object({ status: v.literal("maintenance_active") }),
  v.object({ status: v.literal("maintenance_missing") }),
  v.object({ status: v.literal("waiting_exposure") }),
  v.object({ status: v.literal("not_ready") }),
  v.object({ status: v.literal("source_account_not_found") }),
  v.object({ status: v.literal("relayer_account_not_found") }),
  v.object({ status: v.literal("insufficient_available_balance"), availableStroops: v.string() }),
  v.object({ status: v.literal("relayer_unavailable") }),
  v.object({ status: v.literal("dependency_unavailable") }),
  v.object({
    status: v.literal("submission_unknown"),
    requestId: v.string(),
    transactionHash: v.string(),
  }),
  v.object({ status: v.literal("failed"), requestId: v.string(), transactionHash: v.string() }),
  v.object({
    status: v.literal("verified"),
    requestId: v.string(),
    transactionHash: v.string(),
    ledger: v.number(),
  }),
);

type WithdrawalOutcome =
  | { status: "unauthorized" }
  | { status: "not_found" }
  | { status: "expired" }
  | { status: "consent_invalid" }
  | { status: "managed_relayer_changed" }
  | { status: "maintenance_active" }
  | { status: "maintenance_missing" }
  | { status: "waiting_exposure" }
  | { status: "not_ready" }
  | { status: "source_account_not_found" }
  | { status: "relayer_account_not_found" }
  | { status: "insufficient_available_balance"; availableStroops: string }
  | { status: "relayer_unavailable" }
  | { status: "dependency_unavailable" }
  | { status: "submission_unknown"; requestId: string; transactionHash: string }
  | { status: "failed"; requestId: string; transactionHash: string }
  | { status: "verified"; requestId: string; transactionHash: string; ledger: number };

function decimalXlmToStroops(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,7})?$/.test(value)) return null;
  const [whole = "", fraction = ""] = value.split(".");
  return BigInt(`${whole}${fraction.padEnd(7, "0")}`);
}

async function readSpendableRelayerBalance(
  server: Horizon.Server,
  account: Awaited<ReturnType<Horizon.Server["loadAccount"]>>,
): Promise<bigint | null> {
  const native = account.balances.filter((line) => line.asset_type === "native");
  if (native.length !== 1) return null;
  const balance = decimalXlmToStroops(native[0]?.balance);
  const sellingLiabilities = decimalXlmToStroops(native[0]?.selling_liabilities ?? "0");
  if (balance === null || sellingLiabilities === null) return null;
  const ledgerPage = await server.ledgers().order("desc").limit(1).call();
  const latestLedger = ledgerPage.records[0];
  const baseReserve = latestLedger?.base_reserve_in_stroops;
  if (typeof baseReserve !== "number" || !Number.isSafeInteger(baseReserve) || baseReserve <= 0) {
    return null;
  }
  const reserveUnits = 2 + account.subentry_count + account.num_sponsoring - account.num_sponsored;
  if (!Number.isSafeInteger(reserveUnits) || reserveUnits < 0) return null;
  const minimumBalance = BigInt(baseReserve) * BigInt(reserveUnits);
  return calculateGasSpendableBalance({
    ledgerBalanceStroops: balance,
    minimumReserveStroops: minimumBalance,
    nativeSellingLiabilitiesStroops: sellingLiabilities,
    outstandingGasCommitmentsStroops: 0n,
    withdrawalFeeStroops: GAS_WITHDRAWAL_FEE_STROOPS,
  });
}

type WithdrawalLedgerOutcome =
  | { status: "not_found" }
  | { status: "unknown" }
  | { status: "verified"; ledger: number }
  | { status: "failed"; ledger: number };

async function lookupWithdrawalOutcome(
  server: Horizon.Server,
  transactionHash: string,
): Promise<WithdrawalLedgerOutcome> {
  try {
    const outcome = await server.transactions().transaction(transactionHash).call();
    if (!Number.isSafeInteger(outcome.ledger_attr) || outcome.ledger_attr <= 0) {
      return { status: "unknown" };
    }
    return outcome.successful
      ? { status: "verified", ledger: outcome.ledger_attr }
      : { status: "failed", ledger: outcome.ledger_attr };
  } catch (error) {
    return responseStatus(error) === 404 ? { status: "not_found" } : { status: "unknown" };
  }
}

async function finishWithdrawal(
  ctx: ActionCtx,
  projectId: Id<"projects">,
  requestId: string,
  transactionHash: string,
  outcome: WithdrawalLedgerOutcome,
): Promise<void> {
  try {
    if (outcome.status === "verified" || outcome.status === "failed") {
      await ctx.runMutation(internal.gas.balance_internal.finishWithdrawalSubmission, {
        projectId,
        requestId,
        transactionHash,
        outcome: { status: outcome.status, ledger: outcome.ledger },
      });
    } else if (outcome.status === "unknown") {
      await ctx.runMutation(internal.gas.balance_internal.finishWithdrawalSubmission, {
        projectId,
        requestId,
        transactionHash,
        outcome: { status: "submission_unknown" },
      });
    }
  } catch {
    // Transaction identity and maintenance lock remain pinned for later recovery.
  }
}

async function submitPinnedWithdrawal(
  ctx: ActionCtx,
  projectId: Id<"projects">,
  requestId: string,
  transactionHash: string,
  transactionXdr: string,
  expected: { relayerPublicKey: string; ownerWallet: string; amountStroops: string },
): Promise<WithdrawalOutcome> {
  const server = new Horizon.Server(GAS_TESTNET_HORIZON_URL);
  let parsed;
  try {
    parsed = validateManagedWithdrawalTransaction(transactionXdr, {
      relayerPublicKey: expected.relayerPublicKey,
      ownerWallet: expected.ownerWallet,
      amountStroops: expected.amountStroops,
    });
  } catch {
    return { status: "dependency_unavailable" };
  }
  if (parsed.transactionHash !== transactionHash) return { status: "dependency_unavailable" };
  try {
    await server.submitTransaction(parsed.transaction);
  } catch {
    // The request may already have been accepted. Resolve by its original hash.
  }
  const outcome = await lookupWithdrawalOutcome(server, transactionHash);
  await finishWithdrawal(ctx, projectId, requestId, transactionHash, outcome);
  if (outcome.status === "verified")
    return { status: "verified", requestId, transactionHash, ledger: outcome.ledger };
  if (outcome.status === "failed") return { status: "failed", requestId, transactionHash };
  return { status: "submission_unknown", requestId, transactionHash };
}

async function processRelayerWithdrawal(
  ctx: ActionCtx,
  projectId: Id<"projects">,
  requestId: string,
): Promise<WithdrawalOutcome> {
  let claim;
  try {
    claim = await ctx.runMutation(internal.gas.balance_internal.claimWithdrawalForSend, {
      projectId,
      requestId,
    });
  } catch (error) {
    return { status: isAuthorizationError(error) ? "unauthorized" : "dependency_unavailable" };
  }
  if (claim.status === "not_found") return { status: "not_found" };
  if (claim.status === "waiting_exposure") return { status: "waiting_exposure" };
  if (claim.status === "maintenance_missing") return { status: "maintenance_missing" };
  if (claim.status === "not_ready") return { status: "not_ready" };
  if (!(await isTestnetHorizonConfigured())) return { status: "dependency_unavailable" };

  if (claim.status === "already_submitted") {
    const server = new Horizon.Server(GAS_TESTNET_HORIZON_URL);
    const current = await lookupWithdrawalOutcome(server, claim.transactionHash);
    if (current.status === "verified" || current.status === "failed") {
      await finishWithdrawal(ctx, projectId, requestId, claim.transactionHash, current);
      return current.status === "verified"
        ? {
            status: "verified",
            requestId,
            transactionHash: claim.transactionHash,
            ledger: current.ledger,
          }
        : { status: "failed", requestId, transactionHash: claim.transactionHash };
    }
    if (
      current.status === "not_found" &&
      claim.signedTransactionXdr !== null &&
      Date.now() < claim.expiresAt
    ) {
      return await submitPinnedWithdrawal(
        ctx,
        projectId,
        requestId,
        claim.transactionHash,
        claim.signedTransactionXdr,
        {
          relayerPublicKey: claim.facts.relayerPublicKey,
          ownerWallet: claim.facts.ownerWallet,
          amountStroops: claim.facts.amountStroops,
        },
      );
    }
    return { status: "submission_unknown", requestId, transactionHash: claim.transactionHash };
  }

  const facts = claim.facts;
  const server = new Horizon.Server(GAS_TESTNET_HORIZON_URL);
  let relayerAccount: Awaited<ReturnType<Horizon.Server["loadAccount"]>> | null;
  try {
    relayerAccount = await loadTestnetAccount(server, facts.relayerPublicKey);
  } catch {
    return { status: "dependency_unavailable" };
  }
  if (!relayerAccount) return { status: "relayer_account_not_found" };
  let spendable: bigint | null;
  try {
    spendable = await readSpendableRelayerBalance(server, relayerAccount);
  } catch {
    return { status: "dependency_unavailable" };
  }
  if (spendable === null) return { status: "dependency_unavailable" };
  if (BigInt(facts.amountStroops) > spendable) {
    try {
      await ctx.runMutation(internal.gas.balance_internal.markWithdrawalInsufficientBalance, {
        projectId,
        requestId,
        availableStroops: spendable.toString(),
      });
    } catch {
      // The lock remains active so the owner can explicitly cancel this unsent withdrawal.
    }
    return { status: "insufficient_available_balance", availableStroops: spendable.toString() };
  }

  let signedXdr: string;
  try {
    signedXdr = await withManagedTestnetRelayerSigner(ctx, projectId, async (signer) => {
      if (signer.publicKey !== facts.relayerPublicKey)
        throw new RelayerCustodyError("configuration_mismatch");
      const transaction = new TransactionBuilder(relayerAccount!, {
        fee: GAS_WITHDRAWAL_FEE_STROOPS.toString(),
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(
          Operation.payment({
            destination: facts.ownerWallet,
            asset: Asset.native(),
            amount:
              (BigInt(facts.amountStroops) / 10_000_000n).toString() +
              (BigInt(facts.amountStroops) % 10_000_000n === 0n
                ? ""
                : `.${(BigInt(facts.amountStroops) % 10_000_000n).toString().padStart(7, "0").replace(/0+$/, "")}`),
          }),
        )
        .setTimeout(300)
        .build();
      signer.signTransaction(transaction);
      return transaction.toXDR();
    });
  } catch (error) {
    return error instanceof RelayerCustodyError
      ? { status: "relayer_unavailable" }
      : { status: "dependency_unavailable" };
  }

  let validated;
  try {
    validated = validateManagedWithdrawalTransaction(signedXdr, {
      relayerPublicKey: facts.relayerPublicKey,
      ownerWallet: facts.ownerWallet,
      amountStroops: facts.amountStroops,
    });
  } catch {
    return { status: "dependency_unavailable" };
  }
  let pinned;
  try {
    pinned = await ctx.runMutation(internal.gas.balance_internal.pinWithdrawalTransaction, {
      projectId,
      requestId,
      transactionHash: validated.transactionHash,
      signedTransactionXdr: signedXdr,
    });
  } catch {
    return { status: "dependency_unavailable" };
  }
  if (pinned !== "pinned") return { status: "dependency_unavailable" };
  return await submitPinnedWithdrawal(
    ctx,
    projectId,
    requestId,
    validated.transactionHash,
    signedXdr,
    {
      relayerPublicKey: facts.relayerPublicKey,
      ownerWallet: facts.ownerWallet,
      amountStroops: facts.amountStroops,
    },
  );
}

export const prepareRelayerWithdrawal = action({
  args: { projectId: v.id("projects"), amountStroops: v.string() },
  returns: withdrawalPreparationResultValidator,
  handler: async (ctx, args): Promise<WithdrawalPreparationResult> => {
    if ((await ctx.auth.getUserIdentity()) === null) return { status: "unauthorized" as const };
    const deploymentId = custodyEnv.VELO_GAS_CUSTODY_DEPLOYMENT_ID?.trim();
    if (!deploymentId) return { status: "configuration_unavailable" as const };
    const requestId = globalThis.crypto.randomUUID();
    const nonce = globalThis.crypto.randomUUID();
    const now = Date.now();
    const expiresAt = now + GAS_WITHDRAWAL_CONSENT_TTL_MS;
    let created;
    try {
      created = await ctx.runMutation(internal.gas.balance_internal.createWithdrawalIntent, {
        projectId: args.projectId,
        requestId,
        nonce,
        amountStroops: args.amountStroops,
        expiresAt,
      });
    } catch (error) {
      return {
        status: isAuthorizationError(error)
          ? ("unauthorized" as const)
          : ("dependency_unavailable" as const),
      };
    }
    if (created.status !== "ready") return created;
    const facts = created.facts;
    if (!(await isTestnetHorizonConfigured())) return { status: "dependency_unavailable" };
    const server = new Horizon.Server(GAS_TESTNET_HORIZON_URL);
    try {
      const ownerAccount = await loadTestnetAccount(server, facts.ownerWallet);
      if (!ownerAccount) return { status: "source_account_not_found" as const };
      const digest = await digestGasWithdrawalConsent({
        deploymentId,
        projectId: args.projectId,
        relayerPublicKey: facts.relayerPublicKey,
        ownerWallet: facts.ownerWallet,
        amountStroops: facts.amountStroops,
        nonce: facts.nonce,
        expiresAt: facts.expiresAt,
      });
      const built = buildOwnerWithdrawalConsent({
        sourceAccount: ownerAccount,
        sourceWallet: facts.ownerWallet,
        digest,
      });
      await ctx.runMutation(internal.gas.balance_internal.pinWithdrawalConsent, {
        projectId: args.projectId,
        requestId,
        consentDigest: digest,
        preparedConsentHash: built.transactionHash,
      });
      return {
        status: "prepared" as const,
        requestId,
        ownerWallet: facts.ownerWallet,
        relayerPublicKey: facts.relayerPublicKey,
        amountStroops: facts.amountStroops,
        expiresAt,
        transactionXdr: built.transactionXdr,
      };
    } catch {
      return { status: "dependency_unavailable" as const };
    }
  },
});

export const confirmRelayerWithdrawal = action({
  args: { projectId: v.id("projects"), requestId: v.string(), consentTransactionXdr: v.string() },
  returns: withdrawalOutcomeValidator,
  handler: async (ctx, args): Promise<WithdrawalOutcome> => {
    if ((await ctx.auth.getUserIdentity()) === null) return { status: "unauthorized" };
    if (
      new TextEncoder().encode(args.consentTransactionXdr).byteLength > GAS_FUNDING_MAX_XDR_BYTES
    ) {
      return { status: "consent_invalid" };
    }
    const deploymentId = custodyEnv.VELO_GAS_CUSTODY_DEPLOYMENT_ID?.trim();
    if (!deploymentId) return { status: "dependency_unavailable" };
    let claim;
    try {
      claim = await ctx.runMutation(internal.gas.balance_internal.claimWithdrawalConsent, {
        projectId: args.projectId,
        requestId: args.requestId,
      });
    } catch (error) {
      return { status: isAuthorizationError(error) ? "unauthorized" : "dependency_unavailable" };
    }
    if (claim.status !== "ready") {
      return claim.status === "expired"
        ? { status: "expired" }
        : claim.status === "managed_relayer_changed"
          ? { status: "managed_relayer_changed" }
          : claim.status === "not_found"
            ? { status: "not_found" }
            : { status: "consent_invalid" };
    }
    const facts = claim.facts;
    const digest = await digestGasWithdrawalConsent({
      deploymentId,
      projectId: args.projectId,
      relayerPublicKey: facts.relayerPublicKey,
      ownerWallet: facts.ownerWallet,
      amountStroops: facts.amountStroops,
      nonce: facts.nonce,
      expiresAt: facts.expiresAt,
    });
    if (facts.consentDigest !== digest || facts.preparedConsentHash === null) {
      return { status: "consent_invalid" };
    }
    let consentHash: string;
    try {
      consentHash = validateOwnerWithdrawalConsent(args.consentTransactionXdr, {
        sourceWallet: facts.ownerWallet,
        digest,
        preparedTransactionHash: facts.preparedConsentHash,
      });
    } catch {
      return { status: "consent_invalid" };
    }
    let authorized;
    try {
      authorized = await ctx.runMutation(internal.gas.balance_internal.authorizeWithdrawal, {
        projectId: args.projectId,
        requestId: args.requestId,
        consentDigest: digest,
        consentTransactionHash: consentHash,
      });
    } catch (error) {
      return { status: isAuthorizationError(error) ? "unauthorized" : "dependency_unavailable" };
    }
    if (authorized.status === "waiting_exposure") return { status: "waiting_exposure" };
    if (authorized.status === "maintenance_active") return { status: "maintenance_active" };
    if (authorized.status === "not_found") return { status: "not_found" };
    if (authorized.status !== "ready_to_send") return { status: "consent_invalid" };
    return await processRelayerWithdrawal(ctx, args.projectId, args.requestId);
  },
});

export const continueRelayerWithdrawal = action({
  args: { projectId: v.id("projects"), requestId: v.string() },
  returns: withdrawalOutcomeValidator,
  handler: async (ctx, args): Promise<WithdrawalOutcome> => {
    if ((await ctx.auth.getUserIdentity()) === null) return { status: "unauthorized" };
    return await processRelayerWithdrawal(ctx, args.projectId, args.requestId);
  },
});

export const cancelRelayerWithdrawal = action({
  args: { projectId: v.id("projects"), requestId: v.string() },
  returns: v.union(v.literal("cancelled"), v.literal("not_cancellable"), v.literal("unauthorized")),
  handler: async (ctx, args): Promise<"cancelled" | "not_cancellable" | "unauthorized"> => {
    if ((await ctx.auth.getUserIdentity()) === null) return "unauthorized" as const;
    try {
      return await ctx.runMutation(internal.gas.balance_internal.cancelUnsentWithdrawal, args);
    } catch (error) {
      if (isAuthorizationError(error)) return "unauthorized" as const;
      return "not_cancellable" as const;
    }
  },
});

/** Read and safely persist the authenticated project's configured Testnet relayer balance. */
const faucetResultValidator = v.union(
  v.object({ status: v.literal("unauthorized") }),
  v.object({ status: v.literal("missing_relayer") }),
  v.object({ status: v.literal("cooldown"), retryAfterMs: v.number() }),
  v.object({ status: v.literal("in_progress"), requestId: v.string() }),
  v.object({ status: v.literal("account_exists"), requestId: v.string() }),
  v.object({ status: v.literal("funded"), requestId: v.string() }),
  v.object({ status: v.literal("uncertain"), requestId: v.string() }),
  v.object({ status: v.literal("dependency_unavailable") }),
);

type FaucetResult =
  | { status: "unauthorized" }
  | { status: "missing_relayer" }
  | { status: "cooldown"; retryAfterMs: number }
  | { status: "in_progress"; requestId: string }
  | { status: "account_exists"; requestId: string }
  | { status: "funded"; requestId: string }
  | { status: "uncertain"; requestId: string }
  | { status: "dependency_unavailable" };

async function finishFaucet(
  ctx: ActionCtx,
  projectId: Id<"projects">,
  requestId: string,
  status: "funded" | "account_exists" | "uncertain" | "failed",
  errorCode?: "provider_failure" | "account_not_found",
): Promise<void> {
  try {
    await ctx.runMutation(internal.gas.balance_internal.finishFaucetRequest, {
      projectId,
      requestId,
      status,
      checkedAt: Date.now(),
      ...(errorCode === undefined ? {} : { errorCode }),
    });
  } catch {
    // The cooldown record prevents a second faucet request during recovery.
  }
}

export const requestTestnetRelayerFunds = action({
  args: { projectId: v.id("projects") },
  returns: faucetResultValidator,
  handler: async (ctx, args): Promise<FaucetResult> => {
    if ((await ctx.auth.getUserIdentity()) === null) return { status: "unauthorized" };
    let claim;
    try {
      claim = await ctx.runMutation(internal.gas.balance_internal.claimFaucetRequest, args);
    } catch (error) {
      return { status: isAuthorizationError(error) ? "unauthorized" : "dependency_unavailable" };
    }
    if (claim.status === "unauthorized" || claim.status === "missing_relayer") return claim;
    if (claim.status === "cooldown") return claim;
    if (claim.status === "in_progress")
      return { status: "in_progress", requestId: claim.requestId };
    if (!(await isTestnetHorizonConfigured())) {
      await finishFaucet(ctx, args.projectId, claim.requestId, "uncertain", "provider_failure");
      return { status: "uncertain", requestId: claim.requestId };
    }

    const server = new Horizon.Server(GAS_TESTNET_HORIZON_URL);
    try {
      if (await loadTestnetAccount(server, claim.publicKey)) {
        await finishFaucet(ctx, args.projectId, claim.requestId, "account_exists");
        return { status: "account_exists", requestId: claim.requestId };
      }
    } catch {
      await finishFaucet(ctx, args.projectId, claim.requestId, "uncertain", "provider_failure");
      return { status: "uncertain", requestId: claim.requestId };
    }

    try {
      const endpoint = new URL(GAS_TESTNET_FRIENDBOT_URL);
      endpoint.searchParams.set("addr", claim.publicKey);
      const response = await fetch(endpoint, {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(8_000),
      });
      await response.body?.cancel();
    } catch {
      // The faucet may have accepted the request before the connection failed.
    }

    try {
      if (await loadTestnetAccount(server, claim.publicKey)) {
        await finishFaucet(ctx, args.projectId, claim.requestId, "funded");
        return { status: "funded", requestId: claim.requestId };
      }
      await finishFaucet(ctx, args.projectId, claim.requestId, "uncertain", "account_not_found");
      return { status: "uncertain", requestId: claim.requestId };
    } catch {
      await finishFaucet(ctx, args.projectId, claim.requestId, "uncertain", "provider_failure");
      return { status: "uncertain", requestId: claim.requestId };
    }
  },
});

export const checkTestnetRelayerFunds = action({
  args: { projectId: v.id("projects"), requestId: v.string() },
  returns: faucetResultValidator,
  handler: async (ctx, args): Promise<FaucetResult> => {
    if ((await ctx.auth.getUserIdentity()) === null) return { status: "unauthorized" };
    let claim;
    try {
      claim = await ctx.runMutation(internal.gas.balance_internal.claimFaucetCheck, args);
    } catch (error) {
      return { status: isAuthorizationError(error) ? "unauthorized" : "dependency_unavailable" };
    }
    if (claim.status === "not_found" || claim.status === "not_checkable") {
      return { status: "dependency_unavailable" };
    }
    if (claim.status === "already_funded") {
      return { status: "account_exists", requestId: args.requestId };
    }
    if (!(await isTestnetHorizonConfigured())) {
      await finishFaucet(ctx, args.projectId, args.requestId, "uncertain", "provider_failure");
      return { status: "uncertain", requestId: args.requestId };
    }
    const server = new Horizon.Server(GAS_TESTNET_HORIZON_URL);
    try {
      if (await loadTestnetAccount(server, claim.publicKey)) {
        await finishFaucet(ctx, args.projectId, args.requestId, "funded");
        return { status: "funded", requestId: args.requestId };
      }
      await finishFaucet(ctx, args.projectId, args.requestId, "uncertain", "account_not_found");
      return { status: "uncertain", requestId: args.requestId };
    } catch {
      await finishFaucet(ctx, args.projectId, args.requestId, "uncertain", "provider_failure");
      return { status: "uncertain", requestId: args.requestId };
    }
  },
});

export const refreshRelayerBalance = action({
  args: { projectId: v.id("projects") },
  returns: relayerBalanceRefreshResultValidator,
  handler: async (ctx, args): Promise<RelayerBalanceRefreshResult> => {
    if ((await ctx.auth.getUserIdentity()) === null) {
      throw new Error("Not authenticated");
    }

    const claim = await ctx.runMutation(internal.gas.balance_internal.claim, {
      projectId: args.projectId,
    });
    if (claim.status !== "claimed") return claim;

    const observation = await readTestnetNativeBalance(claim.publicKey);
    return await ctx.runMutation(internal.gas.balance_internal.complete, {
      projectId: args.projectId,
      relayerId: claim.relayerId,
      publicKey: claim.publicKey,
      network: claim.network,
      relayerStatus: claim.relayerStatus,
      refreshToken: claim.refreshToken,
      refreshStartedAt: claim.refreshStartedAt,
      authorization: claim.authorization,
      observation,
    });
  },
});
