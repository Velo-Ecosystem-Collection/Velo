"use client";

import { api } from "@repo/backend/convex/_generated/api";
import { Alert, AlertDescription, AlertTitle } from "@repo/ui/components/ui/alert";
import { Button } from "@repo/ui/components/ui/button";
import { Input } from "@repo/ui/components/ui/input";
import { Label } from "@repo/ui/components/ui/label";
import { useMutation, useQuery } from "convex/react";
import { AlertCircleIcon, Loader2Icon, UserPlusIcon, UserRoundIcon, XIcon } from "lucide-react";
import { useState, type FormEvent } from "react";

import type { Id } from "@repo/backend/convex/_generated/dataModel";

type MemberRole = "editor" | "viewer";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Project member could not be updated";
}

export function ProjectMembers({ projectId }: { projectId: Id<"projects"> }) {
  const members = useQuery(api.playground_projects.queries.listMembers, { projectId });
  const upsertMember = useMutation(api.playground_projects.mutations.upsertMember);
  const removeMember = useMutation(api.playground_projects.mutations.removeMember);
  const [walletAddress, setWalletAddress] = useState("");
  const [role, setRole] = useState<MemberRole>("editor");
  const [busyMember, setBusyMember] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveMember(address: string, nextRole: MemberRole, clearInput = false) {
    setError(null);
    setBusyMember(address);
    try {
      await upsertMember({ projectId, walletAddress: address, role: nextRole });
      if (clearInput) setWalletAddress("");
    } catch (mutationError) {
      setError(errorMessage(mutationError));
    } finally {
      setBusyMember(null);
      if (clearInput) setIsAdding(false);
    }
  }

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!walletAddress.trim() || isAdding) return;
    setIsAdding(true);
    await saveMember(walletAddress, role, true);
  }

  async function changeRole(address: string, nextRole: MemberRole) {
    await saveMember(address, nextRole);
  }

  async function deleteMember(membershipId: Id<"projectMemberships">, address: string) {
    setError(null);
    setBusyMember(address);
    try {
      await removeMember({ projectId, membershipId });
    } catch (mutationError) {
      setError(errorMessage(mutationError));
    } finally {
      setBusyMember(null);
    }
  }

  return (
    <section
      aria-labelledby="project-members-heading"
      className="grid gap-4 rounded-lg border border-zinc-200 bg-white p-5"
    >
      <div>
        <h2 id="project-members-heading" className="text-lg font-semibold tracking-normal">
          Project members
        </h2>
        <p className="mt-1 text-sm text-zinc-600">
          Add a Stellar wallet address for immediate access. Editors can do project work; viewers
          can inspect project information.
        </p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Member update failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <form onSubmit={addMember} className="grid gap-3 rounded-md border border-zinc-200 p-4">
        <div className="grid gap-2">
          <Label htmlFor="project-member-wallet">Stellar wallet address</Label>
          <Input
            id="project-member-wallet"
            value={walletAddress}
            onChange={(event) => setWalletAddress(event.target.value)}
            placeholder="G..."
            autoComplete="off"
            spellCheck={false}
            disabled={isAdding}
            required
          />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-2">
            <Label htmlFor="project-member-role">Role</Label>
            <select
              id="project-member-role"
              value={role}
              onChange={(event) => setRole(event.target.value as MemberRole)}
              disabled={isAdding}
              className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm"
            >
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </select>
          </div>
          <Button type="submit" disabled={isAdding || !walletAddress.trim()}>
            {isAdding ? <Loader2Icon className="animate-spin" /> : <UserPlusIcon />}
            Add or update member
          </Button>
        </div>
        <p className="text-xs text-zinc-500">
          Entering an existing member address updates its role. The wallet owner cannot be changed
          here.
        </p>
      </form>

      {members === undefined ? (
        <div className="grid gap-3" aria-label="Loading project members" aria-busy="true">
          <div className="h-14 animate-pulse rounded-md bg-zinc-100" />
          <div className="h-14 animate-pulse rounded-md bg-zinc-100" />
        </div>
      ) : (
        <ul className="grid gap-2">
          {members.map((member) => {
            const isOwner = member.role === "owner" || member._id === null;
            const isBusy = busyMember === member.walletAddress;
            return (
              <li
                key={member._id ?? `owner:${member.walletAddress}`}
                className="flex flex-col gap-3 rounded-md border border-zinc-200 p-3 sm:flex-row sm:items-center"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <UserRoundIcon className="size-4 shrink-0 text-zinc-500" />
                  <code className="min-w-0 text-xs break-all">{member.walletAddress}</code>
                  {isOwner ? (
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs capitalize">
                      Owner
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  {isOwner ? (
                    <span className="min-w-24 text-sm text-zinc-600 capitalize">Owner</span>
                  ) : (
                    <select
                      aria-label={`Role for ${member.walletAddress}`}
                      value={member.role}
                      onChange={(event) =>
                        void changeRole(member.walletAddress, event.target.value as MemberRole)
                      }
                      disabled={isBusy}
                      className="h-9 min-w-24 rounded-md border border-zinc-200 bg-white px-2 text-sm capitalize"
                    >
                      <option value="editor">Editor</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  )}
                  {!isOwner && member._id ? (
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      aria-label={`Remove ${member.walletAddress}`}
                      title="Remove member"
                      disabled={isBusy}
                      onClick={() => void deleteMember(member._id, member.walletAddress)}
                    >
                      {isBusy ? <Loader2Icon className="animate-spin" /> : <XIcon />}
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
