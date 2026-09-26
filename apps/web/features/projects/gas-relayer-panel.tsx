"use client";

import { stellarConfig } from "@/core/config/stellar";
import { api } from "@repo/backend/convex/_generated/api";
import { CopyButton } from "@repo/ui/components/common/copy-button";
import { Badge } from "@repo/ui/components/ui-customs/badge";
import { Alert, AlertDescription, AlertTitle } from "@repo/ui/components/ui/alert";
import { Button } from "@repo/ui/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@repo/ui/components/ui/card";
import { Skeleton } from "@repo/ui/components/ui/skeleton";
import { useAction, useMutation } from "convex/react";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  ExternalLinkIcon,
  InfoIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import type { Id } from "@repo/backend/convex/_generated/dataModel";

import { GasManagedActivation } from "./gas-managed-activation";
import { GasRelayerConfigurationForm } from "./gas-relayer-form";
import { GasRelayerFunding } from "./gas-relayer-funding";
import { GasRelayerWithdrawal } from "./gas-relayer-withdrawal";
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
  type GasRelayerProvisioningSnapshot,
  type GasRelayerRefreshFeedback,
  type GasRelayerRefreshRequest,
  type GasRelayerSnapshot,
} from "./gas-ui";

type GasRelayerPanelProps = {
  projectId: Id<"projects">;
  walletAddress: string | null;
  role: GasPolicyRole;
  relayer: GasRelayerSnapshot | null | undefined;
  provisioning: GasRelayerProvisioningSnapshot | undefined;
};

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

function RelayerAccountExplorer({ publicKey }: { publicKey: string }) {
  return (
    <Alert>
      <InfoIcon />
      <AlertTitle>Testnet account</AlertTitle>
      <AlertDescription>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button asChild size="sm" variant="outline">
            <a href={accountExplorerUrl(publicKey)} target="_blank" rel="noreferrer">
              View on Stellar Expert
              <ExternalLinkIcon />
            </a>
          </Button>
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
  projectId: Id<"projects">;
  role: GasPolicyRole;
  relayer: GasRelayerSnapshot;
  managedCustodyContextVerified: boolean;
  now: number;
  canRefresh: boolean;
  cooldownRemaining: number;
  isRefreshing: boolean;
  feedback: GasRelayerRefreshFeedback | null;
  onRefresh: () => void;
};

function ConfiguredRelayerDetails({
  projectId,
  role,
  relayer,
  managedCustodyContextVerified,
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

      <RelayerAccountExplorer publicKey={relayer.publicKey} />
      {managedCustodyContextVerified ? (
        <GasRelayerFunding projectId={projectId} role={role} />
      ) : (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Relayer deployment needs operator attention</AlertTitle>
          <AlertDescription>
            Funding is unavailable because this managed account&apos;s deployment context is not
            verified. Contact a Velo operator before adding funds or enabling sponsorship.
          </AlertDescription>
        </Alert>
      )}

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

export function GasRelayerPanel({
  projectId,
  walletAddress,
  role,
  relayer,
  provisioning,
}: GasRelayerPanelProps) {
  const refreshRelayerBalance = useAction(api.gas.balance_action.refreshRelayerBalance);
  const retryProvisioning = useMutation(api.gas.mutations.retryProvisioning);
  const setManagedRelayerStatus = useMutation(api.gas.mutations.setManagedRelayerStatus);
  const [now, setNow] = useState(() => Date.now());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<GasRelayerRefreshFeedback | null>(null);
  const [provisioningBusy, setProvisioningBusy] = useState(false);
  const [provisioningQueued, setProvisioningQueued] = useState(false);
  const [setupFeedback, setSetupFeedback] = useState<{
    tone: "info" | "error";
    message: string;
  } | null>(null);
  const [provisioningMessage, setProvisioningMessage] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const activeRequestRef = useRef<GasRelayerRefreshRequest | null>(null);
  const contextKey = relayerContextKey(projectId, walletAddress, relayer);
  const contextKeyRef = useRef(contextKey);
  const contextVersionRef = useRef(0);
  const provisioningStateRef = useRef(provisioning?.state);
  provisioningStateRef.current = provisioning?.state;

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

  useEffect(() => {
    if (provisioning?.state === "pending") {
      setProvisioningQueued(true);
    } else if (
      provisioning?.state === "not_configured" ||
      provisioning?.state === "failed" ||
      provisioning?.state === "ready"
    ) {
      setProvisioningQueued(false);
    }
  }, [projectId, provisioning?.state]);

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

  async function handleProvisioningRetry() {
    if (role !== "owner" || provisioningBusy) return;
    setProvisioningBusy(true);
    setSetupFeedback(null);
    try {
      const result = await retryProvisioning({ projectId });
      if (result === "queued" || result === "already_pending") {
        setProvisioningQueued(true);
        setSetupFeedback({
          tone: "info",
          message:
            result === "queued"
              ? "Wallet generation is queued. The public address will appear after encrypted custody is committed."
              : "Wallet generation is already in progress.",
        });
      } else {
        setProvisioningQueued(false);
        setSetupFeedback({
          tone: "info",
          message:
            result === "already_ready"
              ? "A managed relayer is already ready. Its current address will be shown after readback."
              : "A manually configured relayer is already present and was left unchanged.",
        });
      }
      if (provisioningStateRef.current === "ready" || provisioningStateRef.current === "failed") {
        setProvisioningQueued(false);
      }
    } catch {
      setProvisioningQueued(false);
      setSetupFeedback({
        tone: "error",
        message: "Wallet generation could not be queued. Your project was not changed; try again.",
      });
    } finally {
      setProvisioningBusy(false);
    }
  }

  async function handleManagedRelayerStatus(status: "active" | "disabled") {
    if (role !== "owner" || provisioningBusy) return;
    setProvisioningBusy(true);
    setProvisioningMessage(null);
    try {
      await setManagedRelayerStatus({ projectId, status });
      setProvisioningMessage(
        status === "disabled"
          ? "Sponsorship is paused. Resume it after reviewing the policy and funding balance."
          : "The relayer is active. Sponsorship remains disabled until an editor enables its policy.",
      );
    } catch {
      setProvisioningMessage("The relayer state could not be changed. Refresh and try again.");
    } finally {
      setProvisioningBusy(false);
    }
  }

  const managedRelayer = provisioning?.managed === true;
  const managedCustodyContextVerified =
    managedRelayer &&
    provisioning?.state === "ready" &&
    provisioning.deploymentContextMatches === true;
  const managedCustodyContextNeedsAttention =
    managedRelayer &&
    provisioning?.state === "ready" &&
    provisioning.deploymentContextMatches !== true;
  const provisioningIsPending = provisioning?.state === "pending" || provisioningQueued;
  const provisioningErrorDescription =
    provisioning?.state === "failed"
      ? provisioning.errorCode === "provisioning_disabled"
        ? "Managed relayer provisioning is disabled for this deployment. An operator must enable the Testnet feature flag before retrying."
        : provisioning.errorCode === "configuration_unavailable"
          ? "The deployment encryption keyring or deployment identity is not configured. No signer or address was stored."
          : provisioning.errorCode === "configuration_invalid"
            ? "The deployment encryption keyring is invalid. No signer or address was stored."
            : provisioning.errorCode === "relayer_already_configured"
              ? "A relayer appeared while the wallet was being generated. No replacement address was published; contact an owner before retrying."
              : "Wallet generation did not complete. No replacement address was published; resolve the setup issue and retry."
      : null;

  return (
    <div className="grid min-w-0 gap-4">
      {relayer === null ? (
        <Card className="border-primary/30 shadow-sm">
          <CardHeader>
            <h2 className="text-xl font-semibold">Generate a Testnet relayer wallet</h2>
            <CardDescription>
              Velo generates and stores the signer in encrypted custody. Only the public address is
              shown, after the encrypted record is committed. Sponsorship starts disabled; fund the
              wallet and explicitly activate sponsorship when you are ready.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid min-w-0 gap-4">
            {provisioning === undefined ? (
              <Alert aria-live="polite">
                <InfoIcon />
                <AlertTitle>Checking relayer setup</AlertTitle>
                <AlertDescription>
                  The project&apos;s current wallet and provisioning state are loading.
                </AlertDescription>
              </Alert>
            ) : provisioningIsPending ? (
              <Alert aria-live="polite">
                <RefreshCwIcon className="animate-spin" />
                <AlertTitle>Relayer wallet generation in progress</AlertTitle>
                <AlertDescription>
                  The address will appear after encrypted custody is committed. No address is
                  published while generation is pending.
                </AlertDescription>
              </Alert>
            ) : provisioningErrorDescription ? (
              <Alert variant="destructive" aria-live="polite">
                <AlertCircleIcon />
                <AlertTitle>Relayer wallet setup needs attention</AlertTitle>
                <AlertDescription>{provisioningErrorDescription}</AlertDescription>
              </Alert>
            ) : managedRelayer &&
              provisioning?.state === "ready" &&
              !managedCustodyContextVerified ? (
              <Alert variant="destructive" aria-live="polite">
                <AlertCircleIcon />
                <AlertTitle>Relayer deployment needs operator attention</AlertTitle>
                <AlertDescription>
                  This stored account cannot be verified for the current deployment. Do not fund or
                  enable sponsorship until a Velo operator resolves its custody context.
                </AlertDescription>
              </Alert>
            ) : provisioning?.state === "ready" ? (
              <Alert aria-live="polite">
                <InfoIcon />
                <AlertTitle>Relayer wallet is ready</AlertTitle>
                <AlertDescription>
                  Waiting for the committed public address to load before showing funding controls.
                </AlertDescription>
              </Alert>
            ) : (
              <Alert>
                <InfoIcon />
                <AlertTitle>No relayer wallet is configured</AlertTitle>
                <AlertDescription>
                  Generate one for this project. Velo will not expose its address or enable
                  sponsorship until encrypted custody is committed.
                </AlertDescription>
              </Alert>
            )}

            {setupFeedback ? (
              <Alert
                variant={setupFeedback.tone === "error" ? "destructive" : undefined}
                role={setupFeedback.tone === "error" ? "alert" : "status"}
                aria-live="polite"
              >
                {setupFeedback.tone === "error" ? <AlertCircleIcon /> : <InfoIcon />}
                <AlertTitle>
                  {setupFeedback.tone === "error" ? "Request could not be queued" : "Setup status"}
                </AlertTitle>
                <AlertDescription>{setupFeedback.message}</AlertDescription>
              </Alert>
            ) : null}

            {role === "owner" ? (
              <Button
                type="button"
                onClick={() => void handleProvisioningRetry()}
                disabled={
                  provisioningBusy ||
                  provisioningIsPending ||
                  provisioning?.state === undefined ||
                  provisioning?.state === "ready"
                }
              >
                <RefreshCwIcon
                  className={provisioningBusy || provisioningIsPending ? "animate-spin" : undefined}
                />
                {provisioningBusy
                  ? "Queuing wallet generation…"
                  : provisioningIsPending
                    ? "Generating wallet…"
                    : provisioning?.state === "failed"
                      ? "Retry wallet generation"
                      : provisioning?.state === "ready"
                        ? "Wallet generated"
                        : provisioning?.state === "not_configured"
                          ? "Generate Testnet relayer wallet"
                          : "Checking setup…"}
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                Only project owners can generate a relayer wallet. Ask an owner to continue setup.
              </p>
            )}

            {role === "owner" &&
            (provisioning?.state === "not_configured" || provisioning?.state === "failed") ? (
              <details className="rounded-md border border-border/70 px-4 py-3">
                <summary className="cursor-pointer text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none">
                  Advanced: configure an existing relayer
                </summary>
                <div className="pt-4">
                  <GasRelayerConfigurationForm projectId={projectId} relayer={null} />
                </div>
              </details>
            ) : null}
          </CardContent>
        </Card>
      ) : (
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

            {relayer ? (
              <ConfiguredRelayerDetails
                projectId={projectId}
                role={role}
                relayer={relayer}
                managedCustodyContextVerified={!managedRelayer || managedCustodyContextVerified}
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
      )}

      {managedRelayer && provisioning?.state === "ready" && role === "owner" ? (
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">Managed relayer controls</h2>
            <CardDescription>
              Velo stores this Testnet signer as authenticated ciphertext in Convex. A stored
              address or balance does not prove that the current deployment can decrypt and use it.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {managedCustodyContextNeedsAttention ? (
              <Alert variant="destructive">
                <AlertCircleIcon />
                <AlertTitle>
                  {provisioning.deploymentContextMatches === false
                    ? "Custody deployment context does not match"
                    : "Custody deployment context cannot be verified"}
                </AlertTitle>
                <AlertDescription>
                  Do not resume sponsorship, fund, or withdraw from this account until a Velo
                  operator resolves its deployment context. You can pause sponsorship while it is
                  active.
                </AlertDescription>
              </Alert>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {provisioning.relayerStatus === "active" ? (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => void handleManagedRelayerStatus("disabled")}
                  disabled={provisioningBusy}
                >
                  Pause sponsorship
                </Button>
              ) : managedCustodyContextVerified ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleManagedRelayerStatus("active")}
                  disabled={provisioningBusy}
                >
                  Resume relayer
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground" role="status">
                  Sponsorship cannot be resumed until the custody deployment context is verified.
                </p>
              )}
            </div>
            {provisioningMessage ? (
              <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
                {provisioningMessage}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {managedRelayer && managedCustodyContextVerified && role === "owner" ? (
        <>
          {provisioning.relayerStatus === "active" ? (
            <GasManagedActivation projectId={projectId} />
          ) : null}
          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold">Managed account withdrawal</h2>
              <CardDescription>
                Withdrawal pauses sponsorship, waits for active Gas commitments to settle, preserves
                account reserves, and sends only to your authenticated owner wallet.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <GasRelayerWithdrawal projectId={projectId} />
            </CardContent>
          </Card>
        </>
      ) : null}

      {role === "owner" && relayer !== undefined && relayer !== null && !managedRelayer ? (
        <GasRelayerConfigurationForm projectId={projectId} relayer={relayer} />
      ) : null}
    </div>
  );
}
