"use client";

import { useState } from "react";

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asset, setAsset] = useState<"USDC" | "native">("USDC");

  const handleCheckout = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asset,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create checkout session");
      }
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else {
        throw new Error("No checkout URL returned");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        maxWidth: "600px",
        margin: "80px auto",
        padding: "40px 24px",
        borderRadius: "16px",
        background: "#18181b",
        border: "1px solid #27272a",
        boxShadow: "0 4px 30px rgba(0, 0, 0, 0.4)",
      }}
    >
      <h1 style={{ fontSize: "28px", fontWeight: "700", marginBottom: "8px" }}>
        Velo Checkout Integration
      </h1>
      <p style={{ color: "#a1a1aa", fontSize: "14px", marginBottom: "24px" }}>
        Next.js App Router & `@carts1024/velo-sdk` demo store.
      </p>

      <div style={{ marginBottom: "24px" }}>
        <span
          style={{
            display: "block",
            fontSize: "12px",
            fontWeight: "600",
            color: "#a1a1aa",
            marginBottom: "8px",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Select Asset
        </span>
        <div style={{ display: "flex", gap: "12px" }}>
          <button
            onClick={() => setAsset("USDC")}
            style={{
              flex: 1,
              padding: "12px",
              borderRadius: "8px",
              background: asset === "USDC" ? "#27272a" : "#09090b",
              color: asset === "USDC" ? "#ffffff" : "#a1a1aa",
              border: asset === "USDC" ? "1px solid #3f3f46" : "1px solid #27272a",
              fontWeight: "600",
              cursor: "pointer",
              transition: "all 0.2s",
            }}
          >
            USDC
          </button>
          <button
            onClick={() => setAsset("native")}
            style={{
              flex: 1,
              padding: "12px",
              borderRadius: "8px",
              background: asset === "native" ? "#27272a" : "#09090b",
              color: asset === "native" ? "#ffffff" : "#a1a1aa",
              border: asset === "native" ? "1px solid #3f3f46" : "1px solid #27272a",
              fontWeight: "600",
              cursor: "pointer",
              transition: "all 0.2s",
            }}
          >
            XLM
          </button>
        </div>
      </div>

      <div
        style={{
          padding: "16px",
          borderRadius: "8px",
          background: "#09090b",
          border: "1px solid #27272a",
          marginBottom: "24px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
          <span>Order #1001</span>
          <strong>{asset === "USDC" ? "10.00 USDC" : "10.00 XLM"}</strong>
        </div>
        <span style={{ fontSize: "12px", color: "#71717a" }}>1x Velo Pro Subscription</span>
      </div>

      {error && (
        <div
          style={{
            padding: "12px 16px",
            borderRadius: "6px",
            background: "#450a0a",
            border: "1px solid #7f1d1d",
            color: "#fca5a5",
            fontSize: "14px",
            marginBottom: "24px",
          }}
        >
          {error}
        </div>
      )}

      <button
        onClick={handleCheckout}
        disabled={loading}
        style={{
          width: "100%",
          padding: "14px",
          borderRadius: "8px",
          background: "#ffffff",
          color: "#09090b",
          border: "none",
          fontWeight: "600",
          fontSize: "15px",
          cursor: loading ? "not-allowed" : "pointer",
          opacity: loading ? 0.7 : 1,
          transition: "all 0.2s",
        }}
      >
        {loading ? "Redirecting to Velo Pay..." : `Pay with ${asset === "USDC" ? "USDC" : "XLM"}`}
      </button>
    </div>
  );
}
