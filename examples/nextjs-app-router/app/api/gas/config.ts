export type GasExampleEnvironment = {
  VELO_GAS_API_KEY?: string;
  VELO_GAS_BASE_URL?: string;
  VELO_GAS_DEMO_TOKEN?: string;
  VELO_GAS_ENV?: string;
};

export type GasExampleConfig = {
  apiKey: string;
  baseUrl: string;
  demoToken: string;
  environment: "testnet" | "development";
};

export class GasExampleConfigurationError extends Error {
  constructor() {
    super("Gas example server configuration is invalid.");
    this.name = "GasExampleConfigurationError";
  }
}

const ASCII_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const GAS_TESTNET_API_KEY = /^tg_test_[a-f0-9]{32}$/;
const MAX_DEMO_TOKEN_BYTES = 256;

export function isAsciiToken(value: string): boolean {
  return ASCII_TOKEN.test(value);
}

export function getGasExampleConfig(
  env: GasExampleEnvironment = {
    VELO_GAS_API_KEY: process.env.VELO_GAS_API_KEY,
    VELO_GAS_BASE_URL: process.env.VELO_GAS_BASE_URL,
    VELO_GAS_DEMO_TOKEN: process.env.VELO_GAS_DEMO_TOKEN,
    VELO_GAS_ENV: process.env.VELO_GAS_ENV,
  },
): GasExampleConfig {
  const apiKey = env.VELO_GAS_API_KEY?.trim();
  const demoToken = env.VELO_GAS_DEMO_TOKEN?.trim();
  const rawBaseUrl = env.VELO_GAS_BASE_URL?.trim();
  const environment = env.VELO_GAS_ENV?.trim() || "testnet";

  if (
    !apiKey ||
    !GAS_TESTNET_API_KEY.test(apiKey) ||
    !demoToken ||
    !rawBaseUrl ||
    apiKey === demoToken ||
    (environment !== "testnet" && environment !== "development")
  ) {
    throw new GasExampleConfigurationError();
  }

  if (
    !isAsciiToken(demoToken) ||
    new TextEncoder().encode(demoToken).byteLength > MAX_DEMO_TOKEN_BYTES
  ) {
    throw new GasExampleConfigurationError();
  }

  let parsedBaseUrl: URL;
  try {
    parsedBaseUrl = new URL(rawBaseUrl);
  } catch {
    throw new GasExampleConfigurationError();
  }

  if (parsedBaseUrl.username || parsedBaseUrl.password) {
    throw new GasExampleConfigurationError();
  }

  const hostname = parsedBaseUrl.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const isLoopbackHttp =
    parsedBaseUrl.protocol === "http:" &&
    (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1");
  if (parsedBaseUrl.protocol !== "https:" && !isLoopbackHttp) {
    throw new GasExampleConfigurationError();
  }

  if (environment === "development") {
    if (hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "::1") {
      throw new GasExampleConfigurationError();
    }
  } else if (
    parsedBaseUrl.protocol !== "https:" ||
    parsedBaseUrl.origin !== "https://api.testnet.velo.pay" ||
    parsedBaseUrl.pathname !== "/" ||
    parsedBaseUrl.search !== "" ||
    parsedBaseUrl.hash !== ""
  ) {
    throw new GasExampleConfigurationError();
  }

  return {
    apiKey,
    baseUrl: parsedBaseUrl.toString().replace(/\/+$/, ""),
    demoToken,
    environment,
  };
}
