# CDB-126 Radiology Acquisition and Report Authority Implementation Plan

Program: HMS Canonical Data Architecture
Date: 2026-07-28
Current phase: CDB-126A design only
Production mutation authorised: no

## Goal

Implement one local Canonical imaging domain extension for acquisition/worklist lifecycle, DICOM study/series/instance identity, immutable modality/PACS/storage provenance, and immutable signed report versions while reusing existing Canonical patient, encounter, practitioner, service catalog, service request, service event, and participant authorities.

## Checkpoint sequence

### CDB-126A — authority audit and design

Deliver the repository audit, authority specification, implementation plan, design receipt, design contract, authority-matrix update, tracker update, control-centre update, and current-plan handoff. Do not create migration `0559`, Drizzle schema, command module, provider, adapter, runtime route change, production query, or production mutation.

### CDB-126B — additive schema

Create `migrations/0559_canonical_radiology_acquisition_report.sql` and `src/db/schema/canonical/radiology-acquisition-report.ts`. Export the module from the Canonical barrel and register all nine tables in `docs/database/canonical-source-of-truth.yaml`.

Nine table families:

1. `canonical_imaging_acquisitions`
2. `canonical_imaging_acquisition_status_events`
3. `canonical_imaging_studies`
4. `canonical_imaging_series`
5. `canonical_imaging_instances`
6. `canonical_imaging_provenance_events`
7. `canonical_imaging_report_sets`
8. `canonical_imaging_report_versions`
9. `canonical_imaging_report_status_events`

Schema tests must prove:

- exact tenant, patient-link, encounter, request/event, service, acquisition, study, series, instance, report, and practitioner scope;
- accession namespaced uniqueness without treating accession as identity proof;
- Study Instance UID, Series Instance UID, and SOP Instance UID uniqueness in declared namespaces;
- SOP Class UID stored at instance level;
- same-scope DICOM hierarchy and no self/cross-tenant references;
- immutable acquisition and report status events;
- immutable provenance, storage hashes, accepted object references, versions, content, signatures, corrections, retractions, and entered-in-error evidence;
- optimistic current pointers and contiguous event/version sequences;
- one direct replacement per superseded report version;
- signed-content/content-hash parity;
- collision versus duplicate semantics for same SOP Instance UID;
- raw DICOM pixel data and unrestricted payloads absent from Canonical clinical tables;
- hard-delete restrictions.

### CDB-126C — atomic command layer

Implement sixteen atomic idempotent commands in `src/lib/canonical/commands/manage-radiology-acquisition-report.ts`.

#### Sixteen atomic commands

1. `registerCanonicalImagingAcquisition`
2. `startCanonicalImagingAcquisition`
3. `completeCanonicalImagingAcquisition`
4. `cancelCanonicalImagingAcquisition`
5. `enterCanonicalImagingAcquisitionInError`
6. `registerCanonicalImagingStudy`
7. `registerCanonicalImagingSeries`
8. `registerCanonicalImagingInstance`
9. `recordCanonicalImagingProvenance`
10. `createCanonicalImagingReportDraft`
11. `replaceCanonicalImagingReportDraft`
12. `verifyCanonicalImagingReportVersion`
13. `finalizeAndPublishCanonicalImagingReportVersion`
14. `correctCanonicalImagingReportVersion`
15. `retractCanonicalImagingReportVersion`
16. `enterCanonicalImagingReportInError`

Every command must:

- normalise tenant, exact public IDs, UID namespaces/values, accession namespace/value, modality, UTC, business date, actors, statuses, hashes, storage references, and controlled codes;
- create deterministic IDs only from explicit tenant/source identities;
- calculate the complete operation fingerprint before mutable-state validation;
- read replay before checking current status/version;
- reject the same idempotency key with a changed fingerprint;
- validate exact patient link, encounter, service request/event, service, practitioner, acquisition, DICOM hierarchy, report, source, and storage ownership;
- prohibit patient-name, procedure-name, modality/time, accession, description, count, R2-key, or text-similarity matching from creating identity;
- write compatibility statements, Canonical facts, source mappings, command receipt, and PHI-minimised outbox in one D1 batch;
- roll back the entire operation on any failure;
- never update a prior status event, provenance event, accepted instance identity/hash, report version, report content, signature, correction, retraction, or error record.

Command details:

- registration creates the acquisition identity and initial immutable status event;
- start/complete/cancel/error use optimistic acquisition status version and exact actor;
- completion requires the exact posted service event and performer or fails closed;
- study registration requires exact Study Instance UID and same-scope acquisition;
- series registration requires exact Series Instance UID and same-scope study;
- instance registration requires exact SOP Instance UID, SOP Class UID, content SHA-256, and series/study scope;
- same SOP UID plus same hash is replay/duplicate evidence; same UID plus changed hash is collision or explicit replacement, never overwrite;
- provenance records exact modality, source AE title, called AE title, PACS endpoint, message/log/storage source, protocol, transfer syntax, content hash, storage generation, disposition, and reason;
- report draft creates report set, first complete immutable version, initial status event, current pointers, mapping, receipt, and outbox atomically;
- draft replacement and correction create complete replacement versions;
- verification binds exact active practitioner and signed hash;
- finalisation/publication advances the same exact signed version without changing content;
- retraction and entered-in-error preserve all prior versions/signatures and require reasons.

### CDB-126D — bounded backfill and reconciliation

Implement:

- `scripts/canonical/backfill-radiology-acquisition-report.ts`
- `scripts/canonical/reconcile-radiology-acquisition-report.ts`

#### Ten persistent bounded/resumable backfill partitions

1. exact requisition to Canonical service-request/event/service/patient/encounter mapping and unresolved disposition;
2. acquisition identity and current worklist/scan state reconstruction from `radiology_requisitions`;
3. acquisition status-event reconstruction from scan, unscan, cancellation, audit, and completion evidence;
4. DICOM study identity and exact requisition/acquisition mapping from `radiology_dicom_studies`;
5. series, SOP instance, object hash, R2/storage, source AE, modality, and missing-hierarchy disposition;
6. immutable modality/PACS/transfer/storage provenance reconstruction and duplicate/collision disposition;
7. report-set and complete current report-version reconstruction from `radiology_reports`;
8. report verification/finalisation/signature/correction/deletion/retraction/error lifecycle reconstruction;
9. `ris_study_reconciliation_queue` unresolved, suggested, resolved, patient/modality/accession mismatch, and manual-mapping disposition;
10. template, print, delivery, film, invoice, image-count, study-count, requisition cache, report cache, and second-pass projection disposition.

Partition requirements:

- use `canonical_migration_runs` and `canonical_backfill_checkpoints`;
- persist source type, partition key, cursor, scanned/created/mapped/skipped/issue counts, status, and non-PHI errors;
- caller sets maximum source records;
- resume from the exact durable cursor;
- legacy source tables remain read-only;
- exact reviewed mappings are mandatory;
- Study/Series/SOP UIDs are accepted only from exact source fields and validated namespaces;
- a study-only source never invents series or instances from counters;
- image/series counts, R2 keys, accession, patient name, modality/time, report text, and suggested match JSON never establish identity;
- ambiguous/missing hierarchy creates deterministic non-PHI processing issues;
- report delivery, printing, film usage, invoice, and notification rows create no clinical acquisition/report fact;
- completed second pass creates zero new business rows, mappings, or issues.

#### Fixed thirty-check reconciliation

1. source mapping ownership;
2. acquisition patient ownership;
3. acquisition encounter ownership;
4. acquisition request/event/service consistency;
5. acquisition current status-event ownership;
6. acquisition status-event sequence and current state;
7. acquisition performer/actor completeness;
8. study acquisition/patient/request ownership;
9. Study Instance UID namespace uniqueness;
10. study accession and modality consistency;
11. series study ownership and Series Instance UID uniqueness;
12. series status and instance-count projection consistency;
13. instance series/study ownership;
14. SOP Instance UID and SOP Class UID uniqueness;
15. accepted instance content-hash/storage completeness;
16. provenance source identity and content-hash uniqueness;
17. provenance acquisition/study/series/instance ownership;
18. report-set patient/encounter/request/study ownership;
19. current report-version ownership;
20. report-version sequence contiguity;
21. report supersession same-scope and one-replacement rule;
22. report content completeness and content-hash validity;
23. report author/verifier/finaliser practitioner scope;
24. signed-content/content-hash parity;
25. report status-event sequence and current-state consistency;
26. correction/retraction/entered-in-error lineage;
27. unresolved critical processing issues;
28. source fingerprint parity;
29. foreign-key and database-integrity composite gate;
30. second-pass new business rows.

The persisted `canonical_reconciliation_runs` receipt must contain exactly thirty named checks, counts, status, deterministic evidence SHA-256, source fingerprints, foreign-key/integrity proof, and second-pass evidence.

### CDB-126E — provider, selected adapters, coverage, rollback, and readiness

Implement disabled-safe provider flag `canonical_radiology_acquisition_report_provider_v1`.

Modes:

- `legacy`
- `shadow`
- `canonical`

Configuration:

- enabled by default: false;
- default mode: `legacy`;
- rollback mode: `legacy`.

Provider behaviour:

- absent, disabled, or unsupported configuration resolves to legacy;
- legacy preserves current requisition/report/PACS-facing output;
- shadow preserves legacy-facing output and emits aggregate PHI-minimised parity only;
- canonical requires exact source mapping and fails closed;
- identity-sensitive reads require exact mapping even in legacy/shadow mode;
- acquisition current state and full immutable status history remain visible;
- exact study/series/instance hierarchy remains visible;
- provenance includes modality/AE/PACS/storage/source hashes but not raw DICOM pixel data;
- report current version, complete version lineage, signed status history, corrections, retractions, and entered-in-error history remain visible;
- report rendering, delivery, print, film, billing, and image URLs remain projections.

Initial selected library adapters should cover:

- acquisition/worklist detail;
- PACS study hierarchy/provenance detail;
- patient/timeline imaging result;
- report summary/rendering input.

No runtime route may import the provider during CDB-126E. Coverage must enumerate all direct writers/readers, classify every known path as selected adapter or `legacy_unchanged`, require unknown assignments zero, and keep route activation zero.

Readiness must fail closed if schema, commands, bounded backfill, fixed reconciliation, provider, coverage, exact mapping, UID hierarchy, provenance hashes, signature history, correction lineage, PHI minimisation, or rollback evidence is missing; if route activation is nonzero; if production claims are overstated; or if production/retirement gates are not blocked.

## Database design details

### Acquisition transitions

- initial `scheduled` or `ready` event version 1;
- scheduled to ready, cancelled, or entered_in_error;
- ready to in_progress, cancelled, or entered_in_error;
- in_progress to completed, cancelled only under explicit policy, corrected, or entered_in_error;
- completed is terminal for the acquisition fact except explicit correction/entered-in-error evidence;
- cancellation and error require reason and actor;
- unscan is never a silent reset; it becomes correction or entered-in-error evidence.

### DICOM hierarchy

- Study Instance UID identifies one study;
- Series Instance UID identifies one series inside the study;
- SOP Instance UID plus SOP Class UID identifies one DICOM object instance;
- content SHA-256 identifies the exact accepted object bytes;
- storage provider/key/generation identifies the accepted storage object/version;
- counts are projections derived from exact rows;
- missing series/instance evidence is a migration issue, not inferred from counters.

### Duplicate and collision policy

- same exact source message and fingerprint is replay;
- same SOP Instance UID and same content SHA-256 may be recorded as duplicate provenance without creating a second authority row;
- same SOP Instance UID and changed content SHA-256 is collision unless an explicit authorised replacement points to the prior accepted instance/version;
- Study/Series UID reuse across mismatched patient/request scope is a critical processing issue;
- R2 key overwrite is prohibited; storage generations/replacements are immutable provenance.

### Report transitions

- report set starts draft with version/status event 1;
- draft replacement creates complete version 2+;
- verification binds verifier and signed hash;
- finalisation/publication binds finaliser/approver and same signed content;
- correction creates a complete replacement version and returns to controlled review state;
- retraction and entered-in-error preserve all prior versions;
- delivery/print changes no clinical content;
- soft deletion of a report is not retirement evidence and must be migrated as retraction/error/review disposition.

### Signature and content rules

The content SHA-256 is calculated from deterministic canonical report content, including complete findings/impression/technique/comparison/recommendations and controlled metadata. Signed states require `signed_content_sha256 = content_sha256`. Any clinical content change creates a new version and cannot reuse a prior-current signature.

### Provenance and PHI rules

Canonical provenance may store exact UID, protocol, AE title, endpoint source identity, object hash, storage key/reference, transfer syntax, byte size, frame count, disposition, actor, and time. Raw DICOM pixel data, unrestricted DICOM payloads, patient-name payloads, report text, and image URLs are excluded from outbox, readiness, and aggregate shadow evidence.

## Verification sequence

For every implementation checkpoint:

1. write failing tests first;
2. observe RED for the intended missing behaviour;
3. implement the minimum authority-preserving change;
4. run focused tests;
5. run TypeScript;
6. run migration manifest and schema governance where schema changes exist;
7. run continuity and worktree-policy gates;
8. update receipts, authority matrix, tracker, control centre, and current plan only after fresh green evidence.

## Prohibited actions

Until separately authorised:

- do not query or mutate production;
- do not apply production schema or backfill;
- do not enable provider flags;
- do not wire runtime routes;
- do not freeze legacy writers;
- do not activate local sync;
- do not push or integrate to main;
- do not delete, rewrite, or retire requisition, report, DICOM UID, storage, PACS, correction, signature, or audit history;
- do not claim production readiness from local tests.
