"use client";

import { shortenAddress } from "@/core/wallet/format";
import { useWallet } from "@/core/wallet/wallet-provider";
import { api } from "@repo/backend/convex/_generated/api";
import { Alert, AlertDescription, AlertTitle } from "@repo/ui/components/ui/alert";
import { Button } from "@repo/ui/components/ui/button";
import { Input } from "@repo/ui/components/ui/input";
import { Label } from "@repo/ui/components/ui/label";
import { Textarea } from "@repo/ui/components/ui/textarea";
import { useMutation } from "convex/react";
import { AlertCircleIcon, CheckCircle2Icon, WalletIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";

import {
  buildProjectMetadata,
  sha256Hex,
  slugifyProjectName,
  stableJson,
} from "./project-metadata";

export function CreateProjectForm() {
  const router = useRouter();
  const wallet = useWallet();
  const createDraft = useMutation(api.projects.mutation.createDraft);
  const [name, setName] = useState("DemoPay");
  const [slug, setSlug] = useState("demopay");
  const [description, setDescription] = useState(
    "DemoPay is a sample Stellar app used to verify official Soroban contracts.",
  );
  const [website, setWebsite] = useState("https://example.com");
  const [metadataHash, setMetadataHash] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const metadataJson = useMemo(() => {
    return stableJson(
      buildProjectMetadata({
        name,
        slug,
        description,
        website,
        ownerAddress: wallet.address ?? "",
      }),
    );
  }, [name, slug, description, website, wallet.address]);

  useEffect(() => {
    let ignore = false;

    async function hashMetadata() {
      if (!wallet.address) {
        setMetadataHash(null);
        return;
      }

      const hash = await sha256Hex(metadataJson);
      if (!ignore) {
        setMetadataHash(hash);
      }
    }

    hashMetadata();

    return () => {
      ignore = true;
    };
  }, [metadataJson, wallet.address]);

  function updateName(nextName: string) {
    setName(nextName);
    setSlug(slugifyProjectName(nextName));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (!wallet.address) {
      setFormError("Connect a wallet before creating a draft project.");
      return;
    }

    if (!metadataHash) {
      setFormError("Metadata hash is still being generated.");
      return;
    }

    setIsSaving(true);

    try {
      await createDraft({
        name,
        slug,
        description,
        website: website.trim() || undefined,
        metadataJson,
        metadataHash,
        ownerAddress: wallet.address,
      });
      router.push("/dashboard");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Unable to create draft project");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-normal">Create project</h1>
        <p className="max-w-2xl text-sm text-zinc-600">
          Draft metadata is stored off-chain in Convex. The metadata hash is ready for the Sprint 3
          registry transaction.
        </p>

        {!wallet.address ? (
          <Alert>
            <WalletIcon />
            <AlertTitle>Wallet required</AlertTitle>
            <AlertDescription>
              Connect a Stellar Testnet wallet before saving a project owner scope.
            </AlertDescription>
          </Alert>
        ) : (
          <Alert>
            <CheckCircle2Icon />
            <AlertTitle>Owner wallet selected</AlertTitle>
            <AlertDescription>
              {shortenAddress(wallet.address)} will own this draft.
            </AlertDescription>
          </Alert>
        )}

        {formError ? (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertTitle>Project was not saved</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <form onSubmit={handleSubmit} className="rounded-lg border border-zinc-200 bg-white p-5">
          <div className="grid gap-5">
            <div className="grid gap-2">
              <Label htmlFor="project-name">Project name</Label>
              <Input
                id="project-name"
                value={name}
                onChange={(event) => updateName(event.target.value)}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="project-slug">Slug</Label>
              <Input
                id="project-slug"
                value={slug}
                onChange={(event) => setSlug(slugifyProjectName(event.target.value))}
                pattern="[a-z0-9-]+"
                required
              />
              <p className="text-xs text-zinc-500">
                This slug is the preferred URL. If it is already in use, Velo will add a short
                suffix.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="project-description">Description</Label>
              <Textarea
                id="project-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="project-website">Website</Label>
              <Input
                id="project-website"
                type="url"
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={!wallet.address || !metadataHash || isSaving}>
                {isSaving ? "Saving..." : "Create draft"}
              </Button>
              <Button type="button" variant="outline" onClick={() => router.push("/dashboard")}>
                Cancel
              </Button>
            </div>
          </div>
        </form>
      </div>

      <aside className="flex flex-col gap-4 rounded-lg border border-zinc-200 bg-white p-5">
        <div>
          <h2 className="text-base font-semibold tracking-normal">Metadata preview</h2>
          <p className="mt-1 text-sm text-zinc-600">
            The URL may receive a short suffix if this slug is already in use.
          </p>
        </div>
        <div className="rounded-md bg-zinc-950 p-3 text-xs text-zinc-50">
          <pre className="max-h-80 overflow-auto break-words whitespace-pre-wrap">
            {metadataJson}
          </pre>
        </div>
        <div className="grid gap-1">
          <span className="text-sm font-medium">SHA-256 metadata hash</span>
          <code className="rounded-md bg-zinc-100 p-3 text-xs break-all">
            {metadataHash ?? "Connect wallet to generate hash"}
          </code>
        </div>
      </aside>
    </section>
  );
}
