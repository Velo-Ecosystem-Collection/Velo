import migrations from "@convex-dev/migrations/convex.config.js";
import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
  env: {
    UPSTASH_REDIS_REST_URL: v.optional(v.string()),
    UPSTASH_REDIS_REST_TOKEN: v.optional(v.string()),
    VELO_RATE_LIMIT_SCOPE_SECRET: v.optional(v.string()),
    VELO_ENABLE_RATE_LIMIT_BENCHMARK: v.optional(v.string()),
    VELO_CONVEX_TELEMETRY_ENABLED: v.optional(v.string()),
    VELO_UI_TELEMETRY_INTAKE_SECRET: v.optional(v.string()),
    VELO_PLAYGROUND_RATE_LIMIT_SECRET: v.optional(v.string()),
    VELO_PLAYGROUND_PERSISTENCE_SECRET: v.optional(v.string()),
    VELO_STELLAR_NETWORK: v.optional(v.union(v.literal("testnet"), v.literal("public"))),
    VELO_MAINNET_USDC_ISSUER: v.optional(v.string()),
    VELO_DEPLOYMENT_ENVIRONMENT: v.optional(
      v.union(v.literal("development"), v.literal("preview"), v.literal("production")),
    ),
  },
});

app.use(migrations);

export default app;
