import { createHash } from "node:crypto";

/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";

import { api } from "../_generated/api";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

function asWallet(t: ReturnType<typeof convexTest>, ownerAddress: string) {
  return t.withIdentity({
    subject: ownerAddress,
    issuer: "http://localhost:3000",
    tokenIdentifier: `http://localhost:3000|${ownerAddress}`,
  });
}

async function createProject(
  owner: ReturnType<typeof asWallet>,
  ownerAddress: string,
  slug: string,
  name = "Original Project",
) {
  return await owner.mutation(api.projects.mutation.createDraft, {
    name,
    slug,
    description: "Original description",
    metadataJson: JSON.stringify({ name: "Original Project", slug }),
    metadataHash: "0000000000000000000000000000000000000000000000000000000000000000",
    ownerAddress,
  });
}

test("owner can update project settings without changing registry metadata", async () => {
  const t = convexTest(schema, modules);
  const ownerAddress = "GD7O2C226SF2677PFFUVD6O2ICFOBNCWPI5Z46N43ZSFQGLM65U3I2SP";
  const owner = asWallet(t, ownerAddress);
  const projectId = await createProject(owner, ownerAddress, "settings-project");

  await owner.mutation(api.projects.mutation.markRegistrationPending, {
    id: projectId,
    registrationTxHash: "a".repeat(64),
  });
  await owner.mutation(api.projects.mutation.markRegistrationSynced, {
    id: projectId,
    registryProjectId: 42,
    createdLedger: 123,
  });

  const before = await owner.query(api.projects.query.getById, { id: projectId });

  await owner.mutation(api.projects.mutation.updateSettings, {
    id: projectId,
    name: " Updated Project ",
    description: " Updated description ",
  });

  const after = await owner.query(api.projects.query.getById, { id: projectId });
  expect(after?.name).toBe("Updated Project");
  expect(after?.description).toBe("Updated description");
  expect(after?.metadataJson).toBe(before?.metadataJson);
  expect(after?.metadataHash).toBe(before?.metadataHash);
  expect(after?.status).toBe("registered");
});

test("a Registry project ID cannot be assigned to two Velo projects", async () => {
  const t = convexTest(schema, modules);
  const ownerAddress = "GD7O2C226SF2677PFFUVD6O2ICFOBNCWPI5Z46N43ZSFQGLM65U3I2SP";
  const owner = asWallet(t, ownerAddress);
  const firstProjectId = await createProject(
    owner,
    ownerAddress,
    "registry-id-owner",
    "Registry ID Owner",
  );
  const secondProjectId = await createProject(
    owner,
    ownerAddress,
    "registry-id-contender",
    "Registry ID Contender",
  );

  for (const id of [firstProjectId, secondProjectId]) {
    await owner.mutation(api.projects.mutation.markRegistrationPending, {
      id,
      registrationTxHash: id === firstProjectId ? "a".repeat(64) : "b".repeat(64),
    });
  }
  await owner.mutation(api.projects.mutation.markRegistrationSynced, {
    id: firstProjectId,
    registryProjectId: 42,
    createdLedger: 123,
  });

  await expect(
    owner.mutation(api.projects.mutation.markRegistrationSynced, {
      id: secondProjectId,
      registryProjectId: 42,
      createdLedger: 124,
    }),
  ).rejects.toThrow("Registry project ID is already assigned to another Velo project");

  const secondProject = await t.run(async (ctx) => await ctx.db.get(secondProjectId));
  expect(secondProject?.status).toBe("pending_registration");
  expect(secondProject?.registryProjectId).toBeUndefined();
  expect(secondProject?.createdLedger).toBeUndefined();
});

test("another wallet cannot update settings or generate logo upload URL", async () => {
  const t = convexTest(schema, modules);
  const ownerAddress = "GD7O2C226SF2677PFFUVD6O2ICFOBNCWPI5Z46N43ZSFQGLM65U3I2SP";
  const attackerAddress = "GDFWQCS3C72IWT5QV6CJYCMCQZ4WQ2QELSE6ABWI5Q3XRZ6BPGRS6LZV";
  const owner = asWallet(t, ownerAddress);
  const attacker = asWallet(t, attackerAddress);
  const projectId = await createProject(owner, ownerAddress, "unauthorized-settings-project");

  await expect(
    attacker.mutation(api.projects.mutation.updateSettings, {
      id: projectId,
      name: "Spoofed",
      description: "Spoofed",
    }),
  ).rejects.toThrow("Unauthorized");

  await expect(
    attacker.mutation(api.projects.mutation.generateLogoUploadUrl, { id: projectId }),
  ).rejects.toThrow("Unauthorized");
});

test("owner can set, replace, and remove logo storage id", async () => {
  const t = convexTest(schema, modules);
  const ownerAddress = "GD7O2C226SF2677PFFUVD6O2ICFOBNCWPI5Z46N43ZSFQGLM65U3I2SP";
  const owner = asWallet(t, ownerAddress);
  const projectId = await createProject(owner, ownerAddress, "logo-settings-project");
  const firstLogoId = await t.run(async (ctx) => {
    return await ctx.storage.store(new Blob(["first"], { type: "image/png" }));
  });
  const secondLogoId = await t.run(async (ctx) => {
    return await ctx.storage.store(new Blob(["second"], { type: "image/png" }));
  });

  await owner.mutation(api.projects.mutation.setLogo, {
    id: projectId,
    logoStorageId: firstLogoId,
  });

  let project = await owner.query(api.projects.query.getById, { id: projectId });
  expect(project?.logoStorageId).toBe(firstLogoId);

  await owner.mutation(api.projects.mutation.setLogo, {
    id: projectId,
    logoStorageId: secondLogoId,
  });

  project = await owner.query(api.projects.query.getById, { id: projectId });
  expect(project?.logoStorageId).toBe(secondLogoId);

  await owner.mutation(api.projects.mutation.removeLogo, { id: projectId });

  project = await owner.query(api.projects.query.getById, { id: projectId });
  expect(project?.logoStorageId).toBeUndefined();
});

test("project retirement requires the exact current name, is owner-only, and is idempotent", async () => {
  const t = convexTest(schema, modules);
  const ownerAddress = "GD7O2C226SF2677PFFUVD6O2ICFOBNCWPI5Z46N43ZSFQGLM65U3I2SP";
  const memberAddress = "GDFWQCS3C72IWT5QV6CJYCMCQZ4WQ2QELSE6ABWI5Q3XRZ6BPGRS6LZV";
  const owner = asWallet(t, ownerAddress);
  const member = asWallet(t, memberAddress);
  const projectId = await createProject(owner, ownerAddress, "retire-project");
  const membershipId = await t.run(
    async (ctx) =>
      await ctx.db.insert("projectMemberships", {
        projectId,
        walletAddress: memberAddress,
        role: "owner",
        addedBy: ownerAddress,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
  );

  await expect(
    t.mutation(api.projects.mutation.retire, {
      id: projectId,
      confirmationName: "Original project",
    }),
  ).rejects.toThrow("Not authenticated");
  await expect(
    member.mutation(api.projects.mutation.retire, {
      id: projectId,
      confirmationName: "Original Project",
    }),
  ).rejects.toThrow("Unauthorized");
  await expect(
    owner.mutation(api.projects.mutation.retire, {
      id: projectId,
      confirmationName: " Original Project",
    }),
  ).rejects.toThrow("confirmation does not match");

  expect(
    await owner.mutation(api.projects.mutation.retire, {
      id: projectId,
      confirmationName: "Original Project",
    }),
  ).toBeNull();
  expect(
    await owner.mutation(api.projects.mutation.retire, {
      id: projectId,
      confirmationName: "Original Project",
    }),
  ).toBeNull();

  const retired = await t.run(async (ctx) => await ctx.db.get(projectId));
  expect(retired?.retiredAt).toBeTypeOf("number");
  expect(retired?.retiredByTokenIdentifier).toBe("http://localhost:3000|" + ownerAddress);
  expect(await owner.query(api.projects.query.getById, { id: projectId })).toBeNull();
  expect(await member.query(api.projects.query.getById, { id: projectId })).toBeNull();
  expect(await owner.query(api.projects.query.getBySlug, { slug: "retire-project" })).toBeNull();
  expect(
    await owner.query(api.projects.query.getPublicVerification, { slug: "retire-project" }),
  ).toBeNull();
  expect(
    await owner.query(api.contract_events.query.listPublicBySlug, {
      slug: "retire-project",
    }),
  ).toEqual([]);
  expect(await owner.query(api.projects.query.listByOwner, {})).toEqual([]);
  expect(await t.run(async (ctx) => await ctx.db.get(membershipId))).not.toBeNull();
});

test("active project names are unique per owner after trimming and case folding", async () => {
  const t = convexTest(schema, modules);
  const ownerAddress = "GD7O2C226SF2677PFFUVD6O2ICFOBNCWPI5Z46N43ZSFQGLM65U3I2SP";
  const otherAddress = "GDFWQCS3C72IWT5QV6CJYCMCQZ4WQ2QELSE6ABWI5Q3XRZ6BPGRS6LZV";
  const owner = asWallet(t, ownerAddress);
  const otherOwner = asWallet(t, otherAddress);
  const projectId = await createProject(owner, ownerAddress, "name-unique-a", "  Velo Shop  ");

  await expect(createProject(owner, ownerAddress, "name-unique-b", "velo shop")).rejects.toThrow(
    "active project with this name",
  );
  const crossOwnerId = await createProject(otherOwner, otherAddress, "name-unique-c", "VELO SHOP");
  expect(crossOwnerId).toBeTruthy();

  await owner.mutation(api.projects.mutation.updateSettings, {
    id: projectId,
    name: "Velo Shop",
    description: "Updated description",
  });
  await owner.mutation(api.projects.mutation.retire, {
    id: projectId,
    confirmationName: "Velo Shop",
  });
  const replacementId = await createProject(owner, ownerAddress, "name-unique-a", "  VELO SHOP ");
  const [retired, replacement] = await t.run(async (ctx) => [
    await ctx.db.get(projectId),
    await ctx.db.get(replacementId),
  ]);
  expect(retired?.slug).toBe("name-unique-a");
  expect(retired?.retiredAt).toBeTypeOf("number");
  expect(replacement?.slug).not.toBe("name-unique-a");
  expect(JSON.parse(replacement!.metadataJson).slug).toBe(replacement!.slug);
  expect(createHash("sha256").update(replacement!.metadataJson).digest("hex")).toBe(
    replacement!.metadataHash,
  );
});

test("concurrent same-owner creates and renames allow only one active normalized name", async () => {
  const t = convexTest(schema, modules);
  const ownerAddress = "GD7O2C226SF2677PFFUVD6O2ICFOBNCWPI5Z46N43ZSFQGLM65U3I2SP";
  const owner = asWallet(t, ownerAddress);
  const creates = await Promise.allSettled([
    createProject(owner, ownerAddress, "concurrent-name-a", "Concurrent Name"),
    createProject(owner, ownerAddress, "concurrent-name-b", " concurrent name "),
  ]);
  expect(creates.filter((result) => result.status === "fulfilled")).toHaveLength(1);

  const firstId = await createProject(owner, ownerAddress, "rename-a", "Rename A");
  const secondId = await createProject(owner, ownerAddress, "rename-b", "Rename B");
  const renames = await Promise.allSettled([
    owner.mutation(api.projects.mutation.updateSettings, {
      id: firstId,
      name: "Shared rename",
      description: "First project",
    }),
    owner.mutation(api.projects.mutation.updateSettings, {
      id: secondId,
      name: " shared rename ",
      description: "Second project",
    }),
  ]);
  expect(renames.filter((result) => result.status === "fulfilled")).toHaveLength(1);
});

test("legacy duplicate names stay editable and block new conflicting names", async () => {
  const t = convexTest(schema, modules);
  const ownerAddress = "GD7O2C226SF2677PFFUVD6O2ICFOBNCWPI5Z46N43ZSFQGLM65U3I2SP";
  const owner = asWallet(t, ownerAddress);
  const firstId = await createProject(owner, ownerAddress, "legacy-name-a", "Legacy Duplicate");
  const secondId = await createProject(owner, ownerAddress, "legacy-name-b", "Temporary Name");
  await t.run(async (ctx) => {
    await ctx.db.patch(firstId, { normalizedName: undefined });
    await ctx.db.patch(secondId, {
      name: "Legacy Duplicate",
      normalizedName: undefined,
    });
  });

  await owner.mutation(api.projects.mutation.updateSettings, {
    id: secondId,
    name: "Legacy Duplicate",
    description: "Unrelated edit",
  });
  await expect(
    createProject(owner, ownerAddress, "legacy-name-c", " legacy duplicate "),
  ).rejects.toThrow("active project with this name");

  await owner.mutation(api.projects.mutation.retire, {
    id: firstId,
    confirmationName: "Legacy Duplicate",
  });
  await owner.mutation(api.projects.mutation.retire, {
    id: secondId,
    confirmationName: "Legacy Duplicate",
  });
  const allowedId = await createProject(owner, ownerAddress, "legacy-name-c", "LEGACY DUPLICATE");
  expect(await owner.query(api.projects.query.getById, { id: allowedId })).not.toBeNull();
});

test("concurrent slug collisions allocate distinct slugs and hash the allocated value", async () => {
  const t = convexTest(schema, modules);
  const firstAddress = "GD7O2C226SF2677PFFUVD6O2ICFOBNCWPI5Z46N43ZSFQGLM65U3I2SP";
  const secondAddress = "GDFWQCS3C72IWT5QV6CJYCMCQZ4WQ2QELSE6ABWI5Q3XRZ6BPGRS6LZV";
  const firstOwner = asWallet(t, firstAddress);
  const secondOwner = asWallet(t, secondAddress);
  const ids = await Promise.all([
    createProject(firstOwner, firstAddress, "shared-slug", "First Shared Name"),
    createProject(secondOwner, secondAddress, "shared-slug", "Second Shared Name"),
  ]);
  const projects = await t.run(async (ctx) => Promise.all(ids.map((id) => ctx.db.get(id))));
  const slugs = projects.map((project) => project!.slug);

  expect(new Set(slugs).size).toBe(2);
  expect(slugs).toContain("shared-slug");
  for (const project of projects) {
    expect(JSON.parse(project!.metadataJson).slug).toBe(project!.slug);
    expect(createHash("sha256").update(project!.metadataJson).digest("hex")).toBe(
      project!.metadataHash,
    );
  }
});

test("slug suffix allocation keeps a long slug valid when truncation reaches a hyphen", async () => {
  const t = convexTest(schema, modules);
  const ownerAddress = "GD7O2C226SF2677PFFUVD6O2ICFOBNCWPI5Z46N43ZSFQGLM65U3I2SP";
  const owner = asWallet(t, ownerAddress);
  const preferredSlug = `${"a".repeat(56)}-${"b".repeat(7)}`;
  await createProject(owner, ownerAddress, preferredSlug, "Long Slug First");

  const secondId = await createProject(owner, ownerAddress, preferredSlug, "Long Slug Second");
  const second = await t.run(async (ctx) => await ctx.db.get(secondId));

  expect(second?.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  expect(second?.slug).toHaveLength(63);
  expect(JSON.parse(second!.metadataJson).slug).toBe(second!.slug);
  expect(createHash("sha256").update(second!.metadataJson).digest("hex")).toBe(
    second!.metadataHash,
  );
});

test("retirement and a concurrent rename cannot authorize deletion with a stale name", async () => {
  const t = convexTest(schema, modules);
  const ownerAddress = "GD7O2C226SF2677PFFUVD6O2ICFOBNCWPI5Z46N43ZSFQGLM65U3I2SP";
  const owner = asWallet(t, ownerAddress);
  const projectId = await createProject(owner, ownerAddress, "rename-retire", "Before Rename");
  const outcomes = await Promise.allSettled([
    owner.mutation(api.projects.mutation.retire, {
      id: projectId,
      confirmationName: "Before Rename",
    }),
    owner.mutation(api.projects.mutation.updateSettings, {
      id: projectId,
      name: "After Rename",
      description: "Updated",
    }),
  ]);
  const project = await t.run(async (ctx) => await ctx.db.get(projectId));

  if (project?.retiredAt !== undefined) {
    expect(project.name).toBe("Before Rename");
    expect(outcomes[0]?.status).toBe("fulfilled");
    expect(outcomes[1]?.status).toBe("rejected");
  } else {
    expect(project?.name).toBe("After Rename");
    expect(outcomes[0]?.status).toBe("rejected");
    expect(outcomes[1]?.status).toBe("fulfilled");
  }
});

test("owner project limits are applied after retired projects are excluded", async () => {
  const t = convexTest(schema, modules);
  const ownerAddress = "GD7O2C226SF2677PFFUVD6O2ICFOBNCWPI5Z46N43ZSFQGLM65U3I2SP";
  const owner = asWallet(t, ownerAddress);
  for (let index = 0; index < 50; index += 1) {
    await createProject(owner, ownerAddress, "active-limit-" + index, "Active " + index);
  }
  for (let index = 0; index < 51; index += 1) {
    const name = "Retired " + index;
    const id = await createProject(owner, ownerAddress, "retired-limit-" + index, name);
    await owner.mutation(api.projects.mutation.retire, {
      id,
      confirmationName: name,
    });
  }

  const projects = await owner.query(api.projects.query.listByOwner, {});
  expect(projects).toHaveLength(50);
  expect(projects.every((project) => project.retiredAt === undefined)).toBe(true);
});
