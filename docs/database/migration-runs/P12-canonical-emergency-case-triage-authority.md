# P12 Canonical Emergency Case and Triage Authority Receipt

**Checkpoint:** `CDB-127E-CANONICAL-EMERGENCY-CASE-TRIAGE-PROVIDER-READINESS-VERIFIED`

**Date:** 2026-07-28

**Status:** local-ready with provider disabled; production activation, runtime cutover and legacy retirement remain blocked external gates; changes are uncommitted because the active connector exposes no Git commit action

## Completed local authority

CDB-127A through CDB-127E now provide:

- a repository-static emergency authority audit, specification and implementation plan;
- six additive tenant-scoped Canonical emergency extension tables;
- nine atomic, idempotent registration, arrival, triage, classification, lifecycle, disposition and error commands;
- eight persistent caller-bounded/resumable read-only backfill partitions;
- one replay-safe fixed twenty-four-check reconciliation receipt;
- a disabled-safe legacy/shadow/canonical provider;
- three selected library-only adapters;
- complete reviewed writer/reader coverage with zero unknown assignments;
- executable fail-closed local readiness;
- explicit blocked production activation and legacy-retirement gates.

## Authority boundary

The emergency extension owns only:

- one emergency case linked to one exact Canonical encounter;
- immutable versioned arrival assessments;
- immutable contiguous emergency lifecycle events;
- immutable versioned triage/acuity assessments;
- immutable versioned emergency-domain classifications;
- immutable typed disposition events and exact links to external authorities.

It reuses and does not duplicate:

- `canonical_tenant_patient_links` for patient relationship;
- `canonical_encounters` for the actual care episode;
- `canonical_practitioners` for triage and disposition clinicians;
- `canonical_service_requests`, `canonical_service_events` and participants for emergency services;
- `canonical_clinical_documents`, versions, signatures and attachments for signed emergency notes/discharge summaries;
- `canonical_diagnosis_assertions` for diagnosis;
- `canonical_vital_observation_sets` for triage vitals;
- medication-order, administration and reconciliation authorities;
- `canonical_admissions` and bed authority for inpatient admission;
- Canonical invoice, payment and accounting authorities for finance.

Copied patient demographics, patient name, phone number, ER number alone, numeric ID coincidence, timestamp proximity, triage colour similarity and free-text similarity are forbidden identity proof.

## Schema contract

Migration:
`migrations/0560_canonical_emergency_case_triage.sql`

Drizzle module:
`src/db/schema/canonical/emergency-case-triage.ts`

Six tables:

1. `canonical_emergency_cases`
2. `canonical_emergency_arrival_assessments`
3. `canonical_emergency_case_status_events`
4. `canonical_emergency_triage_assessments`
5. `canonical_emergency_case_classifications`
6. `canonical_emergency_disposition_events`

Database-level guarantees include:

- one case per exact active patient/emergency encounter;
- immutable case identity;
- contiguous arrival, lifecycle, triage, classification and disposition histories;
- one direct replacement per superseded assessment/classification;
- active exact practitioner scope;
- optional exact same-patient/same-encounter vital scope;
- explicit red/yellow/green compatibility acuity;
- typed animal-bite and police-case evidence;
- exact Canonical admission for admitted disposition;
- exact signed final/amendment discharge-summary version when asserted;
- paired transfer destination evidence;
- typed LAMA, DOR, death and entered-in-error evidence;
- matching current arrival/status/triage/disposition pointers;
- append-only history and hard-delete protection.

## Nine atomic commands

Command module:
`src/lib/canonical/commands/manage-emergency-case-triage.ts`

Commands:

1. `registerCanonicalEmergencyCase`
2. `replaceCanonicalEmergencyArrivalAssessment`
3. `recordCanonicalEmergencyTriageAssessment`
4. `correctCanonicalEmergencyTriageAssessment`
5. `recordCanonicalEmergencyCaseClassification`
6. `correctCanonicalEmergencyCaseClassification`
7. `transitionCanonicalEmergencyCase`
8. `recordCanonicalEmergencyDisposition`
9. `enterCanonicalEmergencyCaseInError`

Every command:

- reads replay before state-dependent validation;
- creates deterministic public IDs when needed;
- rejects changed idempotency fingerprints;
- validates exact patient, encounter, practitioner and optional external-authority scope;
- uses optimistic case/assessment/classification/disposition versions;
- appends immutable evidence before advancing matching aggregate pointers;
- writes exact source mappings;
- combines caller compatibility statements, Canonical facts, mappings, command receipt and PHI-minimised outbox in one D1 batch;
- rolls back every effect on failure;
- remains unwired from runtime routes.

## Eight persistent backfill partitions

Backfill:
`scripts/canonical/backfill-emergency-case-triage.ts`

Partitions:

1. exact patient/encounter/practitioner/source scope;
2. emergency case and initial arrival identity;
3. lifecycle reconstruction and incomplete-history disposition;
4. current triage reconstruction;
5. typed classification reconstruction;
6. terminal disposition and exact admission/document/transfer evidence;
7. external document and attachment authority links;
8. stale projections, configuration, issues and second-pass completion.

All legacy sources remain read-only. Business facts are written only through the nine command boundaries. Ambiguous or incomplete evidence creates deterministic non-PHI processing issues rather than synthetic clinical history.

## Fixed twenty-four-check reconciliation

Reconciler:
`scripts/canonical/reconcile-emergency-case-triage.ts`

The replay-safe receipt covers:

- source mapping ownership;
- case patient/encounter ownership and one case per encounter;
- arrival ownership/version/current pointer;
- lifecycle event ownership/sequence/transition/current state;
- practitioner scope;
- triage ownership/version/current pointer/acuity/time/vital scope;
- classification ownership/version/code/typed evidence;
- disposition ownership/sequence/current pointer;
- exact admitted-to-admission and discharged-to-signed-document links;
- transfer/LAMA/DOR/death/error typed evidence;
- source fingerprints;
- foreign-key/integrity/critical-issue composite evidence;
- second-pass new business rows.

The verified second pass creates zero cases, arrivals, status events, triage assessments, classifications, dispositions, mappings and issues.

## Provider contract

Provider:
`src/lib/canonical/emergency-case-triage-provider.ts`

Feature flag:
`canonical_emergency_case_triage_provider_v1`

Modes:

- `legacy`
- `shadow`
- `canonical`

Safety defaults:

- enabled by default: false;
- default mode: legacy;
- rollback mode: legacy;
- absent, disabled or unsupported flag state: legacy;
- shadow and canonical modes require exact source mapping;
- identity-sensitive legacy reads require exact mapping;
- canonical root resolution fails closed;
- no runtime route imports or activates the provider.

Canonical projection exposes:

- exact patient/encounter case scope;
- current status and optimistic version;
- complete arrival history and replacement lineage;
- complete lifecycle history;
- complete triage/reassessment/correction history;
- complete classification history;
- complete disposition and entered-in-error history;
- exact practitioner, vital, admission, document and transfer evidence links;
- effective event time.

Shadow mode preserves legacy-facing status, acuity, disposition and effective time while comparing Canonical mapping, scope, lifecycle, histories and timing. Persistable shadow evidence includes aggregate counts, booleans, timing and evidence hash only; it excludes patient, encounter, case, assessment, document, admission, narrative, phone and copied demographic identifiers.

## Three selected library adapters

Adapter module:
`src/lib/canonical/emergency-case-triage-read-adapters.ts`

1. `readEmergencyBoardAdapter`
2. `readEmergencyPatientTimelineAdapter`
3. `readEmergencyDispositionHandoffAdapter`

All three remain library-only, route-inactive and rollback to legacy.

## Coverage and readiness

Coverage:
`docs/database/canonical-emergency-case-triage-provider-coverage.json`

Readiness:
`docs/database/emergency-case-triage-readiness.json`

Checker:
`scripts/canonical/check-emergency-case-triage-readiness.ts`

Coverage summary:

- selected adapters: 3;
- known writers: 4;
- known readers: 6;
- unknown writer assignments: 0;
- unknown reader assignments: 0;
- runtime route activation count: 0.

Reviewed writers retained as `legacy_unchanged`:

- `src/routes/tenant/emergency.ts`
- `src/routes/tenant/reception.ts`
- `src/routes/tenant/admissions.ts`
- `src/routes/tenant/appointments.ts`

Reviewed readers retained as `legacy_unchanged`:

- `src/routes/tenant/emergency.ts`
- `src/routes/tenant/qualityKpi.ts`
- `src/routes/tenant/doctors.ts`
- `src/routes/tenant/ipdReports.ts`
- `src/routes/tenant/patients-timeline.ts`
- `src/lib/patient-reference-registry.ts`

Executable readiness result:

- local ready: true;
- production ready: false;
- readiness issues: 0;
- provider enabled: false;
- route cutover performed: false;
- route activation count: 0;
- production migration/backfill evidence present: false;
- production observation/latency/error evidence present: false;
- rollback execution evidence present: false;
- owner authorization present: false;
- legacy retirement approved: false.

## Verification

- CDB-127A–E focused suite: 6 files, 30 tests passed;
- provider contract: 5 tests passed;
- readiness contract: 3 tests passed;
- `pnpm exec tsc --noEmit`: passed;
- `pnpm build:migrations`: passed with 495 migrations;
- final readiness, schema governance, program continuity and worktree policy: 4 files, 24 tests passed after metadata synchronization.

## Safety state

- production query performed: no;
- production mutation performed: no;
- production migration or backfill applied: no;
- provider flag enabled: no;
- runtime route changed: no;
- traffic or deployment changed: no;
- local sync activated: no;
- push or CDB-to-main integration performed: no;
- legacy ER, visit, admission, discharge-summary, file, KPI, report, billing or patient-reference history retired: no;
- connector Git commit action available: no;
- local changes committed: no.

## Blocked external gates

### Production activation

Blocked until separately authorized production migration, exact bounded production backfill, twenty-four-check reconciliation, source fingerprints, integrity proof, shadow observation, latency/error evidence, rollback execution proof and owner approval exist.

### Legacy retirement

Blocked until every legacy writer and reader is cut over, exact mappings and historical preservation are proven, observation and rollback gates pass, and explicit retirement authorization is granted.

## Next checkpoint

`CDB-128A-OPERATION-THEATRE-PROCEDURE-AUTHORITY-DESIGN`

Audit operation-theatre booking, scheduling, room/team, anaesthesia, checklist, supplies, performed procedure, cancellation, recovery, billing, clinical-document, diagnosis, medication, inventory and reporting authorities. Reuse existing Canonical patient, encounter, practitioner, service, clinical-document, diagnosis, medication, inventory and finance authorities. CDB-128A is design-only and must not create runtime schema or mutate production.
