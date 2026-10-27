import assert from "node:assert/strict";
import test from "node:test";

process.env.NEXT_PUBLIC_CONVEX_URL ??= "https://dummy.convex.cloud";
process.env.NEXT_PUBLIC_VELO_REGISTRY_CONTRACT_ID ??=
  "CBSR5LFHR5Q2X3PO3HSMGXI43YEUYGFTHUPGNVGW6XH2VNOQUEUHIEJR";
process.env.NEXT_PUBLIC_VELO_PAY_ACCESS_CONTRACT_ID ??=
  "CBHDLZYSYWETHPC6KDGH35S4SNBU5P7QWLNNDWYXJRHZMZDTQSKYVOXJ";

const { parseEnv } = await import("../../core/config/env.ts");

const baseEnv = {
  NEXT_PUBLIC_CONVEX_URL: "https://dummy.convex.cloud",
};

test("WalletConnect configuration is optional and trims blank values", () => {
  assert.equal(parseEnv(baseEnv).NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID, undefined);
  assert.equal(
    parseEnv({ ...baseEnv, NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: "  " })
      .NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
    undefined,
  );
  assert.equal(
    parseEnv({ ...baseEnv, NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: " project-id " })
      .NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
    "project-id",
  );
});

const REGISTRY_CONTRACT_ID = "CBSR5LFHR5Q2X3PO3HSMGXI43YEUYGFTHUPGNVGW6XH2VNOQUEUHIEJR";
const PAY_ACCESS_CONTRACT_ID = "CBHDLZYSYWETHPC6KDGH35S4SNBU5P7QWLNNDWYXJRHZMZDTQSKYVOXJ";

test("parseEnv accepts valid public contract IDs", () => {
  const parsed = parseEnv({
    ...baseEnv,
    NEXT_PUBLIC_VELO_REGISTRY_CONTRACT_ID: REGISTRY_CONTRACT_ID.toLowerCase(),
    NEXT_PUBLIC_VELO_PAY_ACCESS_CONTRACT_ID: PAY_ACCESS_CONTRACT_ID.toLowerCase(),
  });

  assert.equal(parsed.NEXT_PUBLIC_VELO_REGISTRY_CONTRACT_ID, REGISTRY_CONTRACT_ID);
  assert.equal(parsed.NEXT_PUBLIC_VELO_PAY_ACCESS_CONTRACT_ID, PAY_ACCESS_CONTRACT_ID);
});

test("parseEnv rejects malformed public contract IDs", () => {
  assert.throws(
    () =>
      parseEnv({
        ...baseEnv,
        NEXT_PUBLIC_VELO_REGISTRY_CONTRACT_ID: "not-a-contract",
      }),
    /NEXT_PUBLIC_VELO_REGISTRY_CONTRACT_ID.*valid Stellar contract ID/,
  );
});

test("parseEnv allows omitted local contract IDs", () => {
  const parsed = parseEnv(baseEnv);

  assert.equal(parsed.NEXT_PUBLIC_VELO_REGISTRY_CONTRACT_ID, null);
  assert.equal(parsed.NEXT_PUBLIC_VELO_PAY_ACCESS_CONTRACT_ID, null);
});

test("parseEnv requires contract IDs when hosted guardrail is enabled", () => {
  assert.throws(
    () =>
      parseEnv(
        {
          ...baseEnv,
          VELO_REQUIRE_CONTRACT_IDS: "true",
        },
        { requireContractIds: true },
      ),
    /Missing required hosted contract ID env vars/,
  );
});
