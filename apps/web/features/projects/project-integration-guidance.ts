export const gasIntegrationSnippets = {
  sponsorAndSubmit: `import {
  Velo,
  VeloGasSubmissionUnknownError,
  type GasSubmitResult,
} from "@carts1024/velo-sdk";

const GAS_TIMEOUT_MS = 10_000;
const STATUS_TIMEOUT_MS = 5_000;

function createGasClient(): Velo {
  const apiKey = process.env.VELO_GAS_API_KEY?.trim();
  const baseUrl = process.env.VELO_BASE_URL?.trim();

  if (!apiKey || !baseUrl) {
    throw new Error("Configure VELO_GAS_API_KEY and VELO_BASE_URL on the server.");
  }

  return new Velo({ apiKey, baseUrl, timeoutMs: GAS_TIMEOUT_MS });
}

export async function sponsorAndSubmitGas(
  operationId: string,
  signedTransactionXdr: string,
): Promise<{ operationId: string; result: GasSubmitResult }> {
  const stableOperationId = operationId.trim();
  if (!stableOperationId) throw new Error("operationId is required.");

  const velo = createGasClient();

  try {
    const result = await velo.gas.sponsorAndSubmit(signedTransactionXdr, {
      // Derive this from the caller-owned operation ID and reuse it on recovery/replay.
      idempotencyKey: \`my-app-gas:\${stableOperationId}\`,
      timeoutMs: GAS_TIMEOUT_MS,
    });

    // sponsorAndSubmit() hands off the signed XDR at most once.
    return { operationId: stableOperationId, result };
  } catch (error) {
    if (!(error instanceof VeloGasSubmissionUnknownError)) throw error;

    // Persist this identity with operationId in your durable server store.
    // Recovery is identity-only: never submit signedTransactionXdr again.
    const result = await velo.gas.getStatus(error.recovery, {
      timeoutMs: STATUS_TIMEOUT_MS,
    });

    return { operationId: stableOperationId, result };
  }
}`,
  statusRecovery: `import {
  Velo,
  type GasExecutionIdentity,
  type GasSubmitResult,
} from "@carts1024/velo-sdk";

const GAS_TIMEOUT_MS = 10_000;

function createGasClient(): Velo {
  const apiKey = process.env.VELO_GAS_API_KEY?.trim();
  const baseUrl = process.env.VELO_BASE_URL?.trim();

  if (!apiKey || !baseUrl) {
    throw new Error("Configure VELO_GAS_API_KEY and VELO_BASE_URL on the server.");
  }

  return new Velo({ apiKey, baseUrl, timeoutMs: GAS_TIMEOUT_MS });
}

export async function recoverGasStatus(
  operationId: string,
  identity: GasExecutionIdentity,
  observeUntilTerminal = false,
): Promise<{ operationId: string; result: GasSubmitResult }> {
  const velo = createGasClient();
  const result = observeUntilTerminal
    ? await velo.gas.waitForResult(identity, {
        // Optional bounded observation; this still sends identity only.
        timeoutMs: GAS_TIMEOUT_MS,
        maxAttempts: 6,
        initialDelayMs: 250,
        maxDelayMs: 2_000,
      })
    : await velo.gas.getStatus(identity, {
        // getStatus() posts requestId + transactionHash, never XDR.
        timeoutMs: 5_000,
      });

  return { operationId, result };
}`,
} as const;

export const gasIntegrationGuideHref =
  "https://github.com/Velo-Ecosystem-Collection/Velo/blob/main/docs/instawards/Velo-Instawards-Deliverable-3-Integration-Guide.md";

export const gasExampleHref =
  "https://github.com/Velo-Ecosystem-Collection/Velo/tree/main/examples/nextjs-app-router";
