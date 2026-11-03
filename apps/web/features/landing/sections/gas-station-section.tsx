"use client";

import { CheckCircle2, Copy, Terminal } from "lucide-react";
import { useState } from "react";

const gasStationSnippet = [
  'import { Velo, VeloGasSubmissionUnknownError } from "@carts1024/velo-sdk";',
  "",
  "function createGasClient(): Velo {",
  "  const apiKey = process.env.VELO_GAS_API_KEY?.trim();",
  "  const baseUrl = process.env.VELO_GAS_BASE_URL?.trim();",
  "",
  "  if (!apiKey || !baseUrl) {",
  '    throw new Error("Configure Gas Station on the server.");',
  "  }",
  "",
  "  return new Velo({ apiKey, baseUrl, timeoutMs: 10_000 });",
  "}",
  "",
  "export async function sponsorGas(",
  "  operationId: string,",
  "  signedTransactionXdr: string,",
  ") {",
  "  const stableOperationId = operationId.trim();",
  '  if (!stableOperationId) throw new Error("operationId is required.");',
  "",
  "  const velo = createGasClient();",
  "  try {",
  "    return await velo.gas.sponsorAndSubmit(signedTransactionXdr, {",
  "      idempotencyKey: `my-app-gas:${stableOperationId}`,",
  "      timeoutMs: 10_000,",
  "    });",
  "  } catch (error) {",
  "    if (!(error instanceof VeloGasSubmissionUnknownError)) throw error;",
  "    return velo.gas.getStatus(error.recovery, { timeoutMs: 5_000 });",
  "  }",
  "}",
].join("\n");

export function GasStationSection() {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(gasStationSnippet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section
      id="velo-gas-station"
      className="relative border-b border-zinc-900 bg-zinc-950 px-6 py-24 text-zinc-50"
    >
      <div className="mx-auto max-w-7xl">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12">
          <div className="flex flex-col gap-6 lg:col-span-5">
            <h2 className="font-mono text-xs tracking-widest text-zinc-500 uppercase">
              Velo Gas Station
            </h2>
            <h3 className="mb-2 text-3xl font-bold tracking-tight md:text-5xl">
              Sponsor eligible fees while users keep signing.
            </h3>
            <p className="text-sm leading-relaxed font-light text-zinc-400">
              On Stellar Testnet, your server can use Velo&apos;s SDK to have a managed relayer
              cover fees for eligible user-signed Soroban transactions. Project policy controls
              daily spend, wallet quotas, and contract allowlists.
            </p>

            <ul className="mt-2 flex flex-col gap-3 text-sm font-light text-zinc-300">
              <li className="flex items-center gap-3">
                <CheckCircle2 aria-hidden="true" size={16} className="shrink-0 text-zinc-400" />
                <span>Users sign the original transaction with their own wallet</span>
              </li>
              <li className="flex items-center gap-3">
                <CheckCircle2 aria-hidden="true" size={16} className="shrink-0 text-zinc-400" />
                <span>Apply project caps, wallet quotas, and the saved contract allowlist</span>
              </li>
              <li className="flex items-center gap-3">
                <CheckCircle2 aria-hidden="true" size={16} className="shrink-0 text-zinc-400" />
                <span>Recover uncertain submissions by status without resending the XDR</span>
              </li>
            </ul>

            <p className="font-mono text-xs leading-relaxed text-zinc-500">
              Testnet only during Velo&apos;s alpha · Keep API keys and SDK calls on your server
            </p>
          </div>

          <div className="relative lg:col-span-7">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-0 rounded-2xl bg-gradient-to-tr from-violet-950/20 to-zinc-800/10 blur-3xl"
            />

            <div className="relative z-10 w-full overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 font-mono text-xs shadow-2xl">
              <div className="flex items-center justify-between border-b border-zinc-900 bg-zinc-900/60 px-4 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <div
                    aria-hidden="true"
                    className="h-2.5 w-2.5 shrink-0 rounded-full bg-zinc-800"
                  />
                  <div
                    aria-hidden="true"
                    className="h-2.5 w-2.5 shrink-0 rounded-full bg-zinc-700"
                  />
                  <div
                    aria-hidden="true"
                    className="h-2.5 w-2.5 shrink-0 rounded-full bg-zinc-600"
                  />
                  <span className="ml-3 flex min-w-0 items-center gap-1.5 truncate text-[10px] text-zinc-500">
                    <Terminal aria-hidden="true" size={12} className="shrink-0 text-zinc-600" />
                    server/gas-station.ts
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="shrink-0 rounded p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
                  title="Copy snippet"
                  aria-label="Copy Gas Station server snippet"
                >
                  {copied ? (
                    <span className="font-sans text-[9px] font-semibold text-zinc-300">
                      Copied!
                    </span>
                  ) : (
                    <Copy aria-hidden="true" size={13} />
                  )}
                </button>
              </div>

              <div className="max-h-[380px] overflow-x-auto p-5 leading-6 text-zinc-300 select-text">
                <pre>
                  <code>{gasStationSnippet}</code>
                </pre>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
