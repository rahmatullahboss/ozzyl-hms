# Full HMS Canonical Authority and Legacy-Cutover Completion Plan

**Program:** HMS Canonical Data Architecture  
**Authority registry:** `docs/database/canonical-authority-matrix.yaml`  
**Audit:** `docs/database/audits/2026-07-26-full-hms-canonical-authority-audit.md`  
**Execution branch:** `program/cdb-main-continuous-20260725`  
**Execution posture:** local implementation and verification only unless a later instruction explicitly authorizes protected-clone or production operations

## Owner-approved sequencing override — 2026-07-28

This plan remains historical architecture and gate guidance, but its broad serial domain-expansion order is superseded by:

- `docs/architecture/hms-production-scope-policy.md`;
- `docs/architecture/hms-canonical-parallel-execution-board.yaml`;
- `docs/database/canonical-core-v1-production-cutover-runbook.md`;
- `docs/architecture/non-production-canonical-rewrite-playbook.md`.

The primary lane is now the protected Reception–billing–hospital-setup–doctor-commission Canonical Core V1 transition. Broad authority expansion is frozen at `CDB-127E`; `CDB-128A Operation Theatre` is deferred. Verified non-production domains may be rewritten canonical-only in parallel branches without production-style backfill, dual-write or observation for unused legacy parity.

## Goal

Complete the transition from overlapping legacy/module-specific authorities to one canonical authority for every shared HMS business fact, while preserving historical evidence, operational compatibility, rollback, and tenant safety.

Completion does not mean deleting every old table immediately. Completion means that:

1. every shared business fact has one registered authority;
2. every writer is canonical, compatibility-only, protected, or blocked;
3. every operational and reporting reader can use the canonical provider;
4. historical data is mapped, reconciled, and exception-controlled;
5. one tenant/domain can be cut over and rolled back safely;
6. legacy tables can become read-only compatibility/history before any destructive removal.

## Non-negotiable architecture rules

- Extend only `src/db/schema/canonical/**`, `src/lib/canonical/**`, `scripts/canonical/**`, and `test/canonical/**` for shared canonical authority.
- Do not create or revive a parallel `canonical finance` architecture.
- Do not use `src/lib/financial-reconciliation/**` as authority.
- Do not appoint an existing operational table as canonical merely by renaming it.
- Do not infer ambiguous patient, practitioner, encounter, service, performer, referrer, invoice, payment, or stock identity by numeric coincidence or name similarity.
- Every backfill must be idempotent, resumable, tenant-safe, source-mapped, and second-pass stable.
- Every canonical mutation must own its calculations, idempotency claim, source mapping, canonical rows, and required outbox/assertion records inside one reviewed boundary.
- Every read cutover requires provider comparison and observable rollback.
- No production mutation, deploy, flag change, traffic change, secret access, legacy removal, or destructive migration occurs without fresh explicit authorization.
- Additional local-sync capability work remains paused until core authority and read/write cutover dependencies are closed.

## Phase 0 — Authority governance and freeze

### Task 0.1 — Enforce the authority matrix

1. Keep `canonical-authority-matrix.yaml` machine-readable and reviewable.
2. Verify all canonical tables have exactly one owner.
3. Verify every registered legacy table appears in a concept.
4. Validate status vocabularies, evidence paths, and rejected architecture roots.
5. Add a CLI checker suitable for CI and developer use.
6. Add a package command such as `canonical:authority-check`.
7. Fail closed when a canonical table is unowned, multiply owned, or assigned to a gap/external concept.
8. Fail closed when a new shared-fact legacy writer is not registered.

**Exit gate:** authority checker passes locally and is included in `canonical:check` or an equivalent mandatory verification bundle.

### Task 0.2 — Expand writer inventory beyond the current five tables

1. Scan raw SQL, Drizzle writes, migration/seed writers, scheduled jobs, synchronization routes, and helper services.
2. Register direct writers for identity, appointment/episode, clinical, diagnostics, pharmacy, inventory, HR/payroll, insurance, finance, cash, and accounting.
3. Classify each path as:
   - `canonical_authority`;
   - `canonical_compatibility`;
   - `legacy_authority`;
   - `protected_fixture`;
   - `migration_backfill`;
   - `blocked_in_canonical_mode`;
   - `retirement_candidate`.
4. Record exact table, concept, route/operation, lifecycle status, owner, cutover blocker, and retirement task.
5. Add source-contract tests proving every registered writer still exists and every discovered critical writer is registered.

**Exit gate:** no material direct writer is unclassified.

### Task 0.3 — Build read-consumer registry

1. Inventory dashboards, admin reports, scheduled summaries, public/marketplace APIs, patient portal, global search, operational lists, exports, accounting reports, pharmacy/inventory reports, and synchronization pulls.
2. Record current source and intended canonical provider for every consumer.
3. Classify consumers as `legacy`, `shadow`, `canonical`, `compatibility`, or `external`.
4. Add a fail-closed cutover rule: a legacy table cannot retire while an active consumer reads it directly.

**Exit gate:** each retirement candidate has zero unknown readers.

## Phase 1 — Identity, appointment, and care-episode foundation

This phase is first because most downstream domains require deterministic patient, practitioner, planned-intent, and actual-encounter identities.

### Task 1.1 — Patient identity authority

1. Define tenant patient versus global/MPI identity responsibilities.
2. Add explicit tenant-patient/global-identity links rather than sharing numeric IDs.
3. Preserve aliases, guardians, duplicate suspects, merge/unmerge history, claim codes, and hospital links as typed extensions/workflows.
4. Add deterministic source mappings for existing `patients`, global identity rows, and portal/auth identities.
5. Add duplicate, cross-tenant, null-mobile, shared-mobile, and merge/unmerge reconciliation tests.
6. Provider-switch patient search and cross-hospital resolution without changing clinical episode ownership.

**Exit gate:** every tenant patient maps to zero or one approved global identity; all multi-match cases have stable exception IDs.

### Task 1.2 — Practitioner operational adoption

1. Complete backfill and mapping from doctors, users, employees, and external referrers.
2. Classify every generic clinician ID field by namespace and role.
3. Replace name-only or user-as-practitioner inference with explicit links.
4. Add canonical provider adapters for doctor lists, profile, marketplace, scheduling, reporting, and clinical participant resolution.
5. Preserve `users` as auth actors while canonical practitioners own professional identity.

**Exit gate:** no new shared clinical or compensation fact uses `doctors.id` without a canonical practitioner mapping.

### Task 1.3 — Canonical appointment intent

1. Design canonical appointment header, requested practitioner/location/service, schedule window, token, channel, status history, cancellation/no-show, reschedule lineage, and quoted-price context.
2. Keep appointment as planned intent; do not merge it with the actual encounter.
3. Backfill appointments with source mappings and deterministic status history.
4. Route marketplace, public booking, patient portal, reception, doctor dashboard, reminders, and scheduled notifications through one appointment command/provider.
5. Separate appointment billing projections from appointment authority.

**Exit gate:** every operational appointment writer uses one command; legacy appointment rows are compatibility projections or mapped source history.

### Task 1.4 — Encounter, admission, and bed-stay convergence

1. Group visits, consultations, doctor visits, signed encounters, admissions, completion claims, and appointment links deterministically.
2. Preserve ambiguous many-to-many episodes as issues rather than guessing.
3. Complete encounter participant roles and effective intervals.
4. Make admission an extension/link to an inpatient encounter.
5. Make the open canonical bed stay the occupancy authority.
6. Treat bed status and admission bed ID as compatibility projections.
7. Convert bed pricing to service price and bed charging to service events.
8. Provider-switch active patient/doctor/admission views and inpatient finance links.

**Exit gate:** active care episodes have one encounter authority and one coherent admission/bed-stay relation.

## Phase 2 — Clinical documents and service delivery

### Task 2.1 — Service catalog and effective-price convergence

1. Map billing, lab, radiology, procedure, appointment, bed, and other service identities to one canonical catalog.
2. Preserve lab/radiology/procedure metadata in extensions rather than duplicate base identity.
3. Normalize price currency/unit and create non-overlapping effective price history.
4. Classify free-text and ambiguous service references as issues.
5. Block new module-specific shared service masters.

**Exit gate:** one active canonical service identity per tenant/code/kind and one selected effective price per pricing context.

### Task 2.2 — Diagnostic request/event/participant convergence

1. Route lab and radiology request creation through canonical service requests/items/events.
2. Preserve requester, prescriber, referrer, collector, technician, performer, reporter, and verifier as explicit participants.
3. Never infer performer from verifier or referrer from visit doctor without explicit policy.
4. Add typed request/event links to invoice lines, reagent/film consumption, and compensation.
5. Reconcile duplicate events represented in legacy `tests`, lab workflow, radiology workflow, `visit_services`, and invoice lines.

**Exit gate:** every active billable diagnostic occurrence has one canonical service event and explicit required participant state.

### Task 2.3 — Lab and radiology extensions

1. Add lab specimen/accession, collection, receipt, processing, result version, validation, verification, retraction, and LIS provenance extensions.
2. Add radiology acquisition, scan, report version, performer/reporter, media/PACS, and cancellation extensions.
3. Preserve signed/final historical content and addenda immutably.
4. Ensure event completion, result completion, verification, billing, and cancellation are separate but reconciled state machines.

**Exit gate:** result/report tables are domain extensions, not another service or billing authority.

### Task 2.4 — Prescription, medication, observation, and clinical-document authority

1. Link prescriptions and medication orders to canonical encounters and practitioners.
2. Preserve immutable versions, overrides, refill, and reconciliation history.
3. Define canonical observation/vital identity and source provenance across patient, clinical, nursing, ER, and global vital structures.
4. Define signed clinical note/document, diagnosis, allergy, problem, form, assessment, and addendum authority.
5. Define medication administration and reconciliation authority without merging order and administration facts.

**Exit gate:** each order, administration, observation, and signed clinical document has one typed encounter-linked authority.

### Task 2.5 — ER, OT, and nursing extensions

1. Model ER triage/case, OT booking/procedure/team/checklist/summary, and nursing care as encounter/service extensions.
2. Reuse patient, practitioner, encounter, service event, inventory movement, invoice, and accounting authorities.
3. Do not create module-local copies of shared patient, clinician, service, payment, or stock facts.

**Exit gate:** module-specific tables contain only extension/workflow details.

## Phase 3 — Financial completeness

### Task 3.1 — Complete core strict financial writers

1. Re-run route coverage for invoice, full payment, deposit, credit/refund, reversal, settlement, pharmacy, appointment, lab, radiology, reception, and IPD flows.
2. Integrate or explicitly block every direct financial writer under strict mode.
3. Keep legacy compatibility mutations atomic with canonical commands until read promotion is complete.
4. Preserve immutable reversal and cancellation history; eliminate destructive deletion semantics from canonical mode.

**Exit gate:** zero missing strict financial boundaries.

### Task 3.2 — Provider-selected financial reads

1. Switch collections, invoice details, due, deposit, refund, compensation, IPD finance, and dashboard analytics through canonical providers.
2. Run legacy/canonical shadow comparisons with stable variance IDs.
3. Stop proportional query-time payment allocation once persisted canonical allocations are authoritative.
4. Require exact minor-unit comparison.

**Exit gate:** all critical financial readers can operate canonically with zero unexplained variance.

### Task 3.3 — Direct income and expense lifecycle

1. Create a typed canonical source-document contract for direct non-patient income.
2. Preserve expense request, approval, execution/payment, recovery, rejection, and reversal workflow.
3. Separate expense workflow from cash custody and accounting facts.
4. Co-commit required outbox/custody evidence with the source transition.
5. Convert all money to explicit minor units.

**Exit gate:** direct income and expenses do not rely on duplicated reporting mirrors or post-commit best-effort posting.

### Task 3.4 — Payroll lifecycle

1. Define payroll run, payslip, adjustments, approval, payable, payment, expense recognition, cash/bank settlement, and accounting events.
2. Prevent approved historical payroll from being interpreted as unpaid without explicit migration evidence.
3. Make payroll expense linkage a projection/reference, not the sole payment authority.
4. Reconcile payslip totals, payment totals, expense totals, and accounting entries.

**Exit gate:** one payroll financial lifecycle with no double-payment path.

### Task 3.5 — Insurance lifecycle

1. Define policy/coverage, eligibility, prior authorization, claim lines, submission, adjudication, remittance, denial, patient liability, and adjustment authority.
2. Link claim lines to canonical invoice/service facts.
3. Keep payer remittance separate from patient payment receipts while using the same allocation principles.

**Exit gate:** insurer and patient liabilities reconcile to invoice net and allocations.

### Task 3.6 — Cash custody and accounting promotion

1. Register every custody source type and stable source ID.
2. Convert cash movement and accounting amounts to exact minor units.
3. Require source/outbox atomicity.
4. Ensure a posted voucher cannot be partial or unbalanced.
5. Reconcile employee cash, drawer movement, session, transfer, handover, bank deposit, source document, canonical custody, and voucher facts.
6. Retire legacy journal mutation after mapping and observation.

**Exit gate:** zero unresolved custody coverage difference and exact debit-credit equality.

## Phase 4 — Inventory, procurement, pharmacy, and reagent convergence

### Task 4.1 — Canonical movement posting for every quantity change

1. Classify all transfer, dispatch, return, adjustment, count, reservation, ward supply, lab monitoring, import, write-off, pharmacy, and legacy medicine paths.
2. Route quantity effects through one idempotent canonical movement engine.
3. Preserve workflow documents separately from movement posting.
4. Rebuild balances from movements and compare with existing projections.

**Exit gate:** every balance-changing source line has exactly one immutable movement.

### Task 4.2 — Procurement authority

1. Define vendor, request, RFQ, quotation selection, purchase order, receipt/GRN, supplier invoice, return, and approval relationships.
2. Reuse canonical inventory items/lots/movements and accounting outbox.
3. Merge or adapt rich-pharmacy procurement to the same receipt engine.

**Exit gate:** one procurement/receipt authority per physical receipt and supplier liability.

### Task 4.3 — Pharmacy dispense and OTC event

1. Map prescription fulfilment and OTC sales to canonical dispense/sale service events.
2. Link lot allocations, inventory movements, invoice lines, returns, COGS, prescriber, and dispenser.
3. Stop legacy medicine/batch movement writes after reconciliation.
4. Provider-switch pharmacy item, stock, invoice, return, and expiry readers.

**Exit gate:** one physical medicine quantity and one financial sale per dispense/OTC event.

### Task 4.4 — Lab reagent metadata convergence

1. Link lab consumables to canonical inventory items and lots.
2. Preserve QC, analyser assignment, calibration context, open-vial/onboard expiry, and usage metadata as extensions.
3. Remove independent quantity authority from lab consumable stock.
4. Replace bridge balance copying with source mapping and reconciliation.

**Exit gate:** lab usage quantity derives from canonical inventory movements.

## Phase 5 — Full read promotion

For each domain:

1. define a provider flag and fail-safe legacy fallback during preparation;
2. run shadow queries against the same tenant/time range;
3. store counts, totals, row keys, and variance classifications;
4. prove UI/API contract compatibility;
5. promote canary reads only after zero unexplained variance;
6. observe errors, latency, missing rows, and user-visible totals;
7. preserve immediate rollback;
8. migrate exports, scheduled jobs, admin tools, and hidden operational consumers—not only dashboards.

**Exit gate:** no active consumer requires direct legacy authority reads.

## Phase 6 — Protected-clone and production canary

This phase requires separate explicit authorization.

1. verify exact branch/commit/build and migration manifest;
2. capture backup/export and rollback evidence;
3. select one tenant and one bounded domain;
4. rerun backfill and require second-pass zero new rows;
5. rerun structural, tenant, cardinality, money, balance, and processing-issue reconciliation;
6. run protected smoke workflows;
7. activate canonical strict/read provider only for the approved scope;
8. observe for the approved duration and thresholds;
9. roll back immediately if abort thresholds are crossed;
10. record a signed cutover receipt.

**Exit gate:** approved canary passes observation and rollback proof.

## Phase 7 — Legacy write retirement and archival

For each exact `path:table` allowance:

1. verify production cutover complete;
2. verify canonical read promotion complete;
3. verify observation complete;
4. verify rollback evidence fresh;
5. verify owner authorization;
6. verify lifecycle-specific retirement approval;
7. block or remove the exact writer;
8. keep a compatibility view/adapter where required;
9. prove no active runtime reader or writer remains;
10. archive historical data with source mappings and exception receipts;
11. perform table drop/column removal only under a final destructive authorization.

**Exit gate:** retirement checker reports the exact scope eligible before any removal.

## Cross-phase verification pack

Every implementation checkpoint must run the smallest focused tests plus the relevant broader gates. Before claiming a domain complete, run:

- focused command, mapping, backfill, reconciliation, provider, and isolation tests;
- `pnpm vitest run test/canonical`;
- `pnpm exec tsc --noEmit`;
- `pnpm canonical:check`;
- authority-matrix checker;
- legacy retirement readiness;
- local-sync readiness while synchronization remains paused;
- `pnpm build:migrations`;
- affected web/patient/admin production builds;
- task worktree policy;
- tracker and receipt metadata validation.

## Checkpoint and commit policy

- Use coherent commits by design, implementation, reconciliation, and receipt.
- Do not stop merely because a focused test or commit passes; continue to the next safe checkpoint.
- Never overwrite or discard unrelated dirty work.
- Before each new slice, verify current branch/worktree and inspect every change.
- Keep `main` and production read-only unless an explicit integration/production instruction is given.
- Push and deployment remain separately authorized actions.

## Current next exact action

Execute `CDB-V1-010-PROTECTED-PRODUCTION-CORE-SURFACE-INVENTORY`:

1. preserve and checkpoint verified CDB-122 through CDB-127E work;
2. inventory every active protected-core route, writer, reader, table, provider, report, scheduled job, export and shared dependency;
3. map each surface to its Canonical authority, exact identity or money invariant, migration/backfill need, rollback path and retirement gate;
4. identify zero unknown protected-core writers/readers before freezing Core V1 contracts;
5. do not start CDB-128A and do not query or mutate production without separate exact authorization;
6. allow independent non-production agents to follow the central parallel board and canonical-only rewrite playbook in dedicated worktrees.
