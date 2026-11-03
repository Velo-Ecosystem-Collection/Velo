import { describe, expect, test } from "vitest";

import { resolveWalletAuthProvider } from "../authConfig";

describe("wallet auth configuration", () => {
  test("rejects an implicit localhost JWKS endpoint", () => {
    expect(() =>
      resolveWalletAuthProvider({
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      }),
    ).toThrow(/VELO_AUTH_JWKS/);
  });

  test("uses a deployment-safe explicit JWKS value", () => {
    const jwks = "data:application/json;base64,eyJrZXlzIjpbXX0=";

    expect(
      resolveWalletAuthProvider({
        VELO_AUTH_ISSUER: "http://localhost:3000",
        VELO_AUTH_JWKS: jwks,
      }),
    ).toEqual({
      type: "customJwt",
      applicationID: "velo-web-v2",
      issuer: "http://localhost:3000",
      jwks,
      algorithm: "ES256",
    });
  });
});
