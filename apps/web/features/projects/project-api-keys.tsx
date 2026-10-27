"use client";

import { shortenAddress } from "@/core/wallet/format";
import { useWallet } from "@/core/wallet/wallet-provider";
import { api } from "@repo/backend/convex/_generated/api";
import { CopyButton } from "@repo/ui/components/common/copy-button";
import { Badge } from "@repo/ui/components/ui-customs/badge";
import { Alert, AlertDescription, AlertTitle } from "@repo/ui/components/ui/alert";
import { Button } from "@repo/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/ui/dialog";
import { Input } from "@repo/ui/components/ui/input";
import { Label } from "@repo/ui/components/ui/label";
import { Skeleton } from "@repo/ui/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/components/ui/table";
import { useMutation, useQuery } from "convex/react";
import { AlertCircleIcon, KeyIcon, Trash2Icon, WalletIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import type { Id } from "@repo/backend/convex/_generated/dataModel";

function formatTimestamp(value?: number) {
  return value ? new Date(value).toLocaleString() : "Not used";
}

function apiKeyErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "API key request failed";
}

export function ProjectApiKeys({ projectId }: { projectId: string }) {
  const wallet = useWallet();
  const typedProjectId = projectId as Id<"projects">;
  const project = useQuery(
    api.projects.query.getById,
    wallet.address ? { id: typedProjectId } : "skip",
  );
  const apiKeys = useQuery(
    api.projects.query.listApiKeys,
    wallet.address ? { projectId: typedProjectId } : "skip",
  );
  const generateApiKey = useMutation(api.projects.mutation.generateApiKey);
  const revokeApiKey = useMutation(api.projects.mutation.revokeApiKey);

  const [apiKeyLabel, setApiKeyLabel] = useState("");
  const [newRawKey, setNewRawKey] = useState<string | null>(null);
  const [isGeneratingKey, setIsGeneratingKey] = useState(false);
  const [isRevokingKey, setIsRevokingKey] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [isGenerateDialogOpen, setIsGenerateDialogOpen] = useState(false);
  const [selectedAnchor, setSelectedAnchor] = useState<"inhouse" | "pdax">("inhouse");
  const [selectedPurpose, setSelectedPurpose] = useState<"general" | "gas">("general");
  const [newKeyPurpose, setNewKeyPurpose] = useState<"general" | "gas" | null>(null);

  async function handleGenerateKey() {
    const label = apiKeyLabel.trim();
    if (!label) {
      setLocalError("Please provide a label for the API key.");
      return;
    }

    setIsGeneratingKey(true);
    setNewRawKey(null);
    setNewKeyPurpose(null);
    setLocalError(null);

    try {
      const result = await generateApiKey({
        id: typedProjectId,
        label,
        purpose: selectedPurpose,
        ...(selectedPurpose === "general" ? { paymentAnchor: selectedAnchor } : {}),
      });
      setNewRawKey(result.rawKey);
      setNewKeyPurpose(selectedPurpose);
      setApiKeyLabel("");
      setIsGenerateDialogOpen(false);
    } catch (error) {
      setLocalError(apiKeyErrorMessage(error));
    } finally {
      setIsGeneratingKey(false);
    }
  }

  async function handleRevokeKey(keyId: Id<"apiKeys">) {
    if (
      !window.confirm(
        "Are you sure you want to revoke this API key? This action will instantly disable access for any clients using it.",
      )
    ) {
      return;
    }

    setIsRevokingKey(true);
    setLocalError(null);

    try {
      await revokeApiKey({ keyId, projectId: typedProjectId });
      setNewRawKey(null);
    } catch (error) {
      setLocalError(apiKeyErrorMessage(error));
    } finally {
      setIsRevokingKey(false);
    }
  }

  function copyEndpoint(path: string) {
    if (typeof window === "undefined") return;
    void navigator.clipboard.writeText(`${window.location.origin}${path}`);
  }

  if (!wallet.address) {
    return (
      <section className="grid gap-4">
        <h1 className="text-3xl font-semibold tracking-normal">API keys</h1>
        <Alert>
          <WalletIcon />
          <AlertTitle>Connect the owner wallet</AlertTitle>
          <AlertDescription>
            Private API keys load only after wallet ownership is verified.
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
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-72 w-full" />
      </section>
    );
  }

  if (project === null) {
    return (
      <section className="grid gap-4">
        <h1 className="text-3xl font-semibold tracking-normal">Project unavailable</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          The project does not exist or the connected wallet is not its owner.
        </p>
        <Button asChild className="w-fit">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </section>
    );
  }

  const ownerMatches = wallet.address.toUpperCase() === project.ownerAddress;

  if (!ownerMatches) {
    return (
      <section className="grid gap-4">
        <h1 className="text-3xl font-semibold tracking-normal">API keys</h1>
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Connected wallet is not the owner</AlertTitle>
          <AlertDescription>
            Switch to {shortenAddress(project.ownerAddress)} to view and manage API keys.
          </AlertDescription>
        </Alert>
      </section>
    );
  }

  const activeKeys = apiKeys.filter((key) => !key.revoked);
  const activeGeneralKeys = activeKeys.filter((key) => key.purpose !== "gas");
  const activeGasKeys = activeKeys.filter((key) => key.purpose !== "general");

  return (
    <section className="grid min-w-0 gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-normal">API keys</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Generate and manage keys for {project.name}. Raw keys are shown once when created.
          </p>
        </div>
        <Badge variant={activeKeys.length > 0 ? "success" : "gray"}>
          {activeKeys.length} active
        </Badge>
      </div>

      {localError ? (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>API key request failed</AlertTitle>
          <AlertDescription>{localError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="rounded-lg border border-border bg-card text-card-foreground shadow-sm">
        <div className="flex flex-col gap-4 border-b border-border p-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <KeyIcon className="size-5 text-muted-foreground" />
              <h2 className="text-base font-semibold tracking-normal">Key management</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Use labels that identify environment or service owner.
            </p>
          </div>
          <div className="flex shrink-0">
            <Button
              onClick={() => {
                setApiKeyLabel("");
                setSelectedAnchor("inhouse");
                setSelectedPurpose("general");
                setLocalError(null);
                setIsGenerateDialogOpen(true);
              }}
              className="shrink-0"
            >
              <KeyIcon className="mr-2 size-4" />
              Generate key
            </Button>
          </div>
        </div>

        {newRawKey ? (
          <div className="border-b border-border bg-emerald-50/60 p-4 dark:bg-emerald-950/20">
            <Alert className="border-emerald-200 bg-card text-card-foreground dark:border-emerald-900/60">
              <KeyIcon className="size-5 text-emerald-600 dark:text-emerald-400" />
              <AlertTitle className="font-semibold text-emerald-900 dark:text-emerald-200">
                Save your API key
              </AlertTitle>
              <AlertDescription className="text-emerald-900 dark:text-emerald-200">
                <p className="mb-3 text-sm leading-relaxed">
                  Copy this key now. For security reasons, it cannot be shown again after this box
                  is closed or the page refreshes.
                </p>
                {newKeyPurpose === "gas" ? (
                  <p className="mb-3 text-sm leading-relaxed">
                    Store it as <code>VELO_GAS_API_KEY</code> in your server environment. This
                    Testnet key is scoped to Gas Station endpoints.
                  </p>
                ) : null}
                <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-background p-3 font-mono text-xs font-semibold break-all text-foreground shadow-sm dark:border-emerald-900/60">
                  <span className="min-w-0 flex-1 select-all">{newRawKey}</span>
                  <CopyButton value={newRawKey} label="API key" size="sm" />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => setNewRawKey(null)}
                >
                  I have copied the key
                </Button>
              </AlertDescription>
            </Alert>
          </div>
        ) : null}

        <div className="overflow-x-auto">
          {apiKeys.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No API keys generated yet. Create a labeled key to start using Velo APIs.
            </div>
          ) : (
            <Table className="table-fixed sm:table-auto">
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead className="hidden sm:table-cell">Prefix</TableHead>
                  <TableHead>API scope</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Payment Anchor</TableHead>
                  <TableHead className="hidden lg:table-cell">Created</TableHead>
                  <TableHead className="hidden md:table-cell">Usage</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {apiKeys.map((key) => (
                  <TableRow key={key._id}>
                    <TableCell className="max-w-40 text-sm font-medium break-words whitespace-normal">
                      {key.label}
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs text-muted-foreground sm:table-cell">
                      {key.prefix}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          key.purpose === "gas"
                            ? "warning"
                            : key.purpose === "legacy"
                              ? "gray"
                              : "info"
                        }
                      >
                        {key.purpose === "gas"
                          ? "Gas Station · Testnet"
                          : key.purpose === "legacy"
                            ? "Legacy · General + Gas"
                            : "General API"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={key.revoked ? "gray" : "success"}>
                        {key.revoked ? "revoked" : "active"}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {key.purpose === "gas" ? (
                        <span className="text-sm text-muted-foreground">—</span>
                      ) : (
                        <Badge variant={key.paymentAnchor === "pdax" ? "warning" : "info"}>
                          {key.paymentAnchor === "pdax" ? "PDAX" : "In-house"}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                      {formatTimestamp(key.createdAt)}
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                      <div>{key.requestCount} requests</div>
                      {key.lastUsedAt ? (
                        <div className="mt-0.5 text-[10px] text-muted-foreground/75">
                          Last used {formatTimestamp(key.lastUsedAt)}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right">
                      {!key.revoked ? (
                        <Button
                          variant="destructive"
                          size="sm"
                          aria-label={`Revoke API key ${key.label}`}
                          onClick={() => void handleRevokeKey(key._id)}
                          disabled={isRevokingKey}
                        >
                          <Trash2Icon className="size-3" />
                          <span className="hidden sm:inline">Revoke</span>
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        <Dialog open={isGenerateDialogOpen} onOpenChange={setIsGenerateDialogOpen}>
          <DialogContent className="bg-background text-foreground sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Generate API key</DialogTitle>
              <DialogDescription>
                {selectedPurpose === "gas"
                  ? `Create a Testnet Gas Station key for ${project.name}. It works only with Gas endpoints.`
                  : `Create a general API key for ${project.name}.`}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              {localError ? (
                <Alert variant="destructive">
                  <AlertCircleIcon className="size-4" />
                  <AlertTitle>API key request failed</AlertTitle>
                  <AlertDescription>{localError}</AlertDescription>
                </Alert>
              ) : null}
              <div className="grid gap-2">
                <Label htmlFor="api-key-name" className="text-foreground">
                  Key label
                </Label>
                <Input
                  id="api-key-name"
                  placeholder="e.g. Production, Development"
                  value={apiKeyLabel}
                  onChange={(e) => {
                    setApiKeyLabel(e.target.value);
                    setLocalError(null);
                  }}
                  disabled={isGeneratingKey}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="api-key-purpose" className="text-foreground">
                  API access
                </Label>
                <select
                  id="api-key-purpose"
                  value={selectedPurpose}
                  onChange={(e) => setSelectedPurpose(e.target.value as "general" | "gas")}
                  disabled={isGeneratingKey}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-xs transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="general">General project API</option>
                  <option value="gas">Gas Station · Testnet</option>
                </select>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {selectedPurpose === "gas"
                    ? "Use this server-side key with velo.gas. It cannot create checkout sessions or call general project APIs. Sponsorship still requires a funded relayer and an enabled project Gas policy."
                    : "Use this key with checkout and general project API endpoints. It cannot access Gas Station endpoints."}
                </p>
              </div>
              {selectedPurpose === "general" ? (
                <div className="grid gap-2">
                  <Label htmlFor="api-key-anchor" className="text-foreground">
                    Payment routing
                  </Label>
                  <select
                    id="api-key-anchor"
                    value={selectedAnchor}
                    onChange={(e) => setSelectedAnchor(e.target.value as "inhouse" | "pdax")}
                    disabled={isGeneratingKey}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-xs transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="inhouse">Velo's own process (In-house)</option>
                    <option value="pdax">PDAX Anchor</option>
                  </select>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {selectedAnchor === "inhouse"
                      ? "Standard payment flow routing directly to project owner address."
                      : "Routed via PDAX. Requires connected PDAX provider. Includes memo tags."}
                  </p>
                </div>
              ) : null}
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                variant="outline"
                onClick={() => setIsGenerateDialogOpen(false)}
                disabled={isGeneratingKey}
              >
                Cancel
              </Button>
              <Button
                onClick={() => void handleGenerateKey()}
                disabled={isGeneratingKey || !apiKeyLabel.trim()}
              >
                {isGeneratingKey ? "Generating..." : "Generate key"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {activeKeys.length > 0 ? (
          <div className="border-t border-border bg-muted/30 p-4">
            <h3 className="mb-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              Available API endpoints
            </h3>
            <div className="grid gap-2.5">
              {[
                ...(activeGeneralKeys.length > 0
                  ? [
                      {
                        method: "GET",
                        path: "/api/v1/events",
                        description: "Retrieve recent contract events observed for this project.",
                      },
                      {
                        method: "GET",
                        path: "/api/v1/transactions/[hash]",
                        description: "Lookup a Stellar transaction by hash.",
                      },
                      {
                        method: "GET",
                        path: "/api/v1/webhooks/deliveries",
                        description: "Check recent webhook delivery attempts.",
                      },
                      {
                        method: "POST",
                        path: "/api/v1/payment-intents",
                        description: "Create hosted checkout sessions for customer payments.",
                      },
                    ]
                  : []),
                ...(activeGasKeys.length > 0
                  ? [
                      {
                        method: "POST",
                        path: "/api/gas/sponsor",
                        description:
                          "Request a Testnet Gas sponsorship reservation using a server-side Gas key.",
                      },
                      {
                        method: "POST",
                        path: "/api/gas/submit",
                        description:
                          "Submit or recover a sponsored transaction using the same Gas key.",
                      },
                    ]
                  : []),
              ].map((endpoint) => (
                <div
                  key={endpoint.path}
                  className="flex flex-col justify-between gap-2 rounded-md border border-border bg-card p-3 md:flex-row md:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <span className="mr-2 inline-flex rounded bg-muted px-2 py-0.5 font-mono text-xs font-medium text-foreground">
                      {endpoint.method}
                    </span>
                    <span className="font-mono text-xs text-foreground">{endpoint.path}</span>
                    <p className="mt-1 text-xs text-muted-foreground">{endpoint.description}</p>
                  </div>
                  <Button variant="outline" size="xs" onClick={() => copyEndpoint(endpoint.path)}>
                    Copy URL
                  </Button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
