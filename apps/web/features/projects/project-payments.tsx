"use client";

import { env } from "@/core/config/env";
import { stellarConfig } from "@/core/config/stellar";
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
  DialogTrigger,
} from "@repo/ui/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@repo/ui/components/ui/empty";
import { Input } from "@repo/ui/components/ui/input";
import { Label } from "@repo/ui/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@repo/ui/components/ui/sheet";
import { Skeleton } from "@repo/ui/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/components/ui/table";
import { Textarea } from "@repo/ui/components/ui/textarea";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import {
  AlertCircleIcon,
  ArrowUpRightIcon,
  CheckCircle2Icon,
  Clock3Icon,
  CoinsIcon,
  CreditCardIcon,
  ExternalLinkIcon,
  Loader2Icon,
  PlusIcon,
  SearchIcon,
  WalletIcon,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import type { Doc, Id } from "@repo/backend/convex/_generated/dataModel";

import {
  effectivePaymentStatus,
  formatPaymentAmount,
  paymentLifecycle,
  type PaymentStatus,
  validatePaymentAmount,
} from "./payment-ui";

type ProjectPaymentsProps = {
  projectId: string;
};

const statuses: PaymentStatus[] = [
  "awaiting_route",
  "created",
  "pending",
  "paid",
  "failed",
  "expired",
  "cancelled",
];

const statusLabel: Record<PaymentStatus, string> = {
  awaiting_route: "Routing",
  created: "Created",
  pending: "Pending",
  paid: "Paid",
  failed: "Failed",
  expired: "Expired",
  cancelled: "Cancelled",
};

const statusVariant = {
  awaiting_route: "info",
  created: "gray",
  pending: "warning",
  paid: "success",
  failed: "destructive",
  expired: "gray",
  cancelled: "gray",
} as const;

function formatDate(timestamp?: number) {
  return timestamp ? new Date(timestamp).toLocaleString() : "Not available";
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: typeof CreditCardIcon;
}) {
  return (
    <div className="rounded-lg border bg-card p-5 text-card-foreground">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className="mt-2 truncate text-2xl font-semibold tracking-tight">{value}</p>
        </div>
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Icon className="size-5 text-muted-foreground" />
        </div>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}

function PaymentDetail({
  intent,
  checkoutUrl,
  onOpenChange,
}: {
  intent: Doc<"paymentIntents"> | null;
  checkoutUrl: (intentId: string) => string;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={intent !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {intent ? (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2 pr-8">
                Payment details
                <Badge variant={statusVariant[effectivePaymentStatus(intent)]}>
                  {statusLabel[effectivePaymentStatus(intent)]}
                </Badge>
              </SheetTitle>
              <SheetDescription>
                {formatPaymentAmount(intent.amount, intent.asset)}
              </SheetDescription>
            </SheetHeader>
            <div className="grid gap-6 px-4 pb-6">
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <a href={checkoutUrl(intent._id)} target="_blank" rel="noreferrer">
                    <ExternalLinkIcon />
                    Open checkout
                  </a>
                </Button>
                <CopyButton value={checkoutUrl(intent._id)} label="checkout URL" size="sm" />
                {intent.txHash ? (
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/debug?hash=${intent.txHash}`}>
                      <ArrowUpRightIcon />
                      Debug transaction
                    </Link>
                  </Button>
                ) : null}
              </div>

              <div className="grid gap-3 rounded-lg border p-4 text-sm">
                <DetailRow label="Payment intent" value={intent._id} copy />
                <DetailRow label="Route" value={intent.anchor ?? "inhouse"} />
                <DetailRow label="Payer" value={intent.payerAddress ?? "Not connected yet"} copy />
                <DetailRow
                  label="Receiver"
                  value={intent.receiverAddress ?? "Resolving route"}
                  copy
                />
                {intent.receiverMemo ? (
                  <DetailRow label="Receiver memo" value={intent.receiverMemo} copy />
                ) : null}
                <DetailRow label="Transaction" value={intent.txHash ?? "Not submitted"} copy />
                <DetailRow
                  label="Correlation ID"
                  value={intent.correlationId ?? "Not available"}
                  copy
                />
                <DetailRow label="Created" value={formatDate(intent.createdAt)} />
                <DetailRow label="Expires" value={formatDate(intent.expiresAt)} />
              </div>

              <div>
                <h3 className="text-sm font-semibold">Payment lifecycle</h3>
                <ol className="mt-3 grid gap-0">
                  {paymentLifecycle(intent).map((stage, index, stages) => (
                    <li key={stage.key} className="grid grid-cols-[1.25rem_1fr] gap-3">
                      <div className="flex flex-col items-center">
                        <span className="mt-1 size-2.5 rounded-full bg-primary" />
                        {index < stages.length - 1 ? (
                          <span className="min-h-8 w-px flex-1 bg-border" />
                        ) : null}
                      </div>
                      <div className="pb-4">
                        <p className="text-sm font-medium">{stage.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(stage.timestamp)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function DetailRow({
  label,
  value,
  copy = false,
}: {
  label: string;
  value: string;
  copy?: boolean;
}) {
  return (
    <div className="grid gap-1">
      <span className="text-xs font-medium text-muted-foreground uppercase">{label}</span>
      <div className="flex min-w-0 items-start gap-1">
        <span className="min-w-0 flex-1 font-mono text-xs break-all">{value}</span>
        {copy && !value.startsWith("Not ") && value !== "Resolving route" ? (
          <CopyButton value={value} label={label.toLowerCase()} />
        ) : null}
      </div>
    </div>
  );
}

export function ProjectPayments({ projectId }: ProjectPaymentsProps) {
  const wallet = useWallet();
  const typedProjectId = projectId as Id<"projects">;
  const project = useQuery(
    api.projects.query.getById,
    wallet.address ? { id: typedProjectId } : "skip",
  );
  const stats = useQuery(
    api.payment_intents.queries.getProjectStats,
    wallet.address && project ? { projectId: typedProjectId } : "skip",
  );
  const [statusFilter, setStatusFilter] = useState<"all" | PaymentStatus>("all");
  const [search, setSearch] = useState("");
  const searchTerm = search.trim();
  const paymentPage = usePaginatedQuery(
    api.payment_intents.queries.listOwnerPage,
    wallet.address && project
      ? {
          projectId: typedProjectId,
          ...(statusFilter === "all" ? {} : { status: statusFilter }),
        }
      : "skip",
    { initialNumItems: 20 },
  );
  const searchResult = useQuery(
    api.payment_intents.queries.findOwnerIntent,
    wallet.address && project && searchTerm
      ? { projectId: typedProjectId, term: searchTerm }
      : "skip",
  );

  const [selectedIntent, setSelectedIntent] = useState<Doc<"paymentIntents"> | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [createdIntentId, setCreatedIntentId] = useState<string | null>(null);
  const createPayment = useMutation(api.payment_intents.mutations.createFromDashboard);

  const checkoutUrl = (intentId: string) =>
    new URL(`/pay/${intentId}`, env.NEXT_PUBLIC_APP_URL).toString();
  const displayedIntents = useMemo(() => {
    if (!searchTerm) return paymentPage.results;
    if (!searchResult) return [];
    const effectiveStatus = effectivePaymentStatus(searchResult);
    return statusFilter === "all" || effectiveStatus === statusFilter ? [searchResult] : [];
  }, [paymentPage.results, searchResult, searchTerm, statusFilter]);

  function resetCreateForm() {
    setAmount("");
    setDescription("");
    setRequestId(crypto.randomUUID());
    setCreateError(null);
    setCreatedIntentId(null);
  }

  function handleCreateOpen(open: boolean) {
    setCreateOpen(open);
    if (open) resetCreateForm();
  }

  async function submitPayment(event: React.FormEvent) {
    event.preventDefault();
    const amountError = validatePaymentAmount(amount);
    if (amountError) {
      setCreateError(amountError);
      return;
    }

    setIsCreating(true);
    setCreateError(null);
    try {
      const result = await createPayment({
        projectId: typedProjectId,
        requestId,
        amount: amount.trim(),
        asset: stellarConfig.checkoutAsset,
        description: description.trim() || undefined,
        anchor: "inhouse",
      });
      setCreatedIntentId(result.intent._id);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Could not create payment.");
    } finally {
      setIsCreating(false);
    }
  }

  if (!wallet.address) {
    return (
      <section className="grid gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">Payments</h1>
        <Alert>
          <WalletIcon />
          <AlertTitle>Connect the owner wallet</AlertTitle>
          <AlertDescription>
            Payment operations are visible only to the authenticated project owner.
          </AlertDescription>
        </Alert>
        <Button className="w-fit" onClick={wallet.connect}>
          <WalletIcon />
          Connect wallet
        </Button>
      </section>
    );
  }

  if (project === undefined) {
    return (
      <section className="grid gap-6">
        <Skeleton className="h-12 w-64" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-36" />
          ))}
        </div>
        <Skeleton className="h-80" />
      </section>
    );
  }

  if (project === null) {
    return (
      <section className="grid gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">Project unavailable</h1>
        <p className="text-sm text-muted-foreground">
          The project does not exist or the connected wallet is not its owner.
        </p>
        <Button asChild className="w-fit">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </section>
    );
  }

  if (!project.isOwner) {
    return (
      <section className="grid gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">Payments</h1>
        <Alert>
          <WalletIcon />
          <AlertTitle>Owner access required</AlertTitle>
          <AlertDescription>
            Payment records and operations are available only to the project owner.
          </AlertDescription>
        </Alert>
        <Button asChild className="w-fit">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </section>
    );
  }

  if (stats === undefined) {
    return (
      <section className="grid gap-6">
        <Skeleton className="h-12 w-64" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-36" />
          ))}
        </div>
        <Skeleton className="h-80" />
      </section>
    );
  }

  const paidVolume =
    stats?.volumes.length === 0
      ? "0"
      : (stats?.volumes
          .map(({ asset, volume }) => `${new Intl.NumberFormat().format(volume)} ${asset}`)
          .join(" · ") ?? "0");
  const isSearchLoading = Boolean(searchTerm) && searchResult === undefined;
  const legacyPdaxDefault = project.defaultPaymentAnchor === "pdax";

  return (
    <section className="grid min-w-0 gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">Payments</h1>
            <Badge variant={project.paymentAccessActive ? "success" : "warning"}>
              {project.paymentAccessActive ? "Payments active" : "Payments inactive"}
            </Badge>
          </div>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Create hosted checkout sessions and monitor payment activity for {project.name}.
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={handleCreateOpen}>
          <DialogTrigger asChild>
            <Button disabled={!project.paymentAccessActive || legacyPdaxDefault}>
              <PlusIcon />
              Create payment
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create payment</DialogTitle>
              <DialogDescription>
                Generate a one-time hosted checkout that expires after 30 minutes.
              </DialogDescription>
            </DialogHeader>
            {createdIntentId ? (
              <div className="grid gap-4">
                <Alert>
                  <CheckCircle2Icon />
                  <AlertTitle>Checkout created</AlertTitle>
                  <AlertDescription>
                    Share this URL before the 30-minute payment window expires.
                  </AlertDescription>
                </Alert>
                <div className="flex min-w-0 items-center gap-2 rounded-lg border p-3">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">
                    {checkoutUrl(createdIntentId)}
                  </span>
                  <CopyButton value={checkoutUrl(createdIntentId)} label="checkout URL" size="sm" />
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => resetCreateForm()}>
                    Create another
                  </Button>
                  <Button asChild>
                    <a href={checkoutUrl(createdIntentId)} target="_blank" rel="noreferrer">
                      <ExternalLinkIcon />
                      Open checkout
                    </a>
                  </Button>
                </DialogFooter>
              </div>
            ) : (
              <form className="grid gap-4" onSubmit={(event) => void submitPayment(event)}>
                <div className="grid gap-2">
                  <Label htmlFor="payment-amount">Amount</Label>
                  <div className="flex rounded-md border focus-within:ring-2 focus-within:ring-ring">
                    <Input
                      id="payment-amount"
                      inputMode="decimal"
                      placeholder="25.00"
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                      className="border-0 shadow-none focus-visible:ring-0"
                      autoComplete="off"
                    />
                    <span className="flex items-center border-l px-3 text-sm text-muted-foreground">
                      {stellarConfig.checkoutAsset === "native" ? "XLM" : "USDC"}
                    </span>
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="payment-description">Description (optional)</Label>
                  <Textarea
                    id="payment-description"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    maxLength={500}
                    placeholder="Invoice or order reference"
                  />
                </div>
                {createError ? (
                  <Alert variant="destructive">
                    <AlertCircleIcon />
                    <AlertTitle>Could not create payment</AlertTitle>
                    <AlertDescription>{createError}</AlertDescription>
                  </Alert>
                ) : null}
                <DialogFooter>
                  <Button type="submit" disabled={isCreating}>
                    {isCreating ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
                    {isCreating ? "Creating..." : "Create checkout"}
                  </Button>
                </DialogFooter>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>

      {legacyPdaxDefault ? (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Switch this project to in-house routing</AlertTitle>
          <AlertDescription>
            New payments are disabled while this project uses a legacy PDAX default. Switch the
            project to in-house under Settings before creating a checkout.
          </AlertDescription>
        </Alert>
      ) : null}

      {!project.paymentAccessActive ? (
        <Alert>
          <AlertCircleIcon />
          <AlertTitle>Payment creation is disabled</AlertTitle>
          <AlertDescription>
            Existing activity remains available. Activate Velo Pay from the{" "}
            <Link href="/dashboard" className="font-medium underline underline-offset-2">
              dashboard
            </Link>{" "}
            before creating a checkout.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Total payments"
          value={stats?.counts.total ?? 0}
          detail="All payment intents for this project"
          icon={CreditCardIcon}
        />
        <MetricCard
          label="Paid"
          value={stats?.counts.paid ?? 0}
          detail="Independently verified payments"
          icon={CheckCircle2Icon}
        />
        <MetricCard
          label="Pending"
          value={stats?.counts.pending ?? 0}
          detail="Submitted payments awaiting confirmation"
          icon={Clock3Icon}
        />
        <MetricCard
          label="Paid volume"
          value={paidVolume}
          detail="Confirmed volume grouped by asset"
          icon={CoinsIcon}
        />
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <SearchIcon className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Exact intent ID or transaction hash"
              aria-label="Search payments"
              className="pl-9"
            />
          </div>
          <Select
            value={statusFilter}
            onValueChange={(value) => setStatusFilter(value as "all" | PaymentStatus)}
          >
            <SelectTrigger className="w-full sm:w-48" aria-label="Filter by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {statuses.map((status) => (
                <SelectItem key={status} value={status}>
                  {statusLabel[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {paymentPage.status === "LoadingFirstPage" || isSearchLoading ? (
          <div className="grid gap-3 p-4">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-12" />
            ))}
          </div>
        ) : displayedIntents.length === 0 ? (
          <Empty className="min-h-72">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CreditCardIcon />
              </EmptyMedia>
              <EmptyTitle>{searchTerm ? "No exact payment found" : "No payments yet"}</EmptyTitle>
              <EmptyDescription>
                {searchTerm
                  ? "Check the complete PaymentIntent ID or transaction hash."
                  : "Create a checkout here or send one through the Velo API or SDK."}
              </EmptyDescription>
            </EmptyHeader>
            {!searchTerm && project.paymentAccessActive ? (
              <EmptyContent>
                <Button onClick={() => handleCreateOpen(true)}>
                  <PlusIcon />
                  Create payment
                </Button>
              </EmptyContent>
            ) : null}
          </Empty>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Payment</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Route</TableHead>
                    <TableHead>Payer</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Expires</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayedIntents.map((intent) => {
                    const effectiveStatus = effectivePaymentStatus(intent);
                    return (
                      <TableRow key={intent._id}>
                        <TableCell>
                          <Button
                            variant="link"
                            className="h-auto max-w-40 justify-start px-0 font-mono text-xs"
                            onClick={() => setSelectedIntent(intent)}
                          >
                            <span className="truncate">{intent._id}</span>
                          </Button>
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant[effectiveStatus]}>
                            {statusLabel[effectiveStatus]}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium whitespace-nowrap">
                          {formatPaymentAmount(intent.amount, intent.asset)}
                        </TableCell>
                        <TableCell className="capitalize">{intent.anchor ?? "inhouse"}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {intent.payerAddress ? shortenAddress(intent.payerAddress) : "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {formatDate(intent.createdAt)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {formatDate(intent.expiresAt)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            {!searchTerm && paymentPage.status === "CanLoadMore" ? (
              <div className="flex justify-center border-t p-4">
                <Button variant="outline" onClick={() => paymentPage.loadMore(20)}>
                  Load more
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>

      <PaymentDetail
        intent={selectedIntent}
        checkoutUrl={checkoutUrl}
        onOpenChange={(open) => {
          if (!open) setSelectedIntent(null);
        }}
      />
    </section>
  );
}
