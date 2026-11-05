import { Velo } from "@carts1024/velo-sdk";
import { NextResponse } from "next/server";

import { readBoundedWebhookBody, WebhookBodyTooLargeError } from "./body.ts";

export async function POST(request: Request) {
  const signature = request.headers.get("x-velo-signature");
  const secret = process.env.VELO_WEBHOOK_SECRET;

  if (!signature || !secret) {
    return new NextResponse("Missing signature or webhook secret configuration", { status: 400 });
  }

  // 1. Webhook verification requires the raw body as a string.
  // DO NOT call request.json() before verifying.
  let payload: string;
  try {
    payload = await readBoundedWebhookBody(request);
  } catch (error) {
    const status = error instanceof WebhookBodyTooLargeError ? 413 : 400;
    return new NextResponse("Invalid webhook request body", { status });
  }

  try {
    // 3. Verify signature using Velo SDK.
    const event = await Velo.webhooks.verify({
      payload,
      signature,
      secret,
    });

    console.log(`Verified webhook event: ${event.type}`);

    // 4. Handle events securely.
    switch (event.type) {
      case "payment.succeeded": {
        const paymentIntent = event.paymentIntent;
        console.log(`Payment succeeded! ID: ${paymentIntent.id}, Amount: ${paymentIntent.amount}`);
        // TODO: Unlock product access or fulfill order in database
        break;
      }
      case "payment.failed": {
        console.log(`Payment failed: ${event.paymentIntent.id}`);
        break;
      }
      default:
        console.log(`Unhandled webhook event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Signature verification failed:", error);
    return new NextResponse("Webhook signature verification failed", { status: 400 });
  }
}
