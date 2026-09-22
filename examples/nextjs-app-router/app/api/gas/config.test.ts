import assert from "node:assert/strict";
import test from "node:test";

import { GasExampleConfigurationError, getGasExampleConfig } from "./config.ts";

const validEnvironment = {
  VELO_GAS_API_KEY: "server-gas-api-key",
  VELO_BASE_URL: "https://api.example.test/",
  VELO_GAS_DEMO_TOKEN: "terminal-demo-token",
};

test("gas configuration requires all three server-only values", () => {
  for (const key of ["VELO_GAS_API_KEY", "VELO_BASE_URL", "VELO_GAS_DEMO_TOKEN"] as const) {
    const environment = { ...validEnvironment };
    delete environment[key];
    assert.throws(() => getGasExampleConfig(environment), GasExampleConfigurationError);
  }
});

test("gas configuration accepts HTTPS and loopback HTTP without URL credentials", () => {
  assert.deepEqual(getGasExampleConfig(validEnvironment), {
    apiKey: "server-gas-api-key",
    baseUrl: "https://api.example.test",
    demoToken: "terminal-demo-token",
  });
  assert.equal(
    getGasExampleConfig({ ...validEnvironment, VELO_BASE_URL: "http://localhost:3000/" }).baseUrl,
    "http://localhost:3000",
  );
  assert.equal(
    getGasExampleConfig({ ...validEnvironment, VELO_BASE_URL: "http://127.0.0.1:3000" }).baseUrl,
    "http://127.0.0.1:3000",
  );
});

test("gas configuration rejects public HTTP and embedded URL credentials", () => {
  for (const baseUrl of ["http://api.example.test", "https://user:password@api.example.test"]) {
    assert.throws(
      () => getGasExampleConfig({ ...validEnvironment, VELO_BASE_URL: baseUrl }),
      GasExampleConfigurationError,
    );
  }
});

test("gas demo tokens are bounded ASCII token values", () => {
  assert.throws(
    () => getGasExampleConfig({ ...validEnvironment, VELO_GAS_DEMO_TOKEN: "token with spaces" }),
    GasExampleConfigurationError,
  );
  assert.throws(
    () => getGasExampleConfig({ ...validEnvironment, VELO_GAS_DEMO_TOKEN: "x".repeat(257) }),
    GasExampleConfigurationError,
  );
  assert.throws(
    () =>
      getGasExampleConfig({
        ...validEnvironment,
        VELO_GAS_DEMO_TOKEN: validEnvironment.VELO_GAS_API_KEY,
      }),
    GasExampleConfigurationError,
  );
});
