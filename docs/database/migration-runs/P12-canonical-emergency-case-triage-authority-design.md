# P12 Canonical Emergency Case and Triage Authority Design Receipt

**Checkpoint:** `CDB-127A-EMERGENCY-CASE-TRIAGE-AUTHORITY-DESIGN-VERIFIED`

**Date:** 2026-07-28

**Status:** design-only local checkpoint; runtime implementation not created; production and remote state untouched

## Evidence

- audit: `docs/database/audits/2026-07-28-emergency-case-triage-authority-audit.md`
- specification: `docs/superpowers/specs/2026-07-28-cdb-127a-emergency-case-triage-authority-design.md`
- implementation plan: `docs/superpowers/plans/2026-07-28-cdb-127-emergency-case-triage-authority.md`
- design contract: `test/canonical/emergency-case-triage-authority-design-contract.test.ts`
- authority matrix: `docs/database/canonical-authority-matrix.yaml`
- tracker: `task-progress.yaml`
- control centre: `docs/architecture/canonical-program-control-center.md`

## Audit conclusion

The current Emergency Department module has multiple mutable or competing authorities:

- `er_patients` combines copied demographics, visit linkage, arrival facts, current triage, performer snapshots, police-case flag and terminal disposition;
- `er_patient_cases` stores unversioned emergency classifications;
- `er_discharge_summaries` duplicates clinical-document and provisional-diagnosis authority;
- `er_file_uploads` is an inactive attachment compatibility extension;
- `er_mode_of_arrival` is tenant configuration rather than clinical authority;
- `visits` independently owns emergency episode compatibility state;
- `admissions` independently owns emergency admission state;
- `emergency_visits` is queried by quality KPI code but is absent from repository schema/migrations.

The emergency route creates patient, visit, ER case and classification through separate boundaries; overwrites and clears triage evidence; finalizes without immutable status history or exact admission/transfer/document evidence; and creates a discharge summary separately from case disposition. Reception quick-admit can create an emergency visit without an ER case. Emergency admission can be created separately without an ER disposition link.

## Authority decision

The Canonical emergency domain is an extension of one existing Canonical encounter. It owns only:

- emergency case identity;
- versioned arrival assessment;
- immutable lifecycle events;
- versioned triage/acuity assessments;
- versioned emergency classifications;
- immutable disposition events and exact external-authority links.

It reuses and does not duplicate:

- `canonical_tenant_patient_links`;
- `canonical_encounters`;
- `canonical_practitioners`;
- `canonical_service_requests`;
- `canonical_service_events`;
- `canonical_service_participants`;
- `canonical_clinical_documents`, versions, signatures and attachments;
- `canonical_diagnosis_assertions`;
- `canonical_vital_observation_sets`;
- medication-order/administration/reconciliation authorities;
- `canonical_admissions` and bed authority;
- `canonical_invoices`, payments and accounting.

A signed discharge summary remains a signed clinical document. Triage vitals remain vital observations. Admitted remains an admission fact. Treatments remain service/medication facts. Billing remains finance authority.

## Planned model

- target table count: 6
- planned command count: 9
- persistent backfill partition count: 8
- persistent reconciliation check count: 24

### Target tables

1. `canonical_emergency_cases`
2. `canonical_emergency_arrival_assessments`
3. `canonical_emergency_case_status_events`
4. `canonical_emergency_triage_assessments`
5. `canonical_emergency_case_classifications`
6. `canonical_emergency_disposition_events`

### Planned commands

1. `registerCanonicalEmergencyCase`
2. `replaceCanonicalEmergencyArrivalAssessment`
3. `recordCanonicalEmergencyTriageAssessment`
4. `correctCanonicalEmergencyTriageAssessment`
5. `recordCanonicalEmergencyCaseClassification`
6. `correctCanonicalEmergencyCaseClassification`
7. `transitionCanonicalEmergencyCase`
8. `recordCanonicalEmergencyDisposition`
9. `enterCanonicalEmergencyCaseInError`

### Backfill partitions

1. exact scope and unresolved identity disposition;
2. case/arrival identity;
3. lifecycle reconstruction;
4. triage reconstruction;
5. emergency classification reconstruction;
6. disposition and exact admission/transfer/death/LAMA/DOR evidence;
7. discharge-document/diagnosis/vital/attachment external-authority links;
8. stale projections, reader compatibility and zero-row second pass.

### Reconciliation checks

The fixed twenty-four checks cover mapping ownership, case/patient/encounter scope, one case per encounter, arrival versions/current pointer, status-event ownership and sequence, lifecycle transitions, actor/practitioner scope, triage versions/current pointer/acuity/time/vital link, classification versions/typed evidence, disposition sequence/current pointer, exact admission link, exact signed-document link, transfer/LAMA/DOR/death evidence, source fingerprints, foreign-key/integrity and second-pass rows.

## Provider plan

Feature flag:
`canonical_emergency_case_triage_provider_v1`

Supported modes:

- legacy;
- shadow;
- canonical.

Defaults:

- enabled by default: false;
- default mode: legacy;
- rollback mode: legacy.

Planned selected adapters:

1. emergency board/worklist and current acuity;
2. patient timeline/emergency clinical summary;
3. disposition/admission/discharge handoff.

Canonical mode will require exact source mapping and fail closed. Shadow evidence will contain aggregate PHI-minimised parity only. Runtime route activation remains zero until separately authorized promotion.

## Locked invariants

- one emergency case per Canonical encounter;
- exact active patient link and encounter scope;
- no patient name, phone, copied demographics, ER number, numeric ID coincidence, timestamp proximity, triage color or free-text similarity as identity proof;
- immutable arrival, lifecycle, triage, classification and disposition history;
- contiguous version/event sequences;
- one direct replacement per superseded version;
- current pointers require matching child evidence;
- exact active triage/disposition practitioner where a practitioner role is asserted;
- observed and recorded times are separate and ordered;
- red/yellow/green compatibility is explicit, never text-derived;
- correction creates a replacement;
- admitted requires exact Canonical admission;
- discharged summary requires exact signed clinical document/version when asserted;
- transferred requires typed destination/referral evidence;
- LAMA, DOR and death require typed reason and actor evidence;
- entered-in-error preserves all prior evidence;
- hard delete is forbidden;
- commands are replay-safe, version-guarded and atomic;
- source mappings, receipt and PHI-minimised outbox commit with facts;
- all legacy sources remain read-only during backfill.

## Repository corrections recorded by this audit

The prior authority matrix listed `src/routes/tenant/nursing/opd.ts` as a direct emergency writer and `src/routes/tenant/reports.ts` as a direct reader, but fresh repository search found no ER-table evidence in those paths. The updated matrix uses actual reviewed writer/reader surfaces and records the missing `emergency_visits` quality-KPI projection as a stale dependency.

## Safety evidence

- migration `0560_canonical_emergency_case_triage.sql` created: no;
- emergency schema module created: no;
- emergency command module created: no;
- emergency provider created: no;
- runtime routes changed: no;
- provider flag enabled: no;
- production query performed: no;
- production mutation performed: no;
- production migration/backfill applied: no;
- local sync activated: no;
- push performed: no;
- CDB-to-main integration performed: no;
- legacy history retired: no.

## Next checkpoint

`CDB-127B-CANONICAL-EMERGENCY-CASE-TRIAGE-SCHEMA`

Create the additive migration 0560 and dedicated Canonical schema module with exact scope, immutable version/event/disposition evidence, typed external-authority links, pointer guards and hard-delete protection. Keep runtime and production state unchanged.
