---
type: evidence-index
area: instawards
status: in-progress
last_updated: 2026-09-26
deliverable: "4 — Integration & Validation Package"
source_of_truth: repository
---

# D4 Gas Station Integration & Validation Evidence

**Status: in progress.** This folder is the reviewer entry point for D4. Local
integration work and deterministic checks are underway; no current production
Testnet campaign or D4 acceptance is claimed. The 12-hour window runs from the
kickoff recorded in the [D4 sprint plan](../Velo-Instawards-Deliverable-4-Sprint-Plan.md).

## Current production decision: NO-GO

At 13:53 UTC, the internal recovery action verified Talambagv2's stored key
under its original authenticated context, migrated the encrypted envelope to
`prod:agreeable-salmon-748`, and verified it again. A fresh readback confirms
the same public address, ready custody status, disabled policy, and no
maintenance lock. Sponsorship remains paused; no Testnet transaction or fund
movement occurred. See
[`20260926T135422Z-production-talambagv2-custody-context-recovery.json`](20260926T135422Z-production-talambagv2-custody-context-recovery.json).
The operator identifies production commit `33beb38d5d1b8590accc2ec9d7fecbf9ad357ad7`,
but independent source attestation remains open. At 14:00 UTC, redaction
scanning parsed all 57 evidence JSON files then present, including the recovery
record; no recognized secret-shaped values or prohibited secret/custody field
names were found, and the historical D2/D3 report hashes are unchanged. See
[`20260926T140058Z-evidence-redaction-scan.json`](20260926T140058Z-evidence-redaction-scan.json).
At 14:35 UTC, the production D3 preflight parsed both replacement XDRs and
confirmed they are distinct, and confirmed the configured RPC is Testnet. The
preflight remains incomplete: the operator snapshot returned `Project not
found`, provenance returned `Invalid provenance scope`, and the configured D2
project scope does not match Talambagv2. The report also flags signer readiness
and funding as unverified, the allowed invocation as policy-denied, the denied
target as allowlisted, the invocation wallet as mismatched, and both XDRs as
expired. Independent source provenance remains open. No transaction was
submitted. See
[`20260926T143530Z-production-preflight.json`](20260926T143530Z-production-preflight.json).
At 14:40 UTC, the redaction scan parsed 59 prior evidence JSON files with no
recognized secret-shaped values or prohibited secret/custody field names; the
historical D2/D3 report hashes are unchanged. See
[`20260926T144055Z-evidence-redaction-scan.json`](20260926T144055Z-evidence-redaction-scan.json).
At 15:02 UTC, after the operator updated the production D2 project scope,
snapshot lookup and deployment identity passed. The preflight passed 12 checks;
three remain blocked: the provenance endpoint reports an unverified
operator-configured SHA, and both XDR invocations are expired. The production
handler returns `verified: false` for this marker, so an independent build or
deployment attestation is needed before execution. No transaction was
submitted. See
[`20260926T150201Z-production-preflight.json`](20260926T150201Z-production-preflight.json).
At 15:04 UTC, redaction scanning parsed 61 prior evidence JSON files with no
recognized secret-shaped values or prohibited secret/custody fields; historical
D2/D3 report hashes remain unchanged. See
[`20260926T150419Z-evidence-redaction-scan.json`](20260926T150419Z-evidence-redaction-scan.json).

To reach GO for the live campaign, the remaining gates are:

1. Production D2 scope now resolves Talambagv2; provide independently
   verifiable production source provenance, freeze the delivery revision, and
   pass hosted CI. The custody context recovery gate is satisfied.
2. Verify the owner lifecycle and role/accessibility states, and have two
   deployed dApps configured for Testnet with fresh, correlated successful
   receipts. Generate fresh signed XDRs after source attestation is available.
3. Complete the three-person validation and five policy setup/readback demos.
4. With explicit authorization for external Testnet transactions, run the
   required campaign of at least 50 unique settled FeeBumps and capture exact
   fees, ledger/explorer receipts, replay/denial results, and raw metrics.
5. Capture live dashboard screenshots, the 3–5 minute handoff video, reviewer
   access, and reconcile the final D2/D3 handoffs.

Local tests and a displayed balance do not satisfy these production gates.
The criteria remain unchanged; see the full checklist in the sprint plan.

At 06:56 UTC, a read-only preflight on production Convex deployment
`agreeable-salmon-748` confirmed zero managed custody records, a valid Testnet
keyring with active version `v1`, and provisioning enabled. The configured
custody identity remains `dev:capable-kingfisher-697`; correct it to
`prod:agreeable-salmon-748` before provisioning a production account, after
explicit approval. The operator reports an independent encrypted backup, but
separation of production and development keyring values was not verified. The
preflight read no key material and made no production mutation. See
[`20260926T065657Z-production-custody-preflight.json`](20260926T065657Z-production-custody-preflight.json).

At 07:04 UTC, after explicit approval, the production environment value was set
to and directly read back as `prod:agreeable-salmon-748`. The deployed custody
status action still reports `dev:capable-kingfisher-697` across repeated
read-only calls, while the aggregate inventory remains empty. Do not provision
until runtime status agrees. Local development and production keyring files
were compared in memory and their active key material differs; no key values
or hashes were emitted, and the deployed keyring was not read. See
[`20260926T070449Z-production-custody-id-write-followup.json`](20260926T070449Z-production-custody-id-write-followup.json)
and [`20260926T070006Z-local-keyring-separation-check.json`](20260926T070006Z-local-keyring-separation-check.json).
At 07:38 UTC, read-only production CLI checks confirmed
`VELO_GAS_CUSTODY_DEPLOYMENT_ID` and `VELO_GAS_D2_DEPLOYMENT_NAME` both read
`prod:agreeable-salmon-748`, while `VELO_DEPLOYMENT_ENVIRONMENT` reads
`production`. The operator reports Vercel's production frontend targets that
deployment and reports that the managed-relayer implementation was deployed
earlier, though its source SHA is unverified. The deployed custody status action
still reports the old dev identity. No production deployment of the local
runtime fixes, relayer provisioning, funding, or Testnet transaction followed.
Local Gas code now reads custody, funding, balance,
Horizon, and fallback-RPC configuration through a shared invocation-time
reader; this local fix is unverified in production.
The exact non-secret Convex readback and its source/side-effect limits are
recorded in [`20260926T073832Z-production-identities-readback.json`](20260926T073832Z-production-identities-readback.json).

At 07:52 UTC, the local D2 snapshot/provenance handlers were also updated to
read the active Convex environment at request time. A non-development
deployment now needs an explicit deployment identity; the `dev:` fallback is
limited to an environment explicitly marked `development`. Production-facing
Gas and D2 changes pass the 216-test Gas backend suite and backend Convex
typecheck. The historical D2/D3 smoke reports pass offline verification and
their hashes are unchanged. This source is not deployed, so the last deployed
status action still needs a fresh production identity readback. See
[`20260926T075253Z-production-runtime-alignment.json`](20260926T075253Z-production-runtime-alignment.json).

At 08:11 UTC, the refreshed direct package suites passed 893/893 across the
backend, web, SDK, Stellar, wallets, PDAX, observability, both examples, and
D2/D3/D4 smoke tools. Ten package TypeScript checks passed; root Oxlint exited
successfully with five warnings in an unchanged observability test; formatting
passed for 49 changed/new source files after excluding generated Convex API
declarations; `git diff --check` passed. D2/D3 historical report verification
passed offline with unchanged hashes. Chromium and WebKit Gas browser runs
remain 17/17 each; Firefox could not launch under the local sandbox, so its
application assertions remain unrun. The root Turbo build/CI gates, frozen
source, production provenance, and live campaign remain open. See
[`20260926T081142Z-local-package-validation.json`](20260926T081142Z-local-package-validation.json).

At 08:31 UTC, after the approved production custody identity set, a fresh
non-secret readback confirmed the custody and D2 deployment names are both
`prod:agreeable-salmon-748`, the environment is `production`, and managed
provisioning is enabled. The custody keyring variable is present; its value
was not read. The operator reports Vercel production targets the same
deployment. No status action was called after this readback, so the last
observed runtime identity remains the 07:04 UTC dev value. See
[`20260926T083118Z-production-config-readback.json`](20260926T083118Z-production-config-readback.json).

At 08:36 UTC, two consecutive calls to the deployed internal custody status
action returned `prod:agreeable-salmon-748`, Testnet, a valid `v1` keyring, and
enabled provisioning. The runtime identity now agrees with the production
environment readback. The deployed source SHA remains unverified; these calls
did not provision or fund an account or submit a transaction. See
[`20260926T083655Z-production-runtime-status-readback.json`](20260926T083655Z-production-runtime-status-readback.json).

At 08:42 UTC, the production read-only inventory returned one ready custody
record tagged `dev:capable-kingfisher-697` and no record tagged with the
production identity. The aggregate does not identify a project or return
custody payloads. Preserve the row and its account; identify it through an
authenticated owner view before any project-level recovery, provisioning, or
fund movement. At 09:19 UTC, the operator reported that the Talmbag production
Gas panel shows `Ready` with an address visible. No address or key was captured.
This owner-facing report is not conclusively mapped to the aggregate row and
does not verify signer decryption, funding, or ledger activity. See
[`20260926T084217Z-production-custody-inventory-refresh.json`](20260926T084217Z-production-custody-inventory-refresh.json).
The operator report is recorded in
[`20260926T091925Z-production-talmbag-relayer-status.json`](20260926T091925Z-production-talmbag-relayer-status.json).
At 09:23 UTC, the operator further reported a fresh verified balance and
enabled sponsorship in the Talmbag production panel; no address, balance amount,
or key was captured. This improves owner-facing readiness evidence but does not
establish a funding receipt, campaign budget sufficiency, signer decryption, or
mapping to the aggregate row. See
[`20260926T092345Z-production-talmbag-owner-panel-readiness.json`](20260926T092345Z-production-talmbag-owner-panel-readiness.json).

At 10:09 UTC, fresh read-only production Convex calls confirmed that runtime
configuration is `prod:agreeable-salmon-748` with Testnet, a valid `v1` keyring,
and provisioning enabled. The custody aggregate still contains one ready row
tagged `dev:capable-kingfisher-697` and no production-tagged row; project IDs
and custody payloads were not returned. The operator reconfirmed that Talmbag's
panel shows Ready, a fresh verified balance, and sponsorship enabled. The
panel cannot be conclusively mapped to that row. Current local signing code
rejects a deployment identity mismatch, while deployed source SHA remains
unverified. No data was changed and no Testnet transaction was submitted. See
[`20260926T100934Z-production-readiness-reconciliation.json`](20260926T100934Z-production-readiness-reconciliation.json).

At 10:44 UTC, the operator reconfirmed that Talmbag's production panel shows a
fresh verified balance and enabled sponsorship. The operator was advised to
pause sponsorship while the custody context mismatch is unresolved; pause
status has not been confirmed. No address, amount, or key was captured, and no
production mutation or Testnet transaction was performed. See
[`20260926T104411Z-production-owner-status-confirmation.json`](20260926T104411Z-production-owner-status-confirmation.json).

At 11:31 UTC, a local source audit found that the D2 provenance endpoint
reported `verified: true` for an operator-configured commit marker. The handler
now returns `verified: false`, and its focused backend test passes. This local
correction is not deployed and does not close the production provenance gate;
a trusted deployment attestation remains necessary. No production change or
Testnet transaction was made.

At 11:38 UTC, the operator again reported a fresh verified Talmbag balance and
enabled sponsorship; pause status remains unconfirmed. The Next.js example now
applies Express's 256-byte demo-token limit before body parsing. Backend balance
tests (10), D2 smoke tests (13), Express and Next.js example tests (33), both
relevant typechecks, changed-file lint and formatting, and `git diff --check`
passed. The source-audit record documents that these local edits are not
deployed and no Testnet transaction was submitted.

At 11:42 UTC, the redaction scan passed over all 39 D4 JSON evidence files.
See [`20260926T114244Z-evidence-redaction-scan.json`](20260926T114244Z-evidence-redaction-scan.json).

At 11:45 UTC, the operator said they would pause Talmbag sponsorship. The
dashboard pause state is not yet confirmed. No production mutation or Testnet
transaction was performed. See
[`20260926T114528Z-owner-pause-action-pending.json`](20260926T114528Z-owner-pause-action-pending.json).
At 11:50 UTC, the operator clarified the project is **Talambagv2** (earlier
notes called it Talmbag) and confirmed sponsorship is paused. This owner report
does not map the project to the dev-tagged production custody row, and source
provenance remains unverified. See
[`20260926T115010Z-talambagv2-pause-confirmation.json`](20260926T115010Z-talambagv2-pause-confirmation.json).
At 11:52 UTC, the evidence redaction scan passed over 43 D4 JSON files. See
[`20260926T115217Z-evidence-redaction-scan.json`](20260926T115217Z-evidence-redaction-scan.json).

At 12:02 UTC, a read-only production query matched exactly one project to
Talambagv2 and found its ready Testnet custody row at key version `v1`. The
stored record does not match the production deployment identity. Runtime
configuration reports production identity, a valid `v1` keyring, and enabled
provisioning. The internal readiness action returned `metadata_disabled` after
the owner paused sponsorship; it returned no public key and did not prove
decryption. No production mutation or Testnet transaction occurred. See
[`20260926T120202Z-production-talambagv2-custody-readback.json`](20260926T120202Z-production-talambagv2-custody-readback.json).
At 12:08 UTC, a fresh scan parsed the 45 JSON evidence files present before
the scan report was written. It found no recognized secret-shaped values or
prohibited secret/custody field names, and the historical D2/D3 report hashes
remain unchanged. See
[`20260926T120800Z-evidence-redaction-scan.json`](20260926T120800Z-evidence-redaction-scan.json).
At 12:18 UTC, a follow-up scan parsed all 47 JSON evidence files then present,
including the local two-app configuration record. It found no recognized
secret-shaped values or prohibited secret/custody field names; D2/D3 report
hashes remain unchanged. See
[`20260926T121800Z-evidence-redaction-scan.json`](20260926T121800Z-evidence-redaction-scan.json).
At 12:33 UTC, current local validation passed: root `pnpm test` (9/9 Turbo
tasks), D4 campaign recorder (10/10), offline D2/D3 report verification,
`pnpm lint:fix` (9/9 tasks, including TypeScript), `pnpm build` (5/5 tasks),
and `git diff --check`. The first sandboxed test attempt stopped before running
tests because pnpm could not verify its release without registry access; the
network-enabled retry passed. Lint changed no source files. See
[`20260926T123315Z-current-workspace-validation.json`](20260926T123315Z-current-workspace-validation.json).
At 12:35 UTC, redaction scanning passed across the 49 JSON files then present;
no recognized secret-shaped values or prohibited custody fields were found,
and D2/D3 report hashes remain unchanged. See
[`20260926T123500Z-evidence-redaction-scan.json`](20260926T123500Z-evidence-redaction-scan.json).
At 12:41 UTC, a cache-bypassed Turbo build passed all 5 configured build tasks
with 0 cached. At 12:42 UTC, the redaction scan passed across all 51 evidence
JSON files then present, including the build record; D2/D3 hashes remain
unchanged. See
[`20260926T124120Z-forced-workspace-build.json`](20260926T124120Z-forced-workspace-build.json)
and [`20260926T124200Z-evidence-redaction-scan.json`](20260926T124200Z-evidence-redaction-scan.json).
At 12:58 UTC, the fresh local simulated browser suite passed 18/18 in
Chromium and 18/18 in WebKit (36/36 total). Firefox failed to start four times
before app assertions; one attempt was interrupted and 13 tests did not run.
Fixtures blocked external requests and made no Testnet calls or transactions.
The owner reiterated that the project is Talambagv2 and Gas sponsorship is
paused. The latest direct production read remains 12:02 UTC: its ready Testnet
custody row has a deployment identity mismatch, and paused readiness returned
`metadata_disabled` without proving decryption or signing. Keep sponsorship
paused and preserve the record. See
[`browser-regression-summary.json`](browser-regression-summary.json),
[`20260926T130430Z-talambagv2-owner-confirmation.json`](20260926T130430Z-talambagv2-owner-confirmation.json),
and [`20260926T120202Z-production-talambagv2-custody-readback.json`](20260926T120202Z-production-talambagv2-custody-readback.json).
At 13:05 UTC, the evidence redaction scan parsed all 55 evidence JSON files
then present with no recognized secret-shaped values or prohibited
secret/custody field names; D2/D3 hashes remain unchanged. See
[`20260926T130500Z-evidence-redaction-scan.json`](20260926T130500Z-evidence-redaction-scan.json).
The integrator guide is available at
[`docs/velo-gas-station.md`](../../velo-gas-station.md). It builds on the D3
SDK guide, covers managed provisioning and explicit owner activation, keeps
the SDK key server-side, and documents the manual-relayer compatibility path.
The guide is now explicitly included in the Git-visible D4 delivery files.
At 11:46 UTC, the redaction scan passed across 41 D4 JSON evidence files. See
[`20260926T114603Z-evidence-redaction-scan.json`](20260926T114603Z-evidence-redaction-scan.json).

At 10:49 UTC, D2 and D3 historical smoke reports again passed their offline
verifiers with unchanged SHA-256 values. This used no live network and did not
mutate either report. See
[`20260926T104934Z-d2-d3-report-reverification.json`](20260926T104934Z-d2-d3-report-reverification.json).

At 11:04 UTC, 898 direct local tests passed across the backend, web, SDK,
Stellar, wallets, PDAX, observability, both dApp examples, and D2/D3/D4 smoke
tools. Direct Express, Next.js example, and web builds passed; the Turbo SDK
and wallets build tasks passed. The aggregate Turbo build could not complete
because nested `pnpm` signature verification requires registry access unavailable
in this environment. Root Oxlint and the benchmark dry-run passed. The Firefox
suite remains incomplete: its browser launch timed out with macOS
plugin-container/framebuffer errors before app assertions. Offline Cargo
resolution also lacks `visibility`. Chromium and WebKit each passed 18/18 in
the earlier local simulated run. See
[`20260926T110452Z-workspace-validation-reconciliation.json`](20260926T110452Z-workspace-validation-reconciliation.json).
The D4 JSON redaction scan found no secret-shaped values or custody payload
fields.

At 11:16 UTC, the prescribed commands `pnpm lint:fix`, `pnpm build`, and
`pnpm test` passed after the pinned pnpm runtime verified with registry access.
Workspace tests passed 863/863; D2/D3/D4 tooling passed 35/35 and Cargo registry
integration tests passed 11/11. D2/D3 report hashes remain unchanged and the
D4 JSON redaction scan passed across 38 files at 11:22 UTC. Chromium and WebKit passed
18/18 each. Firefox still fails before assertions during browser launch on
this macOS host. Hosted CI, frozen source, production deployment provenance,
and live Testnet acceptance remain open. See
[`20260926T111656Z-full-repository-validation.json`](20260926T111656Z-full-repository-validation.json).

At 10:26 UTC, the safe owner provisioning projection and panel were updated to
expose a deployment-context match without exposing deployment identity or
ciphertext. The panel blocks managed-account funding, resume, activation, and
withdrawal when the binding is false or unknown; pause remains available. A
match does not verify key decryption. Backend tests passed 342/342, web tests
251/251, Chromium/WebKit Gas browser tests 18/18 each, typechecks, changed-file
lint/format, and the configured local Turbopack build. Firefox was not run in
this iteration after its prior browser-launch failure. These are local checks,
not deployed UI or signing proof. See
[`20260926T103422Z-custody-context-ui-guard.json`](20260926T103422Z-custody-context-ui-guard.json).

The point-in-time prerequisite decision is in the
[D4 readiness ledger](readiness-ledger.md); it currently records a no-go for
production campaign transactions.
The [participant validation template](session-validation-template.md) maps the
three-person session, all five named policy demonstrations, owner funding and
activation, withdrawal, rollback, role boundaries, keyboard use, and failure
states.
The [campaign metrics worksheet](campaign-metrics-template.md) keeps per-app
and combined raw denominators, first-attempt/eventual outcomes, retries,
failures, unresolved operations, decision accuracy, and the independently
verified 50-transaction threshold distinct from the recorder's local
consistency counts.

At 06:15 UTC, a sanitized comparison confirmed both local example Gas
configurations use valid Testnet-key shapes, distinct Gas keys and caller
tokens across apps, `development` mode, and loopback API origins. Express
checks passed 15/15 and Next.js checks passed 18/18; both TypeScript checks
passed. The `.env.local` values were not included in the evidence. This is
local readiness only; no deployed integration or Testnet transaction is
claimed. See
[`20260926T061534Z-development-example-credential-separation.json`](20260926T061534Z-development-example-credential-separation.json)
and the earlier local test summary
[`20260926T060821Z-development-example-env-preflight.json`](20260926T060821Z-development-example-env-preflight.json).

At 05:49 UTC on September 26, the operator provided a development UI screenshot
showing an enabled Gas policy with a 10 XLM daily cap, 100 requests per wallet,
and one allowed contract. The project identifier is not visible, and the
screenshot does not establish funding or a settled Testnet transaction. Its
sanitized observation is recorded in
[`20260926T054949Z-development-owner-policy-ui-observation.json`](20260926T054949Z-development-owner-policy-ui-observation.json).

## Acceptance gates

| Gate | Current status | Evidence needed |
| --- | --- | --- |
| Frozen source revision, production deployment, and green hosted CI | Open | At 05:34 UTC the production configured source marker reported `8e8ab152179032c332eaae883bca979624f920d6`, nine commits before local candidate HEAD `e93dddc361da49ccd740ac6fd7b17f0cafaa4692` and before the managed-relayer implementation commit. The deployed function roster contains managed-relayer functions, so this configured marker does not identify the actual deployed source. Verify actual deployed source, freeze the intended revision, then capture hosted CI. See [`20260926T053419Z-production-provenance-check.json`](20260926T053419Z-production-provenance-check.json). |
| Development Convex rollout | Deployed from dirty working tree | Two `convex dev --once` pushes reported `Convex functions ready` on `capable-kingfisher-697`, most recently at 04:24 UTC. At 05:42 UTC, the safe internal status action reconfirmed valid keyring version `v1`, one version retained, the expected dev identity, Testnet network, and enabled provisioning, without returning key material. The aggregate remained 3 rows: 2 ready under the dev identity, none pending there, and 1 failed with no deployment identity. The query did not return project IDs, so it supports but does not identify the operator-reported new project's status. Funding and sponsorship activation remain unverified. No Testnet transaction was submitted by these checks. The deployment used a dirty working tree, not a frozen source revision. The CLI warned that the Convex project is above Free plan limits; resolve that operational notice before relying on uninterrupted validation. See [`development-deployment-summary.json`](development-deployment-summary.json), [`development-provisioning-followup-summary.json`](development-provisioning-followup-summary.json), and [`20260926T054233Z-development-managed-custody-preflight.json`](20260926T054233Z-development-managed-custody-preflight.json). |
| Managed custody configuration, independent keyring backup, and provisioning | Production runtime configuration uses the production identity; Talambagv2's ready row remains tagged with a different identity | At 12:02 UTC, a read-only query matched exactly one Talambagv2 project to its ready Testnet custody row, encrypted at key version `v1`. The row's identity differs from `prod:agreeable-salmon-748`. The owner reports the panel is Ready with a fresh verified balance and sponsorship paused. The internal readiness action returned `metadata_disabled` after the pause and did not prove decryption or signing. Source review confirms retry returns `already_ready` and key rotation refuses a deployment-ID mismatch; neither action repairs this state. Preserve the row; do not relabel or reprovision it. Deployed source SHA remains unverified. See [`20260926T120202Z-production-talambagv2-custody-readback.json`](20260926T120202Z-production-talambagv2-custody-readback.json) and ADR-0005. |
| Owner UI custody-context guard | Implemented locally; deployment open | `gas/queries:getProvisioningStatus` now returns only a nullable boolean indicating whether a ready custody row's deployment ID matches runtime configuration. The owner panel disables funding, resume, activation, and withdrawal when the binding is false or unknown and leaves pause available. This does not prove AES-GCM decryption or signing. Local full tests, typechecks, lint/format, Chromium/WebKit suite, final Turbopack build, and targeted mismatch browser rerun passed. No production code push was made. See [`20260926T103422Z-custody-context-ui-guard.json`](20260926T103422Z-custody-context-ui-guard.json). |

The sanitized production read result is recorded in
[`custody-inventory-summary.json`](custody-inventory-summary.json), and the
development read result is in
[`development-custody-inventory-summary.json`](development-custody-inventory-summary.json).
The latest production custody configuration and inventory checks are in
[`20260926T084217Z-production-custody-inventory-refresh.json`](20260926T084217Z-production-custody-inventory-refresh.json),
[`20260926T083655Z-production-runtime-status-readback.json`](20260926T083655Z-production-runtime-status-readback.json),
and [`20260926T083118Z-production-config-readback.json`](20260926T083118Z-production-config-readback.json).
The earlier 07:04 record captures the approved environment update and the
then-stale runtime status; the 08:42 and 10:09 aggregates supersede its zero-row
inventory result. The latest aggregate contains one ready row tagged with the
development identity and no production-tagged row.
The latest development provisioning aggregate is
[`development-provisioning-followup-summary.json`](development-provisioning-followup-summary.json).
Neither artifact contains a keyring value or custody payload fields. The
development code push result is recorded separately in
[`development-deployment-summary.json`](development-deployment-summary.json).
| Owner funding, activation, pause/resume, and withdrawal | Open | Authenticated owner workflow, fresh ledger/balance observations, policy readback, pause fencing, and consent-bound withdrawal proof. |
| Two runnable dApp integrations | Partial | [Next.js Gas route](../../../examples/nextjs-app-router/app/api/gas/) and [Express Gas route](../../../examples/express/gas-route.ts) are local source integrations. A 12:16 UTC in-memory check confirmed each local `.env.local` has a distinct correctly shaped Gas Testnet key and bounded separate demo token, but both modes are `development`; this is not deployed Testnet configuration. Capture deployed setup and a correlated settled receipt for each. See [`20260926T121626Z-local-two-app-gas-config-check.json`](20260926T121626Z-local-two-app-gas-config-check.json). |
| Three-person validation and policy setup demonstrations | Partial | Two additional participants are available. Record attendance, role-separated actions, and five successful policy setup/readback demonstrations. |
| Sponsored transaction campaign | Open | At least 50 unique settled Testnet FeeBump transactions across both dApps, with exact fee evidence, backend outcomes, ledger receipts, and at least five reviewed explorer examples. |
| Dashboard, accessibility, and handoff artifacts | Open | Live screenshots, keyboard/failure-state evidence, metrics with raw denominators, 3–5 minute demo video, and reviewer access. |

The pre-existing `20260925T*-production-preflight.json` files are historical
preflight snapshots. They are not current deployment, custody, funding, or
transaction evidence and must remain unchanged. The historical D2/D3 reports
also do not count toward the D4 campaign. Their offline verifiers were rerun on
September 26 and both passed; current SHA-256 values and the verification
result are recorded in
[`historical-smoke-verification.json`](historical-smoke-verification.json).
The verification was read-only and did not access a live network.

## Current local validation

- At 09:16 UTC, focused current-checkout regressions passed 43/43: backend API
  key/Gas authorization/relayer/custody inventory/PayAccess mapping tests
  (27/27 across five files), the web API-key UI suite (6/6), and the D4 campaign
  recorder suite (10/10). The run used local HEAD `e93dddc` with an unfrozen,
  modified working tree. It verifies only those focused boundaries; full hosted
  CI, production source identity, project-mapped custody, and Testnet campaign
  acceptance remain open. See
  [`20260926T091620Z-focused-d4-source-regressions.json`](20260926T091620Z-focused-d4-source-regressions.json).
- At 09:31 UTC, the backend focused suite passed 33/33 across six files after
  adding rollback coverage: an existing managed signer remains usable with
  provisioning disabled, and a new provisioning attempt fails closed without
  publishing an address while leaving the project available. Backend Oxlint,
  Oxfmt, and `git diff --check` passed. Together with the unchanged 09:16 web
  and recorder runs, the focused set totals 49/49. These are local checks on
  unfrozen HEAD `e93dddc`; live rollback, reconciliation, execution recovery,
  withdrawal, hosted CI, and campaign acceptance remain open. See
  [`20260926T092948Z-focused-d4-rollback-regressions.json`](20260926T092948Z-focused-d4-rollback-regressions.json).
- At 09:34 UTC, the full backend suite passed 341/341 across 46 files after
  making its scheduled-provisioning assertion deterministic. Backend Convex
  typecheck passed; D2 and D3 historical reports passed their respective
  offline verifiers. Frozen source, hosted CI, production provenance, and live
  acceptance remain open.
- At 09:36 UTC, all 49 focused regressions passed again, and the complete
  backend suite remained 341/341. D2/D3 historical reports passed their
  respective offline verifiers; current SHA-256 values match the recorded
  hashes and neither verifier wrote a report.
- At 09:44 UTC, review found and fixed a UI compatibility case: legacy API keys
  with no `purpose` remain visible as General API access. The focused set now
  passes 50/50; the full web suite passes 250/250, and the full backend suite
  passes 341/341. Backend/web typechecks plus changed-file lint and format
  checks passed. Production provenance, reviewer access, live rollback, and
  campaign acceptance remain open.
- At 09:53 UTC, the owner-only safe key projection now labels purpose-less rows
  `legacy`, so the UI shows their retained General and Gas scopes and the
  checkout selector still offers them. Focused tests pass 51/51; full backend
  and web suites pass 341/341 and 251/251. Both typechecks and changed lint/
  format checks pass. Hosted CI and live campaign gates remain open.
- At 10:00 UTC, `next build` completed with Turbopack, and both the backend and
  web TypeScript checks remain green. The initial sandboxed build attempt was
  blocked by local process/port permissions; the successful retry only compiled
  the local app. This is not a deployment or hosted CI result.
- At 06:35 UTC, direct local regression suites passed backend 337/337, web
  249/249, SDK 71/71, Stellar 117/117, Next.js example 18/18, Express example
  15/15, wallets 23/23, PDAX 16/16, D2/D3 smoke plus D4 campaign recorder
  35/35, and observability 9/9 (**890 tests total**). Relevant package
  TypeScript checks passed at that snapshot. These are working-tree results,
  not hosted CI or a frozen revision, and predate the latest shared Gas runtime
  environment reader change.
  Focused regressions verify duplicate Registry project mappings remain
  unchanged, the sync cursor stays put for retry, and duplicates cannot be
  assigned to another Velo project. The operator reported the guarded warning
  in an unspecified Convex deployment; no project mapping was repaired. See
  [`20260926T063557Z-workspace-validation-followup.json`](20260926T063557Z-workspace-validation-followup.json)
  and the focused warning record
  [`20260926T063021Z-pay-access-ambiguity-followup.json`](20260926T063021Z-pay-access-ambiguity-followup.json).
- Both sample Gas configuration loaders now require the issued
  `tg_test_[a-f0-9]{32}` credential shape, enforce the canonical Testnet API
  origin, and allow loopback origins only in development mode. The Next.js
  example uses Gas-specific `VELO_GAS_ENV` and `VELO_GAS_BASE_URL` variables,
  separate from Checkout's `VELO_ENV` and `VELO_BASE_URL`. Both examples' full
  local suites and TypeScript checks pass; this does not establish deployed
  acceptance.
- Local production builds passed for the SDK, wallet bundle, Express example
  TypeScript, Next.js example, and web app. The fresh web build resolved the
  already-installed Tailwind PostCSS package from the local pnpm store because
  its workspace symlink is absent in this install. The workspace `pnpm build` and
  `turbo run build` wrappers exited before three uncached package tasks because
  the installed pnpm wrapper could not verify its signed registry identity in
  the restricted network. The direct `turbo run test` aggregate also failed at
  pnpm-backed SDK, wallet, and Stellar tasks; each package test suite passed
  when invoked directly. Running the lockfile-pinned Turbo binary directly,
  staging the already-built wallet bundle, and invoking the package build tools
  directly succeeded. The web build needed local loopback permission for
  Turbopack's instrumentation process; its unrestricted local rerun completed.
- Changed-source Oxlint passed. Repository-wide Oxlint exited 0 with five
  warnings in unchanged `scripts/observability-assets.test.mjs`. The fresh
  Oxfmt `--check` passed for 39 of 40 selected changed source files. The
  remaining `project-integration.tsx` retains its known class-order difference
  from the branch baseline; it was not reformatted. Convex's tool-generated
  `_generated/api.d.ts` was not included.
  `git diff --check` passes.
- After the sidebar-navigation regression was corrected to navigate from API
  Keys through the collapsed Pay group, the complete simulated Gas browser suite
  passed all 17 scenarios in Chromium and all 17 in WebKit (**34 total across
  both browsers**). This covers
  role boundaries, managed funding/activation/pause/withdrawal flows, keyboard
  and accessibility states, and the Gas API-key flow. The full Firefox attempt
  failed to launch its first two tests, then was interrupted during the third
  after repeated 180-second launch timeouts: macOS denied the Firefox
  plugin-container sandbox extension and its headless compositor could not map
  a framebuffer. No Firefox application assertions ran. One further
  sandbox-disabled startup attempt was interrupted before a result and is not
  counted. The sanitized summary is in
  [`browser-regression-summary.json`](browser-regression-summary.json). These
  browser checks use local fixtures and are not production evidence.
- Named regression mapping required by the sprint plan:
  - Backend authorization and owner controls: `Gas console capabilities
    enforce owner/editor/viewer roles`, `Gas console access rejects
    unauthenticated, non-member, and cross-project callers`, `Gas
    authorization accepts Gas and legacy keys but rejects newly scoped general
    keys`, `managed sponsorship activation requires the owner and uses only
    active linked contracts`, `managed activation stays disabled without active
    contracts and maintenance blocks policy changes`, `Testnet faucet claims
    are owner-scoped and a request cooldown survives uncertain responses`,
    `owner withdrawal confirmation pauses sponsorship behind a maintenance
    lock and safe cancel releases it`, and `relayer upsert is owner-only,
    Testnet-bound, collision-safe, and balance-preserving`.
  - Custody/relayer lifecycle: `new project queues provisioning atomically and
    publishes only the committed address`, `concurrent provisioning workers
    commit one encrypted candidate and discard the rest`, `rotates ciphertext
    metadata without changing the account and rejects stale rotation commits`,
    `missing encryption configuration leaves the project usable and stores no
    address`, `managed custody status is owner-authorized and never returns
    encrypted fields`, internal-only `custody configuration status returns
    version metadata but never key material`, safe missing/invalid-keyring
    status, and the `managed custody inventory groups only counts by deployment
    and status` redaction test.
  - SDK/UI: `gas.sponsor sends the exact server request and projects the
    reservation`, `gas.sponsor preserves replay identity and exact amount
    strings`, `gas.submit sends the bounded handoff with normalized identity
    and headers`, and the browser scenario `generates a Gas-only Testnet API key
    once for the project owner`.
  - Sample integrations: Express `unauthorized callers are rejected before
    SDK execution`, Express `successful execution uses stable idempotency and
    returns an allowlisted result`, and Next.js `the workflow keeps idempotency
    stable and recovery observes with identity only`.
- The Express route accepts only a user-signed inner transaction, keeps its API
  key server-side, and uses Gas-specific environment variables. Neither sample
  app is deployed acceptance evidence. A loopback HTTP integration test is
  unavailable in the current sandbox because listener creation is denied.
- The API Keys page now generates a dedicated Gas Station · Testnet key for
  `VELO_GAS_API_KEY`; backend purpose checks isolate newly scoped Gas keys from
  Checkout and general APIs. Deployment and verification on the designated
  Testnet web/backend deployment remain open.
- The campaign recorder accepts sanitized outcomes only. Its
  `consistentSuccessCandidates` value is a local consistency check, not an
  independent ledger or reviewer attestation. Verify source records, backend
  snapshots, and Testnet receipts before counting any result. After expanding
  its credential filter to include `tg_test_`, the focused recorder tests pass
  10/10; focused Oxlint, Oxfmt, and `git diff --check` also pass. The matching
  JSON Schema label filter rejects the same Gas-key shape.
- The internal `gas/custody_internal:getManagedCustodyInventorySummary` query
  returns only aggregate counts grouped by deployment identity and status. It
  is intended to establish whether changing a deployment's AEAD context is
  safe. Its local 2/2 tests pass; a read-only call on production at 06:56 UTC
  returned zero records. The call returned no project IDs or custody payload.
- A local in-memory comparison at 07:00 UTC confirmed the development and
  production backup keyring files both use active version `v1` and contain
  different active key material. Neither values nor hashes were emitted. The
  production environment keyring itself was not read or compared.

## Campaign report

When live validation begins, append each already-observed outcome to:

- `transactions.json` — complete sanitized campaign record, including expected
  denials, failures, and unresolved outcomes.
- `transactions.csv` — locally consistent settled-success candidates only,
  with the matching project's custody, provisioning, funding, and activation
  observations.

Use a protected local file for each sanitized input, with no XDR, API key,
bearer token, JWT, Stellar seed, ciphertext, nonce, or authentication tag:

```bash
node --experimental-strip-types scripts/gas-d4-campaign.mjs \
  --json docs/instawards/d4-evidence/transactions.json \
  --csv docs/instawards/d4-evidence/transactions.csv \
  < /secure/path/one-sanitized-outcome.json
```

The exact input contract is in
[`scripts/gas-d4-campaign-input.schema.json`](../../../scripts/gas-d4-campaign-input.schema.json).
The recorder rejects Mainnet metadata, credential-shaped labels (including the
`tg_test_` Gas-key format), undeclared projects, mismatched custody deployment
identity, relayer substitution, duplicate operations/hashes, and unknown
fields. It does not submit or retry transactions.

## Required final handoff

Before D4 is marked complete, add the reviewed sanitized manifest and receipts,
live dashboard screenshots, video and reviewer links, source/deployment
provenance, hosted CI evidence, policy and role demonstrations, campaign
metrics, and remaining risks. Preserve raw denominators, keep expected denials
separate from eligible traffic, and ensure all evidence refers to the same
frozen revision and Testnet deployment.
