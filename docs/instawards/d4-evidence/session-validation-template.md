---
type: evidence-template
area: instawards
status: template
last_updated: 2026-09-26
deliverable: "4 — Integration & Validation Package"
---

# D4 participant and policy validation log

Copy this template to the reviewer package and fill it only with observed
Testnet results. Use stable aliases instead of personal details. Record no
wallet secrets, signed XDR, API keys, tokens, or authentication material.

## Session context

| Field | Observed value |
| --- | --- |
| Session date and time (UTC) | `TODO` |
| Testnet dashboard URL | `TODO` |
| Web deployment / source SHA | `TODO` |
| Convex deployment / source SHA | `TODO` |
| Facilitator alias | `TODO` |
| Reviewer alias | `TODO` |
| Session result | `not started` |

## Participants

Each row represents a distinct human participant. Do not use multiple wallets
for one person to satisfy the three-person requirement.

| Participant alias | Human participant confirmed | Project role exercised | Joined at (UTC) | Left at (UTC) |
| --- | --- | --- | --- | --- |
| `operator-1` | `TODO` | Owner | `TODO` | `TODO` |
| `validator-2` | `TODO` | Editor or viewer | `TODO` | `TODO` |
| `validator-3` | `TODO` | Editor or viewer | `TODO` | `TODO` |

## Policy setup and stored readback

Complete the five named demonstrations below. For each, record the exact
values shown before saving and the independently observed stored values
afterward. Use project aliases and sanitized evidence references. Do not count
a rejected save or an unverified UI success message.

| # | Required demonstration | Participant alias | Project alias | Role | Active contract set reviewed | Daily cap before → after | Per-wallet UTC-hour limit before → after | Save and stored readback | Request outcome and denial/no-exposure evidence | UTC time and evidence reference |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | App A owner reviews and activates; capture stored policy readback | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` |
| 2 | App B independently provisions, funds, and activates; capture readback | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` |
| 3 | Change whitelist, confirm stored set, then restore an allowed invocation | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` |
| 4 | Save hourly limit; verify one permitted request and a quota denial | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` |
| 5 | Save daily cap; verify one permitted request and a cap denial | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` |

For the initial managed activation, verify the suggested **10 XLM/day** cap,
**100 requests per wallet per UTC hour**, and the complete active linked
contract set. When there are no active linked contracts, verify that
sponsorship remains disabled. Record an owner enable action separately from
subsequent policy edits.

For each planned denial, retain the observed denial code and separate
readbacks proving no execution attempt and no reserved exposure were created.
Use fresh otherwise-valid requests so an earlier whitelist or daily-cap result
cannot stand in for the intended hourly-limit check. Restore the campaign policy
through the normal owner controls and record the acknowledged readback.

## Owner lifecycle and funding

| Funding scenario | Project alias | Provisioning state / time | Retry result / time | Funding transaction and ledger | Faucet result / cooldown check | Fresh balance and spendable amount | Activation and contract readback | Pause/resume result | Evidence reference |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Absent account; wallet funding uses `CreateAccount` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` |
| Existing account; wallet funding uses native `Payment` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` |
| Faucet owner authorization, uncertain response, and cooldown recheck | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` |

## Provisioning rollback proof

Run this check in the designated test deployment. Do not change the production
provisioning flag without separate explicit authorization. Verify that disabling
provisioning blocks new project provisioning and owner retries while existing
managed accounts retain signing, settlement/reconciliation, recovery, and owner
withdrawal access. Re-enable the test flag after the check and capture safe
configuration readback.

| Deployment alias | Flag disabled readback | New provisioning blocked | Retry blocked | Existing signing and settlement retained | Reconciliation/recovery retained | Owner withdrawal retained | Flag restored | Evidence reference |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` |

## Dedicated withdrawal check

Use a managed Testnet project separate from campaign accounts. Confirm the
authenticated owner's destination, consent expiry and context binding, no
outstanding commitments, preserved reserve and fee, maintenance pause, and
ledger settlement. Do not store the wallet signature, signed XDR, or consent
nonce.

| Project alias | Withdrawal amount | Owner destination confirmed | Consent bindings and expiry verified | Outstanding holds resolved | Pause acquired | Ledger hash / result | Sponsorship remains paused | Evidence reference |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` | `TODO` |

## Role and usability checks

| Check | Participant alias | Expected behavior | Observed result | UTC time | Evidence reference |
| --- | --- | --- | --- | --- | --- |
| Owner activation and pause/resume | `TODO` | Owner-only controls work | `TODO` | `TODO` | `TODO` |
| Editor policy edit | `TODO` | Allowed policy edit; cannot perform initial owner activation | `TODO` | `TODO` | `TODO` |
| Viewer access | `TODO` | Read-only; mutation controls unavailable | `TODO` | `TODO` | `TODO` |
| Keyboard navigation | `TODO` | Focus, activation, dialogs, and recovery are usable without a pointer | `TODO` | `TODO` | `TODO` |
| Failure and stale-data handling | `TODO` | Errors are sanitized; unavailable data is not presented as current/spendable | `TODO` | `TODO` | `TODO` |

## Attestation

| Role | Alias | Confirmed facts are first-hand and sanitized | Date (UTC) |
| --- | --- | --- | --- |
| Facilitator | `TODO` | `TODO` | `TODO` |
| Participant 2 | `TODO` | `TODO` | `TODO` |
| Participant 3 | `TODO` | `TODO` | `TODO` |

## Open issues

Record every failed, blocked, or unresolved check. Do not omit failed attempts
or describe an unverified outcome as successful.

- `TODO`
