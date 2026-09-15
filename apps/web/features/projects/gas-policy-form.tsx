"use client";

import { Badge } from "@repo/ui/components/ui-customs/badge";
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
import { Switch } from "@repo/ui/components/ui/switch";
import { Textarea } from "@repo/ui/components/ui/textarea";
import { InfoIcon, RotateCcwIcon } from "lucide-react";
import { useEffect, useId, useState, type ChangeEvent, type FormEvent } from "react";

import {
  initializeGasPolicyDraft,
  type GasPolicyDraft,
  type GasPolicyDraftErrors,
  type GasPolicyDraftField,
  type GasPolicyRole,
  type GasPolicySnapshot,
  validateGasPolicyDraft,
} from "./gas-ui";

type GasPolicyFormProps = {
  policy: GasPolicySnapshot | null | undefined;
  role: GasPolicyRole;
};

type GasPolicyFieldsProps = {
  draft: GasPolicyDraft;
  readOnly: boolean;
  errors: GasPolicyDraftErrors;
  touched: Partial<Record<GasPolicyDraftField, boolean>>;
  onEnabledChange?: (enabled: boolean) => void;
  onDailyCapChange?: (value: string) => void;
  onDailyCapBlur?: () => void;
  onWalletHourlyLimitChange?: (value: string) => void;
  onWalletHourlyLimitBlur?: () => void;
  onAllowlistChange?: (value: string) => void;
  onAllowlistBlur?: () => void;
};

function getDescribedBy(descriptionId: string, errorId: string, error?: string): string {
  return error ? `${descriptionId} ${errorId}` : descriptionId;
}

function PolicyError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;

  return (
    <p id={id} className="text-sm text-destructive" role="alert">
      {message}
    </p>
  );
}

function GasPolicyFields({
  draft,
  readOnly,
  errors,
  touched,
  onEnabledChange,
  onDailyCapChange,
  onDailyCapBlur,
  onWalletHourlyLimitChange,
  onWalletHourlyLimitBlur,
  onAllowlistChange,
  onAllowlistBlur,
}: GasPolicyFieldsProps) {
  const formId = useId();
  const enabledId = `${formId}-enabled`;
  const dailyCapId = `${formId}-daily-cap`;
  const walletHourlyLimitId = `${formId}-wallet-hourly-limit`;
  const allowlistId = `${formId}-allowlist`;
  const enabledDescriptionId = `${enabledId}-description`;
  const dailyCapDescriptionId = `${dailyCapId}-description`;
  const walletHourlyLimitDescriptionId = `${walletHourlyLimitId}-description`;
  const allowlistDescriptionId = `${allowlistId}-description`;
  const dailyCapErrorId = `${dailyCapId}-error`;
  const walletHourlyLimitErrorId = `${walletHourlyLimitId}-error`;
  const allowlistErrorId = `${allowlistId}-error`;
  const dailyCapError = touched.dailyCapXlm ? errors.dailyCapXlm : undefined;
  const walletHourlyLimitError = touched.walletHourlyLimit ? errors.walletHourlyLimit : undefined;
  const allowlistError = touched.allowedContractIdsText ? errors.allowedContractIdsText : undefined;

  function handleDailyCapInputChange(event: ChangeEvent<HTMLInputElement>) {
    onDailyCapChange?.(event.target.value);
  }

  function handleWalletHourlyLimitInputChange(event: ChangeEvent<HTMLInputElement>) {
    onWalletHourlyLimitChange?.(event.target.value);
  }

  function handleAllowlistInputChange(event: ChangeEvent<HTMLTextAreaElement>) {
    onAllowlistChange?.(event.target.value);
  }

  return (
    <div className="grid min-w-0 gap-5">
      <div className="flex min-w-0 items-start justify-between gap-4 rounded-lg border p-4">
        <div className="grid min-w-0 gap-1">
          <Label htmlFor={enabledId}>Enable sponsorship</Label>
          <p id={enabledDescriptionId} className="text-sm text-muted-foreground">
            When disabled, new sponsorship requests are rejected.
          </p>
        </div>
        <Switch
          id={enabledId}
          checked={draft.enabled}
          disabled={readOnly}
          onCheckedChange={onEnabledChange}
          aria-describedby={enabledDescriptionId}
          aria-label="Enable sponsorship"
        />
      </div>

      <div className="grid min-w-0 gap-2">
        <Label htmlFor={dailyCapId}>Daily cap (XLM)</Label>
        <Input
          id={dailyCapId}
          type="text"
          inputMode="decimal"
          value={draft.dailyCapXlm}
          readOnly={readOnly}
          onChange={handleDailyCapInputChange}
          onBlur={onDailyCapBlur}
          aria-invalid={Boolean(dailyCapError)}
          aria-describedby={getDescribedBy(dailyCapDescriptionId, dailyCapErrorId, dailyCapError)}
        />
        <p id={dailyCapDescriptionId} className="text-sm text-muted-foreground">
          Enter XLM with up to seven decimal places. The exact range is 0 to 922337203685.4775807
          XLM.
        </p>
        <PolicyError id={dailyCapErrorId} message={dailyCapError} />
      </div>

      <div className="grid min-w-0 gap-2">
        <Label htmlFor={walletHourlyLimitId}>Hourly wallet quota</Label>
        <Input
          id={walletHourlyLimitId}
          type="text"
          inputMode="numeric"
          value={draft.walletHourlyLimit}
          readOnly={readOnly}
          onChange={handleWalletHourlyLimitInputChange}
          onBlur={onWalletHourlyLimitBlur}
          aria-invalid={Boolean(walletHourlyLimitError)}
          aria-describedby={getDescribedBy(
            walletHourlyLimitDescriptionId,
            walletHourlyLimitErrorId,
            walletHourlyLimitError,
          )}
        />
        <p id={walletHourlyLimitDescriptionId} className="text-sm text-muted-foreground">
          Maximum sponsorship requests per wallet in one UTC hour. Zero is restrictive.
        </p>
        <PolicyError id={walletHourlyLimitErrorId} message={walletHourlyLimitError} />
      </div>

      <div className="grid min-w-0 gap-2">
        <Label htmlFor={allowlistId}>Allowed contract IDs</Label>
        <Textarea
          id={allowlistId}
          rows={6}
          value={draft.allowedContractIdsText}
          readOnly={readOnly}
          onChange={handleAllowlistInputChange}
          onBlur={onAllowlistBlur}
          aria-invalid={Boolean(allowlistError)}
          aria-describedby={getDescribedBy(
            allowlistDescriptionId,
            allowlistErrorId,
            allowlistError,
          )}
          spellCheck={false}
        />
        <p id={allowlistDescriptionId} className="text-sm text-muted-foreground">
          One Stellar contract ID per line, up to 20 nonblank lines. Blank lines are ignored and
          duplicate IDs are removed in input order. An empty allowlist permits no contracts.
        </p>
        <PolicyError id={allowlistErrorId} message={allowlistError} />
      </div>
    </div>
  );
}

function GasPolicyFormLoading() {
  return (
    <Card aria-busy="true" aria-label="Loading Gas policy controls">
      <CardHeader>
        <div className="h-6 w-44 animate-pulse rounded bg-muted" />
        <div className="h-4 w-full max-w-xl animate-pulse rounded bg-muted" />
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="h-12 w-full animate-pulse rounded bg-muted" />
        <div className="h-20 w-full animate-pulse rounded bg-muted" />
        <div className="h-20 w-full animate-pulse rounded bg-muted" />
        <div className="h-32 w-full animate-pulse rounded bg-muted" />
      </CardContent>
    </Card>
  );
}

function ReadOnlyGasPolicyForm({ policy }: { policy: GasPolicySnapshot | null }) {
  const draft = initializeGasPolicyDraft(policy);

  return (
    <Card aria-labelledby="gas-policy-controls-title">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle id="gas-policy-controls-title">Policy controls</CardTitle>
          <Badge variant="gray">Read only</Badge>
        </div>
        <CardDescription>
          Viewer access can inspect the current stored values. Only owners and editors can prepare
          local policy drafts.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <GasPolicyFields draft={draft} readOnly errors={{}} touched={{}} />
      </CardContent>
    </Card>
  );
}

function areDraftsEqual(left: GasPolicyDraft, right: GasPolicyDraft): boolean {
  return (
    left.enabled === right.enabled &&
    left.dailyCapXlm === right.dailyCapXlm &&
    left.walletHourlyLimit === right.walletHourlyLimit &&
    left.allowedContractIdsText === right.allowedContractIdsText
  );
}

function EditableGasPolicyForm({ policy }: { policy: GasPolicySnapshot | null | undefined }) {
  const latestDraft = policy === undefined ? null : initializeGasPolicyDraft(policy);
  const storedKey = latestDraft ? JSON.stringify(latestDraft) : null;
  const [draft, setDraft] = useState<GasPolicyDraft | null>(() => latestDraft);
  const [baseDraft, setBaseDraft] = useState<GasPolicyDraft | null>(() => latestDraft);
  const [lastStoredKey, setLastStoredKey] = useState<string | null>(() => storedKey);
  const [hasLocalEdits, setHasLocalEdits] = useState(false);
  const [hasRemoteUpdate, setHasRemoteUpdate] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<GasPolicyDraftField, boolean>>>({});

  useEffect(() => {
    if (latestDraft === null || storedKey === lastStoredKey) return;

    setLastStoredKey(storedKey);
    setBaseDraft(latestDraft);
    setHasRemoteUpdate(hasLocalEdits);
    if (!hasLocalEdits) {
      setDraft(latestDraft);
    }
  }, [hasLocalEdits, lastStoredKey, latestDraft, storedKey]);

  if (draft === null || baseDraft === null || latestDraft === null) {
    return <GasPolicyFormLoading />;
  }

  const validation = validateGasPolicyDraft(draft);
  const errors = validation.ok ? {} : validation.errors;
  const isDirty = !areDraftsEqual(draft, baseDraft);

  function markTouched(field: GasPolicyDraftField) {
    setTouched((current) => ({ ...current, [field]: true }));
  }

  function updateDraftField(field: GasPolicyDraftField, value: string) {
    setDraft((current) => (current ? { ...current, [field]: value } : current));
    setHasLocalEdits(true);
  }

  function handleEnabledChange(enabled: boolean) {
    setDraft((current) => (current ? { ...current, enabled } : current));
    setHasLocalEdits(true);
  }

  function handleDailyCapChange(value: string) {
    updateDraftField("dailyCapXlm", value);
  }

  function handleDailyCapBlur() {
    markTouched("dailyCapXlm");
  }

  function handleWalletHourlyLimitChange(value: string) {
    updateDraftField("walletHourlyLimit", value);
  }

  function handleWalletHourlyLimitBlur() {
    markTouched("walletHourlyLimit");
  }

  function handleAllowlistChange(value: string) {
    updateDraftField("allowedContractIdsText", value);
  }

  function handleAllowlistBlur() {
    markTouched("allowedContractIdsText");
  }

  function handleReset() {
    setDraft(latestDraft);
    setBaseDraft(latestDraft);
    setLastStoredKey(storedKey);
    setHasLocalEdits(false);
    setHasRemoteUpdate(false);
    setTouched({});
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
  }

  return (
    <Card aria-labelledby="gas-policy-controls-title">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle id="gas-policy-controls-title">Policy controls</CardTitle>
          <Badge variant={isDirty ? "warning" : "gray"}>
            {isDirty ? "Unsaved changes" : "Matches stored values"}
          </Badge>
        </div>
        <CardDescription>
          Prepare a policy draft locally. Sub-sprint 3.2 has no Save action, so these edits are not
          sent to Convex.
        </CardDescription>
        {hasRemoteUpdate && isDirty ? (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            The stored policy changed while this draft was being edited. Reset to review the latest
            stored values.
          </p>
        ) : null}
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid min-w-0 gap-5">
          <GasPolicyFields
            draft={draft}
            readOnly={false}
            errors={errors}
            touched={touched}
            onEnabledChange={handleEnabledChange}
            onDailyCapChange={handleDailyCapChange}
            onDailyCapBlur={handleDailyCapBlur}
            onWalletHourlyLimitChange={handleWalletHourlyLimitChange}
            onWalletHourlyLimitBlur={handleWalletHourlyLimitBlur}
            onAllowlistChange={handleAllowlistChange}
            onAllowlistBlur={handleAllowlistBlur}
          />
          <div className="flex min-w-0 items-start gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>
              Zero caps and quotas are restrictive. Accounting uses UTC day and hour windows. An
              empty allowlist permits no contracts.
            </p>
          </div>
        </form>
      </CardContent>
      <CardFooter className="flex-wrap justify-between gap-3 border-t">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {validation.ok
            ? "Draft values are valid locally."
            : "Fix the marked fields before this draft can be used."}
        </p>
        <Button type="button" variant="outline" onClick={handleReset} disabled={!isDirty}>
          <RotateCcwIcon aria-hidden="true" />
          Reset to stored values
        </Button>
      </CardFooter>
    </Card>
  );
}

export function GasPolicyForm({ policy, role }: GasPolicyFormProps) {
  if (policy === undefined) {
    return <GasPolicyFormLoading />;
  }

  if (role === "viewer") {
    return <ReadOnlyGasPolicyForm policy={policy} />;
  }

  return <EditableGasPolicyForm policy={policy} />;
}
