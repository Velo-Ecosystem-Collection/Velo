"use client";

import { Activity, FileCode, Wallet } from "lucide-react";

const steps = [
  {
    number: "01",
    icon: FileCode,
    title: "Build the workflow",
    description: "Connect your application to a supported Velo API or server-side SDK workflow.",
  },
  {
    number: "02",
    icon: Wallet,
    title: "Request authorization",
    description: "Let the user authorize the supported Stellar operation through their wallet.",
  },
  {
    number: "03",
    icon: Activity,
    title: "Track the outcome",
    description: "Carry transaction state and on-chain provenance back into your application.",
  },
];

export function HowItWorksSection() {
  return (
    <section className="relative border-b border-zinc-900 bg-zinc-950 px-6 py-24 text-zinc-50">
      <div className="mx-auto max-w-7xl">
        {/* Title block */}
        <div className="mx-auto mb-20 max-w-2xl text-center">
          <h2 className="mb-3 font-mono text-xs tracking-widest text-zinc-500 uppercase">
            How Velo Works
          </h2>
          <h3 className="mb-4 text-3xl font-bold tracking-tight md:text-5xl">
            From application action to on-chain outcome.
          </h3>
          <p className="text-sm font-light text-zinc-400">
            Keep the operational steps around a supported Stellar transaction connected to your
            application.
          </p>
        </div>

        {/* Steps display */}
        <div className="relative grid grid-cols-1 gap-12 md:grid-cols-2 lg:grid-cols-3">
          {/* Connector Line (Desktop) */}
          <div className="absolute top-16 right-[15%] left-[15%] z-0 hidden h-[1px] border-t border-dashed border-zinc-800 bg-gradient-to-r from-zinc-800 via-zinc-700/50 to-zinc-800 lg:block" />

          {steps.map((item, idx) => {
            const Icon = item.icon;
            const animationDelay = `${idx * 0.8}s`;

            return (
              <div key={idx} className="group relative z-10 flex flex-col items-center text-center">
                {/* Step Circle with Icon */}
                <div
                  className="how-it-works-step-icon mb-6 flex h-16 w-16 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 text-zinc-400 shadow-[0_0_15px_rgba(0,0,0,0.3)] transition-all duration-300 group-hover:border-zinc-500/50 group-hover:bg-zinc-900/60 group-hover:text-zinc-100"
                  style={{ animationDelay }}
                >
                  <Icon size={24} />
                </div>

                {/* Step Number Badge */}
                <span
                  className="how-it-works-step-number mb-3 bg-gradient-to-b from-zinc-700 to-zinc-900 bg-clip-text font-mono text-5xl font-extrabold text-transparent select-none"
                  style={{ animationDelay }}
                >
                  {item.number}
                </span>

                <h4 className="mb-2 text-xl font-bold text-zinc-100">{item.title}</h4>
                <p className="max-w-sm text-sm leading-relaxed font-light text-zinc-400">
                  {item.description}
                </p>
              </div>
            );
          })}
        </div>

        <p className="mt-16 text-center text-sm font-light text-zinc-500">
          Velo handles the surrounding application workflow while Stellar remains the system of
          record.
        </p>
      </div>
    </section>
  );
}
