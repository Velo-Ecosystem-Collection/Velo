import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

process.env.NEXT_PUBLIC_CONVEX_URL ??= "https://dummy.convex.cloud";

const { Keypair, Transaction, Networks } = await import("@repo/stellar");
const { createWalletChallenge, createWalletJwt, verifyWalletChallenge, walletJwks } =
  await import("../../core/auth/wallet-jwt.ts");

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

test("wallet auth rejects missing server credentials", () => {
  const previousChallengeSecret = process.env.VELO_AUTH_CHALLENGE_SECRET;
  const previousJwtKey = process.env.VELO_AUTH_JWT_PRIVATE_KEY_PEM;
  const previousServerSecret = process.env.VELO_AUTH_SERVER_SECRET;

  delete process.env.VELO_AUTH_CHALLENGE_SECRET;
  delete process.env.VELO_AUTH_JWT_PRIVATE_KEY_PEM;
  delete process.env.VELO_AUTH_SERVER_SECRET;

  try {
    const address = Keypair.random().publicKey();
    assert.throws(
      () => createWalletChallenge(address),
      /VELO_AUTH_CHALLENGE_SECRET or VELO_AUTH_JWT_PRIVATE_KEY_PEM is required/,
    );
    assert.throws(() => createWalletJwt(address), /VELO_AUTH_JWT_PRIVATE_KEY_PEM is required/);
  } finally {
    restoreEnv("VELO_AUTH_CHALLENGE_SECRET", previousChallengeSecret);
    restoreEnv("VELO_AUTH_JWT_PRIVATE_KEY_PEM", previousJwtKey);
    restoreEnv("VELO_AUTH_SERVER_SECRET", previousServerSecret);
  }
});

test("SEP-10 Challenge Lifecycle", () => {
  const previousChallengeSecret = process.env.VELO_AUTH_CHALLENGE_SECRET;
  process.env.VELO_AUTH_CHALLENGE_SECRET = "wallet-jwt-test-challenge-secret";
  const clientKP = Keypair.random();
  const address = clientKP.publicKey();

  try {
    // 1. Create a challenge
    const { challenge } = createWalletChallenge(address);
    assert.ok(challenge, "Challenge transaction should be generated");

    // 2. Client signs the challenge transaction
    const tx = new Transaction(challenge, Networks.TESTNET);
    tx.sign(clientKP);
    const signedTxXdr = tx.toEnvelope().toXDR("base64");

    // 3. Verify the signed challenge
    const verifiedAddress = verifyWalletChallenge({
      address,
      challenge: signedTxXdr,
    });

    assert.equal(verifiedAddress, address, "Verified address should match client address");
  } finally {
    restoreEnv("VELO_AUTH_CHALLENGE_SECRET", previousChallengeSecret);
  }
});

test("wallet JWT signing accepts an environment-provided P-256 private key", () => {
  const previousJwtKey = process.env.VELO_AUTH_JWT_PRIVATE_KEY_PEM;
  const { privateKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
    publicKeyEncoding: { format: "pem", type: "spki" },
  });
  process.env.VELO_AUTH_JWT_PRIVATE_KEY_PEM = privateKey;

  try {
    const token = createWalletJwt(Keypair.random().publicKey());
    assert.equal(token.split(".").length, 3);
    const [encodedHeader] = token.split(".");
    const header = JSON.parse(Buffer.from(encodedHeader!, "base64url").toString("utf8")) as {
      kid?: string;
    };
    assert.equal(header.kid, "velo-wallet-auth-v2");
    assert.equal(walletJwks().keys[0]?.kid, "velo-wallet-auth-v2");
    assert.equal(walletJwks().keys[0]?.crv, "P-256");
  } finally {
    restoreEnv("VELO_AUTH_JWT_PRIVATE_KEY_PEM", previousJwtKey);
  }
});

test("wallet auth rejects unsigned, wrong-account, wrong-network and expired challenges", (t) => {
  const previous = process.env.VELO_AUTH_CHALLENGE_SECRET;
  process.env.VELO_AUTH_CHALLENGE_SECRET = "wallet-jwt-negative-test-secret";
  try {
    const client = Keypair.random();
    const address = client.publicKey();
    const { challenge } = createWalletChallenge(address);
    assert.throws(() => verifyWalletChallenge({ address, challenge }));
    const signed = new Transaction(challenge, Networks.TESTNET);
    signed.sign(client);
    assert.throws(
      () =>
        verifyWalletChallenge({ address: Keypair.random().publicKey(), challenge: signed.toXDR() }),
      /does not match/,
    );
    const wrongNetwork = new Transaction(challenge, Networks.PUBLIC);
    wrongNetwork.sign(client);
    assert.throws(() => verifyWalletChallenge({ address, challenge: wrongNetwork.toXDR() }));
    try {
      t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 20 * 60 * 1000 });
      assert.throws(() => verifyWalletChallenge({ address, challenge: signed.toXDR() }));
    } finally {
      t.mock.timers.reset();
    }
  } finally {
    restoreEnv("VELO_AUTH_CHALLENGE_SECRET", previous);
  }
});
