"use client";

import { useWallet } from "@/core/wallet/wallet-provider";
import { api } from "@repo/backend/convex/_generated/api";
import { Badge } from "@repo/ui/components/ui-customs/badge";
import { Alert, AlertDescription, AlertTitle } from "@repo/ui/components/ui/alert";
import { Button } from "@repo/ui/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@repo/ui/components/ui/card";
import { Skeleton } from "@repo/ui/components/ui/skeleton";
import { useQuery } from "convex/react";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  InfoIcon,
  LockKeyholeIcon,
  WalletIcon,
} from "lucide-react";
import Link from "next/link";
import { Component, type ErrorInfo, type ReactNode, useState } from "react";

import type { Id } from "@repo/backend/convex/_generated/dataModel";

import { GasPolicyForm } from "./gas-policy-form";
import { GasRelayerPanel } from "./gas-relayer-panel";
import { formatStroopsAsXlm, getGasAccessState, type GasPolicySnapshot } from "./gas-ui";

type ProjectGasProps = {
  projectId: string;
};

type GasQueryErrorBoundaryProps = {
  children: ReactNode;
  onRetry: () => void;
};

type GasQueryErrorBoundaryState = {
  hasError: boolean;
};

class GasQueryErrorBoundary extends Component<
  GasQueryErrorBoundaryProps,
  GasQueryErrorBoundaryState
> {
  state: GasQueryErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): GasQueryErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(_error: Error, _errorInfo: ErrorInfo) {
    // Query details stay out of the UI; the shared boundary provides recovery only.
  }

  render() {
    if (this.state.hasError) {
      return <GasQueryErrorState onRetry={this.props.onRetry} />;
    }

    return this.props.children;
  }
}

function GasQueryErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <section className="grid gap-4" aria-labelledby="gas-query-error-title">
      <h1 id="gas-query-error-title" className="text-3xl font-semibold tracking-normal">
        Gas Station unavailable
      </h1>
      <Alert variant="destructive">
        <AlertCircleIcon />
        <AlertTitle>Gas Station data could not be loaded</AlertTitle>
        <AlertDescription>
          The project is still protected, but its Gas Station overview is temporarily unavailable.
          Retry the read or return to the dashboard.
        </AlertDescription>
      </Alert>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={onRetry}>
          Retry
        </Button>
        <Button asChild variant="outline">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </div>
    </section>
  );
}

function ConnectWalletState({ onConnect }: { onConnect: () => void }) {
  return (
    <section className="grid gap-4" aria-labelledby="gas-connect-title">
      <div>
        <h1 id="gas-connect-title" className="text-3xl font-semibold tracking-normal">
          Gas Station
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Read-only sponsorship policy and relayer metadata for a Testnet project.
        </p>
      </div>
      <Alert>
        <WalletIcon />
        <AlertTitle>Connect your wallet to continue</AlertTitle>
        <AlertDescription>
          Sign in with the wallet that has access to this project. The existing login and signup
          flow will continue from there.
        </AlertDescription>
      </Alert>
      <Button type="button" onClick={onConnect} className="w-fit">
        <WalletIcon />
        Connect wallet
      </Button>
    </section>
  );
}

function GasLoadingState() {
  return (
    <section className="grid gap-6" aria-busy="true" aria-live="polite">
      <div className="grid gap-2">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-5 w-full max-w-xl" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <SummaryCardSkeleton />
        <SummaryCardSkeleton />
      </div>
    </section>
  );
}

function SummaryCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-full max-w-sm" />
      </CardHeader>
      <CardContent className="grid gap-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </CardContent>
    </Card>
  );
}

function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1 border-b border-border/70 pb-3 last:border-b-0 last:pb-0 sm:grid-cols-[minmax(8rem,0.8fr)_minmax(0,1.2fr)] sm:items-start sm:gap-4">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

function PolicySummary({ policy }: { policy: GasPolicySnapshot | null | undefined }) {
  return (
    <Card>
      <CardHeader>
        <h2 className="text-lg font-semibold">Policy summary</h2>
        <CardDescription>
          Stored sponsorship controls. Policy editing and usage telemetry are not part of this
          overview.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {policy === undefined ? (
          <div className="grid gap-3" aria-label="Loading policy summary">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : policy === null ? (
          <Alert>
            <InfoIcon />
            <AlertTitle>No Gas policy configured</AlertTitle>
            <AlertDescription>
              This project does not have a stored Testnet sponsorship policy yet.
            </AlertDescription>
          </Alert>
        ) : (
          <dl className="grid gap-4">
            <SummaryRow label="Status">
              <Badge variant={policy.enabled ? "success" : "gray"}>
                {policy.enabled ? "Enabled" : "Disabled"}
              </Badge>
            </SummaryRow>
            <SummaryRow label="Daily cap">
              <span className="font-medium">{formatStroopsAsXlm(policy.dailyCapStroops)}</span>
            </SummaryRow>
            <SummaryRow label="Hourly wallet quota">
              <span className="font-medium">{policy.walletHourlyLimit} request(s) per wallet</span>
            </SummaryRow>
            <SummaryRow label="Allowed contracts">
              <span className="font-medium">{policy.allowedContractIds.length}</span>
            </SummaryRow>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

function ProjectGasContent({ projectId }: ProjectGasProps) {
  const wallet = useWallet();
  const typedProjectId = projectId as Id<"projects">;
  const access = useQuery(
    api.playground_projects.queries.getMyAccess,
    wallet.address ? { projectId: typedProjectId } : "skip",
  );
  const project = useQuery(
    api.projects.query.getById,
    wallet.address && access ? { id: typedProjectId } : "skip",
  );
  const accessState = getGasAccessState({
    walletAddress: wallet.address,
    access,
    project,
  });
  const gasReadsReady = accessState === "ready";
  const policy = useQuery(
    api.gas.queries.getPolicy,
    gasReadsReady ? { projectId: typedProjectId } : "skip",
  );
  const relayer = useQuery(
    api.gas.queries.getRelayerAccount,
    gasReadsReady ? { projectId: typedProjectId } : "skip",
  );

  if (accessState === "connect") {
    return <ConnectWalletState onConnect={() => void wallet.connect()} />;
  }

  if (accessState === "loading") {
    return <GasLoadingState />;
  }

  if (accessState === "unavailable" || !project || !access) {
    return (
      <section className="grid gap-4" aria-labelledby="gas-unavailable-title">
        <h1 id="gas-unavailable-title" className="text-3xl font-semibold tracking-normal">
          Project unavailable
        </h1>
        <Alert variant="destructive">
          <LockKeyholeIcon />
          <AlertTitle>Project unavailable</AlertTitle>
          <AlertDescription>
            This project does not exist or you do not have access to it.
          </AlertDescription>
        </Alert>
        <Button asChild variant="outline" className="w-fit">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </section>
    );
  }

  return (
    <section className="grid min-w-0 gap-6" aria-labelledby="gas-station-title">
      <header className="grid min-w-0 gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 id="gas-station-title" className="min-w-0 text-3xl font-semibold tracking-normal">
            Gas Station
          </h1>
          <Badge variant="info">Testnet</Badge>
        </div>
        <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
          <p className="min-w-0 text-sm break-words text-muted-foreground">
            Sponsorship policy overview for <span className="font-medium">{project.name}</span>.
          </p>
          <Badge variant="outline">{access.role} access</Badge>
        </div>
      </header>

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <PolicySummary policy={policy} />
        <GasRelayerPanel
          projectId={typedProjectId}
          walletAddress={wallet.address}
          role={access.role}
          relayer={relayer}
        />
      </div>

      <GasPolicyForm projectId={typedProjectId} policy={policy} role={access.role} />

      <Alert>
        <CheckCircle2Icon />
        <AlertTitle>Authoritative policy controls</AlertTitle>
        <AlertDescription>
          Policy changes are validated in the browser, authorized by Convex, and reflected from the
          stored policy readback. Balance observations are refreshed manually from the funding panel
          above; funding remains an external Testnet operation and does not establish signer
          readiness.
        </AlertDescription>
      </Alert>
    </section>
  );
}

export function ProjectGas({ projectId }: ProjectGasProps) {
  const wallet = useWallet();
  const [retryKey, setRetryKey] = useState(0);
  const boundaryKey = `${projectId}:${wallet.address ?? "disconnected"}:${retryKey}`;

  return (
    <GasQueryErrorBoundary key={boundaryKey} onRetry={() => setRetryKey((current) => current + 1)}>
      <ProjectGasContent projectId={projectId} />
    </GasQueryErrorBoundary>
  );
}
