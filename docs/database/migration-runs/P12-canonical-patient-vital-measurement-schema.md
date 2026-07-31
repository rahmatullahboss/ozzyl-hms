# P12 Canonical Patient Vital Measurement Schema Receipt

**Checkpoint:** `CDB-123B-CANONICAL-PATIENT-VITAL-MEASUREMENT-SCHEMA-VERIFIED`

**Date:** 2026-07-28

**Status:** completed and verified locally after schema-governance regression coverage; uncommitted because the active connector exposes no Git commit action

## Added schema

Migration: `migrations/0556_canonical_patient_vital_measurement.sql`

Drizzle module: `src/db/schema/canonical/vital-observations.ts`

Canonical table families:

1. `canonical_vital_observation_sets`
2. `canonical_vital_observation_components`
3. `canonical_vital_observation_status_events`

## Database guarantees

- exact tenant and patient-link ownership;
- optional encounter must belong to the same patient link;
- practitioner-entered and nurse-entered sources require a Canonical practitioner;
- external device source type/public ID are paired and required for device imports;
- effective and recorded timestamps are normalized UTC and ordered;
- every set starts `pending_review` with status version 1;
- review transitions require a matching immutable status event;
- verified sets require at least one component;
- blood pressure verification requires paired systolic/diastolic components;
- components use reviewed measurement-code/canonical-unit pairs and bounded numeric ranges;
- source value/unit snapshots are paired;
- BMI must be derived with formula identity/version;
- components and status events are immutable;
- aggregate fact fields are immutable;
- hard delete is blocked;
- one replacement lineage is allowed per superseded set;
- idempotency, request fingerprint and source evidence are tenant scoped.

## Verification

- `test/canonical/patient-vital-measurement-schema.test.ts`: 6 tests.
- `pnpm exec tsc --noEmit`: passed.
- `pnpm build:migrations`: passed with 491 migrations.
- Canonical source-of-truth registry includes all three tables.

## Safety state

- no runtime route changes;
- no provider creation or activation;
- no production query/mutation;
- no production migration/backfill;
- no local sync activation;
- no push;
- no CDB-to-main integration;
- legacy tables remain active compatibility sources.
