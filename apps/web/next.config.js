import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

const gasFixtureFlag = "VELO_GAS_E2E_FIXTURES";

function fixturePath(fileName) {
  return `./e2e/fixtures/${fileName}`;
}

export function createNextConfig(phase, enabled = process.env[gasFixtureFlag] === "1") {
  if (enabled && phase !== PHASE_DEVELOPMENT_SERVER) {
    throw new Error(`${gasFixtureFlag} is development-server-only and cannot be enabled here`);
  }

  if (!enabled) return {};

  return {
    distDir: ".next-gas-e2e",
    turbopack: {
      resolveAlias: {
        "@/core/wallet/wallet-provider": fixturePath("wallet-provider.tsx"),
        "@/core/providers/convex-provider": fixturePath("convex-provider.tsx"),
        "convex/react": fixturePath("convex-react.tsx"),
      },
    },
  };
}

export default function nextConfig(phase) {
  return createNextConfig(phase);
}
