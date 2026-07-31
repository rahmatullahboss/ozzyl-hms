# P12 Canonical Medication Administration Schema Receipt

**Checkpoint:** `CDB-124B-CANONICAL-MEDICATION-ADMINISTRATION-SCHEMA-VERIFIED`

**Date:** 2026-07-28

**Status:** completed and verified locally; uncommitted because the active connector exposes no Git commit action

## Added schema

Migration: `migrations/0557_canonical_medication_administration.sql`

Drizzle module: `src/db/schema/canonical/medication-administration.ts`

Canonical table families:

1. `canonical_medication_administration_events`
2. `canonical_medication_reconciliations`
3. `canonical_medication_reconciliation_versions`
4. `canonical_medication_reconciliation_items`
5. `canonical_medication_reconciliation_status_events`

## Database guarantees

- administration events link to an exact Canonical medication order and persisted medication-order status-event version;
- order, patient-link, encounter, and administering practitioner scope is tenant exact;
- actual administration and non-administration outcomes use controlled vocabularies;
- `given` and `partially_given` require canonical decimal dose/unit and route;
- non-administration outcomes require a reason and cannot claim administered dose/route;
- scheduled, occurred, and recorded time semantics are normalized and guarded;
- optional dispense, lot, barcode, and device identities are paired exact source values;
- administration, correction, and entered-in-error chains are append-only;
- one same-scope replacement is allowed and hard delete is blocked;
- reconciliation headers own exact patient/encounter/type/current lifecycle;
- reconciliation versions, items, and status events are immutable;
- every version starts as draft;
- controlled finalization requires a matching status event, at least one item, finalizing practitioner, and signed-content hash parity;
- items use deterministic sequence, controlled source/decision vocabulary, optional exact prescription/order references, and immutable evidence;
- reconciliation header transitions require matching version and status-event evidence;
- idempotency, request fingerprints, source evidence, and restricted deletion are enforced.

## Governance parser correction

The governance SQL parser initially missed the first table because the decimal constraint used the empty SQL string literal. The constraint now uses equivalent GLOB-based one-dot/one-minus validation without an empty literal. SQLite behavior remains strict and the governance parser recognizes all five tables.

## Verification

- `test/canonical/medication-administration-schema.test.ts`: 6 tests passed.
- `pnpm exec tsc --noEmit`: passed.
- `pnpm build:migrations`: passed with 492 migrations.
- Canonical source-of-truth registry includes all five tables.

## Safety state

- no runtime route changes;
- no command/provider implementation in CDB-124B;
- no provider activation;
- no production query/mutation;
- no production migration/backfill;
- no local sync activation;
- no push;
- no CDB-to-main integration;
- legacy MAR and reconciliation tables remain active compatibility sources.
