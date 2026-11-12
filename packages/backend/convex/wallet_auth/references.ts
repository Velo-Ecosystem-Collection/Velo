import { makeFunctionReference } from "convex/server";

type IssueWalletAuthChallengeArgs = {
  challengeId: string;
  address: string;
  transactionHash: string;
  expiresAt: number;
};

type ConsumeWalletAuthChallengeArgs = {
  challengeId: string;
  address: string;
  transactionHash: string;
};

type IssueContractAccountAuthChallengeArgs = {
  challengeId: string;
  address: string;
  nonce: string;
  challengeHash: string;
  expiresAt: number;
};

type ConsumeContractAccountAuthChallengeArgs = {
  address: string;
  nonce: string;
  challengeHash: string;
};

type ReserveSmartAccountRelayerFeeBudgetArgs = {
  feeStroops: number;
  dailyLimitStroops: number;
};

export const issueWalletAuthChallenge = makeFunctionReference<
  "mutation",
  IssueWalletAuthChallengeArgs,
  null
>("wallet_auth/challenges:issue");

export const consumeWalletAuthChallenge = makeFunctionReference<
  "mutation",
  ConsumeWalletAuthChallengeArgs,
  boolean
>("wallet_auth/challenges:consume");

export const issueContractAccountAuthChallenge = makeFunctionReference<
  "mutation",
  IssueContractAccountAuthChallengeArgs,
  null
>("wallet_auth/contract_challenges:issue");

export const consumeContractAccountAuthChallenge = makeFunctionReference<
  "mutation",
  ConsumeContractAccountAuthChallengeArgs,
  boolean
>("wallet_auth/contract_challenges:consume");

export const reserveSmartAccountRelayerFeeBudget = makeFunctionReference<
  "mutation",
  ReserveSmartAccountRelayerFeeBudgetArgs,
  boolean
>("smart_account_auth/fee_budget:reserve");
