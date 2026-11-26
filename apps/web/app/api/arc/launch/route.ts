import { createHmac, randomUUID } from "node:crypto";

import { env } from "@/core/config/env";
import { stellarConfig } from "@/core/config/stellar";
import { verifyLiveTestnetProject } from "@/features/arc/server/registry-verification";
import { api } from "@repo/backend/convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";

import type { Id } from "@repo/backend/convex/_generated/dataModel";

type LaunchTicket = {
  iss: "velo";
  sub: string;
  projectId: string;
  registryProjectId: number;
  projectName: string;
  jti: string;
  iat: number;
  exp: number;
  eventClosesAt: number;
};

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

function encodeBase64Url(value: Buffer | string) {
  return Buffer.from(value).toString("base64url");
}

function launchConfiguration() {
  const secret = process.env.VELO_ARC_TICKET_SECRET;
  const arcUrlValue = process.env.VELO_ARC_URL;
  const closesAtValue = process.env.VELO_ARC_EVENT_CLOSES_AT;
  if (!secret || Buffer.byteLength(secret) < 32 || !arcUrlValue || !closesAtValue) return null;

  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(closesAtValue)) {
    return null;
  }
  const eventClosesAt = Date.parse(closesAtValue);
  if (!Number.isSafeInteger(eventClosesAt) || eventClosesAt <= Date.now()) return null;

  let arcUrl: URL;
  try {
    arcUrl = new URL(arcUrlValue);
  } catch {
    return null;
  }
  if (
    arcUrl.protocol !== "https:" &&
    !(arcUrl.protocol === "http:" && arcUrl.hostname === "localhost")
  )
    return null;
  return { secret, arcUrl, eventClosesAt };
}

function createLaunchTicket(payload: LaunchTicket, secret: string) {
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = createHmac("sha256", secret).update(encodedPayload).digest();
  return `${encodedPayload}.${encodeBase64Url(signature)}`;
}

function walletAddressFromJwt(token: string) {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1] || "", "base64url").toString("utf8"),
    ) as {
      sub?: unknown;
    };
    return typeof payload.sub === "string" && /^G[A-Z2-7]{55}$/.test(payload.sub)
      ? payload.sub
      : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  if (!env.NEXT_PUBLIC_VELO_ARC_ENABLED) return jsonError("Velo Arc is not enabled.", 404);

  const configuration = launchConfiguration();
  if (!configuration) return jsonError("Velo Arc launch is not configured for this event.", 503);

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return jsonError("Sign in to Velo first.", 401);
  const accountAddress = walletAddressFromJwt(authorization.slice("Bearer ".length));
  if (!accountAddress) return jsonError("Sign in with a Velo wallet account first.", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid launch request.", 400);
  }
  const projectId =
    body && typeof body === "object" && "projectId" in body && typeof body.projectId === "string"
      ? body.projectId
      : null;
  if (!projectId || projectId.length > 128) return jsonError("Select a Velo project first.", 400);

  try {
    const convex = new ConvexHttpClient(env.NEXT_PUBLIC_CONVEX_URL);
    convex.setAuth(authorization.slice("Bearer ".length));
    const project = await convex.query(api.projects.query.getById, {
      id: projectId as Id<"projects">,
    });
    if (!project || (project.role !== "owner" && project.role !== "editor")) {
      return jsonError("Owner or editor access is required for this project.", 403);
    }
    if (project.status !== "registered" || !project.registryProjectId) {
      return jsonError("This project must be registered on Testnet before opening Arc.", 403);
    }
    if (!stellarConfig.registryContractId) {
      return jsonError("The Testnet project registry is not configured.", 503);
    }

    const matchesRegistry = await verifyLiveTestnetProject({
      rpcUrl: stellarConfig.rpcUrl,
      registryContractId: stellarConfig.registryContractId,
      registryProjectId: project.registryProjectId,
      ownerAddress: project.ownerAddress,
      name: project.name,
      metadataHash: project.metadataHash,
    });
    if (!matchesRegistry)
      return jsonError("The project does not match the live Testnet registry.", 403);

    const now = Math.floor(Date.now() / 1000);
    const eventClosesAt = Math.floor(configuration.eventClosesAt / 1000);
    const payload: LaunchTicket = {
      iss: "velo",
      sub: accountAddress,
      projectId,
      registryProjectId: project.registryProjectId,
      projectName: project.name,
      jti: randomUUID(),
      iat: now,
      exp: Math.min(now + 60, eventClosesAt),
      eventClosesAt,
    };
    const ticket = createLaunchTicket(payload, configuration.secret);
    configuration.arcUrl.searchParams.set("launch_ticket", ticket);
    return Response.json(
      { launchUrl: configuration.arcUrl.toString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[arc.launch] launch ticket creation failed", error);
    return jsonError("Velo could not verify this project for Arc.", 503);
  }
}
