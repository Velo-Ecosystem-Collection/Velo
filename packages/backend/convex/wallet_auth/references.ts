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
