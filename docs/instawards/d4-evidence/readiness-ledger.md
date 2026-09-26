---
type: evidence-ledger
area: instawards
status: in-progress
last_updated: 2026-09-26
deliverable: "4 — Integration & Validation Package"
---

# D4 readiness ledger

**Decision reaffirmed at 2026-09-26 15:04 UTC: NO-GO for production campaign transactions.**
At 13:53 UTC, the production recovery action verified Talambagv2's custody key
under the row's original context, migrated the encrypted envelope to
`prod:agreeable-salmon-748`, and verified the migrated envelope. A fresh
readback confirms the same public address, one ready Testnet record, disabled
sponsorship, and no maintenance lock. The owner confirms sponsorship remains
paused. No Testnet transaction or funds movement occurred. Production source
provenance remains unverified and the live campaign gates remain open. See
[`20260926T135422Z-production-talambagv2-custody-context-recovery.json`](20260926T135422Z-production-talambagv2-custody-context-recovery.json),
[`20260926T130430Z-talambagv2-owner-confirmation.json`](20260926T130430Z-talambagv2-owner-confirmation.json),
and ADR-0005. The earlier mismatch and pre-recovery observations remain
historical; do not use them as current status. No sponsorship resume is
authorized by this recovery.
At 14:00 UTC, redaction scanning parsed all 57 evidence JSON files then present,
including the recovery record; no recognized secret-shaped values or
prohibited secret/custody field names were found, and historical D2/D3 hashes
are unchanged. See
[`20260926T140058Z-evidence-redaction-scan.json`](20260926T140058Z-evidence-redaction-scan.json).
At 14:35 UTC, the production D3 preflight parsed both replacement XDRs,
confirmed distinct hashes and Testnet RPC, but remained incomplete. The
operator snapshot returned `Project not found`; provenance returned `Invalid
provenance scope`. A private comparison confirmed the configured D2 project
scope does not match Talambagv2; the deployment name and production environment
do match. The report also flags signer readiness and funding as unverified,
the allowed invocation as policy-denied, the denied target as allowlisted, the
invocation wallet as mismatched, and both XDRs as expired. No transaction was
submitted. See
[`20260926T143530Z-production-preflight.json`](20260926T143530Z-production-preflight.json).
At 14:40 UTC, the redaction scan parsed 59 prior evidence JSON files, found no
recognized secret-shaped values or prohibited secret/custody field names, and
confirmed historical D2/D3 report hashes are unchanged. See
[`20260926T144055Z-evidence-redaction-scan.json`](20260926T144055Z-evidence-redaction-scan.json).
At 15:02 UTC, after the operator updated the production D2 project scope,
snapshot availability and deployment identity passed. Twelve preflight checks
passed. The remaining blocks are deployment/source provenance: the endpoint
returns an operator-configured commit with `verified: false`, and the allowed
and denied XDRs were expired at check time. No transaction was submitted. See
[`20260926T150201Z-production-preflight.json`](20260926T150201Z-production-preflight.json).
At 15:04 UTC, redaction scanning parsed 61 prior evidence JSON files, found no
recognized secret-shaped values or prohibited secret/custody field names, and
confirmed historical D2/D3 report hashes are unchanged. See
[`20260926T150419Z-evidence-redaction-scan.json`](20260926T150419Z-evidence-redaction-scan.json).
At 10:44 UTC, the operator reconfirmed that the Talmbag production panel still
shows a fresh verified balance and enabled sponsorship. The operator was
advised to pause sponsorship while the custody context is unresolved; pause
status is not confirmed. No address, amount, or key was captured, and no
production mutation or Testnet transaction was performed. See
[`20260926T104411Z-production-owner-status-confirmation.json`](20260926T104411Z-production-owner-status-confirmation.json).
At 10:49 UTC, the historical D2 and D3 offline report verifiers passed again;
both source report hashes match their prior values, and neither report was
mutated. No live network or ledger transaction was used. See
[`20260926T104934Z-d2-d3-report-reverification.json`](20260926T104934Z-d2-d3-report-reverification.json).
The D4 JSON evidence redaction scan passed with no secret-shaped values or
ciphertext/nonce/tag/private-key fields found.
At 11:38 UTC, the operator again reported a fresh verified balance and enabled
sponsorship. Pause was requested and remains unconfirmed. The local provenance
response was corrected to `verified: false` for the operator-configured SHA;
the Next.js token-length check was aligned with Express. Focused tests and
typechecks passed. These source changes are not deployed and do not prove
production source identity. See
[`20260926T113827Z-source-audit-corrections.json`](20260926T113827Z-source-audit-corrections.json).
At 11:42 UTC, the D4 evidence directory redaction scan passed across 39 JSON
files, including these source-audit and scan records. No credential-shaped
values or custody key payloads were found. See
[`20260926T114244Z-evidence-redaction-scan.json`](20260926T114244Z-evidence-redaction-scan.json).
At 11:45 UTC, the operator said they would pause sponsorship. This is intent,
not panel confirmation; keep the state unconfirmed until the dashboard shows
Paused. No production mutation or Testnet transaction was performed. See
[`20260926T114528Z-owner-pause-action-pending.json`](20260926T114528Z-owner-pause-action-pending.json).
At 11:50 UTC, the operator clarified that the project discussed in prior notes
as Talmbag is **Talambagv2** and confirmed sponsorship is paused. This is an
owner report; the production custody aggregate still omits project IDs, so the
development-tagged row is not mapped to Talambagv2. Deployed source provenance
remains unverified. Campaign status remains NO-GO. See
[`20260926T115010Z-talambagv2-pause-confirmation.json`](20260926T115010Z-talambagv2-pause-confirmation.json).
At 11:52 UTC, the evidence redaction scan passed over 43 JSON files after
recording the alias and pause update. See
[`20260926T115217Z-evidence-redaction-scan.json`](20260926T115217Z-evidence-redaction-scan.json).
At 12:02 UTC, a read-only production inline query matched exactly one project
by Talambagv2 label/slug and found its single ready Testnet custody record. It
stores encrypted ciphertext at key version `v1`, but the record does not match
the production custody identity. A fresh internal configuration action reports
the configured `prod` identity, valid `v1` keyring, Testnet, and provisioning
enabled. The internal relayer-readiness action returned `metadata_disabled`
after sponsorship was paused; it returned no public key and did not establish
successful signing readiness. No production mutation or transaction occurred.
See [`20260926T120202Z-production-talambagv2-custody-readback.json`](20260926T120202Z-production-talambagv2-custody-readback.json).
At 12:08 UTC, a fresh redaction scan parsed the 45 JSON evidence files present
before the scan report was written. It found no recognized secret-shaped values
or prohibited secret/custody field names; the historical D2/D3 report hashes
remain unchanged. See
[`20260926T120800Z-evidence-redaction-scan.json`](20260926T120800Z-evidence-redaction-scan.json).
At 12:18 UTC, a follow-up scan parsed all 47 JSON evidence files then present,
including the local two-app configuration record. It found no recognized
secret-shaped values or prohibited secret/custody field names, and D2/D3 hashes
remain unchanged. See
[`20260926T121800Z-evidence-redaction-scan.json`](20260926T121800Z-evidence-redaction-scan.json).
At 12:33 UTC, the current root `pnpm test` passed all 9 Turbo test tasks; the
D4 campaign recorder tests passed 10/10, and both historical D2/D3 reports
passed offline verification. Repository `pnpm lint:fix` passed all 9 tasks,
including TypeScript checks; `pnpm build` passed all 5 tasks; and
`git diff --check` passed. Lint introduced no source changes. See
[`20260926T123315Z-current-workspace-validation.json`](20260926T123315Z-current-workspace-validation.json).
At 12:35 UTC, the redaction scan passed across the 49 JSON files then present,
with no recognized secret-shaped values or prohibited custody fields; D2/D3
report hashes remain unchanged. See
[`20260926T123500Z-evidence-redaction-scan.json`](20260926T123500Z-evidence-redaction-scan.json).
At 12:41 UTC, a cache-bypassed Turbo build passed all 5 configured workspace
build tasks (0 cached). At 12:42 UTC, redaction scanning passed across the 51
JSON evidence files then present, including the fresh build record, with D2/D3
hashes unchanged. See
[`20260926T124120Z-forced-workspace-build.json`](20260926T124120Z-forced-workspace-build.json)
and [`20260926T124200Z-evidence-redaction-scan.json`](20260926T124200Z-evidence-redaction-scan.json).
At 12:58 UTC, the local simulated Gas browser suite passed 18/18 in Chromium
and 18/18 in WebKit. Firefox startup failed before application assertions on
four attempts; one attempt was interrupted and 13 tests were not run. No
external Testnet calls or transactions were made. The operator reiterated
Talambagv2 and the paused sponsorship status; the 12:02 UTC readback remains
the latest direct production state check and confirms the custody identity
mismatch. See [`browser-regression-summary.json`](browser-regression-summary.json)
and [`20260926T130430Z-talambagv2-owner-confirmation.json`](20260926T130430Z-talambagv2-owner-confirmation.json).
At 13:05 UTC, the evidence redaction scan passed across all 55 JSON files then
present, with no recognized secret-shaped values or prohibited custody fields;
D2/D3 report hashes remain unchanged. See
[`20260926T130500Z-evidence-redaction-scan.json`](20260926T130500Z-evidence-redaction-scan.json).
At 11:46 UTC, the redaction scan passed across 41 D4 evidence JSON files. See
[`20260926T114603Z-evidence-redaction-scan.json`](20260926T114603Z-evidence-redaction-scan.json).
At 11:31 UTC, a source audit found the D2 provenance handler returned
`verified: true` for an operator-configured SHA marker. It now returns
`verified: false`; the focused backend test confirms the honest status. The
live D2/D4 provenance gate remains open pending a trusted deployment attestation.
This local change is not deployed and does not verify production source.
At 11:04 UTC, fresh direct tests passed 898/898 across the backend, web, SDK,
Stellar, wallets, PDAX, observability, both dApp examples, and D2/D3/D4 smoke
tools. Direct web and example builds passed. The root Turbo build remains
incomplete because its package scripts could not verify the pnpm signature in
the restricted network; offline Cargo lacks the locked `visibility` crate.
Firefox's browser launch timed out before app assertions with macOS
plugin-container/framebuffer errors even after process permission; Chromium
and WebKit pass in the earlier recorded run. See
[`20260926T110452Z-workspace-validation-reconciliation.json`](20260926T110452Z-workspace-validation-reconciliation.json).
At 11:16 UTC, the exact repository commands `pnpm lint:fix`, `pnpm build`,
and `pnpm test` all passed after pinned pnpm signature verification succeeded
with registry access. Workspace suites totaled 863 tests; D2/D3/D4 tooling added
35, and Cargo registry integration tests added 11. The D4 JSON redaction scan
passed across 38 evidence files at 11:22 UTC. Firefox remains incomplete on this macOS host,
and no hosted CI or live Testnet campaign was run. See
[`20260926T111656Z-full-repository-validation.json`](20260926T111656Z-full-repository-validation.json).
After explicit approval, the production environment variable was set and read
back as `prod:agreeable-salmon-748`. An 08:31 UTC readback reconfirmed that
custody and D2 deployment-name settings use that identity, the environment is
`production`, provisioning is enabled, and the custody keyring variable is
present (its value was not read). The operator reports Vercel's production
frontend targets the same deployment. Two deployed custody status calls at
08:36 UTC returned `prod:agreeable-salmon-748`, Testnet, a valid `v1` keyring,
and enabled provisioning, so the runtime identity now agrees with the
environment readback. The deployed source SHA remains unverified. See
[`20260926T083655Z-production-runtime-status-readback.json`](20260926T083655Z-production-runtime-status-readback.json)
and [`20260926T083118Z-production-config-readback.json`](20260926T083118Z-production-config-readback.json).
At 09:19 UTC, the operator reported that the Talmbag production Gas panel
shows `Ready` with an address visible; no address or key was captured. This
does not prove the panel is backed by the single dev-tagged aggregate row, nor
does it verify signer decryption or funding. See
[`20260926T091925Z-production-talmbag-relayer-status.json`](20260926T091925Z-production-talmbag-relayer-status.json).
At 09:23 UTC, the operator further reported that Talmbag's production panel
shows a fresh verified balance and sponsorship enabled; no amount, address, or
key was captured. This does not show a funding transaction receipt, prove
campaign budget sufficiency, verify signer decryption, or map the UI record to
the dev-tagged inventory row. See
[`20260926T092345Z-production-talmbag-owner-panel-readiness.json`](20260926T092345Z-production-talmbag-owner-panel-readiness.json).
The shared local Gas runtime reader now reads environment values at invocation time
for custody, funding, balance/Horizon, and fallback RPC paths. The D2 operator
snapshot and provenance handlers now do the same, require an explicit
deployment environment and identity outside development, and only allow the
development fallback on an explicitly marked development deployment. These
local changes are not tied to a verified production source revision; runtime
identity is verified, while provenance and custody-row mapping remain open.
Local development and production keyring files were
compared in memory and their active key material differs; the deployed keyring
was not read. See [`20260926T073832Z-production-identities-readback.json`](20260926T073832Z-production-identities-readback.json).
Owner/reviewer, dApp, wallet, and contract readiness remain open.
No transaction has been submitted for this D4 campaign.

## Readiness checks

| Gate | Status | Evidence and next action |
| --- | --- | --- |
| Candidate source revision | Open | Branch `instawards/gas-station-deliverable-4`, HEAD `e93dddc361da49ccd740ac6fd7b17f0cafaa4692`; source changes remain in the working tree. Review, freeze the delivery revision, and rerun required checks on that SHA. |
| Hosted CI | Open | No hosted green CI run has been captured for the frozen revision. |
| Production Convex deployment provenance | Unverified; configured marker conflicts with deployed function roster | At 05:34 UTC, production non-secret configuration reported deployment name `prod:agreeable-salmon-748`, environment `production`, and configured source marker `8e8ab152179032c332eaae883bca979624f920d6`. Local Git shows that marker is nine commits before candidate HEAD `e93dddc361da49ccd740ac6fd7b17f0cafaa4692` and predates managed-relayer implementation commit `c6db9830be7baa84d916d793f5de8fb02afeee23`, despite the production function roster containing managed-relayer functions. The marker is operator-configured, not independent build attestation. Actual deployed source remains unverified. See [`20260926T053419Z-production-provenance-check.json`](20260926T053419Z-production-provenance-check.json). |
| Development Convex deployment | Deployed; provenance partial | At 04:24 UTC, `convex dev --once --typecheck enable --codegen enable --tail-logs disable` reported `Convex functions ready` on `capable-kingfisher-697`. The push used this dirty working tree at HEAD `e93dddc361da49ccd740ac6fd7b17f0cafaa4692`, so it is not frozen-revision evidence. The 04:26 UTC aggregate was a two-row snapshot before the owner-reported new-project flow. A 04:42 UTC read-only aggregate found three custody rows: two ready under `dev:capable-kingfisher-697`, none pending there, and one failed row with no deployment identity. This supports the reported provisioning flow but does not identify the project. No Testnet transaction was submitted by these checks. The CLI also reported the Convex project is above Free plan limits and may be interrupted unless usage is reduced or the plan upgraded. See [`development-deployment-summary.json`](development-deployment-summary.json) and [`development-provisioning-followup-summary.json`](development-provisioning-followup-summary.json). |
| Development custody configuration | Keyring and aggregate provisioning verified; owner lifecycle open | At 05:42 UTC the internal-only status action reconfirmed a valid keyring with active version `v1` and one retained version, deployment ID `dev:capable-kingfisher-697`, Testnet network, and provisioning enabled. The read-only aggregate still shows three rows: two ready under the expected deployment identity, none pending, and one failed row with no deployment identity. It did not return project identifiers or key material; the failed row and operator-reported new project remain unmapped. Funding, fresh balance, and explicit sponsorship activation remain unverified. See [`20260926T054233Z-development-managed-custody-preflight.json`](20260926T054233Z-development-managed-custody-preflight.json). |
| Production custody configuration | Runtime identity verified; source provenance open | At 10:09 UTC, a fresh read-only deployed status call returned `prod:agreeable-salmon-748`, Testnet, valid keyring version `v1`, and enabled provisioning. Earlier environment reads showed the same identity and production environment; keyring values were never read. The deployed source SHA remains unverified. See [`20260926T100934Z-production-readiness-reconciliation.json`](20260926T100934Z-production-readiness-reconciliation.json), [`20260926T083655Z-production-runtime-status-readback.json`](20260926T083655Z-production-runtime-status-readback.json), and [`20260926T083118Z-production-config-readback.json`](20260926T083118Z-production-config-readback.json). |
| Deployment provenance endpoint | Configured SHA is explicitly unverified | The local D2 provenance endpoint now returns `verified: false` for its operator-configured commit marker; an environment value does not attest deployed source. The focused backend test passed. No production deployment occurred; a trusted attestation source remains required. |
| Production custody inventory | Ready; production context and address verified after recovery | At 12:02 UTC, the single ready record was tagged with the development identity. At 13:53 UTC, recovery re-encrypted the same account for `prod:agreeable-salmon-748`; verify-before, migration, and verify-after returned `verified`, `migrated`, and `verified`. A read-only post-check confirms one ready Testnet row, matching production identity, unchanged public address, disabled policy, and no maintenance lock. No ledger transaction or fund movement occurred. See [`20260926T120202Z-production-talambagv2-custody-readback.json`](20260926T120202Z-production-talambagv2-custody-readback.json) and [`20260926T135422Z-production-talambagv2-custody-context-recovery.json`](20260926T135422Z-production-talambagv2-custody-context-recovery.json). |
| Production custody identity recovery | Complete; sponsorship remains paused | The deployed internal recovery action authenticated the row under its recorded AAD context and verified the derived public address before migration. Its atomic migration updated the private encrypted envelope and deployment binding only; post-migration verification succeeded. The owner-reported production commit is `33beb38d5d1b8590accc2ec9d7fecbf9ad357ad7`; independent source attestation remains open. Do not resume sponsorship as part of this recovery. See [`20260926T135422Z-production-talambagv2-custody-context-recovery.json`](20260926T135422Z-production-talambagv2-custody-context-recovery.json) and ADR-0005. |
| Production D3 invocation preflight | Incomplete; project scope, snapshot, signer, funding, policy, target, and wallet checks pass; no transaction submitted | At 15:02 UTC, the updated production project scope resolved Talambagv2. Twelve checks passed, including Testnet RPC, signer readiness, funding, policy eligibility, denied-target exclusion, and wallet match. The provenance endpoint still returns `verified: false` for its operator-configured SHA, so source/provenance checks fail. Both replacement XDRs had expired by check time. Provide independent source attestation, then generate fresh XDRs and run preflight immediately before execution. See [`20260926T150201Z-production-preflight.json`](20260926T150201Z-production-preflight.json) and [`packages/backend/convex/http.ts`](../../../packages/backend/convex/http.ts#L237). |
| PayAccess project mapping | Ambiguous mapping warning reported; deployment and duplicate rows unidentified | At 14:12:11 Asia/Manila, the operator reported `pay_access_event_project_mapping_ambiguous`. The guarded sync path leaves the project rows and global cursor unchanged and retries after repair; the backend regression verifies this behavior. The warning does not identify the deployment or canonical project mapping. No data repair was performed. See [`20260926T063021Z-pay-access-ambiguity-followup.json`](20260926T063021Z-pay-access-ambiguity-followup.json). |
| Authenticated owner and reviewer access | Unverified | Confirm the production dashboard owner session and reviewer access without sharing credentials. |
| Managed Testnet project | Custody, signer, funding, and policy preflight passed; live signing and settlement evidence open | The recovery action verified the stored key and derived address before and after migration. The 15:02 UTC preflight confirms signer readiness, funded Testnet accounts, and policy eligibility. Sponsorship remains paused; no sponsored transaction was submitted. Independent source provenance, live execution, owner lifecycle demonstrations, and settled Gas evidence remain open. See [`20260926T135422Z-production-talambagv2-custody-context-recovery.json`](20260926T135422Z-production-talambagv2-custody-context-recovery.json) and [`20260926T150201Z-production-preflight.json`](20260926T150201Z-production-preflight.json). |
| Participants | Available, not validated | The operator reports two additional participants are available. Schedule the three-person session and record role-separated actions; do not count availability as a completed demonstration. |
| Two dApp integrations | Local source/configuration only; deployed acceptance open | A 12:16 UTC in-memory check confirmed separate correctly shaped Gas Testnet keys and distinct bounded demo tokens in the Express and Next.js local `.env.local` files. Both set `VELO_GAS_ENV=development`; no deployed Testnet config or receipt was verified. See [`20260926T121626Z-local-two-app-gas-config-check.json`](20260926T121626Z-local-two-app-gas-config-check.json). |
| Testnet wallets, funding, and contract | Unverified | Confirm distinct participant wallets, sufficient funds, a live eligible contract, and an explicit maximum spend budget before execution. |
| Owner workflow evidence | Partial; remains open | A user-provided Dev screenshot shows an enabled policy with one allowed contract and the suggested 10 XLM/day, 100 requests/wallet settings. The operator reports Talambagv2 production shows Ready with a fresh verified balance and sponsorship paused. Custody now matches the production deployment and decrypts to the same public address. No funding receipt or amount, active-contract detail, pause/resume, role/keyboard states, or consent-bound withdrawal has been evidenced. |
| Current local verification | Root tests, lint/typecheck, fresh build, and D4 recorder pass; hosted CI and Firefox checks remain open | At 12:33 UTC, root `pnpm test` passed 9/9 Turbo tasks, D4 recorder tests passed 10/10, D2/D3 reports passed offline verification, `pnpm lint:fix` passed 9/9 tasks, and `git diff --check` passed. At 12:41 UTC, a forced no-cache build passed all 5 workspace build tasks. Firefox could not launch before assertions, and hosted CI remains required. See [`20260926T123315Z-current-workspace-validation.json`](20260926T123315Z-current-workspace-validation.json) and [`20260926T124120Z-forced-workspace-build.json`](20260926T124120Z-forced-workspace-build.json). |
| 50-transaction campaign | Not started | No D4 campaign attempt has been recorded. Start only after provenance and safety gates are green; target 60 settled unique FeeBumps across both apps. |
| Managed custody context UI guard | Implemented and locally verified | The safe owner provisioning query now reports whether a ready managed record is bound to the active deployment, without returning its deployment ID or custody payload. The panel blocks funding, resume, activation, and withdrawal when the match is false or unknown, but allows sponsorship to be paused. A true match still does not prove key decryption. At 10:26 UTC, backend 342/342, web 251/251, Chromium/WebKit 18/18 each, backend/web typechecks, changed-file lint/format, and the configured Turbopack build passed. The build passed again at 10:33 UTC and the targeted mismatch browser case passed 1/1 at 10:34 UTC after the final panel copy edit. No production deployment occurred. See [`20260926T103422Z-custody-context-ui-guard.json`](20260926T103422Z-custody-context-ui-guard.json). |

## Local checks

The working-tree results are summarized in the [D4 evidence index](README.md).
They establish local regressions and build behavior only. They do not establish
hosted CI, deployed source identity, production owner access, or Testnet ledger
outcomes. D2/D3 historical reports passed offline verification again on
September 26; current hashes are recorded in
[`historical-smoke-verification.json`](historical-smoke-verification.json).
At 06:35 UTC, direct local package validation passed 890 tests across backend,
web, SDK, Stellar, wallets, PDAX, observability, both examples, and the
smoke/recorder suites.
Relevant package TypeScript checks and direct local builds passed. The Turbo
test aggregate still failed where three tasks invoked the package-manager
wrapper, whose signature could not be verified; the corresponding direct
package suites passed. See the evidence index and
[`20260926T063557Z-workspace-validation-followup.json`](20260926T063557Z-workspace-validation-followup.json).
After that aggregate snapshot, the Gas backend suite passed 214/214, the
custody environment regression passed, and all 13 relayer tests passed. The
backend Convex and web TypeScript checks, focused lint/format, and
`git diff --check` passed. The full simulated Gas suite passed 17/17 in
Chromium and 17/17 in WebKit after correcting its navigation test. Firefox
could not launch its browser process under the local macOS sandbox; no Firefox
application assertions ran. These checks validate only the local source; no
production push or Testnet transaction followed.
At 07:52 UTC, after updating the D2 HTTP environment reads, the complete Gas
backend suite passed 216/216, backend Convex typecheck passed, focused lint and
format passed, and `git diff --check` passed. Historical D2/D3 report verifiers
passed offline and their SHA-256 values remain unchanged. These are local
source checks; production deployment and runtime identity verification remain
open.
At 08:11 UTC, refreshed direct package suites passed 893/893. TypeScript checks
passed for ten projects. Root Oxlint exited successfully with five warnings in
an unchanged observability test; Oxfmt passed across 49 changed/new source
files, excluding generated Convex API declarations, and `git diff --check`
passed. Historical D2/D3 reports verified offline with unchanged hashes.
Chromium and WebKit Gas browser runs remain 17/17 each; Firefox could not
launch under the local sandbox. The root Turbo build and hosted CI remain open;
the pnpm/Turbo aggregate was previously blocked by package-manager signature
verification. See
[`20260926T081142Z-local-package-validation.json`](20260926T081142Z-local-package-validation.json).
At 09:16 UTC, focused current-checkout regressions passed 43/43 across
backend API-key/Gas authorization/relayer/custody inventory/PayAccess tests, web
API-key UI tests, and the D4 campaign recorder. The checkout remains unfrozen
at `e93dddc`; this focused result does not replace hosted CI or full acceptance.
See [`20260926T091620Z-focused-d4-source-regressions.json`](20260926T091620Z-focused-d4-source-regressions.json).
At 09:31 UTC, the backend focused suite passed 33/33 across six files after
adding local rollback regressions: disabled provisioning does not block signing
for an existing managed account, while a new provisioning attempt fails closed
without publishing an address and keeps the project available. Backend
Oxlint, Oxfmt, and `git diff --check` passed. Combined with the unchanged 09:16
web and recorder runs, the focused set totals 49/49. This does not establish
live rollback behavior, hosted CI, or any campaign ledger outcome. See
[`20260926T092948Z-focused-d4-rollback-regressions.json`](20260926T092948Z-focused-d4-rollback-regressions.json).
The full backend suite then passed 341/341 across 46 files after the scheduled
provisioning test was made deterministic. Backend Convex typecheck passed, as
did the D2 and D3 historical report offline verifiers.
At 09:36 UTC, the 49-test focused set passed again. Fresh SHA-256 values for
the historical D2 and D3 reports match the existing evidence, and neither
offline verifier wrote a report.
At 09:44 UTC, the project API Keys UI was corrected to show purpose-less
legacy keys as General API access. Its regression raised the focused set to
50/50; the full web suite passed 250/250 and the backend suite remained
341/341. Backend/web typechecks, changed-file lint, and format checks passed.
At 09:53 UTC, the safe owner query distinguishes `legacy` rows so the key page
shows both retained scopes; Checkout snippets continue to offer those keys.
The focused set passes 51/51, full backend/web suites pass 341/341 and 251/251,
and both typechecks plus changed-file quality checks pass.
At 10:00 UTC, the configured Turbopack `next build` also completed successfully
after allowing its required local process/port operation. This did not deploy
the app or establish hosted CI.
At 10:26 UTC, the full backend suite passed 342/342 and the full web suite
passed 251/251. The custody-context status regression passed; both backend and
web typechecks passed. The local simulated Gas browser suite passed 18/18 in
Chromium and 18/18 in WebKit, including a context-mismatch scenario that blocks
funding/resume/activation/withdrawal while preserving pause. Changed-file lint
and formatting passed, as did the configured Turbopack production build. Firefox
assertions were not run because its local browser process had previously failed
to launch before app assertions. No production deployment or Testnet
transaction followed. See
[`20260926T103422Z-custody-context-ui-guard.json`](20260926T103422Z-custody-context-ui-guard.json).

## Go/no-go rule

Keep the campaign at **NO-GO** until deployed source provenance is independently
verified, the owner and reviewer can access the dashboard, both dApps are
configured, participants and wallets are ready, the eligible contract and
spend budget are confirmed, and a fresh preflight passes. The production
custody context recovery is complete; sponsorship remains paused.
Stop immediately for unexpected fee source, accounting mismatch, or unresolved
execution exposure. Never turn an unverified or pending outcome into a success.
