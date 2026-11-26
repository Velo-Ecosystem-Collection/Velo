import { createHmac, timingSafeEqual } from "node:crypto";

import { createWalletJwt } from "@/core/auth/wallet-jwt";
import { env } from "@/core/config/env";
import { stellarConfig } from "@/core/config/stellar";
import { api } from "@repo/backend/convex/_generated/api";
import { verifyLiveTestnetProject } from "@/features/arc/server/registry-verification";
import { ConvexHttpClient } from "convex/browser";

import type { Id } from "@repo/backend/convex/_generated/dataModel";

function isTrustedRequest(rawBody: string, timestamp: string | null, signature: string | null) {
  const secret = process.env.VELO_ARC_TICKET_SECRET;
  const issuedAt = Number(timestamp);
  if (!secret || !timestamp || !signature || !Number.isSafeInteger(issuedAt)) return false;
  if (Math.abs(Date.now() / 1000 - issuedAt) > 60) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(signature, "hex");
  } catch {
    return false;
  }
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (
    !isTrustedRequest(
      rawBody,
      request.headers.get("x-velo-arc-timestamp"),
      request.headers.get("x-velo-arc-signature"),
    )
  ) {
    return Response.json({ active: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  if (!env.NEXT_PUBLIC_VELO_ARC_ENABLED) {
    return Response.json({ active: false }, { headers: { "Cache-Control": "no-store" } });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody) as unknown;
  } catch {
    return Response.json({ active: false }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  if (
    !body ||
    typeof body !== "object" ||
    !("account" in body) ||
    typeof body.account !== "string" ||
    !("projectId" in body) ||
    typeof body.projectId !== "string"
  ) {
    return Response.json({ active: false }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  if (!/^G[A-Z2-7]{55}$/.test(body.account) || body.projectId.length > 128) {
    return Response.json({ active: false }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const closesAt = Date.parse(process.env.VELO_ARC_EVENT_CLOSES_AT ?? "");
    if (!Number.isFinite(closesAt) || Date.now() >= closesAt || !stellarConfig.registryContractId) {
      return Response.json({ active: false }, { headers: { "Cache-Control": "no-store" } });
    }

    const convex = new ConvexHttpClient(env.NEXT_PUBLIC_CONVEX_URL);
    convex.setAuth(createWalletJwt(body.account));
    const project = await convex.query(api.projects.query.getById, {
      id: body.projectId as Id<"projects">,
    });
    if (
      !project ||
      (project.role !== "owner" && project.role !== "editor") ||
      project.status !== "registered" ||
      !project.registryProjectId
    ) {
      return Response.json({ active: false }, { headers: { "Cache-Control": "no-store" } });
    }

    const active = await verifyLiveTestnetProject({
      rpcUrl: stellarConfig.rpcUrl,
      registryContractId: stellarConfig.registryContractId,
      registryProjectId: project.registryProjectId,
      ownerAddress: project.ownerAddress,
      name: project.name,
      metadataHash: project.metadataHash,
    });
    return Response.json({ active }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[arc.session-check] access refresh failed", error);
    return Response.json({ active: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
