# Changelog

All notable changes to the Velo SDK will be documented in this file.

## [0.1.0-alpha.3] - 2026-09-23

### Added

- Testnet Gas sponsorship with `velo.gas.sponsor()` and the composed
  `sponsorAndSubmit()` workflow.
- Identity-based `submit()`, `getStatus()`, and bounded `waitForResult()` APIs
  with replay-safe recovery for uncertain submission outcomes.
- Typed Gas execution states, policy errors, bounded retries, cancellation,
  and redacted recovery identities.
- Optional durable `PaymentIntent.correlationId` for end-to-end payment
  journey lookup.
- Optional `RequestOptions.traceparent` propagation for existing W3C traces.

### Changed

- Publish the package as ESM JavaScript with TypeScript declarations and an
  explicit public `alpha` dist-tag.
- Document server-only Gas usage, Testnet scope, idempotency, and safe status
  recovery.

## [0.1.0-alpha.2] - 2026-07-02

### Added

- **Velo Client**: Class-based SDK client (`Velo`) with simple initialization: `new Velo({ apiKey })`.
- **Checkout Sessions**: Creation of checkout links via `velo.checkout.sessions.create()`.
- **Payment Intents**: Retrieve and list payment intents with cursor pagination support and project scoping.
- **Webhook Verification**: Secure HMAC-SHA256 signature validation with clock skew/tolerance checking using `Velo.webhooks.verify()`.
- **Typed Errors**: Custom error classes (`VeloAPIError`, `VeloAuthError`, `VeloRateLimitError`, `VeloValidationError`) matching API status codes.
- **Idempotency**: Support for client-supplied `Idempotency-Key` headers on payment session creation.
- **E2E Tests**: End-to-end test suite verifying payment flows.

### Changed

- **Package Rename**: Renamed package from `@velo/sdk` to `@carts1024/velo-sdk` and updated examples and documentation.
