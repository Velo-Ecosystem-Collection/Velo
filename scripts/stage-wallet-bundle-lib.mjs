import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function stageImmutableWalletBundle({ source, versionedDestination }) {
  const sourceContents = await readFile(source);
  await mkdir(path.dirname(versionedDestination), { recursive: true });

  let versionedContents;
  try {
    versionedContents = await readFile(versionedDestination);
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }

  if (versionedContents && !versionedContents.equals(sourceContents)) {
    throw new Error(`Refusing to overwrite existing versioned CDN asset: ${versionedDestination}`);
  }

  if (!versionedContents) {
    try {
      await writeFile(versionedDestination, sourceContents, { flag: "wx" });
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      versionedContents = await readFile(versionedDestination);
      if (!versionedContents.equals(sourceContents)) {
        throw new Error(
          `Refusing to overwrite existing versioned CDN asset: ${versionedDestination}`,
        );
      }
    }
  }

  return { versionedCreated: !versionedContents };
}

export async function stageWalletBundle({ source, latestDestination, versionedDestination }) {
  const result = await stageImmutableWalletBundle({ source, versionedDestination });
  await mkdir(path.dirname(latestDestination), { recursive: true });
  await copyFile(source, latestDestination);
  return result;
}

function isMissingFile(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isAlreadyExists(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}
