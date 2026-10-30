import { ArrowRight, Award } from "lucide-react";
import Link from "next/link";

export function InstawardsSection() {
  return (
    <section
      aria-labelledby="insta-award-title"
      className="relative overflow-hidden border-b border-zinc-900 bg-zinc-950 px-6 py-24 text-zinc-50"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-0 h-96 w-96 -translate-y-1/2 rounded-full bg-violet-500/10 blur-[120px]"
      />

      <div className="relative mx-auto grid max-w-7xl grid-cols-1 items-center gap-12 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="mx-auto flex aspect-square w-full max-w-xs flex-col items-center justify-center gap-5 rounded-full border border-zinc-800 bg-zinc-900/50 text-center shadow-[0_0_80px_rgba(139,92,246,0.08)]">
          <Award aria-hidden="true" className="h-14 w-14 text-violet-300" strokeWidth={1.25} />
          <div>
            <p className="font-mono text-xs tracking-[0.3em] text-zinc-400 uppercase">Stellar</p>
            <p className="mt-2 text-xl font-semibold tracking-tight text-zinc-100">Instawards</p>
          </div>
        </div>

        <div className="max-w-2xl">
          <p className="mb-4 font-mono text-xs tracking-widest text-violet-300 uppercase">
            Stellar Development Foundation · Instawards
          </p>
          <h2
            id="insta-award-title"
            className="mb-5 text-3xl font-bold tracking-tight text-zinc-100 md:text-5xl"
          >
            Velo was awarded through Instawards.
          </h2>
          <p className="mb-8 max-w-xl text-base leading-relaxed font-light text-zinc-400 md:text-lg">
            The award supported Velo&apos;s work on Gas Station, a managed Testnet fee-sponsorship
            service for Stellar applications.
          </p>
          <Link
            href="#gas-station"
            className="group inline-flex items-center gap-2 text-sm font-semibold text-zinc-100 transition-colors hover:text-violet-200"
          >
            Explore Gas Station
            <ArrowRight
              aria-hidden="true"
              className="h-4 w-4 transition-transform group-hover:translate-x-1"
            />
          </Link>
        </div>
      </div>
    </section>
  );
}
