import { beforeEach, describe, expect, test, vi } from "vitest";

import { NOIR_ID, NoirModule, type NoirStellarProvider } from "./noir-module.js";

function makeProvider(): NoirStellarProvider {
  return {
    isNoir: true,
    isConnected: vi.fn(async () => ({ isConnected: true })),
    isAllowed: vi.fn(async () => ({ isAllowed: true })),
    requestAccess: vi.fn(async () => ({ address: "GACCESS" })),
    getAddress: vi.fn(async () => ({ address: "GADDRESS" })),
    getNetwork: vi.fn(async () => ({
      network: "TESTNET",
      networkPassphrase: "Test SDF Network ; September 2015",
    })),
    signTransaction: vi.fn(async () => ({ signedTxXdr: "SIGNED_XDR", signerAddress: "GSIGNER" })),
    signAuthEntry: vi.fn(async () => ({
      signedAuthEntry: "SIGNED_AUTH",
      signerAddress: "GSIGNER",
    })),
    signMessage: vi.fn(async () => ({ signedMessage: "SIGNED_MESSAGE", signerAddress: "GSIGNER" })),
  };
}

function installProvider(provider?: NoirStellarProvider) {
  if (provider)
    Object.defineProperty(window, "noir", { configurable: true, value: { stellar: provider } });
  else Reflect.deleteProperty(window, "noir");
}

describe("NoirModule", () => {
  beforeEach(() => installProvider());

  test("identifies the official provider and reports an unavailable extension", async () => {
    const module = new NoirModule();
    expect(module.productId).toBe(NOIR_ID);
    expect(module.productName).toBe("Noir");
    expect(module.productUrl).toBe(
      "https://chromewebstore.google.com/detail/noir/gikfhchijjljpbhokmdmaadgmpbchmjl",
    );
    expect(await module.isAvailable()).toBe(false);
    await expect(module.getAddress()).rejects.toMatchObject({ code: "WALLET_UNAVAILABLE" });
  });

  test("requests access on connect and reads an existing authorization without prompting", async () => {
    const provider = makeProvider();
    installProvider(provider);
    const module = new NoirModule();

    await expect(module.getAddress()).resolves.toEqual({ address: "GACCESS" });
    await expect(module.getAddress({ skipRequestAccess: true })).resolves.toEqual({
      address: "GADDRESS",
    });
    expect(provider.requestAccess).toHaveBeenCalledOnce();
    expect(provider.getAddress).toHaveBeenCalledOnce();
  });

  test("passes network and address to all SEP-43 signing methods", async () => {
    const provider = makeProvider();
    installProvider(provider);
    const module = new NoirModule();
    const options = {
      networkPassphrase: "Test SDF Network ; September 2015",
      address: "GSIGNER",
    };

    await expect(module.signTransaction("XDR", options)).resolves.toEqual({
      signedTxXdr: "SIGNED_XDR",
      signerAddress: "GSIGNER",
    });
    await expect(module.signAuthEntry("ENTRY", options)).resolves.toEqual({
      signedAuthEntry: "SIGNED_AUTH",
      signerAddress: "GSIGNER",
    });
    await expect(module.signMessage("hello", options)).resolves.toEqual({
      signedMessage: "SIGNED_MESSAGE",
      signerAddress: "GSIGNER",
    });
    expect(provider.signTransaction).toHaveBeenCalledWith("XDR", options);
    expect(provider.signAuthEntry).toHaveBeenCalledWith("ENTRY", options);
    expect(provider.signMessage).toHaveBeenCalledWith("hello", options);
  });

  test("preserves Noir user rejection errors", async () => {
    const provider = makeProvider();
    vi.mocked(provider.signMessage).mockResolvedValueOnce({
      error: { code: -4, message: "The user rejected this request." },
    });
    installProvider(provider);

    await expect(new NoirModule().signMessage("hello")).rejects.toMatchObject({
      code: -4,
      message: "The user rejected this request.",
    });
  });

  test("maps Noir network errors to Velo's network mismatch error", async () => {
    const provider = makeProvider();
    vi.mocked(provider.signTransaction).mockResolvedValueOnce({
      error: { code: -3, message: "Wrong network: expected Testnet." },
    });
    installProvider(provider);

    await expect(new NoirModule().signTransaction("XDR")).rejects.toMatchObject({
      code: "NETWORK_MISMATCH",
      message: "Wrong network: expected Testnet.",
    });
  });

  test("restores only an allowed matching account on the configured network", async () => {
    const provider = makeProvider();
    installProvider(provider);
    const module = new NoirModule();
    const testnet = "Test SDF Network ; September 2015";

    await expect(module.hasMatchingSession("GADDRESS", testnet)).resolves.toBe(true);
    await expect(module.hasMatchingSession("GOTHER", testnet)).resolves.toBe(false);
    expect(provider.requestAccess).not.toHaveBeenCalled();
    vi.mocked(provider.getNetwork).mockResolvedValueOnce({
      network: "PUBLIC",
      networkPassphrase: "Public Global Stellar Network ; September 2015",
    });
    await expect(module.hasMatchingSession("GADDRESS", testnet)).rejects.toMatchObject({
      code: "NETWORK_MISMATCH",
    });
  });
});
