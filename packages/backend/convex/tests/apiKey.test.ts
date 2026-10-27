/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";

import type { Doc } from "../_generated/dataModel";

import { api } from "../_generated/api";
import { verifyApiKeyForGas } from "../gas/authorization";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

function asWallet(t: ReturnType<typeof convexTest>, ownerAddress: string) {
  return t.withIdentity({
    subject: ownerAddress,
    issuer: "http://localhost:3000",
    tokenIdentifier: `http://localhost:3000|${ownerAddress}`,
  });
}

test("project API key lifecycle", async () => {
  const t = convexTest(schema, modules);

  const ownerAddress = "GD7O2C226SF2677PFFUVD6O2ICFOBNCWPI5Z46N43ZSFQGLM65U3I2SP";
  const owner = asWallet(t, ownerAddress);

  // Create a draft project
  const projectId = await owner.mutation(api.projects.mutation.createDraft, {
    name: "Test Project",
    slug: "test-project",
    description: "A test project",
    metadataJson: "{}",
    metadataHash: "0000000000000000000000000000000000000000000000000000000000000000",
    ownerAddress,
  });

  // Project starts with no API keys
  let keys = (await owner.query(api.projects.query.listApiKeys, {
    projectId,
  })) as Omit<Doc<"apiKeys">, "keyHash">[];
  expect(keys).toEqual([]);

  // Generate API key 1
  const { rawKey: rawKey1 } = await owner.mutation(api.projects.mutation.generateApiKey, {
    id: projectId,
    label: "Dev Key",
  });

  expect(rawKey1).toMatch(/^tk_live_[a-f0-9]{32}$/);

  // Generate API key 2
  const { rawKey: rawKey2 } = await owner.mutation(api.projects.mutation.generateApiKey, {
    id: projectId,
    label: "Prod Key",
  });

  expect(rawKey2).toMatch(/^tk_live_[a-f0-9]{32}$/);

  const { rawKey: gasRawKey } = await owner.mutation(api.projects.mutation.generateApiKey, {
    id: projectId,
    label: "Server Gas Key",
    purpose: "gas",
  });
  expect(gasRawKey).toMatch(/^tg_test_[a-f0-9]{32}$/);

  const legacyKeyHash = "f".repeat(64);
  await t.run(async (ctx) =>
    ctx.db.insert("apiKeys", {
      projectId,
      keyHash: legacyKeyHash,
      prefix: "tk_live_f...f",
      label: "Legacy Key",
      createdAt: Date.now(),
      requestCount: 0,
      revoked: false,
    }),
  );

  // Compute the expected hashes to verify query lookups
  const computeHash = async (rawKey: string) => {
    const encoder = new TextEncoder();
    const data = encoder.encode(rawKey);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  };

  const apiKeyHash1 = await computeHash(rawKey1);
  const apiKeyHash2 = await computeHash(rawKey2);
  const gasApiKeyHash = await computeHash(gasRawKey);

  // Retrieve keys and verify prefixes, labels, and hashes are set correctly
  keys = (await owner.query(api.projects.query.listApiKeys, {
    projectId,
  })) as Omit<Doc<"apiKeys">, "keyHash">[];
  expect(keys.length).toBe(4);

  const devKey = keys.find((k) => k.label === "Dev Key");
  const prodKey = keys.find((k) => k.label === "Prod Key");

  expect(devKey).toBeDefined();
  expect(devKey?.purpose).toBe("general");
  expect("keyHash" in devKey!).toBe(false);
  expect(devKey?.prefix).toMatch(/^tk_live_[a-f0-9]{4}\.\.\.[a-f0-9]{4}$/);
  expect(devKey?.revoked).toBe(false);

  expect(prodKey).toBeDefined();
  expect(prodKey?.purpose).toBe("general");
  expect(prodKey?.prefix).toMatch(/^tk_live_[a-f0-9]{4}\.\.\.[a-f0-9]{4}$/);
  expect(prodKey?.revoked).toBe(false);

  const gasKey = keys.find((key) => key.label === "Server Gas Key");
  expect(gasKey?.purpose).toBe("gas");
  expect(gasKey?.prefix).toMatch(/^tg_test_[a-f0-9]{4}\.\.\.[a-f0-9]{4}$/);
  expect("keyHash" in gasKey!).toBe(false);

  const legacyKey = keys.find((key) => key.label === "Legacy Key");
  expect(legacyKey?.purpose).toBe("legacy");
  expect("keyHash" in legacyKey!).toBe(false);

  // Verify API Key 1 querying with valid key
  const validQuery1 = await t.query(api.projects.query.verifyApiKeyAndGetEvents, {
    apiKeyHash: apiKeyHash1,
    limit: 10,
  });
  expect(validQuery1.authorized).toBe(true);
  expect(validQuery1.project?.name).toBe("Test Project");
  expect(validQuery1.events).toEqual([]);

  // Verify API Key 2 querying with valid key
  const validQuery2 = await t.query(api.projects.query.verifyApiKeyAndGetEvents, {
    apiKeyHash: apiKeyHash2,
    limit: 10,
  });
  expect(validQuery2.authorized).toBe(true);

  const generalKeyGasScope = await t.query(async (ctx) => verifyApiKeyForGas(ctx, apiKeyHash1));
  expect(generalKeyGasScope).toEqual({ authorized: false });

  const gasKeyGasScope = await t.query(async (ctx) => verifyApiKeyForGas(ctx, gasApiKeyHash));
  expect(gasKeyGasScope).toEqual({
    authorized: true,
    apiKeyId: expect.any(String),
    projectId,
  });

  const legacyKeyGasScope = await t.query(async (ctx) => verifyApiKeyForGas(ctx, legacyKeyHash));
  expect(legacyKeyGasScope).toMatchObject({ authorized: true, projectId });

  const gasKeyGeneralRead = await t.query(api.projects.query.verifyApiKeyAndGetEvents, {
    apiKeyHash: gasApiKeyHash,
    limit: 10,
  });
  expect(gasKeyGeneralRead).toEqual({ authorized: false });

  await t.run(async (ctx) => ctx.db.patch(projectId, { paymentAccessActive: true }));
  const gasKeyPaymentScope = await t.query(api.projects.query.verifyApiKeyAndGetProject, {
    apiKeyHash: gasApiKeyHash,
  });
  expect(gasKeyPaymentScope).toEqual({ authorized: false });

  // Verify API Key querying with invalid key hash
  const invalidQuery = await t.query(api.projects.query.verifyApiKeyAndGetEvents, {
    apiKeyHash: "invalid_hash_value",
    limit: 10,
  });
  expect(invalidQuery.authorized).toBe(false);
  expect(invalidQuery.events).toBeUndefined();

  // Revoke API Key 1
  await owner.mutation(api.projects.mutation.revokeApiKey, {
    keyId: devKey!._id,
    projectId,
  });

  // Verify key 1 is revoked and key 2 is still active
  keys = (await owner.query(api.projects.query.listApiKeys, {
    projectId,
  })) as Omit<Doc<"apiKeys">, "keyHash">[];
  const revokedDevKey = keys.find((k) => k.label === "Dev Key");
  const activeProdKey = keys.find((k) => k.label === "Prod Key");

  expect(revokedDevKey?.revoked).toBe(true);
  expect(activeProdKey?.revoked).toBe(false);

  // Verify revoked key 1 is now unauthorized
  const revokedQuery = await t.query(api.projects.query.verifyApiKeyAndGetEvents, {
    apiKeyHash: apiKeyHash1,
    limit: 10,
  });
  expect(revokedQuery.authorized).toBe(false);

  // Verify active key 2 is still authorized
  const stillAuthorizedQuery = await t.query(api.projects.query.verifyApiKeyAndGetEvents, {
    apiKeyHash: apiKeyHash2,
    limit: 10,
  });
  expect(stillAuthorizedQuery.authorized).toBe(true);
});

test("authenticated wallet cannot manage another wallet project", async () => {
  const t = convexTest(schema, modules);
  const ownerAddress = "GD7O2C226SF2677PFFUVD6O2ICFOBNCWPI5Z46N43ZSFQGLM65U3I2SP";
  const attackerAddress = "GDFWQCS3C72IWT5QV6CJYCMCQZ4WQ2QELSE6ABWI5Q3XRZ6BPGRS6LZV";
  const owner = asWallet(t, ownerAddress);
  const attacker = asWallet(t, attackerAddress);

  const projectId = await owner.mutation(api.projects.mutation.createDraft, {
    name: "Protected Project",
    slug: "protected-project",
    description: "A protected project",
    metadataJson: "{}",
    metadataHash: "0000000000000000000000000000000000000000000000000000000000000000",
    ownerAddress,
  });

  await expect(
    attacker.mutation(api.projects.mutation.generateApiKey, {
      id: projectId,
      label: "Spoofed Key",
    }),
  ).rejects.toThrow("Unauthorized");

  const attackerRead = await attacker.query(api.projects.query.getById, { id: projectId });
  expect(attackerRead).toBeNull();

  const ownerRead = await owner.query(api.projects.query.getById, { id: projectId });
  expect(ownerRead?._id).toBe(projectId);
  expect(ownerRead?.ownerTokenIdentifier).toBe(`http://localhost:3000|${ownerAddress}`);
});
