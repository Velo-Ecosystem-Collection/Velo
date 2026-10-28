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
    let touchStart: {
      y: number;
      target: EventTarget | null;
      section: HTMLElement | null;
    } | null = null;

    const finishNavigation = () => {
      isNavigating = false;
      if (navigationTimeout !== undefined) {
        window.clearTimeout(navigationTimeout);
        navigationTimeout = undefined;
      }
      document.removeEventListener("scrollend", finishNavigation);
    };

    const getSections = () =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          ".landing-container > section, .landing-container > footer",
        ),
      );

    const getCurrentSection = () => {
      const sections = getSections();
      const activeSection = sections.find((section) => section.getBoundingClientRect().bottom > 1);

      return activeSection ?? sections.at(-1) ?? null;
    };

    const getAdjacentSection = (direction: number, currentSection: HTMLElement | null) => {
      const sections = getSections();
      const activeIndex = currentSection ? sections.indexOf(currentSection) : -1;
      const currentIndex = activeIndex < 0 ? sections.length - 1 : activeIndex;

      return sections[currentIndex + direction] ?? null;
    };

    const hasRemainingSectionContent = (direction: number, currentSection: HTMLElement | null) => {
      if (!currentSection) return false;

      const bounds = currentSection.getBoundingClientRect();
      if (bounds.height <= window.innerHeight + 1) return false;

      return direction > 0 ? bounds.bottom > window.innerHeight + 1 : bounds.top < -1;
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
      document.addEventListener("scrollend", finishNavigation);
      const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth";
      section.scrollIntoView({ behavior, block: "start" });
      navigationTimeout = window.setTimeout(finishNavigation, 1400);
    };

    const handleScrollProgress = () => {
      if (!isNavigating) return;

      if (navigationTimeout !== undefined) window.clearTimeout(navigationTimeout);
      navigationTimeout = window.setTimeout(finishNavigation, 180);
    };

    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;

      const direction = event.deltaY > 0 ? 1 : -1;
      if (isNavigating) {
        event.preventDefault();
        return;
      }
      if (canScrollTarget(event.target, direction)) return;
      const currentSection = getCurrentSection();
      if (hasRemainingSectionContent(direction, currentSection)) return;

      const nextSection = getAdjacentSection(direction, currentSection);
      if (!nextSection) return;

      event.preventDefault();
      navigateToSection(nextSection);
    };

    const handleTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      touchStart = touch
        ? { y: touch.clientY, target: event.target, section: getCurrentSection() }
        : null;
    };

    const handleTouchEnd = (event: TouchEvent) => {
      const touch = event.changedTouches[0];
      if (!touch || !touchStart) return;

      const deltaY = touchStart.y - touch.clientY;
      const startTarget = touchStart.target;
      const currentSection = touchStart.section;
      touchStart = null;

      if (Math.abs(deltaY) < 4 || isNavigating) return;

      const direction = deltaY > 0 ? 1 : -1;
      if (canScrollTarget(startTarget, direction)) return;
      if (hasRemainingSectionContent(direction, currentSection)) return;

      const nextSection = getAdjacentSection(direction, currentSection);
      if (nextSection) navigateToSection(nextSection);
    };

    const handleTouchCancel = () => {
      touchStart = null;
    };

    window.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });
    window.addEventListener("touchcancel", handleTouchCancel, { passive: true });
    document.addEventListener("scroll", handleScrollProgress, { passive: true });

    return () => {
      root.classList.remove("landing-scroll-snap");
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", handleTouchCancel);
      document.removeEventListener("scroll", handleScrollProgress);
      document.removeEventListener("scrollend", finishNavigation);
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
