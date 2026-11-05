import { describe, expect, it, vi } from "vitest";

import { normalizeWalletAppearance, DEFAULT_WALLET_CONFIG } from "./config.js";

const mockClient = vi.hoisted(() => ({
  subscribe: vi.fn(() => () => undefined),
  initialize: vi.fn(async () => undefined),
  getState: vi.fn(() => ({
    status: "ready" as const,
    address: null,
    walletId: null,
    walletName: null,
    network: "testnet" as const,
    error: null,
  })),
  getConfig: vi.fn(),
  connect: vi.fn(async () => "GABC"),
  disconnect: vi.fn(async () => undefined),
  getAddress: vi.fn(() => null),
  signTransaction: vi.fn(async () => "signed"),
  signAuthEntry: vi.fn(async () => "signed"),
  signMessage: vi.fn(async () => "signed"),
}));

vi.mock("./browser.js", () => ({
  getSharedVeloWalletClient: () => mockClient,
  releaseSharedVeloWalletClient: vi.fn(),
}));

import { VeloWalletElement } from "./element.js";

describe("Velo Wallets Web Component", () => {
  it("registers once and renders accessible setup guidance without a key", () => {
    expect(customElements.get("velo-wallet")).toBe(VeloWalletElement);
    const element = document.createElement("velo-wallet");
    document.body.append(element);
    expect(element.shadowRoot?.querySelector('[role="alert"]')?.textContent).toContain(
      "project-key",
    );
    element.remove();
  });

  it("exposes stable parts and published appearance variables", async () => {
    mockClient.getConfig.mockReturnValue({
      appearance: normalizeWalletAppearance(DEFAULT_WALLET_CONFIG),
    });
    const element = document.createElement("velo-wallet");
    element.setAttribute("project-key", "vw_pk_00000000000000000000000000000000");
    document.body.append(element);
    await Promise.resolve();

    expect(element.shadowRoot?.querySelector('[part="container"]')).not.toBeNull();
    expect(element.shadowRoot?.querySelector('[part="trigger"]')?.textContent).toBe(
      "Connect wallet",
    );
    expect(element.shadowRoot?.querySelector('[part="status"]')).not.toBeNull();
    expect(element.shadowRoot?.innerHTML).toContain("--velo-config-accent:#18181B");
    element.remove();
  });
});
