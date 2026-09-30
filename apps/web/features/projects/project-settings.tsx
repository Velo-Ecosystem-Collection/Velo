"use client";

import { useSelectedProject } from "@/core/app-shell";
import { useWallet } from "@/core/wallet/wallet-provider";
import { api } from "@repo/backend/convex/_generated/api";
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
import { Input } from "@repo/ui/components/ui/input";
import { Label } from "@repo/ui/components/ui/label";
import { Skeleton } from "@repo/ui/components/ui/skeleton";
import { Textarea } from "@repo/ui/components/ui/textarea";
import { useMutation, useQuery } from "convex/react";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  ImageIcon,
  Loader2Icon,
  Trash2Icon,
  WalletIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import type { Id } from "@repo/backend/convex/_generated/dataModel";

const maxLogoSizeBytes = 2 * 1024 * 1024;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Project settings could not be saved";
}

export function ProjectSettings({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const wallet = useWallet();
  const { clearSelectedProject } = useSelectedProject();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typedProjectId = projectId as Id<"projects">;
  const project = useQuery(
    api.projects.query.getById,
    wallet.address ? { id: typedProjectId } : "skip",
  );
  const updateSettings = useMutation(api.projects.mutation.updateSettings);
  const retireProject = useMutation(api.projects.mutation.retire);
  const generateLogoUploadUrl = useMutation(api.projects.mutation.generateLogoUploadUrl);
  const setLogo = useMutation(api.projects.mutation.setLogo);
  const removeLogo = useMutation(api.projects.mutation.removeLogo);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedLogo, setSelectedLogo] = useState<File | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isRemovingLogo, setIsRemovingLogo] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [retireDialogOpen, setRetireDialogOpen] = useState(false);
  const [confirmationName, setConfirmationName] = useState("");
  const [retireError, setRetireError] = useState<string | null>(null);
  const [isRetiring, setIsRetiring] = useState(false);

  useEffect(() => {
    if (!project) return;
    setName(project.name);
    setDescription(project.description);
  }, [project]);

  const selectedLogoUrl = useMemo(() => {
    return selectedLogo ? URL.createObjectURL(selectedLogo) : null;
  }, [selectedLogo]);

  useEffect(() => {
    return () => {
      if (selectedLogoUrl) {
        URL.revokeObjectURL(selectedLogoUrl);
      }
    };
  }, [selectedLogoUrl]);

  function selectLogo(file: File | null) {
    setFormError(null);
    setSaved(false);

    if (!file) {
      setSelectedLogo(null);
      return;
    }

    if (!file.type.startsWith("image/")) {
      setFormError("Project logo must be an image file.");
      setSelectedLogo(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    if (file.size > maxLogoSizeBytes) {
      setFormError("Project logo must be 2 MB or smaller.");
      setSelectedLogo(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setSelectedLogo(file);
  }

  async function uploadLogo(file: File) {
    const uploadUrl = await generateLogoUploadUrl({ id: typedProjectId });
    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    });

    if (!response.ok) {
      throw new Error("Logo upload failed");
    }

    const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };
    await setLogo({ id: typedProjectId, logoStorageId: storageId });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSaved(false);

    if (!name.trim()) {
      setFormError("Project name is required.");
      return;
    }

    if (!description.trim()) {
      setFormError("Project description is required.");
      return;
    }

    setIsSaving(true);

    try {
      await updateSettings({ id: typedProjectId, name, description });

      if (selectedLogo) {
        await uploadLogo(selectedLogo);
        setSelectedLogo(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }

      setSaved(true);
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRemoveLogo() {
    setFormError(null);
    setSaved(false);
    setIsRemovingLogo(true);

    try {
      await removeLogo({ id: typedProjectId });
      setSelectedLogo(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setSaved(true);
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setIsRemovingLogo(false);
    }
  }

  async function handleRetireProject() {
    if (!project || confirmationName !== project.name || isRetiring) return;
    setRetireError(null);
    setIsRetiring(true);

    try {
      await retireProject({ id: typedProjectId, confirmationName });
      clearSelectedProject(project._id);
      router.replace("/dashboard");
    } catch (error) {
      setRetireError(
        error instanceof Error ? error.message : "Project could not be deleted. Try again.",
      );
      setIsRetiring(false);
    }
  }

  if (!wallet.address) {
    return (
      <section className="grid gap-4">
        <h1 className="text-3xl font-semibold tracking-normal">Project settings</h1>
        <Alert>
          <WalletIcon />
          <AlertTitle>Connect the owner wallet</AlertTitle>
          <AlertDescription>
            Project settings load only after wallet ownership is verified.
          </AlertDescription>
        </Alert>
        <Button onClick={wallet.connect} className="w-fit">
          <WalletIcon />
          Connect wallet
        </Button>
      </section>
    );
  }

  if (project === undefined) {
    return (
      <section className="grid gap-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-72 w-full" />
      </section>
    );
  }

  if (project === null) {
    return (
      <section className="grid gap-4">
        <h1 className="text-3xl font-semibold tracking-normal">Project settings</h1>
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Project unavailable</AlertTitle>
          <AlertDescription>
            The project does not exist or the connected wallet is not its owner.
          </AlertDescription>
        </Alert>
        <Button asChild variant="outline" className="w-fit">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </section>
    );
  }

  return (
    <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="grid gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-normal">Project settings</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-600">
            Update owner-facing project configuration. Registry metadata hash stays unchanged.
          </p>
        </div>

        {formError ? (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertTitle>Settings were not saved</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        {saved ? (
          <Alert>
            <CheckCircle2Icon />
            <AlertTitle>Settings saved</AlertTitle>
            <AlertDescription>Project configuration has been updated.</AlertDescription>
          </Alert>
        ) : null}

        <form onSubmit={handleSubmit} className="rounded-lg border border-zinc-200 bg-white p-5">
          <div className="grid gap-5">
            <div className="grid gap-2">
              <Label htmlFor="settings-project-name">Project name</Label>
              <Input
                id="settings-project-name"
                value={name}
                disabled={isRetiring}
                onChange={(event) => {
                  setName(event.target.value);
                  setSaved(false);
                }}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="settings-project-description">Description</Label>
              <Textarea
                id="settings-project-description"
                value={description}
                disabled={isRetiring}
                onChange={(event) => {
                  setDescription(event.target.value);
                  setSaved(false);
                }}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="settings-project-logo">Logo</Label>
              <Input
                ref={fileInputRef}
                id="settings-project-logo"
                type="file"
                accept="image/*"
                disabled={isRetiring}
                onChange={(event) => selectLogo(event.target.files?.[0] ?? null)}
              />
              <p className="text-xs text-zinc-500">Optional image, 2 MB maximum.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={isSaving || isRemovingLogo || isRetiring}>
                {isSaving ? "Saving..." : selectedLogo ? "Save and upload logo" : "Save settings"}
              </Button>
              <Button type="button" variant="outline" asChild disabled={isRetiring}>
                <Link href="/dashboard">Dashboard</Link>
              </Button>
            </div>
          </div>
        </form>

        {project.isOwner ? (
          <section className="grid gap-4 rounded-lg border border-red-200 bg-red-50/50 p-5">
            <div>
              <h2 className="text-lg font-semibold tracking-normal text-red-950">Delete project</h2>
              <p className="mt-1 max-w-3xl text-sm text-zinc-700">
                Deleting retires this project and removes it from normal use. Historical data and
                on-chain records remain stored, and existing checkouts and admitted Gas requests can
                finish under their current rules. This project cannot be restored.
              </p>
            </div>
            <Dialog
              open={retireDialogOpen}
              onOpenChange={(open) => {
                if (isRetiring) return;
                setRetireDialogOpen(open);
                if (!open) {
                  setConfirmationName("");
                  setRetireError(null);
                }
              }}
            >
              <DialogTrigger asChild>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={isSaving || isRemovingLogo || isRetiring}
                  className="w-fit"
                >
                  <Trash2Icon />
                  Delete project
                </Button>
              </DialogTrigger>
              <DialogContent showCloseButton={!isRetiring}>
                <DialogHeader>
                  <DialogTitle>Delete {project.name}?</DialogTitle>
                  <DialogDescription>
                    Enter the exact project name to retire this project. The match is
                    case-sensitive.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-3 rounded-md border bg-muted/40 p-3 text-sm">
                  <div className="grid gap-1">
                    <span className="text-muted-foreground">Project name</span>
                    <code className="font-medium break-words">{project.name}</code>
                  </div>
                  <div className="grid gap-1">
                    <span className="text-muted-foreground">Unique slug</span>
                    <code className="break-all">/{project.slug}</code>
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="retire-project-confirmation">
                    Type the project name to confirm
                  </Label>
                  <Input
                    id="retire-project-confirmation"
                    value={confirmationName}
                    onChange={(event) => setConfirmationName(event.target.value)}
                    autoComplete="off"
                    aria-describedby={retireError ? "retire-project-error" : undefined}
                    aria-invalid={Boolean(retireError)}
                    disabled={isRetiring}
                  />
                  {retireError ? (
                    <p
                      id="retire-project-error"
                      role="alert"
                      aria-live="assertive"
                      className="text-sm text-destructive"
                    >
                      {retireError}
                    </p>
                  ) : null}
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isRetiring}
                    onClick={() => setRetireDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={confirmationName !== project.name || isRetiring}
                    onClick={handleRetireProject}
                  >
                    {isRetiring ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />}
                    {isRetiring ? "Deleting project..." : "Delete project"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </section>
        ) : null}

        <div className="rounded-lg border border-zinc-200 bg-white p-5">
          <div>
            <h2 className="text-lg font-semibold tracking-normal">Appearance</h2>
            <p className="mt-1 text-sm text-zinc-600">Customize how Velo looks on your device.</p>
          </div>
          <div className="mt-4 grid max-w-xs gap-2">
            <Label htmlFor="settings-theme">Theme</Label>
            <select
              id="settings-theme"
              value={mounted ? theme : "system"}
              onChange={(e) => setTheme(e.target.value)}
              disabled={!mounted}
              className="flex h-9 w-full rounded-md border border-zinc-200 bg-white px-3 py-1 text-sm shadow-xs transition-colors focus-visible:ring-1 focus-visible:ring-zinc-400 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="system">System preference</option>
              <option value="light">Light mode</option>
              <option value="dark">Dark mode</option>
            </select>
          </div>
        </div>
      </div>

      <aside className="flex flex-col gap-4 rounded-lg border border-zinc-200 bg-white p-5">
        <div className="grid gap-3 border-b border-zinc-200 pb-4">
          <div className="grid gap-1">
            <span className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
              Project ID
            </span>
            <code className="text-xs break-all">{project._id}</code>
          </div>
          <div className="grid gap-1">
            <span className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Slug</span>
            <code className="text-xs break-all">/{project.slug}</code>
          </div>
        </div>
        <div>
          <h2 className="text-base font-semibold tracking-normal">Project logo</h2>
          <p className="mt-1 text-sm text-zinc-600">Shown in the sidebar project switcher.</p>
        </div>
        <div className="flex aspect-square w-32 items-center justify-center overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100">
          {selectedLogoUrl ? (
            <img src={selectedLogoUrl} alt="" className="size-full object-cover" />
          ) : project.logoUrl ? (
            <img src={project.logoUrl} alt="" className="size-full object-cover" />
          ) : (
            <ImageIcon className="size-10 text-zinc-400" />
          )}
        </div>
        {project.logoUrl ? (
          <Button
            type="button"
            variant="outline"
            onClick={handleRemoveLogo}
            disabled={isSaving || isRemovingLogo || isRetiring}
            className="w-fit"
          >
            <Trash2Icon />
            {isRemovingLogo ? "Removing..." : "Remove logo"}
          </Button>
        ) : null}
      </aside>
    </section>
  );
}
