# P11 Canonical Prescription and Medication-Intent Backfill and Reconciliation

**Checkpoint:** `CDB-121D-CANONICAL-PRESCRIPTION-MEDICATION-BACKFILL-RECONCILIATION-VERIFIED`
**Date:** 2026-07-27
**Branch:** `program/cdb-main-continuous-20260725`
**Previous checkpoint:** `CDB-121C-CANONICAL-PRESCRIPTION-MEDICATION-COMMANDS-VERIFIED`
**Next checkpoint:** `CDB-121E-CANONICAL-PRESCRIPTION-MEDICATION-DISABLED-PROVIDERS-READINESS`

## Result

The local Canonical program now has bounded, resumable prescription/medication-intent migration and persistent aggregate reconciliation:

- `scripts/canonical/backfill-prescription-medication-intent.ts`
- `scripts/canonical/reconcile-prescription-medication-intent.ts`

The backfill migrates exact clinical prescription intent from reviewed legacy prescription sources and exact standalone CPOE intent from `cln_medication_orders`. It does not create clinical medication intent from commercial `medication_orders`, pharmacy-local `pharmacy_prescriptions`, fulfilment, sale, payment, delivery, stock, MAR/administration, or medication-reconciliation rows.

## Deterministic identity and episode resolution

Prescription rows require:

- exact tenant-scoped `legacy_patient` → Canonical patient-link mapping;
- exact `legacy_doctor` mapping or active practitioner-user link;
- exactly one valid Canonical encounter candidate from reviewed completion-claim, appointment-link, admission, legacy-visit, or legacy-encounter evidence;
- exact patient-link parity between prescription scope and encounter scope.

Standalone CPOE orders require exact patient, practitioner-user, and legacy-visit encounter evidence.

Names, phone numbers, medication text, numeric-ID coincidence, and timestamp proximity are never used for identity or episode resolution.

## Bounded and resumable execution

The executor persists a Canonical migration run and two independent backfill checkpoints:

- `prescription_headers`;
- `standalone_cpoe_orders`.

`maxSourceRecords` bounds each invocation. Checkpoint cursors advance only after a source row has either committed its complete Canonical batch or committed a stable processing issue. A later invocation resumes from the persisted cursor.

Each successfully migrated prescription source row atomically commits:

- Canonical prescription current state;
- immutable version 1;
- medication orders and initial lifecycle events;
- prescription override/safety evidence;
- exact source mappings;
- final current-version pointer.

Each standalone CPOE source row atomically commits its Canonical medication order, initial lifecycle event, and mapping.

## Stable issue behavior

Missing or conflicting patient, practitioner, or encounter evidence produces deterministic `canonical_processing_issues` records. Issue details contain only aggregate evidence categories and candidate counts; medication names, dose text, instructions, patient names, phone numbers, and other clinical text are excluded.

Repeated execution reuses the stable issue identity and increments `occurrence_count`; it does not create duplicate issue rows.

## Local fixture evidence

The focused fixture proved:

```text
source_prescriptions_scanned: 2
canonical_prescriptions_created: 1
canonical_prescription_versions_created: 1
linked_medication_orders_created: 1
standalone_cpoe_orders_created: 1
medication_order_status_events_created: 2
prescription_safety_events_created: 2
stable_ambiguity_issues_created: 1
new_prescription_medication_source_mappings: 6
commercial_medication_orders_mutated: 0
pharmacy_prescriptions_mutated: 0
source_rows_mutated: 0
second_pass_new_business_rows: 0
```

One reviewed prescription resolved uniquely through its completion claim and legacy-visit mapping. A second source row contained two conflicting exact encounter candidates and correctly produced `RX_ENCOUNTER_EVIDENCE_AMBIGUOUS` instead of guessing.

## Persistent reconciliation

`reconcilePrescriptionMedicationIntent` persists one PHI-minimised `canonical_reconciliation_runs` record with 16 fixed aggregate checks:

1. prescription source coverage;
2. prescription-item coverage;
3. standalone CPOE coverage;
4. patient-link reference integrity;
5. encounter reference and patient parity;
6. active practitioner reference integrity;
7. prescription current-version parity;
8. final/amendment signature evidence;
9. version sequence continuity;
10. linked medication-order prescription/version scope;
11. latest order-event/header parity;
12. order-event sequence and transition validity;
13. safety-event scope and override actor rules;
14. source fingerprint immutability;
15. foreign-key violation count;
16. integrity status and zero-new-business-row second pass.

A clean fixture persisted `passed`, 16 scanned checks, 16 matched checks, and zero mismatches. A deliberately corrupted fixture persisted `failed` with aggregate encounter, source-fingerprint, foreign-key, and second-pass mismatch evidence.

## Verification

```text
focused_test_files: 4
focused_tests: 13
typescript: passed
migrations_generated: 489
concepts: 46
canonical_tables: 84
governed_tables: 200
writer_access_pairs: 891
reader_access_pairs: 2141
identity_episode_reader_pairs: 634
identity_episode_reader_paths: 255
identity_episode_reader_tables: 41
unknown_provider_assignments: 0
schema_governance_issues: 0
authority_governance_issues: 0
access_governance_issues: 0
identity_episode_local_ready: true
identity_episode_production_ready: false
```

## Production safety

```text
production_rows_written: 0
production_query_performed: false
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

Migration `0554`, the command module, this backfill, and this reconciliation remain repository-local and outside the earlier H3 production authorization scope.

## Exact next action

Implement `CDB-121E-CANONICAL-PRESCRIPTION-MEDICATION-DISABLED-PROVIDERS-READINESS` using TDD. Add disabled-safe legacy/shadow/canonical provider modes, separate prescription-document and medication-order adapters, exact mapping-only reads, aggregate shadow comparison, selected-reader coverage, local readiness evidence, and explicit blocked production/retirement gates. No provider activation, route change, production observation, or legacy retirement is authorized.
