"use client";

import { env } from "@/core/config/env";
import { useWallet } from "@/core/wallet/wallet-provider";
import {
  draftFromDocument,
  parseOriginLines,
  walletIntegrationSnippets,
} from "@/features/projects/wallet-config-form";
import {
  DEFAULT_WALLET_APPEARANCE_STYLE,
  DEFAULT_WALLET_CONFIG,
  normalizeWalletAppearance,
  validateWalletDraft,
  WALLET_CATALOG,
  type WalletAppearanceStyle,
  type WalletDraftConfig,
  type WalletPalette,
  type WalletSelectorLogo,
} from "@carts1024/velo-wallets/config";
import { WALLET_LOGOS } from "@carts1024/velo-wallets/logos";
import { api } from "@repo/backend/convex/_generated/api";
import { Alert, AlertDescription, AlertTitle } from "@repo/ui/components/ui/alert";
import { Badge } from "@repo/ui/components/ui/badge";
import { Button } from "@repo/ui/components/ui/button";
import { Checkbox } from "@repo/ui/components/ui/checkbox";
import { Input } from "@repo/ui/components/ui/input";
import { Label } from "@repo/ui/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@repo/ui/components/ui/native-select";
import { Skeleton } from "@repo/ui/components/ui/skeleton";
import { Switch } from "@repo/ui/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/components/ui/tabs";
import { Textarea } from "@repo/ui/components/ui/textarea";
import { useMutation, useQuery } from "convex/react";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  CopyIcon,
  ExternalLinkIcon,
  PaletteIcon,
  Settings2Icon,
  WalletIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties } from "react";

import type { Id } from "@repo/backend/convex/_generated/dataModel";

type SaveState =
  | "draft"
  | "unsaved"
  | "saving"
  | "publishing"
  | "published"
  | "disabled"
  | "failed";

const EDITOR_SECTIONS = [
  { id: "wallets", label: "Wallets", icon: WalletIcon },
  { id: "appearance", label: "Appearance", icon: PaletteIcon },
  { id: "settings", label: "Settings", icon: Settings2Icon },
] as const;

type EditorSection = (typeof EDITOR_SECTIONS)[number]["id"];

const PALETTE_FIELDS: Array<[keyof WalletPalette, string]> = [
  ["background", "Background"],
  ["surface", "Surface"],
  ["surfaceMuted", "Muted surface"],
  ["text", "Text"],
  ["mutedText", "Muted text"],
  ["accent", "Accent"],
  ["accentText", "Accent text"],
  ["border", "Border"],
  ["danger", "Danger"],
  ["focusRing", "Focus ring"],
];

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Wallet configuration could not be updated";
}

export function ProjectWallets({ projectId }: { projectId: string }) {
  const wallet = useWallet();
  const typedProjectId = projectId as Id<"projects">;
  const stored = useQuery(
    api.wallet_configs.query.getDraft,
    wallet.address ? { projectId: typedProjectId } : "skip",
  );
  const project = useQuery(
    api.projects.query.getById,
    wallet.address ? { id: typedProjectId } : "skip",
  );
  const saveDraft = useMutation(api.wallet_configs.mutation.saveDraft);
  const publish = useMutation(api.wallet_configs.mutation.publish);
  const setEnabled = useMutation(api.wallet_configs.mutation.setEnabled);
  const [draft, setDraft] = useState<WalletDraftConfig>({ ...DEFAULT_WALLET_CONFIG });
  const [saveState, setSaveState] = useState<SaveState>("draft");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<EditorSection>("wallets");
  const [paletteTab, setPaletteTab] = useState<"light" | "dark">("light");
  const [previewState, setPreviewState] = useState<
    "disconnected" | "connecting" | "connected" | "error"
  >("disconnected");

  useEffect(() => {
    if (stored) {
      setDraft(draftFromDocument(stored));
      setSaveState(
        stored.enabled ? "published" : stored.activePublicationId ? "disabled" : "draft",
      );
    }
  }, [stored]);

  const errors = useMemo(() => validateWalletDraft(draft), [draft]);
  const appearance = useMemo(() => normalizeWalletAppearance(draft), [draft]);
  const appBaseUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  const cdnBaseUrl = env.NEXT_PUBLIC_WALLETS_CDN_BASE_URL ?? `${appBaseUrl}/wallets`;
  const snippets = stored
    ? walletIntegrationSnippets({
        projectKey: stored.publicKey,
        cdnBaseUrl,
        apiBaseUrl: appBaseUrl,
      })
    : null;

  function updateDraft(update: Partial<WalletDraftConfig>) {
    setDraft((current) => ({ ...current, ...update }));
    setSaveState("unsaved");
    setFeedback(null);
  }

  function updateAppearance(update: Partial<WalletAppearanceStyle>) {
    updateDraft({
      appearance: {
        palettes: update.palettes ?? appearance.palettes,
        fontFamily: update.fontFamily ?? appearance.fontFamily,
        button: { ...appearance.button, ...update.button },
        modal: { ...appearance.modal, ...update.modal },
      },
    });
  }

  function updatePalette(mode: "light" | "dark", token: keyof WalletPalette, value: string) {
    updateAppearance({
      palettes: {
        ...appearance.palettes,
        [mode]: { ...appearance.palettes[mode], [token]: value },
      },
    });
  }

  async function handleSave() {
    if (errors.length) return;
    setSaveState("saving");
    try {
      await saveDraft({ projectId: typedProjectId, ...draft });
      setSaveState("draft");
      setFeedback("Draft saved. Publish when you are ready to update consuming applications.");
    } catch (error) {
      setSaveState("failed");
      setFeedback(errorMessage(error));
    }
  }

  async function handlePublish() {
    if (errors.length || saveState === "unsaved") return;
    const summary = `${draft.network === "public" ? "Mainnet" : "Testnet"}, ${draft.walletIds.length} wallets, ${draft.allowedOrigins.length} origins`;
    if (!window.confirm(`Publish a new immutable wallet revision?\n\n${summary}`)) return;
    if (
      draft.network === "public" &&
      window.prompt('Type "MAINNET" to publish this integration.') !== "MAINNET"
    )
      return;
    setSaveState("publishing");
    try {
      const result = await publish({ projectId: typedProjectId });
      setSaveState("published");
      setFeedback(
        `Revision ${result.revision} is live. Consuming apps will receive it on their next load.`,
      );
    } catch (error) {
      setSaveState("failed");
      setFeedback(errorMessage(error));
    }
  }

  async function toggleEnabled() {
    if (!stored?.activePublicationId) return;
    try {
      await setEnabled({ projectId: typedProjectId, enabled: !stored.enabled });
      setSaveState(stored.enabled ? "disabled" : "published");
      setFeedback(stored.enabled ? "Integration disabled." : "Published integration enabled.");
    } catch (error) {
      setSaveState("failed");
      setFeedback(errorMessage(error));
    }
  }

  async function copy(value: string, label: string) {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1800);
  }

  if (!wallet.address) {
    return (
      <section className="grid gap-4">
        <h1 className="text-3xl font-semibold">Velo Wallets</h1>
        <Alert>
          <WalletIcon />
          <AlertTitle>Connect the owner wallet</AlertTitle>
          <AlertDescription>
            Only the project owner can configure and publish this integration.
          </AlertDescription>
        </Alert>
        <Button onClick={wallet.connect} className="w-fit">
          <WalletIcon />
          Connect wallet
        </Button>
      </section>
    );
  }
  if (stored === undefined)
    return (
      <section className="grid gap-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </section>
    );

  return (
    <section className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(380px,460px)]">
      <div className="grid min-w-0 content-start gap-5">
        <header>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-semibold">Velo Wallets</h1>
            <Badge variant="secondary">Alpha</Badge>
            <Badge variant="outline">{saveState}</Badge>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-zinc-600">
            Configure Stellar Wallets Kit once, publish it, and integrate multi-wallet connection
            with a component or React provider.
          </p>
        </header>

        <div aria-live="polite">
          {feedback ? (
            <Alert variant={saveState === "failed" ? "destructive" : "default"}>
              {saveState === "failed" ? <AlertCircleIcon /> : <CheckCircle2Icon />}
              <AlertTitle>
                {saveState === "failed" ? "Update failed" : "Configuration updated"}
              </AlertTitle>
              <AlertDescription>{feedback}</AlertDescription>
            </Alert>
          ) : null}
        </div>

        <div className="grid min-w-0 overflow-hidden rounded-xl border bg-white md:grid-cols-[132px_minmax(0,1fr)]">
          <nav
            aria-label="Wallet editor sections"
            className="border-b bg-zinc-50 p-2 md:border-r md:border-b-0 md:p-3"
          >
            <p className="px-2 py-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
              Configure
            </p>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-3 md:grid-cols-1">
              {EDITOR_SECTIONS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={activeSection === id}
                  onClick={() => setActiveSection(id)}
                  className={`flex min-h-12 items-center gap-2 rounded-md px-2 text-left text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 ${
                    activeSection === id
                      ? "bg-zinc-900 text-white"
                      : "text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-950"
                  }`}
                >
                  <Icon aria-hidden="true" className="size-4 shrink-0" />
                  <span className="min-w-0 leading-tight break-words">{label}</span>
                </button>
              ))}
            </div>
          </nav>

          <div className="grid min-w-0 content-start gap-5 p-4 sm:p-5">
            {activeSection === "wallets" ? (
              <>
                <div className="rounded-lg border bg-white p-5">
                  <div className="mb-5">
                    <h2 className="font-semibold">Guided Testnet preset</h2>
                    <p className="text-sm text-zinc-600">
                      Starts with Freighter, localhost, session restore, and a system-aware theme.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => updateDraft({ ...DEFAULT_WALLET_CONFIG })}
                  >
                    Reset to safe preset
                  </Button>
                </div>

                <div className="rounded-lg border bg-white p-5">
                  <h2 className="font-semibold">Wallet selection</h2>
                  <p className="mb-4 text-sm text-zinc-600">
                    Transaction signing is included. Auth-entry and message signing depend on each
                    wallet.
                  </p>
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))] gap-3">
                    {WALLET_CATALOG.map((item) => (
                      <label
                        key={item.id}
                        htmlFor={`wallet-${item.id}`}
                        className="flex min-w-0 cursor-pointer items-start gap-3 rounded-md border p-3"
                      >
                        <Checkbox
                          id={`wallet-${item.id}`}
                          checked={draft.walletIds.includes(item.id)}
                          onCheckedChange={(checked) =>
                            updateDraft({
                              walletIds: checked
                                ? [...draft.walletIds, item.id]
                                : draft.walletIds.filter((id) => id !== item.id),
                            })
                          }
                          aria-label={`Enable ${item.name}`}
                        />
                        {WALLET_LOGOS[item.id] ? (
                          <img
                            src={WALLET_LOGOS[item.id]}
                            alt=""
                            width={40}
                            height={40}
                            className="size-10 shrink-0 rounded-xl border bg-white object-contain p-1"
                          />
                        ) : null}
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">{item.name}</span>
                          <span className="mt-1 block text-xs leading-relaxed text-zinc-500">
                            Transaction signing · advanced signing varies by wallet
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                  {draft.walletIds.includes("noir") ? (
                    <Alert className="mt-4">
                      <AlertTitle>Upgrade consuming apps before publishing Noir</AlertTitle>
                      <AlertDescription>
                        Install a Velo Wallets release that includes Noir in every consuming app
                        before publishing this configuration. Older runtimes reject the unknown
                        wallet ID. Users also need the{" "}
                        <a
                          className="font-medium underline"
                          href="https://chromewebstore.google.com/detail/noir/gikfhchijjljpbhokmdmaadgmpbchmjl"
                          target="_blank"
                          rel="noreferrer"
                        >
                          Noir browser extension
                        </a>
                        .
                      </AlertDescription>
                    </Alert>
                  ) : null}
                  <p className="mt-4 text-xs text-zinc-500">
                    WalletConnect, Ledger, and Trezor are deferred from v1 so the hosted runtime
                    stays credential-free and predictable.
                  </p>
                </div>
              </>
            ) : null}

            {activeSection === "settings" ? (
              <div className="rounded-lg border bg-white p-5">
                <Label htmlFor="wallet-network">Network</Label>
                <NativeSelect
                  id="wallet-network"
                  value={draft.network}
                  onChange={(event) =>
                    updateDraft({ network: event.target.value as WalletDraftConfig["network"] })
                  }
                  wrapperClassName="mt-2"
                >
                  <NativeSelectOption value="testnet">Testnet</NativeSelectOption>
                  <NativeSelectOption value="public">Mainnet</NativeSelectOption>
                </NativeSelect>
                {draft.network === "public" ? (
                  <p className="mt-2 text-xs text-amber-700">
                    Mainnet requires a non-local HTTPS origin and typed confirmation.
                  </p>
                ) : null}
              </div>
            ) : null}

            {activeSection === "appearance" ? (
              <div className="rounded-lg border bg-white p-5">
                <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">Appearance</h2>
                    <p className="text-sm text-zinc-600">
                      These brand controls style the embedded wallet controls and wallet selector.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      updateDraft({
                        theme: DEFAULT_WALLET_CONFIG.theme,
                        buttonLabel: DEFAULT_WALLET_CONFIG.buttonLabel,
                        selectorLogo: DEFAULT_WALLET_CONFIG.selectorLogo,
                        appearance: DEFAULT_WALLET_APPEARANCE_STYLE,
                      })
                    }
                  >
                    Reset appearance
                  </Button>
                </div>

                <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-4">
                  <div>
                    <Label htmlFor="wallet-selector-logo">Wallet selector logo</Label>
                    <NativeSelect
                      id="wallet-selector-logo"
                      value={draft.selectorLogo ?? "velo"}
                      onChange={(event) =>
                        updateDraft({ selectorLogo: event.target.value as WalletSelectorLogo })
                      }
                      wrapperClassName="mt-2"
                    >
                      <NativeSelectOption value="velo">Velo logo</NativeSelectOption>
                      <NativeSelectOption value="project">Project logo</NativeSelectOption>
                      <NativeSelectOption value="none">No logo</NativeSelectOption>
                    </NativeSelect>
                    <p className="mt-2 text-xs text-zinc-500">
                      Upload your project logo in{" "}
                      <Link
                        className="font-medium text-zinc-900 underline underline-offset-2 dark:text-zinc-100"
                        href={`/projects/${projectId}/settings`}
                      >
                        Project Settings
                      </Link>
                      . Without an uploaded logo, the selector displays no logo.
                    </p>
                  </div>
                  <div>
                    <Label htmlFor="wallet-theme">Theme</Label>
                    <NativeSelect
                      id="wallet-theme"
                      value={draft.theme}
                      onChange={(event) =>
                        updateDraft({ theme: event.target.value as WalletDraftConfig["theme"] })
                      }
                      wrapperClassName="mt-2"
                    >
                      <NativeSelectOption value="system">System</NativeSelectOption>
                      <NativeSelectOption value="light">Light</NativeSelectOption>
                      <NativeSelectOption value="dark">Dark</NativeSelectOption>
                    </NativeSelect>
                  </div>
                  <div>
                    <Label htmlFor="wallet-label" className="mt-4">
                      Button label
                    </Label>
                    <Input
                      id="wallet-label"
                      maxLength={40}
                      value={draft.buttonLabel}
                      onChange={(event) => updateDraft({ buttonLabel: event.target.value })}
                      className="mt-2"
                    />
                  </div>
                  <AppearanceSelect
                    id="wallet-font"
                    label="Font"
                    value={appearance.fontFamily}
                    options={[
                      ["system", "System sans"],
                      ["serif", "Serif"],
                      ["mono", "Monospace"],
                    ]}
                    onChange={(value) =>
                      updateAppearance({ fontFamily: value as WalletAppearanceStyle["fontFamily"] })
                    }
                  />
                  <AppearanceSelect
                    id="wallet-button-variant"
                    label="Button style"
                    value={appearance.button.variant}
                    options={[
                      ["solid", "Solid"],
                      ["outline", "Outline"],
                      ["soft", "Soft"],
                    ]}
                    onChange={(value) =>
                      updateAppearance({
                        button: {
                          ...appearance.button,
                          variant: value as WalletAppearanceStyle["button"]["variant"],
                        },
                      })
                    }
                  />
                  <AppearanceSelect
                    id="wallet-button-size"
                    label="Button size"
                    value={appearance.button.size}
                    options={[
                      ["sm", "Small"],
                      ["md", "Medium"],
                      ["lg", "Large"],
                    ]}
                    onChange={(value) =>
                      updateAppearance({
                        button: {
                          ...appearance.button,
                          size: value as WalletAppearanceStyle["button"]["size"],
                        },
                      })
                    }
                  />
                  <AppearanceSelect
                    id="wallet-button-radius"
                    label="Button radius"
                    value={appearance.button.radius}
                    options={[
                      ["square", "Square"],
                      ["rounded", "Rounded"],
                      ["pill", "Pill"],
                    ]}
                    onChange={(value) =>
                      updateAppearance({
                        button: {
                          ...appearance.button,
                          radius: value as WalletAppearanceStyle["button"]["radius"],
                        },
                      })
                    }
                  />
                  <AppearanceSelect
                    id="wallet-modal-radius"
                    label="Modal radius"
                    value={appearance.modal.radius}
                    options={[
                      ["sm", "Small"],
                      ["md", "Medium"],
                      ["lg", "Large"],
                    ]}
                    onChange={(value) =>
                      updateAppearance({
                        modal: {
                          ...appearance.modal,
                          radius: value as WalletAppearanceStyle["modal"]["radius"],
                        },
                      })
                    }
                  />
                  <AppearanceSelect
                    id="wallet-modal-shadow"
                    label="Modal shadow"
                    value={appearance.modal.shadow}
                    options={[
                      ["none", "None"],
                      ["sm", "Small"],
                      ["md", "Medium"],
                    ]}
                    onChange={(value) =>
                      updateAppearance({
                        modal: {
                          ...appearance.modal,
                          shadow: value as WalletAppearanceStyle["modal"]["shadow"],
                        },
                      })
                    }
                  />
                </div>

                <div className="mt-6">
                  <div className="mb-4 flex flex-wrap gap-2" aria-label="Palette editor">
                    {(["light", "dark"] as const).map((mode) => (
                      <Button
                        key={mode}
                        type="button"
                        size="sm"
                        variant={paletteTab === mode ? "default" : "outline"}
                        aria-pressed={paletteTab === mode}
                        onClick={() => setPaletteTab(mode)}
                      >
                        {mode === "light" ? "Light palette" : "Dark palette"}
                      </Button>
                    ))}
                  </div>
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-4">
                    {PALETTE_FIELDS.map(([token, label]) => (
                      <ColorControl
                        key={`${paletteTab}-${token}`}
                        id={`wallet-${paletteTab}-${token}`}
                        label={label}
                        value={appearance.palettes[paletteTab][token]}
                        onChange={(value) => updatePalette(paletteTab, token, value)}
                      />
                    ))}
                  </div>
                  <p className="mt-4 text-xs text-zinc-500">
                    Colors use #RRGGBB. Velo blocks publication when text, focus, or control
                    contrast is inaccessible.
                  </p>
                </div>
              </div>
            ) : null}

            {activeSection === "settings" ? (
              <>
                <div className="rounded-lg border bg-white p-5">
                  <h2 className="font-semibold">Modal and session behavior</h2>
                  <div className="mt-4 grid gap-4">
                    <SettingSwitch
                      label="Show install guidance"
                      checked={draft.showInstallLabel}
                      onCheckedChange={(checked) => updateDraft({ showInstallLabel: checked })}
                    />
                    <SettingSwitch
                      label="Hide unavailable wallets"
                      checked={draft.hideUnsupportedWallets}
                      onCheckedChange={(checked) =>
                        updateDraft({ hideUnsupportedWallets: checked })
                      }
                    />
                    <SettingSwitch
                      label="Restore the last session"
                      checked={draft.persistSession}
                      onCheckedChange={(checked) => updateDraft({ persistSession: checked })}
                    />
                  </div>
                </div>

                <div className="rounded-lg border bg-white p-5">
                  <Label htmlFor="wallet-origins">Allowed origins</Label>
                  <p className="mb-2 text-xs text-zinc-500">
                    One exact HTTP(S) origin per line. Paths and wildcards are rejected; maximum 20.
                  </p>
                  <Textarea
                    id="wallet-origins"
                    rows={5}
                    value={draft.allowedOrigins.join("\n")}
                    onChange={(event) =>
                      updateDraft({ allowedOrigins: parseOriginLines(event.target.value) })
                    }
                  />
                </div>

                {errors.length ? (
                  <Alert variant="destructive">
                    <AlertCircleIcon />
                    <AlertTitle>Fix before saving</AlertTitle>
                    <AlertDescription>
                      <ul className="list-disc pl-5">
                        {errors.map((error) => (
                          <li key={error}>{error}</li>
                        ))}
                      </ul>
                    </AlertDescription>
                  </Alert>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={handleSave}
                    disabled={
                      errors.length > 0 || saveState === "saving" || saveState === "publishing"
                    }
                  >
                    {saveState === "saving" ? "Saving…" : "Save draft"}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={handlePublish}
                    disabled={
                      !stored ||
                      errors.length > 0 ||
                      saveState === "unsaved" ||
                      saveState === "saving" ||
                      saveState === "publishing"
                    }
                  >
                    {saveState === "publishing" ? "Publishing…" : "Publish revision"}
                  </Button>
                  {stored?.activePublicationId ? (
                    <Button variant="outline" onClick={toggleEnabled}>
                      {stored.enabled ? "Disable integration" : "Enable integration"}
                    </Button>
                  ) : null}
                </div>

                {snippets && stored?.activePublicationId ? (
                  <div className="max-w-full min-w-0 overflow-hidden rounded-lg border bg-card p-4 text-card-foreground sm:p-5">
                    <div className="mb-4">
                      <h2 className="font-semibold">Integration instructions</h2>
                      <p className="text-sm text-muted-foreground">
                        Complete these steps after publishing a wallet revision.
                      </p>
                    </div>
                    <ol className="mb-5 grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-3">
                      <li className="min-w-0 rounded-md border bg-muted/30 p-3">
                        <p className="text-sm font-medium">1. Allow and publish</p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          Add each consuming app’s exact origin above, save the draft, then publish
                          the revision.
                        </p>
                      </li>
                      <li className="min-w-0 rounded-md border bg-muted/30 p-3">
                        <p className="text-sm font-medium">2. Mount one integration</p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          Choose HTML or React below. The public project key is safe to expose in
                          browser code.
                        </p>
                      </li>
                      <li className="min-w-0 rounded-md border bg-muted/30 p-3">
                        <p className="text-sm font-medium">3. Reload and verify</p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          Reload the consuming app after publishing. Velo loads the published
                          wallets and appearance during initialization.
                        </p>
                      </li>
                    </ol>
                    <Tabs defaultValue="html" className="max-w-full min-w-0">
                      <TabsList>
                        <TabsTrigger value="html">HTML</TabsTrigger>
                        <TabsTrigger value="react">React / Next.js</TabsTrigger>
                      </TabsList>
                      <SnippetTab
                        value="html"
                        code={snippets.html}
                        onCopy={() => copy(snippets.html, "HTML")}
                        hint="No package installation is required. Mount the element where the wallet controls should appear."
                      />
                      <SnippetTab
                        value="react"
                        code={snippets.react}
                        onCopy={() => copy(snippets.react, "React")}
                        hint="Keep this file behind a client boundary. WalletWidget includes connect, account, copy, disconnect, status, and error UI."
                        command={snippets.install}
                      />
                    </Tabs>
                    <p className="mt-4 text-xs text-muted-foreground">
                      CSP: <code className="break-all">{snippets.csp}</code>
                    </p>
                    <div className="mt-4 rounded-md border bg-muted/30 p-3 text-xs leading-relaxed">
                      <p>
                        <strong>Signing is optional.</strong> Basic connection does not request a
                        signature. Use <code>useVeloWallet()</code> only when your transaction or
                        authentication flow needs wallet methods.
                      </p>
                      <p className="mt-2 text-muted-foreground">
                        For authentication, sign a server-generated, expiring challenge—not a static
                        message. Signing inputs and signatures stay in the consuming browser and
                        never pass through Velo.
                      </p>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/wallet-preview/${stored.publicKey}`} target="_blank">
                          Open diagnostics <ExternalLinkIcon />
                        </Link>
                      </Button>
                      <span aria-live="polite" className="text-xs text-emerald-700">
                        {copied ? `${copied} copied` : ""}
                      </span>
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </div>

      <aside className="grid min-w-0 content-start gap-5 xl:sticky xl:top-6 xl:self-start">
        <div className="rounded-xl border bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">Live wallet preview</h2>
              <p className="mt-1 text-xs text-zinc-500">
                Draft preview only. No wallet request will be sent.
              </p>
            </div>
            <Badge variant="outline">Draft</Badge>
          </div>
          <div className="mt-4 flex flex-wrap gap-1" role="group" aria-label="Preview state">
            {(["disconnected", "connecting", "connected", "error"] as const).map((state) => (
              <Button
                key={state}
                type="button"
                size="sm"
                variant={previewState === state ? "secondary" : "ghost"}
                aria-pressed={previewState === state}
                onClick={() => setPreviewState(state)}
              >
                {state}
              </Button>
            ))}
          </div>
          <WalletAppearancePreview
            appearance={appearance}
            mode={draft.theme === "system" ? paletteTab : draft.theme}
            state={previewState}
            walletIds={draft.walletIds}
            network={draft.network}
            selectorLogo={draft.selectorLogo ?? "velo"}
            projectLogoUrl={project?.logoUrl}
          />
        </div>
        <div className="rounded-xl border bg-white p-5">
          <h2 className="font-semibold">Publication</h2>
          <dl className="mt-3 grid gap-2 text-sm">
            <div>
              <dt className="text-zinc-500">Public project key</dt>
              <dd className="mt-1 font-mono text-xs break-all">
                {stored?.publicKey ?? "Created on first save"}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500">Draft revision</dt>
              <dd>{stored?.draftRevision ?? 0}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">Published revision</dt>
              <dd>{stored?.publishedRevision ?? "Not published"}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">Status</dt>
              <dd>
                {stored?.enabled ? "Live" : stored?.activePublicationId ? "Disabled" : "Draft only"}
              </dd>
            </div>
          </dl>
          {stored?.publicKey ? (
            <Button
              variant="ghost"
              size="sm"
              className="mt-3"
              onClick={() => copy(stored.publicKey, "Project key")}
            >
              <CopyIcon />
              Copy key
            </Button>
          ) : null}
        </div>
      </aside>
    </section>
  );
}

function SettingSwitch({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Label>{label}</Label>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
    </div>
  );
}

function SnippetTab({
  value,
  code,
  hint,
  command,
  onCopy,
}: {
  value: string;
  code: string;
  hint: string;
  command?: string;
  onCopy: () => void;
}) {
  return (
    <TabsContent value={value} className="max-w-full min-w-0">
      <p className="mb-3 text-xs leading-relaxed break-words text-muted-foreground">{hint}</p>
      {command ? (
        <div className="mb-3 flex min-w-0 flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs">
          <span className="text-muted-foreground">Install:</span>
          <code className="min-w-0 break-all">{command}</code>
        </div>
      ) : null}
      <div className="relative max-w-full min-w-0">
        <pre className="w-full max-w-full min-w-0 overflow-x-auto rounded-md bg-zinc-950 p-4 pr-12 text-xs text-zinc-100">
          <code>{code}</code>
        </pre>
        <Button
          type="button"
          size="icon-sm"
          variant="secondary"
          className="absolute top-2 right-2"
          onClick={onCopy}
          aria-label={`Copy ${value} snippet`}
        >
          <CopyIcon />
        </Button>
      </div>
    </TabsContent>
  );
}

function AppearanceSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        wrapperClassName="mt-2"
      >
        {options.map(([optionValue, optionLabel]) => (
          <NativeSelectOption key={optionValue} value={optionValue}>
            {optionLabel}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}

function ColorControl({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const colorValue = /^#[0-9A-Fa-f]{6}$/.test(value) ? value : "#000000";
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="mt-2 flex gap-2">
        <input
          aria-label={`${label} color picker`}
          type="color"
          value={colorValue}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          className="h-9 w-11 cursor-pointer rounded-md border bg-white p-1"
        />
        <Input
          id={id}
          value={value}
          maxLength={7}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          className="font-mono text-xs"
          aria-invalid={!/^#[0-9A-Fa-f]{6}$/.test(value)}
        />
      </div>
    </div>
  );
}

function WalletAppearancePreview({
  appearance,
  mode,
  state,
  walletIds,
  network,
  selectorLogo,
  projectLogoUrl,
}: {
  appearance: ReturnType<typeof normalizeWalletAppearance>;
  mode: "light" | "dark";
  state: "disconnected" | "connecting" | "connected" | "error";
  walletIds: string[];
  network: WalletDraftConfig["network"];
  selectorLogo: WalletSelectorLogo;
  projectLogoUrl?: string;
}) {
  const palette = appearance.palettes[mode];
  const selectedWallets = WALLET_CATALOG.filter((wallet) => walletIds.includes(wallet.id));
  const activeWallet = selectedWallets[0];
  const fontFamilies = {
    system: "ui-sans-serif, system-ui, sans-serif",
    serif: "ui-serif, Georgia, serif",
    mono: "ui-monospace, SFMono-Regular, monospace",
  } as const;
  const buttonRadii = { square: "0px", rounded: "10px", pill: "999px" } as const;
  const modalRadii = { sm: "6px", md: "12px", lg: "16px" } as const;
  const shadows = {
    none: "none",
    sm: "0 4px 12px rgba(0,0,0,.12)",
    md: "0 18px 48px rgba(0,0,0,.22)",
  } as const;
  const padding = { sm: "7px 11px", md: "10px 16px", lg: "13px 20px" } as const;
  const triggerStyle: CSSProperties = {
    background:
      appearance.button.variant === "solid"
        ? palette.accent
        : appearance.button.variant === "outline"
          ? "transparent"
          : palette.surfaceMuted,
    border: `1px solid ${appearance.button.variant === "outline" ? palette.accent : palette.border}`,
    borderRadius: buttonRadii[appearance.button.radius],
    color: appearance.button.variant === "solid" ? palette.accentText : palette.accent,
    fontFamily: fontFamilies[appearance.fontFamily],
    fontSize: appearance.button.size === "sm" ? 13 : appearance.button.size === "lg" ? 16 : 14,
    fontWeight: 600,
    padding: padding[appearance.button.size],
  };
  const triggerLabel =
    state === "connecting" && activeWallet
      ? "Connecting…"
      : state === "connected" && activeWallet
        ? `${activeWallet.name} · Connected (preview)`
        : state === "error" && activeWallet
          ? "Try again (preview)"
          : appearance.buttonLabel || "Connect wallet";
  const statusMessage = !selectedWallets.length
    ? "Enable a wallet in the Wallets section to preview it here."
    : state === "error"
      ? "Preview: simulated connection rejection."
      : state === "connecting"
        ? `Preview: opening ${activeWallet?.name ?? "wallet"}.`
        : state === "connected"
          ? `Preview: simulated connection to ${activeWallet?.name ?? "wallet"}.`
          : "Choose a wallet to continue.";

  return (
    <div
      className="relative mt-4 grid min-h-[620px] place-items-center overflow-hidden rounded-xl border p-4 sm:p-6"
      style={{
        backgroundColor: palette.surfaceMuted,
        borderColor: palette.border,
        color: palette.text,
        fontFamily: fontFamilies[appearance.fontFamily],
        backgroundImage: `radial-gradient(circle at 1px 1px, ${palette.border} 1px, transparent 0)`,
        backgroundSize: "18px 18px",
      }}
    >
      <div
        className="grid w-full max-w-[390px] gap-4 rounded-2xl border p-5 sm:p-6"
        style={{
          background: palette.background,
          borderColor: palette.border,
          borderRadius: modalRadii[appearance.modal.radius],
          boxShadow: shadows[appearance.modal.shadow],
        }}
      >
        <header className="grid justify-items-center gap-3 text-center">
          {selectorLogo === "velo" ? (
            <img
              src={mode === "dark" ? "/velo-logo-dark.png" : "/velo-logo-light.png"}
              alt="Velo"
              width={132}
              height={41}
              className="max-h-16 w-[112px] object-contain"
            />
          ) : selectorLogo === "project" && projectLogoUrl ? (
            <img
              src={projectLogoUrl}
              alt="Project logo"
              width={132}
              height={64}
              className="max-h-16 w-[112px] object-contain"
            />
          ) : null}
          <div>
            <h3 className="text-lg font-semibold">Connect your wallet</h3>
            <p className="mt-1 text-xs" style={{ color: palette.mutedText }}>
              Stellar {network === "public" ? "Mainnet" : "Testnet"}
            </p>
          </div>
        </header>

        <button type="button" disabled style={triggerStyle}>
          {triggerLabel}
        </button>

        <section aria-label="Enabled Stellar wallets" className="grid gap-2">
          {selectedWallets.length ? (
            selectedWallets.map((item) => {
              const isActive = item.id === activeWallet?.id;
              const actionLabel =
                isActive && state === "connecting"
                  ? "Opening…"
                  : isActive && state === "connected"
                    ? "Connected"
                    : isActive && state === "error"
                      ? "Try again"
                      : "Continue";

              return (
                <div
                  key={item.id}
                  className="flex min-w-0 items-center gap-3 rounded-full border px-3 py-2.5"
                  style={{
                    borderColor: isActive ? palette.accent : palette.border,
                    background: palette.surface,
                    minHeight: 62,
                  }}
                >
                  <span
                    className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-full border bg-white p-1"
                    style={{ borderColor: palette.border }}
                  >
                    {WALLET_LOGOS[item.id] ? (
                      <img
                        src={WALLET_LOGOS[item.id]}
                        alt=""
                        width={32}
                        height={32}
                        className="size-full object-contain"
                      />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.name}</span>
                  <span
                    className="shrink-0 text-xs font-medium"
                    style={{ color: isActive ? palette.accent : palette.mutedText }}
                  >
                    {actionLabel}
                  </span>
                </div>
              );
            })
          ) : (
            <p
              className="rounded-xl border border-dashed p-4 text-center text-sm"
              style={{ borderColor: palette.border, color: palette.mutedText }}
            >
              No wallets selected yet.
            </p>
          )}
        </section>

        <div
          className="grid gap-3 border-t pt-3 text-center"
          style={{ borderColor: palette.border }}
        >
          <p
            aria-live="polite"
            className="min-h-5 text-xs"
            style={{ color: state === "error" ? palette.danger : palette.mutedText }}
          >
            {statusMessage}
          </p>
          <p className="text-xs" style={{ color: palette.mutedText }}>
            Powered by Velo Wallets
          </p>
        </div>
      </div>

      <span
        className="absolute right-4 bottom-4 rounded-full border px-3 py-1 text-[10px] font-medium sm:right-5 sm:bottom-5"
        style={{
          borderColor: palette.border,
          background: palette.background,
          color: palette.mutedText,
        }}
      >
        Preview only
      </span>
    </div>
  );
}
