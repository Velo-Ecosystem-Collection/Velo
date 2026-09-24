"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "../ui/button";

export function CopyButton({
  value,
  label,
  visibleText,
  size = "icon-xs",
  className,
}: {
  value: string;
  label: string;
  visibleText?: string;
  size?: "icon-xs" | "xs" | "sm";
  className?: string;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");

  useEffect(() => {
    if (status === "idle") {
      return;
    }

    const timeout = window.setTimeout(() => setStatus("idle"), 2_000);
    return () => window.clearTimeout(timeout);
  }, [status]);

  async function copy() {
    const copyValue = value.startsWith("/")
      ? new URL(value, window.location.origin).toString()
      : value;

    try {
      await navigator.clipboard.writeText(copyValue);
      setStatus("copied");
    } catch {
      setStatus("error");
    }
  }

  const statusLabel =
    status === "copied"
      ? `${label} copied`
      : status === "error"
        ? `Could not copy ${label}`
        : label;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size={size}
        className={className}
        onClick={() => void copy()}
        aria-label={`Copy ${label}`}
        title={`Copy ${label}`}
      >
        {status === "copied" ? <CheckIcon /> : <CopyIcon />}
        {size !== "icon-xs" ? (
          <span>{status === "copied" ? "Copied" : (visibleText ?? "Copy")}</span>
        ) : null}
      </Button>
      <span className="sr-only" aria-live="polite">
        {status === "idle" ? "" : statusLabel}
      </span>
    </>
  );
}
