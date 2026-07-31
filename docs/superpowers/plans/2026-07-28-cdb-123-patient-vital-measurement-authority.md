# CDB-123 Patient Vital Measurement Authority Implementation Plan

**Program:** HMS Canonical Data Architecture

**Controlling design:** `docs/superpowers/specs/2026-07-28-cdb-123a-patient-vital-measurement-authority-design.md`

**Audit:** `docs/database/audits/2026-07-28-patient-vital-measurement-authority-audit.md`

**Execution model:** one persistent serial executor; local/test only until separately authorized

## Locked safety rules

- Existing source tables remain read-only during backfill and reconciliation.
- Runtime routes remain unchanged until a separately reviewed adapter checkpoint.
- Exact source mapping is the only cross-table identity proof.
- Patient, encounter, practitioner and device scope must fail closed.
- Components and status events are immutable.
- Hard delete is prohibited.
- Provider is disabled by default.
- Production activation remains an external gate.
- Legacy retirement remains an external gate.

## CDB-123A — Authority design

Status: design checkpoint.

Outputs:

- repository-wide source/writer/reader audit;
- one observation-set/component/event authority;
- measurement code and unit policy;
- correction, review and duplicate policy;
- bounded backfill, reconciliation, provider, rollback and external-gate plan;
- design contract test;
- matrix, tracker and control-center updates.

No migration, Drizzle schema, runtime route, provider activation or production action is allowed in CDB-123A.

## CDB-123B — Canonical patient vital measurement schema

Create one additive D1/SQLite migration and one dedicated Drizzle module for:

1. `canonical_vital_observation_sets`
2. `canonical_vital_observation_components`
3. `canonical_vital_observation_status_events`

Required database invariants:

- exact tenant/patient/encounter/practitioner scope;
- paired external device source fields;
- normalized `effective_at_utc` and `recorded_at_utc`;
- controlled review states and optimistic status version;
- replacement/supersession linkage;
- exact measurement code and canonical-unit pairs;
- finite bounded numeric values;
- component sequence uniqueness;
- derived BMI formula evidence;
- immutable components and status events;
- no hard delete;
- source evidence and idempotency constraints.

TDD sequence:

1. write failing SQLite schema contract;
2. verify migration/module absence failure;
3. implement minimal additive migration and Drizzle parity;
4. run focused schema tests;
5. register all tables in Canonical source-of-truth and authority matrix;
6. run migration manifest and TypeScript checks.

No route wiring or production migration apply occurs.

## CDB-123C — Atomic vital observation commands

Implement:

1. `recordCanonicalVitalObservationSet`
2. `reviewCanonicalVitalObservationSet`
3. `correctCanonicalVitalObservationSet`
4. `enterCanonicalVitalObservationSetInError`

Required behavior:

- deterministic IDs;
- tenant-scoped idempotency;
- replay before state validation;
- optimistic status versioning;
- exact patient/encounter/practitioner/device validation;
- temperature conversion to `Cel` with source value/unit snapshot;
- paired BP validation;
- BMI recomputation and derivation evidence;
- patient-reported observations begin `pending_review`;
- correction creates replacement set and immutable events;
- compatibility statements, Canonical rows, source mappings and durable outbox intent share one batch;
- event payloads are PHI-minimised.

TDD must cover rollback, conflicting replay, cross-tenant isolation, missing mappings, invalid units, invalid ranges, incomplete BP, derived BMI mismatch, review transitions, correction lineage and hard-delete prevention.

## CDB-123D — Bounded backfill and fixed reconciliation

Implement nine persistent bounded-backfill partitions:

1. `patient_vitals` observation sets/components;
2. `patient_vitals` alert-link disposition;
3. `clinical_vitals` observation sets/components;
4. `global_patient_vitals` UHID/logged-on contract;
5. `global_patient_vitals` patient-id/logged-at contract variant;
6. `nur_patient_monitoring` mapping/extension disposition;
7. device/wearable/import provenance disposition;
8. BMI/classification/derived-value disposition;
9. duplicate/projection disposition.

Rules:

- caller-bounded scan count;
- persistent cursor per partition;
- source rows remain unchanged;
- exact mapped row creates one set plus typed components;
- already mapped row is skipped;
- ambiguous row becomes a deterministic non-PHI issue;
- same patient/time/value is never automatic deduplication;
- second pass creates zero new business rows.

Implement fixed twenty-check reconciliation covering source mapping, scope, code/unit/value validity, BP pairing, BMI parity, time order, status/event sequence, supersession, patient review, alerts, critical issues, source fingerprint, foreign keys, integrity and second-pass idempotency.

Persist a machine-verifiable reconciliation receipt.

## CDB-123E — Disabled-safe provider, selected adapters and readiness

Provider flag:

`canonical_patient_vital_measurement_provider_v1`

Provider configuration:

- `enabledByDefault: false`
- `defaultMode: legacy`
- `rollbackMode: legacy`
- supported modes: legacy, shadow, canonical

Implement library-level provider and selected adapters only. Do not switch runtime routes during this checkpoint.

Provider rules:

- legacy mode uses current consumer source;
- shadow mode returns legacy-facing output and aggregate PHI-minimised parity;
- canonical mode requires exact source mapping and fails closed;
- text, patient/time/value similarity and numeric coincidence are forbidden;
- correction lineage and review status remain visible;
- alert/classification consumers remain projections.

Create machine-checkable coverage and readiness artifacts with:

- every known reader assignment;
- selected adapter count;
- zero unknown assignments;
- zero route activation count;
- local readiness true only after all required evidence exists;
- production readiness false;
- production activation and legacy retirement blocked.

## Verification checkpoint

Before claiming CDB-123 locally complete:

- all CDB-123 focused tests pass;
- Canonical governance and continuity tests pass;
- TypeScript passes;
- migration manifest passes;
- source-of-truth registry and authority matrix agree;
- readiness checker is green locally;
- provider remains disabled;
- runtime routes remain unchanged;
- production query/mutation count is zero;
- local sync, push and CDB-to-main integration remain false.

## External production checkpoint

A future separately authorized checkpoint must specify:

- environment and tenant scope;
- migration/backfill approval;
- protected clone or rehearsal evidence;
- source fingerprints and reconciliation receipt;
- observation duration and parity thresholds;
- canary readers/writers;
- rollback owner and rollback command;
- legacy retention/retirement decision.

Local completion does not satisfy this checkpoint.
