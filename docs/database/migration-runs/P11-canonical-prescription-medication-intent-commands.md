# P11 Canonical Prescription and Medication-Intent Commands

**Checkpoint:** `CDB-121C-CANONICAL-PRESCRIPTION-MEDICATION-COMMANDS-VERIFIED`
**Date:** 2026-07-27
**Branch:** `program/cdb-main-continuous-20260725`
**Previous checkpoint:** `CDB-121B-CANONICAL-PRESCRIPTION-MEDICATION-SCHEMA-VERIFIED`
**Next checkpoint:** `CDB-121D-CANONICAL-PRESCRIPTION-MEDICATION-BACKFILL-RECONCILIATION`

## Result

`src/lib/canonical/commands/manage-prescription-medication-intent.ts` now provides six local Canonical command boundaries:

- `createCanonicalPrescriptionDraft`;
- `replaceCanonicalPrescriptionDraft`;
- `finalizeCanonicalPrescription`;
- `amendCanonicalPrescription`;
- `transitionCanonicalMedicationOrder`;
- `recordCanonicalPrescriptionSafetyEvent`.

The commands use the existing Canonical command-batch and replay primitives. The outbox idempotency claim, reviewed compatibility statements, prescription/version/order rows, immutable order lifecycle events, source mappings, and safety events commit in one D1-compatible atomic batch.

## Identity and episode rules

Draft creation fails closed unless all of the following are exact and tenant-scoped:

- active Canonical tenant-patient link;
- Canonical encounter linked to that same patient link;
- active Canonical prescribing practitioner;
- source mapping availability for prescription, version, and medication-order source rows.

Names, phone numbers, medication text, numeric-ID coincidence, and timestamp proximity are not used for patient, practitioner, encounter, version, or order identity.

## Version and lifecycle behavior

- Draft creation writes a prescription, immutable version 1, medication orders, initial order events, and three source-mapping families.
- Draft replacement creates a new version and new orders. Prior draft orders become `entered_in_error` through explicit lifecycle events; the prior version remains preserved.
- Finalisation requires an exact expected version, matching active prescribing/signing practitioner, at least one draft medication order, and a lowercase signed-snapshot SHA-256. It finalises the version and activates the orders atomically.
- Amendment never edits a signed version. It creates a superseding immutable amendment version, stops active/on-hold prior orders through lifecycle events, and creates active replacement orders.
- Standalone medication-order transitions use an explicit transition matrix and optimistic version guard.
- Override or waiver safety events require `overridden` outcome and an active actor practitioner.

No hard delete exists for prescription or medication-order history.

## Idempotency and rollback

- Public IDs are deterministic when not supplied.
- Identical command replay returns the persisted PHI-minimised result before state-dependent validation.
- A changed request under the same tenant/idempotency key raises `CanonicalIdempotencyConflictError`.
- Any failed compatibility or Canonical statement rolls back the outbox claim, prescription, versions, orders, events, and mappings.

## Privacy and authority separation

Outbox payloads contain only Canonical public IDs, statuses, versions, event types, outcomes, and aggregate counts. Medication display, generic name, dose, strength, duration, instructions, patient link, encounter, practitioner, source row IDs, and other clinical text are excluded.

The commands do not write or infer:

- MAR or medication-administration facts;
- medication-reconciliation facts;
- pharmacy fulfilment, sale, delivery, payment, or provider workflow;
- stock movements or balances;
- invoices, collections, deposits, accounting, or compensation;
- diagnosis, advice, observation, or vital authority.

## Verification

```text
command_test_files: 1
command_tests: 8
identity_readiness_test_files: 2
identity_readiness_tests: 9
focused_continuity_test_files: 5
focused_continuity_tests: 28
canonical_test_files: 224
canonical_tests: 1549
typescript: passed
migrations_generated: 489
concepts: 46
canonical_tables: 84
governed_tables: 200
writer_access_pairs: 881
reader_access_pairs: 2108
identity_episode_reader_pairs: 625
identity_episode_reader_paths: 253
identity_episode_reader_tables: 41
unknown_provider_assignments: 0
schema_governance_issues: 0
authority_governance_issues: 0
access_governance_issues: 0
identity_episode_local_ready: true
identity_episode_production_ready: false
```

The identity/episode provider coverage changed only because this new reviewed command module reads Canonical patient, encounter, and practitioner authorities. Existing provider flags and selected runtime adapters remain disabled and unchanged.

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

Migration `0554` and these commands remain repository-local. They are outside the previously bound H3 production-schema authorization contract.

## Exact next action

Implement `CDB-121D-CANONICAL-PRESCRIPTION-MEDICATION-BACKFILL-RECONCILIATION` with bounded, resumable, tenant-scoped planning and persistent fail-closed reconciliation. Deterministic encounter resolution must use exact completion-claim, appointment, admission, or legacy visit mapping evidence only; ambiguous rows must become stable processing issues, and the second pass must create zero new business rows.
