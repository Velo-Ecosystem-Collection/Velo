"use client";

import { shortenAddress } from "@/core/wallet/format";
import { useWallet } from "@/core/wallet/wallet-provider";
import { api } from "@repo/backend/convex/_generated/api";
import { Id } from "@repo/backend/convex/_generated/dataModel";
import { CopyButton } from "@repo/ui/components/common/copy-button";
import { Alert, AlertDescription, AlertTitle } from "@repo/ui/components/ui/alert";
import { Button } from "@repo/ui/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/ui/select";
import { Skeleton } from "@repo/ui/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/components/ui/tabs";
import { useQuery } from "convex/react";
import {
  AlertCircleIcon,
  BookOpenIcon,
  CodeIcon,
  InfoIcon,
  KeyIcon,
  TerminalIcon,
  WalletIcon,
  CheckIcon,
  CopyIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import {
  gasExampleHref,
  gasIntegrationGuideHref,
  gasIntegrationSnippets,
} from "./project-integration-guidance";

type ProjectIntegrationProps = {
  projectId: string;
};

type GasSnippetCardProps = {
  title: string;
  description: string;
  snippet: string;
  copyLabel: string;
};

function GasSnippetCard({ title, description, snippet, copyLabel }: GasSnippetCardProps) {
  return (
    <article className="min-w-0 overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div className="flex flex-col gap-3 border-b border-zinc-200 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
          <p className="mt-1 text-xs leading-relaxed text-zinc-600">{description}</p>
        </div>
        <CopyButton value={snippet} label={copyLabel} size="sm" className="shrink-0 self-start" />
      </div>
      <pre
        className="max-w-full overflow-x-auto bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-100"
        aria-label={title + " code"}
      >
        {snippet}
      </pre>
    </article>
  );
}

export function ProjectIntegration({ projectId }: ProjectIntegrationProps) {
  const wallet = useWallet();
  const [selectedKeyId, setSelectedKeyId] = useState<string>("default");
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState("http://localhost:3000");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setBaseUrl(window.location.origin);
    }
  }, []);

  const project = useQuery(
    api.projects.query.getById,
    wallet.address ? { id: projectId as Id<"projects"> } : "skip",
  );

  const apiKeys = useQuery(
    api.projects.query.listApiKeys,
    wallet.address
      ? {
          projectId: projectId as Id<"projects">,
        }
      : "skip",
  );

  const activeKeys = apiKeys?.filter((k) => !k.revoked) ?? [];

  useEffect(() => {
    const firstKey = activeKeys[0];
    if (firstKey && selectedKeyId === "default") {
      setSelectedKeyId(firstKey._id);
    }
  }, [activeKeys, selectedKeyId]);

  const selectedKey = activeKeys.find((k) => k._id === selectedKeyId) || activeKeys[0];
  const apiKeyPlaceholder = selectedKey
    ? `${selectedKey.prefix}************************`
    : "tk_live_YOUR_API_KEY";

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => setCopiedText(null), 2000);
  };

  if (!wallet.address) {
    return (
      <section className="grid gap-4">
        <h1 className="text-3xl font-semibold">Project integration</h1>
        <Alert>
          <WalletIcon />
          <AlertTitle>Connect the owner wallet</AlertTitle>
          <AlertDescription>
            Private project state loads only after wallet ownership is verified.
          </AlertDescription>
        </Alert>
        <Button onClick={wallet.connect} className="w-fit">
          <WalletIcon />
          Connect wallet
        </Button>
      </section>
    );
  }

  if (project === undefined || apiKeys === undefined) {
    return (
      <section className="grid gap-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </section>
    );
  }

  if (project === null) {
    return (
      <section className="grid gap-4">
        <h1 className="text-3xl font-semibold tracking-normal">Project unavailable</h1>
        <p className="text-sm text-zinc-600">
          The project does not exist or the connected wallet is not its owner.
        </p>
        <Button asChild className="w-fit">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </section>
    );
  }

  const ownerMatches = wallet.address?.toUpperCase() === project.ownerAddress;
  if (!ownerMatches) {
    return (
      <section className="grid gap-4">
        <h1 className="text-3xl font-semibold">Access Denied</h1>
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Connected wallet is not the owner</AlertTitle>
          <AlertDescription>
            Switch to {shortenAddress(project.ownerAddress)} to view this page.
          </AlertDescription>
        </Alert>
      </section>
    );
  }

  const nodeSnippet = `const response = await fetch("${baseUrl}/api/v1/payment-intents", {
  method: "POST",
  headers: {
    "Authorization": "Bearer ${apiKeyPlaceholder}",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    amount: "10.00",
    asset: "native", // "native" for XLM, or "CODE:ISSUER" for custom assets (e.g. USDC)
    description: "Order #1001",
    successUrl: "https://your-merchant-site.com/success",
    cancelUrl: "https://your-merchant-site.com/cancel"
  })
});

const data = await response.json();
if (response.ok) {
  // Redirect customer to hosted checkout page
  window.location.href = data.checkoutUrl;
} else {
  console.error("Payment creation failed:", data.error);
}`;

  const sdkSnippet = `import { Velo } from "@carts1024/velo-sdk";

const velo = new Velo({
  apiKey: "${apiKeyPlaceholder}",
  environment: "testnet", // "production", "testnet", or "development"
  baseUrl: "${baseUrl}" // Optional: custom backend URL
});

try {
  const session = await velo.checkout.sessions.create({
    amount: "10.00",
    asset: "USDC", // "native" for XLM, or "USDC"
    description: "Order #1001",
    successUrl: "https://your-merchant-site.com/success",
    cancelUrl: "https://your-merchant-site.com/cancel",
  });

  // Redirect customer to hosted checkout page
  window.location.href = session.checkoutUrl;
} catch (error) {
  console.error("Failed to initiate Velo Pay checkout:", error);
}`;

  const nextSnippet = `import { NextResponse } from "next/server";
import { Velo } from "@carts1024/velo-sdk";

const velo = new Velo({
  apiKey: process.env.VELO_API_KEY || "${apiKeyPlaceholder}",
  environment: "testnet",
  baseUrl: "${baseUrl}"
});

export async function POST() {
  try {
    const session = await velo.checkout.sessions.create({
      amount: "10.00",
      asset: "USDC",
      description: "Order #1001",
      successUrl: "https://your-merchant-site.com/success",
      cancelUrl: "https://your-merchant-site.com/cancel",
    });

    return NextResponse.json({ url: session.checkoutUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Checkout error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}`;

  const curlCommand = `curl -X POST ${baseUrl}/api/v1/payment-intents \\
  -H "Authorization: Bearer ${apiKeyPlaceholder}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": "10.00",
    "asset": "native",
    "description": "Order #1001",
    "successUrl": "https://merchant.example/success",
    "cancelUrl": "https://merchant.example/cancel"
  }'`;

  return (
    <section className="grid gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-normal">Developer Integration</h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-600">
            Learn how to create checkout sessions programmatically and integrate Velo Pay into your
            server or backend.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href={`/projects/${projectId}/api-keys`}>API keys</Link>
        </Button>
      </div>

      {activeKeys.length === 0 ? (
        <Alert className="border-amber-200 bg-amber-50 text-amber-950">
          <KeyIcon className="size-5 text-amber-600" />
          <AlertTitle className="font-semibold text-amber-900">API Key Required</AlertTitle>
          <AlertDescription className="text-amber-800">
            <p className="text-xs leading-relaxed">
              You need an active API key to populate integration snippets. Go to the{" "}
              <Link
                href={`/projects/${projectId}/api-keys`}
                className="underline font-semibold hover:text-amber-950"
              >
                API keys page
              </Link>{" "}
              to generate one.
            </p>
          </AlertDescription>
        </Alert>
      ) : (
        <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-sm font-semibold tracking-normal flex items-center gap-1.5 text-zinc-800">
                <KeyIcon className="size-4 text-zinc-500" />
                Select API Key for code generation
              </h2>
              <p className="text-xs text-zinc-500">
                The chosen key will be automatically injected into the integration snippets below.
              </p>
            </div>
            <div className="w-full sm:w-64">
              <Select value={selectedKeyId} onValueChange={setSelectedKeyId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select API Key" />
                </SelectTrigger>
                <SelectContent>
                  {activeKeys.map((key) => (
                    <SelectItem key={key._id} value={key._id}>
                      {key.label} ({key.prefix}...)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      )}

      {/* Main Integration Code Snippet section */}
      <div className="rounded-lg border border-zinc-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-zinc-200 bg-zinc-50 px-4 py-3 flex items-center gap-2">
          <CodeIcon className="size-5 text-zinc-500" />
          <span className="font-semibold text-sm text-zinc-800">Integration Snippets</span>
        </div>

        <Tabs defaultValue="node" className="w-full">
          <div className="border-b border-zinc-150 px-4">
            <TabsList variant="line" className="h-10">
              <TabsTrigger value="node" className="text-xs">
                Node.js (Fetch)
              </TabsTrigger>
              <TabsTrigger value="sdk" className="text-xs">
                SDK Helper
              </TabsTrigger>
              <TabsTrigger value="next" className="text-xs">
                Next.js API Route
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="p-4 bg-zinc-950">
            <TabsContent value="node" className="relative group mt-0">
              <div className="absolute right-2 top-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-zinc-400 hover:text-zinc-50 hover:bg-zinc-800"
                  onClick={() => handleCopy(nodeSnippet, "node")}
                >
                  {copiedText === "node" ? (
                    <CheckIcon className="size-4 text-emerald-500" />
                  ) : (
                    <CopyIcon className="size-4" />
                  )}
                </Button>
              </div>
              <pre className="font-mono text-xs text-zinc-100 overflow-x-auto whitespace-pre p-2 bg-transparent select-all leading-relaxed">
                {nodeSnippet}
              </pre>
            </TabsContent>

            <TabsContent value="sdk" className="relative group mt-0">
              <div className="absolute right-2 top-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-zinc-400 hover:text-zinc-50 hover:bg-zinc-800"
                  onClick={() => handleCopy(sdkSnippet, "sdk")}
                >
                  {copiedText === "sdk" ? (
                    <CheckIcon className="size-4 text-emerald-500" />
                  ) : (
                    <CopyIcon className="size-4" />
                  )}
                </Button>
              </div>
              <pre className="font-mono text-xs text-zinc-100 overflow-x-auto whitespace-pre p-2 bg-transparent select-all leading-relaxed">
                {sdkSnippet}
              </pre>
            </TabsContent>

            <TabsContent value="next" className="relative group mt-0">
              <div className="absolute right-2 top-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-zinc-400 hover:text-zinc-50 hover:bg-zinc-800"
                  onClick={() => handleCopy(nextSnippet, "next")}
                >
                  {copiedText === "next" ? (
                    <CheckIcon className="size-4 text-emerald-500" />
                  ) : (
                    <CopyIcon className="size-4" />
                  )}
                </Button>
              </div>
              <pre className="font-mono text-xs text-zinc-100 overflow-x-auto whitespace-pre p-2 bg-transparent select-all leading-relaxed">
                {nextSnippet}
              </pre>
            </TabsContent>
          </div>
        </Tabs>
      </div>

      {/* Local Sandbox / Sandbox Testing section */}
      <div className="rounded-lg border border-zinc-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-zinc-200 bg-zinc-50 px-4 py-3 flex items-center gap-2">
          <TerminalIcon className="size-5 text-zinc-500" />
          <span className="font-semibold text-sm text-zinc-800">Local cURL Sandbox Testing</span>
        </div>
        <div className="p-5 space-y-4">
          <div className="text-sm text-zinc-700 space-y-2">
            <p>
              To quickly test checkout creation without writing code, execute this `curl` command in
              your terminal. It will trigger our backend endpoints to create a new checkout session
              on the fly.
            </p>
            <div className="flex gap-2 bg-amber-50 border border-amber-200 text-amber-900 rounded p-3 text-xs">
              <InfoIcon className="size-4.5 shrink-0 mt-0.5 text-amber-600" />
              <p>
                Ensure your project is **registered** on-chain and **Velo Pay Access** is **active**
                (which funds the project with checkout credits) prior to running calls.
              </p>
            </div>
          </div>

          <div className="relative group bg-zinc-950 p-4 rounded-lg">
            <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-zinc-400 hover:text-zinc-50 hover:bg-zinc-800"
                onClick={() => handleCopy(curlCommand, "curl")}
              >
                {copiedText === "curl" ? (
                  <CheckIcon className="size-4 text-emerald-500" />
                ) : (
                  <CopyIcon className="size-4" />
                )}
              </Button>
            </div>
            <pre className="font-mono text-xs text-zinc-100 overflow-x-auto whitespace-pre-wrap select-all leading-relaxed">
              {curlCommand}
            </pre>
          </div>

          <div className="space-y-2 pt-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Response payload
            </h3>
            <p className="text-xs text-zinc-600">
              The API returns a JSON response containing the `checkoutUrl` to redirect your buyer,
              the `paymentIntentId`, and the lifespan of the payment link in seconds:
            </p>
            <pre className="bg-zinc-50 border border-zinc-150 p-3 rounded font-mono text-xs text-zinc-800">
              {`{
  "paymentIntentId": "kh7acnc4nk9v5nwj9xbnhsaj9x89jw2q",
  "checkoutUrl": "${baseUrl}/pay/kh7acnc4nk9v5nwj9xbnhsaj9x89jw2q",
  "expiresIn": 1800
}`}
            </pre>
          </div>
        </div>
      </div>

      <section
        className="min-w-0 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm"
        aria-labelledby="gas-station-integration-title"
      >
        <div className="flex items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-4 py-3">
          <CodeIcon className="size-5 text-zinc-500" />
          <h2 id="gas-station-integration-title" className="text-sm font-semibold text-zinc-800">
            Gas Station
          </h2>
        </div>
        <div className="grid gap-5 p-5">
          <div className="grid gap-2 text-sm text-zinc-700">
            <p>
              Gas sponsorship and submission belong on your trusted server. Configure{" "}
              <code>VELO_GAS_API_KEY</code> and an explicit <code>VELO_BASE_URL</code> in the server
              environment; neither value is selected from this project page or interpolated into
              client code.
            </p>
            <p>
              The snippets use a caller-owned operation ID, a stable idempotency key, and bounded
              deadlines. If submission becomes uncertain, recover through{" "}
              <code>VeloGasSubmissionUnknownError.recovery</code> with identity-only{" "}
              <code>getStatus()</code>; never submit the signed XDR again.
            </p>
          </div>

          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <GasSnippetCard
              title="Sponsor and submit"
              description="Use from a server route or worker after your own caller authorization."
              snippet={gasIntegrationSnippets.sponsorAndSubmit}
              copyLabel="sponsor and submit snippet"
            />
            <GasSnippetCard
              title="Recover status by identity"
              description="Resume a stored operation without sending its signed XDR again."
              snippet={gasIntegrationSnippets.statusRecovery}
              copyLabel="status recovery snippet"
            />
          </div>

          <div className="grid gap-2 text-xs leading-relaxed text-zinc-600">
            <p>
              Only <code>succeeded</code> means success. <code>claimed</code>,{" "}
              <code>submission_unknown</code>, and <code>submitted</code> remain unresolved;{" "}
              <code>failed</code> and <code>cancelled</code> are terminal non-success states. A null{" "}
              <code>actualFeeStroops</code> remains unknown. Authorization and durable
              operation/recovery storage belong to the consuming server. The optional{" "}
              <code>waitForResult()</code> path in the second snippet is bounded observation, not a
              replacement for durable recovery.
            </p>
            <p>
              The executable{" "}
              <a
                href={gasExampleHref}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-zinc-900 underline underline-offset-2"
              >
                Next.js Gas example
              </a>{" "}
              uses a demo bearer guard for local terminal access only. Production applications must
              replace it with their own authentication and project authorization; the example has no
              durable operation store or later status endpoint. Read the full{" "}
              <a
                href={gasIntegrationGuideHref}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-zinc-900 underline underline-offset-2"
              >
                Gas integration guide
              </a>{" "}
              for recovery semantics and setup.
            </p>
            <p className="text-zinc-500">
              Guidance inspected against workspace source revision{" "}
              <code>c8dedeff0a6d885c82126a7a281245a74ad4a1eb</code>. The SDK package version remains
              unchanged; registry publication and deployed acceptance are not implied.
            </p>
          </div>
        </div>
      </section>

      <div className="flex gap-2 items-center text-xs text-zinc-500 justify-center py-4 border-t border-zinc-200">
        <BookOpenIcon className="size-4" />
        <span>
          For full specs on parameters and status values, see the{" "}
          <Link href="/verify/demo" className="underline hover:text-zinc-800">
            Velo Pay Checkout Guide
          </Link>
          .
        </span>
      </div>
    </section>
  );
}
