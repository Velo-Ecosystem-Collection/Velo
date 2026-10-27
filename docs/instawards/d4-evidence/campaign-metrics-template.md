---
type: evidence-template
area: instawards
status: template
last_updated: 2026-09-26
deliverable: "4 — Integration & Validation Package"
---

# D4 campaign metrics worksheet

Copy this worksheet into the reviewer package after the Testnet campaign. Fill
it from sanitized request logs, backend execution records, ledger receipts, and
the campaign manifest. Do not estimate missing counts from transaction rows.
Keep the raw numerator and denominator beside every percentage. A zero or
missing denominator is `not measured`, never a pass.

## Per-dApp and combined counts

| Cohort | Unique eligible operations | First-attempt successes | Eventual unique successes | Admitted operations | Sponsored API attempts | Retries | Successful settled FeeBumps | Authorized API calls | Successful authorized responses | All API calls | Planned denials | Unexpected failures | Unresolved operations | Evidence references |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| App A | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` |
| App B | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` |
| Combined | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` |

Count API attempts and retries from request-level evidence. The campaign JSON
records one operation outcome; its `attempted` count is not a request-attempt
count. Count an operation once in eventual outcomes even if it has replays or
recovery calls. Never count a retry, replay, denial, direct bypass, or unresolved
submission as another unique success.

## Rates and decision accuracy

| Measure | Numerator | Denominator | Rate | Target | Evidence references |
| --- | ---: | ---: | ---: | --- | --- |
| Sponsorship acceptance | Eligible unique operations admitted | Unique eligible operations | `TODO` | ≥95% | `TODO` |
| Signing/submission success | Unique admitted operations with successful settled FeeBump | Unique admitted operations | `TODO` | ≥95% | `TODO` |
| Authorized API success | Successful responses for normal authorized traffic | Authorized API calls, with planned denials excluded and listed above | `TODO` | ≥95% | `TODO` |
| All-traffic API success | Successful API responses | All API calls, with planned denials shown separately | `TODO` | Report raw rate | `TODO` |
| Rate-limit decisions correct | Correct allow/deny decisions | Rate-limit checks | `TODO` | 100% | `TODO` |
| Whitelist decisions correct | Correct allow/deny decisions | Whitelist checks | `TODO` | 100% | `TODO` |

Report first-attempt and eventual success separately. Preserve the denominator
and cohort definition when a transaction is denied by design. Do not remove
unexpected failures or unresolved operations to improve a rate. Investigate
any mismatch between the SDK result, backend settlement, and ledger receipt
before counting a successful execution.

## Verified campaign acceptance

Only count a success after backend settlement, exact fee-source/fee agreement,
and a successful Testnet ledger receipt are independently confirmed. The local
campaign recorder's candidate count is not this verified count.

| Acceptance check | Verified result | Evidence reference |
| --- | --- | --- |
| App A unique settled FeeBumps | `TODO` | `TODO` |
| App B unique settled FeeBumps | `TODO` | `TODO` |
| Combined unique settled FeeBumps (minimum 50; target 60) | `TODO` | `TODO` |
| Distinct human participants (minimum 3) | `TODO` | `TODO` |
| At least five explorer receipts opened across both apps and three participants | `TODO` | `TODO` |
| Replay attempts excluded from the unique-success total | `TODO` | `TODO` |

## Reconciliation

| Check | Result | Evidence reference |
| --- | --- | --- |
| Every counted success has a unique inner and outer hash | `TODO` | `TODO` |
| Backend status, inner success, actual fee, and charged fee agree | `TODO` | `TODO` |
| Fee source is the project's expected relayer | `TODO` | `TODO` |
| Testnet explorer receipts open and identify the expected ledger outcome | `TODO` | `TODO` |
| Denials have no execution attempt and no reserved exposure | `TODO` | `TODO` |
| Pending, unknown, or unresolved outcomes are excluded from successes | `TODO` | `TODO` |
| Relayer funding, reserves, liabilities, and Gas commitments reconcile | `TODO` | `TODO` |

Do not include API keys, bearer tokens, JWTs, wallet signatures, seed phrases,
signed XDR, private environment values, or unredacted provider responses.
