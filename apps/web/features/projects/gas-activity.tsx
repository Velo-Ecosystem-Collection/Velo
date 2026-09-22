"use client";

import { api } from "@repo/backend/convex/_generated/api";
import { Badge } from "@repo/ui/components/ui-customs/badge";
import { Alert, AlertDescription, AlertTitle } from "@repo/ui/components/ui/alert";
import { Button } from "@repo/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@repo/ui/components/ui/sheet";
import { Skeleton } from "@repo/ui/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/components/ui/table";
import { useConvexConnectionState, usePaginatedQuery, useQuery } from "convex/react";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  ExternalLinkIcon,
  FileTextIcon,
  InfoIcon,
  Loader2Icon,
  WifiOffIcon,
} from "lucide-react";
import {
  Component,
  type ErrorInfo,
  type MouseEvent,
  type ReactNode,
  useRef,
  useState,
} from "react";

import type { Id } from "@repo/backend/convex/_generated/dataModel";

import {
  formatGasActivityFee,
  formatGasActivityTimestamp,
  GAS_DECISION_LABELS,
  GAS_EXECUTION_STATUS_LABELS,
  GAS_LIFECYCLE_LABELS,
  GAS_REJECTION_LABELS,
  getGasExplorerLink,
  type GasExecutionDetailSnapshot,
  type GasExecutionStatus,
  type GasLifecycleState,
  type GasLogSnapshot,
} from "./gas-ui";

const ACTIVITY_PAGE_SIZE = 20;

type GasActivityProps = {
  projectId: Id<"projects">;
};

export type GasActivityPaginationStatus =
  | "LoadingFirstPage"
  | "CanLoadMore"
  | "LoadingMore"
  | "Exhausted";

export type GasActivityConnectionState = {
  isWebSocketConnected: boolean;
};

export type GasActivityViewProps = {
  logs: GasLogSnapshot[];
  paginationStatus: GasActivityPaginationStatus;
  onLoadMore: () => void;
  connectionState?: GasActivityConnectionState;
  readState?: "ready" | "error";
  onRetry?: () => void;
  renderExecutionDetail: (requestId: string, audit: GasLogSnapshot | null) => ReactNode;
};

const activityLifecycleVariants = {
  reserved: "info",
  rejected: "destructive",
  expired: "gray",
  claimed: "warning",
  submission_unknown: "warning",
  submitted: "warning",
  succeeded: "success",
  failed: "destructive",
  cancelled: "gray",
} satisfies Record<GasLifecycleState, "info" | "destructive" | "gray" | "warning" | "success">;

const executionStatusVariants = {
  claimed: "warning",
  submission_unknown: "warning",
  submitted: "warning",
  succeeded: "success",
  failed: "destructive",
  cancelled: "gray",
} satisfies Record<GasExecutionStatus, "destructive" | "gray" | "warning" | "success">;

const DEFAULT_CONNECTION_STATE: GasActivityConnectionState = {
  isWebSocketConnected: true,
};

type ActivityErrorBoundaryProps = {
  children: ReactNode;
  onRetry: () => void;
};

type ActivityErrorBoundaryState = {
  hasError: boolean;
};

class ActivityErrorBoundary extends Component<
  ActivityErrorBoundaryProps,
  ActivityErrorBoundaryState
> {
  state: ActivityErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ActivityErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(_error: Error, _errorInfo: ErrorInfo) {
    // Convex details stay out of the UI; the fallback gives the operator recovery guidance.
  }

  render() {
    return this.state.hasError ? (
      <GasActivityErrorState onRetry={this.props.onRetry} />
    ) : (
      this.props.children
    );
  }
}

class ReceiptDetailErrorBoundary extends Component<
  { children: ReactNode },
  ActivityErrorBoundaryState
> {
  state: ActivityErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ActivityErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(_error: Error, _errorInfo: ErrorInfo) {
    // Never expose Convex error details in a receipt panel.
  }

  render() {
    if (this.state.hasError) return <GasReceiptDetailErrorState />;

    return this.props.children;
  }
}

export function GasReceiptDetailErrorState() {
  return (
    <Alert variant="destructive">
      <AlertCircleIcon />
      <AlertTitle>Receipt detail unavailable</AlertTitle>
      <AlertDescription>
        The selected execution detail could not be loaded. Close and reopen the receipt after the
        connection recovers.
      </AlertDescription>
    </Alert>
  );
}

export function GasActivityErrorState({ onRetry }: { onRetry?: () => void }) {
  return (
    <section className="grid gap-4" aria-labelledby="gas-activity-error-title">
      <Alert variant="destructive">
        <AlertCircleIcon />
        <AlertTitle id="gas-activity-error-title">Gas activity unavailable</AlertTitle>
        <AlertDescription>
          Retained Gas activity could not be loaded. The failure details are hidden; retry the read
          after the connection recovers.
        </AlertDescription>
      </Alert>
      {onRetry ? (
        <Button type="button" variant="outline" className="w-fit" onClick={onRetry}>
          Retry activity
        </Button>
      ) : null}
    </section>
  );
}

function formatActivityDate(value: number | null) {
  const formatted = formatGasActivityTimestamp(value);
  return formatted === "Unavailable" ? (
    <span>Unavailable</span>
  ) : (
    <time dateTime={formatted}>{formatted}</time>
  );
}

function formatIdentifier(value: string | null | undefined) {
  return value ? (
    <span className="font-mono text-xs break-all">{value}</span>
  ) : (
    <span className="text-muted-foreground">Unavailable</span>
  );
}

function activityStatusLabel(status: GasActivityPaginationStatus, isConnected: boolean): string {
  if (!isConnected) return "Potentially stale";
  switch (status) {
    case "LoadingFirstPage":
      return "Loading";
    case "CanLoadMore":
    case "LoadingMore":
      return "Live activity";
    case "Exhausted":
      return "All retained activity loaded";
  }
}

function ActivityRow({
  log,
  isSelected,
  onSelect,
}: {
  log: GasLogSnapshot;
  isSelected: boolean;
  onSelect: (requestId: string, trigger: HTMLButtonElement) => void;
}) {
  function handleSelect(event: MouseEvent<HTMLButtonElement>) {
    onSelect(log.requestId, event.currentTarget);
  }

  return (
    <TableRow data-state={isSelected ? "selected" : undefined}>
      <TableCell className="hidden whitespace-nowrap sm:table-cell">
        {formatActivityDate(log.createdAt)}
      </TableCell>
      <TableCell className="max-w-48 whitespace-normal break-all font-mono text-xs">
        {log.requestId}
      </TableCell>
      <TableCell className="max-w-52 whitespace-normal break-all font-mono text-xs">
        {formatIdentifier(log.sourceWallet)}
      </TableCell>
      <TableCell>
        <Badge variant={activityLifecycleVariants[log.lifecycle]}>
          {GAS_LIFECYCLE_LABELS[log.lifecycle]}
        </Badge>
      </TableCell>
      <TableCell className="max-w-44 whitespace-normal break-words text-xs">
        {log.rejectionCode ? GAS_REJECTION_LABELS[log.rejectionCode] : "—"}
      </TableCell>
      <TableCell className="font-mono text-xs whitespace-nowrap">
        {formatGasActivityFee(log.actualFeeStroops)}
      </TableCell>
      <TableCell className="text-right">
        <SheetTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleSelect}
            aria-label={`View receipt details for ${log.requestId}`}
          >
            <FileTextIcon aria-hidden="true" />
            <span>Details</span>
          </Button>
        </SheetTrigger>
      </TableCell>
    </TableRow>
  );
}

function ActivityTable({
  logs,
  selectedRequestId,
  onSelect,
}: {
  logs: GasLogSnapshot[];
  selectedRequestId: string | null;
  onSelect: (requestId: string, trigger: HTMLButtonElement) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[720px]">
        <TableCaption>
          Retained Gas audit records. Amounts are exact XLM values; absent fees are unknown.
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead className="hidden sm:table-cell">UTC time</TableHead>
            <TableHead>Request ID</TableHead>
            <TableHead>Source wallet</TableHead>
            <TableHead>Audit lifecycle</TableHead>
            <TableHead>Rejection reason</TableHead>
            <TableHead>Actual fee</TableHead>
            <TableHead className="text-right">Receipt</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {logs.map((log) => (
            <ActivityRow
              key={log.requestId}
              log={log}
              isSelected={selectedRequestId === log.requestId}
              onSelect={onSelect}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ActivitySkeleton() {
  return (
    <div className="grid gap-3 p-4" aria-busy="true" aria-label="Loading Gas activity">
      {Array.from({ length: 5 }, (_, index) => (
        <Skeleton key={index} className="h-12 w-full" />
      ))}
    </div>
  );
}

function ActivityPagination({
  status,
  onLoadMore,
}: {
  status: GasActivityPaginationStatus;
  onLoadMore: () => void;
}) {
  if (status === "CanLoadMore") {
    return (
      <div className="flex justify-center border-t p-4">
        <Button type="button" variant="outline" onClick={onLoadMore}>
          Load more activity
        </Button>
      </div>
    );
  }

  if (status === "LoadingMore") {
    return (
      <div className="flex justify-center border-t p-4">
        <Button type="button" variant="outline" disabled>
          <Loader2Icon className="animate-spin" aria-hidden="true" />
          Loading more activity…
        </Button>
      </div>
    );
  }

  if (status === "Exhausted") {
    return (
      <p className="border-t p-4 text-center text-sm text-muted-foreground">
        No more retained activity to load.
      </p>
    );
  }

  return null;
}

function ReceiptField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1 border-b border-border/70 pb-3 last:border-b-0 last:pb-0">
      <dt className="text-xs font-medium text-muted-foreground uppercase">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

function HashReference({
  hash,
  kind,
}: {
  hash: string | null | undefined;
  kind: "inner" | "outer";
}) {
  const explorerLink = getGasExplorerLink(hash, kind);

  return (
    <div className="grid min-w-0 gap-2">
      {formatIdentifier(hash)}
      {explorerLink ? (
        <a
          href={explorerLink.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex w-fit items-center gap-1 text-sm text-primary underline underline-offset-4"
        >
          {explorerLink.label}
          <ExternalLinkIcon className="size-3" aria-hidden="true" />
        </a>
      ) : hash ? (
        <span className="text-xs text-muted-foreground">
          Hash present, but no explorer link was created because it is not a validated 64-character
          hexadecimal hash.
        </span>
      ) : null}
      {explorerLink ? (
        <span className="text-xs text-muted-foreground">
          This is a Testnet lookup only; a hash or link does not establish confirmation.
        </span>
      ) : null}
    </div>
  );
}

function AuditReceiptSection({ audit }: { audit: GasLogSnapshot | null }) {
  if (!audit) {
    return (
      <Alert>
        <InfoIcon />
        <AlertTitle>Audit information unavailable</AlertTitle>
        <AlertDescription>
          The retained audit row is no longer available, possibly because its 30-day retention
          period ended. Durable execution detail, when retained, is shown below.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <section className="grid gap-3" aria-labelledby="gas-audit-decision-title">
      <div>
        <h3 id="gas-audit-decision-title" className="text-base font-semibold">
          Audit decision and lifecycle
        </h3>
        <p className="text-sm text-muted-foreground">
          Retained request admission facts, separate from durable execution status.
        </p>
      </div>
      <dl className="grid gap-3">
        <ReceiptField label="Request ID">{formatIdentifier(audit.requestId)}</ReceiptField>
        <ReceiptField label="Audit decision">
          <Badge variant={audit.decisionCode === "reserved" ? "success" : "destructive"}>
            {GAS_DECISION_LABELS[audit.decisionCode]}
          </Badge>
        </ReceiptField>
        <ReceiptField label="Audit lifecycle">
          <Badge variant={activityLifecycleVariants[audit.lifecycle]}>
            {GAS_LIFECYCLE_LABELS[audit.lifecycle]}
          </Badge>
        </ReceiptField>
        <ReceiptField label="Rejection reason">
          {audit.rejectionCode ? GAS_REJECTION_LABELS[audit.rejectionCode] : "None recorded"}
        </ReceiptField>
        <ReceiptField label="UTC recorded">{formatActivityDate(audit.createdAt)}</ReceiptField>
        <ReceiptField label="Source wallet">{formatIdentifier(audit.sourceWallet)}</ReceiptField>
        <ReceiptField label="Target contracts">
          {audit.targetContractIds === null ? (
            <span className="text-muted-foreground">Unavailable</span>
          ) : audit.targetContractIds.length > 0 ? (
            <ul className="grid gap-2">
              {audit.targetContractIds.map((contractId) => (
                <li key={contractId} className="font-mono text-xs break-all">
                  {contractId}
                </li>
              ))}
            </ul>
          ) : (
            "None recorded"
          )}
        </ReceiptField>
        <ReceiptField label="Inner maximum fee">
          {formatGasActivityFee(audit.innerMaxFeeStroops)}
        </ReceiptField>
        <ReceiptField label="Recorded reservation">
          {formatGasActivityFee(audit.reservedStroops)}
          <span className="mt-1 block text-xs text-muted-foreground">
            Historical approved exposure for this request; it is not a currently outstanding
            balance.
          </span>
        </ReceiptField>
        <ReceiptField label="Audit actual charged fee">
          {formatGasActivityFee(audit.actualFeeStroops)}
        </ReceiptField>
        <ReceiptField label="Audit reservation expiry">
          {formatActivityDate(audit.expiresAt)}
        </ReceiptField>
      </dl>
    </section>
  );
}

function executionStatusDescription(status: GasExecutionStatus): string {
  switch (status) {
    case "claimed":
    case "submission_unknown":
    case "submitted":
      return "This state is not confirmation. The execution remains unresolved until a trusted terminal result is recorded.";
    case "succeeded":
      return "This is the only execution status treated as success. The explorer link remains a lookup, not proof by itself.";
    case "failed":
      return "The execution reached a terminal failure state; it is not a successful receipt.";
    case "cancelled":
      return "The execution was cancelled; it is not a successful receipt.";
  }
}

export function GasReceiptDetailBody({
  audit,
  detail,
  isConnected,
}: {
  audit: GasLogSnapshot | null;
  detail: GasExecutionDetailSnapshot | null | undefined;
  isConnected: boolean;
}) {
  const actualFee = detail?.actualFeeStroops ?? audit?.actualFeeStroops ?? null;

  return (
    <div className="grid gap-6">
      {!isConnected ? (
        <Alert>
          <WifiOffIcon />
          <AlertTitle>Connection unavailable</AlertTitle>
          <AlertDescription>
            The displayed receipt detail may be stale while disconnected. Reconnect before
            interpreting a running or uncertain execution.
          </AlertDescription>
        </Alert>
      ) : null}

      <AuditReceiptSection audit={audit} />

      <section className="grid gap-3" aria-labelledby="gas-execution-status-title">
        <div>
          <h3 id="gas-execution-status-title" className="text-base font-semibold">
            Durable execution detail
          </h3>
          <p className="text-sm text-muted-foreground">
            This projection can remain after the retained audit record is removed.
          </p>
        </div>

        {detail === undefined ? (
          <div className="grid gap-3" aria-busy="true" aria-label="Loading execution detail">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : detail === null ? (
          <Alert>
            <InfoIcon />
            <AlertTitle>Execution detail not found</AlertTitle>
            <AlertDescription>
              No durable execution projection is available for this request. Rejected audit
              decisions may not have an execution record.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <Alert>
              {detail.status === "succeeded" ? <CheckCircle2Icon /> : <InfoIcon />}
              <AlertTitle>{GAS_EXECUTION_STATUS_LABELS[detail.status]}</AlertTitle>
              <AlertDescription>{executionStatusDescription(detail.status)}</AlertDescription>
            </Alert>
            <dl className="grid gap-3">
              <ReceiptField label="Request ID">{formatIdentifier(detail.requestId)}</ReceiptField>
              <ReceiptField label="Durable execution status">
                <Badge variant={executionStatusVariants[detail.status]}>
                  {GAS_EXECUTION_STATUS_LABELS[detail.status]}
                </Badge>
              </ReceiptField>
              <ReceiptField label="Inner transaction hash">
                <HashReference hash={detail.transactionHash} kind="inner" />
              </ReceiptField>
              <ReceiptField label="Outer FeeBump hash">
                <HashReference hash={detail.outerTransactionHash} kind="outer" />
              </ReceiptField>
              <ReceiptField label="Approved hold">
                {formatGasActivityFee(detail.reservedStroops)}
                <span className="mt-1 block text-xs text-muted-foreground">
                  Recorded approved exposure for this execution, not a live balance.
                </span>
              </ReceiptField>
              <ReceiptField label="Actual charged fee">
                {formatGasActivityFee(actualFee)}
              </ReceiptField>
              <ReceiptField label="Execution reservation expiry">
                {formatGasActivityTimestamp(detail.expiresAt)}
              </ReceiptField>
              <ReceiptField label="Reconciliation">
                {detail.reconciliationRequired
                  ? "Required — outcome remains unresolved"
                  : "Not required"}
              </ReceiptField>
            </dl>
          </>
        )}
      </section>
    </div>
  );
}

function LiveReceiptDetail({
  projectId,
  requestId,
  audit,
  isConnected,
}: {
  projectId: Id<"projects">;
  requestId: string;
  audit: GasLogSnapshot | null;
  isConnected: boolean;
}) {
  const detail = useQuery(api.gas.queries.getExecutionDetail, {
    projectId,
    requestId,
  });

  return <GasReceiptDetailBody audit={audit} detail={detail} isConnected={isConnected} />;
}

export function GasActivityView({
  logs,
  paginationStatus,
  onLoadMore,
  connectionState = DEFAULT_CONNECTION_STATE,
  readState = "ready",
  onRetry,
  renderExecutionDetail,
}: GasActivityViewProps) {
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const selectedTriggerRef = useRef<HTMLButtonElement | null>(null);
  const selectedAudit = selectedRequestId
    ? (logs.find((log) => log.requestId === selectedRequestId) ?? null)
    : null;
  const isConnected = connectionState.isWebSocketConnected;

  function handleSelectRequest(requestId: string, trigger: HTMLButtonElement) {
    selectedTriggerRef.current = trigger;
    setSelectedRequestId(requestId);
  }

  function handleSheetOpenChange(open: boolean) {
    if (!open) setSelectedRequestId(null);
  }

  function handleSheetCloseAutoFocus(event: Event) {
    event.preventDefault();
    selectedTriggerRef.current?.focus();
  }

  if (readState === "error") {
    return <GasActivityErrorState onRetry={onRetry} />;
  }

  return (
    <Sheet open={selectedRequestId !== null} onOpenChange={handleSheetOpenChange}>
      <section className="grid min-w-0 gap-4" aria-labelledby="gas-activity-title">
        <Card>
          <CardHeader>
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
              <div className="grid min-w-0 gap-1">
                <CardTitle id="gas-activity-title">Gas activity</CardTitle>
                <CardDescription>
                  Retained audit records for sponsorship requests. This is not a complete accounting
                  ledger.
                </CardDescription>
              </div>
              <Badge variant={isConnected ? "info" : "warning"}>
                {activityStatusLabel(paginationStatus, isConnected)}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Records are retained for 30 days. Fees remain exact seven-decimal XLM values; an
              unavailable fee is unknown, not zero.
            </p>
          </CardHeader>
          <CardContent className="grid min-w-0 gap-0 p-0">
            {!isConnected ? (
              <Alert className="m-4">
                <WifiOffIcon />
                <AlertTitle>Potentially stale activity</AlertTitle>
                <AlertDescription>
                  The displayed retained records may be stale while disconnected. Reconnecting will
                  refresh the current pagination snapshot.
                </AlertDescription>
              </Alert>
            ) : null}

            {paginationStatus === "LoadingFirstPage" ? (
              <ActivitySkeleton />
            ) : logs.length === 0 ? (
              <div className="grid min-h-48 place-items-center gap-2 p-8 text-center">
                <InfoIcon className="size-6 text-muted-foreground" aria-hidden="true" />
                <p className="font-medium">No retained Gas activity</p>
                <p className="max-w-xl text-sm text-muted-foreground">
                  No audit records are available in the current 30-day retention window.
                </p>
              </div>
            ) : (
              <ActivityTable
                logs={logs}
                selectedRequestId={selectedRequestId}
                onSelect={handleSelectRequest}
              />
            )}

            {logs.length > 0 ? (
              <ActivityPagination status={paginationStatus} onLoadMore={onLoadMore} />
            ) : null}
          </CardContent>
        </Card>

        {selectedRequestId ? (
          <SheetContent
            className="w-full overflow-y-auto sm:max-w-xl"
            onCloseAutoFocus={handleSheetCloseAutoFocus}
          >
            <SheetHeader>
              <SheetTitle>Gas receipt detail</SheetTitle>
              <SheetDescription className="break-all">
                Selected request: {selectedRequestId}
              </SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
              <ReceiptDetailErrorBoundary key={selectedRequestId}>
                {renderExecutionDetail(selectedRequestId, selectedAudit)}
              </ReceiptDetailErrorBoundary>
            </div>
          </SheetContent>
        ) : null}
      </section>
    </Sheet>
  );
}

function GasActivityContent({ projectId }: GasActivityProps) {
  const connectionState = useConvexConnectionState();
  const activityPage = usePaginatedQuery(
    api.gas.queries.listLogsPage,
    { projectId },
    { initialNumItems: ACTIVITY_PAGE_SIZE },
  );

  function handleLoadMore() {
    activityPage.loadMore(ACTIVITY_PAGE_SIZE);
  }

  function renderLiveExecutionDetail(requestId: string, audit: GasLogSnapshot | null) {
    return (
      <LiveReceiptDetail
        projectId={projectId}
        requestId={requestId}
        audit={audit}
        isConnected={connectionState.isWebSocketConnected}
      />
    );
  }

  return (
    <GasActivityView
      logs={activityPage.results}
      paginationStatus={activityPage.status}
      onLoadMore={handleLoadMore}
      connectionState={{ isWebSocketConnected: connectionState.isWebSocketConnected }}
      renderExecutionDetail={renderLiveExecutionDetail}
    />
  );
}

export function GasActivity({ projectId }: GasActivityProps) {
  const [retryKey, setRetryKey] = useState(0);

  return (
    <ActivityErrorBoundary
      key={`${projectId}:${retryKey}`}
      onRetry={() => setRetryKey((current) => current + 1)}
    >
      <GasActivityContent projectId={projectId} />
    </ActivityErrorBoundary>
  );
}
