import { createGasSponsorHandler } from "@/core/api/gas-route-handlers";
import { env } from "@/core/config/env";
import { withRouteTelemetry } from "@/core/observability";
import { ConvexHttpClient } from "convex/browser";

const convex = new ConvexHttpClient(env.NEXT_PUBLIC_CONVEX_URL);

export const POST = withRouteTelemetry(
  "gas.sponsor",
  createGasSponsorHandler({
    action: (reference, args) => convex.action(reference, args),
  }),
);
