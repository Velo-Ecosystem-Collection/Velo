import {
  consumeContractAccountAuthChallenge,
  issueContractAccountAuthChallenge,
  reserveSmartAccountRelayerFeeBudget,
} from "@repo/backend/convex/wallet_auth/references";
import { ConvexHttpClient } from "convex/browser";

import { env } from "../config/env";
import { createWalletAuthServiceJwt } from "./wallet-jwt";

function walletAuthBackend() {
  const client = new ConvexHttpClient(env.NEXT_PUBLIC_CONVEX_URL);
  client.setAuth(createWalletAuthServiceJwt());
  return client;
}

export async function issueContractAccountChallenge(input: {
  challengeId: string;
  address: string;
  nonce: string;
  challengeHash: string;
  expiresAt: number;
}) {
  await walletAuthBackend().mutation(issueContractAccountAuthChallenge, input);
}

export async function consumeContractAccountChallenge(input: {
  address: string;
  nonce: string;
  challengeHash: string;
}) {
  return await walletAuthBackend().mutation(consumeContractAccountAuthChallenge, input);
}

export async function reserveSmartAccountFeeBudget(input: {
  feeStroops: number;
  dailyLimitStroops: number;
}) {
  return await walletAuthBackend().mutation(reserveSmartAccountRelayerFeeBudget, input);
}
