import { getContractWebAuthDiscoveryConfig } from "@/core/auth/contract-wallet-auth";

export const runtime = "nodejs";

export function GET() {
  try {
    const config = getContractWebAuthDiscoveryConfig();
    const body = [
      `WEB_AUTH_FOR_CONTRACTS_ENDPOINT = "${config.endpoint}"`,
      `WEB_AUTH_CONTRACT_ID = "${config.contractId}"`,
      `SIGNING_KEY = "${config.signingKey}"`,
      "",
    ].join("\n");
    return new Response(body, {
      headers: {
        "access-control-allow-origin": "*",
        "cache-control": "no-store",
        "content-type": "text/plain; charset=utf-8",
      },
    });
  } catch {
    return new Response("SEP-45 Web Auth is not configured.\n", {
      status: 503,
      headers: { "access-control-allow-origin": "*", "content-type": "text/plain; charset=utf-8" },
    });
  }
}
