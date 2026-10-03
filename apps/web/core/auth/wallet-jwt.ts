import crypto from "crypto";

import { assertValidPublicKey, Keypair, WebAuth } from "@repo/stellar";

import { stellarConfig } from "../config/stellar.ts";
import { WALLET_AUTH_KEY_ID } from "./wallet-auth-constants.ts";

const APPLICATION_ID = "velo-web";
const TOKEN_TTL_SECONDS = 60 * 60;
const CHALLENGE_TTL_SECONDS = 5 * 60;

function base64Url(input: Buffer | string) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function hmacSecret() {
  const secret =
    process.env.VELO_AUTH_CHALLENGE_SECRET || process.env.VELO_AUTH_JWT_PRIVATE_KEY_PEM;
  if (!secret) {
    throw new Error("VELO_AUTH_CHALLENGE_SECRET or VELO_AUTH_JWT_PRIVATE_KEY_PEM is required");
  }
  return secret;
}

function issuer() {
  return (
    process.env.VELO_AUTH_ISSUER ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

function privateKeyPem() {
  const pem = process.env.VELO_AUTH_JWT_PRIVATE_KEY_PEM?.replace(/\\n/g, "\n");
  if (!pem) {
    throw new Error("VELO_AUTH_JWT_PRIVATE_KEY_PEM is required");
  }
  return pem;
}

function serverKeypair() {
  const secret = process.env.VELO_AUTH_SERVER_SECRET;
  if (secret) {
    return Keypair.fromSecret(secret);
  }
  const seed = crypto.createHash("sha256").update(hmacSecret()).digest();
  return Keypair.fromRawEd25519Seed(seed);
}

function derToJose(signature: Buffer) {
  if (signature[0] !== 0x30) {
    throw new Error("Invalid ES256 signature");
  }

  let offset = 3;
  const rLength = signature[offset++];
  if (rLength === undefined) {
    throw new Error("Invalid ES256 signature");
  }
  let r = signature.subarray(offset, offset + rLength);
  offset += rLength + 1;
  const sLength = signature[offset++];
  if (sLength === undefined) {
    throw new Error("Invalid ES256 signature");
  }
  let s = signature.subarray(offset, offset + sLength);

  if (r.length > 32) r = r.subarray(r.length - 32);
  if (s.length > 32) s = s.subarray(s.length - 32);

  return Buffer.concat([
    Buffer.concat([Buffer.alloc(32 - r.length), r]),
    Buffer.concat([Buffer.alloc(32 - s.length), s]),
  ]);
}

export function createWalletChallenge(address: string) {
  const normalizedAddress = assertValidPublicKey(address);
  const serverKP = serverKeypair();
  const homeDomain = new URL(issuer()).host;

  const challenge = WebAuth.buildChallengeTx(
    serverKP,
    normalizedAddress,
    homeDomain,
    CHALLENGE_TTL_SECONDS,
    stellarConfig.networkPassphrase,
    homeDomain,
  );

  return { challenge };
}

export function verifyWalletChallenge(input: { address: string; challenge: string }) {
  const normalizedAddress = assertValidPublicKey(input.address);
  const serverKP = serverKeypair();
  const homeDomain = new URL(issuer()).host;

  const { clientAccountID } = WebAuth.readChallengeTx(
    input.challenge,
    serverKP.publicKey(),
    stellarConfig.networkPassphrase,
    homeDomain,
    homeDomain,
  );

  if (clientAccountID !== normalizedAddress) {
    throw new Error("Client account ID in challenge does not match requested address");
  }

  WebAuth.verifyChallengeTxSigners(
    input.challenge,
    serverKP.publicKey(),
    stellarConfig.networkPassphrase,
    [normalizedAddress],
    homeDomain,
    homeDomain,
  );

  return normalizedAddress;
}

export function createWalletJwt(address: string) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "ES256", kid: WALLET_AUTH_KEY_ID, typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      iss: issuer(),
      sub: address,
      aud: APPLICATION_ID,
      iat: now,
      exp: now + TOKEN_TTL_SECONDS,
    }),
  );
  const signingInput = `${header}.${payload}`;
  const signature = crypto.createSign("SHA256").update(signingInput).end().sign(privateKeyPem());

  return `${signingInput}.${base64Url(derToJose(signature))}`;
}

export function walletJwks() {
  const key = crypto.createPublicKey(privateKeyPem()).export({ format: "jwk" });

  return {
    keys: [
      {
        ...key,
        kid: WALLET_AUTH_KEY_ID,
        alg: "ES256",
        use: "sig",
      },
    ],
  };
}

export function walletAuthConfig() {
  return {
    applicationID: APPLICATION_ID,
    issuer: issuer(),
    jwks: `${issuer()}/api/auth/wallet/jwks`,
  };
}
