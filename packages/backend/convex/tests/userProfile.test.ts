/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";

import type { Id } from "../_generated/dataModel";

import { api } from "../_generated/api";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");
const ownerAddress = "GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR";

function asWallet(t: ReturnType<typeof convexTest>, address = ownerAddress) {
  return t.withIdentity({
    subject: address,
    issuer: "http://localhost:3000",
    tokenIdentifier: `http://localhost:3000|${address}`,
  });
}

async function storeFile(
  t: ReturnType<typeof convexTest>,
  contents: BlobPart[],
  contentType: string,
) {
  return await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob(contents, { type: contentType }));
    const db = ctx.db as unknown as {
      patch: (id: Id<"_storage">, value: { contentType: string }) => Promise<void>;
    };
    await db.patch(storageId, { contentType });
    return storageId;
  });
}

test("profile values are sanitized on create and update", async () => {
  const t = convexTest(schema, modules);
  const owner = asWallet(t);

  await owner.mutation(api.users.mutation.upsertProfile, {
    name: "  Ada Lovelace  ",
    email: "  ADA@EXAMPLE.COM ",
  });

  let profile = await owner.query(api.users.query.getByWallet, {});
  expect(profile).toMatchObject({
    name: "Ada Lovelace",
    email: "ada@example.com",
  });

  await owner.mutation(api.users.mutation.upsertProfile, {
    name: "Grace Hopper",
    email: "grace@example.com",
  });

  profile = await owner.query(api.users.query.getByWallet, {});
  expect(profile).toMatchObject({
    name: "Grace Hopper",
    email: "grace@example.com",
  });
});

test("owner can assign, replace, and remove an avatar", async () => {
  const t = convexTest(schema, modules);
  const owner = asWallet(t);
  const firstAvatarId = await storeFile(t, ["first"], "image/png");
  const secondAvatarId = await storeFile(t, ["second"], "image/webp");

  await owner.mutation(api.users.mutation.upsertProfile, {
    name: "Ada Lovelace",
    email: "ada@example.com",
    avatarStorageId: firstAvatarId,
  });

  let profile = await owner.query(api.users.query.getByWallet, {});
  expect(profile?.avatarStorageId).toBe(firstAvatarId);
  expect(profile?.avatarUrl).toEqual(expect.any(String));

  await owner.mutation(api.users.mutation.upsertProfile, {
    name: "Ada Lovelace",
    email: "ada@example.com",
    avatarStorageId: secondAvatarId,
  });

  profile = await owner.query(api.users.query.getByWallet, {});
  expect(profile?.avatarStorageId).toBe(secondAvatarId);
  expect(await t.run(async (ctx) => await ctx.db.system.get("_storage", firstAvatarId))).toBeNull();

  await owner.mutation(api.users.mutation.removeAvatar, {});

  profile = await owner.query(api.users.query.getByWallet, {});
  expect(profile?.avatarStorageId).toBeUndefined();
  expect(profile?.avatarUrl).toBeUndefined();
  expect(
    await t.run(async (ctx) => await ctx.db.system.get("_storage", secondAvatarId)),
  ).toBeNull();
});

test("text-only profile updates preserve the current avatar", async () => {
  const t = convexTest(schema, modules);
  const owner = asWallet(t);
  const avatarStorageId = await storeFile(t, ["avatar"], "image/jpeg");

  await owner.mutation(api.users.mutation.upsertProfile, {
    name: "Ada Lovelace",
    email: "ada@example.com",
    avatarStorageId,
  });
  await owner.mutation(api.users.mutation.upsertProfile, {
    name: "Ada Byron",
    email: "ada@example.com",
  });

  const profile = await owner.query(api.users.query.getByWallet, {});
  expect(profile?.avatarStorageId).toBe(avatarStorageId);
});

test("avatar mutations reject missing, non-image, and oversized storage objects", async () => {
  const t = convexTest(schema, modules);
  const owner = asWallet(t);
  const textStorageId = await storeFile(t, ["not an image"], "text/plain");
  const oversizedStorageId = await storeFile(t, [new Uint8Array(2 * 1024 * 1024 + 1)], "image/png");

  await expect(
    owner.mutation(api.users.mutation.upsertProfile, {
      name: "Ada Lovelace",
      email: "ada@example.com",
      avatarStorageId: textStorageId,
    }),
  ).rejects.toThrow("Avatar must be an image");

  await expect(
    owner.mutation(api.users.mutation.upsertProfile, {
      name: "Ada Lovelace",
      email: "ada@example.com",
      avatarStorageId: oversizedStorageId,
    }),
  ).rejects.toThrow("Avatar must be 2 MB or smaller");
});

test("avatar endpoints require authentication and removal is identity scoped", async () => {
  const t = convexTest(schema, modules);
  const owner = asWallet(t);
  const attacker = asWallet(t, "GDFJHLAXAUMHA4OWPOB4P7YO72AQR2HMIUYFOXLXE2DZGM633K7HZDQP");
  const avatarStorageId = await storeFile(t, ["avatar"], "image/png");

  await owner.mutation(api.users.mutation.upsertProfile, {
    name: "Ada Lovelace",
    email: "ada@example.com",
    avatarStorageId,
  });

  await expect(t.mutation(api.users.mutation.generateAvatarUploadUrl, {})).rejects.toThrow(
    "Not authenticated",
  );
  await expect(attacker.mutation(api.users.mutation.removeAvatar, {})).rejects.toThrow(
    "Profile not found",
  );

  const profile = await owner.query(api.users.query.getByWallet, {});
  expect(profile?.avatarStorageId).toBe(avatarStorageId);
});
