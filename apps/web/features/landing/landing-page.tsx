"use client";

import { useEffect } from "react";

import "./landing-page.css";
import { CTASection } from "./sections/cta-section";
import { DeveloperSection } from "./sections/developer-section";
import { FeaturesSection } from "./sections/features-section";
import { FooterSection } from "./sections/footer-section";
import { HeroSection } from "./sections/hero-section";
import { HowItWorksSection } from "./sections/how-it-works-section";

export function LandingPage() {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("landing-scroll-snap");
    return () => root.classList.remove("landing-scroll-snap");
  }, []);

  return (
    <main className="landing-container flex min-h-screen flex-col">
      {/* Hero section with WebGL dot-matrix background */}
      <HeroSection />

      {/* Feature matrix grids */}
      <FeaturesSection />

      {/* Workflow step timeline */}
      <HowItWorksSection />

      {/* Smart contract developer showcase */}
      <DeveloperSection />

      {/* Conversion footer section */}
      <CTASection />

      {/* Base copyright details */}
      <FooterSection />
    </main>
  );
}
