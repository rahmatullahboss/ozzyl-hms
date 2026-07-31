# P11 Canonical Prescription and Medication-Intent Authority

**Checkpoint:** `CDB-121E-CANONICAL-PRESCRIPTION-MEDICATION-AUTHORITY-VERIFIED`
**Date:** 2026-07-27
**Branch:** `program/cdb-main-continuous-20260725`
**Previous checkpoint:** `CDB-121D-CANONICAL-PRESCRIPTION-MEDICATION-BACKFILL-RECONCILIATION-VERIFIED`
**Next checkpoint:** `CDB-122A-CLINICAL-DOCUMENT-DIAGNOSIS-AUTHORITY-DESIGN`

## Final local result

The prescription and medication-intent concept is now implemented as a complete local Canonical authority with:

- five Canonical authority tables from migration `0554`;
- six atomic idempotent command boundaries;
- bounded, resumable prescription and standalone-CPOE backfill;
- persistent 16-check aggregate reconciliation;
- disabled-safe legacy/shadow/canonical provider modes;
- separate prescription-document and medication-order projections;
- two selected library read adapters;
- three reviewed reader assignments with zero unknown assignments;
- fail-closed local readiness evidence;
- blocked production activation and blocked legacy retirement.

The authority matrix now classifies `prescription_medication_intent` as `implemented_canonical`. This is a local architecture-completion claim only; live legacy routes and writers remain unchanged.

## Canonical authority

Canonical tables:

```text
canonical_prescriptions
canonical_prescription_versions
canonical_medication_orders
canonical_medication_order_status_events
canonical_prescription_safety_events
```

The Canonical authority owns encounter-linked prescribing intent, immutable prescription versions, medication-order lifecycle, and safety evidence. It does not own medication administration, medication reconciliation, pharmacy fulfilment, sale/delivery/payment workflow, stock, billing, diagnosis, observation, or vital authority.

## Commands

```text
createCanonicalPrescriptionDraft
replaceCanonicalPrescriptionDraft
finalizeCanonicalPrescription
amendCanonicalPrescription
transitionCanonicalMedicationOrder
recordCanonicalPrescriptionSafetyEvent
```

Commands enforce exact tenant patient, encounter, and practitioner scope; optimistic versions; immutable signed history; explicit order lifecycle events; atomic source mappings and PHI-minimised outbox evidence; exact replay; conflicting replay rejection; and full rollback on statement failure.

## Backfill and reconciliation

The backfill processes `prescription_headers` and `standalone_cpoe_orders` through independent persistent checkpoints and a caller-provided source-row limit. Identity and episode resolution uses only exact tenant-scoped source mappings and reviewed completion-claim, appointment, admission, legacy-visit, or legacy-encounter evidence.

Commercial `medication_orders`, pharmacy-local `pharmacy_prescriptions`, fulfilment, stock, billing, payment, MAR/administration, and medication-reconciliation rows create no clinical medication intent.

The local fixture proved source immutability, deterministic stable ambiguity issues, exact scope preservation, and zero new Canonical business rows on the second pass.

Persistent reconciliation records 16 fixed aggregate checks covering source coverage, patient/encounter/practitioner references, version continuity, final signature evidence, linked order scope, order-event parity and transitions, safety scope, source fingerprint immutability, foreign-key violations, integrity, and second-pass idempotence.

## Disabled provider and selected read adapters

Provider flag:

```text
canonical_prescription_medication_provider_v1
```

Missing, disabled, or non-promoted configuration resolves to `legacy`. Enabled `shadow` and `canonical` modes are supported locally, but the repository evidence keeps the provider disabled by default.

Selected adapters:

```text
cdb121e_prescription_detail
cdb121e_medication_order_detail
```

Reviewed readers:

```text
src/routes/global-portal.ts
src/routes/tenant/patients-chart.ts
src/routes/tenant/nursing/clinical-summary.ts
```

These remain library contracts only. No live route was connected or changed. Canonical resolution requires explicit source mapping and exact tenant patient/practitioner/encounter evidence. Medication text, name, numeric coincidence, or timestamp proximity never selects a Canonical record.

Shadow evidence contains only aggregate comparison counts, latency/error totals, accepted-exception count, observation time, and a SHA-256 digest. It excludes tenant/source/public identifiers, patient identifiers, medication names, dose, route, frequency, duration, instructions, and clinical notes.

## Readiness

```text
local_ready: true
production_ready: false
provider_enabled: false
selected_adapter_count: 2
known_reader_count: 3
unknown_reader_assignments: 0
blocked_gate_count: 2
production_gate: blocked
retirement_gate: blocked
```

Required local evidence exists for schema, commands, backfill, reconciliation, provider, adapters, tests, coverage, and prior receipts. Production migration/backfill, provider activation, route cutover, production observation, rollback evidence, and retirement approval remain absent.

## Verification

```text
prescription_focused_test_files: 9
prescription_focused_tests: 38
canonical_test_files: 228
canonical_tests: 1560
typescript: passed
migrations_generated: 489
concepts: 46
implemented_canonical_concepts: 18
partial_canonical_concepts: 10
canonical_gaps: 16
external_governed_concepts: 2
canonical_tables: 84
governed_legacy_tables: 5
governed_tables: 200
writer_access_pairs: 891
reader_access_pairs: 2157
identity_episode_reader_pairs: 640
identity_episode_reader_paths: 256
identity_episode_reader_tables: 41
unknown_provider_assignments: 0
schema_governance_issues: 0
authority_governance_issues: 0
access_governance_issues: 0
identity_episode_local_ready: true
identity_episode_production_ready: false
prescription_medication_local_ready: true
prescription_medication_production_ready: false
local_sync_ready_entities: 0
local_sync_blocked_entities: 8
legacy_retirement_eligible_allowances: 0
legacy_retirement_blocked_allowances: 66
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

Migration `0554`, commands, backfill, reconciliation, provider, adapters, and readiness artifacts remain repository-local and outside the previously bound H3 `0541`–`0550` production authorization scope.

## Exact next action

Start `CDB-122A-CLINICAL-DOCUMENT-DIAGNOSIS-AUTHORITY-DESIGN` as a local design-only checkpoint. Inventory clinical notes, SOAP/consultation documentation, diagnoses, assessments, attachments, signatures, amendments, coding, and read consumers; separate document authority from encounter, prescription, order, billing, and reporting authority; record exact protected-core dependencies; and define serial schema, command, migration, reconciliation, provider, readiness, cutover, and retirement checkpoints. Do not mutate production or connect live routes.
