import type { WebhookEvent, VerifyWebhookParams } from "./types.ts";

import { VeloWebhookSignatureVerificationError } from "./errors.ts";

const EVENT_TYPES = new Set([
  "project.registered",
  "project.updated",
  "transaction.succeeded",
  "transaction.failed",
  "payment.created",
  "payment.succeeded",
  "payment.failed",
  "payment_access.activated",
  "payment.access_activated",
  "contract.event",
  "settlement.quote.created",
  "settlement.trade.executed",
  "settlement.withdrawal.pending",
  "settlement.withdrawal.succeeded",
  "settlement.withdrawal.failed",
  "provider.pdax.event.received",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasString(value: Record<string, unknown>, key: string): boolean {
  return typeof value[key] === "string";
}

function hasNumber(value: Record<string, unknown>, key: string): boolean {
  return typeof value[key] === "number" && Number.isFinite(value[key]);
}

function requireShape(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new VeloWebhookSignatureVerificationError(`Invalid webhook event: ${message}`);
  }
}

function parseWebhookEvent(payload: string): WebhookEvent {
  const parsed: unknown = JSON.parse(payload);
  requireShape(isRecord(parsed), "payload must be an object");

  if (parsed.version === undefined) parsed.version = "1";
  requireShape(parsed.version === "1", `unsupported version ${String(parsed.version)}`);
  requireShape(hasString(parsed, "id"), "id must be a string");
  requireShape(
    hasString(parsed, "type") && EVENT_TYPES.has(parsed.type as string),
    "unsupported type",
  );
  requireShape(typeof parsed.test === "boolean", "test must be a boolean");
  requireShape(hasString(parsed, "sentAt"), "sentAt must be a string");
  requireShape(isRecord(parsed.project), "project must be an object");
  requireShape(
    hasString(parsed.project, "id") &&
      hasString(parsed.project, "registryProjectId") &&
      hasString(parsed.project, "name") &&
      hasString(parsed.project, "slug"),
    "project fields must be strings",
  );

  const type = parsed.type as string;
  if (type.startsWith("payment.") || type === "payment_access.activated") {
    requireShape(isRecord(parsed.paymentIntent), "paymentIntent must be an object");
    for (const key of [
      "id",
      "amount",
      "asset",
      "merchantName",
      "status",
      "createdAt",
      "updatedAt",
    ]) {
      requireShape(hasString(parsed.paymentIntent, key), `paymentIntent.${key} must be a string`);
    }
  } else if (type === "contract.event") {
    requireShape(
      hasString(parsed, "contractId") && hasString(parsed, "transactionHash"),
      "contract identifiers must be strings",
    );
    requireShape(
      hasNumber(parsed, "ledger") && isRecord(parsed.event),
      "contract event fields are invalid",
    );
    requireShape(
      hasString(parsed.event, "id") &&
        hasString(parsed.event, "topic") &&
        hasString(parsed.event, "type") &&
        hasString(parsed.event, "observedAt"),
      "contract event metadata is invalid",
    );
  } else if (type.startsWith("transaction.")) {
    requireShape(
      hasString(parsed, "transactionHash") && hasNumber(parsed, "ledger"),
      "transaction fields are invalid",
    );
    requireShape(
      parsed.status === "success" || parsed.status === "failed",
      "transaction status is invalid",
    );
  } else if (type.startsWith("project.")) {
    requireShape(
      hasNumber(parsed, "ledger") &&
        hasString(parsed, "metadataHash") &&
        hasString(parsed, "status"),
      "project fields are invalid",
    );
  } else if (type === "settlement.quote.created") {
    requireShape(isRecord(parsed.quote), "quote must be an object");
    for (const key of [
      "id",
      "side",
      "quoteCurrency",
      "baseCurrency",
      "quantity",
      "expiresAt",
      "status",
    ])
      requireShape(hasString(parsed.quote, key), `quote.${key} must be a string`);
    requireShape(
      hasNumber(parsed.quote, "price") && hasNumber(parsed.quote, "totalAmount"),
      "quote amounts must be numbers",
    );
  } else if (type === "settlement.trade.executed") {
    requireShape(
      isRecord(parsed.trade) &&
        hasNumber(parsed.trade, "orderId") &&
        hasString(parsed.trade, "quoteId"),
      "trade fields are invalid",
    );
  } else if (type.startsWith("settlement.withdrawal.")) {
    requireShape(
      isRecord(parsed.withdrawal) && hasString(parsed.withdrawal, "withdrawalId"),
      "withdrawal fields are invalid",
    );
  } else if (type === "provider.pdax.event.received") {
    requireShape(
      parsed.provider === "pdax" &&
        hasString(parsed, "eventId") &&
        hasString(parsed, "eventType") &&
        "rawEvent" in parsed,
      "provider event fields are invalid",
    );
  }

  return parsed as WebhookEvent;
}

/**
 * Verifies a Velo webhook signature using the Web Crypto API.
 * This is fully compatible with both browser/Edge and Node.js environments.
 * If signature verification fails, it throws a VeloWebhookSignatureVerificationError.
 *
 * @param params Object containing payload, signature, secret, and optional toleranceSeconds.
 * @returns A promise resolving to the parsed and typed WebhookEvent.
 * @throws {VeloWebhookSignatureVerificationError} If the verification fails.
 */
export async function verifyWebhookSignature(params: VerifyWebhookParams): Promise<WebhookEvent> {
  if (typeof params !== "object" || params === null) {
    throw new VeloWebhookSignatureVerificationError("Webhook verification parameters are required");
  }

  const { payload, signature: signatureHeader, secret, toleranceSeconds = 300 } = params;

  if (typeof signatureHeader !== "string" || signatureHeader === "") {
    throw new VeloWebhookSignatureVerificationError("Missing signature header");
  }

  if (typeof secret !== "string" || secret === "") {
    throw new VeloWebhookSignatureVerificationError("Missing webhook signing secret");
  }

  if (typeof payload !== "string") {
    throw new VeloWebhookSignatureVerificationError("Webhook payload must be a string");
  }

  if (
    typeof toleranceSeconds !== "number" ||
    !Number.isFinite(toleranceSeconds) ||
    toleranceSeconds < 0
  ) {
    throw new VeloWebhookSignatureVerificationError(
      "Timestamp tolerance must be a finite non-negative number",
    );
  }

  if (signatureHeader.length > 512) {
    throw new VeloWebhookSignatureVerificationError("Invalid signature header format");
  }

  const parts = signatureHeader.split(",");
  let timestampStr: string | undefined;
  let signature: string | undefined;

  for (const part of parts) {
    const equalIndex = part.indexOf("=");
    if (equalIndex === -1) continue;
    const key = part.slice(0, equalIndex).trim();
    const val = part.slice(equalIndex + 1).trim();

    if (key === "t") {
      if (timestampStr !== undefined) {
        throw new VeloWebhookSignatureVerificationError("Invalid signature header format");
      }
      timestampStr = val;
    }
    if (key === "v1") {
      if (signature !== undefined) {
        throw new VeloWebhookSignatureVerificationError("Invalid signature header format");
      }
      signature = val;
    }
  }

  if (
    timestampStr === undefined ||
    signature === undefined ||
    !/^(?:0|[1-9][0-9]*)$/.test(timestampStr) ||
    !/^[0-9a-f]{64}$/.test(signature)
  ) {
    throw new VeloWebhookSignatureVerificationError("Invalid signature header format");
  }

  const timestamp = Number(timestampStr);
  if (!Number.isSafeInteger(timestamp)) {
    throw new VeloWebhookSignatureVerificationError("Invalid timestamp in header");
  }

  // This freshness window limits old replays; consumers must still deduplicate delivery IDs.
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > toleranceSeconds) {
    throw new VeloWebhookSignatureVerificationError(
      "Signature timestamp expired or from the future",
    );
  }

  const signaturePayload = `${timestamp}.${payload}`;

  try {
    const encoder = new TextEncoder();
    const secretKeyData = encoder.encode(secret);
    const signaturePayloadData = encoder.encode(signaturePayload);

    // Import secret key for HMAC SHA-256
    const cryptoKey = await globalThis.crypto.subtle.importKey(
      "raw",
      secretKeyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );

    const verified = await globalThis.crypto.subtle.verify(
      "HMAC",
      cryptoKey,
      hexToArrayBuffer(signature),
      signaturePayloadData,
    );

    if (!verified) {
      throw new VeloWebhookSignatureVerificationError("Signature mismatch");
    }

    return parseWebhookEvent(payload);
  } catch (err: unknown) {
    if (err instanceof VeloWebhookSignatureVerificationError) {
      throw err;
    }
    throw new VeloWebhookSignatureVerificationError("Signature verification failed");
  }
}

function hexToArrayBuffer(value: string): ArrayBuffer {
  const buffer = new ArrayBuffer(value.length / 2);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return buffer;
}
