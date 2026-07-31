# Patient Vital Measurement Authority Audit

**Checkpoint:** `CDB-123A-PATIENT-VITAL-MEASUREMENT-AUTHORITY-DESIGN`

**Date:** 2026-07-28

**Scope:** read-only repository audit; no schema, runtime, provider, sync, or production mutation

## Executive finding

Patient vital measurements currently have no Canonical authority. The repository contains three competing vital fact stores, one nursing monitoring extension, and a separate alert subsystem:

- `patient_vitals`
- `clinical_vitals`
- `global_patient_vitals`
- `nur_patient_monitoring`
- `vital_alert_rules`
- `vital_alerts`

The same blood pressure, temperature, pulse, oxygen saturation, respiratory rate, height, weight, BMI, pain score, and glucose facts can be represented with different patient identifiers, encounter identifiers, units, timestamps, review rules, and mutation semantics.

The target must not rename one legacy table as Canonical. It must create one observation authority and convert the existing stores into mapped sources, compatibility adapters, projections, or typed domain extensions.

## Current schemas

### `patient_vitals`

Created by `migrations/0014_patient_vitals.sql`.

Characteristics:

- tenant, patient, admission and optional visit context;
- column-per-measurement model;
- temperature, pulse, respiration, systolic/diastolic BP, oxygen saturation, weight, height, BMI, pain score and consciousness;
- recorder and recorded time;
- later alert rules attach to this table through `vital_alerts.vital_id`;
- current nursing paths can update and hard delete these rows.

### `clinical_vitals`

Created by `migrations/0034_clinical_enhancements.sql`.

Characteristics:

- patient and visit context;
- separate temperature, heart rate, respiratory rate, BP, oxygen saturation, weight, height and BMI columns;
- recorder and recorded time;
- mutable update and soft-delete semantics;
- duplicate authority rather than a projection of `patient_vitals`.

### `global_patient_vitals`

Created by `migrations/0116_global_patient_vitals.sql`.

The migration contract uses `uhid, logged_on` and global-health fields. Runtime code in `src/routes/wellness.ts` uses `patient_id, logged_at` and additional classification fields. These are incompatible runtime column contracts for the same table name.

The PHR path and wellness path therefore do not share one stable schema contract. This prevents trustworthy backfill, parity, and cutover until the drift is explicitly handled.

### `nur_patient_monitoring`

Created by `migrations/0047_nursing.sql` as a nursing monitoring model. It is a domain extension, not a safe vital authority. `src/routes/tenant/nursing/monitoring.ts` primarily writes `patient_vitals`, proving that nursing monitoring and vital fact authority are already mixed.

### Alert tables

`vital_alert_rules` and `vital_alerts` were added by `migrations/0018_vitals_alerts.sql`.

The alert model assumes `patient_vitals.id` is the vital authority. It cannot represent alerts generated from `clinical_vitals`, `global_patient_vitals`, device imports, or a corrected observation without duplicating or losing identity. Alerts must become projections linked to the Canonical observation identity.

## Direct writer surfaces

Primary writer and mutation paths include:

- `src/routes/tenant/vitals.ts`
- `src/routes/tenant/clinical/vitals.ts`
- `src/routes/tenant/nursing/monitoring.ts`
- `src/routes/patient-phr.ts`
- `src/routes/wellness.ts`

Additional references span global health, patient portal, timelines, dashboards, reports, alerts, nursing charts, sync, tests, and mobile consumers. Repository search found 66 files referencing at least one current vital table.

## Mutation risks

### Hard deletion

The nursing monitoring route performs hard delete against `patient_vitals`. A clinical measurement with patient, encounter, practitioner and time provenance must never disappear. A correction or error decision must append evidence.

### Mutable signed clinical fact

Both `patient_vitals` and `clinical_vitals` allow in-place measurement updates. That rewrites clinical history and makes it impossible to distinguish an original reading from a correction.

### Duplicate authority

The same measurement may be written to multiple tables. Same patient, same timestamp, same values, or similar values cannot prove that two rows represent the same clinical act.

### Unit ambiguity

Temperature storage varies between Celsius and Fahrenheit naming. Weight and height representation differs. BMI may be stored even when it should be derived. Blood pressure is stored as two columns but does not have one explicit paired-observation identity.

### Time ambiguity

The schemas use `recorded_at`, `logged_on`, `logged_at`, and creation timestamps. They do not consistently distinguish when the measurement was clinically effective from when it was entered into the system.

### Patient and encounter identity drift

The stores use tenant patient IDs, UHID, visit ID, admission ID, and global patient context. Some records have no exact Canonical encounter mapping. Patient identity and encounter identity cannot be inferred from names, numbers, values, or time proximity.

### Practitioner and device provenance drift

Recorder fields can refer to users, employees, nurses, or unknown text. Device/wearable/import provenance is not normalized. A device source must remain an exact external source identity until a separately verified Canonical device authority exists.

## Required source disposition

| Source | Disposition |
|---|---|
| `patient_vitals` | migrate exact evidence to Canonical observation sets/components; retain as compatibility source until cutover |
| `clinical_vitals` | migrate exact evidence; do not merge by narrative/value/time similarity |
| `global_patient_vitals` with `uhid, logged_on` | migrate only after exact patient-link resolution and stable source contract |
| `global_patient_vitals` with `patient_id, logged_at` | treat as separate schema-contract variant and issue ambiguous rows |
| `nur_patient_monitoring` | retain as nursing consumer/typed extension; do not make it competing vital authority |
| `vital_alert_rules` / `vital_alerts` | retain alert policy/projection behavior; link future alerts to Canonical observation/component identities |
| visit/admission/dashboard/report copies | classify as projections or consumers, never source authority |

## Identity rule

Source mapping is the only cross-table identity proof. Same patient, same timestamp, and same values are not sufficient to merge. Every source row must either have one exact mapping to one Canonical observation set or produce a deterministic processing issue.

## Target boundary

The minimal target contains three additive table families:

1. `canonical_vital_observation_sets`
2. `canonical_vital_observation_components`
3. `canonical_vital_observation_status_events`

Alerts, classifications, BMI calculators, wellness scores, nursing charts, dashboards, reports, and timelines are consumers or projections. They are not vital fact authority.

## External gates

This audit does not authorize:

- migration `0556` creation;
- runtime writer or reader changes;
- provider flag creation or activation;
- production query, migration, backfill, or mutation;
- local sync activation;
- push or CDB-to-main integration;
- legacy deletion or retirement.
