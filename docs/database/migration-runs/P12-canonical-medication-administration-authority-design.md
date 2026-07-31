# P12 Canonical Medication Administration Authority Design Receipt

**Checkpoint:** `CDB-124A-MEDICATION-ADMINISTRATION-AUTHORITY-DESIGN-VERIFIED`

**Date:** 2026-07-28

**Status:** repository-only design completed locally; uncommitted because the active connector exposes no Git commit action

## Audited authority boundary

The audit confirmed that `nur_medication_admin` currently mixes future schedule rows, actual administration, non-administration outcomes, mutable correction, and visibility state. It also confirmed that medication reconciliation is a separate workflow whose mutable header/items and non-atomic discharge side effect require a versioned signed authority.

Primary source and consumer surfaces reviewed:

- `migrations/0047_nursing.sql`
- `migrations/0050_clinical_mar.sql`
- `src/routes/tenant/nursing/mar.ts`
- `src/routes/tenant/nursing/medication-orders.ts`
- `src/routes/tenant/nursing/medication-reconciliation.ts`
- `src/routes/tenant/nursing/medication-due.ts`
- `src/schemas/nursing.ts`
- `src/db/schema/canonical/medication.ts`

## Locked target

Five planned Canonical table families:

1. `canonical_medication_administration_events`
2. `canonical_medication_reconciliations`
3. `canonical_medication_reconciliation_versions`
4. `canonical_medication_reconciliation_items`
5. `canonical_medication_reconciliation_status_events`

Administration and reconciliation remain separate authorities. Scheduled dose opportunities are projections. Administration events, corrections, entered-in-error evidence, reconciliation versions/items, and reconciliation lifecycle events are append-only. Hard deletion is forbidden.

Every administration event requires exact Canonical medication-order and status-version evidence, patient-link and encounter scope, active practitioner/actor identity, controlled timing, outcome-specific dose/route/reason evidence, exact source mapping, and immutable lineage. Medicine text, patient/time proximity, schedule similarity, and numeric coincidence cannot establish identity.

Medication reconciliation is versioned and signed. Finalization never silently creates prescriptions or medication orders; any resulting intent requires a separate explicit Canonical command.

## Serial implementation plan

- CDB-124B: additive schema for five table families.
- CDB-124C: seven atomic idempotent administration/reconciliation commands.
- CDB-124D: eight persistent bounded-backfill partitions and fixed twenty-two-check reconciliation.
- CDB-124E: disabled-safe providers, selected adapters, coverage, rollback, and fail-closed readiness.

## Safety state

- schema migration created: no
- Drizzle schema module created: no
- runtime command module created: no
- provider created or enabled: no
- runtime route changed: no
- production query performed: no
- production mutation performed: no
- production migration/backfill applied: no
- local sync activated: no
- push performed: no
- CDB-to-main integration performed: no
- legacy history retired: no

## Next checkpoint

`CDB-124B-CANONICAL-MEDICATION-ADMINISTRATION-SCHEMA`

Revalidate migration `0557`, write the failing SQLite schema contract first, then add only the five planned table families and a dedicated Canonical Drizzle module. Do not wire routes or perform production actions.
