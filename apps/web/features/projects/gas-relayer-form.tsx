"use client";

import { api } from "@repo/backend/convex/_generated/api";
import { Alert, AlertDescription, AlertTitle } from "@repo/ui/components/ui/alert";
import { Button } from "@repo/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/ui/card";
import { Input } from "@repo/ui/components/ui/input";
import { Label } from "@repo/ui/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@repo/ui/components/ui/native-select";
import { useMutation } from "convex/react";
import { AlertCircleIcon, CheckCircle2Icon, InfoIcon, RotateCcwIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from "react";

import type { Id } from "@repo/backend/convex/_generated/dataModel";

import {
  areGasRelayerDraftsEqual,
  initializeGasRelayerDraft,
  validateGasRelayerDraft,
  type GasRelayerDraft,
  type GasRelayerSnapshot,
  type GasRelayerStatus,
} from "./gas-ui";

type GasRelayerConfigurationFormProps = {
  projectId: Id<"projects">;
  relayer: GasRelayerSnapshot | null;
};

type SavePhase = "idle" | "saving" | "saved";

function storedRelayerKey(
  relayer: GasRelayerSnapshot | null,
  publicKey: string,
  status: GasRelayerStatus,
): string {
  return `${relayer?.updatedAt ?? "missing"}|${publicKey}|${status}`;
}

export function GasRelayerConfigurationForm({
  projectId,
  relayer,
}: GasRelayerConfigurationFormProps) {
  const updateRelayerAccount = useMutation(api.gas.mutations.updateRelayerAccount);
  const initialDraft = initializeGasRelayerDraft(relayer);
  const [draft, setDraft] = useState<GasRelayerDraft>(initialDraft);
  const [baseline, setBaseline] = useState<GasRelayerDraft>(initialDraft);
  const [savePhase, setSavePhase] = useState<SavePhase>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [publicKeyTouched, setPublicKeyTouched] = useState(false);
  const [hasRemoteUpdate, setHasRemoteUpdate] = useState(false);
  const mountedRef = useRef(true);
  const observedKeyRef = useRef(
    storedRelayerKey(relayer, initialDraft.publicKey, initialDraft.status),
  );
  const formId = useId();
  const publicKeyId = `${formId}-public-key`;
  const statusId = `${formId}-status`;
  const publicKeyDescriptionId = `${publicKeyId}-description`;
  const publicKeyErrorId = `${publicKeyId}-error`;
  const statusDescriptionId = `${statusId}-description`;
  const statusMessageId = `${formId}-message`;

  const storedPublicKey = relayer?.publicKey ?? "";
  const storedStatus = relayer?.status ?? "active";
  const storedKey = storedRelayerKey(relayer, storedPublicKey, storedStatus);
  const isDirty = !areGasRelayerDraftsEqual(draft, baseline);
  const validation = validateGasRelayerDraft(draft);
  const publicKeyError =
    publicKeyTouched && !validation.ok ? validation.errors.publicKey : undefined;

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (observedKeyRef.current === storedKey) return;

    observedKeyRef.current = storedKey;
    const nextDraft: GasRelayerDraft = {
      publicKey: storedPublicKey,
      status: storedStatus,
    };
    const draftWasClean = areGasRelayerDraftsEqual(draft, baseline);
    setBaseline(nextDraft);
    setHasRemoteUpdate(!draftWasClean);
    if (draftWasClean) setDraft(nextDraft);
    setSaveError(null);
  }, [baseline, draft, storedKey, storedPublicKey, storedStatus]);

  function handlePublicKeyChange(event: ChangeEvent<HTMLInputElement>) {
    setDraft((current) => ({ ...current, publicKey: event.target.value }));
    setPublicKeyTouched(true);
    setSavePhase("idle");
    setSaveError(null);
  }

  function handleStatusChange(event: ChangeEvent<HTMLSelectElement>) {
    setDraft((current) => ({
      ...current,
      status: event.target.value as GasRelayerStatus,
    }));
    setSavePhase("idle");
    setSaveError(null);
  }

  function handleReset() {
    setDraft(baseline);
    setHasRemoteUpdate(false);
    setPublicKeyTouched(false);
    setSavePhase("idle");
    setSaveError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPublicKeyTouched(true);
    if (!validation.ok || hasRemoteUpdate || !isDirty) return;

    setSavePhase("saving");
    setSaveError(null);

    try {
      const saved = await updateRelayerAccount({
        projectId,
        publicKey: validation.values.publicKey,
        status: validation.values.status,
      });
      if (!mountedRef.current) return;

      const savedDraft: GasRelayerDraft = {
        publicKey: saved.publicKey,
        status: saved.status,
      };
      setDraft(savedDraft);
      setBaseline(savedDraft);
      setHasRemoteUpdate(false);
      setSavePhase("saved");
    } catch {
      if (!mountedRef.current) return;
      setSavePhase("idle");
      setSaveError("Relayer configuration could not be saved. Check the address and try again.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{relayer ? "Update relayer configuration" : "Add a relayer account"}</CardTitle>
        <CardDescription>
          Configure the public Testnet fee-source address that the Gas Station observes.
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="grid min-w-0 gap-5">
          <Alert>
            <InfoIcon />
            <AlertTitle>Public address only</AlertTitle>
            <AlertDescription>
              Enter the relayer&apos;s public Stellar address. Never enter a secret key here; the
              matching signer remains in the Convex deployment configuration.
            </AlertDescription>
          </Alert>

          <div className="grid min-w-0 gap-2">
            <Label htmlFor={publicKeyId}>Relayer public address</Label>
            <Input
              id={publicKeyId}
              type="text"
              value={draft.publicKey}
              placeholder="G..."
              autoComplete="off"
              spellCheck={false}
              onChange={handlePublicKeyChange}
              onBlur={() => setPublicKeyTouched(true)}
              aria-invalid={Boolean(publicKeyError)}
              aria-describedby={`${publicKeyDescriptionId}${publicKeyError ? ` ${publicKeyErrorId}` : ""}`}
            />
            <p id={publicKeyDescriptionId} className="text-sm text-muted-foreground">
              Use the Testnet account&apos;s public address. It is normalized to uppercase before
              saving.
            </p>
            {publicKeyError ? (
              <p id={publicKeyErrorId} className="text-sm text-destructive" role="alert">
                {publicKeyError}
              </p>
            ) : null}
          </div>

          <div className="grid min-w-0 gap-2">
            <Label htmlFor={statusId}>Relayer metadata status</Label>
            <NativeSelect
              id={statusId}
              value={draft.status}
              onChange={handleStatusChange}
              aria-describedby={statusDescriptionId}
            >
              <NativeSelectOption value="active">Active</NativeSelectOption>
              <NativeSelectOption value="disabled">Disabled</NativeSelectOption>
            </NativeSelect>
            <p id={statusDescriptionId} className="text-sm text-muted-foreground">
              Disabled metadata prevents this record from being used for sponsorship. It does not
              delete the stored public address.
            </p>
          </div>

          {hasRemoteUpdate ? (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertTitle>Stored relayer changed</AlertTitle>
              <AlertDescription>
                The stored configuration changed while this draft was being edited. Reset to load
                the latest values before saving.
              </AlertDescription>
            </Alert>
          ) : null}
          {saveError ? (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertTitle>Relayer configuration not saved</AlertTitle>
              <AlertDescription>{saveError}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
        <CardFooter className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            disabled={!isDirty || !validation.ok || hasRemoteUpdate || savePhase === "saving"}
            aria-describedby={statusMessageId}
          >
            {savePhase === "saving" ? "Saving…" : "Save relayer configuration"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleReset}
            disabled={!isDirty && !hasRemoteUpdate}
          >
            <RotateCcwIcon />
            Reset
          </Button>
          <p
            id={statusMessageId}
            className="text-sm text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            {savePhase === "saved" ? (
              <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                <CheckCircle2Icon className="size-4" />
                Relayer configuration saved.
              </span>
            ) : hasRemoteUpdate ? (
              "Reset before saving the latest stored configuration."
            ) : isDirty ? (
              "Unsaved relayer changes."
            ) : (
              "No unsaved relayer changes."
            )}
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
