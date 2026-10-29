"use client";

import Link from "next/link";

import { LandingLogo } from "../landing-logo";

export function FooterSection() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t border-zinc-900 bg-zinc-950 px-6 py-12 text-zinc-500">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 md:flex-row">
        <LandingLogo />

        {/* copyright metadata */}
        <div className="text-center text-xs font-light text-zinc-600">
          &copy; {currentYear} Velo. The application operations platform for Stellar.
          <br />
          <span className="font-mono text-[10px] uppercase tracking-wider">
            Alpha · Stellar Testnet
          </span>
        </div>

        {/* minimal resource links */}
        <div className="flex items-center gap-6 font-mono text-xs text-zinc-500">
          <Link href="#features" className="transition-colors hover:text-zinc-300">
            Platform
          </Link>
          <Link href="#velo-pay" className="transition-colors hover:text-zinc-300">
            Velo Pay
          </Link>
          <Link href="/docs" className="transition-colors hover:text-zinc-300">
            Docs
          </Link>
          <Link
            href="https://stellar.org"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-zinc-300"
          >
            Stellar
          </Link>
        </div>
      </div>
    </footer>
  );
}
