export const MAX_WEBHOOK_BODY_BYTES = 1_048_576;

export class WebhookBodyTooLargeError extends Error {
  constructor() {
    super("Webhook request body exceeds the configured limit");
    this.name = "WebhookBodyTooLargeError";
  }
}

export async function readBoundedWebhookBody(
  request: Pick<Request, "body" | "headers">,
  maxBytes = MAX_WEBHOOK_BODY_BYTES,
): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new TypeError("maxBytes must be a non-negative safe integer");
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maxBytes) {
    throw new WebhookBodyTooLargeError();
  }

  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new WebhookBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
