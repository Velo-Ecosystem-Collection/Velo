"use client";

import { stellarConfig } from "@/core/config/stellar";
import { api } from "@repo/backend/convex/_generated/api";
import { CopyButton } from "@repo/ui/components/common/copy-button";
import { Badge } from "@repo/ui/components/ui-customs/badge";
import { Alert, AlertDescription, AlertTitle } from "@repo/ui/components/ui/alert";
import { Button } from "@repo/ui/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@repo/ui/components/ui/card";
import { Skeleton } from "@repo/ui/components/ui/skeleton";
import { useAction } from "convex/react";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  ExternalLinkIcon,
  InfoIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import type { Id } from "@repo/backend/convex/_generated/dataModel";

import { GasRelayerConfigurationForm } from "./gas-relayer-form";
import {
  getGasRelayerBalanceFreshness,
  getGasRelayerBalanceState,
  getGasRelayerRefreshCooldownRemaining,
  getGasRelayerRefreshCooldownUntil,
  getGasRelayerRefreshFeedback,
  formatStroopsAsXlm,
  isCurrentGasRelayerRefreshRequest,
  isValidGasRelayerTimestamp,
  type GasPolicyRole,
  type GasRelayerBalanceFreshness,
  type GasRelayerRefreshFeedback,
  type GasRelayerRefreshRequest,
  type GasRelayerSnapshot,
} from "./gas-ui";

type GasRelayerPanelProps = {
  projectId: Id<"projects">;
  walletAddress: string | null;
  role: GasPolicyRole;
  relayer: GasRelayerSnapshot | null | undefined;
};

const STELLAR_LAB_FUND_URL = "https://lab.stellar.org/account/fund";
const STELLAR_LAB_GUIDANCE_URL = "https://developers.stellar.org/docs/tools/lab/account";

function relayerContextKey(
  projectId: Id<"projects">,
  walletAddress: string | null,
  relayer: GasRelayerSnapshot | null | undefined,
): string {
  const walletKey = walletAddress ?? "no-wallet";
  if (relayer === undefined) return `${projectId}|${walletKey}|loading`;
  if (relayer === null) return `${projectId}|${walletKey}|missing`;
  return `${projectId}|${walletKey}|${relayer.publicKey}|${relayer.network}|${relayer.status}`;
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1 border-b border-border/70 pb-3 last:border-b-0 last:pb-0 sm:grid-cols-[minmax(8rem,0.8fr)_minmax(0,1.2fr)] sm:items-start sm:gap-4">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

function freshnessLabel(freshness: GasRelayerBalanceFreshness): string {
  switch (freshness) {
    case "fresh":
      return "Fresh snapshot";
    case "stale":
      return "Stale snapshot";
    case "never_verified":
      return "Never verified";
    case "invalid_timestamp":
      return "Freshness unavailable";
  }
}

function freshnessVariant(freshness: GasRelayerBalanceFreshness): "success" | "warning" | "gray" {
  switch (freshness) {
    case "fresh":
      return "success";
    case "stale":
      return "warning";
    case "never_verified":
    case "invalid_timestamp":
      return "gray";
  }
}

function freshnessDescription(freshness: GasRelayerBalanceFreshness): string {
  switch (freshness) {
    case "fresh":
      return "Verified within the last five minutes.";
    case "stale":
      return "This snapshot is at least five minutes old. Refresh after funding or before relying on it operationally.";
    case "never_verified":
      return "No verified native balance snapshot is available yet.";
    case "invalid_timestamp":
      return "The stored verification time is not valid, so freshness cannot be established.";
  }
}

function lastVerifiedLabel(relayer: GasRelayerSnapshot): string {
  if (relayer.balanceStroops === null || relayer.balanceUpdatedAt === null) {
    return "Never verified";
  }
  if (!isValidGasRelayerTimestamp(relayer.balanceUpdatedAt)) return "Unavailable";
  return new Date(relayer.balanceUpdatedAt).toLocaleString();
}

function accountExplorerUrl(publicKey: string): string {
  return `https://stellar.expert/explorer/testnet/account/${encodeURIComponent(publicKey)}`;
}

function RefreshFeedback({ feedback }: { feedback: GasRelayerRefreshFeedback }) {
  const isError = feedback.tone === "error";
  const Icon = isError
    ? AlertCircleIcon
    : feedback.tone === "success"
      ? CheckCircle2Icon
      : InfoIcon;

  return (
    <Alert variant={isError ? "destructive" : undefined} aria-live="polite">
      <Icon />
      <AlertTitle>
        {isError ? "Balance refresh needs attention" : "Balance refresh status"}
      </AlertTitle>
      <AlertDescription>{feedback.message}</AlertDescription>
    </Alert>
  );
}

function RelayerFundingInstructions({ publicKey }: { publicKey: string }) {
  return (
    <Alert>
      <InfoIcon />
      <AlertTitle>Fund the existing configured address</AlertTitle>
      <AlertDescription>
        <p>
          Copy the public address above and paste it into Stellar Lab&apos;s Fund Account page on
          Testnet. Fund this existing address, then return here and refresh the balance. Funding
          does not change metadata status or prove signer readiness.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button asChild size="sm" variant="outline">
            <a href={STELLAR_LAB_FUND_URL} target="_blank" rel="noreferrer">
              Fund with Stellar Lab
              <ExternalLinkIcon />
            </a>
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href={accountExplorerUrl(publicKey)} target="_blank" rel="noreferrer">
              View account in Stellar Expert
              <ExternalLinkIcon />
            </a>
          </Button>
          <a
            className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            href={STELLAR_LAB_GUIDANCE_URL}
            target="_blank"
            rel="noreferrer"
          >
            Read Stellar Lab funding guidance
            <ExternalLinkIcon className="size-3" />
          </a>
        </div>
      </AlertDescription>
    </Alert>
  );
}

function GasRelayerLoading() {
  return (
    <div className="grid gap-3" aria-label="Loading relayer funding and balance">
      <div className="flex items-center justify-between gap-3">
        <div className="grid gap-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-48" />
        </div>
        <Skeleton className="h-6 w-24 rounded-full" />
      </div>
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

type ConfiguredRelayerDetailsProps = {
  relayer: GasRelayerSnapshot;
  now: number;
  canRefresh: boolean;
  cooldownRemaining: number;
  isRefreshing: boolean;
  feedback: GasRelayerRefreshFeedback | null;
  onRefresh: () => void;
};

function ConfiguredRelayerDetails({
  relayer,
  now,
  canRefresh,
  cooldownRemaining,
  isRefreshing,
  feedback,
  onRefresh,
}: ConfiguredRelayerDetailsProps) {
  const balanceState = getGasRelayerBalanceState(relayer.balanceStroops);
  const freshness = getGasRelayerBalanceFreshness(
    relayer.balanceStroops,
    relayer.balanceUpdatedAt,
    now,
  );
  const balanceLabel =
    relayer.balanceStroops === null ? "Not verified" : formatStroopsAsXlm(relayer.balanceStroops);

  return (
    <>
      <dl className="grid gap-4">
        <DetailRow label="Public address">
          <div className="flex min-w-0 items-start gap-1">
            <code className="min-w-0 flex-1 font-mono text-xs break-all">{relayer.publicKey}</code>
            <CopyButton value={relayer.publicKey} label="relayer public address" />
          </div>
        </DetailRow>
        <DetailRow label="Network">
          <Badge variant="info">{stellarConfig.networkLabel}</Badge>
        </DetailRow>
        <DetailRow label="Metadata status">
          <div className="grid gap-1">
            <Badge variant={relayer.status === "active" ? "success" : "gray"}>
              {relayer.status === "active" ? "Stored metadata active" : "Stored metadata disabled"}
            </Badge>
            <span className="text-xs text-muted-foreground">
              Metadata status is not signer readiness. Disabled metadata can still be refreshed to
              observe this configured public account.
            </span>
          </div>
        </DetailRow>
        <DetailRow label="Native XLM balance">
          <div className="grid gap-1">
            <span className="font-medium tabular-nums">{balanceLabel}</span>
            {balanceState === "zero" ? (
              <Badge variant="warning" className="w-fit">
                Zero balance observed
              </Badge>
            ) : null}
            {balanceState === "unverified" ? (
              <span className="text-xs text-muted-foreground">
                No balance snapshot has been verified yet.
              </span>
            ) : null}
          </div>
        </DetailRow>
        <DetailRow label="Last verification">
          <div className="grid gap-1">
            <span>{lastVerifiedLabel(relayer)}</span>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={freshnessVariant(freshness)}>{freshnessLabel(freshness)}</Badge>
              <span className="text-xs text-muted-foreground">
                {freshnessDescription(freshness)}
              </span>
            </div>
          </div>
        </DetailRow>
      </dl>

      <Alert>
        <InfoIcon />
        <AlertTitle>What this balance means</AlertTitle>
        <AlertDescription>
          The observed native balance is a verified ledger snapshot. It does not establish spendable
          balance, custody, or signer readiness.
        </AlertDescription>
      </Alert>

      <RelayerFundingInstructions publicKey={relayer.publicKey} />

      <div className="grid gap-2 border-t border-border/70 pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            onClick={onRefresh}
            disabled={!canRefresh || isRefreshing || cooldownRemaining > 0}
            aria-describedby="relayer-refresh-status"
          >
            <RefreshCwIcon className={isRefreshing ? "animate-spin" : undefined} />
            {isRefreshing
              ? "Verifying balance…"
              : cooldownRemaining > 0
                ? `Refresh available in ${Math.ceil(cooldownRemaining / 1_000)}s`
                : "Refresh balance"}
          </Button>
          <p
            id="relayer-refresh-status"
            className="text-xs text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            {isRefreshing
              ? "Checking the configured account on Stellar Testnet."
              : cooldownRemaining > 0
                ? `Refresh is cooling down for ${Math.ceil(cooldownRemaining / 1_000)} more seconds.`
                : "Refresh is manual; this panel does not poll the network."}
          </p>
        </div>
        {feedback ? <RefreshFeedback feedback={feedback} /> : null}
      </div>
    </>
  );
}

export function GasRelayerPanel({ projectId, walletAddress, role, relayer }: GasRelayerPanelProps) {
  const refreshRelayerBalance = useAction(api.gas.balance_action.refreshRelayerBalance);
  const [now, setNow] = useState(() => Date.now());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<GasRelayerRefreshFeedback | null>(null);
  const requestIdRef = useRef(0);
  const activeRequestRef = useRef<GasRelayerRefreshRequest | null>(null);
  const contextKey = relayerContextKey(projectId, walletAddress, relayer);
  const contextKeyRef = useRef(contextKey);
  const contextVersionRef = useRef(0);

  if (contextKeyRef.current !== contextKey) {
    contextKeyRef.current = contextKey;
    contextVersionRef.current += 1;
    activeRequestRef.current = null;
  }

  // This timer only advances local countdown/freshness labels; it never calls the network.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setFeedback(null);
    setCooldownUntil(null);
    setIsRefreshing(false);
  }, [contextKey]);

  const cooldownRemaining = getGasRelayerRefreshCooldownRemaining(cooldownUntil, now);
  const canRefresh = role === "owner" || role === "editor" || role === "viewer";

  function handleRefresh() {
    if (!relayer || !canRefresh || isRefreshing || cooldownRemaining > 0) return;

    const dispatchedAt = Date.now();
    const request: GasRelayerRefreshRequest = {
      id: ++requestIdRef.current,
      contextVersion: contextVersionRef.current,
    };
    activeRequestRef.current = request;
    setIsRefreshing(true);
    setNow(dispatchedAt);
    setCooldownUntil(getGasRelayerRefreshCooldownUntil(dispatchedAt, dispatchedAt));
    setFeedback({
      tone: "info",
      message: "Balance verification is pending. The last verified snapshot remains displayed.",
      retainsSnapshot: true,
    });

    void refreshRelayerBalance({ projectId })
      .then((outcome) => {
        if (!isCurrentGasRelayerRefreshRequest(activeRequestRef.current, request)) return;
        const responseAt = Date.now();
        const retryAfterMs = outcome.status === "cooldown" ? outcome.retryAfterMs : 0;
        setNow(responseAt);
        setCooldownUntil((current) =>
          Math.max(
            current ?? 0,
            getGasRelayerRefreshCooldownUntil(dispatchedAt, responseAt, retryAfterMs),
          ),
        );
        setFeedback(getGasRelayerRefreshFeedback(outcome));
      })
      .catch(() => {
        if (!isCurrentGasRelayerRefreshRequest(activeRequestRef.current, request)) return;
        setFeedback({
          tone: "error",
          message:
            "Balance refresh could not be completed. The last verified balance and verification time are unchanged.",
          retainsSnapshot: true,
        });
      })
      .finally(() => {
        if (!isCurrentGasRelayerRefreshRequest(activeRequestRef.current, request)) return;
        activeRequestRef.current = null;
        setIsRefreshing(false);
      });
  }

  return (
    <div className="grid min-w-0 gap-4">
      <Card>
        <CardHeader>
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
            <div className="grid min-w-0 gap-2">
              <h2 className="text-lg font-semibold">Relayer funding &amp; balance</h2>
              <CardDescription>
                Verified native XLM observation for the configured Testnet fee relayer.
              </CardDescription>
            </div>
            {relayer ? (
              <Badge variant={relayer.status === "active" ? "success" : "gray"}>
                {relayer.status === "active" ? "Metadata active" : "Metadata disabled"}
              </Badge>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="grid min-w-0 gap-5">
          {relayer === undefined ? <GasRelayerLoading /> : null}

          {relayer === null ? (
            <Alert>
              <InfoIcon />
              <AlertTitle>No relayer configured</AlertTitle>
              <AlertDescription>
                This project has no configured public Testnet relayer address to fund or verify.
                Relayer metadata must be configured by an owner before a balance can be observed.
              </AlertDescription>
            </Alert>
          ) : null}

          {relayer ? (
            <ConfiguredRelayerDetails
              relayer={relayer}
              now={now}
              canRefresh={canRefresh}
              cooldownRemaining={cooldownRemaining}
              isRefreshing={isRefreshing}
              feedback={feedback}
              onRefresh={handleRefresh}
            />
          ) : null}
        </CardContent>
      </Card>

      {role === "owner" && relayer !== undefined ? (
        <GasRelayerConfigurationForm projectId={projectId} relayer={relayer} />
      ) : null}
    </div>
  );
}
