---
type: reference
area: repository
status: current
last_updated: 2026-08-31
source_of_truth: repository
---

# Glossary

| Term | Meaning in Velo |
| --- | --- |
| PaymentIntent | Durable Convex record representing a merchant payment or billing top-up through hosted checkout. |
| In-house anchor | Payment route whose receiver is the Velo project owner's Stellar address. |
| PDAX anchor | Payment route that resolves a PDAX deposit address/currency and optional memo before checkout. |
| VeloRegistry | Soroban contract that stores project identity, owner, metadata hash, and official contract IDs. |
| VeloPayAccess | Soroban contract that reads Registry state and stores payment activation and legacy checkout credits. |
| Display balance / mirror | Non-authoritative PayAccess credit display written by a dedicated mirror authority; Convex ledgers remain authoritative for commercial entitlements. |
| Convex | Velo's application backend/database/runtime for queries, mutations, actions, HTTP ingress, and scheduled workers. |
| Journey correlation ID | Durable opaque ID used to connect payment, provider, worker, webhook, and UI stages. |
| Provider operation | Durable PDAX trade or fiat-withdrawal record with request fingerprint, provider key, leases, and recovery state. |
| Exactly-once observable | Velo's reliability target for convergent recorded transitions; it does not mean exactly-once transport to PDAX, Stellar, or merchant endpoints. |
| Soroban | Stellar smart-contract platform/runtime used by the Registry and PayAccess contracts. |
| UAT | PDAX sandbox environment used by the current settlement demonstration. |
| SEP-10-style | The current wallet authentication flow uses Stellar WebAuth challenge transaction conventions; it is not a claim that full SEP-10 infrastructure is implemented. |
| Playground | Contract loading, specification, simulation, exact-XDR review, Testnet invocation, and evidence UI/API. |

