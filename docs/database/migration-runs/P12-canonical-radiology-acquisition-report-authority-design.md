# P12 Canonical Radiology Acquisition and Report Authority Design Receipt

**Checkpoint:** `CDB-126A-RADIOLOGY-ACQUISITION-REPORT-AUTHORITY-DESIGN-VERIFIED`

**Date:** 2026-07-28

**Status:** repository audit and design completed locally; schema and runtime implementation not started

## Design evidence

- audit: `docs/database/audits/2026-07-28-radiology-acquisition-report-authority-audit.md`
- specification: `docs/superpowers/specs/2026-07-28-cdb-126a-radiology-acquisition-report-authority-design.md`
- implementation plan: `docs/superpowers/plans/2026-07-28-cdb-126-radiology-acquisition-report-authority.md`
- design contract: `test/canonical/radiology-acquisition-report-authority-design-contract.test.ts`

## Authority decision

Existing `canonical_service_requests`, `canonical_service_events`, and `canonical_service_participants` remain the generic imaging-service intent, delivery, and practitioner-participation authorities. Existing Canonical patient links, encounters, practitioners, service catalog, financial assertions, bills, invoice items, and accounting boundaries remain reused. CDB-126 will not create another order, price, invoice, payment, patient, encounter, practitioner, or service authority.

The repository currently contains several overlapping or incomplete imaging sources:

- `radiology_requisitions` mixes request compatibility, worklist, scan, cancellation, billing, accession, film, and report flags;
- `radiology_reports` stores mutable report text, signatories JSON, final status, image references, print state, and soft deletion without immutable versions or signed content hashes;
- `radiology_dicom_studies` stores a study-only PACS cache with Study Instance UID, modality, counts, R2 key, source AE title, and optional requisition mapping but no Series Instance UID or SOP Instance UID authority;
- `ris_study_reconciliation_queue` stores ambiguous/suggested/manual matching workflow and PHI-bearing review data;
- `radiology_report_templates` stores rendering configuration, not clinical report authority;
- `radiology_film_usage`, print fields, image URLs, R2 keys, counts, and delivery state are operational projections;
- `invoice_items` and billing status are financial facts/projections, not acquisition, DICOM, or report authority;
- audit logs preserve some mutation evidence but are not contiguous database-enforced clinical lifecycle authority.

Every current radiology/RIS/PACS table remains a legacy compatibility source, workflow document, audit history, domain extension, duplicate authority, or projection. No existing table was declared Canonical acquisition, DICOM hierarchy, provenance, or report-version authority during this design checkpoint.

## Planned nine-table authority

target table count: 9

1. `canonical_imaging_acquisitions`
2. `canonical_imaging_acquisition_status_events`
3. `canonical_imaging_studies`
4. `canonical_imaging_series`
5. `canonical_imaging_instances`
6. `canonical_imaging_provenance_events`
7. `canonical_imaging_report_sets`
8. `canonical_imaging_report_versions`
9. `canonical_imaging_report_status_events`

The design separates:

- service request from acquisition/worklist execution;
- acquisition current projection from immutable status history;
- Study Instance UID, Series Instance UID, and SOP Instance UID identity levels;
- DICOM clinical identity from modality/PACS/storage transfer provenance;
- report aggregate/current pointer from immutable complete report versions;
- signed report lifecycle from report rendering, delivery, printing, film, billing, and image-display projections.

## Locked identity and immutability invariants

- exact tenant, patient link, encounter, request/event, service, practitioner, acquisition, study, series, instance, report, source, and storage ownership;
- Study Instance UID, Series Instance UID, and SOP Instance UID accepted only from exact validated source values and explicit UID namespaces;
- SOP Class UID stored and validated at the instance level;
- accession is an identifier/review aid, not identity proof;
- patient name, patient ID text, procedure name, modality, study date, description, timestamp, count, R2 key, report number, signatories JSON, report text, and similarity never create identity;
- acquisition status events are immutable, contiguous, and optimistic-versioned;
- completed acquisition requires exact performer and exact posted service event or a deterministic migration issue;
- study, series, and instance identities are immutable and hard-delete restricted;
- same SOP Instance UID plus same content SHA-256 is replay/duplicate evidence;
- same SOP Instance UID plus different content SHA-256 is collision or explicit replacement, never silent overwrite;
- accepted object content hash and storage reference/generation are immutable;
- provenance events preserve modality/device source, source AE title, called AE title, PACS endpoint, protocol, transfer syntax, message/log/storage source identity, object hash, disposition, actor, and time;
- raw DICOM pixel data and unrestricted payloads remain outside Canonical clinical tables and evidence receipts;
- report versions are complete, immutable, contiguous, and same-scope;
- correction creates a complete replacement version;
- one direct replacement is allowed per superseded report version unless a later branch-resolution design is approved;
- verification/finalisation/publication bind exact active practitioners and `signed_content_sha256 = content_sha256`;
- retraction and entered-in-error preserve all prior content, signatures, and lineage;
- report rendering and delivery are projections and cannot rewrite report content;
- no hard deletion of acquisition history, DICOM UID history, accepted storage provenance, report versions, signatures, corrections, retractions, or entered-in-error evidence.

## Planned command layer

planned command count: 16

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

Every command will be tenant-scoped, idempotent, replay-before-validation, exact-mapped, deterministic where source identity exists, PHI-minimised in outbox/receipts, and one D1 atomic batch with full rollback. No command may update a prior event, UID identity, accepted object hash/storage reference, report version, report content, signature, correction, retraction, or error record.

## Planned bounded migration

persistent backfill partition count: 10

1. requisition-to-service request/event mapping and unresolved disposition;
2. acquisition identity/current worklist state;
3. acquisition scan/unscan/cancel/error event reconstruction;
4. DICOM study identity and exact acquisition mapping;
5. series/instance/storage hierarchy and missing-evidence disposition;
6. modality/PACS/transfer/storage provenance and duplicate/collision disposition;
7. report-set/current complete report-version reconstruction;
8. signature/finalisation/correction/deletion/retraction/error lifecycle;
9. RIS study reconciliation queue and manual/suggested-match disposition;
10. template, print, delivery, film, invoice, image/count/cache projection disposition and second-pass proof.

Legacy source tables remain read-only. Missing exact identity or DICOM hierarchy produces deterministic non-PHI processing issues. Study-only rows never invent series or instances from counters. A completed second pass must create zero new business rows, mappings, or issues.

## Planned fixed reconciliation

persistent reconciliation check count: 30

The fixed receipt will check source mapping ownership; acquisition patient/encounter/request/event/service ownership; acquisition current event, sequence, state, performer, and actor completeness; study ownership and Study Instance UID uniqueness; accession/modality consistency; series ownership and Series Instance UID uniqueness; series status/count projections; instance hierarchy and SOP Instance/SOP Class uniqueness; accepted object content hash/storage completeness; provenance identity/hash uniqueness and scope; report patient/encounter/request/study ownership; current report version; version sequence and supersession; report content/hash completeness; author/verifier/finaliser practitioner scope; signed-content parity; report status events; correction/retraction/error lineage; critical issues; source fingerprints; foreign-key/integrity evidence; and second-pass business rows.

The `canonical_reconciliation_runs` receipt must persist exactly thirty named checks, deterministic evidence SHA-256, counts, source fingerprints, foreign-key/integrity proof, and second-pass evidence.

## Planned provider and readiness

Future provider flag: `canonical_radiology_acquisition_report_provider_v1`.

- supported modes: `legacy`, `shadow`, `canonical`;
- enabled by default: false;
- default mode: `legacy`;
- rollback mode: `legacy`;
- exact mapping required for Canonical and identity-sensitive reads;
- legacy/shadow preserve current legacy-facing output;
- shadow evidence aggregate and PHI-minimised;
- acquisition status history visible;
- exact study/series/instance hierarchy visible;
- modality/PACS/storage provenance visible without raw pixel data;
- report version/signature/correction/retraction/error history visible;
- report rendering, delivery, print, film, billing, and image URLs remain projections;
- runtime route activation remains zero until separately authorised.

## Writer and reader authority impact

Primary writers requiring later coverage include:

- `src/routes/tenant/radiology/orders.ts`
- `src/routes/tenant/radiology/reports.ts`
- `src/routes/tenant/radiology/pacs.ts`
- `src/lib/radiology-cancellation.ts`
- `src/lib/canonical/radiology-order-billing.ts`
- `src/lib/canonical/patient-chart-radiology-billing.ts`
- related catalog, film, monitoring, and compatibility writers.

Primary readers requiring later coverage include radiology order/report/PACS routes, patient chart/timeline, nursing investigation results, doctors, monitoring, executive KPIs, diagnostic reserve, billing refund, and cancellation paths. No current runtime path is authorised to import a future provider during design or schema checkpoints.

## Next checkpoint

`CDB-126B-CANONICAL-RADIOLOGY-ACQUISITION-REPORT-SCHEMA`

Revalidate migration number `0559`, write failing SQLite schema tests first, then create one additive migration and one dedicated Canonical Drizzle module for the nine table families. Register the tables in Canonical source-of-truth governance. Do not wire routes, create/enable providers, query or mutate production, apply production migration/backfill, or retire legacy tables.

## Safety state

- migration `0559` created: no;
- Drizzle schema created: no;
- command module created: no;
- provider or adapter created: no;
- runtime routes changed: no;
- production query performed: no;
- production mutation performed: no;
- production migration/backfill applied: no;
- local sync activated: no;
- push performed: no;
- CDB-to-main integration performed: no;
- legacy writer freeze or retirement: no.

The active connector exposes no Git commit action. This design checkpoint remains verified-uncommitted with every existing dirty change preserved.
