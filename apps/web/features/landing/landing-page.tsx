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

    let isNavigating = false;
    let navigationTimeout: number | undefined;
    let touchStart: { y: number; target: EventTarget | null } | null = null;

    const getSections = () =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          ".landing-container > section, .landing-container > footer",
        ),
      );

    const getAdjacentSection = (direction: number) => {
      const sections = getSections();
      const activeIndex = sections.findIndex(
        (section) => section.getBoundingClientRect().bottom > 1,
      );
      const currentIndex = activeIndex < 0 ? sections.length - 1 : activeIndex;

      return sections[currentIndex + direction] ?? null;
    };

    const canScrollTarget = (target: EventTarget | null, direction: number) => {
      let element = target instanceof HTMLElement ? target : null;

      while (element && element !== document.body) {
        const overflowY = window.getComputedStyle(element).overflowY;
        const canScrollVertically =
          (overflowY === "auto" || overflowY === "scroll") &&
          element.scrollHeight > element.clientHeight;

        if (canScrollVertically) {
          const atTop = element.scrollTop <= 0;
          const atBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - 1;

          if ((direction > 0 && !atBottom) || (direction < 0 && !atTop)) {
            return true;
          }
        }

        element = element.parentElement;
      }

      return false;
    };

    const navigateToSection = (section: HTMLElement) => {
      isNavigating = true;
      const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth";
      section.scrollIntoView({ behavior, block: "start" });
      navigationTimeout = window.setTimeout(() => {
        isNavigating = false;
      }, 850);
    };

    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;

      const direction = event.deltaY > 0 ? 1 : -1;
      if (isNavigating) {
        event.preventDefault();
        return;
      }
      if (canScrollTarget(event.target, direction)) return;

      const nextSection = getAdjacentSection(direction);
      if (!nextSection) return;

      event.preventDefault();
      navigateToSection(nextSection);
    };

    const handleTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      touchStart = touch ? { y: touch.clientY, target: event.target } : null;
    };

    const handleTouchEnd = (event: TouchEvent) => {
      const touch = event.changedTouches[0];
      if (!touch || !touchStart) return;

      const deltaY = touchStart.y - touch.clientY;
      const startTarget = touchStart.target;
      touchStart = null;

      if (Math.abs(deltaY) < 4 || isNavigating) return;

      const direction = deltaY > 0 ? 1 : -1;
      if (canScrollTarget(startTarget, direction)) return;

      const nextSection = getAdjacentSection(direction);
      if (nextSection) navigateToSection(nextSection);
    };

    window.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      root.classList.remove("landing-scroll-snap");
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchend", handleTouchEnd);
      if (navigationTimeout !== undefined) window.clearTimeout(navigationTimeout);
    };
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
