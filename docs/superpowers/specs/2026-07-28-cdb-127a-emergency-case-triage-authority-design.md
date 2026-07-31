# CDB-127A Emergency Case and Triage Authority Design

**Status:** reviewed local design contract

**Date:** 2026-07-28

**Scope:** design only. No migration, schema module, command implementation, provider implementation, route wiring, production access, deployment, local-sync activation, writer freeze, or retirement is authorized by this document.

## 1. Design objective

Create one Canonical emergency-domain extension for arrival, lifecycle, triage, emergency classification and disposition evidence while preserving the existing Canonical authorities for patient identity, actual encounters, practitioners, services, clinical documents, diagnoses, vital observations, medication, admission and finance.

The emergency extension does not duplicate any existing core fact. It is linked to one actual care episode in `canonical_encounters` and records only emergency-specific evidence that cannot be represented faithfully by the existing encounter, service, document, diagnosis, vital, medication or admission authorities.

## 2. Existing Canonical authorities reused

### Patient relationship

`canonical_tenant_patient_links` remains the tenant-scoped patient relationship authority. The emergency case stores `patient_link_public_id` only as an exact foreign key/scope anchor. It never stores copied patient name, phone, address, age or date of birth as identity authority.

### Actual care episode

`canonical_encounters` remains actual care authority. There is one emergency case per Canonical encounter. An emergency extension cannot exist without an exact encounter linked to the same active patient relationship. `visits`, ER numbers, patient names, phone values, numeric ID coincidence and timestamp proximity cannot create that link.

### Practitioner identity

`canonical_practitioners` remains practitioner authority for triage nurses, emergency clinicians, disposition actors and reviewers. User IDs or copied performer names are not practitioner identity proof without an exact reviewed mapping.

### Service intent and delivery

`canonical_service_requests`, `canonical_service_events` and `canonical_service_participants` remain authority for requested and delivered emergency services. The emergency case may link exact service events, but it does not duplicate treatments, investigations, procedures or performed-service state.

### Signed clinical narrative

`canonical_clinical_documents`, `canonical_clinical_document_versions`, signatures and attachments remain authority for signed emergency notes and the signed discharge summary. The emergency extension does not duplicate chief complaints, examination, treatment, investigations, advice or narrative content as mutable columns. A disposition may reference the exact signed discharge summary document/version.

### Diagnosis

`canonical_diagnosis_assertions` and diagnosis status events remain diagnosis authority. Emergency classification codes such as trauma or animal bite are operational/domain classifications, not a substitute for clinical diagnosis. A provisional diagnosis copied from `er_discharge_summaries` is migrated only through the diagnosis authority with exact evidence.

### Vital observations

`canonical_vital_observation_sets`, components and status events remain vital authority. A triage assessment may link one exact vital observation set but does not copy blood pressure, temperature, pulse, respiration, oxygen saturation, pain score, glucose, weight or other measurements.

### Medication

Medication orders, administration events and reconciliation authorities remain unchanged. The emergency extension does not duplicate medication intent, administration or dose history. `canonical_medication_administration_events` remains administration authority.

### Admission and bed

`canonical_admissions`, admission status events, encounter/admission links and Canonical bed-stay authority remain inpatient admission/occupancy authority. An admitted emergency disposition must reference an exact Canonical admission; it never creates a second admission fact.

### Finance

`canonical_invoices`, invoice lines, payments, deposits, credits, accounting and compensation remain financial authority. Emergency registration, triage or disposition cannot infer billing or payment state. The extension does not duplicate price, charge, invoice, payment, deposit or ledger fields.

This design therefore does not duplicate patient, encounter, practitioner, service, signed discharge summary, diagnosis, vital, medication, admission, bed, invoice, payment or accounting authority.

## 3. Target data model

Exactly six additive tenant-scoped emergency extension tables are planned.

### 3.1 `canonical_emergency_cases`

Purpose: stable identity and current-state pointer for one emergency extension linked to one Canonical encounter.

Required identity/scope:

- `tenant_id`;
- `emergency_case_public_id`;
- `patient_link_public_id`;
- `encounter_public_id`;
- emergency number namespace/value when exact source evidence exists;
- current status and optimistic status version;
- `current_arrival_assessment_public_id`;
- `current_status_event_public_id`;
- nullable `current_triage_assessment_public_id`;
- nullable `current_disposition_event_public_id`;
- actor user/system evidence;
- idempotency key, request fingerprint and source evidence SHA-256;
- created/updated UTC timestamps.

Invariant: one emergency case per Canonical encounter.

The case identity and tenant/patient/encounter scope are immutable. Current pointers and version counters may advance only with matching immutable child evidence in the same atomic batch. Hard delete is forbidden.

Planned statuses:

- `arrived`;
- `awaiting_triage`;
- `triaged`;
- `care_in_progress`;
- `observation`;
- `disposition_pending`;
- `admitted`;
- `discharged`;
- `transferred`;
- `lama`;
- `dor`;
- `death`;
- `entered_in_error`.

Terminal states cannot be reopened by direct update. A correction or entered-in-error command appends new evidence under reviewed transition rules.

### 3.2 `canonical_emergency_arrival_assessments`

Purpose: immutable versioned arrival evidence without copied patient demographics.

Planned fields:

- `arrival_assessment_public_id`;
- case/patient/encounter scope;
- contiguous `version_number`;
- optional `supersedes_arrival_assessment_public_id`;
- version kind (`initial`, `correction`, `entered_in_error`);
- arrival time UTC;
- normalized mode-of-arrival code and exact source type/public ID when available;
- referral source type/public ID or reviewed external-referral text snapshot;
- condition-on-arrival coded value and bounded narrative snapshot;
- brought-by category and relationship category;
- police-case indicator;
- exact recording actor;
- observed/recorded UTC timestamps;
- reason code for replacements;
- source evidence SHA-256.

Arrival versions are immutable. Correction creates a replacement with one direct replacement per superseded version. Patient name, phone, address, age and copied demographics are forbidden from the Canonical arrival table.

### 3.3 `canonical_emergency_case_status_events`

Purpose: immutable lifecycle evidence.

Each event contains:

- event public ID;
- case scope;
- from/to status;
- contiguous event version;
- event type;
- actor practitioner/user/system evidence;
- occurred and recorded UTC times;
- reason code;
- source evidence SHA-256.

The initial registration creates version 1. Every current status pointer must reference the matching event and event version. Undo or direct deletion is impossible. Invalid transitions fail closed.

### 3.4 `canonical_emergency_triage_assessments`

Purpose: immutable, versioned emergency acuity assessment.

Planned fields:

- triage assessment public ID;
- case/patient/encounter scope;
- contiguous version number;
- optional supersedes pointer;
- version kind (`initial`, `reassessment`, `correction`, `entered_in_error`);
- normalized acuity code;
- legacy compatibility code where needed;
- triage practitioner public ID;
- optional exact linked `canonical_vital_observation_sets` public ID;
- presenting-risk and immediate-intervention coded indicators;
- bounded clinical rationale snapshot;
- observed time and recorded time separately;
- reason code for reassessment/correction;
- source evidence SHA-256.

Compatibility acuity includes red, yellow and green. The schema may add a reviewed normalized scale in a future version, but it cannot silently translate or infer acuity from text. The triage practitioner must be an exact active Canonical practitioner. Recorded time cannot precede observed time.

The current triage pointer on the case references the latest valid assessment. Correction creates a replacement and preserves prior assessments. Undo triage cannot erase evidence; it creates a replacement entered-in-error or a reviewed reassessment plus lifecycle event.

### 3.5 `canonical_emergency_case_classifications`

Purpose: immutable versioned emergency-domain classification evidence such as trauma, animal bite or police case.

Planned fields:

- classification public ID;
- case/patient/encounter scope;
- classification namespace/code;
- version number and replacement lineage;
- normalized category/subcategory;
- optional bite site, animal category, bite time, first-aid category and other reviewed coded fields;
- bounded source snapshot only where no code exists;
- recording practitioner/user/system evidence;
- occurred/recorded UTC times;
- reason code;
- source evidence SHA-256.

Free-text similarity never creates classification identity. Numeric legacy main/sub-case values require an explicit source mapping or reviewed code contract. A correction creates a replacement; hard update/delete is forbidden.

### 3.6 `canonical_emergency_disposition_events`

Purpose: immutable terminal/non-terminal disposition evidence with exact links to external authorities.

Planned dispositions:

- admitted;
- discharged;
- transferred;
- lama;
- dor;
- death;
- observation continuation;
- entered-in-error.

Planned fields:

- disposition event public ID;
- case/patient/encounter scope;
- contiguous disposition version;
- disposition code;
- actor practitioner/user/system evidence;
- occurred and recorded UTC time;
- typed reason code and bounded remarks snapshot;
- nullable exact Canonical admission public ID for admitted;
- nullable receiving facility/organization source pair and receiving encounter/referral source pair for transferred;
- nullable exact signed clinical document/version link for discharged;
- death/LAMA/DOR evidence code where applicable;
- nullable transport/service event links;
- source evidence SHA-256.

The case current disposition pointer and terminal case status advance only with a matching disposition row and status event in the same atomic command.

Admitted requires exact `canonical_admissions` evidence. Discharged may reference a signed discharge summary; when a summary is asserted, the exact signed discharge summary document/version is required. Transferred requires typed destination/referral evidence. LAMA, DOR and death require typed reason and actor evidence. Disposition never creates billing, admission, diagnosis or clinical-document authority implicitly.

## 4. Identity and mapping rules

Exact reviewed mapping is mandatory for:

- legacy patient to active `canonical_tenant_patient_links`;
- legacy visit/episode to `canonical_encounters`;
- legacy user/doctor/nurse to active `canonical_practitioners` where a practitioner role is asserted;
- legacy admission to `canonical_admissions` for admitted disposition;
- legacy discharge summary to signed Canonical clinical document/version when used;
- legacy vital evidence to Canonical vital observation set when linked;
- each legacy emergency source row to one Canonical case/assessment/classification/disposition.

Forbidden identity evidence:

- patient name;
- phone;
- address;
- copied age/date of birth;
- ER number alone;
- numeric ID coincidence across unrelated tables;
- timestamp proximity;
- same triage color;
- same case text;
- same performer name;
- same visit date;
- same admission flag;
- free-text or similarity score.

Ambiguity creates a stable non-PHI `canonical_processing_issues` row. It never creates a clinical fact.

## 5. Lifecycle and correction rules

### Registration

Registration creates one case, initial arrival assessment, initial status event, current pointers, exact source mapping, command receipt and PHI-minimised outbox atomically. It requires an exact existing Canonical encounter; it does not create patient/encounter implicitly unless a separately reviewed higher-level orchestration command provides those authoritative statements in the same D1 batch.

### Triage

Initial triage advances awaiting-triage/arrived to triaged. Reassessment can occur from triaged, care-in-progress or observation. Each assessment is immutable. Expected case status version and current triage version prevent lost updates.

### Care lifecycle

`transitionCanonicalEmergencyCase` controls non-disposition transitions such as care start, observation and disposition pending. It cannot create admission, discharge, transfer, death or LAMA state without a matching disposition command.

### Disposition

`recordCanonicalEmergencyDisposition` inserts disposition evidence, inserts matching status event and advances current pointers atomically. Invalid state, missing exact link or incomplete typed evidence fails the whole batch.

### Corrections

Arrival, triage and classification correction creates a replacement version. The old row remains unchanged. One direct replacement per superseded row is enforced. Correction reason and actor are required.

### Entered-in-error

`enterCanonicalEmergencyCaseInError` preserves every prior row and adds a terminal status/disposition event where applicable. It never hard-deletes or clears history.

Hard delete is forbidden for all six tables. Mutable overwrite of clinical or lifecycle evidence is forbidden.

## 6. Nine planned atomic commands

1. `registerCanonicalEmergencyCase`
2. `replaceCanonicalEmergencyArrivalAssessment`
3. `recordCanonicalEmergencyTriageAssessment`
4. `correctCanonicalEmergencyTriageAssessment`
5. `recordCanonicalEmergencyCaseClassification`
6. `correctCanonicalEmergencyCaseClassification`
7. `transitionCanonicalEmergencyCase`
8. `recordCanonicalEmergencyDisposition`
9. `enterCanonicalEmergencyCaseInError`

All commands:

- read replay before state-dependent validation;
- use tenant-scoped idempotency and deterministic public IDs;
- reject changed request fingerprints;
- validate exact scope and active practitioner links;
- use expected status/version guards;
- persist compatibility statements, Canonical rows, exact source mappings, receipt and PHI-minimised outbox in one D1 atomic batch;
- roll back all effects on any failure;
- do not emit patient/encounter/clinical narrative identifiers in aggregate outbox evidence.

## 7. Eight persistent bounded/resumable backfill partitions

1. exact patient/encounter/practitioner/source mapping and unresolved scope disposition;
2. emergency case identity and initial arrival assessment;
3. lifecycle reconstruction from ER and visit evidence;
4. triage assessment reconstruction and mutable-overwrite limitations;
5. emergency classification reconstruction;
6. disposition reconstruction and admission/transfer/death/LAMA/DOR evidence;
7. discharge document, diagnosis, vital and attachment exact-link disposition without duplicating those facts;
8. stale/missing projections, reader compatibility, issue closure and zero-row second pass.

Every partition uses persistent migration runs/checkpoints, caller-supplied bounds, durable cursors and aggregate counts. All legacy source tables remain read-only. A second completed pass creates zero new business rows, mappings or issues.

## 8. Fixed twenty-four-check reconciliation

1. source mapping ownership;
2. case tenant/patient/encounter ownership;
3. one emergency case per Canonical encounter;
4. initial arrival assessment ownership;
5. arrival version contiguity and replacement lineage;
6. current arrival pointer ownership;
7. current status-event ownership;
8. status-event sequence and current-state parity;
9. lifecycle transition validity;
10. actor/practitioner scope;
11. triage assessment ownership;
12. triage version/replacement lineage;
13. current triage pointer parity;
14. acuity code and observed/recorded time validity;
15. exact vital-observation link scope;
16. classification ownership/version/code validity;
17. animal-bite/police-case typed evidence completeness;
18. disposition ownership/sequence/current pointer;
19. admitted-to-Canonical-admission exact link;
20. discharged-to-signed-document exact link;
21. transfer/LAMA/DOR/death typed evidence completeness;
22. source fingerprint parity;
23. foreign-key/integrity composite gate;
24. second-pass new business rows.

The receipt is persisted in `canonical_reconciliation_runs`, replay-safe and fail-closed. Warning-level unresolved legacy ambiguity remains visible, while critical ownership/integrity mismatches fail readiness.

## 9. Provider/readiness plan

Feature flag:
`canonical_emergency_case_triage_provider_v1`

Modes:

- legacy;
- shadow;
- canonical.

Defaults:

- enabled by default: false;
- default mode: legacy;
- rollback mode: legacy.

Planned selected library adapters:

1. emergency board/worklist and current acuity detail;
2. patient timeline/emergency clinical summary;
3. disposition/admission/discharge handoff detail.

Shadow mode preserves legacy-facing output and records aggregate PHI-minimised parity only. Canonical mode requires exact source mapping and fails closed. Runtime routes remain unchanged until separately authorized promotion.

Readiness must verify:

- schema and migration presence;
- all nine commands;
- eight completed backfill partitions;
- twenty-four passed reconciliation checks;
- exact mapping and no similarity identity;
- immutable arrival, triage, classification, lifecycle and disposition history;
- exact admission/document/vital links;
- PHI-minimised shadow evidence;
- complete writer/reader coverage;
- zero unknown assignments;
- zero route activation;
- local-ready true and production-ready false;
- explicit blocked production activation and legacy retirement gates.

## 10. Source dispositions

- `er_patients`: legacy compatibility source; migrate identity/arrival/lifecycle/triage/disposition facts exactly.
- `er_patient_cases`: legacy classification source; migrate exact coded evidence.
- `er_discharge_summaries`: legacy clinical-document compatibility source; map into signed clinical-document authority, never copy as emergency narrative authority.
- `er_file_uploads`: attachment compatibility extension; map exact content/encounter evidence.
- `er_mode_of_arrival`: tenant configuration lookup; retain.
- `visits`: episode compatibility source; map to Canonical encounters.
- `admissions`: separate admission authority/compatibility source; exact link only.
- `emergency_visits`: stale/missing projection dependency; never treat as authority.
- copied demographics and performer names: non-authoritative snapshots only.

## 11. Safety gates

CDB-127A authorizes only documentation, design tests and governance metadata. It does not authorize:

- migration 0560;
- a schema module;
- command implementation;
- backfill execution against production;
- provider creation or activation;
- runtime route imports;
- production query or mutation;
- local-sync activation;
- deployment, push or main integration;
- legacy writer freeze or data retirement.

Those remain later checkpoints and separate authorization gates.
