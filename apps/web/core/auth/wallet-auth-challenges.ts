import {
  consumeWalletAuthChallenge,
  issueWalletAuthChallenge,
} from "@repo/backend/convex/wallet_auth/references";
import { ConvexHttpClient } from "convex/browser";

import { env } from "../config/env";
import { createWalletAuthServiceJwt } from "./wallet-jwt";

function walletAuthBackend() {
  const client = new ConvexHttpClient(env.NEXT_PUBLIC_CONVEX_URL);
  client.setAuth(createWalletAuthServiceJwt());
  return client;
}

export async function issueWalletChallenge(input: {
  challengeId: string;
  address: string;
  transactionHash: string;
  expiresAt: number;
}) {
  await walletAuthBackend().mutation(issueWalletAuthChallenge, input);
}

export async function consumeWalletChallenge(input: {
  challengeId: string;
  address: string;
  transactionHash: string;
}) {
  return await walletAuthBackend().mutation(consumeWalletAuthChallenge, input);
}
