"use client";

import { ArrowRight, Cpu } from "lucide-react";
import Link from "next/link";

export function CTASection() {
  return (
    <section className="relative overflow-hidden border-b border-zinc-900 bg-zinc-950 px-6 py-32 text-center text-zinc-50">
      {/* Dynamic ambient background glow */}
      <div className="pointer-events-none absolute top-1/2 left-1/2 h-[300px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-tr from-zinc-900/10 via-zinc-800/5 to-zinc-900/10 blur-[120px]" />

      <div className="relative z-10 mx-auto flex max-w-4xl flex-col items-center">
        {/* Product scope badge */}
        <div className="mb-8 flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 font-mono text-xs tracking-tight text-zinc-400">
          <Cpu size={12} className="animate-pulse text-zinc-400" />
          <span>Start with Velo Pay · Testnet Alpha</span>
        </div>

        <h2 className="mb-6 max-w-2xl text-4xl leading-tight font-bold tracking-tight text-zinc-100 md:text-6xl">
          Build the Stellar app. Operate it with Velo.
        </h2>

        <p className="mb-10 max-w-xl text-base leading-relaxed font-light text-zinc-400 md:text-lg">
          Begin with a payment workflow on Testnet, then expand across Velo&apos;s application
          operations capabilities.
        </p>

        {/* Action button triggers */}
        <div className="flex w-full flex-col items-center justify-center gap-4 sm:w-auto sm:flex-row">
          <Link
            href="/dashboard"
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-white px-8 py-4 text-sm font-semibold text-zinc-950 shadow-[0_0_20px_rgba(255,255,255,0.15)] transition-all hover:scale-[1.02] hover:bg-zinc-200 sm:w-auto"
          >
            <span>Start on Testnet</span>
            <ArrowRight size={16} />
          </Link>
          <Link
            href="/docs"
            className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-8 py-4 text-sm font-semibold text-zinc-300 transition-all hover:bg-zinc-800 hover:text-zinc-100 sm:w-auto"
          >
            Read the Documentation
          </Link>
        </div>

        {/* Footnote details */}
        <div className="mt-16 flex flex-wrap items-center justify-center gap-2 font-mono text-xs text-zinc-600 select-none">
          <span>BUILD</span>
          <span className="text-zinc-800">•</span>
          <span>VERIFY</span>
          <span className="text-zinc-800">•</span>
          <span>OBSERVE</span>
          <span className="text-zinc-800">•</span>
          <span>PAY</span>
          <span className="text-zinc-800">•</span>
          <span>GAS STATION · TESTNET</span>
        </div>
      </div>
    </section>
  );
}
