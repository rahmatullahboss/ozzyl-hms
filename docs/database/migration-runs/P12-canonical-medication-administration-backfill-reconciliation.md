# P12 Canonical Medication Administration Backfill and Reconciliation Receipt

**Checkpoint:** `CDB-124D-CANONICAL-MEDICATION-ADMINISTRATION-BACKFILL-RECONCILIATION-VERIFIED`

**Date:** 2026-07-28

**Status:** completed and verified locally; uncommitted because the active connector exposes no Git commit action

## Eight persistent bounded partitions

1. order-linked MAR administration outcomes;
2. order-linked MAR non-administration outcomes;
3. MAR rows without exact Canonical medication-order mapping;
4. schedule-only MAR projection disposition;
5. medication reconciliation headers;
6. reconciliation items and version reconstruction;
7. reconciliation completion and cancellation lifecycle;
8. prescription/order/discharge effect plus mutable-history, duplicate, and correction disposition.

Every partition uses the shared `canonical_migration_runs` and `canonical_backfill_checkpoints` authorities, a persistent cursor, caller-bounded source count, and resumable status. Legacy MAR and reconciliation tables are read-only.

## Backfill guarantees

- exact legacy order-to-Canonical medication-order mapping is mandatory;
- medication name, patient/time proximity, schedule similarity, and numeric coincidence never create identity;
- exact patient-link, encounter, practitioner, current medication-order status version, outcome, dose/unit, route/reason, and time evidence are required;
- schedule-only rows create no medication-administration fact;
- exact administration and non-administration evidence is written through the CDB-124C command boundary;
- ambiguous dose, route, timing, order, patient, encounter, practitioner, correction, and reconciliation evidence creates deterministic non-PHI processing issues;
- reconciliation headers and active items are reconstructed as one immutable draft version;
- completed and cancelled legacy reconciliations create explicit immutable lifecycle evidence;
- reconciliation decisions never silently create prescriptions, medication orders, or discharge effects;
- mutable or hidden MAR evidence is dispositioned for source-snapshot review rather than rewritten;
- already mapped source rows are skipped;
- a completed second pass creates zero new business rows.

## Fixed twenty-two checks

1. source mapping ownership;
2. medication-order ownership;
3. medication-order status-version evidence;
4. patient-link scope;
5. encounter scope;
6. practitioner scope;
7. actor presence;
8. event-kind and outcome validity;
9. dose/unit completeness;
10. route/reason completeness;
11. time ordering;
12. correction scope;
13. correction multiplicity;
14. reconciliation current-version ownership;
15. reconciliation version sequence;
16. reconciliation item sequence;
17. final signature/content parity;
18. unresolved critical issues;
19. source fingerprint parity;
20. foreign-key violations;
21. database integrity;
22. second-pass new business rows.

The receipt is persisted in `canonical_reconciliation_runs` with a deterministic evidence SHA-256 and the complete fixed check map.

## Verification

- `test/canonical/medication-administration-backfill-reconciliation.test.ts`: 2 tests passed.
- Eight persistent checkpoints completed in the bounded/resume test.
- Exact administration events created: 2 from eligible source rows.
- Schedule-only and ambiguous rows created no administration facts.
- Reconstructed reconciliation states: one draft, one final, and one cancelled.
- Second pass produced zero new administration events, reconciliations, versions, items, lifecycle events, mappings, or issues.
- Fixed twenty-two-check passing and failing receipts verified.
- `pnpm exec tsc --noEmit`: passed.

## Safety state

- no runtime route changes;
- no provider created or enabled;
- no production query or mutation;
- no production migration or backfill;
- no local sync activation;
- no push;
- no CDB-to-main integration;
- no legacy write freeze or retirement.
