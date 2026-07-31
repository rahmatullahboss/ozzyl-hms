# P12 Canonical Medication Administration Commands Receipt

**Checkpoint:** `CDB-124C-CANONICAL-MEDICATION-ADMINISTRATION-COMMANDS-VERIFIED`

**Date:** 2026-07-28

**Status:** completed and verified locally; uncommitted because the active connector exposes no Git commit action

## Commands delivered

1. `recordCanonicalMedicationAdministrationEvent`
2. `correctCanonicalMedicationAdministrationEvent`
3. `enterCanonicalMedicationAdministrationInError`
4. `createCanonicalMedicationReconciliationDraft`
5. `replaceCanonicalMedicationReconciliationDraft`
6. `finalizeCanonicalMedicationReconciliation`
7. `cancelCanonicalMedicationReconciliation`

## Administration behavior

- exact Canonical medication-order and current persisted status-event version validation;
- exact tenant, patient-link, encounter, administering-practitioner, and actor scope;
- plain positive canonical decimal dose normalization;
- `given` and `partially_given` require dose, unit, and route;
- non-administration outcomes require a reason and cannot claim administered dose or route;
- exact scheduled, occurred, recorded, late-entry, dispense, lot, barcode, and device evidence;
- deterministic IDs and tenant-scoped idempotency;
- replay before mutable order/event validation;
- corrections and entered-in-error create immutable replacement events;
- one active replacement per event;
- compatibility statements, Canonical event, source mapping, PHI-minimised outbox, and command receipt share one D1 batch;
- partial failure rolls the complete operation back.

## Reconciliation behavior

- create draft inserts header, version, deterministic items, draft-created lifecycle event, one-time current-version pointer initialization, source mapping, outbox, and receipt atomically;
- replacing a draft creates a new immutable version and items, preserves the previous version, and advances optimistic status version;
- finalization requires the exact active draft/version, item evidence, active practitioner, and signed-content hash parity;
- cancellation is limited to an active draft and creates immutable version/status evidence;
- replay is resolved before mutable reconciliation state validation;
- reconciliation completion never creates prescription or medication-order intent implicitly;
- outbox and command receipt requests contain a full-operation SHA-256 rather than patient, encounter, practitioner, order, medication, dose, or item content.

## Schema compatibility correction

Migration `0557` now permits one controlled current-version pointer initialization from null to the first draft version only when matching `draft_created` status event version 1 and draft version evidence exist. All later pointer/status changes still require optimistic status-version advancement and matching immutable lifecycle evidence.

## Verification

- `test/canonical/medication-administration-schema.test.ts`: 7 tests.
- `test/canonical/medication-administration-commands.test.ts`: 7 tests.
- TypeScript verification completed for the command and schema modules.

## Safety state

- no runtime routes changed;
- no provider created or enabled;
- no production query/mutation;
- no production migration/backfill;
- no local sync activation;
- no push;
- no CDB-to-main integration;
- no legacy history retired.
