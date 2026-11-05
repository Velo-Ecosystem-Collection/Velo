import { beforeEach, describe, expect, test, vi } from "vitest";

import { NOIR_ID, NoirModule, type NoirStellarProvider } from "./noir-module.js";

const ACCOUNT_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const OTHER_ACCOUNT_ADDRESS = "GA54SPC34JL3I57ENALTO2V26XOFFG4VGQLFQXDGF6KJ5TJY7ODY56ST";

function makeProvider(): NoirStellarProvider {
  return {
    isNoir: true,
    isConnected: vi.fn(async () => ({ isConnected: true })),
    isAllowed: vi.fn(async () => ({ isAllowed: true })),
    requestAccess: vi.fn(async () => ({ address: ACCOUNT_ADDRESS })),
    getAddress: vi.fn(async () => ({ address: OTHER_ACCOUNT_ADDRESS })),
    getNetwork: vi.fn(async () => ({
      network: "TESTNET",
      networkPassphrase: "Test SDF Network ; September 2015",
    })),
    signTransaction: vi.fn(async () => ({
      signedTxXdr: "SIGNED_XDR",
      signerAddress: ACCOUNT_ADDRESS,
    })),
    signAuthEntry: vi.fn(async () => ({
      signedAuthEntry: "SIGNED_AUTH",
      signerAddress: ACCOUNT_ADDRESS,
    })),
    signMessage: vi.fn(async () => ({
      signedMessage: "SIGNED_MESSAGE",
      signerAddress: ACCOUNT_ADDRESS,
    })),
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
    const noirModule = new NoirModule();
    expect(noirModule.productId).toBe(NOIR_ID);
    expect(noirModule.productName).toBe("Noir");
    expect(noirModule.productUrl).toBe(
      "https://chromewebstore.google.com/detail/noir/gikfhchijjljpbhokmdmaadgmpbchmjl",
    );
    expect(await noirModule.isAvailable()).toBe(false);
    await expect(noirModule.getAddress()).rejects.toMatchObject({ code: "WALLET_UNAVAILABLE" });
  });

  test("requests access on connect and reads an existing authorization without prompting", async () => {
    const provider = makeProvider();
    installProvider(provider);
    const noirModule = new NoirModule();

    await expect(noirModule.getAddress()).resolves.toEqual({ address: ACCOUNT_ADDRESS });
    await expect(noirModule.getAddress({ skipRequestAccess: true })).resolves.toEqual({
      address: OTHER_ACCOUNT_ADDRESS,
    });
    expect(provider.requestAccess).toHaveBeenCalledOnce();
    expect(provider.getAddress).toHaveBeenCalledOnce();
  });

  test("passes network and address to all SEP-43 signing methods", async () => {
    const provider = makeProvider();
    installProvider(provider);
    const noirModule = new NoirModule();
    const options = {
      networkPassphrase: "Test SDF Network ; September 2015",
      address: ACCOUNT_ADDRESS,
    };

    await expect(noirModule.signTransaction("XDR", options)).resolves.toEqual({
      signedTxXdr: "SIGNED_XDR",
      signerAddress: ACCOUNT_ADDRESS,
    });
    await expect(noirModule.signAuthEntry("ENTRY", options)).resolves.toEqual({
      signedAuthEntry: "SIGNED_AUTH",
      signerAddress: ACCOUNT_ADDRESS,
    });
    await expect(noirModule.signMessage("hello", options)).resolves.toEqual({
      signedMessage: "SIGNED_MESSAGE",
      signerAddress: ACCOUNT_ADDRESS,
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

  test("checks the live network before signing and rejects a changed signer account", async () => {
    const provider = makeProvider();
    installProvider(provider);
    const noirModule = new NoirModule();
    const options = {
      networkPassphrase: "Test SDF Network ; September 2015",
      address: ACCOUNT_ADDRESS,
    };

    vi.mocked(provider.getNetwork).mockResolvedValueOnce({
      network: "PUBLIC",
      networkPassphrase: "Public Global Stellar Network ; September 2015",
    });
    await expect(noirModule.signMessage("hello", options)).rejects.toMatchObject({
      code: "NETWORK_MISMATCH",
    });
    expect(provider.signMessage).not.toHaveBeenCalled();

    vi.mocked(provider.signTransaction).mockResolvedValueOnce({
      signedTxXdr: "SIGNED_XDR",
      signerAddress: OTHER_ACCOUNT_ADDRESS,
    });
    await expect(noirModule.signTransaction("XDR", options)).rejects.toMatchObject({
      code: "SESSION_STALE",
    });
  });

  test("rejects malformed provider addresses and signing responses", async () => {
    const provider = makeProvider();
    installProvider(provider);
    const noirModule = new NoirModule();

    vi.mocked(provider.requestAccess).mockResolvedValueOnce({ address: "GABC" });
    await expect(noirModule.getAddress()).rejects.toMatchObject({ code: "WALLET_UNAVAILABLE" });

    vi.mocked(provider.signMessage).mockResolvedValueOnce({
      signedMessage: " ",
      signerAddress: ACCOUNT_ADDRESS,
    });
    await expect(
      noirModule.signMessage("hello", {
        networkPassphrase: "Test SDF Network ; September 2015",
        address: ACCOUNT_ADDRESS,
      }),
    ).rejects.toThrow(/valid signed message/);
  });

  test("restores only an allowed matching account on the configured network", async () => {
    const provider = makeProvider();
    installProvider(provider);
    const noirModule = new NoirModule();
    const testnet = "Test SDF Network ; September 2015";

    await expect(noirModule.hasMatchingSession(OTHER_ACCOUNT_ADDRESS, testnet)).resolves.toBe(true);
    await expect(noirModule.hasMatchingSession(ACCOUNT_ADDRESS, testnet)).resolves.toBe(false);
    expect(provider.requestAccess).not.toHaveBeenCalled();
    vi.mocked(provider.getNetwork).mockResolvedValueOnce({
      network: "PUBLIC",
      networkPassphrase: "Public Global Stellar Network ; September 2015",
    });
    await expect(
      noirModule.hasMatchingSession(OTHER_ACCOUNT_ADDRESS, testnet),
    ).rejects.toMatchObject({
      code: "NETWORK_MISMATCH",
    });
  });
});
