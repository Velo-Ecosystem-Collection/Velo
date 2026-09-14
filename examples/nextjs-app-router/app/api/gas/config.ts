export type GasExampleEnvironment = {
  VELO_GAS_API_KEY?: string;
  VELO_BASE_URL?: string;
  VELO_GAS_DEMO_TOKEN?: string;
};

export type GasExampleConfig = {
  apiKey: string;
  baseUrl: string;
  demoToken: string;
};

export class GasExampleConfigurationError extends Error {
  constructor() {
    super("Gas example server configuration is invalid.");
    this.name = "GasExampleConfigurationError";
  }
}

const ASCII_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const MAX_DEMO_TOKEN_BYTES = 256;

export function isAsciiToken(value: string): boolean {
  return ASCII_TOKEN.test(value);
}

export function getGasExampleConfig(
  env: GasExampleEnvironment = {
    VELO_GAS_API_KEY: process.env.VELO_GAS_API_KEY,
    VELO_BASE_URL: process.env.VELO_BASE_URL,
    VELO_GAS_DEMO_TOKEN: process.env.VELO_GAS_DEMO_TOKEN,
  },
): GasExampleConfig {
  const apiKey = env.VELO_GAS_API_KEY?.trim();
  const demoToken = env.VELO_GAS_DEMO_TOKEN?.trim();
  const rawBaseUrl = env.VELO_BASE_URL?.trim();

  if (!apiKey || !demoToken || !rawBaseUrl || apiKey === demoToken) {
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

  return {
    apiKey,
    baseUrl: parsedBaseUrl.toString().replace(/\/+$/, ""),
    demoToken,
  };
}
