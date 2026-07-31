# HMS Canonical Program Control Center

**Last updated:** 2026-07-31T18:52:00+06:00
**Program:** HMS Canonical Data Architecture
**Current roadmap:** `docs/architecture/2026-07-31-post-canonical-production-roadmap.md`
**Current parallel board:** `docs/architecture/post-canonical-parallel-execution-board.yaml`
**Production-scope policy:** `docs/architecture/hms-production-scope-policy.md`
**Authoritative branch:** `main`
**Authoritative worktree:** `/Users/rahmatullahzisan/Desktop/Dev/hms/.worktrees/main-governance-integration-20260723`
**Current checkpoint:** `CDB-V1-071B-PRODUCTION-DEPLOYMENT-COMPLETE`
**Next checkpoint:** `OBS-001-POST-RELEASE-OBSERVATION-BASELINE`
**Production Worker:** `4ff275b8-f17e-4956-a104-e9083a0a1d57` at 100%
**Rollback Worker:** `4f5d8f93-92d4-4fda-8fba-c0a2863f1b71` at 0%
**Production release complete:** yes
**Broad provider-authority promotion complete:** no
**Local-sync activation authorized:** no
**Destructive legacy retirement authorized:** no

> The detailed Gate A/Gate B history below is retained as immutable pre-release evidence. It is not the current next-action instruction. Current work is post-release observation plus bounded non-production repository lanes.

## Production boundary and development authority

The protected production core currently includes Reception, deployed billing/invoice/collection, deployed hospital setup/master data, and doctor commission configuration. These live workflows remain protected with legacy/canonical compatibility; every other workflow is development-only until separately activated.

All workflows outside the protected production core are development-only. Their canonical schemas, commands, providers, reconciliation and consumer migrations may be substantially refactored or fully rewritten locally without waiting for production observation or unused legacy runtime parity. Verified-unused legacy source may be retired only after protected-core dependency and repository-reference checks. Production observation remains a later activation/release gate.

Canonical development authority does not authorize production mutation. Production migrations/backfills, provider flags, route or traffic changes, deployment, any protected-core cutover, local-sync activation and live compatibility retirement each require a separate exact authorization and evidence package. The local hospital server is stopped, so local sync remains disabled/deferred and is not required for current Canonical program completion.

## Owner-approved course correction

The programme no longer treats every unactivated HMS domain as a production migration. The owner confirmed that the live production envelope is limited to Reception, billing/invoice/payment/collection, hospital setup/master data and doctor/practitioner commission dependencies. Therefore:

- Canonical Core V1 production migration and legacy retirement are the primary lane;
- broad CDB authority expansion stops at the verified `CDB-127E` boundary;
- `CDB-128A Operation Theatre` is deferred and is not the next checkpoint;
- Lab, Radiology, Emergency, OT, Nursing, Pharmacy, Inventory, Procurement, Insurance, Payroll, Expense, Direct Income and Patient Mobile are canonical-only greenfield rewrites unless an exact protected-core dependency is proved;
- multiple user-launched agents may work in parallel on independent bounded contexts using dedicated branches/worktrees;
- shared schema indexes, migration manifests, authority registries and central trackers remain serial integration files;
- no non-production lane may change or delay protected-core production behaviour.

The fastest safe execution model is one Core V1 agent, existing Inventory and Patient Mobile agents, one additional isolated domain rewrite agent and one integration/review agent. Exact lane ownership and current branch state are recorded in `docs/architecture/hms-canonical-parallel-execution-board.yaml`.

## 1. Purpose

This document is the first entry point for every new ChatGPT, Codex, or human engineering session working on the HMS canonical architecture. It exists to prevent branch confusion, duplicate architecture, repeated discovery, stale production assumptions, and loss of program history.

A new session must not begin by guessing which branch, document, table, module, or historical production action is current. It must begin here, then follow the required read order below.

The program objective is to bring the full HMS to an international-grade architecture where every shared clinical, operational, inventory, and financial business fact has one authoritative model; all corrections are traceable; historical ambiguity is captured rather than guessed; modules use explicit contracts; and migration, reconciliation, cutover, rollback, observation, and retirement are evidence-driven.

## 2. Required read order for a new session

Read these files in order before changing code or documentation:

1. `agents.md`
2. `.agent-rules/git-workflow.md`
3. `docs/architecture/hms-production-scope-policy.md`
4. `docs/architecture/hms-canonical-parallel-execution-board.yaml`
5. `docs/architecture/non-production-canonical-rewrite-playbook.md`
6. `docs/database/canonical-core-v1-production-cutover-runbook.md`
7. `docs/architecture/canonical-program-control-center.md`
8. `.ai-bridge/current-plan.md`
9. `task-progress.yaml`
10. `docs/database/canonical-authority-matrix.yaml`
11. `docs/database/legacy-write-retirement-gates.yaml`
12. `docs/database/audits/2026-07-26-full-hms-canonical-authority-audit.md`
13. `docs/database/audits/2026-07-26-canonical-authority-access-audit.md`
14. `docs/superpowers/plans/2026-07-26-full-hms-canonical-cutover-completion.md`
15. the design, plan, test, and receipt documents for the current checkpoint

Then verify the selected workspace:

```text
pnpm worktree:check -- --mode=task
```

If the worktree is dirty, inspect every changed file before using `--allow-dirty`. Never adopt unknown changes.

## 3. Source-of-truth hierarchy

When documents disagree, use this hierarchy:

1. Current repository code and tests on the authoritative branch
2. `docs/architecture/hms-production-scope-policy.md` for owner-approved production versus greenfield boundaries
3. `docs/architecture/hms-canonical-parallel-execution-board.yaml` for branch, lane, worktree and shared-file ownership
4. `task-progress.yaml` for machine-readable checkpoint history and exact next action
5. `docs/database/canonical-authority-matrix.yaml` for business-fact ownership
6. `docs/database/canonical-authority-access-registry.yaml` for exact governed code dependencies; use targeted search/checker rather than loading the full file by default
7. `docs/database/canonical-core-v1-production-cutover-runbook.md` for Core V1 cutover and legacy retirement gates
8. This control center for human-readable program navigation
9. `.ai-bridge/current-plan.md` for the shortest active-session handoff
10. Current checkpoint design/plan/receipt documents
11. Historical audits, receipts, and production evidence

Historical production authorization never becomes current authorization merely because it exists in a tracker or receipt.

## 4. Current verified state

### Completed foundations

The program already contains verified canonical foundations for:

- schema governance, migration runs, source mappings, issues, reconciliation, feature flags, outbox, idempotency, and batch assertions;
- practitioner identity and explicit practitioner/user/employee links;
- encounters, participants, admission links, addenda, and bed stays;
- service catalog, effective pricing, service requests, service events, and participants;
- invoices, typed lines, receipts, tenders, allocations, deposits, credit notes, refunds, and reversals;
- practitioner compensation rules, accruals, adjustments, settlements, and allocations;
- inventory items, locations, lots, unit conversions, policies, movements, transfers, and balance projections;
- accounting accounts, mappings, periods, posting jobs, vouchers, entries, cash custody movements, and balances;
- canonical reporting and selected provider-switch boundaries;
- offline local-sync protocol, inbox, outbox conversion, business apply, delivery orchestration, terminal semantics, network-delivery contract, and authentication evidence.

### Authority audit

The full-system authority audit records:

- 46 classified business concepts;
- 18 implemented canonical concepts;
- 16 partial canonical concepts, including six locally complete/provider-disabled authorities that still require runtime or production activation;
- 10 material canonical gaps;
- 2 externally governed concepts;
- 121 registered canonical tables;
- exactly one owner for each registered canonical table;
- 5 currently governed legacy table families;
- 66 exact direct legacy write allowances, all still blocked from retirement.

### CDB-112A authority checker

Implementation commit: `ea4a68ddc`

The fail-closed business-authority checker validates matrix identity, policy, concept uniqueness, canonical table ownership, governed legacy coverage, repository evidence paths, rejected parallel architecture references, and summary counts. It runs through `pnpm canonical:authority-check` and is mandatory inside `pnpm canonical:check`.

### CDB-112B writer and reader access registry

Design commit: `f6230195d`  
Implementation commit: `5e59706d7`

The machine-readable registry and dependency audit are:

- `docs/database/canonical-authority-access-registry.yaml`
- `docs/database/audits/2026-07-26-canonical-authority-access-audit.md`

The deterministic scanner, generator, checker, and tests are:

- `scripts/canonical/canonical-authority-access.ts`
- `scripts/canonical/generate-canonical-authority-access-registry.ts`
- `scripts/canonical/check-canonical-authority-access.ts`
- `test/canonical/canonical-authority-access.test.ts`

Verified repository access evidence:

- 260 unique governed tables;
- 1,002 exact writer `path + table` pairs;
- 2,577 exact reader `path + table` pairs;
- 457 legacy-authority writer pairs;
- 66 canonical-compatibility writer pairs;
- 284 canonical-authority writer pairs;
- 185 migration/backfill writer pairs;
- 10 protected-fixture writer pairs;
- 1,282 legacy reader pairs;
- 306 compatibility reader pairs;
- 900 canonical reader pairs;
- 89 explicitly external reader pairs;
- 0 access-governance issues.

The registry is large machine evidence. A new session should normally read this control center and the human-readable access audit, then use targeted search or the checker rather than loading the complete registry into context.

`pnpm canonical:check` now runs schema governance, business-authority governance, and writer/reader access governance. A new or removed governed access causes a fail-closed drift error until the registry change is explicitly regenerated and reviewed.

### CDB-113A identity and episode foundation design

Design and plan commit: `13d555967`

The reviewed foundation documents are:

- `docs/superpowers/specs/2026-07-26-cdb-113a-identity-episode-foundation-design.md`
- `docs/superpowers/plans/2026-07-26-cdb-113a-identity-episode-foundation.md`
- `test/canonical/identity-episode-foundation-design-contract.test.ts`

The design establishes:

- tenant patient/global identity relationship governance without copying demographics;
- reuse and operational adoption of existing canonical practitioner identity;
- new canonical appointment intent, immutable status history, and explicit appointment–encounter links;
- existing canonical encounter as actual-care authority;
- new canonical admission lifecycle;
- canonical care-location and bed resource identity;
- interval-based bed occupancy through canonical bed stays;
- atomic patient, appointment, encounter, admission, transfer, and discharge command boundaries;
- exact-evidence backfill rules, provider modes, reconciliation equations, cutover, rollback, and retirement gates;
- serial implementation checkpoints CDB-113B through CDB-113F.

The design contract passed 5/5 focused tests and explicitly prohibits phone/name-only identity linking and time-proximity-only care-episode merging.

### CDB-113B patient-link foundation

Implementation commit: `4166cd67d`

The verified patient-link foundation is documented in:

- `docs/database/migration-runs/P11-canonical-patient-link-foundation.md`
- `migrations/0544_canonical_tenant_patient_links.sql`
- `src/db/schema/canonical/patient-identity.ts`
- `src/lib/canonical/commands/register-or-link-patient.ts`
- `scripts/canonical/backfill-tenant-patient-links.ts`
- `scripts/canonical/reconcile-tenant-patient-links.ts`

It provides explicit tenant-patient/global-MPI relationship state and immutable history without copying demographics. Verified links require reviewed exact evidence; ambiguous evidence becomes a processing issue. The command owns deterministic IDs, replay/conflict semantics, version guards, source mapping, event history, and PHI-minimised outbox evidence in one batch. The backfill is bounded and resumable, and reconciliation persists seven fail-closed relationship checks.

Fresh verification passed 3 focused files/18 tests, the complete 185-file/1,325-test canonical suite, TypeScript, all three governance gates, and a 476-entry migration manifest. Local sync remains 0/8 ready and legacy retirement remains 0/65 eligible.

### CDB-113C practitioner operational adoption

Implementation commits:

- audit and plan: `c4d37b3d5`;
- additive operational schema: `e069abd55`;
- practitioner commands: `5448044d4`;
- disabled provider adapters: `cdfb90ff6`;
- backfill hardening and reconciliation: `ac4915e25`.

The verified receipt is `docs/database/migration-runs/P11-canonical-practitioner-operational-adoption.md`.

CDB-113C reuses the six existing canonical practitioner tables and adds positive versioning plus source-evidence hashes. It provides internal/external create, update/retire, user and employee link lifecycle, identifier lifecycle, specialty/department assignment, deterministic replay, source-mapping conflict protection, atomic compatibility statements, and PHI-minimised outbox evidence.

The disabled `canonical_practitioner_provider_v1` supports legacy, shadow, and canonical modes. Missing or disabled configuration remains legacy. Identity-sensitive operations require an explicit source mapping; display name, contact details, specialty, department, or numeric-ID coincidence are never identity evidence. Disabled-safe adapters exist for global/search resolution, appointment validation, marketplace listing, and encounter participant resolution.

The existing practitioner backfill now records actual source-evidence hashes for new rows and preserves resumable, zero-new-row second-pass behavior. Persistent reconciliation records ten fail-closed checks for source cardinality, identifiers, user/staff links, unresolved ambiguity, status parity, name-only collapse, tenant safety, and orphan associations.

Fresh verification passed 11 focused files/77 tests, the complete 190-file/1,351-test canonical suite, TypeScript, all three governance gates, and a 477-entry migration manifest. The access registry now records 827 writers and 1,944 readers. Local sync remains 0/8 ready and legacy retirement remains 0/65 eligible.

Practitioner identity remains `partial_canonical`: four legacy doctor writer paths, the external-referrer route, `doctor_auth` separation, the disabled provider flag, current doctor/referrer readers, production observation, rollback evidence, and retirement authorization remain unresolved. No production mutation, feature-flag activation, migration/backfill execution, sync activation, push, or CDB-to-main integration occurred.

### CDB-113D appointment authority

Implementation commits:

- audit and plan: `113568cf8`;
- additive schema and governance: `7a77d3d41`;
- appointment commands: `c49eb49b5`;
- disabled provider adapters: `ba9522cc8`;
- backfill and reconciliation: `ba7222e3e`.

The verified receipt is `docs/database/migration-runs/P11-canonical-appointment-authority.md`.

CDB-113D adds `canonical_appointments`, immutable `canonical_appointment_status_events`, and explicit `canonical_appointment_encounter_links`. Appointment remains planned intent; encounter remains actual care. Patient and practitioner references require canonical links, and billing/payment facts are excluded from appointment authority.

The command layer owns deterministic IDs, source mapping, replay/conflict handling, optimistic versions, lifecycle transitions, rescheduling lineage, explicit fulfilment links, link retirement, atomic compatibility statements, rollback, and PHI-minimised outbox evidence. A schema regression test also corrected the missing `scheduled` event vocabulary before the checkpoint was committed.

The disabled `canonical_appointment_provider_v1` supports legacy, shadow, and canonical modes. Missing or disabled configuration remains legacy. Identity-sensitive resolution requires exact appointment, patient, and practitioner mappings. Names, contact details, billing values, notes, legacy numeric-ID coincidence, and time proximity are never identity or episode-link evidence.

The two-partition appointment/consultation backfill is bounded, resumable, transactional per source row, and second-pass idempotent. Completed legacy intent becomes fulfilled only with one exact mapped encounter for the same patient; otherwise it remains checked-in with a stable processing issue. Persistent reconciliation records fifteen fail-closed checks covering source mapping, references, lifecycle history, reschedule lineage, active tokens, encounter links, tenant safety, and unresolved issues.

Fresh verification passed 9 focused files/58 tests, the complete 196-file/1,385-test canonical suite, TypeScript, all three governance gates, and a 478-entry migration manifest. The access registry now records 186 governed tables, 839 writers, and 1,981 readers. Local sync remains 0/8 ready and legacy retirement remains 0/65 eligible.

Appointment intent remains `partial_canonical`: legacy appointment and consultation writers/readers remain active, the provider flag is disabled, production backfill and shadow observation have not run, rollback evidence and owner authorization are absent, and no retirement is eligible. No production mutation, feature activation, migration/backfill execution, sync activation, push, or CDB-to-main integration occurred.

### CDB-113E reviewed main-sync preflight

The nine-commit local `main` delta from merge base `98e31e1f411645ab4931784aa213f9fe4031cf51` through `d97290acf5bd40f46f6382710088e809d52fc4f0` was reviewed and merged as `9dec80136`. The upstream delta changed 34 files with no exact file overlap against the CDB-only delta and contained no canonical migration, schema, command, provider, source-registry, or authority-matrix change.

The merged scope adds paid-visit context during appointment booking, follow-up consultation invoice display, IPD age/admission-time display, invoice-style admission-slip printing, and admitting-user display. Focused backend verification passed 4 files/49 tests; focused web verification passed 8 files/67 tests; the web production build, root TypeScript, and the complete 196-file/1,385-test canonical suite passed.

The new `src/routes/tenant/appointment-paid-context.ts` is a legacy read projection over `appointments`, `visits`, `doctors`, `bills`, `payments`, `invoice_items`, and `billing_provisional_items`. Access governance intentionally classifies all seven dependencies as legacy readers; this merge did not promote appointment, encounter, practitioner, service, or financial authority.

### CDB-113E encounter, admission, and bed convergence

Implementation commits:

- audit and plan: `f72fa7384`;
- additive schema and governance: `33ba0221f`;
- encounter and care-location/bed-resource commands: `ead4669c4`;
- admission and bed-stay lifecycle commands: `dd21ac5ad`;
- cancellation schema stability: `4d7ba3526`;
- disabled providers: `ededc456f`;
- bounded resumable backfill: `f532b618f`;
- persistent reconciliation: `bfc352792`.

The verified receipt is `docs/database/migration-runs/P11-canonical-encounter-admission-bed-convergence.md`.

CDB-113E preserves encounter as actual care, adds one inpatient admission lifecycle linked to an encounter, adds tenant-scoped care-location and bed-resource identity, and extends canonical bed stays as interval-based occupancy authority. It does not make admission or occupancy own patient demographics, practitioner profiles, clinical narrative, nursing assignment, bed price, admission fee, billing status, invoice, payment, deposit, or financial settlement.

The command layer provides deterministic IDs, exact replay, conflicting-replay rejection, optimistic versions, tenant-safe patient/practitioner/encounter/admission/bed references, one active admission per inpatient encounter, one open stay per bed and admission, atomic transfer/discharge/cancellation behavior, atomic compatibility statements, PHI-minimised outbox evidence, and rollback on any failed statement.

The disabled `canonical_encounter_provider_v1` and `canonical_admission_bed_provider_v1` support legacy, shadow, and canonical modes. Missing, disabled, malformed, or unsupported configuration remains legacy. Exact mappings are required; names, phone numbers, labels, numeric-ID coincidence, and timestamp proximity never establish identity or episode linkage.

The six-partition backfill is bounded, resumable, deterministic, source-row atomic, ambiguity-preserving, and second-pass safe. Persistent reconciliation stores one aggregate receipt with exactly twenty-three fail-closed checks for identity, lifecycle, mapping, occupancy, overlap, tenant safety, unresolved issues, and zero-new-row evidence.

Fresh verification passed 9 focused files/48 tests, the complete 203-file/1,426-test canonical suite, TypeScript, all three governance gates, and a 481-entry migration manifest. The access registry records 190 governed tables, 858 writers, and 2,053 readers. Local sync remains 0/8 ready and legacy retirement remains 0/65 eligible.

Encounter/admission/bed authority remains `partial_canonical`: legacy writers/readers remain active, both provider flags are disabled, production backfill and reconciliation have not run, shadow observation and rollback evidence are absent, selected reader promotion is incomplete, owner authorization is absent, and no retirement is eligible. No production mutation, feature activation, sync activation, push, or CDB-to-main integration occurred.

## 5. CDB-113F local read-promotion checkpoint

`CDB-113F-IDENTITY-EPISODE-READ-PROMOTION-VERIFIED`

The reviewed operational consumer inventory contains 616 eligible reader pairs across 249 paths and 41 tables with zero unknown provider assignments. Provider-family totals are 178 patient-identity, 187 practitioner, 47 appointment, 98 encounter, and 106 admission/bed readers. The fresh access registry contains 190 governed tables, 858 writers, and 2,056 readers.

The checkpoint adds the disabled-safe patient identity provider, aggregate-only shadow evidence, one selected library adapter for each of the five provider families, deterministic coverage and consumer IDs, local readiness evidence, and five fail-closed retirement domains. Exact tenant-scoped relationship or source mapping remains mandatory; names, phone numbers, labels, numeric-ID coincidence, and timestamp proximity never establish identity or episode linkage.

Fresh verification passed 9 focused/adjacent files and 49 tests, the complete 209-file/1,457-test canonical suite, root TypeScript, all mandatory governance gates, and a 481-entry migration manifest. Local selected-adapter readiness is true, but production readiness is false. Local sync remains 0/8 ready and legacy retirement remains 0/65 eligible.

All five provider flags remain disabled. Production observation, owner authorization, production rollback freshness, route cutover, traffic change, reader retirement, write retirement, push, and CDB-to-main integration are absent.

The durable receipt is `docs/database/migration-runs/P11-canonical-identity-episode-read-promotion.md`.

## 6. CDB-113G production read-only observation

`CDB-113G-IDENTITY-EPISODE-PRODUCTION-READONLY-OBSERVATION-BLOCKED-SCHEMA`

The user authorized continuation on 2026-07-27. The checkpoint narrowed that approval to one tenant-100, aggregate-only, read-only production observation and did not authorize deployment, migration, backfill, flag, route, traffic, synchronization, retirement, push, or CDB-to-main integration.

The collector verified exact production D1 identity and ran a read-only schema preflight. Required observation schema was incomplete:

- required tables: 21;
- present tables: 17;
- missing tables: 4;
- missing `canonical_tenant_patient_links`;
- missing `canonical_appointments`;
- missing `canonical_admissions`;
- missing `canonical_beds`.

Because schema was incomplete, the hardened collector wrote protected blocker evidence and stopped before the provider warm-up and five measured aggregate iterations. The production receipt records `schemaReady=false`, `evidenceReady=true`, `observationReady=false`, `promotionReady=false`, `rowsWritten=0`, and no production mutation.

The durable receipt is `docs/database/migration-runs/production/CDB-113G-identity-episode-production-readonly-observation.md`. The design and plan are:

- `docs/superpowers/specs/2026-07-27-cdb-113g-identity-episode-production-readonly-observation-design.md`;
- `docs/superpowers/plans/2026-07-27-cdb-113g-identity-episode-production-readonly-observation.md`.

The observer adds 21 governed read dependencies. Current access governance records 190 governed tables, 858 writers, and 2,077 readers with zero issues. The operational CDB-113F provider inventory remains exactly 616 reader pairs across 249 paths and 41 tables because the production observer is a governance tool, not a promotable route consumer.

## 7. CDB-113H production schema/backfill preparation

`CDB-113H-IDENTITY-EPISODE-PRODUCTION-SCHEMA-BACKFILL-PREPARATION-VERIFIED`

The read-only audit records 487 production migration-ledger entries and ten Wrangler-pending repository migrations. Nine are truly pending. The identity/episode subset remains eight files: seven true pending plus one ledger drift; `0549/0550` are pending approval/refund migrations. Repository `0547_patient_merge_map_hardening.sql` is schema-equivalent to production `0541_patient_merge_map_hardening.sql`, so it is a ledger-name drift that must be proved as a clone no-op.

`0548_canonical_encounter_admission_bed_convergence.sql` is the high-risk boundary because it rebuilds 234 tenant-100 canonical encounter rows and 28 canonical bed-stay rows while creating the missing admission and bed authorities. Standard all-pending production apply is prohibited until a protected clone proves exact row/schema parity and rollback.

The preparation binds:

- ten exact migration names and SHA-256 hashes;
- nine true pending migrations and one ledger-name drift;
- four missing observation authorities;
- tenant-100 count-only baselines;
- patient → practitioner → appointment → encounter/admission/bed backfill dependencies;
- fourteen minimum reconciliation requirements;
- six separate future authorization stages;
- `mutationReady=false` and every production mutation gate false.

The durable receipt is `docs/database/migration-runs/production/CDB-113H-identity-episode-production-schema-backfill-preparation.md`. Reviewed preparation documents, machine evidence, and governance are:

- `docs/database/audits/2026-07-27-identity-episode-production-schema-backfill-preparation-audit.md`;
- `docs/superpowers/specs/2026-07-27-cdb-113h-identity-episode-production-schema-backfill-preparation-design.md`;
- `docs/superpowers/plans/2026-07-27-cdb-113h-identity-episode-production-schema-backfill-preparation.md`;
- `docs/database/identity-episode-production-schema-backfill-preparation.json`;
- `scripts/canonical/check-identity-episode-production-schema-backfill-preparation.ts`;
- `test/canonical/identity-episode-production-schema-backfill-preparation.test.ts`;
- `pnpm canonical:identity-episode-production-preparation`.

No production migration or backfill was applied. No provider, route, traffic, deployment, synchronization, retirement, push, or CDB-to-main state changed.

Post-main reconciliation commit `fced6eac7` verified 216 canonical files / 1,505 tests, TypeScript, a 483-entry migration manifest, 79 canonical tables, 191 governed tables, 869 writers, 2,088 readers, 616 identity/episode consumers with zero unknown assignments, local sync 0/8 ready, and legacy retirement 0/66 eligible.

## 8. CDB-113H1 protected local clone migration rehearsal

`CDB-113H1-PROTECTED-LOCAL-CLONE-MIGRATION-REHEARSAL-VERIFIED`

A fresh protected export and Time Travel evidence were captured under clone-only authorization. Fresh remote D1 clone creation was blocked by the account database quota. The existing remote rehearsal database was non-empty and remained read-only; it was not overwritten, deleted, or reused.

The exact protected export was imported into a source snapshot and then into a second isolated local SQLite/D1-equivalent clone through the repository's topological bundle builder. Source-to-clone reconciliation found zero missing tables, zero extra tables, zero row-count mismatches, and exact 487/234/28 ledger/encounter/bed-stay baselines.

The clone applied all ten reviewed migrations in exact order and advanced its ledger from 487 to 497. Required proof results:

- `0547` was a schema and row no-op apart from ledger reconciliation;
- `0548` preserved 234 tenant-100 encounters and 28 bed stays while creating four required authorities;
- `0549` preserved approval request, decision, and event counts with revision-1 backfill;
- `0550` created five explicit indexes and three composite FK constraints with zero rows;
- final integrity was `ok`;
- final FK violations were 0;
- independent verification passed.

The durable receipt is `docs/database/migration-runs/production/CDB-113H1-protected-local-clone-migration-rehearsal.md`. Protected paths, identities, checksums, authorization data, backups, and detailed logs remain outside Git.

A final production read-only check proved the migration ledger remained 487, required authorities present remained 0/4, `changed_db=false`, and rows written remained 0. No production migration, backfill, feature flag, route, traffic, deployment, sync activation, retirement, database deletion, push, or CDB-to-main integration occurred.

Fresh verification passed H1 continuity 3 files / 12 tests, the complete 217-file / 1,507-test canonical suite, TypeScript, a 483-entry migration manifest, all governance gates with 79 canonical tables and 191 governed tables / 869 writers / 2,088 readers, identity/episode coverage 616/249/41 with zero unknown assignments, local sync 0/8 ready, legacy retirement 0/66 eligible, and task worktree policy.

## 9. CDB-113H2 protected clone backfill and reconciliation

`CDB-113H2-PROTECTED-CLONE-BACKFILL-RECONCILIATION-VERIFIED`

The user's fresh authorization was restricted to tenant `100` on the protected local clone. Four domain partitions ran serially with a protected backup before each partition, fail-closed restore, reconciliation, and mandatory zero-new-business-row second pass.

Verified clone results:

- 325 canonical tenant-patient links;
- 30 canonical practitioners;
- 141 appointments, 141 status events, and 19 exact appointment–encounter links;
- 234 encounters preserved;
- 26 exact admissions and 39 explicit ambiguous admission dispositions;
- 8 care locations and 31 beds;
- 28 historical bed stays preserved, with 16 operational mappings and 16 ambiguous source dispositions;
- 16 active/completed operational stays, 12 invalid historical stays, and 3 active stays;
- 61 stable convergence issues validated against current source, mapping, and canonical state;
- seven reconciliation runs passed with zero mismatches;
- encounter/admission/bed reconciliation passed all 23 checks;
- clone integrity `ok`, FK violations 0, migration ledger unchanged at 497;
- legacy source-table fingerprint unchanged;
- all provider flags remained disabled.

The production-shaped rehearsal exposed and fixed patient identity schema compatibility, practitioner operational adoption, local consultation timestamp normalization, exact appointment missing-encounter disposition, explicit ward identity, historical bed-stay adoption, interval-based occupancy truth, and exact issue-state reconciliation. The execution/fix commits are `b8e1cb290`, `68c11a69c`, `ea69cf040`, `b333cd638`, `af7229bf3`, `c88e0be46`, and `07dae80b3`.

The durable receipt is `docs/database/migration-runs/production/CDB-113H2-protected-clone-backfill-reconciliation.md`. Protected authorization, clone identity, checksums, backups, logs, and detailed evidence remain outside Git.

A final production read-only check proved the migration ledger remained 487, required authority tables remained 0/4, `changed_db=false`, and rows written remained 0. No production migration, backfill, flag, route, traffic, deployment, synchronization, retirement, database deletion, push, or CDB-to-main integration occurred.

Fresh verification passed H2 continuity plus production-scope policy 5 files / 18 tests, the complete 219-file / 1,521-test canonical suite, TypeScript, a 483-entry migration manifest, all governance gates with 79 canonical tables and 191 governed tables / 869 writers / 2,091 readers, identity/episode coverage 619/249/41 with zero unknown assignments, local sync 0/8 ready, legacy retirement 0/66 eligible, and task worktree policy.

The account D1 quota still blocks a fresh remote clone. The local SQLite/D1-equivalent rehearsal limitation remains explicit.

## 10. CDB-113H2A main sync and H2 evidence revalidation

`CDB-113H2A-MAIN-SYNC-AND-H2-EVIDENCE-REVALIDATION-VERIFIED`

Reviewed `main` at `8592d30fd0a54031ea88adcc3846bed8407ea860` was merged into the clean CDB branch as `e321089a5ec1557f5ea874307f86e8627a3199d4`. The 28-commit delta contained Staff/Workforce management, Staff authentication/session hardening and the A5 admission-slip fix. Dry-run and actual merge completed without conflict.

All ten H1 migration files and all eight H2 backfill/reconciliation scripts remained byte-for-byte unchanged. Therefore H1/H2 rehearsal evidence remains bound and no repeat rehearsal is required. The durable receipt is `docs/database/migration-runs/production/CDB-113H2A-main-sync-h2-evidence-revalidation.md`.

Fresh H2A verification passed the complete 219-file / 1,521-test Canonical suite, the 9-file / 180-test protected Reception gate, TypeScript, a 488-entry migration manifest, schema and authority governance with 79 canonical tables, access governance with 191 governed tables / 869 writers / 2,094 readers, and identity/episode coverage 622/252/41 with zero unknown assignments. Local read-promotion readiness is green; production readiness remains false.

The next production gate was `CDB-113H3-PRODUCTION-SCHEMA-AUTHORIZATION-REQUIRED`. H3 requires a fresh exact owner authorization. H2A did not authorize production migration/backfill, provider activation, route or traffic change, deployment, Reception cutover, local-sync activation, legacy retirement, remote database deletion, push, or CDB-to-main integration.

Non-Reception canonical-first development may continue locally under `docs/architecture/hms-production-scope-policy.md`.

## 11. CDB-113H3 production schema authorization contract

`CDB-113H3-PRODUCTION-SCHEMA-AUTHORIZATION-CONTRACT-READY`

A strict local authorization validator now binds the exact production database identity, operation `production_schema_migrations_only`, the ten reviewed migrations `0541` through `0550` in exact order and by SHA-256, and the current H1, H2, and H2A receipt hashes. The implementation is `scripts/canonical/identity-episode-production-schema-authorization.ts`, readiness evidence is `docs/database/identity-episode-production-schema-authorization-readiness.json`, and the durable receipt is `docs/database/migration-runs/production/CDB-113H3-production-schema-authorization-contract.md`.

The contract accepts only a regular mode-`0600` JSON file in a mode-`0700` protected directory outside the repository. It rejects symlinks, hard links, duplicate or unknown fields, unsafe keys, sensitive fields, stale bindings, wrong database identity, generic approval, invalid timing, missing rollback evidence, broadened permissions, and any count or procedure drift.

The future exact authorization must bind a bounded maintenance window, owner and rollback authority, protected export and Time Travel evidence hashes, stop-on-first-failure and restore-on-any-failure, and these acceptance thresholds: ledger 487 → 497, four required authority tables, encounters 234 → 234, bed stays 28 → 28, integrity `ok`, FK violations 0, and migration failure tolerance 0.

Only `schemaMigration` may be true. Production backfill, provider flags, routes, traffic, deployment, Reception cutover, data mutation outside migration, local sync, retirement, remote database deletion, push, and CDB-to-main integration must all remain false. H3 never implies H4 production backfill authorization.

The evaluator is offline and aggregate-only; it cannot call Wrangler or mutate a database. The current readiness evidence records `h3_contract_ready: true`, `h3_authorization_present: false`, `h3_execution_ready: false`, `h3_bound_migration_count: 10`, `h3_bound_receipt_count: 3`, `h3_schema_migration_authorized: false`, `h3_production_backfill_authorized: false`, production rows written 0, and production mutation false.

Fresh verification passed the H3 focused contract 2 files / 10 tests, continuity and production-boundary coverage 5 files / 16 tests, the complete 221-file / 1,531-test Canonical suite, TypeScript, a 488-entry migration manifest, governance with 79 Canonical tables and 191 governed tables / 869 writers / 2,094 readers, identity/episode coverage 622/252/41 with zero unknown assignments, local sync 0/8 ready, legacy retirement 0/66 eligible, and task worktree policy.

The exact production gate remains `CDB-113H3-PRODUCTION-SCHEMA-EXACT-AUTHORIZATION-REQUIRED`. A generic “Continue” instruction and all historical authorizations remain insufficient for production execution.

## 12. CDB-121A prescription and medication-intent authority design

`CDB-121A-PRESCRIPTION-MEDICATION-INTENT-AUTHORITY-DESIGN-VERIFIED`

The earliest safe local Canonical roadmap gap is `prescription_medication_intent`. Current clinical truth is split across doctor-issued `prescriptions`/`prescription_items`, inpatient `cln_medication_orders`, commercial fulfilment `medication_orders`, and pharmacy-local prescription workflow. The reviewed design keeps these semantics distinct and creates one future encounter-linked clinical authority rather than promoting any legacy table in place.

The five planned Canonical tables are `canonical_prescriptions`, `canonical_prescription_versions`, `canonical_medication_orders`, `canonical_medication_order_status_events`, and `canonical_prescription_safety_events`. Every clinical prescription and medication order requires exact tenant patient-link, encounter, prescribing-practitioner, source-evidence, and public-ID bindings. Names, phone numbers, medication text, numeric-ID coincidence, and timestamp proximity are prohibited identity or episode evidence.

The target command boundaries are `createCanonicalPrescriptionDraft`, `replaceCanonicalPrescriptionDraft`, `finalizeCanonicalPrescription`, `amendCanonicalPrescription`, `transitionCanonicalMedicationOrder`, and `recordCanonicalPrescriptionSafetyEvent`. Final versions are immutable; correction uses amendment/supersession; every medication-order transition co-commits an immutable lifecycle event.

Medication administration/MAR, medication reconciliation, fulfilment/dispense/sale/delivery, pharmacy-local workflow, stock, billing, payment, accounting, diagnoses, observations, vitals, and signed clinical documents remain separate facts and later checkpoints. Commercial `medication_orders` cannot create clinical authority by itself, and `cln_medication_orders` cannot be merged with prescription items through text similarity.

The reviewed artifacts are:

- `docs/database/audits/2026-07-27-prescription-medication-intent-authority-audit.md`;
- `docs/superpowers/specs/2026-07-27-cdb-121a-prescription-medication-intent-authority-design.md`;
- `docs/superpowers/plans/2026-07-27-cdb-121-prescription-medication-intent-authority.md`;
- `docs/database/migration-runs/P11-canonical-prescription-medication-intent-authority-design.md`;
- `test/canonical/prescription-medication-intent-design-contract.test.ts`.

The serial checkpoints are `CDB-121A`, `CDB-121B-CANONICAL-PRESCRIPTION-MEDICATION-SCHEMA`, `CDB-121C-CANONICAL-PRESCRIPTION-MEDICATION-COMMANDS`, `CDB-121D-CANONICAL-PRESCRIPTION-MEDICATION-BACKFILL-RECONCILIATION`, and `CDB-121E-CANONICAL-PRESCRIPTION-MEDICATION-READ-PROMOTION`. Normal checkpoint commits are not stop points.

Production rows written remain 0. Production mutation, provider activation, route/traffic change, deployment, local sync, legacy retirement, push, and CDB-to-main integration remain false. H3 exact authorization remains absent and blocked.

The next local checkpoint was `CDB-121B-CANONICAL-PRESCRIPTION-MEDICATION-SCHEMA`.

## 13. CDB-121B canonical prescription and medication-intent schema

`CDB-121B-CANONICAL-PRESCRIPTION-MEDICATION-SCHEMA-VERIFIED`

Additive migration `0554_canonical_prescription_medication_intent.sql` and Drizzle module `src/db/schema/canonical/medication.ts` now define five tenant-scoped authorities: prescription current state, immutable prescription versions, clinical medication-order current state, immutable medication-order lifecycle events, and immutable prescription safety events.

Every prescription and medication order requires exact tenant patient-link, encounter, and prescribing-practitioner identity. A medication order linked to a prescription must match its tenant, patient, encounter, and prescriber. Version numbers and order-event versions are positive and unique. Final/amendment versions require a signing practitioner, finalisation time, and lowercase signed-snapshot SHA-256. All clinical history uses restricted deletion.

The circular prescription-current-version and version-parent foreign keys remain fully enforced in migration `0554`; only those two mutually recursive references are omitted from Drizzle initialiser metadata to keep TypeScript inference safe. All non-circular Drizzle references remain typed and tenant-scoped.

The schema intentionally contains no dispense, sale, payment, invoice, stock, diagnosis, advice, vital, demographic, administration, or reconciliation authority. Fulfilment and pharmacy-local records cannot create clinical intent without explicit reviewed mapping.

The authority matrix now records 46 concepts, 17 implemented, 11 partial, 16 gaps, 2 external, and 84 Canonical tables. Access governance records 200 governed tables, 875 writers, and 2,101 readers. Identity/episode coverage remains 622 readers / 252 paths / 41 tables / zero unknown assignments. Focused verification passed 4 files / 35 tests, TypeScript, all governance gates, and a 489-entry migration manifest.

The durable receipt is `docs/database/migration-runs/P11-canonical-prescription-medication-intent-schema.md`. Production rows written remain 0; no migration/backfill, provider activation, route/traffic change, deployment, sync, retirement, remote database deletion, push, or CDB-to-main integration occurred. H3 exact authorization remains absent, and migration `0554` is outside H3's bound `0541`–`0550` scope.

The next local checkpoint was `CDB-121C-CANONICAL-PRESCRIPTION-MEDICATION-COMMANDS`.

## 14. CDB-121C canonical prescription and medication-intent commands

`CDB-121C-CANONICAL-PRESCRIPTION-MEDICATION-COMMANDS-VERIFIED`

The local command module `src/lib/canonical/commands/manage-prescription-medication-intent.ts` now provides deterministic draft creation, draft replacement, finalisation, amendment/supersession, medication-order lifecycle transition, and immutable safety-event commands.

Every command uses tenant-scoped exact public IDs, normalized UTC timestamps, lowercase SHA-256 evidence, Canonical command replay, and a D1-compatible atomic batch. Draft creation validates the active tenant-patient link, exact encounter-to-patient link, active prescribing practitioner, and source-mapping availability before writing prescription, version, medication orders, order events, mappings, outbox, and reviewed compatibility statements.

Draft replacement never deletes prior history: it creates a new version and marks prior draft orders `entered_in_error` through explicit lifecycle events. Finalisation requires an exact optimistic version, matching active prescribing/signing practitioner, at least one draft order, and a signed-snapshot hash. Amendment creates a superseding immutable signed version, stops prior active/on-hold orders through lifecycle events, and creates active replacement orders. Order transitions use an explicit transition matrix. Override/waiver safety evidence requires an active practitioner and `overridden` outcome.

Identical replay returns the persisted PHI-minimised result before state-dependent validation; changed replay raises `CanonicalIdempotencyConflictError`. A failed compatibility or Canonical statement rolls back the entire batch. Outbox payloads exclude medication text, dose, strength, instructions, patient link, encounter, practitioner, and source-row identifiers.

The commands create no MAR/administration, reconciliation, fulfilment, pharmacy sale/delivery/payment, stock, invoice, collection, accounting, diagnosis, observation, or vital authority.

Focused command verification passed 1 file / 8 tests. Identity/readiness verification passed 2 files / 9 tests. TypeScript passed. Governance records 46 concepts, 84 Canonical tables, 200 governed tables, 881 writers, 2,108 readers, 625 identity/episode reader pairs across 253 paths and 41 tables, zero unknown assignments, and zero governance issues. The migration manifest remains 489.

The durable receipt is `docs/database/migration-runs/P11-canonical-prescription-medication-intent-commands.md`. Production rows written remain 0; no migration/backfill, provider activation, route/traffic change, deployment, sync, retirement, remote database deletion, push, or CDB-to-main integration occurred.

The next local checkpoint was `CDB-121D-CANONICAL-PRESCRIPTION-MEDICATION-BACKFILL-RECONCILIATION`.

## 15. CDB-121D canonical prescription and medication-intent backfill and reconciliation

`CDB-121D-CANONICAL-PRESCRIPTION-MEDICATION-BACKFILL-RECONCILIATION-VERIFIED`

The local program now contains a bounded, resumable migration executor and a persistent aggregate reconciliation for prescription and medication-order intent. The backfill uses independent `prescription_headers` and `standalone_cpoe_orders` checkpoints with a caller-supplied source-row limit.

Prescription migration requires exact tenant patient-link mapping, exact active practitioner evidence, and exactly one valid Canonical encounter candidate from reviewed completion-claim, appointment-link, admission, legacy-visit, or legacy-encounter evidence. Standalone CPOE migration requires exact patient, practitioner-user, and legacy-visit encounter evidence. Names, phone numbers, medication text, numeric-ID coincidence, and timestamp proximity are not identity or episode evidence.

Each source row commits its entire Canonical prescription/version/order/event/safety/mapping batch atomically or commits one stable processing issue. Conflicting exact encounter candidates produce `RX_ENCOUNTER_EVIDENCE_AMBIGUOUS`; repeated execution preserves the issue identity and increments its occurrence count. Commercial `medication_orders`, pharmacy-local `pharmacy_prescriptions`, fulfilment, sale, payment, delivery, stock, MAR/administration, and medication-reconciliation sources create no clinical medication intent.

The local fixture proved one exact prescription, one immutable version, one linked medication order, one standalone CPOE order, two order events, two safety events, one stable ambiguity issue, six new prescription/medication mappings, unchanged source rows, and zero new business rows on the second pass.

Persistent reconciliation records 16 fixed aggregate checks covering source coverage, identity/episode references, version continuity, signed final evidence, linked order scope, order event parity and transitions, safety scope, source immutability, foreign-key violations, integrity status, and second-pass idempotence. Clean evidence persisted `passed` with 16/16 matched; deliberate corruption persisted `failed` with aggregate-only mismatch evidence.

Focused verification passed 4 files / 13 tests. TypeScript passed. Governance records 46 concepts, 84 Canonical tables, 200 governed tables, 891 writers, 2,141 readers, 634 identity/episode reader pairs across 255 paths and 41 tables, zero unknown assignments, and zero governance issues. The migration manifest remains 489.

The durable receipt is `docs/database/migration-runs/P11-canonical-prescription-medication-intent-backfill-reconciliation.md`. Production rows written remain 0; no production query/migration/backfill, provider activation, route/traffic change, deployment, sync, retirement, remote database deletion, push, or CDB-to-main integration occurred.

The next local checkpoint was `CDB-121E-CANONICAL-PRESCRIPTION-MEDICATION-DISABLED-PROVIDERS-READINESS`.

## 16. CDB-121E canonical prescription and medication-intent authority completion

`CDB-121E-CANONICAL-PRESCRIPTION-MEDICATION-AUTHORITY-VERIFIED`

The prescription and medication-intent concept is now a complete local Canonical authority. Migration `0554`, six atomic commands, bounded resumable backfill, persistent 16-check reconciliation, disabled-safe provider modes, separate prescription-document and medication-order projections, two selected library adapters, and fail-closed readiness evidence are present and verified.

The provider flag is `canonical_prescription_medication_provider_v1`. Missing, disabled, or non-promoted configuration resolves to legacy. Shadow and canonical modes are verified only as local library contracts. The provider remains disabled by default, no route is connected, and reviewed reader runtime remains unchanged.

Selected adapters are `cdb121e_prescription_detail` and `cdb121e_medication_order_detail`. Reviewed readers are `src/routes/global-portal.ts`, `src/routes/tenant/patients-chart.ts`, and `src/routes/tenant/nursing/clinical-summary.ts`; unknown assignments are zero. Canonical resolution requires exact source mapping plus tenant patient, encounter, and practitioner scope. Names, medication text, numeric coincidence, and timestamp proximity are forbidden as record-selection evidence.

Shadow receipts are PHI-minimised aggregate evidence. Prescription documents and medication orders remain separate authorities; administration, reconciliation, fulfilment, stock, billing, and payment facts remain excluded.

The authority matrix now records 18 implemented Canonical concepts, 10 partial Canonical concepts, 16 gaps, and 2 external governed concepts. Verification passed 9 prescription-focused files / 38 tests and the complete Canonical suite at 228 files / 1,560 tests. TypeScript passed. The migration manifest remains 489. Governance records 46 concepts, 84 Canonical tables, 5 governed legacy tables, 200 governed tables, 891 writers, 2,157 readers, and zero governance issues. Identity/episode coverage records 640 reader pairs across 256 paths and 41 tables with zero unknown assignments.

Prescription/medication local readiness is true while production readiness is false. Local sync remains 0/8 ready and legacy retirement remains 0/66 eligible. No provider activation, production observation, route cutover, sync activation, or retirement occurred.

The durable receipt is `docs/database/migration-runs/P11-canonical-prescription-medication-intent-authority.md`. Production rows written remain 0; no production query/migration/backfill, route/traffic change, deployment, remote database deletion, push, or CDB-to-main integration occurred.

The next local checkpoint was `CDB-122A-CLINICAL-DOCUMENT-DIAGNOSIS-AUTHORITY-DESIGN`.

## 17. CDB-122A clinical document and diagnosis authority design

`CDB-122A-CLINICAL-DOCUMENT-DIAGNOSIS-AUTHORITY-DESIGN-VERIFIED`

The repository now contains a reviewed source audit, target design, serial execution plan, contract test, and durable receipt for the clinical-document and diagnosis authority. The concept remains a Canonical gap because no schema/runtime has been implemented yet.

The design separates two linked aggregates: immutable authored clinical documents with versions/signatures/attachments, and typed coded diagnosis assertions with review/status events. Six new table families are planned: `canonical_clinical_documents`, `canonical_clinical_document_versions`, `canonical_clinical_document_signatures`, `canonical_clinical_document_attachments`, `canonical_diagnosis_assertions`, and `canonical_diagnosis_status_events`.

Existing `canonical_encounter_addenda` remains the sole encounter-snapshot addendum authority. CDB-122 will not duplicate it. Document amendments create new immutable versions; encounter snapshot addenda continue through the existing authority.

The audit classifies `clinical_notes`, `FormSOAP`, `FormTreatmentPlan`, selected signed encounter snapshots, `ClinicalDiagnosis`, `final_diagnosis`, `document_records`, and `clinical_images` as reviewed migration sources. `consultations`, visit/discharge diagnosis fields, and MRD records remain compatibility/projection/workflow sources unless exact lineage exists. Problem lists, questionnaires/observations, vitals, prescriptions/orders, diagnostic results, discharge workflow, legal certificates, filing, and finance remain separate authorities.

Nine commands, ten bounded backfill partitions, and twenty persistent reconciliation checks are planned. Exact tenant patient-link, encounter, practitioner, source-table, source-row, content-hash, and coding evidence is mandatory. Names, phone numbers, narrative similarity, diagnosis description similarity, file names, numeric coincidence, and timestamp proximity are forbidden as identity or merge evidence. Diagnosis assertions are never inferred automatically from narrative text.

The design-only checkpoint created no migration or runtime module. The durable receipt is `docs/database/migration-runs/P11-canonical-clinical-document-diagnosis-authority-design.md`. Production rows written remain 0; no production query/migration/backfill, provider activation, route/traffic change, deployment, sync, retirement, remote database deletion, push, or CDB-to-main integration occurred.

The next local checkpoint is `CDB-122B-CANONICAL-CLINICAL-DOCUMENT-DIAGNOSIS-SCHEMA`.

## 18. International-grade architecture rules

### One authority per fact

A shared fact has one authority. A table may remain only as:

- a domain extension;
- an immutable audit or legal history;
- a workflow document;
- a temporary compatibility surface;
- a rebuildable projection or cache;
- an intentionally external governed authority.

Two independently mutable balances, statuses, identities, or lifecycle rows for the same fact are not acceptable.

### Explicit identity and roles

- Authentication users are not automatically practitioners.
- Employees are not automatically practitioners.
- Referrer, prescriber, requester, performer, reporter, verifier, treating doctor, and approver are explicit roles.
- Numeric ID coincidence and name similarity are never sufficient for migration or runtime linkage.
- Ambiguous historical records become stable processing issues.

### Planned care versus delivered care

- Appointment is planned intent.
- Encounter is actual care.
- Admission is an inpatient extension/link to an encounter.
- Service request is ordered intent.
- Service event is delivered or operationally accepted work.
- Result/report/specimen/acquisition details are domain extensions attached to the request/event.

### Financial exactness

- Posted money uses integer minor units and an explicit currency code.
- Invoice lines, allocations, credits, refunds, deposits, compensation, custody, and accounting are separate facts.
- Collection allocation is persisted; it is not reconstructed proportionally at report time.
- Cash custody is separate from income, expense, revenue, liability, and accounting classification.
- Posted financial records are corrected by reversal, credit, refund, or adjustment—not hard deletion.
- Every strict mutation owns calculations, idempotency, source mapping, canonical rows, and required outbox/assertion evidence in one reviewed boundary.

### Clinical integrity

- Signed/final clinical content is immutable.
- Correction uses version, addendum, retraction, or supersession.
- Clinical documents, observations, medication orders, administration, and reconciliation remain distinct typed facts.
- PHI must not leak into outbox, logs, hashes, receipts, or aggregate verification evidence.

### Inventory integrity

- Immutable stock movements are quantity truth.
- Balances are projections that can be rebuilt and reconciled.
- Pharmacy and lab metadata may extend items/lots but cannot keep independent quantity authority after cutover.
- Transfer, receipt, issue, dispense, return, count, adjustment, waste, and write-off use one movement posting model.

### Reliability and observability

- Commands are idempotent and tenant-scoped.
- Outbox/inbox processing is durable and replay-safe.
- Retries, dead-letter, issues, reconciliation, and rollback are visible.
- Provider switches are explicit and reversible.
- Cutover requires measured shadow comparison and zero unexplained variance for financial facts.

### Portability and modularity

- Cloudflare D1 remains the current engine while logical canonicalization completes.
- New canonical models must remain portable enough for a later measured PostgreSQL decision.
- Modules communicate through typed domain contracts and shared canonical IDs, not hidden cross-module SQL assumptions.
- A modular monolith may contain many modules, but shared facts still have one authority.

## 7. Program roadmap

### Wave 0 — Governance

- Authority matrix enforcement: complete at CDB-112A.
- Full writer and reader access registry: complete at CDB-112B.
- Three mandatory governance gates now cover schema, business authority, and code access drift.
- Continue preventing new parallel shared-fact tables, unclassified governed accesses, and unauthorised retirement.

### Wave 1 — Identity and episode foundation

- tenant patient to MPI/global identity linkage;
- practitioner operational adoption;
- canonical appointment intent and status history;
- encounter/admission/bed-stay convergence;
- core identity/episode provider reads.

### Wave 2 — Clinical and service extensions

- service catalog convergence;
- prescriptions and medication orders;
- observations and signed clinical documents;
- lab specimen/result/verification lifecycle;
- radiology acquisition/report/PACS lifecycle;
- ER, OT, nursing, MAR, and medication reconciliation extensions.

### Wave 3 — Financial completeness

- finish strict writer coverage and canonical reads;
- direct income source documents;
- expense approval/payment/recovery lifecycle;
- payroll run/payable/payment/accounting lifecycle;
- insurance authorization/claim/remittance/patient-liability lifecycle;
- cash custody and accounting promotion.

Canonical Finance is a domain inside the single HMS canonical program. It is not a separate database program or branch authority.

### Wave 4 — Supply chain convergence

- procurement request/RFQ/PO/receipt/return/supplier liability;
- canonical movement posting for every quantity mutation;
- pharmacy dispense and OTC sale events;
- lab reagent lot/QC/open-vial/analyser extensions;
- retirement of balance-copy bridges after reconciliation.

### Wave 5 — Read promotion and canary

- provider adapters for every operational and analytical consumer;
- shadow comparison and stable variance IDs;
- authorized single-tenant/single-domain canary;
- observation thresholds and immediate rollback.

### Wave 6 — Retirement

- stop direct legacy writes only after cutover/read promotion/observation/rollback evidence;
- retain compatibility views for an approved period;
- archive history;
- perform destructive removal only under separate explicit authorization.

## 8. Safety boundaries

Do not access or mutate production without a fresh, exact, task-specific owner authorization.

Without that authorization, do not:

- deploy a Worker or application;
- apply a production migration or backfill;
- read protected credentials or secrets;
- change feature flags or traffic;
- run production smoke tests or observation;
- activate local-server synchronization;
- retire legacy writes;
- delete, rename, truncate, or destructively rewrite legacy tables;
- push or integrate the CDB branch into `main`;
- reuse historical authorization as current approval.

The owner-facing root checkout is dirty and detached in the current environment. It is read-only. Never reset, clean, stash, overwrite, or commit its unrelated changes.

## 9. Verification commands

Minimum governance checkpoint:

```text
pnpm vitest run test/canonical/canonical-authority-check.test.ts
pnpm vitest run test/canonical/canonical-program-continuity-contract.test.ts
pnpm canonical:authority-check
pnpm canonical:check
pnpm exec tsc --noEmit
```

Before claiming a broader checkpoint complete:

```text
pnpm vitest run test/canonical
pnpm build:migrations
pnpm canonical:local-sync-readiness
pnpm canonical:legacy-retirement-readiness
pnpm worktree:check -- --mode=task
```

Run affected web, patient, and admin production builds when runtime or UI code changes.

## 10. Documentation update contract

Every verified checkpoint must update:

- `task-progress.yaml` with current checkpoint, previous/last commit, exact next action, verification counts, blockers, and safety state;
- `.ai-bridge/current-plan.md` with a concise resume instruction;
- this control center when roadmap, architecture decision, branch, source hierarchy, current checkpoint, or next action changes;
- a checkpoint receipt under `docs/database/migration-runs/`;
- design and implementation plan documents for new schema or runtime behaviour;
- the authority matrix when business-fact ownership or disposition changes;
- tests that enforce the documentation and tracker contract.

Do not claim completion from prose alone. Verification output and commit IDs must support the tracker.

## 11. Stop and handoff procedure

Before stopping a session:

1. finish the smallest safe boundary;
2. run fresh focused verification;
3. review every changed file;
4. commit exact task-owned files;
5. update tracker, control center, handoff, and receipt;
6. record production mutation, activation, retirement, push, and integration status explicitly;
7. ensure the worktree is clean or document every intentional dirty file;
8. leave one exact next action that does not require rediscovery.

A new session should be able to answer these questions immediately:

- Which workspace and branch are authoritative?
- What was the last verified checkpoint and commit?
- Which tests and gates passed?
- What remains blocked and why?
- What is the next exact implementation task?
- Which actions require fresh authorization?
- Which document owns each architectural decision?

If those answers are not explicit, the checkpoint documentation is incomplete.

## 18. CDB-122E clinical document and diagnosis authority

`CDB-122E-CANONICAL-CLINICAL-DOCUMENT-DIAGNOSIS-AUTHORITY-VERIFIED`

CDB-122 is locally complete and verified but remains uncommitted because the active connector exposes no Git commit action.

The authority includes six additive Canonical tables, nine atomic idempotent commands, ten persistent bounded-backfill partitions, a fixed twenty-check reconciliation receipt, disabled-safe legacy/shadow/canonical providers, two selected library adapters, four reviewed legacy reader assignments, PHI-minimised shadow evidence, and fail-closed readiness.

Clinical document versions must start as drafts. Final and amendment states require a matching signature over the exact content hash. Signed history, signature history and diagnosis lifecycle event history are immutable. Existing `canonical_encounter_addenda` remains the sole encounter-addendum authority.

No runtime route was wired, no provider flag was enabled, no production query or mutation occurred, no production migration/backfill was applied, local sync remained disabled, no push occurred, and CDB-to-main integration was not performed.

The production activation and legacy-retirement gates remain blocked until exact authorization, production schema/backfill rehearsal, observation, rollback proof, reader/writer cutover evidence and retirement approval exist.

Verification evidence:

- 9 focused/governance files and 45 tests passed;
- `pnpm exec tsc --noEmit` passed;
- `pnpm build:migrations` passed with 490 migrations;
- local readiness passed and production readiness remained false.

Final receipt: `docs/database/migration-runs/P11-canonical-clinical-document-diagnosis-authority.md`.

## 19. Next local checkpoint

The next unresolved authority in the reviewed matrix is patient vital measurement. Three competing fact stores currently coexist: `patient_vitals`, `clinical_vitals`, and `global_patient_vitals`; nursing monitoring remains a typed domain extension.

The next checkpoint is `CDB-123A-PATIENT-VITAL-MEASUREMENT-AUTHORITY-DESIGN`.

The exact next action is to audit writers, readers, schema drift, patient/encounter identity, practitioner/device provenance, measurement code/unit/value semantics, effective and recorded time, amendment/error handling, duplicate detection, offline/global projections and nursing extensions; then lock one immutable Canonical observation authority before any schema, runtime, provider or production change.

## 20. CDB-123A patient vital measurement authority design

`CDB-123A-PATIENT-VITAL-MEASUREMENT-AUTHORITY-DESIGN-VERIFIED`

The repository audit confirmed competing vital authorities in `patient_vitals`, `clinical_vitals`, `global_patient_vitals`, and `nur_patient_monitoring`, with `vital_alert_rules` and `vital_alerts` acting as a `patient_vitals`-specific projection. The global table also has incompatible `uhid, logged_on` and `patient_id, logged_at` runtime contracts.

The locked target is one immutable observation authority with exactly three additive families:

1. `canonical_vital_observation_sets`;
2. `canonical_vital_observation_components`;
3. `canonical_vital_observation_status_events`.

One observation set groups one capture act; one component stores one coded measurement and one canonical unit. Corrections create a replacement set and immutable event. Hard delete is forbidden. Alerts, classification, BMI, wellness scores, nursing charts, dashboards, reports, and timelines are projections or consumers.

The design locks exact patient-link, encounter, practitioner, external-device, effective-time, recorded-time, code, unit, value, review, supersession, idempotency, source-mapping, and evidence rules. Same patient/time/value is not identity proof. Patient-reported observations start pending review. Temperature is stored in `Cel`; BP requires paired systolic/diastolic components; BMI is derived evidence.

CDB-123B will implement the additive schema only. CDB-123C will implement four atomic commands. CDB-123D will implement nine persistent bounded-backfill partitions and fixed twenty-check reconciliation. CDB-123E will implement a disabled-safe provider, selected library adapters, rollback evidence, and fail-closed readiness.

No migration `0556`, schema module, runtime route, provider activation, production query/mutation, local-sync activation, push, or CDB-to-main integration was created or performed in CDB-123A.

## 21. CDB-123E patient vital measurement authority

`CDB-123E-CANONICAL-PATIENT-VITAL-MEASUREMENT-AUTHORITY-VERIFIED`

CDB-123 is locally complete and verified but remains uncommitted because the active connector exposes no Git commit action.

The authority includes three additive Canonical tables, four atomic idempotent commands, nine persistent bounded-backfill partitions, a fixed twenty-check reconciliation receipt, a disabled-safe legacy/shadow/canonical provider, two selected library adapters, four reviewed legacy reader assignments, PHI-minimised shadow evidence, and fail-closed readiness.

Vital observation sets start pending review. Components and status events are immutable. Temperature is normalized to `Cel`, blood pressure requires paired components, BMI is derived from exact canonical weight and height, and corrections create replacement sets rather than rewriting evidence. Exact source mapping is the only cross-table identity proof.

Canonical schema governance now permits only exact registry-approved non-money `REAL` fields. The vital component fields `numeric_value` and `source_numeric_value` are approved; monetary `REAL` rejection remains active and regression-tested.

Verification evidence:

- 7 CDB-123 focused/governance files and 42 tests passed;
- `pnpm exec tsc --noEmit` passed;
- `pnpm build:migrations` passed with 491 migrations;
- readiness passed with local ready, production not ready, zero issues, two adapters, four known readers, zero unknown assignments, and two blocked external gates.

No runtime route was wired, no provider flag was enabled, no production query or mutation occurred, no production migration/backfill was applied, local sync remained disabled, no push occurred, and CDB-to-main integration was not performed.

Final receipt: `docs/database/migration-runs/P12-canonical-patient-vital-measurement-authority.md`.

## 22. Next local checkpoint

The next unresolved authority is medication administration and reconciliation. The next checkpoint is `CDB-124A-MEDICATION-ADMINISTRATION-AUTHORITY-DESIGN`.

Audit `nur_medication_admin`, `cln_medication_reconciliation`, reconciliation items, medication orders, prescriptions, nursing due/execution paths, patient and encounter scope, practitioner/user actors, scheduled and actual dose times, route/site, omission/refusal/waste, late entry, correction, and immutable administration evidence. Keep CDB-124A design-only; do not create schema, change routes, activate providers, or perform production actions.

## 23. CDB-124A medication administration authority design

`CDB-124A-MEDICATION-ADMINISTRATION-AUTHORITY-DESIGN-VERIFIED`

The repository audit confirmed that `nur_medication_admin` mixes future dose schedules, actual administration, non-administration outcomes, mutable correction, and visibility state in the same row. Medication-order creation and MAR schedule generation are non-atomic, administration mutates scheduled rows in place, and soft deletion can hide clinical evidence. Medication reconciliation is a separate mutable workflow whose items, completion, and discharge side effects lack immutable version/signature and atomicity boundaries.

The locked design separates five planned Canonical families:

1. `canonical_medication_administration_events`;
2. `canonical_medication_reconciliations`;
3. `canonical_medication_reconciliation_versions`;
4. `canonical_medication_reconciliation_items`;
5. `canonical_medication_reconciliation_status_events`.

Scheduled dose opportunities are workflow projections, not administration facts. One append-only event records one actual administration or non-administration outcome linked to an exact Canonical medication order and accepted status version. Corrections create replacements; entered-in-error creates immutable evidence; hard delete is forbidden. Given and partially given outcomes require exact dose and route, while every non-administration outcome requires a reason code.

Medication reconciliation remains a separate versioned and signed workflow. Finalization never silently creates prescriptions or medication orders; any resulting intent requires a separate explicit Canonical command. Medicine text, patient/time proximity, schedule similarity, and numeric coincidence are not identity proof.

CDB-124B will add only the five table families. CDB-124C will implement seven atomic commands. CDB-124D will implement eight persistent bounded-backfill partitions and fixed twenty-two-check reconciliation. CDB-124E will add disabled-safe providers, selected library adapters, coverage, rollback evidence, and fail-closed readiness.

No migration `0557`, Drizzle module, command module, provider, route change, production query/mutation, production migration/backfill, local-sync activation, push, or CDB-to-main integration was created or performed during CDB-124A.

Design receipt: `docs/database/migration-runs/P12-canonical-medication-administration-authority-design.md`.

## 24. CDB-124B medication administration schema

`CDB-124B-CANONICAL-MEDICATION-ADMINISTRATION-SCHEMA-VERIFIED`

Migration `0557` and the dedicated Canonical Drizzle module now implement five additive table families for immutable medication administration events and versioned signed medication reconciliation.

Administration events prove exact medication-order and historical status-event version, patient, encounter, administering practitioner, actor, outcome-specific decimal dose/unit/route/reason, time, optional provenance sources, and same-scope replacement lineage. Updates and deletes are blocked.

Reconciliation headers, versions, items, and status events preserve exact patient/encounter scope, deterministic version/item sequence, content and signature parity, controlled finalization, immutable history, and restricted deletion.

Fresh verification:

- medication administration schema: 6 tests passed;
- `pnpm exec tsc --noEmit` passed;
- `pnpm build:migrations` passed with 492 migrations;
- all five tables are registered in Canonical source-of-truth governance.

No runtime route, command provider, production query/mutation, production migration/backfill, sync, push, integration, or retirement action occurred.

Schema receipt: `docs/database/migration-runs/P12-canonical-medication-administration-schema.md`.

## 25. CDB-124C medication administration commands

`CDB-124C-CANONICAL-MEDICATION-ADMINISTRATION-COMMANDS-VERIFIED`

Seven atomic idempotent commands now record administration, correction, entered-in-error, reconciliation draft creation, draft replacement, finalization, and cancellation. Replay occurs before mutable-state validation, compatibility statements and Canonical writes share one batch, and outbox/receipt requests contain a full-operation SHA-256 instead of clinical identifiers or medication content.

Command receipt: `docs/database/migration-runs/P12-canonical-medication-administration-commands.md`.

## 26. CDB-124D medication administration backfill and reconciliation

`CDB-124D-CANONICAL-MEDICATION-ADMINISTRATION-BACKFILL-RECONCILIATION-VERIFIED`

Eight persistent caller-bounded partitions now process exact order-linked administration outcomes, non-administration outcomes, unmapped-order disposition, schedule-only projection disposition, reconciliation headers, reconciliation item/version reconstruction, completion/cancellation lifecycle, and explicit-command/mutable-history disposition.

Legacy MAR and reconciliation source tables remain read-only. Exact Canonical medication-order, patient-link, encounter, practitioner, status-version, outcome, dose/unit, route/reason, and time evidence is mandatory. Free-text medication and numeric/time coincidence never create identity. Schedule-only rows create no administration fact. Ambiguous evidence creates deterministic non-PHI processing issues.

The fixed twenty-two-check reconciliation covers source mappings, order ownership/version, patient/encounter/practitioner/actor scope, outcome and dose/route/reason validity, time order, correction chains, reconciliation version/item ownership and sequence, final signatures, critical issues, source fingerprints, foreign keys, integrity, and second-pass idempotency.

Fresh verification:

- bounded backfill and fixed reconciliation: 2 tests passed;
- eight persisted checkpoints completed;
- source snapshots remained unchanged;
- second pass created zero new business rows;
- `pnpm exec tsc --noEmit` passed.

Receipt: `docs/database/migration-runs/P12-canonical-medication-administration-backfill-reconciliation.md`.

## 27. CDB-124E medication administration provider and readiness

`CDB-124E-CANONICAL-MEDICATION-ADMINISTRATION-PROVIDER-READINESS-VERIFIED`

The disabled-safe `canonical_medication_administration_provider_v1` boundary now supports `legacy`, `shadow`, and `canonical` modes. Absent, disabled, or unsupported feature state resolves to `legacy`; canonical and identity-sensitive reads fail closed without exact source mapping.

Legacy mode preserves current legacy-facing MAR and medication-reconciliation output. Shadow mode preserves that output while emitting only aggregate PHI-minimised parity. Canonical administration projections follow immutable correction and entered-in-error replacement chains. Canonical reconciliation projections expose current version, status, item count, and immutable lifecycle history.

Two selected library adapters are implemented. Five known runtime readers remain `legacy_unchanged`; unknown assignments are zero and route activation count is zero. Default and rollback mode remain `legacy`.

Coverage: `docs/database/canonical-medication-administration-provider-coverage.json`.

Readiness: `docs/database/medication-administration-readiness.json`.

Final receipt: `docs/database/migration-runs/P12-canonical-medication-administration-authority.md`.

Production activation and legacy retirement remain blocked because the provider is disabled, runtime routes are unchanged, production migration/backfill and observation evidence are absent, and exact owner authorization has not been provided.

## 28. CDB-125A lab result and specimen authority design

`CDB-125A-LAB-RESULT-SPECIMEN-AUTHORITY-DESIGN-VERIFIED`

The repository audit confirms that Canonical service requests/events exist, but specimen identity/custody, immutable result versions, component observations, verification/signature lifecycle, correction/retraction/error history, and analyzer provenance do not have one Canonical authority.

The design reuses `canonical_service_requests`, `canonical_service_events`, patient links, encounters, practitioners, service catalog, and typed service participants. It adds eight planned lab domain-extension tables for specimen identity, specimen-service links, immutable custody events, result sets, immutable result versions, immutable observations, result status/signature events, and analyzer source-hash evidence.

Existing `lab_order_items`, `lab_specimens`, `lab_specimen_events`, `lab_reports`, `lab_results`, `lab_observation_audit`, `lab_result_corrections`, `lis_ingestion_messages`, `lis_analyzer_inbox`, retraction requests, `tests`, and `visit_services` remain legacy compatibility, audit, workflow, duplicate, or projection sources. Accession, barcode, test name, analyzer code, result value, patient/time proximity, and `MAX(version) + 1` are not Canonical identity or concurrency contracts.

CDB-125 locks thirteen atomic commands, ten persistent bounded backfill partitions, and fixed twenty-eight-check reconciliation. Report rendering and delivery remain projections. Analyzer raw payload remains in governed LIS storage; Canonical evidence stores exact source identities and hashes.

Audit: `docs/database/audits/2026-07-28-lab-result-specimen-authority-audit.md`.

Specification: `docs/superpowers/specs/2026-07-28-cdb-125a-lab-result-specimen-authority-design.md`.

Plan: `docs/superpowers/plans/2026-07-28-cdb-125-lab-result-specimen-authority.md`.

Receipt: `docs/database/migration-runs/P12-canonical-lab-result-specimen-authority-design.md`.

No migration `0558`, schema module, command module, provider, route change, production query/mutation, production migration/backfill, sync, push, integration, or retirement occurred.

## 29. CDB-125B lab result and specimen schema

`CDB-125B-CANONICAL-LAB-RESULT-SPECIMEN-SCHEMA-VERIFIED`

Migration `0558_canonical_lab_result_specimen.sql` and the dedicated `src/db/schema/canonical/lab-result-specimen.ts` module implement eight additive table families for specimen identity, exact specimen-service links, immutable custody events, result sets, immutable versions, ordered observations, signed status events, and analyzer evidence.

Database guards enforce exact tenant/patient/encounter/request/event/service/specimen/practitioner scope, optimistic current pointers, contiguous versions and observations, one direct replacement per superseded version, decimal TEXT authority, signed-content/content-hash parity, analyzer source uniqueness, immutable history, and restricted deletion.

Fresh schema evidence: 8 tests passed, TypeScript passed, and the migration manifest/governance build passed with 493 migrations.

Receipt: `docs/database/migration-runs/P12-canonical-lab-result-specimen-schema.md`.

## 30. CDB-125C lab result and specimen commands

`CDB-125C-CANONICAL-LAB-RESULT-SPECIMEN-COMMANDS-VERIFIED`

Thirteen atomic idempotent command boundaries now cover specimen registration, collection, receipt, rejection, aliquot creation, result draft creation/replacement, exact signed verification, validation/publication, correction, retraction, entered-in-error, and analyzer evidence attachment.

Every command reads replay before mutable-state validation, rejects changed fingerprints, requires exact reviewed identity scope, writes compatibility/Canonical/mapping/receipt/outbox evidence in one D1 batch, emits PHI-minimised outbox payloads, and rolls back fully on any statement failure. Corrections and terminal dispositions preserve prior immutable versions and observations.

Fresh evidence: command contract 7 tests passed; combined CDB-125A–C suite 21 tests passed; TypeScript passed.

Receipt: `docs/database/migration-runs/P12-canonical-lab-result-specimen-commands.md`.

Runtime routes remain unchanged, no provider exists or is enabled, and no production query, mutation, migration, backfill, sync, push, integration, or legacy retirement occurred.

## 31. CDB-125D lab result and specimen backfill and reconciliation

`CDB-125D-CANONICAL-LAB-RESULT-SPECIMEN-BACKFILL-RECONCILIATION-VERIFIED`

Ten persistent caller-bounded resumable partitions now process exact service mappings, specimen identity, specimen-service links, immutable custody events, current result versions and observations, correction/audit disposition, signed report lifecycle, analyzer provenance, unmatched/collision evidence, and mutable cache/projection disposition.

Every legacy source remains read-only. Patient, encounter, request/event, service, practitioner, specimen, result observation, and analyzer identities require exact reviewed mappings. Accessions, barcodes, names, values, timestamps, machine codes, and proximity never create identity. Ambiguity and unsupported mutable evidence create deterministic non-PHI processing issues.

The fixed twenty-eight-check reconciliation covers mappings, specimen/result ownership, current pointers, custody/version/observation/status sequences, decimal TEXT, practitioner signatures, signed-content parity, analyzer ownership, critical issues, source fingerprints, foreign keys/integrity, and second-pass business rows.

Fresh evidence: bounded backfill/reconciliation 2 tests passed; all ten checkpoints completed; source snapshots were unchanged; second completed pass created zero new business rows; combined CDB-125A–D suite 23 tests passed; TypeScript passed; 493-migration build passed; schema governance 14 tests passed; worktree policy 3 tests passed.

Receipt: `docs/database/migration-runs/P12-canonical-lab-result-specimen-backfill-reconciliation.md`.

## 32. CDB-125E lab result and specimen provider and readiness

`CDB-125E-CANONICAL-LAB-RESULT-SPECIMEN-PROVIDER-READINESS-VERIFIED`

The disabled-safe `canonical_lab_result_specimen_provider_v1` boundary now supports `legacy`, `shadow`, and `canonical` modes. Absent, disabled, or unsupported feature state resolves to `legacy`; Canonical and identity-sensitive reads fail closed without exact source mapping.

Legacy and shadow modes preserve the current legacy-facing specimen/result status and effective-time projection. Shadow mode emits only aggregate PHI-minimised comparison evidence. Canonical specimen projections expose the complete immutable custody sequence. Canonical result projections expose full version lineage, ordered observations, signed lifecycle history, specimen custody, and analyzer provenance. Report rendering and delivery remain projections rather than clinical result authority.

Three library-only selected adapters are implemented. Six known writers and twelve known readers remain `legacy_unchanged`; unknown writer and reader assignments are zero, and route activation count is zero. Default and rollback mode remain `legacy`.

Coverage: `docs/database/canonical-lab-result-specimen-provider-coverage.json`.

Readiness: `docs/database/lab-result-specimen-readiness.json`.

Final receipt: `docs/database/migration-runs/P12-canonical-lab-result-specimen-authority.md`.

Fresh evidence: provider 5 tests passed; readiness 3 tests passed; executable readiness reports `localReady=true`, `productionReady=false`, and zero issues; CDB-125A–E focused suite 31 tests passed; TypeScript passed; 493-migration build passed; continuity, schema governance, and worktree policy 21 tests passed.

Production activation and legacy retirement remain blocked because the provider is disabled, runtime routes are unchanged, production migration/backfill and observation evidence are absent, rollback has not been executed in production, and exact owner authorization has not been provided.

## 33. CDB-126A radiology acquisition and report authority design

`CDB-126A-RADIOLOGY-ACQUISITION-REPORT-AUTHORITY-DESIGN-VERIFIED`

The repository audit confirms that Canonical service request/event/participant and strict radiology billing boundaries already exist, but acquisition/worklist lifecycle, DICOM study/series/instance identity, immutable modality/PACS/storage provenance, and immutable signed report versions do not have one Canonical authority.

The design adds nine planned imaging domain-extension tables for acquisitions, immutable acquisition status events, studies, series, SOP instances, provenance events, report sets, immutable report versions, and signed report status events. Existing patient, encounter, practitioner, service catalog, service request/event/participant, invoice, and accounting authorities are reused.

Current `radiology_requisitions`, `radiology_reports`, `radiology_dicom_studies`, `ris_study_reconciliation_queue`, templates, film usage, invoice lines, R2 keys, print/delivery fields, counts, and audit logs remain legacy compatibility, workflow, domain-extension, projection, or audit sources. Accession, patient name, modality, dates, counts, R2 keys, signatories JSON, report text, and similarity are not identity proof.

CDB-126 locks nine tables, sixteen atomic commands, ten persistent bounded backfill partitions, and fixed thirty-check reconciliation. Raw DICOM pixel data remains in governed PACS/object storage; Canonical stores exact UIDs, hashes, references, and immutable provenance.

Audit: `docs/database/audits/2026-07-28-radiology-acquisition-report-authority-audit.md`.

Specification: `docs/superpowers/specs/2026-07-28-cdb-126a-radiology-acquisition-report-authority-design.md`.

Plan: `docs/superpowers/plans/2026-07-28-cdb-126-radiology-acquisition-report-authority.md`.

Receipt: `docs/database/migration-runs/P12-canonical-radiology-acquisition-report-authority-design.md`.

No migration `0559`, schema module, command module, provider, adapter, route change, production query/mutation, production migration/backfill, sync, push, integration, or retirement occurred.

## 34. CDB-126B radiology acquisition and report schema

`CDB-126B-CANONICAL-RADIOLOGY-ACQUISITION-REPORT-SCHEMA-VERIFIED`

Migration `0559_canonical_radiology_acquisition_report.sql` and the dedicated `src/db/schema/canonical/radiology-acquisition-report.ts` module implement nine additive table families for acquisition/worklist current state, immutable acquisition events, exact DICOM studies, series, SOP instances, immutable provenance, report sets, immutable report versions, and signed report status events.

Database guards enforce exact patient, encounter, request/event, service, performer, acquisition, study, series, instance, report, and practitioner scope; namespaced Study/Series/SOP UID uniqueness; immutable accepted object hashes and storage references; immutable modality/AE/PACS/storage provenance; optimistic current pointers; contiguous acquisition/report sequences; one report replacement per superseded version; signed-content/content-hash parity; and restricted deletion. Raw DICOM pixel data and unrestricted payloads are excluded from Canonical imaging instance/provenance tables.

Fresh evidence: design 6 tests passed; schema 8 tests passed; TypeScript passed; 494-migration build passed; schema governance 14 tests passed; worktree policy 3 tests passed.

Receipt: `docs/database/migration-runs/P12-canonical-radiology-acquisition-report-schema.md`.

## 35. CDB-126C radiology acquisition and report commands

`CDB-126C-CANONICAL-RADIOLOGY-ACQUISITION-REPORT-COMMANDS-VERIFIED`

Sixteen atomic idempotent command boundaries now cover acquisition registration/start/completion/cancellation/error, exact Study/Series/SOP-instance registration, immutable modality/PACS/storage provenance, complete report drafts and replacements, signed verification/finalisation/publication, corrections, retractions, and entered-in-error versions.

Every command reads replay before mutable-state validation, rejects changed idempotency fingerprints, requires exact Canonical and UID/storage scope, and commits compatibility statements, Canonical facts, source mappings, command receipt, and PHI-minimised outbox in one D1 batch. Same SOP Instance UID with changed content hash is rejected as a collision. Prior report content and signatures remain immutable.

Fresh evidence: focused command contract 6 tests passed covering all sixteen commands; CDB-126A–C focused suite 20 tests passed; TypeScript passed; 494-migration build passed; schema governance, continuity, and worktree policy 21 tests passed.

Receipt: `docs/database/migration-runs/P12-canonical-radiology-acquisition-report-commands.md`.

## 36. CDB-126D radiology backfill and reconciliation

`CDB-126D-CANONICAL-RADIOLOGY-ACQUISITION-REPORT-BACKFILL-RECONCILIATION-VERIFIED`

Ten persistent caller-bounded resumable partitions now reconstruct exact requisition scope, acquisition identity/lifecycle, exact Study UID identity, immutable modality/PACS provenance, complete report versions and signed lifecycle while preserving all legacy tables read-only. Study counters never invent Series or SOP Instance identities; missing hierarchy, incomplete storage identity, and unresolved RIS matching remain deterministic non-PHI issues.

The replay-safe reconciliation receipt contains exactly thirty named checks, source fingerprints, foreign-key/integrity evidence, and second-pass evidence. A completed second pass creates zero new business rows, mappings, or issues.

Fresh evidence: focused D contract 2 tests passed; CDB-126A–D focused suite 22 tests passed; TypeScript passed; 494-migration build passed; schema governance, continuity, and worktree policy 21 tests passed.

Receipt: `docs/database/migration-runs/P12-canonical-radiology-acquisition-report-backfill-reconciliation.md`.

## 37. CDB-126E radiology provider and readiness

`CDB-126E-CANONICAL-RADIOLOGY-ACQUISITION-REPORT-PROVIDER-READINESS-VERIFIED`

A disabled-safe provider now supports legacy, shadow, and canonical modes under `canonical_radiology_acquisition_report_provider_v1`. It defaults and rolls back to legacy, requires exact source mappings, fails closed in canonical mode, and exposes acquisition history, exact Study/Series/SOP hierarchy, immutable object/storage provenance, complete report-version lineage, signed verification/finalisation/publication, and correction/retraction/error history.

Four selected library adapters cover acquisition worklist detail, PACS hierarchy/provenance, patient timeline imaging results, and report rendering input. All remain route-inactive. Coverage records eight known writers, eleven known readers, zero unknown assignments, and route activation count zero. Shadow evidence is aggregate and PHI-minimised.

Executable readiness is local-ready true, production-ready false, issue count zero. Provider activation, production observation, rollback execution, owner authorization, and legacy retirement remain absent and blocked.

Fresh evidence: CDB-126A–E focused suite 6 files and 30 tests passed; provider 5 tests passed; readiness 3 tests passed; TypeScript passed; 494-migration build passed.

Receipt: `docs/database/migration-runs/P12-canonical-radiology-acquisition-report-authority.md`.

## 38. CDB-127A emergency case and triage authority design

`CDB-127A-EMERGENCY-CASE-TRIAGE-AUTHORITY-DESIGN-VERIFIED`

The repository audit confirms that `er_patients` currently mixes copied demographics, arrival details, mutable triage and terminal disposition; `er_patient_cases` is unversioned classification authority; `er_discharge_summaries` competes with signed clinical-document/diagnosis authority; `visits` and `admissions` can diverge from ER state; and `qualityKpi.ts` reads a missing/stale `emergency_visits` projection.

The reviewed target is a six-table emergency extension linked to one existing Canonical encounter: case identity, versioned arrival assessments, immutable status events, versioned triage assessments, versioned classifications and immutable dispositions. It reuses Canonical patient, encounter, practitioner, service, clinical-document, diagnosis, vital, medication, admission and finance authorities. No copied demographics or discharge narrative become emergency authority.

The design defines nine atomic commands, eight persistent bounded/resumable backfill partitions, fixed twenty-four-check reconciliation and a disabled-safe legacy/shadow/canonical provider under `canonical_emergency_case_triage_provider_v1`.

Receipt: `docs/database/migration-runs/P12-canonical-emergency-case-triage-authority-design.md`.

## 39. CDB-127B emergency case and triage schema

`CDB-127B-CANONICAL-EMERGENCY-CASE-TRIAGE-SCHEMA-VERIFIED`

Migration 0560 and the dedicated Drizzle module now provide six additive tenant-scoped tables for emergency case identity, immutable versioned arrival assessment, contiguous lifecycle events, immutable triage assessment, immutable classification and typed disposition evidence.

The database enforces one emergency case per exact active patient/emergency encounter, immutable case identity, ordered arrival/observed/recorded times, active practitioner scope, optional exact vital scope, explicit red/yellow/green acuity, typed animal-bite and police-case evidence, exact Canonical admission links, exact signed discharge-summary document versions, transfer source pairs, typed LAMA/DOR/death/error evidence, matching current pointers and hard-delete protection.

Fresh evidence: focused schema contract 7 tests passed; CDB-127A+B with schema governance, continuity and worktree policy 34 tests passed; TypeScript passed; migration build passed with 495 migrations.

Receipt: `docs/database/migration-runs/P12-canonical-emergency-case-triage-schema.md`.

## 40. CDB-127C emergency case and triage commands

`CDB-127C-CANONICAL-EMERGENCY-CASE-TRIAGE-COMMANDS-VERIFIED`

Nine atomic command boundaries now cover emergency registration, arrival correction, triage/reassessment/correction, classification/correction, non-terminal lifecycle, typed disposition and entered-in-error. Every command reads replay before state validation, uses deterministic identities, validates exact patient/encounter/practitioner/vital/admission/signed-document/transport scope, enforces optimistic versions and commits caller compatibility statements, Canonical facts, source mappings and PHI-minimised receipt/outbox in one rollback-safe D1 batch.

Fresh evidence: focused commands 7 tests passed; CDB-127A–C focused suite 20 tests passed; TypeScript passed; migration build passed with 495 migrations; schema governance, continuity and worktree policy 21 tests passed.

Receipt: `docs/database/migration-runs/P12-canonical-emergency-case-triage-commands.md`.

## 41. CDB-127D emergency backfill and reconciliation

`CDB-127D-CANONICAL-EMERGENCY-CASE-TRIAGE-BACKFILL-RECONCILIATION-VERIFIED`

Eight persistent caller-bounded/resumable partitions now reconstruct exact emergency case/arrival identity, current triage, typed classifications and terminal dispositions while preserving every legacy source read-only. Canonical business writes use only the nine CDB-127C commands. Unresolved patient/encounter/practitioner/admission/document/transfer/attachment scope and stale `emergency_visits` projection evidence remain deterministic non-PHI issues rather than fabricated clinical facts.

The replay-safe receipt persists exactly twenty-four named checks, source fingerprints, foreign-key/integrity evidence and second-pass evidence. A completed second pass creates zero new cases, arrivals, status events, triage assessments, classifications, dispositions, mappings or issues.

Fresh evidence: focused backfill/reconciliation 2 tests passed; CDB-127A–D focused suite 22 tests passed; TypeScript passed; migration build passed with 495 migrations; schema governance, continuity and worktree policy 21 tests passed.

Receipt: `docs/database/migration-runs/P12-canonical-emergency-case-triage-backfill-reconciliation.md`.

## 42. CDB-127E emergency provider and readiness

`CDB-127E-CANONICAL-EMERGENCY-CASE-TRIAGE-PROVIDER-READINESS-VERIFIED`

A disabled-safe provider now supports legacy, shadow and canonical modes under `canonical_emergency_case_triage_provider_v1`. It defaults and rolls back to legacy, requires exact mappings for identity-sensitive/shadow/canonical reads, fails closed when the Canonical root is missing, and exposes complete arrival, lifecycle, triage, classification and disposition histories with exact external-authority links.

Three selected library-only adapters cover the emergency board/worklist, patient timeline/clinical summary and disposition/admission/discharge handoff. Coverage records four known writers, six known readers, zero unknown assignments and route activation count zero. Shadow evidence contains aggregate counts, booleans, timing and evidence hash only.

Executable readiness is local-ready true, production-ready false and issue count zero. Provider activation, route cutover, production migration/backfill/observation, rollback execution, owner authorization and retirement remain absent and blocked.

Fresh evidence: CDB-127A–E focused suite 6 files and 30 tests passed; provider 5 tests passed; readiness 3 tests passed; TypeScript passed; migration build passed with 495 migrations.

Receipt: `docs/database/migration-runs/P12-canonical-emergency-case-triage-authority.md`.

## 43. Owner-approved rebaseline

`CDB-V1-000-COURSE-CORRECTION-AND-PROGRAM-REBASELINE`

The verified CDB-122 through CDB-127E work remains preserved. Broad authority expansion is frozen at CDB-127E while Canonical Core V1 becomes the primary lane. `CDB-128A-OPERATION-THEATRE-PROCEDURE-AUTHORITY-DESIGN` is deferred and may resume later as a non-production canonical-only rewrite under the parallel board.

## 44. Protected production-core surface inventory

`CDB-V1-010-PROTECTED-PRODUCTION-CORE-SURFACE-INVENTORY-VERIFIED`

The deterministic inventory at `docs/database/protected-core-v1-surface-inventory.json` records 871 classified protected surfaces: 44 mounted HTTP routes, 28 UI flows, 216 direct or indirect writers, 460 operational or reporting readers, 83 reached tables, 22 target providers/contracts, 6 reports, 1 scheduled job, 3 exports and 8 shared dependencies. Unknown protected writer and reader assignments are both zero.

Each surface records current authority, intended Canonical authority/provider, owner-approved live-scope repository evidence, exact identity and minor-unit rules, migration/backfill requirements, read-promotion requirements, rollback action and retirement gate. The validator rejects stale artifacts, missing mounts/evidence, incomplete contracts and any production authorization flag.

The inventory deliberately excludes diagnostics, pharmacy, inventory, procurement, emergency, OT, nursing, insurance, payroll, expense, IPD and Patient Mobile paths unless an explicit protected-core dependency is claimed. Repository review found zero leakage from those non-production domains. No production database, runtime, traffic, deployment, provider activation, migration/backfill or retirement action was accessed or changed.

Audit: `docs/database/audits/2026-07-28-protected-production-core-surface-inventory.md`.

## 45. Canonical Core V1 authority and contract freeze

`CDB-V1-020-CORE-V1-AUTHORITY-AND-CONTRACT-FREEZE-VERIFIED`

The deterministic freeze at `docs/database/protected-core-v1-authority-contracts.json` records 22 protected concept contracts: 19 Canonical table owners, two governed external authorities (`users` and `global_patient_identity`) and one governed metric registry. Unresolved duplicate authority and non-production scope leakage are both zero.

Each contract freezes exact command names and implementation status, atomic/idempotent/audited transaction rules, provider keys and rollback modes, tenant/public-ID identity, status vocabularies, append-only correction/reversal semantics, integer-minor-unit equations, compatibility routes, migration/second-pass rules and legacy retirement dispositions. Existing implementation is distinguished from named contract-only gaps so later command/provider work cannot introduce competing boundaries.

Audit: `docs/database/audits/2026-07-28-core-v1-authority-contract-freeze.md`.

## 46. Protected writer command coverage baseline

`CDB-V1-030A-PROTECTED-WRITER-COMMAND-COVERAGE-BASELINE-VERIFIED`

The deterministic baseline at `docs/database/protected-core-v1-writer-command-coverage.json` binds all 218 protected writers to the frozen CDB-V1-020 command contracts. It records 107 Canonical-command writers, 43 atomic-compatibility writers, three governed-external writers, 61 command-required writers and four isolated fixtures, with zero unclassified writers.

The 61 remaining writers are grouped into 17 exact implementation groups. The baseline deliberately keeps `commandCoverageComplete=false`; it does not claim full CDB-V1-030 completion. Every entry freezes its required commands/modules, strict boundary IDs, one-batch transaction, idempotency, audit/outbox, compatibility, rollback and next-action rules.

Audit: `docs/database/audits/2026-07-28-protected-writer-command-coverage-baseline.md`.

## 47. Canonical compensation-rule commands

`CDB-V1-030B1-CANONICAL-COMPENSATION-RULE-COMMANDS-VERIFIED`

The frozen practitioner-compensation-rule command boundary is implemented at `src/lib/canonical/contracts/manage-compensation-rule.ts` with `createCompensationRule`, `replaceCompensationRule` and `retireCompensationRule`. Rules use exact tenant/service/practitioner references, integer fixed/basis-point values, source mappings, optimistic versions and append-only immutable snapshots.

Exact replay returns the prior result, changed replay conflicts, stale versions fail closed and caller-supplied compatibility statements roll back together with Canonical rule, mapping and outbox writes. Authority governance now records 17 existing command boundaries and three remaining contract-only boundaries. New access-registry pairs raise the deterministic protected inventory to 871 surfaces, 216 writers and 460 readers, with zero unknown or unclassified assignments.

The two protected compensation-rule route writers remain `command_required`; full writer coverage is therefore not claimed. The next checkpoint is `CDB-V1-030B2-COMPENSATION-RULE-ROUTE-INTEGRATION`: integrate the exact route mutations atomically without changing HTTP, money, identity or authority contracts. Do not query or mutate production without separate exact authorization.

Audit: `docs/database/audits/2026-07-28-compensation-rule-command-implementation.md`.

## 48. Compensation-rule route integration

`CDB-V1-030B2-COMPENSATION-RULE-ROUTE-INTEGRATION-VERIFIED`

The protected doctor commission rule and diagnostic performer payout rule writers now route create, replace and retire mutations through the frozen Canonical compensation-rule commands. Shared adapter: `src/lib/canonical/compensation-rule-route-integration.ts`. Legacy compatibility mutation, audit, exact practitioner/service bootstrap, immutable rule version, source mapping and outbox evidence commit in one D1 batch while existing HTTP status, response messages, validation and legacy history behaviour remain intact.

Migration `0561_compensation_rule_route_identity.sql` adds a nullable tenant-unique stable source key for new doctor-rule POST operations without rewriting old rows. Old rows bootstrap their exact current source snapshot before replacement or retirement when Canonical history is absent. Later compensation accruals consume the same source key, preventing a second rule identity.

The deterministic protected inventory is now 875 surfaces, 218 writers and 462 readers. Writer coverage records 107 Canonical-command, 43 atomic-compatibility, three governed-external, 61 command-required and four isolated-fixture writers across 17 remaining implementation groups, with zero unknown or unclassified assignments.

The next checkpoint is `CDB-V1-030C-PRACTITIONER-ROUTE-INTEGRATION`: integrate the one protected `doctors.ts` writer with practitioner identity and practitioner-account-link commands. Do not query or mutate production without separate exact authorization.

Audit: `docs/database/audits/2026-07-28-compensation-rule-route-integration.md`.

## 49. Practitioner route integration

`CDB-V1-030C-PRACTITIONER-ROUTE-INTEGRATION-VERIFIED`

The protected `src/routes/tenant/doctors.ts` create, identity-update, activation and deactivation mutations now cross the frozen practitioner identity and practitioner-account-link command boundary through `src/lib/canonical/practitioner-route-integration.ts`. Legacy doctor compatibility, master-data audit, Canonical practitioner state, exact source mapping, BMDC/classification correction evidence, user-link lifecycle, idempotency receipt and PHI-minimised outbox commit in one D1 batch. Projection-only updates retain atomic legacy plus audit behaviour without creating unnecessary practitioner versions.

Migration `0563_practitioner_route_identity.sql` adds nullable tenant-unique `doctors.canonical_source_key` without rewriting existing rows; migration `0562` remains reserved for the isolated Operation Theatre lane. Existing active practitioner mappings are reused, numeric legacy sources preserve historical `prc_*` identities and route-generated keys use `pract_*`. Live doctor compensation consumes the same source key, preventing a second practitioner identity.

Replay with the same operation key returns the prior result even when transport timestamps differ; changed replay conflicts. BMDC replacement retires the prior identifier, specialty/department display and primary classification remain synchronized, and doctor deactivation retires the exact linked user relationship without deleting history. SQLite contracts prove create/update/bootstrap/deactivate lifecycle and complete rollback.

The deterministic protected inventory is now 877 surfaces, 218 writers and 464 readers. Writer coverage records 107 Canonical-command, 44 atomic-compatibility, three governed-external, 60 command-required and four isolated-fixture writers across 15 remaining implementation groups, with zero unknown or unclassified assignments. Fresh verification passed 9 focused files / 114 tests, TypeScript, 497-migration manifest, full Canonical governance and dirty-worktree policy.

Implementation commit: `0a311fb31`. Audit: `docs/database/audits/2026-07-28-practitioner-route-integration.md`.

The next checkpoint is `CDB-V1-030D-PATIENT-IMPORT-IDENTITY-ROUTE-INTEGRATION`: integrate the single protected `settings-import-export.ts` / `patients` insert writer with governed global-patient identity and tenant-patient-linkage commands. Production access or mutation remains unauthorized.

## 50. Patient import identity route integration

`CDB-V1-030D-PATIENT-IMPORT-IDENTITY-ROUTE-INTEGRATION-VERIFIED`

The protected `src/routes/tenant/settings-import-export.ts` patient CSV writer now crosses the frozen tenant-patient linkage boundary through `src/lib/canonical/patient-import-route-integration.ts` and `registerOrLinkPatient`. Each valid row commits the explicit-ID legacy patient, non-PHI audit, unlinked Canonical relationship, immutable event, exact source mapping, idempotency receipt and outbox in one D1 batch while preserving CSV parsing, validation, row counters, first-20 errors, HTTP status and sample/export behaviour.

Migration `0564_patient_import_route_identity.sql` adds nullable tenant-unique `patients.canonical_source_key` without rewriting existing rows. Batch and row identities are tenant-scoped SHA-256 evidence derived from the explicit client operation key or exact CSV payload. Raw CSV, names, phone numbers and client keys are not Canonical source IDs. Equal name/mobile evidence from another source does not merge identities; imports remain `unlinked` and `unverified` without a global UHID claim until exact reviewed MPI evidence exists.

`registerOrLinkPatient` now accepts caller-owned authoritative statements in the same Canonical batch. Replay fingerprints retain semantic lifecycle and evidence fields but exclude transport event time and business date, so exact retries replay while changed row evidence conflicts. SQLite contracts prove exact replay, non-merge behaviour and complete rollback if audit compatibility fails.

The deterministic protected inventory is now 878 surfaces, 218 writers and 465 readers. Writer coverage records 107 Canonical-command, 45 atomic-compatibility, three governed-external, 59 command-required and four isolated-fixture writers across 13 remaining implementation groups, with zero unknown or unclassified assignments. Fresh verification passed 5 focused files / 70 tests, TypeScript, 498-migration manifest, full Canonical governance and dirty-worktree policy.

Implementation commit: `8d5ae82e6`. Audit: `docs/database/audits/2026-07-28-patient-import-identity-route-integration.md`.

The next checkpoint is `CDB-V1-030E-APPOINTMENT-INTENT-ROUTE-INTEGRATION`: integrate the four remaining appointment-intent writers in appointment billing finalisation, doctors, doctor schedules and queue. Production access or mutation remains unauthorized.

## 51. Appointment intent route integration

`CDB-V1-030E-APPOINTMENT-INTENT-ROUTE-INTEGRATION-VERIFIED`

The four remaining appointment-intent writers now cross reviewed strict boundaries. Doctor dashboard status, signed consultation completion, report-review completion and queue completion/no-show require exact tenant patient, practitioner, appointment and encounter mappings. Legacy appointment, visit and queue compatibility, master-data audit, Canonical appointment/status/link facts, source mapping, idempotency receipt and PHI-minimised outbox commit in one D1 batch. Completion fails closed without one exact encounter mapping.

Migration `0565_appointment_route_identity.sql` adds nullable tenant-unique appointment source identity. Exact retries replay despite changed transport time, while changed semantic evidence conflicts. Doctor reassignment creates immutable reschedule lineage and a new source identity rather than rewriting Canonical history. The reviewed route adapter is `src/lib/canonical/appointment-route-integration.ts`.

Doctor schedules remain practitioner-linked domain extensions. Migration `0566_appointment_schedule_route_identity.sql` adds nullable tenant-unique schedule source identity; create, update and retirement commit compatibility, audit, versioned mapping, receipt and outbox atomically. Retired schedules cannot be reopened. The reviewed extension adapter is `src/lib/canonical/appointment-schedule-route-integration.ts`. Appointment billing finalisation remains a strict finance projection guarded by expected billing status and financial batch assertions rather than creating planning authority.

The deterministic protected inventory is now 886 surfaces, 219 writers and 472 readers. Writer coverage records 108 Canonical-command, 49 atomic-compatibility, three governed-external, 55 command-required and four isolated-fixture writers across 12 remaining implementation groups, with zero unknown or unclassified assignments. Fresh verification passed 12 focused files / 196 tests, TypeScript, 500-migration manifest, full Canonical governance and dirty-worktree policy.

Implementation commit: `e9bce7a88`. Audit: `docs/database/audits/2026-07-29-appointment-intent-route-integration.md`.

The next checkpoint is `CDB-V1-030F-ENCOUNTER-CARE-EPISODE-ROUTE-INTEGRATION`: integrate the four remaining encounter-care-episode writers in doctors, queue and visits with the frozen encounter commands. Production access or mutation remains unauthorized.

## 52. Encounter care episode route integration

`CDB-V1-030F-ENCOUNTER-CARE-EPISODE-ROUTE-INTEGRATION-VERIFIED`

The four remaining encounter-care writer pairs now cross reviewed atomic boundaries. Direct visit create, doctor participant replacement and IPD discharge use `src/lib/canonical/encounter-route-integration.ts`; doctor signed consultation and queue completion combine prepared encounter completion with appointment fulfilment in one outer D1 batch. Queue cancellation uses the frozen encounter cancellation guard.

`src/lib/canonical/commands/start-encounter.ts` now includes `completeEncounter`, `replaceEncounterParticipant` and prepared composite completion alongside start/cancel. `src/lib/canonical/command-batch.ts` exposes replay-safe command preparation without changing the existing outbox/idempotency envelope. Migration `migrations/0567_encounter_visit_route_identity.sql` adds nullable tenant-unique visit source identity without rewriting existing rows.

All promoted paths require exact tenant patient, practitioner, visit, appointment and encounter mappings. Exact retries replay; changed evidence conflicts; stale encounter versions and appointment/visit mapping disagreement fail closed. Compatibility visit/queue/signed-encounter rows, audit, Canonical encounter/participant/status facts, appointment fulfilment, source mapping and command outbox claims commit atomically.

The deterministic protected inventory is now 890 surfaces, 219 writers and 476 readers. Writer coverage records 108 Canonical-command, 53 atomic-compatibility, three governed-external, 51 command-required and four isolated-fixture writers across 11 remaining implementation groups, with zero unknown or unclassified assignments. Fresh verification passed 13 focused files / 201 tests, TypeScript, 501-migration manifest, full Canonical governance and dirty-worktree policy.

Implementation commit: `6098c2790`. Audit: `docs/database/audits/2026-07-29-encounter-care-episode-route-integration.md`.

The next checkpoint is `CDB-V1-030G-SERVICE-DELIVERY-EVENT-ROUTE-INTEGRATION`: integrate the four remaining service-delivery-event writers in billing-create-batch, appointment billing finalisation, billing cancellation and visits. Production access or mutation remains unauthorized.


## 53. Service delivery event route integration

`CDB-V1-030G-SERVICE-DELIVERY-EVENT-ROUTE-INTEGRATION-VERIFIED`

The four remaining service-delivery writer pairs now cross reviewed atomic boundaries in direct billing, appointment billing finalisation, provisional cancellation and direct visit consultation. Billing and operational acceptance create an `accepted` event with fulfilled quantity zero; delivered care remains a separate event.

`src/lib/canonical/service-delivery-route-integration.ts` composes the frozen service request/event commands implemented in `src/lib/canonical/commands/service-operations.ts` with exact source mapping, replay-safe receipts, optional same-batch encounter/service evidence and mapped or bootstrap cancellation. Migration `migrations/0568_service_delivery_route_identity.sql` adds nullable tenant-unique source identity to `visit_services` and `billing_provisional_items` without rewriting existing rows.

Direct visit, direct billing and appointment finalisation commit compatibility rows, exact patient/service/encounter/practitioner evidence, financial assertions where applicable, audit, Canonical request/event/participant facts, mappings and outbox atomically. Provisional cancellation either cancels the exact mapped accepted event or creates accepted history and cancels it in the same batch.

The deterministic protected inventory is now 911 surfaces, 223 writers and 493 readers. Writer coverage records 112 Canonical-command, 57 atomic-compatibility, three governed-external, 47 command-required and four isolated-fixture writers across 10 remaining implementation groups, with zero unknown or unclassified assignments. Fresh verification passed 11 focused files / 219 tests, TypeScript, 502-migration manifest, full Canonical governance and dirty-worktree policy.

Implementation commit: `d8726db6d`. Audit: `docs/database/audits/2026-07-29-service-delivery-event-route-integration.md`.

The next checkpoint is `CDB-V1-030H-PRACTITIONER-COMPENSATION-ACCRUAL-ADJUSTMENT-INTEGRATION`: integrate the four remaining accrual/adjustment writers in billing refund commission, diagnostic performer reserve, billing cancellation and commissions. Production access or mutation remains unauthorized.

## 54. Practitioner compensation accrual and adjustment integration

`CDB-V1-030H-PRACTITIONER-COMPENSATION-ACCRUAL-ADJUSTMENT-INTEGRATION-VERIFIED`

All remaining protected compensation accrual/adjustment writer pairs now cross reviewed strict or atomic compatibility boundaries. Refund commission reservation/release remains bound to the existing live Canonical refund compensation authority. Diagnostic performer reserve and doctor commission cancellation use `src/lib/canonical/compensation-accrual-route-integration.ts`, exact source mappings, integer-minor-unit payable evidence, guarded compatibility updates, expected-change assertions, non-PHI audit, immutable Canonical adjustments, idempotency receipts and outbox evidence.

`src/lib/canonical/commands/accrue-compensation.ts` now exposes `prepareCompensationAdjustment` without changing the `canonical.compensation.adjust` contract. Exact replay returns the prior result; changed replay conflicts; stale payable state fails closed; paid compensation still requires explicit settlement reversal. Legacy mode preserves compatibility behavior, shadow mode is monitored best effort and strict mode commits compatibility plus Canonical adjustment in one D1 transaction.

Doctor commission approval remains a compatibility workflow state and now commits the exact transition plus audit atomically. Settlement remains under `executeLiveCompensationSettlement` and the immutable Canonical settlement/allocation boundary. The exact compatibility allowance for the new adapter remains temporary and blocked from retirement until compensation write/read cutover, zero unexplained variance, production observation, rollback evidence and explicit authorization.

The deterministic protected inventory is now 918 surfaces, 226 writers and 497 readers. Writer coverage records 112 Canonical-command, 66 atomic-compatibility, three governed-external, 41 command-required and four isolated-fixture writers across nine remaining implementation groups, with zero unknown or unclassified assignments. Fresh verification passed nine focused files / 159 tests, TypeScript, the 502-migration manifest, full Canonical governance and dirty-worktree policy.

Audit: `docs/database/audits/2026-07-29-practitioner-compensation-accrual-adjustment-integration.md`. The current connector exposes no Git commit action, so the local checkpoint commit remains explicitly pending. No production action occurred.

The next checkpoint is `CDB-V1-030I-PRACTITIONER-COMPENSATION-SETTLEMENT-INTEGRATION`: complete the five remaining settlement writer pairs across refund cash hold/dispute, billing counter and commission routes. Production access or mutation remains unauthorized.

## 55. Practitioner compensation settlement and cash custody integration

`CDB-V1-030I-PRACTITIONER-COMPENSATION-SETTLEMENT-INTEGRATION-VERIFIED`

The five remaining practitioner-compensation settlement writer pairs now cross reviewed Canonical or atomic compatibility boundaries. `src/lib/canonical/contracts/manage-cash-custody.ts` implements `recordCashCustodyMovement`, `reverseCashCustodyMovement`, and `closeCashCustodySession` with exact integer-minor-unit evidence, deterministic source mapping, replay protection and caller-owned authoritative statements. `src/lib/canonical/live-cash-custody.ts` provides the registered `cash-custody.movement` strict boundary.

Billing-counter variance handover now commits session close, drawer movement, handover document, held-refund custody transfer, audit, mapping, idempotency and outbox in one transaction. Executed-refund cash return and refund-dispute recovery compose prepared custody statements inside their existing parent financial commands. The accounting poster materialises generic custody movement events and deliberately skips session-close evidence without creating a second movement.

Compensation settlement now reuses the exact practitioner route source mapping. Doctors with a Canonical source key retain the `pract` identity family; numeric-only historical doctors retain the `prc` fallback. Settlement headers, items, accrual transitions and immutable Canonical allocations therefore reference one practitioner identity.

The deterministic protected inventory remains 918 surfaces, 226 writers and 497 readers. Writer coverage is now 112 Canonical-command, 73 atomic-compatibility, three governed-external, 34 command-required and four isolated-fixture writers across eight remaining implementation groups, with zero unknown or unclassified assignments. Cash custody raises command authority to 18 existing and reduces contract-only command boundaries to two. Repository access evidence records 1,017 writers and 2,620 readers.

Fresh verification passed 14 focused files / 124 tests, three governance files / 19 tests, TypeScript, the 502-migration manifest and full Canonical governance. Audit: `docs/database/audits/2026-07-29-practitioner-compensation-settlement-cash-custody-integration.md`. The local checkpoint commit remains pending because the current connector exposes no Git commit action. No production action occurred.

The next checkpoint is `CDB-V1-030J-CASH-CUSTODY-WRITER-INTEGRATION`: complete the five remaining cash-custody writers across billing-counter-session, appointment billing finalisation, gateway payment verification, cash-ledger writer and payment-void execution. Production access or mutation remains unauthorized.

## 56. Cash custody writer integration

`CDB-V1-030J-CASH-CUSTODY-WRITER-INTEGRATION-VERIFIED`

The five remaining cash-custody implementation-group writer pairs now cross reviewed command or guarded atomic compatibility boundaries without promoting workflow/projection tables as physical-cash authority. Reviewed paths are `src/lib/billing-counter-session.ts`, `src/lib/canonical/appointment-billing-finalization.ts`, `src/lib/canonical/gateway-payment-verification.ts`, `src/lib/cash-ledger-writer.ts`, and `src/lib/payment-void-execution.ts`. `billing_counter_sessions` remains a workflow document: stale close is tenant-scoped, excludes pending variance, and refuses to close sessions with held refund cash; workstation heartbeat remains ownership/projection state and creates no custody movement.

Appointment employee-cash compatibility is bound to `appointment.billing.finalize`; cash tenders are owned by `issueInvoiceWithFullPayment`, while non-cash tenders create no custody movement. Gateway verification is explicitly restricted to reviewed non-cash bKash/Nagad providers, preventing mobile-wallet receipts from increasing physical drawer authority. Payment void remains inside `payment.reverse`, whose Canonical command emits a custody refund only for an exact cash tender.

`cash_ledger_entries` remains a rebuildable projection. Its explicit bridge commits the projection, typed accounting event, `canonical.cash_custody.movement.record` envelope, source mapping and custody outbox atomically. A fresh SQLite conflict test proves a custody outbox collision rolls back the projection, accounting event and mapping with no partial row.

The deterministic protected state remains 918 surfaces, 226 writers and 497 readers. Writer coverage is now 112 Canonical-command, 78 atomic-compatibility, three governed-external, 29 command-required and four isolated-fixture writers across seven remaining implementation groups, with zero unknown or unclassified assignments. Fresh verification passed 12 focused files / 91 tests, three governance files / 19 tests, TypeScript, the 502-migration manifest and full Canonical governance.

Audit: `docs/database/audits/2026-07-29-cash-custody-writer-integration.md`. The local checkpoint commit remains pending because the current connector exposes no Git commit action. No production action occurred.

The next checkpoint is `CDB-V1-030K-CREDIT-REFUND-PAYMENT-REVERSAL-INTEGRATION`: complete the five remaining credit/refund/payment-reversal writer pairs using the existing credit-note, refund and payment-reversal commands. Production access or mutation remains unauthorized.

## 57. Credit, refund and payment reversal integration

`CDB-V1-030K-CREDIT-REFUND-PAYMENT-REVERSAL-INTEGRATION-VERIFIED`

The five remaining credit/refund/payment-reversal writer pairs now cross reviewed Canonical commands or guarded atomic compatibility boundaries. Reviewed paths are `src/lib/billing-refund-cash-hold.ts`, `src/lib/billing-refund-dispute.ts`, `src/lib/canonical/gateway-payment-verification.ts`, `src/lib/executed-refund.ts`, and `src/lib/payment-void-execution.ts`. `billing_refund_cash_holds` remains workflow state rather than money authority. Executed-refund cash return or dispute selection, cash-hold resolution, legacy credit-note reversal, compensation restoration, accounting evidence and immutable `reverseCreditNoteCashRefund` facts commit inside `credit-note.cash-refund.reverse`. Cash return and dispute are mutually exclusive; missing eligible custody fails before mutation.

Refund-dispute recovery records one cash-in and settles the liability exactly once; authorized write-off closes the liability without inventing cash. Gateway `income` remains a non-cash bKash/Nagad projection under `canonical.gateway_payment.settle`. Payment-void `income` remains a reversal projection under `reversePayment`; paid practitioner compensation continues to block reversal until payout reversal.

The deterministic protected state remains 918 surfaces, 226 writers and 497 readers. Writer coverage is now 112 Canonical-command, 83 atomic-compatibility, three governed-external, 24 command-required and four isolated-fixture writers across six remaining implementation groups, with zero unknown or unclassified assignments. Fresh verification passed 12 focused files / 52 tests, three governance files / 19 tests, TypeScript, the 502-migration manifest and full Canonical governance.

Audit: `docs/database/audits/2026-07-29-credit-refund-payment-reversal-integration.md`. The local checkpoint commit remains pending because the current connector exposes no Git commit action. No production action occurred.

The next checkpoint was `CDB-V1-030L-PAYMENT-RECEIPT-TENDER-ALLOCATION-INTEGRATION`: complete the four remaining payment receipt/tender/allocation writer pairs across appointment billing finalisation, gateway verification and payment void. Production access or mutation remained unauthorized.

## 58. Payment receipt, tender and allocation integration

`CDB-V1-030L-PAYMENT-RECEIPT-TENDER-ALLOCATION-INTEGRATION-VERIFIED`

The four remaining payment receipt, tender and allocation writer pairs now cross reviewed Canonical commands or guarded atomic compatibility boundaries. Reviewed paths are `src/lib/canonical/appointment-billing-finalization.ts`, `src/lib/canonical/gateway-payment-verification.ts`, and `src/lib/payment-void-execution.ts`. Existing `issueInvoiceWithFullPayment`, `settleGatewayPayment`, `collectPayment` and `reversePayment` commands remain the fact authorities.

Appointment finalisation retains one legacy `payments` compatibility row while the Canonical command owns the exact invoice, posted receipt, tender and full allocation. Gateway workflow logs remain immutable/auditable compatibility history; reviewed bKash/Nagad settlement creates captured non-cash tender, exact allocation and optional unallocated deposit liability without physical cash-custody evidence. Payment void retains its negative legacy payment row inside `payment.reverse`, which owns immutable reversal and exact restoration of receipt, tender, allocation, invoice and cash-custody state.

The deterministic protected state remains 918 surfaces, 226 writers and 497 readers. Writer coverage is now 112 Canonical-command, 87 atomic-compatibility, three governed-external, 20 command-required and four isolated-fixture writers across five remaining implementation groups, with zero unknown or unclassified assignments.

Audit: `docs/database/audits/2026-07-29-payment-receipt-tender-allocation-integration.md`. The local checkpoint commit remains pending because the current connector exposes no Git commit action. No production action occurred.

The next checkpoint is `CDB-V1-030M-SERVICE-CATALOG-PRICING-INTEGRATION`: complete the five remaining service-catalog/pricing writer pairs across billing master, price categories and settings import/export using the existing service-catalog and effective-price authorities. Production access or mutation remains unauthorized.

## 59. Service catalog and pricing integration

`CDB-V1-030M-SERVICE-CATALOG-PRICING-INTEGRATION-VERIFIED`

The five protected route writer pairs across billing master, price categories and settings import/export now cross the implemented Canonical service-catalog and effective-price commands. Reviewed route files are `src/routes/tenant/billingMaster.ts`, `src/routes/tenant/priceCategories.ts` and `src/routes/tenant/settings-import-export.ts`. The two compatibility identity writes owned by `src/lib/canonical/service-catalog-route-integration.ts` are also registered as guarded atomic compatibility boundaries.

`src/lib/canonical/contracts/manage-service-catalog.ts` implements `upsertCanonicalServiceCatalogItem`, `setCanonicalServicePrice` and `retireCanonicalServicePrice`, including prepared composition for caller-owned compatibility statements. Service identities are tenant-scoped and source-key based. Prices retain exact BDT integer minor units, explicit base or price-category context, non-overlapping effective intervals and immutable replacement/retirement history. Stale evidence, changed replay, overlap and cross-tenant references fail closed.

Migration `migrations/0569_service_catalog_route_identity.sql` adds nullable tenant-unique source identity to `billing_service_items` and `billing_item_price_category_maps` without rewriting existing rows. Service create, update, copy, deactivation, price-matrix mutation, price-category mapping and settings CSV import now commit compatibility rows, Canonical facts, source mappings, idempotency receipt and outbox atomically.

The deterministic protected state is now 941 surfaces, 235 writers, 510 readers and 84 protected tables. Writer coverage records 117 Canonical-command, 96 atomic-compatibility, three governed-external, 15 command-required and four isolated-fixture writers across four remaining implementation groups, with zero unknown or unclassified assignments. Command authority is now 19 existing and one contract-only boundary. Repository access evidence records 1,031 writers and 2,690 readers.

Pre-sync verification passed eight focused files / 76 tests, TypeScript, the 503-migration manifest and full Canonical governance. Audit: `docs/database/audits/2026-07-29-service-catalog-pricing-integration.md`. Checkpoint commit `68fd0af2c` records the completed 030M slice. Reviewed local `main` source `fb4565ba0` was synchronized into the CDB branch under explicit user instruction. Post-main-sync verification passed a 20-file / 168-test merge-focused suite and a final 10-file / 68-test migration, credit-note, commission and continuity regression, plus TypeScript, the 504-migration manifest and full Canonical governance. No production query, mutation, activation, deployment, push or CDB-to-main integration occurred.

The next checkpoint was `CDB-V1-030N-INVOICE-DEPOSIT-REPORTING-INTEGRATION`: complete the protected invoice-document, patient-deposit-liability and reporting-metric writer slice. Production access or mutation remained unauthorized.

## 60. Invoice, deposit and reporting integration

`CDB-V1-030N-INVOICE-DEPOSIT-REPORTING-INTEGRATION-VERIFIED`

Eight live invoice, invoice-line, patient-deposit and bill-restoration writer pairs now cross reviewed strict financial command boundaries. Reviewed paths are `src/lib/billing-create-batch.ts`, `src/lib/canonical/appointment-billing-finalization.ts`, `src/lib/canonical/gateway-payment-verification.ts`, `src/lib/executed-refund.ts` and `src/lib/payment-void-execution.ts`. The unused direct `bills` updater has been removed from `src/lib/billing-payment-state.ts`, leaving one calculation-only module instead of a parallel invoice authority.

No new financial command was introduced. Billing creation retains `issueInvoice`; appointment due/pay-now retains `issueInvoice` or `issueInvoiceWithFullPayment`; gateway verification retains `settleGatewayPayment`; executed-refund rejection retains `reverseCreditNoteCashRefund`; payment void retains `reversePayment`. Legacy compatibility, financial assertions, Canonical facts, exact source mappings, idempotency receipts and outbox events commit in one strict batch. Exact bill, appointment, provisional-item and gateway snapshots fail closed when stale. Gateway overpayment creates a distinct mapped deposit liability. Payment void remains blocked by paid doctor compensation.

The deterministic protected state is now 939 surfaces, 234 writers, 509 readers and 84 tables. Writer coverage records 117 Canonical-command, 104 atomic-compatibility, three governed-external, six command-required and four isolated-fixture writers. Only one implementation group remains, `canonical_outbox_atomic_assertions`, and no command-required writer remains for invoice-document, patient-deposit-liability or reporting-metric read-promotion concepts. Repository access evidence records 1,030 writers and 2,689 readers.

Fresh verification passed 12 focused files / 81 tests, TypeScript, the 504-migration manifest and full Canonical governance. Audit: `docs/database/audits/2026-07-29-invoice-deposit-reporting-integration.md`. Checkpoint commit `36e346037` records the completed 030N slice. Main source `31cfd37d9` was then synchronized as merge `e5ecdb00f`; its password/login migration suites passed 8 files / 27 tests and TypeScript. No production query, mutation, migration/backfill, provider activation, deployment, traffic change or push occurred.

The next checkpoint was `CDB-V1-030O-CANONICAL-OUTBOX-ATOMIC-ASSERTION-INTEGRATION`: complete the six remaining `accounting_posting_events` writer pairs across refund commission/dispute, appointment finalisation, compensation accrual, gateway verification and executed refund. Production access or mutation remained unauthorized.

## 61. Canonical outbox and atomic assertion integration

`CDB-V1-030O-CANONICAL-OUTBOX-ATOMIC-ASSERTION-INTEGRATION-VERIFIED`

All six remaining `accounting_posting_events` writer pairs now cross registered Canonical outbox and atomic financial-assertion boundaries. `src/lib/billing-refund-commission.ts` routes the approval replay-recovery path through `canonical.refund_commission.impact`; `src/lib/billing-refund-dispute.ts` routes authorized write-off through `canonical.refund_dispute.writeoff`. Exact replay is read before mutable-state validation, changed replay fails closed, deterministic source-event identity and non-PHI evidence hashes are retained, and stale guarded rows roll back compatibility state, accounting events, assertion rows and the outbox claim together.

The remaining appointment finalisation, compensation accrual, gateway verification and executed-refund accounting-event writers reuse their existing strict parent commands. They remain compatibility projections rather than a second accounting authority. Every registered pair has command/outbox evidence, row-count assertions, tenant isolation and complete rollback evidence.

The deterministic protected state remains 939 surfaces, 234 writers, 509 readers and 84 tables. Writer coverage now records 117 Canonical-command, 110 atomic-compatibility, three governed-external, zero strict-blocked, zero command-required and four isolated-fixture writers. Unknown and unclassified writers are zero, and no implementation group remains. Repository access evidence records 1,031 writers and 2,689 readers. The writer registry now marks protected command coverage complete and routes the serial Core V1 programme to read-provider shadow comparison.

Focused checkpoint verification passed 13 files / 60 tests and covers exact replay/conflict, non-PHI outbox payloads, guarded assertion cleanup, stale-state rollback and all six governance registrations. TypeScript, the 504-migration manifest and full Canonical governance pass. Main source `0ee410d65c0342d8e42c85503d1a43767788f110` was then synchronized as merge `9527a7574`; the combined post-main-sync suite passed 15 files / 65 tests, TypeScript, the 504-migration manifest and full Canonical governance. Audit: `docs/database/audits/2026-07-29-canonical-outbox-atomic-assertion-integration.md`. No production query, mutation, migration/backfill, provider activation, deployment, traffic change, push or CDB-to-main integration occurred.

The next checkpoint was `CDB-V1-040-CANONICAL-READ-PROVIDERS-AND-SHADOW-COMPARISON`: implement provider-selected protected reads and local or separately authorized protected-clone comparisons while legacy mode remained the default. Production provider activation, production reads, traffic change and legacy-reader retirement remained separately unauthorized.

## 62. Financial read provider foundation

`CDB-V1-040A-FINANCIAL-READ-PROVIDER-FOUNDATION-VERIFIED`

The first bounded read-provider slice implements tenant-selected invoice, payment/allocation and patient-deposit providers in `src/lib/canonical/contracts/`, with shared mode, source-mapping and shadow-evidence infrastructure in `src/lib/canonical/financial-read-provider.ts`. The exact provider keys are `canonical_invoice_provider_v1`, `canonical_payment_provider_v1` and `canonical_deposit_provider_v1`. Missing, disabled or unknown flags select legacy; shadow mode compares the exact tenant-scoped Canonical mapping while returning the legacy projection; Canonical mode fails closed unless exactly one mapped Canonical row exists; switching the flag back to legacy is immediate rollback.

The providers compare exact display/source keys, normalized document/settlement status, integer BDT minor-unit totals and row counts. Invoice proves paid plus due equals total. Payment proves allocated plus unallocated equals total. Deposit proves applied plus refunded plus available equals original amount. Deterministic variance IDs, row keys, status, totals, latency budget, build SHA and rollback mode are persisted as non-PHI evidence in existing `canonical_reconciliation_runs`; no migration is required.

The frozen authority contract now records invoice, payment and deposit provider boundaries as implemented, production-disabled boundaries. Provider counts are nine existing and nine contract-only. No application route, dashboard, report, export, scheduled job or admin consumer has been switched, and no protected-clone batch has been run. The deterministic repository state is 951 surfaces, 235 writers, 519 readers and 85 tables; writer coverage remains complete at 118 Canonical-command, 110 atomic-compatibility, three governed-external, zero command-required and zero implementation groups. Repository access evidence is 1,032 writers and 2,702 readers.

Focused checkpoint and continuity verification passes five files / 27 tests, including default legacy mode, exact mapping, zero-variance evidence, deterministic mismatch IDs, Canonical fail-closed behaviour, tenant isolation and immediate rollback. TypeScript, the 504-migration manifest and full Canonical governance also pass. Main source `757c6ebc3ed8ae07d989f84a783a7f1faaf8e275` was first synchronized as merge `f6918401f`; verification passed six backend/CDB files / 40 tests and four web billing files / 169 tests. Main then advanced again to `f11f09f3526ea453632951455c73c727568dbfdb`, synchronized as merge `1e669b7c6`; final verification passed five CDB files / 27 tests, six dashboard accessibility files / 35 tests, root and web TypeScript, the 504-migration manifest and full Canonical governance. Audit: `docs/database/audits/2026-07-29-financial-read-provider-foundation.md`. Production query, mutation, migration/backfill, provider activation, deployment, traffic change, push and CDB-to-main integration did not occur.

The next checkpoint was `CDB-V1-040B-FINANCIAL-READ-CONSUMER-AND-SHADOW-BATCH-INTEGRATION`: wire the three providers into bounded legacy-default consumers and add a local or separately authorized protected-clone shadow batch. Production provider activation and production reads remained separately unauthorized.

## 63. Financial read consumer and shadow batch integration

`CDB-V1-040B-FINANCIAL-READ-CONSUMER-AND-SHADOW-BATCH-INTEGRATION-VERIFIED`

`src/lib/canonical/financial-read-consumer-adapters.ts` now provides stable legacy-default boundaries for billing detail, report, dashboard, export, scheduled-job and admin consumers. The bounded runner accepts at most 100 exact tenant/provider/consumer/source records, rejects duplicate scope and fails closed on provider failure, non-shadow selection, missing evidence or mapping, unexplained variance and latency breach. Every success retains `selectedProvider=legacy`, exact source and Canonical row keys, deterministic variance IDs, elapsed time, latency budget, build SHA and immediate legacy rollback.

`GET /api/billing/:id/inspector` now crosses the invoice consumer adapter. Default legacy mode preserves the API response, shadow mode persists comparison evidence while returning legacy, and Canonical mode remains separately flag-gated. The invoice legacy projection now includes active deposit applications in settled totals, while the inspector keeps cash paid and deposit applied as separate response fields.

A real local SQLite/D1 shadow batch exercised all six consumer categories and persisted six passed reconciliation rows with exact source/Canonical keys, build SHA `cc5b5f41d`, zero variance IDs and no PHI. This is local test evidence only; it is not protected-clone or production authorization. Deterministic repository state is 952 surfaces, 235 writers, 520 readers and 85 tables; repository access evidence is 1,032 writers and 2,703 readers. Writer coverage remains complete at 118 Canonical-command, 110 atomic-compatibility, three governed-external, zero command-required and zero remaining implementation groups.

Focused provider, adapter and invoice-inspector verification passes three files / 16 tests. Root TypeScript passes. Final continuity, migration-manifest and Canonical governance evidence is recorded with the checkpoint metadata. Audit: `docs/database/audits/2026-07-30-financial-read-consumer-shadow-batch-integration.md`. Production query, mutation, migration/backfill, provider activation, deployment, traffic change, push and CDB-to-main integration did not occur.

The next checkpoint was `CDB-V1-040C-REMAINING-CRITICAL-READ-PROVIDER-INTEGRATION`: wire patient/practitioner identity, Reception episode and practitioner-compensation critical readers through actual legacy-default consumers, add bounded local evidence and prepare—but do not execute—a separately authorized protected-clone comparison package.

## 64. Remaining critical read provider integration

`CDB-V1-040C-REMAINING-CRITICAL-READ-PROVIDER-INTEGRATION-VERIFIED`

The remaining protected critical-reader boundary is now implemented. `src/lib/canonical/critical-read-consumer-adapters.ts` governs patient identity, practitioner identity, appointment, encounter, admission/bed and compensation accrual comparison under six stable consumer IDs. The exact provider keys are `canonical_patient_identity_provider_v1`, `canonical_practitioner_provider_v1`, `canonical_appointment_provider_v1`, `canonical_encounter_provider_v1`, `canonical_admission_bed_provider_v1` and `canonical_compensation_accrual_provider_v1`. The batch is bounded to 100 exact scopes and fails closed on duplicate scope, provider failure, missing shadow evidence, missing or ambiguous mapping, unexplained variance and unauthorized Canonical response promotion.

`GET /api/reception/patients/:id/context` now observes the five identity/episode provider families while preserving the existing legacy response. Observation-only identifiers are removed before serialization. Shadow failures retain the legacy response and emit aggregate evidence; Canonical response promotion is explicitly blocked until separately authorized. `GET /api/commissions/doctor-accruals` now uses `canonical_compensation_accrual_provider_v1`, defaults and rolls back to legacy, persists shadow evidence and compares earned, adjusted, settled and payable compensation in integer BDT minor units.

A local SQLite/D1-equivalent batch exercised six provider/consumer scopes and persisted six passed reconciliation rows with exact source and Canonical row keys, build evidence, zero variance IDs and PHI-minimised summaries. The protected-clone package at `docs/database/cdb-v1-040c-protected-clone-comparison-package.json` is prepared but explicitly not authorized or executed.

Deterministic repository state is 954 surfaces, 235 writers, 522 readers and 85 tables. Repository access evidence is 1,033 writers and 2,705 readers. Provider boundaries are 10 existing and 8 contract-only. Writer command coverage remains complete with 118 Canonical-command, 110 atomic-compatibility, zero command-required and zero implementation groups. Focused verification passes six files / 68 tests; final continuity, migration-manifest and governance evidence is recorded in checkpoint metadata. Audit: `docs/database/audits/2026-07-30-critical-read-provider-consumer-integration.md`.

No production or protected-clone query/mutation, migration/backfill, provider activation, deployment, traffic change, local-sync activation, push or CDB-to-main integration occurred.

The next gate is `CDB-V1-050-PROTECTED-CLONE-MIGRATION-BACKFILL-AND-ROLLBACK-REHEARSAL-AUTHORIZATION-REQUIRED`. CDB-V1-050 must not execute until fresh exact authorization binds the protected clone identity, source snapshot checksum, commit/build, tenant and source-row scope, backup/export evidence, named execution and rollback owners, acceptance thresholds, abort conditions and observation window.

Non-production lanes may continue in parallel only according to `docs/architecture/hms-canonical-parallel-execution-board.yaml` and `docs/architecture/non-production-canonical-rewrite-playbook.md`.

## 65. Protected-clone rehearsal authorization contract

`CDB-V1-050A-PROTECTED-CLONE-REHEARSAL-AUTHORIZATION-CONTRACT-READY`

The repository-side CDB-V1-050 authorization boundary is implemented. `scripts/canonical/protected-clone-rehearsal-authorization.ts` strictly validates a protected external JSON authorization file and binds the exact protected-clone target, current branch/commit/build, comparison-package and migration-manifest checksums, source snapshot and backup evidence, tenant-bound source-row scopes, ordered migrations, bounded backfills, named execution/rollback/observation owners, current UTC window, zero-tolerance acceptance and immediate legacy rollback.

Nine provider keys, twelve stable consumer IDs and nine source tables are governed through exact tuple allowlists. Scope is bounded to ten tenants, 100 records, 50 migrations and 30 backfill scripts. Authorization documents inside the repository, unsafe permissions, duplicate/unknown/sensitive fields, symlinks, hard links, stale repository or script hashes, cross-tenant records, production target reuse, future snapshots, expired windows and generic continuation approval all fail closed.

`validate-protected-clone-rehearsal-authorization.ts` emits only sanitized issues, an aggregate receipt and a non-executing plan. `check-protected-clone-rehearsal-readiness.ts` is included in `canonical:check`, with machine evidence at `docs/database/cdb-v1-050-protected-clone-rehearsal-readiness.json`. Repository readiness is `contractReady=true`, `executionReady=false`, `issueCount=0` because no protected external authorization document currently binds the exact operational values. Focused authorization/continuity verification passes four files / 23 tests; combined provider/consumer/authorization/continuity regression passes eleven files / 63 tests; root TypeScript, the 504-migration manifest and full Canonical governance pass. Implementation commit: `4a4ac0154`; evidence commit: `fd585fa04`; final metadata is the current branch HEAD after metadata finalization. Audit: `docs/database/audits/2026-07-30-protected-clone-rehearsal-authorization-contract.md`.

No protected clone or production query/mutation, migration/backfill, provider promotion, rollback, deployment, traffic change, local-sync activation, push or CDB-to-main integration occurred.

The exact next gate was `CDB-V1-050-PROTECTED-CLONE-MIGRATION-BACKFILL-AND-ROLLBACK-REHEARSAL-EXACT-AUTHORIZATION-REQUIRED`. Execution required a fresh protected external authorization file validating against the current repository HEAD and execution window; that gate has now been completed by CDB-V1-050.

## 66. Protected-clone migration, backfill and rollback rehearsal

`CDB-V1-050-PROTECTED-CLONE-MIGRATION-BACKFILL-AND-ROLLBACK-REHEARSAL-VERIFIED`

A fresh exact owner authorization bound one tenant, 24 provider/consumer/source scopes, nineteen ordered migrations, four bounded backfills and immediate legacy rollback to execution commit `6ae413f077dc66a9007a9b2f4f3974b67b5d4a10`. The execution ran only against a protected local SQLite/D1-equivalent clone. Protected authorization documents, database paths, row identifiers and detailed logs remain outside Git.

The migration ledger advanced from 497 to 516. All nineteen migrations and four backfills completed; four backfill reconciliations passed; the mandatory second pass created zero new business rows. Twenty-four shadow comparisons passed with zero unexplained variance, provider errors, mapping ambiguity, tenant crossing or latency breach. Reception, billing, payment and commission smoke workflows passed. Nine provider promotions were rehearsed and immediately rolled back, leaving all nine flags disabled in legacy mode.

Independent verification confirmed integrity `ok`, zero foreign-key violations, unchanged source snapshot and rollback backup hashes, and a target distinct from the source. Three earlier bounded attempts failed closed and each target was restored byte-for-byte to ledger 497, integrity `ok`, FK 0 before the corrected run. Fresh verification passes thirteen focused files / 67 tests, root TypeScript, the 504-migration manifest and full Canonical governance including the executable result checker. Current governance records 260 governed tables, 1,034 writers, 2,725 readers and identity/episode coverage of 859 reader pairs across 297 paths and 63 tables with zero unknown assignments. Execution binding commit: `6ae413f07`; evidence commit: `8d6379a6c`; final metadata is the current branch HEAD after metadata finalization. Sanitized result: `docs/database/cdb-v1-050-protected-clone-rehearsal-result.json`. Audit: `docs/database/audits/2026-07-30-protected-clone-rehearsal-execution.md`.

No network or production read/mutation, production provider activation, deployment, traffic change, local-sync activation, legacy retirement, push or CDB-to-main integration occurred.

The next checkpoint is `CDB-V1-060-PRODUCTION-AUTHORIZATION-PACKAGE-PREPARATION`. It may prepare an exact production package locally, but production execution requires a new fresh exact owner authorization.

## 67. Production authorization package preparation

`CDB-V1-060-PRODUCTION-AUTHORIZATION-PACKAGE-READY`

The repository-side production authorization package is prepared at `docs/database/cdb-v1-060-production-authorization-package.json`. It is bound to candidate implementation commit `35e299d9ff2dc1781084dacd6d0f431816b0007c`, the verified CDB-V1-050 result and checker, the current cutover runbook, the 504-entry migration manifest, nineteen exact additive migration hashes, four exact bounded backfill hashes, tenant `100` as the single read-only shadow canary template, nine providers, twelve consumers and nine source tables.

The package exposes eight non-executing phases: preflight, backup verification, migration, backfill, reconciliation, shadow canary, observation and rollback. Zero unexplained variance, provider errors, mapping ambiguity, tenant crossing, foreign-key violations and second-pass business writes are required. Immediate rollback to legacy is mandatory. Canonical writes, destructive migrations, deployment, traffic change, local-sync activation and legacy reader/writer retirement are explicitly excluded from the first cutover.

Repository evaluation reports `packageReady=true`, `executionReady=false`, issue count 0 and 18 unresolved external bindings. The unresolved values are intentionally outside Git: production database identity, snapshot/bookmark and checksum, backup/export evidence, maintenance window, execution/rollback/observation owners, owner approval, observation thresholds and deployed worker/build evidence. Sanitized package SHA-256: `a5be3083a19a827996d8c94ce2787634b24e08e526d245c11981266b69a08bf5`.

Implementation commits are `590dd56e7` for the package contract, `3a0620667` for the preparation CLI and `35e299d9f` for readiness governance. Package/evidence commit is `c16b66508`; final metadata is the current branch HEAD after metadata finalization. Audit: `docs/database/audits/2026-07-30-production-authorization-package-preparation.md`. Design: `docs/superpowers/specs/2026-07-30-cdb-v1-060-production-authorization-package-design.md`. Plan: `docs/superpowers/plans/2026-07-30-cdb-v1-060-production-authorization-package.md`.

Fresh verification passes sixteen focused files / 79 tests, root TypeScript, the 504-migration manifest, task-mode worktree policy and full Canonical governance. Current governance remains 260 governed tables, 1,034 writers, 2,725 readers and identity/episode coverage of 859 reader pairs across 297 paths and 63 tables with zero unknown assignments.

No network request, production query/mutation, migration/backfill, provider promotion, deployment, traffic change, observation, local-sync activation, legacy retirement, push or CDB-to-main integration occurred.

The exact next gate is `CDB-V1-070-STAGED-PRODUCTION-CUTOVER-EXACT-AUTHORIZATION-REQUIRED`. Generic continuation approval does not satisfy it. Execution requires a fresh protected external authorization bound to the then-current package/candidate/build, exact production identity and backup evidence, one-tenant scope, owners, window, thresholds, deployed build, confirmation tokens, abort conditions and immediate legacy rollback.

## 68. All-tenant Legacy-primary shadow production preflight

`CDB-V1-065-ALL-TENANT-SHADOW-PRODUCTION-PREFLIGHT-COMPLETE`

The owner corrected the intended first production operating model from a one-tenant provider canary to zero-user-downtime shadow processing for every active tenant while Legacy remains the selected user-visible read/write authority. This scope correction does not promote Canonical reads or writes and does not authorize Legacy retirement.

Fresh aggregate/read-only production checks verified active tenants `1`, `100`, `101` and `102`. The existing `canonical_financial_dual_write_v1` non-blocking shadow policy is already active for all four tenants with `activationReady=true`, issue count 0 and rows written 0. The exact nine CDB-V1-060 read-provider flags are absent for all four tenants: expected rows 36, current shadow rows 0 and missing rows 36. The protected provider-scope validator reports `activationReady=false`, provider count 9, active tenant count 4, issue count 9 and rows written 0.

Production currently serves Worker version `4f5d8f93-92d4-4fda-8fba-c0a2863f1b71` from source commit `f11f09f3526ea453632951455c73c727568dbfdb`; rollback version `db8ece29-efd0-4827-8b65-968619557f0d` remains at zero traffic. Production also has 29 pending migrations from `0541` through `0570`, excluding reserved `0562`. A corrected review classifies 27 as additive and `0548`/`0549` as data-preserving SQLite table rebuilds with rename/copy/drop operations. The rebuilds require explicit authorization, row-parity evidence, an exclusive-lock budget, protected backup/Time Travel evidence and post-apply integrity verification.

The repository now contains an exact all-active-tenant provider shadow SQL contract, an exact disable-only rollback and an aggregate/read-only production validator. Every activation configuration binds `mode=shadow`, `readPolicy=shadow` and `responseAuthority=legacy`. Focused verification passes nine files / 42 tests and root TypeScript. Audit: `docs/database/audits/2026-07-30-all-tenant-shadow-production-preflight.md`. Corrected execution plan: `docs/superpowers/plans/2026-07-30-cdb-v1-070-all-tenant-shadow-rollout.md`.

No production mutation, deployment, traffic change, migration/backfill, provider activation, Canonical promotion, local-sync activation, Legacy retirement, push or CDB-to-main integration occurred. Activating the nine provider flags now would be unsafe because production does not yet run the CDB candidate and lacks the required schema, production backfill and reconciliation evidence.

The exact next gate is `CDB-V1-070-ALL-TENANT-LEGACY-PRIMARY-SHADOW-EXECUTION-EXACT-AUTHORIZATION-REQUIRED`. The fresh authorization must bind the final candidate Worker, exact 29-migration set, Time Travel/export evidence, all-tenant backfill bounds, owners, observation thresholds, confirmation tokens and immediate provider/Worker rollback. The corrected execution order is candidate deploy with Legacy defaults, schema convergence, bounded backfill, zero-variance reconciliation, all-tenant shadow activation and daily observation.

## 69. All-tenant shadow execution authorization contract

`CDB-V1-070A-ALL-TENANT-SHADOW-EXECUTION-AUTHORIZATION-CONTRACT-READY`

The repository now contains a new all-tenant execution package and strict protected authorization boundary for the owner-selected Legacy-primary shadow model. The implementation/preparation commit is `63f555b688dfc7456b56bb60048690740d0f77da`. The sanitized package is `docs/database/cdb-v1-070-all-tenant-shadow-execution-package.json` with SHA-256 `40d5a069e9080f3465d6f367950522e6515c5ff712525073ccde5732536a57c3`.

Repository evaluation reports `packageReady=true`, `authorizationPresent=false`, `authorizationReady=false`, `executionReady=false`, issue count 0 and 34 unresolved protected external bindings. The corrected package fixes four tenants, 27 additive migrations, two separately classified data-preserving table rebuilds, four bounded backfills, nine providers, 36 expected flag rows, ten non-executable phases, zero-tolerance acceptance, immediate provider/Worker rollback and a minimum 4,320-minute observation period. Every committed production permission remains false, and a future authorization must explicitly bind row-parity evidence and exclusive-lock budgets for `0548` and `0549`.

A valid authorization must be a strict JSON file outside Git under a mode-700 directory with a mode-600 regular file, no symlink and no hard link. It must bind the exact integrated `main` candidate, production D1, active-tenant evidence, candidate and previous Worker versions, Time Travel and export evidence, exact migration/backfill/provider scope, thresholds, single-operator risk acceptance and deterministic confirmation tokens. Generic continuation language cannot satisfy the approval-source contract.

TDD verification passes five focused files / 20 tests and root TypeScript. Package generation and repository readiness both pass. No deployment, traffic change, production migration/backfill, provider activation, observation, rollback, Canonical promotion, local-sync activation, Legacy retirement, push or CDB-to-main integration occurred.

The exact next gate remains `CDB-V1-070-ALL-TENANT-LEGACY-PRIMARY-SHADOW-EXECUTION-EXACT-AUTHORIZATION-REQUIRED`. Until a fresh protected authorization validates, Legacy remains unchanged and the nine provider flags remain inactive.

## 70. Staged shadow preparation authorization contract

`CDB-V1-070B-ALL-TENANT-SHADOW-PREPARATION-AUTHORIZATION-CONTRACT-READY`

CDB-V1-070A requires candidate/previous Worker IDs, route and build evidence, active-tenant and migration-ledger evidence, a fresh Time Travel bookmark and a protected export before its final execution authorization can validate. Those values require bounded production-facing preparation, creating a circular dependency when the final execution authorization is required first. CDB-V1-070B corrects the sequence without weakening CDB-V1-070A by introducing a separate preparation-evidence Gate A.

The design/plan commit is `917a6a276`; the implementation commit is `50c793020`; the package/evidence commit is `292738567`. The sanitized Gate A package is `docs/database/cdb-v1-070b-all-tenant-shadow-preparation-package.json` with SHA-256 `5f05cdc683299ca183961f6cf6b8cd6834d819ceb55081a16e3830a114d3a73b`. Repository evaluation reports `packageReady=true`, `authorizationPresent=false`, `authorizationReady=false`, `executionReady=false`, issue count 0 and 36 unresolved external bindings.

Gate A may authorize only exact candidate verification, immutable zero-traffic Worker-version upload, aggregate non-PHI production reads, Time Travel bookmark capture, protected export capture and protected evidence verification. It explicitly prohibits Worker traffic assignment, production migrations, Canonical backfills, provider flag changes, Canonical promotion, local sync, Legacy retirement, destructive action, push and CDB-to-main integration. Legacy remains the user-visible authority and the previous Worker remains at 100% traffic.

A protected Gate A authorization must use approval source `user_explicit_all_tenant_shadow_preparation_evidence_authorization`, bind the exact production D1, integrated `main` candidate, Worker/routes, four-tenant aggregate scope, evidence output, owner risk acceptance and deterministic confirmation tokens, and satisfy mode-700 directory / mode-600 regular-file protection. Generic continuation and the later final execution approval cannot substitute for Gate A approval.

TDD verification passes five Gate A files / 20 tests and root TypeScript. Package generation passes. No production read, production mutation, Worker upload, bookmark/export capture, deployment, migration, backfill, provider activation, traffic change, observation, rollback, Canonical promotion, local-sync activation, Legacy retirement, push or CDB-to-main integration occurred.

The exact next gate is `CDB-V1-070B-ALL-TENANT-SHADOW-PREPARATION-EVIDENCE-EXACT-AUTHORIZATION-REQUIRED`. A validated Gate A receipt will later be bound into the regenerated Gate B final shadow execution package.

## 71. Verified main integration before Gate A

The reviewed CDB program was fast-forward integrated into clean `main` from base `f11f09f3526ea453632951455c73c727568dbfdb` through implementation checkpoint `8613993888f64fab82aee897466f2339c8278ae0`, preserving all deliberate checkpoint commits. The integrated repository now contains the protected-core command/provider coverage, newer Canonical domains, 29-migration candidate set, bounded backfill/reconciliation tooling, protected-clone rehearsal evidence, all-tenant shadow contracts and Gate A/Gate B authorization packages. None of those later repository capabilities is active in production merely because of the merge.

Pre-integration verification on the exact integrated implementation tree passed 1,344 test files / 18,445 tests, root TypeScript, the 504-migration manifest, full Canonical governance and all production builds. Post-integration continuity verification refreshes the generated 504-entry manifest and requires current branch `main` while retaining the immutable historical package preparation-branch bindings.

Parallel state remains bounded: Inventory is complete through `INV-MM-121` and awaits serial integration review; Patient Mobile is active at `PA-0901` in its owned dirty worktree; Full MM remains blocked at finance gate `MM-070`; Operation Theatre retains the exact `0562_canonical_operation_theatre.sql` reservation and its existing worker may resume. Shared Canonical governance remains integration-agent-owned and serialized.

Gate A must begin from the exact latest fetched `origin/main` in a new dedicated branch/worktree and still requires the fresh protected authorization `CDB-V1-070B-ALL-TENANT-SHADOW-PREPARATION-EVIDENCE-EXACT-AUTHORIZATION-REQUIRED`. Repository integration authorizes no production read, Worker upload/deploy, bookmark/export capture, migration, backfill, provider flag, traffic change, Canonical promotion, local sync or Legacy retirement.
