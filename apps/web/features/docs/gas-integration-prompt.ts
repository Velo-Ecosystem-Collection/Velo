import { gasIntegrationSnippets } from "../projects/project-integration-guidance.ts";

export const gasIntegrationPrompt = `# Integrate Velo Gas Station into this project

You are modifying an existing application. First inspect the project and its instructions, then implement a safe Gas Station integration that fits its current architecture. Do not replace existing patterns with a new framework or service without a product decision.

## 1. Inspect the project first

- Read the repository's \`AGENTS.md\`, README, package/workspace manifests, and the instructions for the relevant application area.
- Identify the framework, package manager, Node.js/server runtime, browser wallet integration, authentication and authorization model, persistence layer, transaction construction and signing flow, and existing tests.
- Trace where the app builds and prepares Stellar Soroban transactions and how it associates them with a caller-owned operation.
- Reuse the existing route, validation, session, persistence, logging, and test patterns. Ask the user only for product decisions the repository cannot answer; otherwise make the smallest compatible implementation.

## 2. Understand the Gas Station boundary

Velo Gas Station is a Stellar **Testnet Soroban** fee-sponsorship service. The application builds and prepares an eligible transaction, and the user's wallet signs the inner transaction. A trusted application server uses the Velo SDK; Velo's relayer supplies the fee source and submits a FeeBump transaction. The relayer does not sign for the user.

Sponsorship only reserves fee exposure. It does not build or prepare the transaction, replace wallet signing, guarantee submission or ledger execution, or make an unresolved result successful. Gas SDK calls belong on a trusted Node.js server boundary.

## 3. Verify prerequisites and ownership

Before implementing or qualifying the flow, verify and report:

- The project's Testnet Gas policy is enabled, with a positive daily cap and positive hourly wallet quota.
- Every invoked Soroban contract is allowlisted.
- New projects queue a Velo-managed Testnet relayer automatically when managed provisioning is configured for the deployment. The owner sees its public address only after encrypted custody has been committed.
- The project owner funds the relayer, verifies a fresh balance, resumes it if paused, and explicitly reviews/enables sponsorship. Provisioning a relayer never enables sponsorship automatically; at least one active linked contract is required.
- If provisioning is disabled or the encryption configuration is unavailable, the Velo deployment operator must repair the deployment configuration. Never ask the integrator to paste a relayer secret into the dashboard or application.
- Existing manually configured relayers remain supported. Do not replace an existing account or move its funds automatically; managed custody never falls back to a legacy signer configuration after a decryption failure.
- The integrator has a Gas-scoped project API key and the exact Testnet Gas API origin paired with that policy.

Separate prerequisites the integrator can configure from those requiring the Velo project owner or deployment operator. Never invent credentials, project IDs, contract IDs, or deployment-specific values.

## 4. Verify and install a compatible SDK

- Use the repository's package manager and Node.js 18 or newer. The SDK is ESM-only and server-side.
- Before changing dependencies, inspect the selected published package version's package exports and actual entry point. Verify it exports \`Velo\`, \`VeloGasSubmissionUnknownError\`, and all five Gas methods: \`sponsor\`, \`submit\`, \`sponsorAndSubmit\`, \`getStatus\`, and \`waitForResult\`. Check the selected version, not merely the mutable \`latest\` or \`alpha\` label. Do not assume the default published version supports Gas.
- If the available published package does not expose the required API, stop before installation and report the version/export blocker. Offer an explicitly selected local package artifact from the Velo workspace, and wait for the user to choose that artifact before adding it. Do not silently switch to a source import, file dependency, or unpublished package.
- Use placeholders for API keys and deployment URLs in code, documentation, and test fixtures. Never include actual credentials.

## 5. Adapt to the host project

Use the project's existing trusted Node.js backend, server route, worker, or Node-compatible serverless function. Authenticate the user and authorize that user's operation and project before accepting or processing signed XDR. Keep the API key and signed XDR out of browser code and browser storage.

If the project is browser-only or runs on a non-Node server runtime, propose a small Node.js service or serverless function that preserves the existing client flow. Describe the boundary and tradeoffs, then ask before adding infrastructure or changing deployment configuration.

## 6. Implement the complete transaction workflow

1. Reuse the existing transaction builder and prepare an eligible Stellar Testnet transaction: a user-signed, non-FeeBump envelope containing exactly one Soroban \`invokeHostFunction\` operation. Do not invent a contract call or wallet method; adapt to the project's current Stellar SDK and wallet APIs.
2. Ask the user's connected wallet to sign the prepared inner transaction.
3. Send the signed XDR and a stable, caller-owned operation ID transiently to the project's authenticated application server over its existing request pattern.
4. Validate and bound the request before use, then call \`velo.gas.sponsorAndSubmit()\` from the server with an idempotency key derived from that stable operation ID and a deadline that fits the host's request deadline.
5. Return only the safe result fields the existing client needs. Keep the API key and signed XDR server-only.

The five Gas SDK methods have distinct behavior:

- \`sponsor(transactionXdr, options)\` reserves fee exposure and requires an idempotency key. It does not submit. If it times out before returning a reservation, retry only the exact same signed XDR with the same key.
- \`submit(params, options)\` performs the trusted submission handoff with the original signed XDR. It sends that XDR once and is not automatically retried.
- \`sponsorAndSubmit(transactionXdr, options)\` composes sponsorship and submission under one deadline and hands off the XDR at most once. Prefer this for the normal flow.
- \`getStatus(identity, options)\` sends only \`requestId\` and the inner \`transactionHash\`; use it to inspect or recover an operation without XDR.
- \`waitForResult(identity, options)\` performs bounded observation using identity-only status requests. It never sponsors, submits, or changes backend reconciliation.

Adapt and preserve these existing tested server-side integration snippets. They are compiled and exercised against deterministic mocked SDK transport in the Velo repository:

### Sponsor, submit, and recover an uncertain handoff

\`\`\`ts
${gasIntegrationSnippets.sponsorAndSubmit}
\`\`\`

### Recover or observe status by identity

\`\`\`ts
${gasIntegrationSnippets.statusRecovery}
\`\`\`

## 7. Preserve security and recovery behavior

- Keep \`VELO_GAS_API_KEY\` and \`VELO_GAS_BASE_URL\` in server-only environment configuration, separate from Checkout configuration. For Testnet, use \`VELO_GAS_ENV=testnet\` and the approved Testnet API origin. Authenticate and authorize the caller and operation before using a project key; do not rely on an untrusted operation ID as authorization.
- Bound the request body and validate operation IDs and XDR size/shape. Accept only the fields the route needs. Do not log signed XDR, API keys, or other secrets.
- Derive and reuse a stable idempotency identity for the same logical operation. Never create a replacement operation automatically after a timeout.
- Persist a durable, user-owned recovery record containing the operation ID and safe Gas identity (request ID plus inner transaction hash) and the state needed by existing application flows. Do not store the API key or put signed XDR in browser-visible or recovery/status responses.
- If submission may have crossed the network boundary but its result is unknown, catch \`VeloGasSubmissionUnknownError\`, save its recovery identity, and continue with \`getStatus(error.recovery)\` or bounded \`waitForResult()\`. Never resubmit the XDR after an uncertain handoff.
- Keep observation bounded by a call cap, total deadline, and the host platform's execution deadline. If the server cannot finish observing, persist the identity and let an authorized later request resume status-only observation.

## 8. Interpret results and retries correctly

- Only \`status === "succeeded"\` means success.
- \`claimed\`, \`submission_unknown\`, and \`submitted\` are unresolved/running states. Do not report them as success or failure; keep observing or return a recoverable pending state.
- \`failed\` and \`cancelled\` are terminal non-success results.
- \`actualFeeStroops: null\` means the actual fee is unknown, not zero. Preserve the distinction between the inner transaction hash and the relayer FeeBump outer hash.
- A \`contract_not_whitelisted\` denial requires a policy/contract change; do not retry unchanged. \`daily_cap_exceeded\` and \`wallet_rate_limited\` are policy denials and are not automatically retried. Retry sponsorship only according to the SDK rules and with the same signed XDR and idempotency key. Never interpret a timeout, provider error, reservation expiry, or local observation deadline as proof of chain failure.

## 9. Validate and report

- Add focused tests using the host project's existing test tools for authorization, bounded input, single handoff, idempotency, status-only recovery, unresolved/terminal result handling, and safe response fields. Mock transport in tests; never use real credentials or submit a live transaction as part of ordinary tests.
- Document placeholder environment variables, the explicit Velo deployment URL, prerequisites, and which actions require the Velo project owner or deployment operator.
- Run the relevant project checks and report what passed, what was mocked, any unmet prerequisites, and any remaining decisions. Clearly distinguish deterministic/mock verification from live Testnet evidence; do not claim a live transaction unless one was explicitly authorized and actually observed.

## Authoritative Velo references

- Repository Gas Station integration guide: https://github.com/Velo-Ecosystem-Collection/Velo/blob/main/docs/velo-gas-station.md
- SDK README: https://github.com/Velo-Ecosystem-Collection/Velo/blob/main/packages/velo-sdk/README.md
- Next.js App Router example: https://github.com/Velo-Ecosystem-Collection/Velo/tree/main/examples/nextjs-app-router
- Tested snippet source and deterministic coverage: https://github.com/Velo-Ecosystem-Collection/Velo/blob/main/apps/web/features/projects/project-integration-guidance.ts
`;
