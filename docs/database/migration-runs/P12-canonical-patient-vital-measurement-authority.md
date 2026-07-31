# P12 Canonical Patient Vital Measurement Authority Receipt

**Checkpoint:** `CDB-123E-CANONICAL-PATIENT-VITAL-MEASUREMENT-AUTHORITY-VERIFIED`

**Date:** 2026-07-28

**Status:** locally complete and verified; uncommitted because the active connector exposes no Git commit action

## Authority delivered

CDB-123 provides one patient vital measurement authority across the previously competing `patient_vitals`, `clinical_vitals`, `global_patient_vitals`, and nursing monitoring surfaces.

Canonical tables:

1. `canonical_vital_observation_sets`
2. `canonical_vital_observation_components`
3. `canonical_vital_observation_status_events`

The authority preserves exact tenant, patient-link, encounter, practitioner, external-device, effective-time, recorded-time, source, code, unit, value, review, correction, supersession, idempotency, and evidence semantics.

## Commands

Four atomic idempotent commands are implemented:

1. `recordCanonicalVitalObservationSet`
2. `reviewCanonicalVitalObservationSet`
3. `correctCanonicalVitalObservationSet`
4. `enterCanonicalVitalObservationSetInError`

Record operations normalize temperature to `Cel`, require paired blood-pressure components, derive BMI from exact canonical weight and height, reject manual BMI authority, create exact source mappings, and write compatibility statements, Canonical facts, lifecycle evidence, and PHI-minimised outbox intent in one D1 batch.

Corrections never rewrite components. They create a replacement pending-review set and supersede the original through immutable lifecycle events. Hard deletion remains prohibited.

## Backfill and reconciliation

The local backfill uses nine persistent bounded and resumable partitions:

1. `patient_vitals` facts;
2. patient-vital alert disposition;
3. `clinical_vitals` facts;
4. `global_patient_vitals` UHID/logged-on contract;
5. `global_patient_vitals` patient-id/logged-at contract;
6. nursing monitoring;
7. device and wearable provenance;
8. BMI, classification, and derived-value disposition;
9. duplicate and projection disposition.

Source tables remain read-only. Exact source mapping is the only cross-table identity proof. Missing or ambiguous identity, encounter, practitioner, device, alert, BMI, or duplicate evidence becomes a deterministic non-PHI processing issue.

The persistent reconciliation receipt contains exactly twenty checks covering mappings, patient/encounter/practitioner/device scope, component ownership and sequence, code/unit/value validity, BP pairing, BMI parity, time ordering, lifecycle events, supersession, patient review policy, alert projections, critical issues, integrity, source fingerprints, foreign keys, and second-pass idempotency.

## Disabled-safe provider and readiness

Provider flag: `canonical_patient_vital_measurement_provider_v1`.

- enabled by default: no
- default mode: `legacy`
- rollback mode: `legacy`
- supported modes: `legacy`, `shadow`, `canonical`
- selected library adapters: 2
- reviewed readers: 4
- unknown reader assignments: 0
- runtime route activations: 0

Shadow mode preserves legacy-facing values while producing aggregate PHI-minimised parity evidence. Canonical mode requires exact mapping and fails closed.

Local readiness is true. Production readiness is false. Production activation and legacy retirement remain blocked external gates.

## Governance correction

Canonical schema governance now supports exact registry-approved non-money `REAL` columns. Only the vital component fields `numeric_value` and `source_numeric_value` are approved. The existing rejection of monetary `REAL` columns remains active and regression-tested.

## Fresh verification

- CDB-123 focused/governance regression: 7 files, 42 tests passed.
- TypeScript: passed.
- Migration manifest: passed with 491 migrations.
- Patient vital readiness checker: local ready, production not ready, zero issues.
- Provider remains disabled and runtime routes remain unchanged.

## Safety state

- production query performed: no
- production mutation performed: no
- production migration applied: no
- production backfill applied: no
- provider flag enabled: no
- runtime route changed: no
- traffic changed: no
- deployment performed: no
- local sync activated: no
- legacy history retired: no
- push performed: no
- CDB-to-main integration performed: no

## Next checkpoint

The next unresolved Canonical authority is medication administration and reconciliation. Continue with `CDB-124A-MEDICATION-ADMINISTRATION-AUTHORITY-DESIGN` as a repository-only design/audit checkpoint before adding schema or runtime behavior.
