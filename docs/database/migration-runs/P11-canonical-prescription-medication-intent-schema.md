# P11 Canonical Prescription and Medication-Intent Schema

**Checkpoint:** `CDB-121B-CANONICAL-PRESCRIPTION-MEDICATION-SCHEMA-VERIFIED`
**Date:** 2026-07-27
**Branch:** `program/cdb-main-continuous-20260725`
**Previous checkpoint:** `CDB-121A-PRESCRIPTION-MEDICATION-INTENT-AUTHORITY-DESIGN-VERIFIED`
**Next checkpoint:** `CDB-121C-CANONICAL-PRESCRIPTION-MEDICATION-COMMANDS`

## Result

The additive D1/SQLite migration `0554_canonical_prescription_medication_intent.sql` and Drizzle module `src/db/schema/canonical/medication.ts` now define five tenant-scoped Canonical authorities:

1. `canonical_prescriptions` — encounter-linked prescription document current state;
2. `canonical_prescription_versions` — immutable version and signature-hash history;
3. `canonical_medication_orders` — encounter-linked clinical medication intent current state;
4. `canonical_medication_order_status_events` — immutable order lifecycle history;
5. `canonical_prescription_safety_events` — immutable safety evaluation and override evidence.

No legacy table is altered, rebuilt, renamed, dropped, or retired.

## Identity and lifecycle enforcement

Every prescription and medication order requires exact tenant-scoped patient-link, encounter, and prescribing-practitioner identity. Linked medication orders must match the prescription's tenant, patient, encounter, and prescriber. Prescription version numbers and medication-order event versions are positive and unique within their aggregate.

Prescription statuses are `draft`, `final`, `amended`, `cancelled`, and `entered_in_error`. Medication-order statuses are `draft`, `active`, `on_hold`, `completed`, `stopped`, `cancelled`, and `entered_in_error`.

Final/amendment versions require a signing practitioner, finalisation timestamp, and lowercase SHA-256 signed-snapshot hash. Draft versions cannot claim signed/final state. Supersession cannot reference itself. All clinical history uses `ON DELETE RESTRICT`; no cascade delete removes final evidence.

The circular prescription-current-version and version-parent foreign keys are enforced by migration `0554`. They are intentionally omitted only from Drizzle's circular table initialiser metadata because TypeScript cannot safely infer two mutually recursive SQLite table constants. All non-circular Drizzle references remain typed and tenant-scoped.

## Separate authorities preserved

The schema contains no dispense quantity, sale, payment, invoice, stock balance, diagnosis, advice, vital, patient demographic, or medication-administration authority. Commercial fulfilment and pharmacy-local workflows cannot create clinical medication intent by themselves.

## Governance

The authority matrix now classifies `prescription_medication_intent` as `partial_canonical` and registers all five tables. Summary evidence is:

```text
concepts: 46
implemented_canonical_concepts: 17
partial_canonical_concepts: 11
canonical_gaps: 16
external_governed_concepts: 2
canonical_tables: 84
governed_legacy_tables: 5
governed_tables: 200
writer_access_pairs: 875
reader_access_pairs: 2101
identity_episode_reader_pairs: 622
identity_episode_reader_paths: 252
identity_episode_reader_tables: 41
unknown_provider_assignments: 0
```

The identity/episode coverage and readiness hashes were regenerated only because the shared source/access registry changed. Provider counts and adoption assignments remain unchanged; no provider flag was enabled.

## Verification

```text
schema_test_files: 1
schema_tests: 6
focused_governance_test_files: 4
focused_governance_tests: 35
typescript: passed
schema_governance_issues: 0
authority_governance_issues: 0
access_governance_issues: 0
migrations_generated: 489
identity_episode_local_ready: true
identity_episode_production_ready: false
```

## Production safety

```text
production_rows_written: 0
production_mutation_performed: false
production_migration_applied: false
production_backfill_applied: false
provider_flag_enabled: false
route_changed: false
traffic_changed: false
deployment_performed: false
local_sync_activated: false
legacy_history_retired: false
remote_database_deleted: false
push_performed: false
cdb_to_main_integration_performed: false
```

The previously prepared H3 production-schema contract remains separate and blocked because exact protected authorization is absent. Migration `0554` is not part of H3's bound `0541`–`0550` scope.

## Exact next action

Implement `CDB-121C-CANONICAL-PRESCRIPTION-MEDICATION-COMMANDS` with TDD: deterministic draft creation, draft replacement, finalisation, amendment/supersession, medication-order lifecycle transitions, safety events, idempotent replay/conflict rejection, optimistic versions, exact identity validation, atomic source mapping/outbox/assertion evidence, and no administration or fulfilment mutation.
