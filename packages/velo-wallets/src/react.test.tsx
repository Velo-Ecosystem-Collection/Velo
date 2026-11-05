import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ConnectButton, VeloWalletProvider, WalletWidget } from "./react.js";

describe("React adapter", () => {
  it("imports and server-renders without accessing browser globals", () => {
    const html = renderToString(
      <VeloWalletProvider projectKey="vw_pk_00000000000000000000000000000000">
        <ConnectButton />
      </VeloWalletProvider>,
    );
    expect(html).toContain("Connect wallet");
    expect(html).toContain("data-velo-wallet-trigger");
    expect(html).toContain("background:#18181B");
  });

  it("server-renders the complete wallet widget with accessible status", () => {
    const html = renderToString(
      <VeloWalletProvider projectKey="vw_pk_00000000000000000000000000000000">
        <WalletWidget />
      </VeloWalletProvider>,
    );
    expect(html).toContain("data-velo-wallet-widget");
    expect(html).toContain('role="status"');
  });
});
