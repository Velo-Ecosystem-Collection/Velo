"use client";

import { ArrowRight, Terminal } from "lucide-react";
import { useTheme } from "next-themes";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";

import type { PixelBlastProps } from "@repo/ui/components/ui-customs/pixel-blast/PixelBlast";

const PixelBlast = dynamic<PixelBlastProps>(
  () => import("@repo/ui/components/ui-customs/pixel-blast/PixelBlast"),
  { ssr: false },
);

export function HeroSection() {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const pixelColor = mounted && resolvedTheme === "light" ? "#18181b" : "#ffffff";
  const logoSrc = mounted && resolvedTheme === "light" ? "/iconv2-light.png" : "/iconv2.png";

  return (
    <section className="relative flex min-h-[90vh] flex-col justify-between overflow-hidden border-b border-border bg-background text-foreground">
      {/* Background PixelBlast Canvas */}
      <div className="pointer-events-auto absolute inset-0 z-0 opacity-80">
        <PixelBlast
          variant="circle"
          pixelSize={5}
          color={pixelColor}
          patternScale={3.5}
          patternDensity={1.1}
          pixelSizeJitter={0.3}
          enableRipples={true}
          rippleSpeed={0.35}
          rippleThickness={0.1}
          rippleIntensityScale={1.2}
          speed={0.4}
          edgeFade={0.3}
          transparent={true}
        />
      </div>

      {/* Floating Decorative Grid or Glow overlay */}
      <div className="hero-fade-overlay pointer-events-none absolute inset-0 z-10" />

      {/* Header / Mini Nav inside Hero */}
      <header className="relative z-20 mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-3">
          <img src={logoSrc} alt="Velo Logo" className="h-12 w-12 object-contain" />
          <div>
            <span className="font-sans text-2xl font-bold tracking-tight text-zinc-100">Velo</span>
          </div>
        </div>

        <nav className="flex items-center gap-4 sm:gap-6">
          <Link
            href="/docs"
            className="hidden text-sm font-medium text-zinc-400 transition-colors hover:text-zinc-100 sm:inline-block"
          >
            Docs
          </Link>
          <Link
            href="/dashboard"
            className="hidden text-sm font-medium text-zinc-400 transition-colors hover:text-zinc-100 sm:inline-block"
          >
            Dashboard
          </Link>
          <Link
            href="/debug"
            className="hidden text-sm font-medium text-zinc-400 transition-colors hover:text-zinc-100 sm:inline-block"
          >
            Debugger
          </Link>
          <Link
            href="/dashboard"
            className="rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 text-xs font-semibold text-zinc-300 transition-all hover:bg-zinc-800 sm:px-4 sm:py-1.5"
          >
            Launch Console
          </Link>
        </nav>
      </header>

      {/* Content Area */}
      <div className="relative z-20 mx-auto flex max-w-4xl flex-1 flex-col items-center justify-center px-6 py-12 text-center">
        {/* Micro-badge */}
        <div className="animate-fade-in mb-6 inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1 font-mono text-xs tracking-wide text-zinc-300 backdrop-blur-md">
          <Terminal size={14} className="text-zinc-400" />
          <span>Application operations for Stellar</span>
        </div>

        {/* Headings */}
        <h1 className="mb-6 text-4xl leading-none font-bold tracking-tight text-zinc-100 md:text-7xl">
          Build on Stellar. <br />
          <span className="bg-gradient-to-r from-zinc-950 to-zinc-500 dark:from-white dark:to-zinc-400 bg-clip-text text-transparent">
            Operate with Velo.
          </span>
        </h1>

        {/* Tagline */}
        <p className="mb-10 max-w-2xl text-lg leading-relaxed font-light text-zinc-400 md:text-xl">
          Build and operate Stellar apps without stitching the surrounding infrastructure together.
          Velo connects the workflows you use to build, verify, observe, pay, and settle.
        </p>

        {/* Actions */}
        <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Link
            href="/dashboard"
            className="group pointer-events-auto flex w-full items-center justify-center gap-2 rounded-xl bg-white px-8 py-4 text-sm font-semibold text-zinc-950 shadow-[0_0_25px_rgba(255,255,255,0.15)] transition-all hover:scale-[1.02] hover:bg-zinc-200 sm:w-auto"
          >
            <span>Start on Testnet</span>
            <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
          </Link>
          <Link
            href="#velo-pay"
            className="pointer-events-auto w-full rounded-xl border border-zinc-800 bg-zinc-900 px-8 py-4 text-sm font-semibold text-zinc-300 transition-all hover:bg-zinc-800 hover:text-zinc-100 sm:w-auto"
          >
            Explore Velo Pay
          </Link>
        </div>
      </div>

      {/* Alpha scope note */}
      <div className="pointer-events-none relative z-20 pb-8 text-center font-mono text-[10px] tracking-widest text-zinc-600 uppercase select-none">
        Alpha software for Stellar Testnet · Capabilities and availability may change
      </div>
    </section>
  );
}
