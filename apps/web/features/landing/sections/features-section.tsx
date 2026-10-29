"use client";

import { Activity, Code2, Fingerprint, Network, WalletCards } from "lucide-react";

const features = [
  {
    icon: Code2,
    title: "Build",
    description: "SDKs, APIs, and workspaces for building Stellar apps.",
    badge: "Implemented",
  },
  {
    icon: Fingerprint,
    title: "Verify",
    description: "Confirm wallet authorization and official contract addresses.",
    badge: "Validation pending",
  },
  {
    icon: Activity,
    title: "Observe",
    description: "Track transactions and events. Deliver signed webhooks.",
    badge: "Qualification pending",
  },
  {
    icon: WalletCards,
    title: "Pay",
    description: "Host checkout and verify payment against the ledger.",
    badge: "E2E pending",
  },
  {
    icon: Network,
    title: "Settle",
    description: "Demo conversion and payouts with PDAX UAT.",
    badge: "UAT demo",
  },
];

function getBadgeClassName(badge: string) {
  if (badge === "Implemented") {
    return "border-zinc-300 bg-zinc-900 text-zinc-100";
  }

  if (badge.includes("pending")) {
    return "border-zinc-700/50 bg-zinc-900 text-zinc-300";
  }

  return "border-zinc-800 bg-zinc-900 text-zinc-500";
}

export function FeaturesSection() {
  return (
    <section
      id="features"
      className="relative border-b border-zinc-900 bg-zinc-950 px-6 py-24 text-zinc-50"
    >
      {/* Decorative gradient blur */}
      <div className="pointer-events-none absolute top-1/2 right-0 h-96 w-96 -translate-y-1/2 rounded-full bg-zinc-800/10 blur-[100px]" />

      <div className="mx-auto max-w-7xl">
        {/* Title Block */}
        <div className="mx-auto mb-16 max-w-5xl text-center">
          <h2 className="mb-3 font-mono text-xs tracking-widest text-zinc-500 uppercase">
            The Velo Platform
          </h2>
          <h3 className="mb-4 text-3xl font-bold tracking-tight md:text-4xl xl:text-5xl">
            <span className="block md:whitespace-nowrap">One application operations layer.</span>
            <span className="block md:whitespace-nowrap">Five connected capabilities.</span>
          </h3>
          <p className="text-base text-zinc-400">
            Start with Velo Pay, then use the broader platform as your Stellar application grows.
          </p>
        </div>

        {/* Feature Grid */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {features.map((item, idx) => {
            const Icon = item.icon;
            return (
              <div
                key={idx}
                className="group relative flex flex-col items-center rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-5 text-center backdrop-blur-sm transition-all duration-300 hover:border-zinc-700/60 hover:bg-zinc-900/50 hover:shadow-[0_4px_30px_rgba(0,0,0,0.4)]"
              >
                {/* Glow outline decoration */}
                <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-r from-white/0 to-zinc-400/0 transition-all duration-300 group-hover:from-white/5 group-hover:to-zinc-400/5" />

                <div className="mb-5 flex flex-col items-center gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-400 transition-all duration-300 group-hover:border-zinc-500/50 group-hover:bg-zinc-900/60 group-hover:text-zinc-100">
                    <Icon size={24} />
                  </div>
                  <span
                    className={
                      "w-fit max-w-full rounded-full border px-2 py-1 text-center font-mono text-[10px] leading-tight " +
                      getBadgeClassName(item.badge)
                    }
                  >
                    {item.badge}
                  </span>
                </div>

                <h4 className="mb-2 text-lg font-bold text-zinc-100 transition-colors group-hover:text-zinc-50">
                  {item.title}
                </h4>
                <p className="text-sm leading-relaxed font-light text-zinc-400">
                  {item.description}
                </p>
              </div>
            );
          })}
        </div>

        <p className="mx-auto mt-8 max-w-3xl text-center font-mono text-xs leading-relaxed text-zinc-500">
          Maturity labels describe current implementation and validation status. Verify covers
          wallet authorization and on-chain provenance—not code audits, legal identity, or project
          endorsement.
        </p>
      </div>
    </section>
  );
}
