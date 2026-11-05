import { afterEach, describe, expect, test, vi } from "vitest";

import type { VeloWalletClient, VeloWalletOption } from "./browser.js";

import { DEFAULT_WALLET_CONFIG, normalizeWalletAppearance } from "./config.js";
import { openWalletSelector } from "./wallet-selector.js";

const config = {
  ...DEFAULT_WALLET_CONFIG,
  appearance: normalizeWalletAppearance(DEFAULT_WALLET_CONFIG),
  network: "testnet" as const,
  modal: { showInstallLabel: true, hideUnsupportedWallets: false },
};

function mockClient(wallets: VeloWalletOption[], connect = vi.fn(async () => "GABC")) {
  return {
    getConfig: () => config,
    listWallets: vi.fn(async () => wallets),
    connect,
  } as unknown as VeloWalletClient;
}

afterEach(() => {
  document.querySelectorAll("dialog.velo-selector").forEach((dialog) => dialog.remove());
});

describe("Velo wallet selector", () => {
  test("shows bundled wallet marks, install links, and network context", async () => {
    const client = mockClient([
      {
        id: "freighter",
        name: "Freighter",
        logo: "data:image/png;base64,AA==",
        isAvailable: true,
        installUrl: "https://www.freighter.app/",
      },
      {
        id: "noir",
        name: "Noir",
        logo: "data:image/png;base64,AA==",
        isAvailable: false,
        installUrl: "https://example.test/noir",
      },
    ]);
    const result = openWalletSelector(client);
    await vi.waitFor(() =>
      expect(document.querySelectorAll(".velo-selector__row")).toHaveLength(2),
    );

    const dialog = document.querySelector<HTMLDialogElement>("dialog.velo-selector")!;
    expect(dialog.textContent).toContain("Stellar Testnet");
    expect(dialog.querySelectorAll('img[src^="data:image/png;base64,"]')).toHaveLength(2);
    expect(dialog.querySelector("a.velo-selector__install")?.getAttribute("rel")).toBe(
      "noopener noreferrer",
    );
    expect(dialog.querySelector("[data-status]")?.textContent).toContain("Choose a wallet");
    dialog.querySelector<HTMLButtonElement>(".velo-selector__close")?.click();
    await expect(result).resolves.toBeNull();
  });

  test("keeps the selector open after rejection and allows retry", async () => {
    const connect = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("Request was rejected in Freighter."))
      .mockResolvedValueOnce("GABC");
    const client = mockClient(
      [
        {
          id: "freighter",
          name: "Freighter",
          logo: "data:image/png;base64,AA==",
          isAvailable: true,
          installUrl: null,
        },
      ],
      connect,
    );
    const result = openWalletSelector(client);
    const dialog = document.querySelector<HTMLDialogElement>("dialog.velo-selector")!;
    const choose = () => dialog.querySelector<HTMLButtonElement>(".velo-selector__pick")!;
    await vi.waitFor(() => expect(choose().disabled).toBe(false));

    choose().click();
    await vi.waitFor(() => expect(dialog.textContent).toContain("Connection didn’t complete"));
    expect(dialog.textContent).toContain("Request was rejected in Freighter.");
    expect(dialog.open).toBe(true);

    choose().click();
    await expect(result).resolves.toBe("freighter");
    expect(connect).toHaveBeenCalledTimes(2);
  });

  test("closes cleanly when the user presses Escape", async () => {
    const client = mockClient([]);
    const result = openWalletSelector(client);
    const dialog = document.querySelector<HTMLDialogElement>("dialog.velo-selector")!;
    dialog.dispatchEvent(new Event("cancel", { cancelable: true }));

    await expect(result).resolves.toBeNull();
    expect(document.querySelector("dialog.velo-selector")).toBeNull();
  });
});
