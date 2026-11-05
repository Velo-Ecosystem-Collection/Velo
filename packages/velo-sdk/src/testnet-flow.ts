import { execFileSync } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";

import { Velo } from "./client.ts";

const PROJECT_ID = "j97102bbzrfdaabs3s05g1624h89k054";

async function run() {
  console.log("🚀 Starting Velo SDK E2E local verification flow...");

  // 1. Generate a temporary API Key using Convex CLI
  console.log("Generating a temporary API key for project demopay...");
  const rawOutput = execFileSync(
    "npx",
    [
      "convex",
      "run",
      "projects/mutation:generateApiKeyInternal",
      JSON.stringify({ id: PROJECT_ID, label: "E2E SDK Test" }),
    ],
    { cwd: "../../apps/web", encoding: "utf8" },
  );

  // Extract token using regex matching tk_live_[a-f0-9]{32}
  const match = rawOutput.match(/tk_live_[a-f0-9]{32}/);
  if (!match) {
    throw new Error("Failed to extract a temporary API key from Convex CLI output");
  }
  const apiKey = match[0];
  console.log("Generated a temporary API key.");

  // 2. Initialize Velo client
  const velo = new Velo({
    apiKey,
    environment: "testnet",
    baseUrl: "http://localhost:3000",
  });

  // 3. Create a checkout session
  console.log("Creating checkout session...");
  const session = await velo.checkout.sessions.create({
    amount: "10.00",
    asset: "USDC",
    description: "SDK Verification Order #1001",
    successUrl: "http://localhost:3000/pay/success",
    cancelUrl: "http://localhost:3000/pay/cancel",
  });

  console.log("Checkout session created successfully:");
  console.log(`- ID: ${session.id}`);
  console.log(`- Status: ${session.status}`);
  console.log(`- Checkout URL: ${session.checkoutUrl}`);

  if (!session.checkoutUrl || !session.checkoutUrl.startsWith("http://localhost:3000/pay/")) {
    throw new Error("Invalid checkout URL format");
  }

  // 4. Retrieve the payment intent using the SDK
  console.log(`Retrieving payment intent ${session.id}...`);
  const retrieved = await velo.paymentIntents.retrieve(session.id);
  console.log(`Retrieved status: ${retrieved.status}`);
  if (retrieved.status !== "created") {
    throw new Error(`Expected status to be 'created', got: ${retrieved.status}`);
  }

  // 5. Transition to pending using Convex CLI
  console.log("Simulating customer opening the checkout (transition to pending)...");
  execFileSync(
    "npx",
    [
      "convex",
      "run",
      "payment_intents/mutations:updateStatus",
      JSON.stringify({ paymentIntentId: session.id, status: "pending" }),
    ],
    { cwd: "../../apps/web" },
  );

  const pendingRetrieved = await velo.paymentIntents.retrieve(session.id);
  console.log(`Retrieved status after opening checkout: ${pendingRetrieved.status}`);
  if (pendingRetrieved.status !== "pending") {
    throw new Error(`Expected status to be 'pending', got: ${pendingRetrieved.status}`);
  }

  // 6. Transition to paid using Convex CLI (simulates ledger verification success)
  console.log("Simulating on-chain payment success (transition to paid)...");
  execFileSync(
    "npx",
    [
      "convex",
      "run",
      "payment_intents/mutations:markVerifiedPaid",
      JSON.stringify({
        paymentIntentId: session.id,
        txHash: "c8731ea2a4fd43d0221b4c0eb5687c098e6bfcb6a58dbb4d01d698a0a8064cd9",
      }),
    ],
    { cwd: "../../apps/web" },
  );

  const paidRetrieved = await velo.paymentIntents.retrieve(session.id);
  console.log(`Retrieved status after payment verified: ${paidRetrieved.status}`);
  if (paidRetrieved.status !== "paid") {
    throw new Error(`Expected status to be 'paid', got: ${paidRetrieved.status}`);
  }

  // 7. Verify listing payment intents
  console.log("Listing payment intents...");
  const list = await velo.paymentIntents.list({ limit: 5 });
  console.log(`Found ${list.data.length} payment intents in list.`);
  const found = list.data.some((item) => item.id === session.id);
  if (!found) {
    throw new Error("Created session not found in list response");
  }

  // 8. Simulate webhook verification
  console.log("Simulating and verifying webhook signature...");
  const secret = `whsec_${randomBytes(32).toString("hex")}`;
  const payloadObj = {
    id: randomUUID(),
    type: "payment.succeeded",
    test: true,
    sentAt: new Date().toISOString(),
    project: {
      id: PROJECT_ID,
      name: "DemoPay",
      slug: "demopay",
    },
    paymentIntent: {
      id: session.id,
      amount: "10.00",
      asset: "USDC",
      status: "paid",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };

  const payload = JSON.stringify(payloadObj);
  const timestamp = Math.floor(Date.now() / 1000);
  const signaturePayload = `${timestamp}.${payload}`;
  const hmac = createHmac("sha256", secret);
  hmac.update(signaturePayload);
  const hash = hmac.digest("hex");
  const signatureHeader = `t=${timestamp},v1=${hash}`;

  const verifiedEvent = await Velo.webhooks.verify({
    payload,
    signature: signatureHeader,
    secret,
  });

  if (verifiedEvent.type === "payment.succeeded") {
    console.log("Webhook verified successfully:");
    console.log(`- Event ID: ${verifiedEvent.id}`);
    console.log(`- Event Type: ${verifiedEvent.type}`);
    console.log(`- Payment Intent ID: ${verifiedEvent.paymentIntent.id}`);
    console.log(`- Payment Intent Status: ${verifiedEvent.paymentIntent.status}`);

    if (verifiedEvent.paymentIntent.status !== "paid") {
      throw new Error("Webhook verification returned incorrect status");
    }
  } else {
    throw new Error(`Expected payment.succeeded event, got: ${verifiedEvent.type}`);
  }

  console.log("🎉 Velo SDK local e2e integration flow completed successfully!");
}

run().catch((err) => {
  console.error("❌ E2E verification failed:", err);
  process.exit(1);
});
