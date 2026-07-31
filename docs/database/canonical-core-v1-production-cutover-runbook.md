# Canonical Core V1 Production Cutover and Legacy Retirement Runbook

**Approved planning scope:** 2026-07-28  
**Protected production core:** Reception, billing/invoice/payment/collection, hospital setup/master data, doctor/practitioner setup and commission, plus their required auth/audit dependencies  
**Current production mutation authorization:** none  
**Primary branch:** `program/cdb-main-continuous-20260725`

## 1. Goal

Move the protected production core from legacy authority to Canonical Core V1 without losing patient identity, reception workflow, configuration, money, audit or doctor commission evidence. The transition must be reversible until the approved rollback window closes.

This runbook separates repository preparation from production execution. Completing local implementation or a protected-clone rehearsal does not authorize access to or mutation of production.

## 2. Canonical Core V1 boundary

Canonical Core V1 contains only the live production facts required by:

- hospital/tenant setup and required configuration;
- departments, services/tests and effective pricing used by Reception and billing;
- users, roles, permissions and audit dependencies used by the live core;
- patient identity and tenant-patient linkage;
- practitioner identity and required doctor setup;
- appointment/check-in/queue/visit/encounter linkage used by Reception;
- invoices and typed invoice lines;
- receipts, tenders, allocations, deposits, credits, refunds and reversals that are active in production;
- doctor commission rules, accruals, corrections and settlements that are active in production;
- Canonical governance, source mappings, reconciliation, feature flags, idempotency and outbox evidence.

Lab, Radiology, Emergency, OT, Nursing, Pharmacy, Inventory, Procurement, Insurance, Payroll, Expense, Direct Income and Patient Mobile are not part of the production cutover unless an exact dependency audit proves a live protected-core dependency.

## 3. Non-negotiable invariants

1. Every money value is compared and stored in integer minor units.
2. Invoice net, allocated amount, paid amount, due amount, deposit liability, refunds, reversals and commission balances must reconcile exactly.
3. Debit and credit totals must remain exactly equal for any accounting entries included in the approved scope.
4. Patient, practitioner, appointment and encounter mappings require exact evidence; ambiguous rows become processing issues.
5. No historical invoice, payment, refund, reversal, commission or signed audit event is hard-deleted as a correction.
6. Every backfill is tenant-bounded, resumable, idempotent and second-pass stable.
7. Every provider defaults safely to the current production path until explicitly enabled for the authorized scope.
8. The legacy database remains recoverable and read-only through the rollback and retention window.
9. Unexplained reconciliation variance must be zero before any read or write promotion.
10. Every cutover action is bound to an exact commit, build, migration manifest, tenant or bounded scope, operator, timestamp and rollback command.

## 4. Programme checkpoints

### CDB-V1-000 — Course correction and checkpoint preservation

- freeze broad authority expansion at `CDB-127E`;
- review and checkpoint verified CDB-122 through CDB-127E work;
- synchronize the policy, control center, authority matrix, tracker and handoff;
- record all live branch/worktree ownership;
- do not start `CDB-128A` while Core V1 is primary.

**Exit:** one reviewed programme state and one exact next task.

### CDB-V1-010 — Protected production-core surface inventory

Create an exact repository inventory for:

- HTTP routes and UI flows;
- direct and indirect writers;
- operational and reporting readers;
- scheduled jobs, exports and background consumers;
- tables, views, triggers and provider flags;
- tenant, permission, idempotency and audit dependencies;
- all legacy retirement allowances.

For every surface record:

- current legacy table or service;
- intended Canonical authority or provider;
- active production proof;
- money or identity risk;
- migration/backfill requirement;
- read-promotion requirement;
- rollback requirement;
- retirement gate.

**Exit:** zero unknown protected-core writers or readers.

**Completed locally on 2026-07-28:** `docs/database/protected-core-v1-surface-inventory.json` records 875 surfaces (44 HTTP routes, 28 UI flows, 218 writers, 462 readers, 83 tables, 22 target providers/contracts, 6 reports, 1 scheduled job, 3 exports and 8 shared dependencies) with zero unknown writer or reader assignments. Review evidence: `docs/database/audits/2026-07-28-protected-production-core-surface-inventory.md`. No production access, mutation, activation, deployment or retirement was performed.

### CDB-V1-020 — Core V1 authority and contract freeze

- freeze the exact Core V1 table and command set;
- map each live fact to one Canonical owner;
- define public IDs, tenant ownership, status vocabularies and correction rules;
- define exact route/API compatibility requirements;
- define reconciliation equations and abort conditions;
- define which legacy tables remain history, compatibility or retirement candidates.

**Exit:** no unresolved duplicate authority inside Core V1 and no non-production scope leakage.

**Completed locally on 2026-07-28:** `docs/database/protected-core-v1-authority-contracts.json` freezes 22 protected concept contracts with 19 Canonical table owners, 2 governed external authorities and 1 governed metric registry. Unresolved duplicate authority and non-production scope leakage are both zero. Exact command/provider keys, public-ID and tenant rules, status/correction contracts, minor-unit equations, compatibility routes, migration/second-pass rules, rollback and retirement gates are fixed. Audit: `docs/database/audits/2026-07-28-core-v1-authority-contract-freeze.md`. No production access, mutation, provider activation, deployment, traffic change or retirement was performed.

### CDB-V1-030 — Protected-core Canonical command coverage

- route every approved protected-core mutation through a reviewed Canonical or atomic compatibility command;
- preserve current HTTP behaviour until cutover;
- ensure source mapping, idempotency, audit/outbox and compatibility mutation occur in one transaction boundary;
- block or classify every direct legacy writer under Canonical strict mode;
- test replay, concurrency, tenant isolation, rollback and financial exactness.

**Exit:** zero unknown or unclassified protected-core writer boundaries.

**Baseline completed locally on 2026-07-28:** `docs/database/protected-core-v1-writer-command-coverage.json` classifies all 218 protected writers against the frozen CDB-V1-020 contracts: 107 Canonical-command writers, 43 atomic-compatibility writers, 3 governed-external writers, 61 command-required writers and 4 isolated fixtures, with zero unclassified writers. This is `CDB-V1-030A`; full CDB-V1-030 command coverage is not complete until the 61 command-required writers are implemented or integrated. Audit: `docs/database/audits/2026-07-28-protected-writer-command-coverage-baseline.md`. No production action was performed.

**CDB-V1-030B1 completed locally on 2026-07-28:** immutable `createCompensationRule`, `replaceCompensationRule` and `retireCompensationRule` commands now implement the frozen practitioner-compensation-rule boundary with exact tenant/service/practitioner identity, integer rule values, optimistic versions, replay/conflict protection, atomic compatibility statements, source mapping and outbox evidence. Existing command boundaries increase to 17; the two protected route writers remain command-required until CDB-V1-030B2 integration. Audit: `docs/database/audits/2026-07-28-compensation-rule-command-implementation.md`. No production action was performed.

**CDB-V1-030B2 completed locally on 2026-07-28:** doctor commission rule create/replace/delete and diagnostic performer rule create/replace/disable now commit legacy compatibility, audit, exact reference bootstrap, immutable Canonical rule version, source mapping and outbox in one D1 batch. Migration `0561` adds a nullable tenant-unique stable source key without rewriting existing rows. The two protected route writers move to atomic compatibility; command-required writers reduce to 61. Audit: `docs/database/audits/2026-07-28-compensation-rule-route-integration.md`. No production action was performed.

**CDB-V1-030C completed locally on 2026-07-28:** protected doctor create, identity update, activation and deactivation now commit legacy compatibility, audit, exact practitioner identity/account-link evidence, source mapping, idempotency receipt and outbox in one D1 batch. Migration `0563` adds a nullable tenant-unique doctor source key without rewriting existing rows; `0562` remains reserved for the isolated Operation Theatre lane. Existing exact practitioner mappings are reused, BMDC and classification corrections remain append-only, linked user evidence retires on deactivation and live compensation consumes the same stable doctor source identity. The `doctors.ts` / `doctors` writer moves to atomic compatibility; command-required writers reduce to 60 and remaining implementation groups reduce to 15. Audit: `docs/database/audits/2026-07-28-practitioner-route-integration.md`. No production action was performed.

**CDB-V1-030D completed locally on 2026-07-28:** protected settings patient import now derives a tenant-scoped hashed batch/row source identity and commits the explicit-ID legacy patient row, non-PHI audit, unlinked Canonical tenant-patient relationship, immutable link event, source mapping, idempotency receipt and outbox in one D1 batch. Migration `0564` adds nullable tenant-unique patient import source identity without rewriting existing patients. Imported rows do not match or merge by name, phone, label, numeric coincidence or time and do not claim a global UHID without exact reviewed evidence. The `settings-import-export.ts` / `patients` writer moves to atomic compatibility; command-required writers reduce to 59 and remaining implementation groups reduce to 13. Audit: `docs/database/audits/2026-07-28-patient-import-identity-route-integration.md`. No production action was performed.

**CDB-V1-030E completed locally on 2026-07-29:** the four remaining appointment-intent writers now use reviewed atomic boundaries. Doctor and queue mutations require exact patient, practitioner, appointment and encounter mappings and commit compatibility, audit, Canonical status/link facts, source mapping, idempotency receipt and outbox together. Doctor reassignment creates immutable reschedule lineage. Doctor schedules remain practitioner-linked domain extensions with versioned source mappings, while appointment billing remains a strict finance projection rather than planning authority. Migrations `0565` and `0566` add nullable tenant-unique route identities without rewriting existing rows. Protected coverage is now 219 writers with 49 atomic-compatibility and 55 command-required writers across 12 remaining groups. Audit: `docs/database/audits/2026-07-29-appointment-intent-route-integration.md`. No production action was performed.

**CDB-V1-030F completed locally on 2026-07-29:** the four remaining encounter-care-episode writer pairs in doctor signed completion, doctor visit conclusion, queue visit lifecycle and direct visit routes now use reviewed encounter commands. `completeEncounter`, `replaceEncounterParticipant` and composite command preparation extend the existing encounter authority without a duplicate owner. Migration `0567` adds nullable tenant-unique visit source identity without rewriting existing rows. Direct visit creation, participant replacement, IPD discharge, queue conclude/cancel and doctor signed completion now commit compatibility, exact patient/practitioner/appointment/encounter evidence, audit, mapping, idempotency and outbox atomically. Protected coverage is now 219 writers with 53 atomic-compatibility and 51 command-required writers across 11 remaining groups. Audit: `docs/database/audits/2026-07-29-encounter-care-episode-route-integration.md`. No production action was performed.

**CDB-V1-030G completed locally on 2026-07-29:** the four remaining service-delivery-event writers in direct billing, appointment finalisation, provisional cancellation and direct visit consultation now use reviewed service request/event commands. Billing or acceptance creates an `accepted` event with zero fulfilled quantity and does not claim delivered care. Exact service, patient, encounter and practitioner evidence, compatibility rows, financial assertions, audit, source mappings, idempotency receipts and outbox events commit atomically. Migration `0568` adds nullable tenant-unique source identity to `visit_services` and `billing_provisional_items` without rewriting existing rows. Protected coverage is now 223 writers with 57 atomic-compatibility and 47 command-required writers across 10 remaining groups. Audit: `docs/database/audits/2026-07-29-service-delivery-event-route-integration.md`. No production action was performed.

**CDB-V1-030H completed locally on 2026-07-29:** refund compensation reservation/release, diagnostic performer reserve cancellation, doctor commission cancellation, commission approval and settlement are bound to reviewed compensation commands or guarded atomic compatibility boundaries. `prepareCompensationAdjustment` composes legacy cancellation/audit with immutable Canonical adjustments. Exact source mapping and integer-minor-unit payable evidence are required in shadow/strict modes; paid compensation still requires explicit settlement reversal. Protected coverage is now 226 writers with 66 atomic-compatibility and 41 command-required writers across 9 remaining groups. Audit: `docs/database/audits/2026-07-29-practitioner-compensation-accrual-adjustment-integration.md`. No production action was performed.

**CDB-V1-030I completed locally on 2026-07-29:** cash custody now has implemented record, reversal and session-close commands plus a strict `cash-custody.movement` adapter. Billing-counter handover, executed-refund cash return and refund-dispute recovery commit compatibility, exact integer-minor-unit custody evidence, source mapping, idempotency and outbox atomically. Compensation settlement reuses the exact route practitioner mapping and avoids numeric-ID duplicate practitioners. The five target settlement pairs plus two adjacent guarded billing-counter writers were promoted. Protected coverage is now 226 writers with 73 atomic-compatibility and 34 command-required writers across 8 remaining groups; command authority is 18 existing and 2 contract-only boundaries. Audit: `docs/database/audits/2026-07-29-practitioner-compensation-settlement-cash-custody-integration.md`. No production action was performed.

**CDB-V1-030J completed locally on 2026-07-29:** the five remaining cash-custody implementation-group writers now cross reviewed boundaries without promoting workflow or projection rows as physical-cash authority. Counter-session stale close/workstation heartbeat remains guarded workflow state; appointment employee-cash rows are compatibility projections inside `appointment.billing.finalize`; bKash/Nagad gateway settlement is explicitly non-cash; cash-ledger projection bridges atomically to accounting and custody outbox/mapping evidence; and payment void uses the existing cash-only reversal custody event. Protected coverage remains 226 writers with 78 atomic-compatibility and 29 command-required writers across 7 remaining groups. Audit: `docs/database/audits/2026-07-29-cash-custody-writer-integration.md`. No production action was performed.

**CDB-V1-030K completed locally on 2026-07-29:** refund cash-hold/dispute workflow rows, gateway and payment-void income projections, and executed-refund legacy credit-note reversal are now bound to the existing credit-note, cash-refund, cash-refund-reversal, gateway-settlement and payment-reversal authorities. Cash-return and dispute are mutually exclusive, gateway receipts remain non-cash, paid practitioner compensation blocks payment reversal, and compatibility plus Canonical evidence rolls back atomically. Protected coverage remains 226 writers with 83 atomic-compatibility and 24 command-required writers across 6 remaining groups. Audit: `docs/database/audits/2026-07-29-credit-refund-payment-reversal-integration.md`. No production action was performed.

**CDB-V1-030L completed locally on 2026-07-29:** appointment payment receipt, gateway log/payment compatibility and payment-void negative receipt rows are now bound to the existing invoice-full-payment, gateway-settlement and payment-reversal authorities. Exact receipt, tender, allocation, deposit and reversal lineage commits with compatibility, source mapping, idempotency and outbox evidence; stale appointment/gateway state and paid compensation fail closed. Protected coverage remains 226 writers with 87 atomic-compatibility and 20 command-required writers across 5 remaining groups. Audit: `docs/database/audits/2026-07-29-payment-receipt-tender-allocation-integration.md`. No production action was performed.

**CDB-V1-030M completed locally on 2026-07-29:** service-item create/update/copy/deactivation, billing price-matrix writes, price-category mapping and settings CSV service import now cross the implemented service-catalog and effective-price commands. Migration `0569` adds nullable tenant-unique source identity without rewriting existing service or price-map rows. Exact tenant/service/price-category identity, BDT integer-minor-unit price evidence, non-overlapping effective intervals, immutable replacement/retirement, replay conflict, stale evidence, tenant isolation and complete atomic rollback are verified. Protected coverage is now 235 writers with 117 Canonical-command, 96 atomic-compatibility and 15 command-required writers across 4 remaining groups; command authority is 19 existing and 1 contract-only boundary. Audit: `docs/database/audits/2026-07-29-service-catalog-pricing-integration.md`. Reviewed local `main` source `fb4565ba0` was synchronized into the CDB branch; no production action, activation, deployment, push or CDB-to-main integration was performed.

**CDB-V1-030N completed locally on 2026-07-29:** the unused direct bill updater was removed from `src/lib/billing-payment-state.ts`, and eight live bill, invoice-line, gateway-deposit and bill-restoration compatibility writer pairs now cross existing invoice, full-payment, gateway-settlement, cash-refund-reversal and payment-reversal command boundaries. Exact invoice/deposit/allocation identity, BDT integer-minor-unit evidence, replay conflict, stale/concurrent rejection, tenant isolation and complete atomic rollback are verified. Protected coverage is now 234 writers with 117 Canonical-command, 104 atomic-compatibility and 6 command-required writers; only the `canonical_outbox_atomic_assertions` implementation group remains. Fresh verification passed 12 files / 81 tests, TypeScript, the 504-migration manifest and full Canonical governance. Audit: `docs/database/audits/2026-07-29-invoice-deposit-reporting-integration.md`. No production query, mutation, migration/backfill, provider activation, deployment, traffic change, push or CDB-to-main integration was performed.

**CDB-V1-030O completed locally on 2026-07-29:** all six remaining `accounting_posting_events` writer pairs now cross registered Canonical outbox and atomic financial-assertion boundaries. Refund commission replay recovery uses `canonical.refund_commission.impact`; authorized refund-dispute write-off uses `canonical.refund_dispute.writeoff`. Exact replay, changed replay conflict, tenant isolation, deterministic source-event identity, non-PHI evidence hashes, guarded row counts and complete stale-state rollback are verified. Protected coverage remains 234 writers with 117 Canonical-command, 110 atomic-compatibility, 3 governed-external, 0 strict-blocked, 0 command-required and 4 isolated-fixture writers, with zero unclassified writers and zero remaining implementation groups. The registry marks protected command coverage complete and routes to CDB-V1-040. Audit: `docs/database/audits/2026-07-29-canonical-outbox-atomic-assertion-integration.md`. No production query, mutation, migration/backfill, provider activation, deployment, traffic change, push or CDB-to-main integration was performed.

### CDB-V1-040 — Canonical read providers and shadow comparison

**CDB-V1-040A completed locally on 2026-07-29:** tenant-selected invoice, payment/allocation and patient-deposit read-provider libraries now support `legacy`, `shadow` and `canonical` modes while defaulting and rolling back to legacy. Canonical mode requires one exact tenant-scoped source mapping; shadow mode returns the legacy projection while persisting exact row keys, normalized status, BDT integer-minor-unit totals, row counts, deterministic variance IDs, latency and build evidence in `canonical_reconciliation_runs`. The frozen authority contract records these three provider boundaries as existing but production-disabled, increasing implemented providers to 9 and leaving 9 contract-only. Deterministic coverage is 951 surfaces, 235 writers, 519 readers and 85 tables, with 118 Canonical-command, 110 atomic-compatibility and zero command-required writers. No application consumer was switched, no protected-clone batch was run, and no production query, provider activation, deployment, traffic change, migration/backfill, push or CDB-to-main integration occurred. Audit: `docs/database/audits/2026-07-29-financial-read-provider-foundation.md`.

**CDB-V1-040B completed locally on 2026-07-30:** invoice, payment and deposit providers now cross stable legacy-default consumer adapters for billing detail, report, dashboard, export, scheduled job and admin reads. The invoice inspector is the first actual application consumer; default behaviour remains legacy. A bounded local SQLite/D1 shadow batch exercised all six consumer IDs, persisted six passed reconciliation rows with exact source/Canonical keys, build SHA and zero variance, and retained immediate legacy rollback. Batch execution fails closed on duplicate scope, provider failure, non-shadow selection, missing evidence/mapping, unexplained variance and latency breach. Invoice settlement normalization now includes active deposit applications without collapsing cash paid and deposit-applied response fields. Deterministic coverage is 952 surfaces, 235 writers, 520 readers and 85 tables; repository access evidence is 1,032 writers and 2,703 readers. No protected clone or production source was queried, no provider was activated and no deployment, traffic change, migration/backfill, push or CDB-to-main integration occurred. Audit: `docs/database/audits/2026-07-30-financial-read-consumer-shadow-batch-integration.md`.

**CDB-V1-040C completed locally on 2026-07-30:** the remaining patient identity, practitioner identity, Reception appointment/encounter/admission and compensation-accrual readers now cross bounded legacy-default provider consumers. Reception patient context observes five provider families without changing its response; unauthorized Canonical response promotion fails closed. Doctor commission accrual reads use `canonical_compensation_accrual_provider_v1`, exact source mapping and integer BDT minor-unit parity. A six-record local SQLite/D1-equivalent batch persisted six passed reconciliation rows with exact row keys, build evidence and zero unexplained variance. The protected-clone package is prepared but not authorized or executed. Deterministic coverage is 954 surfaces, 235 writers, 522 readers and 85 tables; repository access evidence is 1,033 writers and 2,705 readers; provider boundaries are 10 existing and 8 contract-only. Audit: `docs/database/audits/2026-07-30-critical-read-provider-consumer-integration.md`.

- add provider-selected reads for patient/practitioner, Reception episode, invoice, payment/allocation and commission views;
- compare legacy and Canonical results on identical bounded inputs;
- persist counts, row keys, status, minor-unit totals and variance IDs;
- include dashboards, exports, scheduled jobs and admin tools;
- preserve immediate provider rollback.

**Exit:** all critical readers can run Canonically with zero unexplained variance on a protected clone.

### CDB-V1-050 — Protected-clone migration, backfill and rollback rehearsal

The repository-side authorization contract is implemented by:

- `scripts/canonical/protected-clone-rehearsal-authorization.ts`;
- `scripts/canonical/validate-protected-clone-rehearsal-authorization.ts`;
- `scripts/canonical/check-protected-clone-rehearsal-readiness.ts`;
- `docs/database/cdb-v1-050-protected-clone-rehearsal-readiness.json`.

The authorization document must be a protected regular JSON file outside the repository. It must bind the exact protected clone, source snapshot and backup checksums, current branch/commit/build and governance package checksums, tenant-bound source-row scopes, ordered migration and bounded backfill checksums, named execution/rollback/observation owners, a current UTC window and zero-tolerance acceptance thresholds. Generic continuation approval is not execution authorization. Production access, deployment, traffic changes, local-sync activation, legacy retirement, push and CDB-to-main integration remain forbidden.

On an authorized protected clone or approved sanitized export:

1. bind the exact source snapshot and code commit;
2. apply additive Canonical migrations;
3. run bounded backfills;
4. run a second pass and require zero new business rows;
5. verify row counts, mappings, tenant isolation and foreign keys;
6. reconcile all financial equations in minor units;
7. run Reception, billing, payment and commission smoke workflows;
8. rehearse provider promotion and rollback;
9. prove the source snapshot was not mutated;
10. produce a signed rehearsal receipt.

**Exit:** clone rehearsal passes with zero unexplained variance, zero foreign-key violations and a demonstrated rollback.

**Completed 2026-07-30:** `CDB-V1-050-PROTECTED-CLONE-MIGRATION-BACKFILL-AND-ROLLBACK-REHEARSAL-VERIFIED`. The protected local SQLite/D1-equivalent rehearsal applied 19 migrations, completed four bounded backfills with zero second-pass business rows, passed 24 shadow scopes and four smoke workflows, rehearsed nine provider promotions and immediate legacy rollback, and finished with integrity `ok`, FK violations 0 and unchanged source/backup checksums. Sanitized evidence: `docs/database/cdb-v1-050-protected-clone-rehearsal-result.json`. Production execution was not authorized or performed.

### CDB-V1-060 — Production authorization package

Prepare, but do not execute, an exact package containing:

- branch, commit and build identifiers;
- migration manifest and checksums;
- bounded tenant/domain scope;
- approved maintenance or write-freeze procedure;
- backup/export evidence;
- migration and backfill commands;
- reconciliation commands and expected zero-variance results;
- canary provider/traffic settings;
- monitoring queries and named owners;
- abort conditions;
- rollback commands;
- observation duration and acceptance thresholds chosen by the owner;
- legacy retirement actions explicitly excluded from the first cutover.

**Exit:** the repository-side package is complete, internally consistent and non-executable; all external production and owner bindings remain explicit and unresolved until a fresh protected authorization is supplied.

**Completed 2026-07-30:** `CDB-V1-060-PRODUCTION-AUTHORIZATION-PACKAGE-READY`. The sanitized package binds candidate commit `35e299d9ff2dc1781084dacd6d0f431816b0007c`, nineteen exact additive migrations, four bounded backfills, one tenant canary template, nine providers, twelve consumers, nine source tables, eight non-executing command phases, zero-tolerance acceptance and immediate legacy rollback. Repository validation reports `packageReady=true`, `executionReady=false`, issue count 0 and eighteen unresolved external bindings. No production or network action was performed. Evidence: `docs/database/cdb-v1-060-production-authorization-package.json` and `docs/database/audits/2026-07-30-production-authorization-package-preparation.md`.

### CDB-V1-070 — Staged production cutover

Execute only the authorized package:

1. verify commit/build and backup again;
2. apply approved additive migrations;
3. run bounded backfill and second pass;
4. reconcile before traffic promotion;
5. promote Canonical reads for the smallest approved scope;
6. observe and compare;
7. promote Canonical writes only after read evidence passes;
8. keep compatibility writes only as explicitly approved;
9. abort and roll back immediately when a named threshold is crossed;
10. record every action in the cutover receipt.

**Exit:** the authorized scope remains stable for the approved observation window and rollback remains available.

### CDB-V1-080 — Legacy writer and reader retirement

Retire one exact path and table family at a time using `docs/database/legacy-write-retirement-gates.yaml`.

Required gates:

- production cutover complete;
- Canonical read promotion complete;
- observation complete;
- rollback evidence fresh;
- owner authorization present;
- lifecycle-specific retirement approval present;
- zero active direct readers or writers remain;
- protected-core regression green.

Retirement order:

1. block new legacy writes;
2. remove exact writer paths;
3. remove direct legacy readers;
4. retain compatibility views/adapters when needed;
5. mark legacy tables read-only;
6. retain source mappings and archival evidence.

**Exit:** Canonical authority is the only operational authority for the bounded scope.

### CDB-V1-090 — Archive and optional destructive removal

- retain a verified read-only archive for the approved retention period;
- verify no runtime, report, export, support tool or rollback process references the old structures;
- verify legal, financial and clinical retention requirements;
- prepare a separate destructive migration and restore rehearsal;
- obtain fresh destructive authorization before dropping any table, column or row.

**Exit:** optional physical deletion is independently approved and recoverable. Core V1 is already considered Canonical before this optional step.

## 5. Required reconciliation equations

At minimum, the authorized scope must prove:

```text
invoice_net_minor = active_line_gross_minor - active_discount_minor - active_credit_minor
allocated_minor <= receipt_usable_minor
invoice_paid_minor = sum(active_allocations_minor)
invoice_due_minor = invoice_net_minor - invoice_paid_minor
receipt_total_minor = tender_total_minor
refund_minor + reversal_minor never exceeds eligible allocated or liability amount
commission_accrual_minor - commission_adjustment_minor - commission_settlement_minor = commission_outstanding_minor
canonical_total_minor = legacy_total_minor for every approved comparison dimension
```

The exact repository implementation may use more detailed equations. No agent may weaken an existing stricter invariant.

## 6. Abort conditions

The production package must define numeric thresholds before execution. Irrespective of those thresholds, abort immediately on:

- unexplained money variance;
- cross-tenant mapping or data exposure;
- missing or duplicated patient, invoice, payment or commission identity;
- non-idempotent second pass;
- foreign-key or integrity violation;
- provider fallback failure;
- inability to execute the documented rollback;
- unexpected direct legacy writer after write promotion;
- material Reception workflow breakage;
- audit/outbox loss for an authorized mutation.

## 7. Rollback levels

### Provider rollback

Disable the approved Canonical read/write provider and return traffic to the previous compatible path without deleting Canonical evidence.

### Application rollback

Deploy the exact previous reviewed build while keeping additive schema intact.

### Data rollback

Use recorded source mappings, reversal commands and the approved restore procedure. Never use ad-hoc destructive SQL to erase financial or clinical history.

### Full restore

Restore the verified pre-cutover backup only under the approved incident procedure, then reconcile external side effects and issued receipts.

## 8. Legacy retirement is not immediate deletion

A safe successful cutover changes operational authority first. Physical cleanup follows later:

```text
Canonical reads and writes active
→ legacy writes blocked
→ legacy readers removed
→ legacy tables read-only
→ archival retention
→ separately authorized drop
```

The database is architecturally Canonical when the legacy structures no longer act as operational authority, even if read-only archival tables still exist.

## 9. Agent handoff

Every new Core V1 agent must read, in order:

1. `agents.md`
2. `.agent-rules/git-workflow.md`
3. `docs/architecture/hms-production-scope-policy.md`
4. `docs/architecture/hms-canonical-parallel-execution-board.yaml`
5. `docs/architecture/canonical-program-control-center.md`
6. this runbook
7. `task-progress.yaml`
8. `docs/database/canonical-authority-matrix.yaml`
9. `docs/database/legacy-write-retirement-gates.yaml`
10. `.ai-bridge/current-plan.md`

The machine-readable next task is `CDB-V1-010-PROTECTED-PRODUCTION-CORE-SURFACE-INVENTORY`. Production access and mutation remain prohibited until a later exact authorization package is approved.
