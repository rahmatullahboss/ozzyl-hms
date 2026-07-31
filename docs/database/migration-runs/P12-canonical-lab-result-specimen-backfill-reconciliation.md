# P12 Canonical Lab Result and Specimen Backfill and Reconciliation Receipt

**Checkpoint:** `CDB-125D-CANONICAL-LAB-RESULT-SPECIMEN-BACKFILL-RECONCILIATION-VERIFIED`

**Date:** 2026-07-28

**Status:** completed and verified locally; uncommitted because the active connector exposes no Git commit action

## Implementation

- backfill: `scripts/canonical/backfill-lab-result-specimen.ts`
- reconciliation: `scripts/canonical/reconcile-lab-result-specimen.ts`
- verification contract: `test/canonical/lab-result-specimen-backfill-reconciliation.test.ts`

## Ten persistent bounded partitions

1. service request/event mapping and unresolved disposition;
2. specimen identity and initial current state;
3. exact specimen-to-service links;
4. immutable specimen custody events;
5. current result-set/version/observation reconstruction;
6. observation-audit and correction-lineage disposition;
7. verification, validation, publication, retraction, and error lifecycle;
8. exact analyzer provenance;
9. unmatched, collision, and workflow-only disposition;
10. duplicate mutable-cache, report-delivery, test, and visit-service projection disposition.

Every partition uses `canonical_migration_runs` and `canonical_backfill_checkpoints`, persists its cursor and counts, is caller bounded, and resumes from the exact durable cursor. Legacy laboratory and LIS source tables are read-only.

## Migration rules verified

- patient, encounter, request/event, service, practitioner, specimen, result, observation, and analyzer identities require exact reviewed mappings;
- accession, barcode, test/component name, result value, timestamp, machine code, and patient proximity do not create identity;
- exact specimen rows are registered through the CDB-125C command boundary;
- custody transitions are rebuilt only from explicit source events;
- result content is created as immutable complete versions with ordered observations;
- report verification/validation/publication binds exact active practitioners and the exact content SHA-256;
- accepted analyzer evidence requires exact result observation ownership and source payload SHA-256;
- legacy correction evidence without a complete replacement version becomes a deterministic review issue;
- unmatched analyzer rows, ingestion collisions, mutable result caches, report delivery, duplicate tests, and visit-service rows create no clinical fact;
- issue details are deterministic and exclude free-text notes, patient content, result values, specimen types, accessions, and barcodes;
- a completed replay creates zero new business rows, mappings, or issues.

## Fixed twenty-eight-check reconciliation

The persisted receipt checks:

1. source mapping ownership;
2. specimen patient/encounter ownership;
3. specimen primary request ownership;
4. specimen service-item consistency;
5. parent specimen scope;
6. specimen current event ownership;
7. specimen status/event consistency;
8. specimen event sequence;
9. specimen actor completeness;
10. result-set patient ownership;
11. result-set encounter ownership;
12. result-set request/event ownership;
13. result-set specimen/service consistency;
14. current result-version ownership;
15. result-version sequence;
16. result-version supersession;
17. observation sequence;
18. observation value completeness;
19. decimal TEXT validity;
20. observation unit/range/interpretation completeness;
21. practitioner/signature scope;
22. signed-content/content-hash parity;
23. result status-event/current-state consistency;
24. analyzer source/observation ownership;
25. unresolved critical processing issues;
26. source fingerprint parity;
27. foreign-key and integrity composite gate;
28. second-pass new business rows.

## Fresh verification

- bounded backfill and fixed reconciliation: 2 tests passed;
- ten persisted checkpoints completed;
- source snapshots remained unchanged;
- exact specimen state reached `received`, status version 3;
- exact result state reached `published`, status version 4;
- second completed pass created zero new business rows;
- fixed 28-check passed receipt persisted;
- fail-closed fingerprint, foreign-key, integrity, and second-pass evidence verified;
- CDB-125A–D combined focused suite: 4 files, 23 tests passed;
- `pnpm exec tsc --noEmit`: passed;
- `pnpm build:migrations`: passed with 493 migrations;
- schema governance: 14 tests passed;
- repository worktree policy: 3 tests passed.

## Safety state

- runtime routes changed: no;
- provider created or enabled: no;
- production query or mutation: no;
- production migration or backfill: no;
- local sync activation: no;
- push: no;
- CDB-to-main integration: no;
- legacy specimen, result, report, correction, LIS inbox, or analyzer history retirement: no.

## Next checkpoint

`CDB-125E-CANONICAL-LAB-RESULT-SPECIMEN-PROVIDER-READINESS`

Implement a disabled-safe provider, selected library adapters, complete writer/reader coverage, rollback contract, and fail-closed local readiness. Default and rollback mode remain `legacy`; runtime route activation remains zero.
