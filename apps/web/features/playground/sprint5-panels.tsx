"use client";

import {
  generatePlaygroundCode,
  type CanonicalArgumentValue,
  type ContractSpecDocumentV1,
} from "@repo/stellar";
import { Button } from "@repo/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/ui/card";
import { CopyIcon, HistoryIcon, Trash2Icon } from "lucide-react";
import { useMemo, useState } from "react";

import type { PlaygroundHistoryEntryV1 } from "./history";

export function PlaygroundHistoryPanel({
  entries,
  onOpen,
  onDuplicate,
  onDelete,
  onClear,
}: {
  entries: PlaygroundHistoryEntryV1[];
  onOpen: (entry: PlaygroundHistoryEntryV1) => void;
  onDuplicate: (entry: PlaygroundHistoryEntryV1) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
}) {
  return (
    <Card aria-labelledby="playground-history-title">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>
              <h2 id="playground-history-title">Recent Playground history</h2>
            </CardTitle>
            <CardDescription>
              Stored only on this device for 30 days. Sensitive arguments are never retained.
            </CardDescription>
          </div>
          {entries.length ? (
            <Button type="button" variant="outline" onClick={onClear}>
              <Trash2Icon /> Clear all history
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {entries.length ? (
          <ul className="grid gap-3">
            {entries.map((entry) => (
              <li key={entry.id} className="grid min-w-0 gap-2 rounded-lg border p-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                  <HistoryIcon className="size-4" aria-hidden="true" />
                  <strong className="font-mono">{entry.functionName ?? "Contract loaded"}</strong>
                  <span>{entry.network}</span>
                  <span>{entry.status ?? entry.kind}</span>
                  <time dateTime={entry.createdAt}>
                    {new Date(entry.createdAt).toLocaleString()}
                  </time>
                </div>
                <p className="truncate font-mono text-xs" title={entry.contractId}>
                  {entry.contractId}
                </p>
                {entry.privacyReason ? (
                  <p className="text-xs text-muted-foreground">{entry.privacyReason}</p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" onClick={() => onOpen(entry)}>
                    {entry.replayable ? "Reopen request" : "Reopen contract"}
                  </Button>
                  {entry.kind === "request" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => onDuplicate(entry)}
                    >
                      Duplicate
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`Delete history entry for ${entry.functionName ?? entry.contractId}`}
                    onClick={() => onDelete(entry.id)}
                  >
                    <Trash2Icon /> Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No local Playground history yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

export function PlaygroundCodePanel({
  network,
  contract,
  functionName,
  arguments: argumentValues,
  onCopied,
}: {
  network: "testnet" | "mainnet";
  contract: ContractSpecDocumentV1;
  functionName: string;
  arguments: Record<string, CanonicalArgumentValue>;
  onCopied: () => void;
}) {
  const [tab, setTab] = useState<"typescript" | "cli">("typescript");
  const [copyStatus, setCopyStatus] = useState("");
  const generated = useMemo(() => {
    try {
      return {
        value: generatePlaygroundCode({
          network,
          contract,
          functionName,
          arguments: argumentValues,
        }),
        error: null,
      };
    } catch (error) {
      return {
        value: null,
        error: error instanceof Error ? error.message : "Code generation failed.",
      };
    }
  }, [argumentValues, contract, functionName, network]);

  async function copy() {
    if (!generated.value) return;
    try {
      await navigator.clipboard.writeText(generated.value[tab]);
      setCopyStatus(`${tab === "typescript" ? "TypeScript" : "CLI"} code copied.`);
      onCopied();
    } catch {
      setCopyStatus("Copy failed. Select the code and copy it manually.");
    }
  }

  return (
    <Card aria-labelledby="playground-code-title">
      <CardHeader>
        <CardTitle>
          <h2 id="playground-code-title">Reproducible code</h2>
        </CardTitle>
        <CardDescription>
          Uses Stellar SDK 14.2.0 and Stellar CLI 25.2.0. Signing remains external.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-3">
        {generated.error ? (
          <p role="alert" className="text-sm text-destructive">
            {generated.error}
          </p>
        ) : (
          <>
            <div role="tablist" aria-label="Generated code language" className="flex gap-2">
              {(["typescript", "cli"] as const).map((candidate) => (
                <Button
                  key={candidate}
                  role="tab"
                  type="button"
                  tabIndex={tab === candidate ? 0 : -1}
                  variant={tab === candidate ? "secondary" : "outline"}
                  aria-selected={tab === candidate}
                  aria-controls={`playground-code-${candidate}`}
                  onClick={() => setTab(candidate)}
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                    event.preventDefault();
                    setTab(candidate === "typescript" ? "cli" : "typescript");
                    const sibling =
                      event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(
                        `[role="tab"]:not([aria-selected="true"])`,
                      );
                    sibling?.focus();
                  }}
                >
                  {candidate === "typescript" ? "TypeScript" : "Stellar CLI"}
                </Button>
              ))}
            </div>
            <div
              id={`playground-code-${tab}`}
              role="tabpanel"
              tabIndex={0}
              aria-label={`${tab} generated code`}
              className="max-w-full overflow-x-auto rounded-lg border bg-muted/30"
            >
              <pre className="min-w-max p-4 text-xs">
                <code>{generated.value![tab]}</code>
              </pre>
            </div>
            <Button type="button" variant="outline" onClick={() => void copy()}>
              <CopyIcon /> Copy {tab === "typescript" ? "TypeScript" : "CLI"}
            </Button>
            <p className="sr-only" aria-live="polite">
              {copyStatus}
            </p>
            {copyStatus ? <p className="text-xs text-muted-foreground">{copyStatus}</p> : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
