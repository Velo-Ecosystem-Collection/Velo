import { Velo } from "@carts1024/velo-sdk";
export async function verifyVeloWebhook(
  rawBody, // untouched result of request.text()
  signatureHeader, // request.headers.get("x-velo-signature")
  secret,
) {
  return Velo.webhooks.verify({
    payload: rawBody,
    signature: signatureHeader,
    secret,
    toleranceSeconds: 300,
  });
}
