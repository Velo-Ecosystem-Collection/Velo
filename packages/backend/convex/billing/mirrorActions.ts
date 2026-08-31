"use node";

import { resolveBackendPayAccessContractId } from "@repo/stellar/contract-config";
import { fetchRecentContractEvents } from "@repo/stellar/event-monitor";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import { action } from "../_generated/server";

const contextRef = makeFunctionReference<"query">("billing/mirror:getVerificationContext");
const completeRef = makeFunctionReference<"mutation">("billing/mirror:completeVerification");
const retryRef = makeFunctionReference<"mutation">("billing/mirror:retryVerification");

function rpcUrl() {
  return (
    process.env.STELLAR_RPC_URL ??
    process.env.NEXT_PUBLIC_STELLAR_RPC_URL ??
    "https://soroban-testnet.stellar.org"
  );
}

export const verifySubmitted = action({
  args: { attemptId: v.id("payAccessMirrorAttempts") },
  handler: async (ctx, args) => {
    const { attempt, state } = (await ctx.runQuery(contextRef, args)) as {
      attempt: {
        transactionHash: string;
        desiredCredits: bigint;
        desiredVersion: number;
      };
      state: { registryProjectId: number };
    };
    const contractId = resolveBackendPayAccessContractId({
      payAccessContractId: process.env.VELO_PAY_ACCESS_CONTRACT_ID,
      publicPayAccessContractId: process.env.NEXT_PUBLIC_VELO_PAY_ACCESS_CONTRACT_ID,
    });
    let result;
    try {
      result = await fetchRecentContractEvents({
        rpcUrl: rpcUrl(),
        contractIds: [contractId],
        ledgerWindow: 1_200,
        limit: 100,
      });
    } catch (error) {
      return await ctx.runMutation(retryRef, {
        attemptId: args.attemptId,
        error: error instanceof Error ? error.message : "PayAccess verifier request failed",
      });
    }
    const event = result.events.find(
      (candidate) =>
        candidate.transactionHash.toLowerCase() === attempt.transactionHash.toLowerCase() &&
        candidate.topics[0] === "pay" &&
        candidate.topics[1] === "display",
    );
    if (!event) {
      return await ctx.runMutation(retryRef, {
        attemptId: args.attemptId,
        error: "PayAccess display event is not finalized yet",
      });
    }
    const decoded = event.decoded as {
      project_id?: string | number;
      credits?: string;
      source_version?: string | number;
    } | null;
    const success =
      Number(decoded?.project_id) === state.registryProjectId &&
      decoded?.credits === attempt.desiredCredits.toString() &&
      Number(decoded?.source_version) === attempt.desiredVersion;
    return await ctx.runMutation(completeRef, {
      attemptId: args.attemptId,
      success,
      ...(success
        ? {}
        : { error: "Finalized PayAccess display event does not match signed state" }),
    });
  },
});
