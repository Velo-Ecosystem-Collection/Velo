import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { stageWalletBundle } from "./stage-wallet-bundle-lib.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(repositoryRoot, "packages/velo-wallets/dist/cdn/velo-wallet.js");
const packageJson = JSON.parse(
  await readFile(path.join(repositoryRoot, "packages/velo-wallets/package.json"), "utf8"),
);
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageJson.version)) {
  throw new Error(`Invalid wallet package version: ${packageJson.version}`);
}

if (process.env.VELO_WALLETS_SKIP_CDN_STAGE === "1") {
  console.log("Skipped wallet CDN staging for this validation build.");
} else {
  const result = await stageWalletBundle({
    source,
    latestDestination: path.join(repositoryRoot, "apps/web/public/wallets/v1/velo-wallet.js"),
    versionedDestination: path.join(
      repositoryRoot,
      `apps/web/public/wallets/v${packageJson.version}/velo-wallet.js`,
    ),
  });

  console.log(
    `Staged ${packageJson.name}@${packageJson.version} at /wallets/v1 and /wallets/v${packageJson.version} (versioned asset ${result.versionedCreated ? "created" : "already matched"}; no CDN deployment performed).`,
  );
}
