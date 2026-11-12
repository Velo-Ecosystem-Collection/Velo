"use client";

import { stellarConfig } from "@/core/config/stellar";
import { contractLinkArgs, submitSmartAccountCall } from "@/core/stellar/smart-account-operations";
import { shortenAddress } from "@/core/wallet/format";
import { useWallet } from "@/core/wallet/wallet-provider";
import { api } from "@repo/backend/convex/_generated/api";
import {
  buildAddOfficialContractTransaction,
  buildRemoveOfficialContractTransaction,
  confirmContractTransaction,
  submitSignedTransaction,
} from "@repo/stellar";
import { CopyButton } from "@repo/ui/components/common/copy-button";
import { Badge } from "@repo/ui/components/ui-customs/badge";
import { Alert, AlertDescription, AlertTitle } from "@repo/ui/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@repo/ui/components/ui/alert-dialog";
import { Button } from "@repo/ui/components/ui/button";
import { Input } from "@repo/ui/components/ui/input";
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
import { AlertCircleIcon, CheckCircle2Icon, LinkIcon, Trash2Icon, WalletIcon } from "lucide-react";
import Link from "next/link";
import { FormEvent, useState } from "react";

import type { Doc, Id } from "@repo/backend/convex/_generated/dataModel";

const statusLabel = {
  pending_add: "Pending add",
  active: "Active",
  pending_remove: "Pending remove",
  contract_error: "Error",
  stale: "Stale",
} as const;

const statusVariant = {
  pending_add: "warning",
  active: "success",
  pending_remove: "warning",
  contract_error: "destructive",
  stale: "warning",
} as const;

type ProjectContractsProps = {
  projectId: string;
};

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Contract request failed";
}

function isRejectedSignature(error: unknown) {
  return /reject|denied|cancel/i.test(errorMessage(error));
}

function formatTimestamp(value?: number) {
  return value ? new Date(value).toLocaleString() : "Not synced";
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export function ProjectContracts({ projectId }: ProjectContractsProps) {
  const wallet = useWallet();
  const project = useQuery(
    api.projects.query.getById,
    wallet.address ? { id: projectId as Id<"projects"> } : "skip",
  );
  const contracts = useQuery(
    api.project_contracts.query.listByProject,
    wallet.address ? { projectId: projectId as Id<"projects"> } : "skip",
  );
  const markAddPending = useMutation(api.project_contracts.mutation.markAddPending);
  const markAddConfirmed = useMutation(api.project_contracts.mutation.markAddConfirmed);
  const markRemovePending = useMutation(api.project_contracts.mutation.markRemovePending);
  const markRemoved = useMutation(api.project_contracts.mutation.markRemoved);
  const markStale = useMutation(api.project_contracts.mutation.markStale);
  const markError = useMutation(api.project_contracts.mutation.markError);
  const [contractId, setContractId] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  if (!wallet.address) {
    return (
      <section className="grid gap-4">
        <h1 className="text-3xl font-semibold">Official contracts</h1>
        <Alert>
          <WalletIcon />
          <AlertTitle>Connect the owner wallet</AlertTitle>
          <AlertDescription>
            Private contract state loads after your wallet membership is verified.
          </AlertDescription>
        </Alert>
        <Button onClick={wallet.connect} className="w-fit">
          <WalletIcon />
          Connect wallet
        </Button>
      </section>
    );
  }

  if (project === undefined || contracts === undefined) {
    return (
      <section className="grid gap-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </section>
    );
  }

  if (project === null) {
    return (
      <section className="grid gap-4">
        <h1 className="text-3xl font-semibold tracking-normal">Project unavailable</h1>
        <p className="text-sm text-zinc-600">
          The project does not exist or the connected wallet does not have access.
        </p>
        <Button asChild className="w-fit">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </section>
    );
  }

  if (contracts === null) {
    return (
      <section className="grid gap-4">
        <h1 className="text-3xl font-semibold tracking-normal">Project unavailable</h1>
        <p className="text-sm text-zinc-600">Your project access changed.</p>
        <Button asChild className="w-fit">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </section>
    );
  }

  const currentProject = project;
  const currentContracts = contracts;
  const ownerMatches = currentProject.isOwner;
  const canManage =
    ownerMatches &&
    currentProject.status === "registered" &&
    currentProject.registryProjectId !== undefined;

  async function syncContract(
    linkId: Id<"projectContracts">,
    transactionHash: string,
    outcome: "add" | "remove",
    registryProjectId: number,
    contractAddress: string,
  ) {
    if (!wallet.address) {
      return;
    }

    let confirmation = await confirmContractTransaction({
      rpcUrl: stellarConfig.rpcUrl,
      transactionHash,
      networkPassphrase: stellarConfig.networkPassphrase,
      expectedIntent: {
        targetContractId: stellarConfig.registryContractId!,
        functionName: outcome === "add" ? "add_contract" : "remove_contract",
        args: contractLinkArgs(registryProjectId, contractAddress),
        ...(wallet.identityType === "passkey_smart_account"
          ? { smartAccountAddress: wallet.address }
          : {}),
      },
    });

    for (let attempt = 0; confirmation.status === "pending" && attempt < 4; attempt += 1) {
      await wait(1_500);
      confirmation = await confirmContractTransaction({
        rpcUrl: stellarConfig.rpcUrl,
        transactionHash,
        networkPassphrase: stellarConfig.networkPassphrase,
        expectedIntent: {
          targetContractId: stellarConfig.registryContractId!,
          functionName: outcome === "add" ? "add_contract" : "remove_contract",
          args: contractLinkArgs(registryProjectId, contractAddress),
          ...(wallet.identityType === "passkey_smart_account"
            ? { smartAccountAddress: wallet.address }
            : {}),
        },
      });
    }

    if (confirmation.status === "pending") {
      await markStale({ id: linkId });
      return;
    }

    if (confirmation.status === "error") {
      await markError({
        id: linkId,
        error: confirmation.message,
      });
      return;
    }

    if (outcome === "add") {
      await markAddConfirmed({
        id: linkId,
        confirmedLedger: confirmation.ledger ?? undefined,
      });
      return;
    }

    await markRemoved({ id: linkId });
  }

  async function addContract(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (
      !wallet.address ||
      currentProject.registryProjectId === undefined ||
      !stellarConfig.registryContractId
    ) {
      setLocalError("Registered project, owner wallet, and registry contract are required.");
      return;
    }

    setIsAdding(true);
    setLocalError(null);

    try {
      const args = contractLinkArgs(currentProject.registryProjectId, contractId);
      let transactionHash: string;
      if (wallet.identityType === "passkey_smart_account") {
        transactionHash = await submitSmartAccountCall({
          smartAccountAddress: wallet.address,
          targetContractId: stellarConfig.registryContractId,
          functionName: "add_contract",
          args,
        });
      } else {
        const transactionXdr = await buildAddOfficialContractTransaction({
          rpcUrl: stellarConfig.rpcUrl,
          networkPassphrase: stellarConfig.networkPassphrase,
          registryContractId: stellarConfig.registryContractId,
          sourcePublicKey: wallet.address,
          registryProjectId: currentProject.registryProjectId,
          officialContractId: contractId,
        });
        const signedXdr = await wallet.signTransaction(transactionXdr);
        transactionHash = await submitSignedTransaction({
          rpcUrl: stellarConfig.rpcUrl,
          networkPassphrase: stellarConfig.networkPassphrase,
          signedXdr,
        });
      }
      const linkId = await markAddPending({
        projectId: currentProject._id,
        contractId,
        transactionHash,
      });

      setContractId("");
      await syncContract(
        linkId,
        transactionHash,
        "add",
        currentProject.registryProjectId,
        contractId,
      );
    } catch (error) {
      setLocalError(
        isRejectedSignature(error)
          ? `Rejected signature: ${errorMessage(error)}`
          : errorMessage(error),
      );
    } finally {
      setIsAdding(false);
    }
  }

  async function removeContract(link: Doc<"projectContracts">) {
    if (!wallet.address || !stellarConfig.registryContractId) {
      setLocalError("Connected owner wallet and registry contract are required.");
      return;
    }

    setBusyId(link._id);
    setLocalError(null);
    let pendingRecorded = false;

    try {
      const args = contractLinkArgs(link.registryProjectId, link.contractId);
      let transactionHash: string;
      if (wallet.identityType === "passkey_smart_account") {
        transactionHash = await submitSmartAccountCall({
          smartAccountAddress: wallet.address,
          targetContractId: stellarConfig.registryContractId,
          functionName: "remove_contract",
          args,
        });
      } else {
        const transactionXdr = await buildRemoveOfficialContractTransaction({
          rpcUrl: stellarConfig.rpcUrl,
          networkPassphrase: stellarConfig.networkPassphrase,
          registryContractId: stellarConfig.registryContractId,
          sourcePublicKey: wallet.address,
          registryProjectId: link.registryProjectId,
          officialContractId: link.contractId,
        });
        const signedXdr = await wallet.signTransaction(transactionXdr);
        transactionHash = await submitSignedTransaction({
          rpcUrl: stellarConfig.rpcUrl,
          networkPassphrase: stellarConfig.networkPassphrase,
          signedXdr,
        });
      }

      await markRemovePending({
        id: link._id,
        transactionHash,
      });
      pendingRecorded = true;
      await syncContract(
        link._id,
        transactionHash,
        "remove",
        link.registryProjectId,
        link.contractId,
      );
    } catch (error) {
      const message = isRejectedSignature(error)
        ? `Rejected signature: ${errorMessage(error)}`
        : errorMessage(error);
      setLocalError(message);
      if (pendingRecorded) {
        await markError({ id: link._id, error: message });
      }
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="grid min-w-0 gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-normal">Official contracts</h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-600">
            Link Soroban contracts to {currentProject.name} after the registry confirms the project.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/dashboard">Dashboard</Link>
        </Button>
      </div>

      {currentProject.ownerAddress.startsWith("C") ? (
        <Alert>
          <WalletIcon />
          <AlertTitle>Passkey smart-account owner</AlertTitle>
          <AlertDescription>
            Contract links are authorized by the project's smart account. Tools that require a
            classic G address as the transaction source remain unavailable, and connecting a
            separate classic wallet does not change the recorded project owner.
          </AlertDescription>
        </Alert>
      ) : null}

      {!wallet.address ? (
        <Alert>
          <WalletIcon />
          <AlertTitle>Owner wallet required</AlertTitle>
          <AlertDescription>
            Connect {shortenAddress(currentProject.ownerAddress)} to manage contracts.
          </AlertDescription>
        </Alert>
      ) : !ownerMatches ? (
        <Alert>
          <AlertCircleIcon />
          <AlertTitle>Owner access is required to change Registry state</AlertTitle>
          <AlertDescription>
            You can inspect official contract links. Only the project owner can submit Registry
            transactions.
          </AlertDescription>
        </Alert>
      ) : currentProject.status !== "registered" ? (
        <Alert>
          <AlertCircleIcon />
          <AlertTitle>Registration required</AlertTitle>
          <AlertDescription>
            Register and sync this project before linking official contracts.
          </AlertDescription>
        </Alert>
      ) : null}

      {localError ? (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Contract update failed</AlertTitle>
          <AlertDescription>{localError}</AlertDescription>
        </Alert>
      ) : null}

      <form
        className="grid gap-3 rounded-md border border-zinc-200 bg-white p-4"
        onSubmit={addContract}
      >
        <label className="text-sm font-medium text-zinc-900" htmlFor="contract-id">
          Contract ID
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="contract-id"
            value={contractId}
            onChange={(event) => setContractId(event.target.value)}
            placeholder="C..."
            className="font-mono"
            disabled={!canManage || isAdding}
          />
          <Button type="submit" disabled={!canManage || isAdding || !contractId.trim()}>
            <LinkIcon />
            {isAdding ? "Adding..." : "Add contract"}
          </Button>
        </div>
      </form>

      <div className="rounded-lg border border-zinc-200 bg-white">
        <div className="w-full overflow-x-auto">
          <Table className="table-fixed sm:table-auto">
            <TableHeader>
              <TableRow>
                <TableHead>Contract ID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Transaction</TableHead>
                <TableHead className="hidden sm:table-cell">Last sync</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {currentContracts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-zinc-600">
                    No official contracts linked.
                  </TableCell>
                </TableRow>
              ) : (
                currentContracts.map((link) => (
                  <TableRow key={link._id}>
                    <TableCell className="max-w-40 font-mono text-xs break-all whitespace-normal sm:max-w-[18rem]">
                      <div className="flex items-start gap-1">
                        <span className="min-w-0 flex-1">{link.contractId}</span>
                        <CopyButton value={link.contractId} label="contract ID" />
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[link.status]}>{statusLabel[link.status]}</Badge>
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs md:table-cell">
                      <div className="flex items-center gap-1">
                        <span>
                          {(link.removeTxHash ?? link.addTxHash)?.slice(0, 16) ?? "Not submitted"}
                          {(link.removeTxHash ?? link.addTxHash) ? "..." : ""}
                        </span>
                        {(link.removeTxHash ?? link.addTxHash) ? (
                          <CopyButton
                            value={(link.removeTxHash ?? link.addTxHash)!}
                            label="transaction hash"
                          />
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-sm text-zinc-600 sm:table-cell">
                      {formatTimestamp(link.lastSyncAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Remove contract ${link.contractId}`}
                            disabled={!canManage || link.status !== "active" || busyId === link._id}
                          >
                            <Trash2Icon />
                            <span className="hidden sm:inline">Remove</span>
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remove official contract?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This submits a Testnet transaction to remove {link.contractId} from
                              the public proof.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => removeContract(link)}>
                              Confirm remove
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="flex items-center gap-2 text-sm text-zinc-600">
        <CheckCircle2Icon className="size-4" />
        Active contracts appear on{" "}
        <Link className="underline" href={`/verify/${currentProject.slug}`}>
          public proof
        </Link>
        .
      </div>
    </section>
  );
}
