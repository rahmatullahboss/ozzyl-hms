# P12 Canonical Radiology Acquisition and Report Backfill/Reconciliation Receipt

**Checkpoint:** `CDB-126D-CANONICAL-RADIOLOGY-ACQUISITION-REPORT-BACKFILL-RECONCILIATION-VERIFIED`

**Date:** 2026-07-28

**Status:** completed and verified locally; uncommitted because the active connector exposes no Git commit action

## Modules

- `scripts/canonical/backfill-radiology-acquisition-report.ts`
- `scripts/canonical/reconcile-radiology-acquisition-report.ts`
- `test/canonical/radiology-acquisition-report-backfill-reconciliation.test.ts`

## Ten persistent bounded/resumable partitions

1. requisition exact Canonical scope and unresolved disposition;
2. acquisition identity reconstruction;
3. acquisition lifecycle reconstruction;
4. exact DICOM Study identity and acquisition mapping;
5. Series/SOP hierarchy availability and missing-hierarchy disposition;
6. modality/PACS/storage provenance reconstruction;
7. report-set and complete immutable report-version reconstruction;
8. report verification/finalisation/publication/error lifecycle reconstruction;
9. RIS reconciliation queue disposition;
10. template, film, invoice, cache, and second-pass projection disposition.

Every partition uses `canonical_migration_runs` and `canonical_backfill_checkpoints`, persists an exact durable cursor and aggregate counts, accepts a caller-supplied source-record bound, resumes without restarting completed work, and leaves legacy source tables read-only.

## Backfill authority rules

- patient, encounter, request, event, service, practitioner, acquisition, study, report, and source identity require exact reviewed evidence;
- acquisition, study, provenance, and report business facts are written only through the CDB-126C atomic command boundary;
- accession, patient name, modality/time proximity, counts, R2 keys, report text, or suggested-match JSON never establish identity;
- Study Instance UID is accepted only from an exact source field;
- a study-only source never invents Series Instance UIDs or SOP Instance UIDs from `series_count` or `image_count`;
- R2 object keys without exact provider identity, generation, content hash, and object-level hierarchy remain projections;
- unresolved hierarchy, storage identity, performer, report scope, and RIS matching create deterministic non-PHI processing issues;
- report rendering, templates, printing, film usage, invoice rows, and delivery/cache data create no clinical acquisition or report fact;
- completed second pass creates zero new business rows, mappings, or issues.

## Fixed thirty-check reconciliation

The persisted `canonical_reconciliation_runs` receipt contains exactly thirty named checks:

1. source mapping ownership;
2. acquisition patient ownership;
3. acquisition encounter ownership;
4. acquisition request/event/service consistency;
5. acquisition current status-event ownership;
6. acquisition status-event sequence and current state;
7. acquisition performer/actor completeness;
8. study acquisition/patient/request ownership;
9. Study UID namespace uniqueness;
10. study accession/modality consistency;
11. Series study ownership and UID uniqueness;
12. Series status and instance-count projection;
13. instance Series/Study ownership;
14. SOP Instance UID and SOP Class uniqueness;
15. accepted instance hash/storage completeness;
16. provenance source identity/content-hash uniqueness;
17. provenance hierarchy ownership;
18. report-set patient/encounter/request/study ownership;
19. current report-version ownership;
20. report-version sequence contiguity;
21. report supersession scope and one-replacement rule;
22. report content completeness and hash validity;
23. report practitioner scope;
24. signed-content/content-hash parity;
25. report status-event sequence and current state;
26. correction/retraction/entered-in-error lineage;
27. unresolved critical processing issues;
28. source fingerprint parity;
29. foreign-key/integrity composite gate;
30. second-pass new business rows.

The receipt is replay-safe and persists deterministic evidence SHA-256, source fingerprints, integrity evidence, and second-pass evidence. Warning-level missing-hierarchy or projection issues remain visible without falsely failing a clean reconciliation; unresolved critical issues fail closed.

## Verification

- focused CDB-126D contract: 1 file, 2 tests passed;
- CDB-126A–D focused suite: 4 files, 22 tests passed;
- `pnpm exec tsc --noEmit`: passed;
- `pnpm build:migrations`: passed with 494 migrations;
- schema governance, program continuity, and worktree policy: 3 files, 21 tests passed.

## Safety state

- legacy source tables mutated: no;
- runtime routes changed: no;
- provider created or enabled: no;
- production query or mutation: no;
- production migration or backfill: no;
- local sync activated: no;
- push or main integration: no;
- legacy requisition/report/RIS/PACS/DICOM/storage history retired: no.

## Next checkpoint

`CDB-126E-CANONICAL-RADIOLOGY-ACQUISITION-REPORT-PROVIDER-READINESS`

Implement a disabled-safe legacy/shadow/canonical provider, four selected library adapters, complete writer/reader coverage, rollback evidence, and fail-closed local readiness. Runtime routes must not import the provider and route activation count must remain zero.
