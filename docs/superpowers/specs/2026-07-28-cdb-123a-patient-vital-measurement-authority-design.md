# CDB-123A Patient Vital Measurement Authority Design

**Status:** design locked; implementation not started

**Date:** 2026-07-28

## 1. Authority decision

The Canonical model will use one observation authority. It will not copy the column-per-vital shape of `patient_vitals`, `clinical_vitals`, or `global_patient_vitals`.

The target contains exactly three additive table families:

1. `canonical_vital_observation_sets`
2. `canonical_vital_observation_components`
3. `canonical_vital_observation_status_events`

One observation set groups measurements captured in one act. One component stores one coded measurement and one canonical unit. Corrections append a replacement set and immutable status event. Hard delete is forbidden.

Alerts are projections, not vital authority. Nursing monitoring is a consumer and compatibility adapter. BMI is derived evidence and never an independently authoritative manual fact.

## 2. Observation-set aggregate

`canonical_vital_observation_sets` is the aggregate header and owns:

- `tenant_id`
- `observation_set_public_id`
- `patient_link_public_id`
- optional `encounter_public_id`
- optional `practitioner_public_id`
- `source_kind`
- optional `external_device_source_type`
- optional `external_device_source_public_id`
- `effective_at_utc`
- `recorded_at_utc`
- `review_status`
- `status_version`
- optional `supersedes_observation_set_public_id`
- actor user/system identity
- idempotency key
- request fingerprint SHA-256
- source evidence SHA-256
- immutable creation time and controlled update time

### Scope

- `patient_link_public_id` is mandatory.
- `encounter_public_id`, when present, must belong to the same tenant and patient link.
- `practitioner_public_id`, when present, must be an active Canonical practitioner.
- Patient-reported and device-imported observations may exist without an encounter only when the source policy permits it.
- Patient-reported observations start pending_review.
- Practitioner-entered observations may start verified only when practitioner, patient and encounter scope is exact.

### Source kinds

- `practitioner_entered`
- `nurse_entered`
- `patient_reported`
- `device_imported`
- `system_derived`
- `legacy_backfill`

External device identity is a paired exact source contract:

- both `external_device_source_type` and `external_device_source_public_id` are null; or
- both are non-null exact values.

No device name, serial resemblance, patient/time proximity, or value similarity is identity proof.

## 3. Component authority

`canonical_vital_observation_components` stores one typed measurement per row:

- `tenant_id`
- `component_public_id`
- `observation_set_public_id`
- `component_sequence`
- `measurement_code`
- `numeric_value`
- `canonical_unit_code`
- optional source numeric value and source unit snapshot
- optional method, body site, posture, laterality and fasting-context codes
- optional reference low/high snapshot
- optional alert level snapshot
- `is_derived`
- optional derivation formula key/version
- source evidence SHA-256
- immutable creation time

The component table is append-only. Values, units, codes, provenance, reference limits and derivation evidence cannot be updated in place.

## 4. Measurement codes and canonical units

| Measurement code | Canonical unit | Rules |
|---|---|---|
| `body_temperature` | `Cel` | temperature storage unit is Cel; Fahrenheit input is converted and source value/unit retained |
| `heart_rate` | `/min` | positive whole or bounded decimal rate |
| `respiratory_rate` | `/min` | positive bounded rate |
| `oxygen_saturation` | `%` | range 0–100 |
| `blood_pressure_systolic` | `mm[Hg]` | blood pressure requires paired systolic and diastolic components |
| `blood_pressure_diastolic` | `mm[Hg]` | blood pressure requires paired systolic and diastolic components |
| `body_weight` | `kg` | positive value |
| `body_height` | `cm` | positive value |
| `body_mass_index` | `kg/m2` | derived from exact weight and height components in the same set or an explicitly referenced source set |
| `pain_score` | `{score}` | integer within configured scale, initially 0–10 |
| `blood_glucose` | `mg/dL` | fasting/post-meal context is metadata, not a different unit |

Additional measurements require an additive reviewed code registry change. Free-text measurement codes or units are prohibited.

## 5. Blood pressure and derived BMI

Blood pressure requires paired systolic and diastolic components in one observation set. A set containing only one BP component fails command validation and reconciliation unless explicitly classified as a deterministic legacy issue.

For BMI:

- manual BMI without exact weight and height evidence is not authoritative;
- the derived component stores formula identity and formula version;
- the command recomputes the result from canonical units;
- source-stored BMI can be retained as comparison evidence;
- a material mismatch becomes a processing issue, not an overwrite.

## 6. Time semantics

`effective_at_utc` is when the measurement clinically applies.

`recorded_at_utc` is when the system recorded the evidence.

Rules:

- both are normalized UTC timestamps;
- `recorded_at_utc` cannot precede `effective_at_utc` without an explicit delayed-entry policy/reason;
- source local time and timezone evidence may be retained in provenance metadata, not used as authority;
- same patient, same timestamp, and same values are not sufficient to merge.

## 7. Review and correction lifecycle

Allowed aggregate review states:

- `pending_review`
- `verified`
- `rejected`
- `superseded`
- `entered_in_error`

`canonical_vital_observation_status_events` stores immutable lifecycle history:

- from/to review status
- event version
- event type
- reason code
- actor practitioner/user/system
- occurred time
- source evidence SHA-256

A correction never edits components. It creates a replacement observation set with `supersedes_observation_set_public_id`, appends a status event to the original, and preserves both histories.

`rejected` means the evidence was reviewed and not accepted as a patient fact. `entered_in_error` means the record itself was created in error. Neither state permits delete.

## 8. Identity and duplicate policy

Source mapping is the only cross-table identity proof.

An exact source identity consists of:

- tenant;
- source type;
- source public ID;
- source table/contract variant;
- evidence SHA-256.

Same patient, same timestamp, and same values are not sufficient to merge. Similar BP, pulse, temperature, or weight values do not authorize deduplication.

Duplicate candidates without exact mapping are recorded as non-PHI processing issues and remain separate until reviewed.

## 9. Legacy source disposition

### `patient_vitals`

One source row becomes one observation set with zero or more components. Admission and visit context must resolve through exact Canonical encounter mappings. Null or unmapped identity creates an issue.

### `clinical_vitals`

One source row becomes one set. It is never merged with `patient_vitals` by patient/time/value similarity.

### `global_patient_vitals`

The `uhid, logged_on` and `patient_id, logged_at` contracts are separate source variants. Each requires exact patient identity and stable schema characterization. Contract drift creates issues.

### `nur_patient_monitoring`

Nursing monitoring is not migrated as a second vital authority. Exact monitoring rows may map to a Canonical observation set or remain a Canonical-linked nursing extension.

### Alerts and classifications

`vital_alert_rules`, `vital_alerts`, classification JSON, wellness score and dashboard summaries are projections. Future alert evidence links to observation set/component public IDs.

## 10. Command boundary

The target command set is:

1. `recordCanonicalVitalObservationSet`
2. `reviewCanonicalVitalObservationSet`
3. `correctCanonicalVitalObservationSet`
4. `enterCanonicalVitalObservationSetInError`

Every command must provide:

- tenant-scoped idempotency;
- replay before state validation;
- deterministic IDs when caller IDs are absent;
- exact patient/encounter/practitioner/device scope validation;
- atomic compatibility statements, Canonical rows, source mappings and durable outbox intent;
- optimistic status versioning;
- PHI-minimised event payloads.

## 11. Backfill design

CDB-123D will use nine persistent bounded-backfill partitions:

1. `patient_vitals` observation sets/components;
2. `patient_vitals` alert-link disposition;
3. `clinical_vitals` observation sets/components;
4. `global_patient_vitals` UHID/logged-on contract;
5. `global_patient_vitals` patient-id/logged-at contract variant;
6. `nur_patient_monitoring` mapping/extension disposition;
7. device, wearable and import provenance disposition;
8. BMI, classification and derived-value disposition;
9. duplicate/projection disposition.

Source tables remain read-only. Each row is mapped, skipped as already mapped, or recorded as a deterministic issue.

## 12. Reconciliation design

The fixed twenty-check reconciliation covers:

1. source mapping ownership;
2. patient-link scope;
3. encounter/patient scope;
4. practitioner scope;
5. external device source pairing;
6. component ownership;
7. component sequence uniqueness;
8. measurement code validity;
9. canonical unit validity;
10. numeric value range/finite validity;
11. paired blood pressure completeness;
12. BMI derivation parity;
13. effective/recorded time order;
14. review status/event sequence;
15. supersession linkage;
16. patient-reported review policy;
17. alert/projection identity linkage;
18. unresolved critical issues;
19. source fingerprint, foreign-key and integrity evidence;
20. second-pass idempotency and zero new business rows.

## 13. Provider and cutover rules

Provider flag: `canonical_patient_vital_measurement_provider_v1`.

Supported modes:

- `legacy`
- `shadow`
- `canonical`

Safety defaults:

- `enabledByDefault: false`
- `defaultMode: legacy`
- `rollbackMode: legacy`

Shadow mode preserves the current consumer response while producing aggregate, PHI-minimised parity evidence. Canonical mode requires exact source mapping and fails closed when identity or scope is missing.

No runtime route is switched during design or schema work.

## 14. Production gates

Production activation remains an external gate.

Legacy retirement remains an external gate.

Neither gate is satisfied by local tests. Production migration/backfill, observation, rollback rehearsal, reader/writer cutover, exact owner authorization, and retirement approval remain separately required.
