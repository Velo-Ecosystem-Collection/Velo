import { expect, test } from "vitest";

import {
  decryptGasRelayerSecret,
  encryptGasRelayerSecret,
  GasCustodyCryptoError,
  parseGasCustodyKeyring,
} from "../../gas/custody_crypto";

function encodeKey(byte: number): string {
  return btoa(String.fromCharCode(...new Uint8Array(32).fill(byte)));
}

function keyring(activeVersion = "v1", versions: Record<string, string> = { v1: encodeKey(1) }) {
  return parseGasCustodyKeyring(JSON.stringify({ activeVersion, keys: versions }));
}

const context = {
  deploymentId: "dev:example",
  projectId: "projects:example",
  network: "testnet" as const,
  publicKey: "GEXAMPLE",
};

test("AES-256-GCM round trips with distinct fresh nonces", async () => {
  const encryptedA = await encryptGasRelayerSecret("S-private-test-seed", keyring(), context);
  const encryptedB = await encryptGasRelayerSecret("S-private-test-seed", keyring(), context);

  expect(encryptedA.keyVersion).toBe("v1");
  expect(encryptedA.nonce).not.toBe(encryptedB.nonce);
  expect(await decryptGasRelayerSecret(encryptedA, keyring(), context)).toBe("S-private-test-seed");
  expect(JSON.stringify(encryptedA)).not.toContain("S-private-test-seed");
});

test("ciphertext, tag, deployment, project, network, and address tampering fail closed", async () => {
  const encrypted = await encryptGasRelayerSecret("S-private-test-seed", keyring(), context);
  const ciphertextBytes = Uint8Array.from(atob(encrypted.ciphertext), (value) =>
    value.charCodeAt(0),
  );
  ciphertextBytes[0] ^= 1;
  const tamperedCiphertext = {
    ...encrypted,
    ciphertext: btoa(String.fromCharCode(...ciphertextBytes)),
  };
  const tagBytes = Uint8Array.from(atob(encrypted.authTag), (value) => value.charCodeAt(0));
  tagBytes[0] ^= 1;
  const tamperedTag = { ...encrypted, authTag: btoa(String.fromCharCode(...tagBytes)) };

  await expect(
    decryptGasRelayerSecret(tamperedCiphertext, keyring(), context),
  ).rejects.toBeInstanceOf(GasCustodyCryptoError);
  await expect(decryptGasRelayerSecret(tamperedTag, keyring(), context)).rejects.toBeInstanceOf(
    GasCustodyCryptoError,
  );
  for (const changed of [
    { ...context, deploymentId: "prod:example" },
    { ...context, projectId: "projects:other" },
    { ...context, publicKey: "GOTHER" },
  ]) {
    await expect(decryptGasRelayerSecret(encrypted, keyring(), changed)).rejects.toBeInstanceOf(
      GasCustodyCryptoError,
    );
  }
  await expect(
    decryptGasRelayerSecret(encrypted, keyring(), { ...context, network: "public" } as never),
  ).rejects.toBeInstanceOf(GasCustodyCryptoError);
});

test("wrong key and unknown key version are rejected without exposing key material", async () => {
  const encrypted = await encryptGasRelayerSecret("S-private-test-seed", keyring(), context);
  await expect(
    decryptGasRelayerSecret(encrypted, keyring("v1", { v1: encodeKey(2) }), context),
  ).rejects.toThrow("decryption_failed");
  await expect(
    decryptGasRelayerSecret({ ...encrypted, keyVersion: "removed-version" }, keyring(), context),
  ).rejects.toThrow("decryption_failed");
  expect(String(new GasCustodyCryptoError("decryption_failed"))).not.toContain(
    "S-private-test-seed",
  );
});

test("retained key versions support rotation without changing the encrypted secret identity", async () => {
  const originalKeyring = keyring("v1", { v1: encodeKey(1) });
  const rotatedKeyring = keyring("v2", { v1: encodeKey(1), v2: encodeKey(2) });
  const original = await encryptGasRelayerSecret("S-private-test-seed", originalKeyring, context);
  const reencrypted = await encryptGasRelayerSecret(
    await decryptGasRelayerSecret(original, rotatedKeyring, context),
    rotatedKeyring,
    context,
  );

  expect(reencrypted.keyVersion).toBe("v2");
  expect(await decryptGasRelayerSecret(reencrypted, rotatedKeyring, context)).toBe(
    "S-private-test-seed",
  );
  expect(await decryptGasRelayerSecret(original, rotatedKeyring, context)).toBe(
    "S-private-test-seed",
  );
});

test("malformed and missing keyrings return bounded redacted failures", () => {
  expect(() => parseGasCustodyKeyring(undefined)).toThrow("configuration_unavailable");
  expect(() => parseGasCustodyKeyring("not-json")).toThrow("configuration_invalid");
  expect(() =>
    parseGasCustodyKeyring(JSON.stringify({ activeVersion: "v1", keys: { v1: "not-a-key" } })),
  ).toThrow("configuration_invalid");
});
