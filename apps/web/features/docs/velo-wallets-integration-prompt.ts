export const veloWalletsIntegrationPrompt = `# Integrate Velo Wallets into this project

You are modifying an existing application. Inspect its instructions, framework, routing, styling, security headers, and current wallet or Stellar code before making changes. Implement a complete Velo Wallets integration that fits the existing architecture, then run the focused checks available in the repository.

## Start with Velo project setup

If the Velo project configuration is not ready, guide the developer through these steps in the Velo dashboard:

1. Select the project and open its Wallets page.
2. Keep the Testnet network while integrating. Select the wallets users may connect, configure the appearance, and add each allowed website origin exactly, including scheme and port. Origins have no path or wildcard.
3. Save the draft. The first save creates a public \`vw_pk_...\` project key; saving does not publish the draft.
4. Publish the revision and run the isolated Testnet diagnostics from the Wallets page before changing application code. If diagnostics reports \`ORIGIN_NOT_ALLOWED\`, add the exact origin shown, save, publish again, and repeat the check.

Use the project's generated integration snippet and public key. Never put a private Velo API key, wallet secret, or signing credential in browser code, a public environment variable, logs, or source examples.

## Choose a runtime that matches this application

- For React, use the published \`@carts1024/velo-wallets@1.0.0\` package from npm. In a Vite React app, mount \`VeloWalletProvider\` in the client-rendered component tree and render the app with React DOM; Vite does not need a \`"use client"\` directive. Copy both \`projectKey\` and \`apiBaseUrl\` from the Wallets page's generated React snippet. In Next.js App Router, keep wallet access below a \`"use client"\` boundary. In either setup, mount the provider only around the interface that needs wallet access. Prefer \`WalletWidget\` for the complete connected/status/error UI or \`ConnectButton\` for a trigger-only interface. Use \`useVeloWallet()\` for state and operations inside the provider.
- For plain HTML or a framework using custom elements, use the HTML snippet generated on the Velo Wallets page, including both its script URL and \`api-base\`. The current hosted runtime is \`https://www.velo-build.dev/wallets/v1/velo-wallet.js\` and supports all wallet IDs offered in project configuration, including Noir. A custom Velo host or copied older runtime may differ; verify it supports every configured wallet before publishing.
- If the project uses a custom Velo host, follow the generated snippet and existing deployment configuration instead of inventing an API URL.

Install the package with the package manager already used by the project:

\`\`\`sh
npm install @carts1024/velo-wallets
\`\`\`

For Vite + React, put the provider in the app component and use the exact values from the generated React snippet:

\`\`\`tsx
import { VeloWalletProvider, WalletWidget } from "@carts1024/velo-wallets/react";

export default function App() {
  return (
    <VeloWalletProvider
      projectKey="vw_pk_your_public_project_key"
      apiBaseUrl="https://www.velo-build.dev"
    >
      <WalletWidget />
    </VeloWalletProvider>
  );
}
\`\`\`

Render that component from the Vite React entry point, typically \`src/main.tsx\`:

\`\`\`tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
\`\`\`

For Next.js App Router, keep the client directive on the provider component:

\`\`\`tsx
"use client";

import { VeloWalletProvider, WalletWidget } from "@carts1024/velo-wallets/react";

export function WalletControls() {
  return (
    <VeloWalletProvider
      projectKey="vw_pk_your_public_project_key"
      apiBaseUrl="https://www.velo-build.dev"
    >
      <WalletWidget />
    </VeloWalletProvider>
  );
}
\`\`\`

For the Web Component, retain the generated CDN URL and project key:

\`\`\`html
<script type="module" src="https://www.velo-build.dev/wallets/v1/velo-wallet.js"></script>
<velo-wallet project-key="vw_pk_your_public_project_key" api-base="https://www.velo-build.dev"></velo-wallet>
\`\`\`

Listen for \`velo:wallet-connected\` and \`velo:wallet-error\` and use the documented element methods only after checking the component's available public API. If the app has a Content Security Policy, use the exact generated values for the wallet bundle in \`script-src\` and the configuration endpoint in \`connect-src\`.

## Connection and signing behavior

- Let the user initiate connection from an accessible control. Show connection, connected, disconnected, and error states; display or copy only the public account address.
- Handle wallet cancellation, unavailable wallets, network or account changes, unsupported signing methods, and retryable failures without losing the rest of the page.
- Construct transaction XDR using the application's existing Stellar flow, show the user what they are approving, and request a signature from the connected wallet only at the appropriate user action. Handle a rejected or failed signature explicitly.
- Signing stays in the user's browser. Velo Wallets does not receive signing inputs, verify the resulting transaction, or submit it. Keep transaction validation and submission in the application's existing trusted flow; never add server-side key handling.
- Do not switch to Mainnet as part of setup. Treat network changes as explicit user-facing state and preserve the application's existing transaction authorization rules.

## Finish and report

Use Testnet and a wallet the developer controls. Verify that the published configuration loads from an allowed origin, connection displays the expected public address, disconnect/reconnect works, and a safe message-signing request handles both approval and rejection. Exercise relevant error states and ensure the page remains usable on narrow screens and by keyboard. Do not submit a payment or real-value transaction as a documentation smoke test.

Update the existing docs or setup notes only where the integration changes them. Report the files changed, runtime choice, checks run, and any behavior that still needs a real wallet-extension check.`;
