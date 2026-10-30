"use client";

import { useWallet } from "@/core/wallet/wallet-provider";
import { api } from "@repo/backend/convex/_generated/api";
import { filterContractEvents } from "@repo/stellar";
import { CopyButton } from "@repo/ui/components/common/copy-button";
import { Badge } from "@repo/ui/components/ui-customs/badge";
import { Alert, AlertDescription, AlertTitle } from "@repo/ui/components/ui/alert";
import { Button } from "@repo/ui/components/ui/button";
import { Input } from "@repo/ui/components/ui/input";
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
  SheetTrigger,
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
import { useAction, useQuery } from "convex/react";
import {
  ActivityIcon,
  AlertCircleIcon,
  EraserIcon,
  ExternalLinkIcon,
  RefreshCwIcon,
  WalletIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import type { Doc, Id } from "@repo/backend/convex/_generated/dataModel";

const statusLabel = {
  live: "Live",
  polling: "Polling",
  stale: "Stale",
  error: "Error",
  empty: "No events",
} as const;

const statusVariant = {
  live: "success",
  polling: "info",
  stale: "warning",
  error: "destructive",
  empty: "gray",
} as const;

type ProjectEventsProps = {
  projectId: string;
};

function displayTopic(topic: string) {
  try {
    const parsed = JSON.parse(topic);
    return typeof parsed === "string" ? parsed : topic;
  } catch {
    return topic;
  }
}

function shortValue(value: string, leading = 10, trailing = 6) {
  return value.length > leading + trailing + 3
    ? `${value.slice(0, leading)}...${value.slice(-trailing)}`
    : value;
}

function formatTimestamp(value?: number) {
  return value ? new Date(value).toLocaleString() : "Not available";
}

function displayJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function EventDetail({ event }: { event: Doc<"contractEvents"> }) {
  return (
    <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
      <SheetHeader>
        <SheetTitle>{displayTopic(event.topic)}</SheetTitle>
        <SheetDescription>
          Ledger {event.ledger} from {shortValue(event.contractId, 14, 8)}
        </SheetDescription>
      </SheetHeader>
      <div className="grid gap-5 px-4 pb-6">
        <div className="grid gap-2 text-sm">
          <span className="text-xs font-medium text-zinc-500 uppercase">Contract ID</span>
          <div className="flex items-start gap-1">
            <span className="min-w-0 flex-1 font-mono break-all">{event.contractId}</span>
            <CopyButton value={event.contractId} label="contract ID" />
          </div>
          <span className="text-xs font-medium text-zinc-500 uppercase">Transaction hash</span>
          <div className="flex items-start gap-1">
            <span className="min-w-0 flex-1 font-mono break-all">{event.transactionHash}</span>
            <CopyButton value={event.transactionHash} label="transaction hash" />
          </div>
          <Button variant="outline" size="sm" asChild className="w-fit">
            <Link href={`/debug?hash=${event.transactionHash}`}>
              <ExternalLinkIcon />
              Inspect transaction
            </Link>
          </Button>
        </div>
        <div className="grid gap-2">
          <h3 className="text-sm font-semibold">Topics</h3>
          <pre className="max-h-64 overflow-auto bg-zinc-950 p-3 text-xs text-zinc-100">
            {displayJson(event.topics)}
          </pre>
        </div>
        <div className="grid gap-2">
          <h3 className="text-sm font-semibold">Decoded payload</h3>
          <pre className="max-h-64 overflow-auto bg-zinc-950 p-3 text-xs text-zinc-100">
            {displayJson(event.decoded ?? null)}
          </pre>
        </div>
        <div className="grid gap-2">
          <h3 className="text-sm font-semibold">Raw payload</h3>
          <pre className="max-h-80 overflow-auto bg-zinc-950 p-3 text-xs text-zinc-100">
            {displayJson(event.raw)}
          </pre>
        </div>
      </div>
    </SheetContent>
  );
}

export function ProjectEvents({ projectId }: ProjectEventsProps) {
  const wallet = useWallet();
  const typedProjectId = projectId as Id<"projects">;
  const project = useQuery(
    api.projects.query.getById,
    wallet.address ? { id: typedProjectId } : "skip",
  );
  const contracts = useQuery(
    api.project_contracts.query.listByProject,
    wallet.address ? { projectId: typedProjectId } : "skip",
  );
  const activity = useQuery(
    api.contract_events.query.listByProject,
    wallet.address ? { projectId: typedProjectId, limit: 100 } : "skip",
  );
  const pollProject = useAction(api.contractEventPolling.pollProject);
  const [contractFilter, setContractFilter] = useState("all");
  const [eventType, setEventType] = useState("");
  const [transactionHash, setTransactionHash] = useState("");
  const [ledger, setLedger] = useState("");
  const [isPolling, setIsPolling] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  if (!wallet.address) {
    return (
      <section className="grid gap-4">
        <h1 className="text-3xl font-semibold">Events</h1>
        <Alert>
          <WalletIcon />
          <AlertTitle>Connect the owner wallet</AlertTitle>
          <AlertDescription>
            Private event details load after your wallet membership is verified.
          </AlertDescription>
        </Alert>
        <Button onClick={wallet.connect} className="w-fit">
          <WalletIcon />
          Connect wallet
        </Button>
      </section>
    );
  }

  if (project === undefined || contracts === undefined || activity === undefined) {
    return (
      <section className="grid gap-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </section>
    );
  }

  if (project === null) {
    return (
      <section className="grid gap-4">
        <h1 className="text-3xl font-semibold">Project unavailable</h1>
        <p className="text-sm text-zinc-600">
          The project does not exist or the connected wallet does not have access.
        </p>
        <Button asChild className="w-fit">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </section>
    );
  }

  if (contracts === null || activity === null) {
    return (
      <section className="grid gap-4">
        <h1 className="text-3xl font-semibold">Project unavailable</h1>
        <p className="text-sm text-zinc-600">Your project access changed.</p>
        <Button asChild className="w-fit">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </section>
    );
  }

  const activeContracts = contracts.filter((contract) => contract.status === "active");
  const ownerMatches = project.isOwner;
  const numericLedger = ledger.trim() === "" ? undefined : Number(ledger);
  const filteredEvents = filterContractEvents(activity?.events ?? [], {
    contractId: contractFilter === "all" ? undefined : contractFilter,
    eventType,
    transactionHash,
    ledger: Number.isFinite(numericLedger) ? numericLedger : undefined,
  });
  const pollStatus = activity?.poller.status ?? "stale";

  async function refreshEvents() {
    if (!wallet.address || !ownerMatches) {
      return;
    }

    setIsPolling(true);
    setLocalError(null);

    try {
      await pollProject({ projectId: typedProjectId });
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Event polling failed");
    } finally {
      setIsPolling(false);
    }
  }

  function clearFilters() {
    setContractFilter("all");
    setEventType("");
    setTransactionHash("");
    setLedger("");
  }

  return (
    <section className="grid min-w-0 gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-semibold">Events</h1>
            <Badge variant={statusVariant[pollStatus]}>{statusLabel[pollStatus]}</Badge>
          </div>
          <p className="mt-2 max-w-2xl text-sm text-zinc-600">
            Recent bounded Testnet activity for {project.name}&apos;s official contracts.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link href="/dashboard">Dashboard</Link>
          </Button>
          <Button
            onClick={() => void refreshEvents()}
            disabled={
              !ownerMatches ||
              project.status !== "registered" ||
              activeContracts.length === 0 ||
              isPolling
            }
          >
            <RefreshCwIcon className={isPolling ? "animate-spin" : undefined} />
            {isPolling ? "Polling..." : "Poll now"}
          </Button>
        </div>
      </div>

      {!ownerMatches && project.status === "registered" && activeContracts.length > 0 ? (
        <Alert>
          <ActivityIcon />
          <AlertTitle>Owner access is required to poll</AlertTitle>
          <AlertDescription>
            You can inspect cached activity. Ask the project owner to refresh events.
          </AlertDescription>
        </Alert>
      ) : project.status !== "registered" ? (
        <Alert>
          <AlertCircleIcon />
          <AlertTitle>Registration required</AlertTitle>
          <AlertDescription>
            Register and sync this project before monitoring events.
          </AlertDescription>
        </Alert>
      ) : activeContracts.length === 0 ? (
        <Alert>
          <ActivityIcon />
          <AlertTitle>No active official contracts</AlertTitle>
          <AlertDescription>
            Add and confirm a contract before polling recent activity.
          </AlertDescription>
        </Alert>
      ) : null}

      {localError || activity?.poller.errorMessage ? (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Event polling failed</AlertTitle>
          <AlertDescription>
            {localError ?? activity?.poller.errorMessage ?? "Stellar RPC polling failed."}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3 border border-zinc-200 bg-white p-4 lg:grid-cols-5">
        <Select value={contractFilter} onValueChange={setContractFilter}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="All contracts" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All contracts</SelectItem>
            {activeContracts.map((contract) => (
              <SelectItem key={contract._id} value={contract.contractId}>
                {shortValue(contract.contractId)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={eventType}
          onChange={(event) => setEventType(event.target.value)}
          placeholder="Event type or topic"
        />
        <Input
          value={transactionHash}
          onChange={(event) => setTransactionHash(event.target.value)}
          placeholder="Transaction hash"
          className="font-mono"
        />
        <Input
          value={ledger}
          onChange={(event) => setLedger(event.target.value)}
          placeholder="Ledger"
          inputMode="numeric"
        />
        <Button variant="outline" onClick={clearFilters}>
          <EraserIcon />
          Clear filters
        </Button>
      </div>

      <div className="border border-zinc-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3">
          <div>
            <h2 className="font-semibold">Recent activity</h2>
            <p className="text-xs text-zinc-500">
              Showing {filteredEvents.length} of {activity?.events.length ?? 0} cached events.
            </p>
          </div>
          <span className="text-xs text-zinc-500">
            Last poll: {formatTimestamp(activity?.poller.lastRunAt)}
          </span>
        </div>
        <div className="w-full overflow-x-auto">
          <Table className="table-fixed sm:table-auto">
            <TableHeader>
              <TableRow>
                <TableHead>Event/topic</TableHead>
                <TableHead className="hidden sm:table-cell">Contract</TableHead>
                <TableHead className="hidden lg:table-cell">Transaction</TableHead>
                <TableHead className="hidden md:table-cell">Ledger</TableHead>
                <TableHead className="hidden md:table-cell">Observed</TableHead>
                <TableHead className="text-right">Data</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredEvents.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-sm text-zinc-600">
                    {activity?.events.length
                      ? "No events match the current filters."
                      : "No events found in the recent ledger window."}
                  </TableCell>
                </TableRow>
              ) : (
                filteredEvents.map((event) => (
                  <TableRow key={event._id}>
                    <TableCell className="max-w-44 break-words whitespace-normal">
                      <div className="grid gap-1">
                        <span className="font-medium">{displayTopic(event.topic)}</span>
                        <Badge variant="gray" className="w-fit">
                          {event.type}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs sm:table-cell">
                      <div className="flex items-center gap-1">
                        <span title={event.contractId}>{shortValue(event.contractId)}</span>
                        <CopyButton value={event.contractId} label="contract ID" />
                      </div>
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs lg:table-cell">
                      <div className="flex items-center gap-1">
                        <span title={event.transactionHash}>
                          {shortValue(event.transactionHash)}
                        </span>
                        <CopyButton value={event.transactionHash} label="transaction hash" />
                      </div>
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs md:table-cell">
                      {event.ledger}
                    </TableCell>
                    <TableCell className="hidden text-sm text-zinc-600 md:table-cell">
                      {formatTimestamp(event.timestamp ?? event.observedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Sheet>
                        <SheetTrigger asChild>
                          <Button variant="outline" size="sm">
                            View
                          </Button>
                        </SheetTrigger>
                        <EventDetail event={event} />
                      </Sheet>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </section>
  );
}
