# CDB-124 Medication Administration and Reconciliation Authority Implementation Plan

**Program:** HMS Canonical Data Architecture

**Controlling design:** `docs/superpowers/specs/2026-07-28-cdb-124a-medication-administration-authority-design.md`

**Audit:** `docs/database/audits/2026-07-28-medication-administration-reconciliation-authority-audit.md`

**Execution model:** one persistent serial executor; local/test only until separately authorized

## Locked safety rules

- Existing MAR, medication-order, prescription, reconciliation, and discharge-workflow tables remain unchanged during design and backfill.
- Scheduled dose opportunities remain workflow projections; they are not administration facts.
- Administration events, correction chains, error evidence, reconciliation versions, and reconciliation lifecycle events are append-only.
- Exact Canonical medication-order, patient-link, encounter, practitioner, actor, source, and status-version evidence is required.
- Medication text, patient/time proximity, schedule similarity, and numeric coincidence are forbidden identity mechanisms.
- Reconciliation completion never silently creates prescriptions or medication orders.
- Hard delete is prohibited.
- Provider is disabled by default.
- Production activation remains an external gate.
- Legacy retirement remains an external gate.

## CDB-124A — Authority design

Status: design checkpoint.

Outputs:

- repository-wide MAR, medication-order, medication-due, reconciliation, discharge, and clinical-consumer audit;
- immutable administration-event authority separated from scheduled workflow;
- versioned and signed medication-reconciliation authority separated from administration;
- exact order/status-version, patient, encounter, practitioner, actor, time, dose, route, site, outcome, reason, and correction rules;
- bounded backfill, fixed reconciliation, provider, rollback, and external production-gate plan;
- design contract test;
- authority matrix, tracker, control-centre, receipt, and handoff updates.

No migration, Drizzle schema, runtime command, provider activation, route change, production query/mutation, or retirement is allowed in CDB-124A.

## CDB-124B — Canonical medication administration schema

Create one additive D1/SQLite migration and one dedicated Canonical Drizzle module for:

1. `canonical_medication_administration_events`
2. `canonical_medication_reconciliations`
3. `canonical_medication_reconciliation_versions`
4. `canonical_medication_reconciliation_items`
5. `canonical_medication_reconciliation_status_events`

Required database invariants:

- exact tenant-scoped Canonical medication-order ownership;
- exact medication-order status-version snapshot;
- exact patient-link and encounter scope inherited from the medication order;
- active administering practitioner and governed actor identity;
- controlled administration event kinds and outcome vocabulary;
- canonical decimal dose text and reviewed unit-code pairing;
- dose and route required for `given` and `partially_given`;
- reason code required for every non-administration outcome;
- normalized scheduled, occurred, and recorded timestamps;
- immutable event rows and no hard delete;
- same-scope replacement links, no cycles, and one active replacement;
- reconciliation header/current-version ownership;
- immutable draft/final/cancelled versions and deterministic item sequences;
- final content hash and signer/finalizer evidence;
- immutable reconciliation status history;
- exact source evidence, idempotency, and request fingerprints.

TDD sequence:

1. revalidate migration `0557` availability;
2. write a failing SQLite schema contract first;
3. implement one additive migration and Drizzle parity;
4. export the dedicated Canonical schema module;
5. register all tables in Canonical source-of-truth and authority matrix;
6. run focused schema tests, TypeScript, migration manifest, governance, and continuity.

No route wiring or production migration apply occurs.

## CDB-124C — Atomic administration and reconciliation commands

Implement:

1. `recordCanonicalMedicationAdministrationEvent`
2. `correctCanonicalMedicationAdministrationEvent`
3. `enterCanonicalMedicationAdministrationInError`
4. `createCanonicalMedicationReconciliationDraft`
5. `replaceCanonicalMedicationReconciliationDraft`
6. `finalizeCanonicalMedicationReconciliation`
7. `cancelCanonicalMedicationReconciliation`

Required behavior:

- deterministic public IDs;
- tenant-scoped idempotency;
- replay before mutable-state validation;
- exact Canonical medication-order and accepted status-version validation;
- exact patient-link, encounter, practitioner, and actor validation;
- canonical decimal dose normalization and unit vocabulary;
- outcome-specific dose, route, reason, and timing rules;
- immutable correction and entered-in-error chains;
- optimistic reconciliation status versioning;
- version replacement rather than draft mutation;
- final content hash and practitioner finalization;
- compatibility statements, Canonical facts, source mappings, and durable PHI-minimised outbox intent in one D1 batch;
- rollback on any partial failure.

TDD covers replay conflicts, cross-tenant scope, inactive/cancelled medication orders, stale status versions, missing actors, dose/unit/route/reason rules, future schedule projections, correction chains, error evidence, reconciliation version replacement, finalization, cancellation, and full rollback.

## CDB-124D — Bounded backfill and fixed reconciliation

Implement eight persistent bounded-backfill partitions:

1. order-linked MAR administration outcomes;
2. order-linked MAR non-administration outcomes;
3. MAR rows without exact Canonical medication-order mapping;
4. schedule-only MAR projection disposition;
5. reconciliation headers;
6. reconciliation items and version reconstruction;
7. reconciliation completion/cancellation lifecycle;
8. prescription/order/discharge effect and duplicate/correction disposition.

Rules:

- caller-bounded scan count;
- persistent cursor per partition;
- source tables remain read-only;
- exact mapped MAR outcome creates one immutable event;
- schedule-only rows create no administration fact;
- already mapped rows are skipped;
- ambiguous order, patient, encounter, practitioner, dose, route, timing, correction, or reconciliation evidence becomes a deterministic non-PHI issue;
- free-text medicine never creates order identity;
- second pass creates zero new business rows.

Implement fixed twenty-two-check reconciliation covering source mappings, medication-order ownership and version, patient/encounter/practitioner/actor scope, event/outcome validity, dose/unit and route/reason completeness, time ordering, correction chains, reconciliation current-version ownership, version/item sequence, final signature/content hash, critical issues, source fingerprints, foreign keys, integrity, and second-pass idempotency.

Persist a machine-verifiable reconciliation receipt.

## CDB-124E — Disabled-safe providers, selected adapters, and readiness

Provider flag:

`canonical_medication_administration_provider_v1`

Provider configuration:

- `enabledByDefault: false`
- `defaultMode: legacy`
- `rollbackMode: legacy`
- supported modes: `legacy`, `shadow`, `canonical`

Implement library-level providers and selected adapters only. Do not switch runtime routes during this checkpoint.

Provider rules:

- legacy mode uses the current administration/reconciliation consumer source;
- shadow mode preserves legacy-facing output and emits aggregate PHI-minimised parity;
- canonical mode requires exact source mapping and fails closed;
- medication text, patient/time proximity, schedule similarity, and numeric coincidence remain forbidden identity mechanisms;
- correction/error chains and reconciliation version/status history remain visible;
- due-dose lists, discharge checklist, reports, and summaries remain projections/consumers.

Create machine-checkable coverage and readiness artifacts with:

- every reviewed reader assignment;
- selected adapter count;
- zero unknown assignments;
- zero route activation count;
- local readiness true only after all required evidence exists;
- production readiness false;
- production activation and legacy retirement blocked.

## Verification checkpoint

Before claiming CDB-124 locally complete:

- all CDB-124 focused tests pass;
- Canonical governance and continuity tests pass;
- TypeScript passes;
- migration manifest passes;
- source-of-truth registry and authority matrix agree;
- readiness checker is green locally;
- provider remains disabled;
- runtime routes remain unchanged;
- production query/mutation count remains zero;
- local sync, push, and CDB-to-main integration remain false.

## External production checkpoint

A future separately authorized checkpoint must specify environment and tenant scope, migration/backfill approval, protected rehearsal evidence, source fingerprints, reconciliation receipt, observation duration, parity thresholds, canary readers/writers, rollback owner and command, and legacy retention/retirement decision.

Local completion does not satisfy production activation or legacy retirement.
