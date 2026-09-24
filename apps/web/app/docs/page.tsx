"use client";

import { AppShell } from "@/core/app-shell";
import { GasIntegrationPromptCard } from "@/features/docs/gas-integration-prompt-card";
import { PaymentIntentsIntegrationPromptCard } from "@/features/docs/payment-intents-integration-prompt-card";
import { WebhookVerificationIntegrationPromptCard } from "@/features/docs/webhook-verification-integration-prompt-card";
import {
  CheckIcon,
  CopyIcon,
  InfoIcon,
  AlertTriangleIcon,
  ChevronRightIcon,
  HashIcon,
  KeyIcon,
  ShieldCheckIcon,
  WalletCardsIcon,
} from "lucide-react";
import React, { useRef, useState } from "react";

type SectionId =
  | "intro"
  | "install"
  | "config"
  | "checkouts"
  | "intents"
  | "gas-station"
  | "webhooks"
  | "nextjs"
  | "express"
  | "reference"
  | "wallets-overview"
  | "wallets-configure"
  | "wallets-html"
  | "wallets-react"
  | "wallets-reference";

interface DocSection {
  id: SectionId;
  title: string;
  category:
    | "Getting Started"
    | "Velo Wallets"
    | "SDK Reference"
    | "Guides & Examples"
    | "API Reference";
}

const SECTIONS: DocSection[] = [
  { id: "intro", title: "Introduction", category: "Getting Started" },
  { id: "install", title: "Installation", category: "Getting Started" },
  { id: "config", title: "Configuration", category: "Getting Started" },
  { id: "wallets-overview", title: "Wallets Quickstart", category: "Velo Wallets" },
  { id: "wallets-configure", title: "Configure & Publish", category: "Velo Wallets" },
  { id: "wallets-html", title: "Use with HTML", category: "Velo Wallets" },
  { id: "wallets-react", title: "Use with React", category: "Velo Wallets" },
  { id: "wallets-reference", title: "Methods & Troubleshooting", category: "Velo Wallets" },
  { id: "checkouts", title: "Checkout Sessions", category: "SDK Reference" },
  { id: "intents", title: "Payment Intents", category: "SDK Reference" },
  { id: "gas-station", title: "Gas Station", category: "SDK Reference" },
  { id: "webhooks", title: "Webhook Verification", category: "SDK Reference" },
  { id: "nextjs", title: "Next.js App Router", category: "Guides & Examples" },
  { id: "express", title: "Express Server", category: "Guides & Examples" },
  { id: "reference", title: "Errors & Limitations", category: "API Reference" },
];

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState<SectionId>("intro");
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const sectionHeadingRef = useRef<HTMLHeadingElement>(null);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(id);
    setTimeout(() => setCopiedText(null), 2000);
  };

  const selectSection = (id: SectionId) => {
    setActiveSection(id);
    window.requestAnimationFrame(() => sectionHeadingRef.current?.focus());
  };

  const currentSection = SECTIONS.find((s) => s.id === activeSection) || SECTIONS[0]!;

  const codeSnippets = {
    installNpm: `npm install @carts1024/velo-sdk`,
    installPnpm: `pnpm add @carts1024/velo-sdk`,
    installYarn: `yarn add @carts1024/velo-sdk`,
    initClient: `import { Velo } from "@carts1024/velo-sdk";

const velo = new Velo({
  apiKey: process.env.VELO_API_KEY!,
  environment: "testnet", // 'production' | 'testnet' | 'development'
  timeoutMs: 10000,       // optional timeout (default 10s)
});`,
    createCheckout: `const session = await velo.checkout.sessions.create(
  {
    amount: "10.00",
    asset: "USDC", // 'USDC' or 'native'
    description: "Order #1001",
    successUrl: "https://your-merchant-site.com/success",
    cancelUrl: "https://your-merchant-site.com/cancel",
  },
  {
    idempotencyKey: "order-1001-attempt-1", // Optional but highly recommended
  }
);

// Redirect the customer to: session.checkoutUrl`,
    retrieveIntent: `const intent = await velo.paymentIntents.retrieve("pi_12345");
console.log(\`Payment status: \${intent.status}\`);`,
    listIntents: `const page = await velo.paymentIntents.list({
  status: "paid",
  limit: 10,
  cursor: "opaque_cursor_value" // for pagination
});

console.log(\`Found \${page.data.length} payment intents.\`);
if (page.hasMore) {
  const nextCursor = page.nextCursor;
  // load next page...
}`,
    gasServerRoute: `// app/api/gas/route.ts
import { NextResponse } from "next/server";
import {
  Velo,
  VeloGasSubmissionUnknownError,
} from "@carts1024/velo-sdk";

const velo = new Velo({
  apiKey: process.env.VELO_GAS_API_KEY!,
  baseUrl: process.env.VELO_BASE_URL!,
  environment: "testnet",
  timeoutMs: 30_000,
});

export async function POST(request: Request) {
  // Authenticate the caller and authorize the project before reading the body.
  const body = (await request.json()) as {
    operationId?: string;
    signedTransactionXdr?: string;
  };
  const operationId = body.operationId?.trim();

  if (!operationId || !body.signedTransactionXdr) {
    return NextResponse.json({ error: "Invalid Gas request" }, { status: 400 });
  }

  try {
    const result = await velo.gas.sponsorAndSubmit(body.signedTransactionXdr, {
      idempotencyKey: "my-app-gas:" + operationId,
      correlationId: "my-app-gas:" + operationId,
      timeoutMs: 30_000,
    });

    return NextResponse.json({
      operationId,
      status: result.status,
      requestId: result.requestId,
      transactionHash: result.transactionHash,
      outerTransactionHash: result.outerTransactionHash,
      actualFeeStroops: result.actualFeeStroops,
    });
  } catch (error) {
    if (error instanceof VeloGasSubmissionUnknownError) {
      // Persist error.recovery and reconcile by identity. Never send the XDR again.
      const result = await velo.gas.getStatus(error.recovery);
      return NextResponse.json({ operationId, ...result });
    }

    throw error;
  }
}`,
    gasStatusRecovery: `import {
  Velo,
  type GasExecutionIdentity,
} from "@carts1024/velo-sdk";

const velo = new Velo({
  apiKey: process.env.VELO_GAS_API_KEY!,
  baseUrl: process.env.VELO_BASE_URL!,
  environment: "testnet",
});

// Store only this identity in your durable server record.
const identity: GasExecutionIdentity = {
  requestId: "gas-request-id",
  transactionHash: "64-character-inner-transaction-hash",
};

const status = await velo.gas.waitForResult(identity, {
  timeoutMs: 30_000,
  maxAttempts: 10,
  initialDelayMs: 500,
  maxDelayMs: 5_000,
});

if (status.status === "succeeded") {
  console.log(status.outerTransactionHash, status.actualFeeStroops);
}`,
    webhookVerify: `import { Velo } from "@carts1024/velo-sdk";

// rawBody must be the raw, unparsed request body string
const event = await Velo.webhooks.verify({
  payload: rawBody,
  signature: request.headers["x-velo-signature"],
  secret: process.env.VELO_WEBHOOK_SECRET!,
  toleranceSeconds: 300, // optional (defaults to 5 minutes)
});

if (event.type === "payment.succeeded") {
  const paymentIntent = event.paymentIntent;
  console.log(\`Payment succeeded! ID: \${paymentIntent.id}\`);
}`,
    nextjsCode: `// app/api/checkout/route.ts
import { NextResponse } from "next/server";
import { Velo } from "@carts1024/velo-sdk";

const velo = new Velo({
  apiKey: process.env.VELO_API_KEY!,
  environment: "testnet",
});

export async function POST() {
  try {
    const session = await velo.checkout.sessions.create({
      amount: "10.00",
      asset: "USDC",
      description: "Order #1001",
      successUrl: "https://yourdomain.com/success",
      cancelUrl: "https://yourdomain.com/cancel",
    }, {
      idempotencyKey: \`order-1001-\${Date.now()}\`
    });

    return NextResponse.json({ url: session.checkoutUrl });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Checkout error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}`,
    nextjsWebhook: `// app/api/webhook/route.ts
import { NextResponse } from "next/server";
import { Velo } from "@carts1024/velo-sdk";

export async function POST(request: Request) {
  // Retrieve the RAW body text for signature checking
  const payload = await request.text();
  const signature = request.headers.get("x-velo-signature");
  const secret = process.env.VELO_WEBHOOK_SECRET!;

  try {
    const event = await Velo.webhooks.verify({
      payload,
      signature,
      secret,
    });

    if (event.type === "payment.succeeded") {
      console.log(\`Order paid: \${event.paymentIntent.id}\`);
      // Fulfill order
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("Signature check failed:", err);
    return new NextResponse("Invalid Signature", { status: 400 });
  }
}`,
    expressCode: `// server.ts
import express from "express";
import { Velo } from "@carts1024/velo-sdk";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const velo = new Velo({ apiKey: process.env.VELO_API_KEY! });

app.use(express.json());

// 1. Checkout session route
app.post("/api/checkout", async (req, res) => {
  try {
    const session = await velo.checkout.sessions.create({
      amount: "10.00",
      asset: "USDC",
      description: "Order #1001",
      successUrl: "https://yourdomain.com/success",
      cancelUrl: "https://yourdomain.com/cancel",
    }, {
      idempotencyKey: req.body.orderId,
    });

    res.status(201).json({ url: session.checkoutUrl });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// 2. Webhook route capturing raw body string
app.post("/webhooks", express.raw({ type: "application/json" }), async (req, res) => {
  const payload = req.body.toString("utf8");
  const signature = req.headers["x-velo-signature"];
  const secret = process.env.VELO_WEBHOOK_SECRET!;

  try {
    const event = await Velo.webhooks.verify({
      payload,
      signature: Array.isArray(signature) ? signature[0] : signature || "",
      secret,
    });

    if (event.type === "payment.succeeded") {
      console.log(\`Paid: \${event.paymentIntent.id}\`);
    }

    res.status(200).send("OK");
  } catch (err) {
    res.status(400).send("Verification failed");
  }
});

app.listen(3001, () => console.log("Express server running on port 3001"));`,
    walletHtml: `<!-- Paste this where you want the wallet button to appear. -->
<script
  type="module"
  src="https://wallets.velo.dev/v1/velo-wallet.js"
></script>

<velo-wallet project-key="vw_pk_your_public_project_key"></velo-wallet>`,
    walletHtmlEvents: `const wallet = document.querySelector("velo-wallet");

wallet.addEventListener("velo:wallet-connected", (event) => {
  console.log("Connected address:", event.detail.address);
});

wallet.addEventListener("velo:wallet-error", (event) => {
  console.error(event.detail.error.code, event.detail.error.message);
});

// Call this after your app has created a Stellar transaction XDR.
async function requestSignature(transactionXdr) {
  const signedXdr = await wallet.signTransaction(transactionXdr);
  return signedXdr;
}`,
    walletReactInstall: `pnpm add @carts1024/velo-wallets`,
    walletReactProvider: `"use client";

import {
  VeloWalletProvider,
  WalletWidget,
} from "@carts1024/velo-wallets/react";

export function WalletControls() {
  return (
    <VeloWalletProvider projectKey="vw_pk_your_public_project_key">
      <WalletWidget />
    </VeloWalletProvider>
  );
}`,
    walletReactHook: `"use client";

import { useState } from "react";
import { useVeloWallet } from "@carts1024/velo-wallets/react";

export function ConnectedAccount() {
  const wallet = useVeloWallet();
  const [result, setResult] = useState("");
  const [isSigning, setIsSigning] = useState(false);

  async function signGreeting() {
    setIsSigning(true);
    setResult("Waiting for wallet approval…");
    try {
      await wallet.signMessage("Hello from my app");
      setResult("Message signed.");
    } catch (error) {
      setResult(error instanceof Error ? error.message : "Signing failed.");
    } finally {
      setIsSigning(false);
    }
  }

  if (wallet.status !== "connected") {
    return <p role="status">{wallet.error?.message ?? "Connect a wallet to continue."}</p>;
  }

  return (
    <div>
      <p>Address: {wallet.address}</p>
      <button onClick={signGreeting} disabled={isSigning}>
        {isSigning ? "Signing…" : "Sign message"}
      </button>
      <button onClick={() => wallet.disconnect()}>Disconnect</button>
      <p role="status" aria-live="polite">{result}</p>
    </div>
  );
}`,
    walletCsp: `Content-Security-Policy:
  script-src 'self' https://wallets.velo.dev;
  connect-src 'self' https://wallets.velo.dev;`,
  };

  const categories = Array.from(new Set(SECTIONS.map((s) => s.category)));

  const renderCodeBlock = (code: string, id: string) => {
    const isCopied = copiedText === id;
    return (
      <div className="group relative my-4 overflow-hidden rounded-lg border border-border bg-muted/70 backdrop-blur-sm">
        <div className="absolute top-2 right-2 z-10 opacity-100 transition-opacity md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
          <button
            onClick={() => handleCopy(code, id)}
            aria-label="Copy code to clipboard"
            className="flex h-8 w-8 items-center justify-center rounded border border-border bg-background text-muted-foreground shadow-sm transition-all hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            title="Copy to clipboard"
          >
            {isCopied ? (
              <CheckIcon size={14} className="text-emerald-500" />
            ) : (
              <CopyIcon size={14} />
            )}
          </button>
          <span className="sr-only" role="status" aria-live="polite">
            {isCopied ? "Code copied to clipboard." : ""}
          </span>
        </div>
        <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-relaxed text-foreground select-all">
          {code}
        </pre>
      </div>
    );
  };

  return (
    <AppShell>
      <div className="flex min-w-0 flex-col gap-6 rounded-xl border border-border bg-card p-4 font-sans text-card-foreground selection:bg-primary selection:text-primary-foreground md:flex-row md:gap-8 md:p-8">
        {/* Left Sidebar */}
        <aside className="w-full min-w-0 shrink-0 border-b border-border pb-5 md:sticky md:top-24 md:h-[calc(100dvh-220px)] md:w-64 md:overflow-y-auto md:border-r md:border-b-0 md:pr-6 md:pb-0">
          <label
            htmlFor="mobile-doc-section"
            className="mb-2 block font-mono text-xs font-semibold tracking-wider text-muted-foreground uppercase md:hidden"
          >
            Documentation section
          </label>
          <select
            id="mobile-doc-section"
            value={activeSection}
            onChange={(event) => selectSection(event.target.value as SectionId)}
            className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:hidden"
          >
            {categories.map((category) => (
              <optgroup key={category} label={category}>
                {SECTIONS.filter((section) => section.category === category).map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.title}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <nav className="hidden space-y-6 md:block" aria-label="Documentation sections">
            {categories.map((cat) => (
              <div key={cat} className="space-y-2">
                <h3 className="font-mono text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                  {cat}
                </h3>
                <ul className="space-y-1">
                  {SECTIONS.filter((s) => s.category === cat).map((s) => {
                    const isActive = s.id === activeSection;
                    return (
                      <li key={s.id}>
                        <button
                          onClick={() => selectSection(s.id)}
                          aria-current={isActive ? "page" : undefined}
                          className={`flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-sm transition-all ${
                            isActive
                              ? "border-l-2 border-zinc-950 bg-zinc-100 font-medium text-zinc-950 dark:border-white dark:bg-zinc-900 dark:text-white"
                              : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900/40 dark:hover:text-zinc-200"
                          }`}
                        >
                          <span>{s.title}</span>
                          {isActive && (
                            <ChevronRightIcon
                              size={12}
                              className="text-zinc-500 dark:text-zinc-400"
                            />
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </aside>

        {/* Content Panel */}
        <div className="min-w-0 flex-1 pb-16">
          <div className="mb-2 flex flex-wrap items-center gap-1.5 font-mono text-xs text-muted-foreground">
            <span>Docs</span>
            <ChevronRightIcon size={10} />
            <span>{currentSection.category}</span>
            <ChevronRightIcon size={10} />
            <span className="text-foreground">{currentSection.title}</span>
          </div>

          <h1
            ref={sectionHeadingRef}
            tabIndex={-1}
            className="mb-6 text-3xl font-bold tracking-tight text-foreground outline-none sm:text-4xl"
          >
            {currentSection.title}
          </h1>

          {/* Render Active Section Content */}
          <div className="prose max-w-none space-y-6 text-sm leading-relaxed text-zinc-700 sm:text-base dark:text-zinc-300">
            {activeSection === "intro" && (
              <>
                <p>
                  Welcome to the **Velo SDK for Node.js** documentation. The Velo SDK is a
                  server-side alpha package designed to streamline checkout session creation,
                  payment state verification, and webhook handling.
                </p>
                <p>
                  By wrapping Velo's secure REST endpoints, the SDK allows you to handle stablecoin
                  payments (like USDC) on Stellar without exposing raw keys to frontend code,
                  dealing with direct HTTP headers, or leaking project details to users.
                </p>

                <div className="my-6 flex gap-3 rounded-xl border border-border bg-muted/50 p-4">
                  <InfoIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                  <div className="text-sm">
                    <strong className="mb-1 block text-foreground">Target Developer Journey</strong>
                    Initialize a Velo client on your server and generate secure payment links in
                    seconds:
                  </div>
                </div>

                {renderCodeBlock(
                  `import { Velo } from "@carts1024/velo-sdk";

const velo = new Velo({ apiKey: process.env.VELO_API_KEY! });
const session = await velo.checkout.sessions.create({
  amount: "10.00",
  asset: "USDC",
  description: "Order #1001"
});

// redirect the user to session.checkoutUrl`,
                  "introDemo",
                )}

                <h3 className="mt-8 mb-3 flex items-center gap-2 text-lg font-bold text-foreground">
                  <HashIcon size={16} className="text-muted-foreground" />
                  Key Features
                </h3>
                <ul className="list-disc space-y-2 pl-6 text-zinc-600 dark:text-zinc-400">
                  <li>
                    **Class-Based API Client**: Strongly typed request validation and normalization.
                  </li>
                  <li>
                    **Secure Webhook Signatures**: Built-in HMAC-SHA256 timestamped verification.
                  </li>
                  <li>
                    **Idempotent API Requests**: Avoid duplicate charges during transaction retries.
                  </li>
                  <li>
                    **Cursor Pagination**: Seamless listing and reconciliation of payment intents.
                  </li>
                </ul>
              </>
            )}

            {activeSection === "install" && (
              <>
                <p>
                  Install the Velo SDK into your server environment using your favorite package
                  manager:
                </p>

                <h4 className="mt-6 font-mono text-sm font-semibold text-muted-foreground uppercase">
                  npm
                </h4>
                {renderCodeBlock(codeSnippets.installNpm, "npmInstall")}

                <h4 className="mt-6 font-mono text-sm font-semibold text-muted-foreground uppercase">
                  pnpm
                </h4>
                {renderCodeBlock(codeSnippets.installPnpm, "pnpmInstall")}

                <h4 className="mt-6 font-mono text-sm font-semibold text-muted-foreground uppercase">
                  Yarn
                </h4>
                {renderCodeBlock(codeSnippets.installYarn, "yarnInstall")}

                <div className="my-6 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300">
                  <AlertTriangleIcon className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-500" />
                  <div className="text-sm">
                    <strong>Server-Side Only Requirement</strong>
                    <p className="mt-1">
                      This package uses sensitive API credentials and is meant for **Node.js 18+
                      server environments only**. Do not include this SDK in frontend code or client
                      bundles as it will expose your private key to the web.
                    </p>
                  </div>
                </div>
              </>
            )}

            {activeSection === "config" && (
              <>
                <p>
                  To use the SDK, import `Velo` and initialize the client constructor. You must
                  supply your private API key (`VELO_API_KEY`).
                </p>

                {renderCodeBlock(codeSnippets.initClient, "initDemo")}

                <h3 className="mt-8 mb-4 text-lg font-bold text-foreground">
                  Client Initialization Configuration
                </h3>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="min-w-full divide-y divide-border text-left text-sm">
                    <thead className="bg-muted/70 font-mono text-xs text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3">Property</th>
                        <th className="px-4 py-3">Type</th>
                        <th className="px-4 py-3">Required</th>
                        <th className="px-4 py-3">Description</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      <tr>
                        <td className="px-4 py-3 font-mono font-semibold text-foreground">
                          apiKey
                        </td>
                        <td className="px-4 py-3 font-mono text-muted-foreground">string</td>
                        <td className="px-4 py-3 text-red-600 dark:text-red-500">Yes</td>
                        <td className="px-4 py-3">
                          Your private Velo project key. (e.g. `tk_live_...`)
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-3 font-mono text-foreground">environment</td>
                        <td className="px-4 py-3 font-mono text-muted-foreground">
                          "production" | "testnet" | "development"
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">No</td>
                        <td className="px-4 py-3">
                          Defaults to `"testnet"`. Routes requests to the corresponding backend
                          network.
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-3 font-mono text-foreground">baseUrl</td>
                        <td className="px-4 py-3 font-mono text-muted-foreground">string</td>
                        <td className="px-4 py-3 text-muted-foreground">No</td>
                        <td className="px-4 py-3">
                          Overrides the target API server URL. Mainly used for local development and
                          sandbox setups.
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-3 font-mono text-foreground">timeoutMs</td>
                        <td className="px-4 py-3 font-mono text-muted-foreground">number</td>
                        <td className="px-4 py-3 text-muted-foreground">No</td>
                        <td className="px-4 py-3">
                          Specifies maximum connection wait time (defaults to `10000` / 10s).
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {activeSection === "wallets-overview" && (
              <>
                <p>
                  Velo Wallets adds a multi-wallet connect button to your Stellar application. You
                  choose the wallets and appearance in Velo, publish the settings, and then paste a
                  small HTML or React integration into your app.
                </p>

                <div className="my-6 flex gap-3 rounded-xl border border-border bg-muted/50 p-4">
                  <WalletCardsIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                  <div className="text-sm">
                    <strong className="mb-1 block text-foreground">
                      Velo Wallets and the Velo SDK solve different tasks
                    </strong>
                    Velo Wallets runs in the browser and lets a user connect or sign with their own
                    Stellar wallet. The Velo SDK runs on your server and uses a private API key for
                    payments and webhooks. Never put a private Velo API key in a wallet component.
                  </div>
                </div>

                <h3 className="mt-8 mb-4 text-lg font-bold text-foreground">
                  The beginner workflow
                </h3>
                <ol className="grid list-none gap-3 pl-0 sm:grid-cols-3">
                  <li className="rounded-lg border border-border p-4">
                    <span className="mb-2 block font-mono text-xs text-muted-foreground">
                      STEP 1
                    </span>
                    <strong className="block text-foreground">Configure</strong>
                    Choose Testnet, wallets, styling, and the websites allowed to use your
                    integration.
                  </li>
                  <li className="rounded-lg border border-border p-4">
                    <span className="mb-2 block font-mono text-xs text-muted-foreground">
                      STEP 2
                    </span>
                    <strong className="block text-foreground">Publish</strong>
                    Your first save creates the public project key. Publishing makes an immutable
                    configuration revision live.
                  </li>
                  <li className="rounded-lg border border-border p-4">
                    <span className="mb-2 block font-mono text-xs text-muted-foreground">
                      STEP 3
                    </span>
                    <strong className="block text-foreground">Test, then paste</strong>
                    Run the isolated Testnet diagnostics first, then copy the generated HTML or
                    React snippet into your app.
                  </li>
                </ol>

                <h3 className="mt-8 mb-3 text-lg font-bold text-foreground">
                  What your users can do
                </h3>
                <ul className="list-disc space-y-2 pl-6 text-zinc-600 dark:text-zinc-400">
                  <li>Choose from the Stellar wallets you enabled.</li>
                  <li>Connect, view, copy, and disconnect their public account.</li>
                  <li>Detect account or wallet changes made in the selected wallet.</li>
                  <li>Sign transaction XDR, Soroban authorization entries, and messages.</li>
                  <li>Restore a previous connection when session persistence is enabled.</li>
                </ul>

                <div className="my-6 flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-300">
                  <ShieldCheckIcon className="mt-0.5 size-5 shrink-0 text-emerald-600" />
                  <div className="text-sm">
                    <strong>Signing stays in the browser</strong>
                    <p className="mt-1">
                      Velo does not receive your transaction XDR, authorization entry, message, or
                      signature. The selected wallet handles every signing request locally.
                    </p>
                  </div>
                </div>
              </>
            )}

            {activeSection === "wallets-configure" && (
              <>
                <p>
                  Start on Testnet even if your final application will use Mainnet. You can verify
                  the whole connection flow without risking real assets.
                </p>

                <h3 className="mt-8 mb-4 text-lg font-bold text-foreground">
                  Configure your first integration
                </h3>
                <ol className="list-decimal space-y-4 pl-6 text-zinc-600 dark:text-zinc-400">
                  <li>
                    <strong className="text-foreground">Connect the project owner wallet.</strong>{" "}
                    Open the Velo dashboard and select the project that will use the integration.
                  </li>
                  <li>
                    <strong className="text-foreground">Open Wallets.</strong> Choose the{" "}
                    <strong>Wallets</strong> item in the project sidebar.
                  </li>
                  <li>
                    <strong className="text-foreground">Keep the Testnet preset.</strong> The safe
                    preset enables Freighter, follows the system theme, restores sessions, and
                    allows <code>http://localhost:3000</code>.
                  </li>
                  <li>
                    <strong className="text-foreground">Choose supported wallets.</strong> Enable
                    only the wallets you want users to see. Keep at least one selected.
                  </li>
                  <li>
                    <strong className="text-foreground">Customize the button.</strong> Select a
                    light, dark, or system theme and enter a label between 1 and 40 characters.
                  </li>
                  <li>
                    <strong className="text-foreground">Add allowed origins.</strong> Enter one
                    exact website origin per line. Include the scheme and port when one is used.
                  </li>
                  <li>
                    <strong className="text-foreground">Save draft.</strong> This validates and
                    stores your work and creates the public project key on the first save. It does
                    not change the version used by live applications.
                  </li>
                  <li>
                    <strong className="text-foreground">Publish revision.</strong> Review the
                    summary and confirm. After publication, the page displays ready-to-copy
                    integration snippets and enables the diagnostics link.
                  </li>
                </ol>

                <h3 className="mt-8 mb-4 text-lg font-bold text-foreground">
                  Allowed-origin examples
                </h3>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="min-w-full divide-y divide-border text-left text-sm">
                    <thead className="bg-muted/70 font-mono text-xs text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3">Value</th>
                        <th className="px-4 py-3">Result</th>
                        <th className="px-4 py-3">Why</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      <tr>
                        <td className="px-4 py-3 font-mono">http://localhost:3000</td>
                        <td className="px-4 py-3 text-emerald-600">Valid for Testnet</td>
                        <td className="px-4 py-3">Exact local origin, including its port.</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-3 font-mono">https://app.example.com</td>
                        <td className="px-4 py-3 text-emerald-600">Valid</td>
                        <td className="px-4 py-3">Secure production origin without a path.</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-3 font-mono">https://app.example.com/wallet</td>
                        <td className="px-4 py-3 text-red-600">Invalid</td>
                        <td className="px-4 py-3">Origins cannot contain paths.</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-3 font-mono">https://*.example.com</td>
                        <td className="px-4 py-3 text-red-600">Invalid</td>
                        <td className="px-4 py-3">Wildcards are intentionally unsupported.</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="my-6 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300">
                  <AlertTriangleIcon className="mt-0.5 size-5 shrink-0 text-amber-600" />
                  <div className="text-sm">
                    <strong>Mainnet requires extra confirmation</strong>
                    <p className="mt-1">
                      Add at least one non-local HTTPS origin, save the draft, review the
                      publication summary, and type <code>MAINNET</code> when prompted. Complete
                      Testnet diagnostics before making this change.
                    </p>
                  </div>
                </div>

                <p>
                  Publishing a later revision updates consuming applications the next time they
                  load. You do not need to paste a new snippet or redeploy the consuming app as long
                  as its public project key stays the same.
                </p>
              </>
            )}

            {activeSection === "wallets-html" && (
              <>
                <p>
                  The Web Component is the quickest option for plain HTML, JavaScript, and frontend
                  frameworks that support custom elements. It requires no package installation.
                </p>

                <div className="my-6 flex gap-3 rounded-xl border border-border bg-muted/50 p-4">
                  <InfoIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                  <div className="text-sm">
                    <strong className="mb-1 block text-foreground">
                      1. Test the publication before editing your app
                    </strong>
                    While the published network is Testnet, open the diagnostics link in the Wallets
                    panel and complete its guided checks. If it reports{" "}
                    <code>ORIGIN_NOT_ALLOWED</code>, add the exact Velo preview origin shown by your
                    browser, save, and publish again. The safe transaction check is Testnet-only.
                  </div>
                </div>

                <h3 className="mt-8 mb-3 text-lg font-bold text-foreground">
                  2. Copy the generated snippet
                </h3>
                <p>
                  In your project&apos;s Wallets panel, open the <strong>HTML</strong> tab and copy
                  the snippet. It contains your real public project key and Velo&apos;s configured
                  CDN URL. The following placeholder shows its shape:
                </p>
                {renderCodeBlock(codeSnippets.walletHtml, "walletHtml")}

                <p>
                  Paste it inside the page or component where the connect button should appear. Do
                  not replace the <code>vw_pk_...</code> value with a private Velo API key.
                </p>

                <h3 className="mt-8 mb-3 text-lg font-bold text-foreground">
                  3. Listen for connection events or request a signature
                </h3>
                {renderCodeBlock(codeSnippets.walletHtmlEvents, "walletHtmlEvents")}

                <h3 className="mt-8 mb-3 text-lg font-bold text-foreground">
                  4. Update your Content Security Policy
                </h3>
                <p>
                  If your site uses CSP, allow the generated CDN in <code>script-src</code> and the
                  Velo configuration endpoint in <code>connect-src</code>. Copy the exact policy
                  values shown in the Wallets panel. A typical hosted setup looks like this:
                </p>
                {renderCodeBlock(codeSnippets.walletCsp, "walletCsp")}

                <h3 className="mt-8 mb-3 text-lg font-bold text-foreground">
                  5. Verify in your application
                </h3>
                <ol className="list-decimal space-y-2 pl-6 text-zinc-600 dark:text-zinc-400">
                  <li>Open your app from an origin included in the Wallets panel.</li>
                  <li>Confirm the configured connect button appears.</li>
                  <li>Connect a funded Testnet wallet and confirm its public address.</li>
                  <li>Sign a test message, then disconnect and reconnect.</li>
                  <li>Reject a signing request once and confirm your interface allows a retry.</li>
                </ol>
              </>
            )}

            {activeSection === "wallets-react" && (
              <>
                <p>
                  Use the React adapter when your interface needs wallet state in several
                  components. It uses the same runtime, wallet order, methods, and errors as the Web
                  Component. <code>WalletWidget</code> renders the published connect, connected,
                  copy, disconnect, status, and error design; <code>ConnectButton</code> remains
                  available when only a trigger is needed.
                </p>

                <div className="my-6 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300">
                  <AlertTriangleIcon className="mt-0.5 size-5 shrink-0 text-amber-600" />
                  <div className="text-sm">
                    <strong>Staged alpha package</strong>
                    <p className="mt-1">
                      Public npm activation may not be available during the alpha. Repository
                      contributors can use the workspace package. External builders can use the
                      hosted Web Component until npm publication is enabled.
                    </p>
                  </div>
                </div>
                <h3 className="mt-8 mb-3 text-lg font-bold text-foreground">
                  1. Install the browser package
                </h3>
                {renderCodeBlock(codeSnippets.walletReactInstall, "walletReactInstall")}

                <h3 className="mt-8 mb-3 text-lg font-bold text-foreground">
                  2. Add the provider at a client boundary
                </h3>
                <p>
                  In Next.js App Router, keep the <code>&quot;use client&quot;</code> line. Mount
                  the provider around only the part of the interface that needs wallet access.
                </p>
                {renderCodeBlock(codeSnippets.walletReactProvider, "walletReactProvider")}

                <h3 className="mt-8 mb-3 text-lg font-bold text-foreground">
                  3. Read state and call wallet methods
                </h3>
                <p>
                  A component inside <code>VeloWalletProvider</code> can call{" "}
                  <code>useVeloWallet()</code>. Always check the status before asking the user to
                  sign.
                </p>
                {renderCodeBlock(codeSnippets.walletReactHook, "walletReactHook")}

                <div className="my-6 flex gap-3 rounded-xl border border-border bg-muted/50 p-4">
                  <InfoIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                  <div className="text-sm">
                    <strong className="mb-1 block text-foreground">
                      Using a custom Velo host?
                    </strong>
                    Pass <code>apiBaseUrl=&quot;https://your-velo-host.example&quot;</code> to the
                    provider. Most hosted integrations should omit this prop and use the default
                    Velo endpoint. The generated React snippet already includes it when necessary.
                  </div>
                </div>
              </>
            )}

            {activeSection === "wallets-reference" && (
              <>
                <p>
                  Both integrations expose the same core operations. A wallet can support
                  transaction signing but not every advanced signing method, so handle rejected and
                  unsupported requests in your interface.
                </p>

                <h3 className="mt-8 mb-4 text-lg font-bold text-foreground">Available methods</h3>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="min-w-full divide-y divide-border text-left text-sm">
                    <thead className="bg-muted/70 font-mono text-xs text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3">Method</th>
                        <th className="px-4 py-3">Purpose</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      <tr>
                        <td className="px-4 py-3 font-mono">connect(): Promise&lt;string&gt;</td>
                        <td className="px-4 py-3">
                          Open wallet selection and return the connected public address.
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-3 font-mono">disconnect(): Promise&lt;void&gt;</td>
                        <td className="px-4 py-3">
                          Clear the active wallet connection and saved session.
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-3 font-mono">
                          getAddress(): Promise&lt;string | null&gt;
                        </td>
                        <td className="px-4 py-3">
                          Return the current public address, or null when disconnected.
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-3 font-mono">
                          signTransaction(xdr): Promise&lt;string&gt;
                        </td>
                        <td className="px-4 py-3">
                          Ask the wallet to sign an existing Stellar transaction XDR.
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-3 font-mono">
                          signAuthEntry(entry): Promise&lt;string&gt;
                        </td>
                        <td className="px-4 py-3">
                          Ask a compatible wallet to sign a Soroban authorization entry.
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-3 font-mono">
                          signMessage(message): Promise&lt;string&gt;
                        </td>
                        <td className="px-4 py-3">
                          Ask a compatible wallet to sign a plain-text message.
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <h3 className="mt-8 mb-3 text-lg font-bold text-foreground">
                  Web Component events
                </h3>
                <ul className="space-y-2 pl-0 text-zinc-600 dark:text-zinc-400">
                  <li>
                    <code>velo:wallet-ready</code> — configuration loaded; detail is{" "}
                    <code>{"{ version: 1 }"}</code>.
                  </li>
                  <li>
                    <code>velo:wallet-connected</code> — detail contains{" "}
                    <code>{"{ version: 1, address }"}</code>.
                  </li>
                  <li>
                    <code>velo:wallet-disconnected</code> — the active session disconnected; detail
                    contains <code>{"{ version: 1 }"}</code>.
                  </li>
                  <li>
                    <code>velo:wallet-changed</code> — account, wallet, network, or status changed;
                    detail contains <code>{"{ version: 1, state }"}</code>.
                  </li>
                  <li>
                    <code>velo:wallet-error</code> — the operation failed; detail contains{" "}
                    <code>{"{ version: 1, error }"}</code>.
                  </li>
                </ul>

                <div className="my-6 flex gap-3 rounded-xl border border-border bg-muted/50 p-4">
                  <InfoIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                  <div className="text-sm">
                    <strong className="mb-1 block text-foreground">
                      Use one project key per browser document
                    </strong>
                    Multiple elements and React consumers can share the same project key and
                    runtime. Loading conflicting project keys in one document is rejected.
                  </div>
                </div>

                <h3 className="mt-8 mb-4 text-lg font-bold text-foreground">
                  Common problems and fixes
                </h3>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="min-w-full divide-y divide-border text-left text-sm">
                    <thead className="bg-muted/70 font-mono text-xs text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3">Error</th>
                        <th className="px-4 py-3">What to do</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      <tr>
                        <td className="px-4 py-3 font-mono">CONFIG_NOT_FOUND</td>
                        <td className="px-4 py-3">
                          Check the public project key and publish the draft.
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-3 font-mono">CONFIG_DISABLED</td>
                        <td className="px-4 py-3">
                          Enable the last published revision in the Wallets panel.
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-3 font-mono">CONFIG_INCOMPATIBLE</td>
                        <td className="px-4 py-3">
                          Update the runtime URL or package so its major version matches the
                          publication.
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-3 font-mono">RUNTIME_INIT_FAILED</td>
                        <td className="px-4 py-3">
                          Verify the project key, CDN, CSP, and configuration endpoint, then reload.
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-3 font-mono">ORIGIN_NOT_ALLOWED</td>
                        <td className="px-4 py-3">
                          Add the browser&apos;s exact origin, save, and publish a new revision.
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-3 font-mono">WALLET_UNAVAILABLE</td>
                        <td className="px-4 py-3">
                          Install or open one of the enabled wallets, then retry.
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-3 font-mono">CONNECTION_REJECTED</td>
                        <td className="px-4 py-3">
                          The user declined connection; keep the connect action available.
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-3 font-mono">POPUP_BLOCKED</td>
                        <td className="px-4 py-3">
                          Allow popups for the app and start connection from a direct user click.
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-3 font-mono">NETWORK_MISMATCH</td>
                        <td className="px-4 py-3">
                          Switch the wallet to the Testnet or Mainnet selected in Velo.
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-3 font-mono">SESSION_STALE</td>
                        <td className="px-4 py-3">
                          Reconnect the wallet to refresh its saved session.
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-3 font-mono">WALLET_METHOD_UNSUPPORTED</td>
                        <td className="px-4 py-3">
                          Use a compatible wallet or hide that action for this wallet.
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-3 font-mono">SIGNING_REJECTED</td>
                        <td className="px-4 py-3">
                          Explain the request and let the user safely retry.
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-3 font-mono">SIGNING_FAILED</td>
                        <td className="px-4 py-3">
                          Keep the unsigned input, show the wallet error, and allow a safe retry.
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="my-6 flex gap-3 rounded-xl border border-border bg-muted/50 p-4">
                  <InfoIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                  <div className="text-sm">
                    <strong className="mb-1 block text-foreground">Still stuck?</strong>
                    Open the isolated diagnostics page from your project&apos;s Wallets panel. It
                    checks configuration loading, connection, network, message signing, disconnect,
                    and reconnect. Run its transaction-signing check only while the published
                    network is Testnet; the generated XDR is never submitted. If the preview reports{" "}
                    <code>ORIGIN_NOT_ALLOWED</code>, add the preview page&apos;s exact origin and
                    publish a new revision.
                  </div>
                </div>
              </>
            )}

            {activeSection === "checkouts" && (
              <>
                <p>
                  Checkout sessions are the easiest way to accept payments. By creating a checkout
                  session, you generate a secure hosted Velo checkout URL where customers connect
                  their wallet, sign, and pay on-chain.
                </p>

                <PaymentIntentsIntegrationPromptCard />

                {renderCodeBlock(codeSnippets.createCheckout, "createCheckoutDemo")}

                <h3 className="mt-8 mb-4 text-lg font-bold text-foreground">Request Parameters</h3>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="min-w-full divide-y divide-border text-left text-sm">
                    <thead className="bg-muted/70 font-mono text-xs text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3">Parameter</th>
                        <th className="px-4 py-3">Type</th>
                        <th className="px-4 py-3">Required</th>
                        <th className="px-4 py-3">Description</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      <tr>
                        <td className="px-4 py-3 font-mono font-semibold text-foreground">
                          amount
                        </td>
                        <td className="px-4 py-3 font-mono text-muted-foreground">string</td>
                        <td className="px-4 py-3 text-red-600 dark:text-red-500">Yes</td>
                        <td className="px-4 py-3">
                          The dollar amount to charge. Must be positive (e.g. `"10.00"`).
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-3 font-mono text-foreground">asset</td>
                        <td className="px-4 py-3 font-mono text-muted-foreground">string</td>
                        <td className="px-4 py-3 text-muted-foreground">No</td>
                        <td className="px-4 py-3">
                          Defaults to `"USDC"`. Asset to charge. Can be `"USDC"` or `"native"`
                          (XLM).
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-3 font-mono text-foreground">description</td>
                        <td className="px-4 py-3 font-mono text-muted-foreground">string</td>
                        <td className="px-4 py-3 text-muted-foreground">No</td>
                        <td className="px-4 py-3">
                          Order metadata shown to the user during checkout (e.g. `"Order #1001"`).
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-3 font-mono text-foreground">successUrl</td>
                        <td className="px-4 py-3 font-mono text-muted-foreground">string</td>
                        <td className="px-4 py-3 text-muted-foreground">No</td>
                        <td className="px-4 py-3">
                          URL to redirect the customer to after a successful transaction.
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-3 font-mono text-foreground">cancelUrl</td>
                        <td className="px-4 py-3 font-mono text-muted-foreground">string</td>
                        <td className="px-4 py-3 text-muted-foreground">No</td>
                        <td className="px-4 py-3">
                          URL to redirect the customer to if they cancel checkout.
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="my-6 flex gap-3 rounded-xl border border-border bg-muted/50 p-4">
                  <KeyIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                  <div className="text-sm">
                    <strong className="mb-1 block text-foreground">Idempotency-Key Option</strong>
                    To avoid duplicate sessions or payments under network failures, supply an
                    optional `idempotencyKey` inside the second parameter `RequestOptions`. Checkout
                    sessions are one-time: after cancellation, create a new PaymentIntent with a
                    fresh key such as `order-1001-attempt-2`. Reusing the previous key intentionally
                    returns the original cancelled intent.
                  </div>
                </div>
              </>
            )}

            {activeSection === "intents" && (
              <>
                <p>
                  Underneath every checkout session is a **Payment Intent**. Use payment intent
                  methods to create, retrieve, or list payment records on your server. Checkout
                  Sessions and Payment Intents use the same creation endpoint.
                </p>

                <PaymentIntentsIntegrationPromptCard />

                <h3 className="mt-8 mb-3 text-lg font-bold text-foreground">
                  Retrieve a Payment Intent
                </h3>
                <p>Fetch details for a specific payment intent by passing its unique identifier:</p>
                {renderCodeBlock(codeSnippets.retrieveIntent, "retrieveDemo")}

                <h3 className="mt-8 mb-3 text-lg font-bold text-foreground">
                  List Payment Intents
                </h3>
                <p>
                  Retrieve a list of payment intents. Results are filtered by your project scope,
                  sorted newest first, and support cursor-based pagination:
                </p>
                {renderCodeBlock(codeSnippets.listIntents, "listDemo")}

                <h3 className="mt-8 mb-4 text-lg font-bold text-foreground">
                  Response Object Shape
                </h3>
                <pre className="overflow-x-auto rounded-lg border border-border bg-muted/70 p-4 font-mono text-[13px] text-foreground">
                  {`{
  id: "pi_12345",
  object: "payment_intent",
  paymentIntentId: "pi_12345",
  status: "paid", // "awaiting_route" | "created" | "pending" | "paid" | "failed" | "expired" | "cancelled"
  amount: "10.00",
  asset: "USDC",
  description: "Order #1001",
  checkoutUrl: "https://pay.velo.xyz/pay/pi_12345",
  successUrl: "https://yourdomain.com/success",
  cancelUrl: "https://yourdomain.com/cancel",
  expiresAt: "2026-07-01T00:30:00.000Z",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:05:00.000Z"
}`}
                </pre>
              </>
            )}

            {activeSection === "gas-station" && (
              <>
                <p>
                  Velo Gas Station sponsors the network fee for an eligible, user-signed Stellar
                  Testnet Soroban transaction. Your application still builds the transaction and the
                  user still signs it. Velo supplies the relayer fee source and returns execution
                  and fee evidence through the server-side SDK.
                </p>

                <GasIntegrationPromptCard />

                <div className="my-6 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300">
                  <AlertTriangleIcon className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-500" />
                  <div className="text-sm">
                    <strong>Server-side and Testnet only</strong>
                    <p className="mt-1">
                      Gas sponsorship must run in a trusted server route or worker. Never put the
                      Gas API key, signed XDR, relayer signer, or recovery credentials in browser
                      code or browser storage. The current alpha Gas boundary is Stellar Testnet.
                    </p>
                  </div>
                </div>

                <h3 className="mt-8 mb-3 text-lg font-bold text-foreground">
                  The integration flow
                </h3>
                <ol className="list-decimal space-y-2 pl-6 text-zinc-600 dark:text-zinc-400">
                  <li>Build a valid Soroban invocation for Stellar Testnet.</li>
                  <li>Ask the user&apos;s wallet to sign the transaction XDR.</li>
                  <li>Send the signed XDR and your stable operation ID to your server.</li>
                  <li>
                    Call <code>velo.gas.sponsorAndSubmit()</code> from that server.
                  </li>
                  <li>
                    Return a safe projection to the browser and observe by identity until terminal.
                  </li>
                </ol>

                <h3 className="mt-8 mb-3 text-lg font-bold text-foreground">
                  Configure the project
                </h3>
                <p>
                  A project owner configures the Gas Station before an integrator can sponsor a
                  transaction. Open the project&apos;s <strong>Gas Station</strong> page at{" "}
                  <code>/projects/&lt;projectId&gt;/gas</code>.
                </p>
                <ol className="list-decimal space-y-2 pl-6 text-zinc-600 dark:text-zinc-400">
                  <li>
                    An editor or owner enables sponsorship, sets a positive daily cap and wallet
                    hourly quota, and adds the allowed contract IDs one per line.
                  </li>
                  <li>
                    Only an owner can add or change the relayer metadata. In the{" "}
                    <strong>Relayer funding &amp; balance</strong> panel, choose{" "}
                    <strong>Add a relayer account</strong>, enter the public <code>G...</code>{" "}
                    Testnet address, select <strong>Active</strong>, and save.
                  </li>
                  <li>
                    Fund that same public address with Testnet XLM, then choose{" "}
                    <strong>Refresh balance</strong>. Never enter a secret key in Velo.
                  </li>
                  <li>
                    The Convex deployment operator must configure the matching private signer in{" "}
                    <code>VELO_GAS_TESTNET_RELAYER_SIGNERS_JSON</code>. The dashboard stores only
                    public metadata; it does not create custody.
                  </li>
                </ol>
                <p className="text-sm text-muted-foreground">
                  Viewers can read policy and relayer status. Editors can change policy. Owners can
                  change relayer metadata. A balance snapshot older than five minutes is stale, and
                  metadata status is not proof of signer readiness.
                </p>

                <h3 className="mt-8 mb-3 text-lg font-bold text-foreground">
                  Server configuration
                </h3>
                <p>
                  Use a Gas-scoped project API key and an explicit deployment URL. Keep both values
                  in your server environment:
                </p>
                {renderCodeBlock(
                  "VELO_GAS_API_KEY=replace_with_a_server_only_project_key\nVELO_BASE_URL=https://your-velo-deployment.example",
                  "gasEnvironment",
                )}
                <p>
                  Initialize <code>Velo</code> with <code>environment: &quot;testnet&quot;</code>{" "}
                  and a total timeout below your hosting platform&apos;s request deadline.
                  Authenticate your caller and authorize the project before reading the request
                  body. Bound the request body and return only safe fields to the browser.
                </p>

                <h3 className="mt-8 mb-3 text-lg font-bold text-foreground">
                  Sponsor, submit, and recover
                </h3>
                {renderCodeBlock(codeSnippets.gasServerRoute, "gasServerRoute")}
                <p>
                  The combined helper sponsors once and hands off the signed XDR at most once. If
                  the handoff becomes uncertain, persist <code>error.recovery</code> and call{" "}
                  <code>getStatus()</code>; do not submit the XDR again.
                </p>
                {renderCodeBlock(codeSnippets.gasStatusRecovery, "gasStatusRecovery")}

                <h3 className="mt-8 mb-3 text-lg font-bold text-foreground">Gas SDK methods</h3>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="min-w-full divide-y divide-border text-left text-sm">
                    <thead className="bg-muted/70 font-mono text-xs text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3">Method</th>
                        <th className="px-4 py-3">Use it for</th>
                        <th className="px-4 py-3">Important behavior</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      <tr>
                        <td className="px-4 py-3 font-mono text-foreground">
                          sponsor(xdr, options)
                        </td>
                        <td className="px-4 py-3">Reserve fee exposure.</td>
                        <td className="px-4 py-3">
                          Requires a stable idempotency key; it does not submit.
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-3 font-mono text-foreground">submit(params)</td>
                        <td className="px-4 py-3">Perform the trusted handoff.</td>
                        <td className="px-4 py-3">
                          Sends the original signed XDR once and is never automatically retried.
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-3 font-mono text-foreground">
                          sponsorAndSubmit(xdr, options)
                        </td>
                        <td className="px-4 py-3">Use the normal one-call workflow.</td>
                        <td className="px-4 py-3">
                          Composes sponsorship and handoff under one deadline.
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-3 font-mono text-foreground">getStatus(identity)</td>
                        <td className="px-4 py-3">Recover or inspect one operation.</td>
                        <td className="px-4 py-3">
                          Sends only <code>requestId</code> and the inner transaction hash.
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-3 font-mono text-foreground">
                          waitForResult(identity, options)
                        </td>
                        <td className="px-4 py-3">Bounded status observation.</td>
                        <td className="px-4 py-3">
                          Polls identity-only status; it never sponsors or submits.
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <h3 className="mt-8 mb-3 text-lg font-bold text-foreground">
                  Result interpretation
                </h3>
                <ul className="list-disc space-y-2 pl-6 text-zinc-600 dark:text-zinc-400">
                  <li>
                    <code>succeeded</code> is the only successful result.
                  </li>
                  <li>
                    <code>claimed</code>, <code>submission_unknown</code>, and{" "}
                    <code>submitted</code> are unresolved or running.
                  </li>
                  <li>
                    <code>failed</code> and <code>cancelled</code> are terminal non-success results.
                  </li>
                  <li>
                    <code>actualFeeStroops: null</code> means the actual fee is unknown, not zero.
                  </li>
                  <li>
                    The inner transaction hash and FeeBump outer transaction hash are separate
                    identities.
                  </li>
                </ul>

                <h3 className="mt-8 mb-3 text-lg font-bold text-foreground">
                  Policy denials and retry rules
                </h3>
                <ul className="list-disc space-y-2 pl-6 text-zinc-600 dark:text-zinc-400">
                  <li>
                    <code>contract_not_whitelisted</code> means the target is not in the project
                    allowlist; do not retry unchanged.
                  </li>
                  <li>
                    <code>daily_cap_exceeded</code> and <code>wallet_rate_limited</code> are not
                    automatically retried.
                  </li>
                  <li>
                    Reservation expiry, disabled policy, missing relayer, and provider errors are
                    not proof of chain execution.
                  </li>
                  <li>
                    Retry sponsorship only with the same signed XDR and the same idempotency key.
                  </li>
                  <li>
                    After a dispatch-uncertain error, recover by identity and never resubmit the
                    XDR.
                  </li>
                </ul>

                <p className="text-sm text-muted-foreground">
                  Handle typed <code>VeloAuthError</code>, <code>VeloValidationError</code>,{" "}
                  <code>VeloRateLimitError</code>, <code>VeloProviderError</code>, and{" "}
                  <code>VeloGasWaitError</code> errors. A transport error is not proof of a chain
                  result.
                </p>

                <div className="my-6 flex gap-3 rounded-xl border border-border bg-muted/50 p-4">
                  <InfoIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                  <div className="text-sm">
                    <strong className="mb-1 block text-foreground">Dashboard evidence</strong>
                    The authenticated Gas Station page is the operational readback for policy,
                    wallet quota, daily cap, relayer address and freshness, confirmed fees,
                    outstanding holds, telemetry, paginated activity, and receipt detail with inner
                    and outer hashes. Fixture screenshots are not live evidence.
                  </div>
                </div>

                <p className="text-sm text-muted-foreground">
                  The Gas helpers are available from the current workspace SDK source. The published{" "}
                  <code>0.1.0-alpha.2</code> package has not been republished with these Gas exports
                  yet. See the{" "}
                  <a
                    href="https://github.com/Velo-Ecosystem-Collection/Velo/blob/main/docs/velo-gas-station.md"
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-foreground underline underline-offset-2"
                  >
                    full Gas Station integration guide
                  </a>{" "}
                  for the complete setup and validation checklist.
                </p>
              </>
            )}

            {activeSection === "webhooks" && (
              <>
                <p>
                  Velo sends webhook events to your server to notify you about payment lifecycle
                  changes. To prevent request spoofing, you must verify the signature header.
                </p>

                <div className="my-6">
                  <WebhookVerificationIntegrationPromptCard />
                </div>

                <div className="my-6 flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-950 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300">
                  <AlertTriangleIcon className="mt-0.5 size-5 shrink-0 text-red-600 dark:text-red-500" />
                  <div className="text-sm">
                    <strong>CRITICAL: Use the RAW request body</strong>
                    <p className="mt-1">
                      Webhook verification fails if the body payload has been parsed (e.g. via
                      `body-parser` JSON middleware). **Always pass the raw request text string**
                      directly.
                    </p>
                  </div>
                </div>

                <p>Verify webhook signatures using the static `Velo.webhooks.verify` method:</p>

                {renderCodeBlock(codeSnippets.webhookVerify, "verifyDemo")}

                <h3 className="mt-8 mb-4 text-lg font-bold text-foreground">
                  Supported Event Types
                </h3>
                <ul className="list-disc space-y-2 pl-6 text-zinc-600 dark:text-zinc-400">
                  <li>
                    <strong className="text-foreground">payment.created</strong>: Emitted when a
                    payment intent is created.
                  </li>
                  <li>
                    <strong className="text-foreground">payment.succeeded</strong>: Emitted when the
                    user completes payment on-chain and tokens are confirmed.
                  </li>
                  <li>
                    <strong className="text-foreground">payment.failed</strong>: Emitted when the
                    payment transaction fails.
                  </li>
                  <li>
                    <strong className="text-foreground">payment_access.activated</strong>: Emitted
                    when project pay credits are added.
                  </li>
                  <li>
                    <strong className="text-foreground">settlement.quote.created</strong>: Emitted
                    when a new firm quote is requested and locked (UAT simulated).
                  </li>
                  <li>
                    <strong className="text-foreground">settlement.trade.executed</strong>: Emitted
                    when stablecoin conversion trade is executed (UAT simulated).
                  </li>
                  <li>
                    <strong className="text-foreground">settlement.withdrawal.pending</strong>:
                    Emitted when InstaPay bank withdrawal payout is initiated (UAT simulated).
                  </li>
                  <li>
                    <strong className="text-foreground">settlement.withdrawal.succeeded</strong>:
                    Emitted when bank payout succeeds (UAT simulated).
                  </li>
                  <li>
                    <strong className="text-foreground">settlement.withdrawal.failed</strong>:
                    Emitted when bank payout fails (UAT simulated).
                  </li>
                  <li>
                    <strong className="text-foreground">provider.pdax.event.received</strong>:
                    Emitted when raw webhook data is received from PDAX (UAT simulated).
                  </li>
                </ul>

                <div className="my-6 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300">
                  <AlertTriangleIcon className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-500" />
                  <div className="text-sm">
                    <strong>UAT Sandbox Settlement Webhooks</strong>
                    <p className="mt-1 text-amber-800 dark:text-amber-300">
                      Settlement events are currently tied to the PDAX UAT Sandbox environment. All
                      pricing, liquidity, bank payouts, and transactions are mock/simulated. Do not
                      use real production funds.
                    </p>
                  </div>
                </div>
              </>
            )}

            {activeSection === "nextjs" && (
              <>
                <p>
                  Here is a complete Next.js App Router integration. It features a backend checkout
                  endpoint `/api/checkout` and a webhook receiver endpoint `/api/webhook` utilizing
                  the Velo SDK.
                </p>

                <h3 className="mt-8 mb-3 text-lg font-bold text-foreground">
                  1. Checkout Route Handler
                </h3>
                {renderCodeBlock(codeSnippets.nextjsCode, "nextCheckoutCode")}

                <h3 className="mt-8 mb-3 text-lg font-bold text-foreground">
                  2. Webhook Verification Handler
                </h3>
                {renderCodeBlock(codeSnippets.nextjsWebhook, "nextWebhookCode")}
              </>
            )}

            {activeSection === "express" && (
              <>
                <p>
                  Here is a complete Express.js server example written in TypeScript. We configure
                  the webhook endpoint `/webhooks` to capture the raw body as a string using the
                  `express.raw` parser middleware.
                </p>

                {renderCodeBlock(codeSnippets.expressCode, "expressDemo")}
              </>
            )}

            {activeSection === "reference" && (
              <>
                <p>
                  Here are details on error models, environments, and general Velo SDK alpha release
                  limits.
                </p>

                <h3 className="mt-8 mb-3 text-lg font-bold text-foreground">Error Handling</h3>
                <p>
                  SDK calls that fail server-side throw specific errors inheriting from
                  `VeloAPIError`. Catch them to trigger targeted retry or authentication actions:
                </p>
                <ul className="list-disc space-y-2 pl-6 text-zinc-600 dark:text-zinc-400">
                  <li>
                    <strong className="text-foreground">VeloAuthError</strong> (Status `401`):
                    Invalid or missing API key.
                  </li>
                  <li>
                    <strong className="text-foreground">VeloValidationError</strong> (Status `400` /
                    `422`): Malformed parameters, invalid numbers.
                  </li>
                  <li>
                    <strong className="text-foreground">VeloRateLimitError</strong> (Status `429`):
                    Request rate limits exceeded. Look at the `Retry-After` header.
                  </li>
                  <li>
                    <strong className="text-foreground">VeloAPIError</strong> (Status `409` /
                    `500`): Generic API issues or Idempotency Key conflicts.
                  </li>
                </ul>

                <h3 className="mt-8 mb-3 text-lg font-bold text-foreground">
                  Alpha Exclusions & Boundaries
                </h3>
                <p>During the alpha stage, the following features are not supported:</p>
                <ul className="list-disc space-y-1 pl-6 text-zinc-600 dark:text-zinc-400">
                  <li>Refunds, partial captures, and disputes</li>
                  <li>Direct client-side / browser usage</li>
                  <li>React front-end checkout button components</li>
                  <li>Automatic request retry on creation</li>
                </ul>
              </>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
