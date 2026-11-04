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

function mockClient(
  wallets: VeloWalletOption[],
  connect = vi.fn(async () => "GABC"),
  configOverrides: { selectorLogo?: "velo" | "project" | "none"; projectLogoUrl?: string } = {},
) {
  return {
    getConfig: () => ({ ...config, ...configOverrides }),
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
    expect(dialog.textContent).toContain("Connect your wallet");
    expect(dialog.textContent).toContain("Powered by Velo Wallets");
    expect(dialog.querySelector(".velo-selector__brand")?.getAttribute("alt")).toBe("Velo");
    expect(dialog.querySelector<HTMLImageElement>(".velo-selector__brand")?.src).toBeTruthy();
    expect(dialog.querySelector(".velo-selector__list")?.getAttribute("role")).toBe("list");
    expect(dialog.classList.contains("velo-selector")).toBe(true);
    expect(dialog.textContent).not.toMatch(/email|social|passkey/i);
    const styles = dialog.querySelector("style")?.textContent ?? "";
    expect(styles).toContain("width: min(440px");
    expect(styles).toContain("@media (max-width: 480px)");
    expect(styles).toContain("border-radius: 999px");
    expect(
      dialog.querySelectorAll('.velo-selector__icon img[src^="data:image/png;base64,"]'),
    ).toHaveLength(2);
    expect(dialog.querySelector("a.velo-selector__install")?.getAttribute("rel")).toBe(
      "noopener noreferrer",
    );
    expect(dialog.querySelector("[data-status]")?.textContent).toContain("Choose a wallet");
    dialog.querySelector<HTMLButtonElement>(".velo-selector__close")?.click();
    await expect(result).resolves.toBeNull();
  });

  test("uses the uploaded project logo when selected", async () => {
    const client = mockClient([], undefined, {
      selectorLogo: "project",
      projectLogoUrl: "https://storage.example/project-logo.png",
    });
    const result = openWalletSelector(client);
    const dialog = document.querySelector<HTMLDialogElement>("dialog.velo-selector")!;
    const brand = dialog.querySelector<HTMLImageElement>(".velo-selector__brand")!;

    await vi.waitFor(() => expect(brand.src).toBe("https://storage.example/project-logo.png"));
    expect(brand.alt).toBe("Project logo");
    expect(brand.hidden).toBe(false);
    dialog.querySelector<HTMLButtonElement>(".velo-selector__close")?.click();
    await expect(result).resolves.toBeNull();
  });

  test("hides the selector logo for project-without-logo and no-logo settings", async () => {
    for (const selectorLogo of ["project", "none"] as const) {
      const result = openWalletSelector(mockClient([], undefined, { selectorLogo }));
      const dialog = document.querySelector<HTMLDialogElement>("dialog.velo-selector")!;
      const brand = dialog.querySelector<HTMLImageElement>(".velo-selector__brand")!;

      expect(brand.hidden).toBe(true);
      expect(brand.hasAttribute("src")).toBe(false);
      dialog.querySelector<HTMLButtonElement>(".velo-selector__close")?.click();
      await expect(result).resolves.toBeNull();
    }
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

  test("shows a retry when wallet discovery fails, then renders wallets after recovery", async () => {
    const listWallets = vi
      .fn<() => Promise<VeloWalletOption[]>>()
      .mockRejectedValueOnce(new Error("Network unavailable"))
      .mockResolvedValueOnce([
        {
          id: "freighter",
          name: "Freighter",
          logo: "data:image/png;base64,AA==",
          isAvailable: true,
          installUrl: null,
        },
      ]);
    const client = {
      ...mockClient([]),
      listWallets,
    } as unknown as VeloWalletClient;
    const result = openWalletSelector(client);
    const dialog = document.querySelector<HTMLDialogElement>("dialog.velo-selector")!;
    const retryButton = dialog.querySelector<HTMLButtonElement>("[data-retry]")!;

    await vi.waitFor(() => expect(retryButton.hidden).toBe(false));
    expect(dialog.textContent).toContain("Couldn’t load wallets");
    expect(dialog.textContent).toContain("Check your connection, then retry.");

    retryButton.click();
    await vi.waitFor(() => expect(dialog.querySelectorAll(".velo-selector__row")).toHaveLength(1));
    expect(listWallets).toHaveBeenCalledTimes(2);
    dialog.querySelector<HTMLButtonElement>(".velo-selector__close")?.click();
    await expect(result).resolves.toBeNull();
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
