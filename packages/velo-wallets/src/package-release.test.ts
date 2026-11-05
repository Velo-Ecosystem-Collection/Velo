import { describe, expect, test } from "vitest";

import packageJson from "../package.json" with { type: "json" };
import libraryConfig from "../vite.lib.config.js";

const walletKitPackage = "@creit-tech/stellar-wallets-kit";

describe("npm release packaging", () => {
  test("bundles the JSR-hosted wallet kit for npm-only consumers", () => {
    const manifest = packageJson as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const external = libraryConfig.build?.rollupOptions?.external;

    expect(manifest.dependencies?.[walletKitPackage]).toBeUndefined();
    expect(manifest.devDependencies?.[walletKitPackage]).toBe(
      "npm:@jsr/creit-tech__stellar-wallets-kit@2.3.0",
    );
    expect(external).not.toContain(walletKitPackage);
    expect(external).not.toContain(`${walletKitPackage}/modules/utils`);
  });

  test("publishes the bundled wallet logo map for browser-side previews", () => {
    const manifest = packageJson as {
      exports?: Record<string, { import?: string; types?: string }>;
    };
    expect(manifest.exports?.["./logos"]).toEqual({
      types: "./dist/types/wallet-logos.d.ts",
      import: "./dist/logos.js",
    });
    expect(libraryConfig.build?.assetsInlineLimit).toBeGreaterThanOrEqual(200_000);
  });
});
