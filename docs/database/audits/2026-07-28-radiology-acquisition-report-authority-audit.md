# Radiology Acquisition, Report, and PACS Authority Audit

Date: 2026-07-28
Checkpoint: CDB-126A
Scope: repository-only design audit; no production query, mutation, migration, backfill, route cutover, or provider activation

## Executive finding

The HMS repository already has a stronger Canonical boundary for radiology service ordering and billing than it has for imaging execution and clinical interpretation. `canonical_service_requests`, `canonical_service_events`, and `canonical_service_participants` are the existing authorities for requested work, delivered service events, and typed practitioner participation. The strict radiology billing paths also connect requisitions, bills, invoice items, service mappings, and financial assertions. CDB-126 must reuse those authorities and must not create another radiology order, price, invoice, or payment authority.

The remaining imaging lifecycle is fragmented across mutable requisition rows, mutable report rows, a study-only DICOM cache, reconciliation workflow documents, R2 object references, audit logs, templates, film usage, print counters, and downstream projections. No current radiology table is a complete authority for acquisition status history, DICOM study/series/instance identity, immutable PACS provenance, report versions, signed content, corrections, retractions, or entered-in-error evidence.

Every source below remains a legacy compatibility source, workflow document, audit history, domain extension, duplicate authority, or projection until a separately authorised migration and cutover. A table is not Canonical authority merely because it stores a Study Instance UID, accession number, final status, signatory JSON, image count, or R2 key.

## Existing service-order and billing boundary

`src/routes/tenant/radiology/orders.ts`, `src/lib/canonical/radiology-order-billing.ts`, and `src/lib/canonical/patient-chart-radiology-billing.ts` create or reconcile `radiology_requisitions`, bills, invoice items, service catalog mappings, and financial assertions. The strict paths use an atomic financial/request boundary and source mappings. These paths prove that generic service intent and billing should remain outside the new imaging domain extension.

`radiology_requisitions` still mixes service-order compatibility fields with imaging execution status. Its patient, visit/admission, imaging item, prescriber, date, urgency, ward, accession, bill, billing status, film, scan, report, cancellation, and soft-delete fields represent several different authorities. The row is therefore an operational legacy compatibility source, not a future Canonical acquisition or report authority.

`invoice_items` is a billing line authority/projection linked to a requisition. It must remain outside imaging clinical authority. A paid invoice does not prove acquisition, a scan, an image, a report, a signature, or a PACS transfer.

## Acquisition and worklist state

### `radiology_requisitions`

The requisition row carries mutable `order_status`, `is_scanned`, `scanned_by`, `scanned_on`, `is_report_saved`, cancellation fields, accession, billing fields, procedure code, imaging item snapshots, and film state. `src/routes/tenant/radiology/orders.ts` marks a requisition scanned by updating the row. The unscan path rewrites the same fields back to pending. Cancellation paths in `src/lib/radiology-cancellation.ts` and route code mutate status, billing status, remarks, and active state. These writes are not one immutable acquisition lifecycle.

Scan completion is not atomically linked to an exact Canonical service event, exact practitioner, modality, device, worklist item, study UID, series UID, instance UID, storage receipt, or provenance event. Unscan removes current scan state rather than creating a correction or entered-in-error event. Audit logs are useful evidence, but they are not a database-enforced contiguous clinical state history.

There is no dedicated modality worklist authority. Requisition fields are used as both order compatibility and operational worklist state. CDB-126 must separate the existing Canonical service request from an imaging acquisition aggregate and immutable acquisition status events.

### Cancellation and refunds

`src/lib/radiology-cancellation.ts` guards cancellation after selected statuses, but it still mutates the requisition and writes an audit log separately. The route does not create an immutable acquisition cancellation event linked to the exact current version. Billing cancellation and clinical acquisition cancellation are related but not the same fact. CDB-126 must not let a refund workflow silently become imaging acquisition authority.

## DICOM and PACS sources

### `radiology_dicom_studies`

The current table stores patient ID/name, Study Instance UID, one SOP Class UID field, study date, modality, study description, requisition mapping, series/image counts, R2 key, source AE title, active state, and timestamps. It is a study-level operational cache and compatibility source. It does not model Series Instance UID rows or SOP Instance UID rows. A study-level SOP Class UID cannot replace instance-level SOP Class evidence.

`src/routes/tenant/radiology/pacs.ts` accepts forwarded image metadata and R2 object information. When a Study Instance UID already exists, it mutates `r2_key`, source AE title, and image count. This means repeated forwards overwrite current storage reference and increment counters without immutable per-instance identity or transfer provenance. A duplicate forward can therefore change current state without proving whether the object is a duplicate SOP instance, a new instance, a replacement object, or a collision.

The same route attempts accession-based mapping to `radiology_requisitions`. Study insertion and later mapping are separate writes. Manual mapping similarly updates the DICOM study independently. Study deletion soft-deactivates the row. There is no immutable PACS ingest, storage, transfer, collision, mapping, retraction, or entered-in-error event sequence.

### Missing DICOM hierarchy

No reviewed table provides complete Canonical authority for:

- exact Study Instance UID identity;
- exact Series Instance UID identity within one study;
- exact SOP Instance UID identity within one series;
- SOP Class UID per instance;
- transfer syntax, frame count, object content hash, byte size, storage generation, or immutable storage reference;
- modality device identity, source AE title, called AE title, bridge/agent identity, PACS endpoint, or transfer receipt;
- one accepted storage object per exact source instance and content hash;
- immutable replacement, collision, deletion, retraction, and entered-in-error provenance.

Raw DICOM pixel data must remain in governed object/PACS storage. The Canonical database should retain exact UIDs, content hashes, source/storage references, device/endpoint identity, controlled transfer disposition, and immutable provenance. It must not copy unrestricted pixel data or patient-name payloads into Canonical outbox, reconciliation, or readiness evidence.

### `ris_study_reconciliation_queue`

The reconciliation queue stores requisition/study links, accession, Study Instance UID, patient ID/name, modality, issue type, suggested match JSON, resolution state, actor, and notes. It is a workflow document for ambiguity and manual review, not acquisition or study authority. Accession, patient name, modality, date, and suggested-match similarity can support review but cannot establish identity without an exact approved mapping.

## Report sources

### `radiology_reports`

The report row contains requisition, patient/visit, imaging type/item snapshots, prescriber, performer, template, mutable `report_text`, indication, radiology number, image references, patient-study ID, signatories JSON, mutable order status, active state, and timestamps. `src/routes/tenant/radiology/reports.ts` creates one mutable row, updates report fields in place, flips the status to final, and soft-deletes the report. It also mutates the requisition report flags separately.

There is no complete immutable report version, no database-enforced version sequence, no supersession rule, no content SHA-256, no signed content SHA-256, no exact active reporter/verifier/approver scope, and no immutable correction, retraction, or entered-in-error lifecycle. `signatories` JSON is a presentation/workflow snapshot, not a cryptographic or database-enforced signature contract.

Finalization only changes `order_status` to final. It does not bind an exact practitioner and signed hash to one exact immutable report content version. Updating a pending report rewrites clinical text. Soft deletion removes the active projection without creating a replacement, retraction, or error version.

### Templates, printing, film, and image display

`radiology_report_templates` is rendering/template configuration. It must never become report-content authority. `radiology_film_types`, `radiology_film_usage`, printed flags, print counts, and delivery state are operational or billing projections. R2 image keys and display URLs are storage/display references, not acquisition or report authority. Report rendering and delivery are projections derived from immutable report versions and status, not clinical facts that may rewrite content.

## Writer inventory

Primary high-risk direct writers reviewed:

- `src/routes/tenant/radiology/orders.ts`
- `src/routes/tenant/radiology/reports.ts`
- `src/routes/tenant/radiology/pacs.ts`
- `src/lib/radiology-cancellation.ts`
- `src/lib/canonical/radiology-order-billing.ts`
- `src/lib/canonical/patient-chart-radiology-billing.ts`

Additional related writers and projection writers include:

- `src/routes/tenant/labMonitoring.ts` for film usage and requisition film flags;
- `src/routes/tenant/radiology/catalog.ts` for imaging catalog, templates, and film types;
- `src/lib/diagnostic-catalog.ts` for catalog compatibility;
- `src/routes/tenant/lab.ts` for imaging item compatibility updates;
- billing/refund paths that read or mutate requisition cancellation state.

Catalog and financial writers are separate governed authorities. CDB-126 must reference them, not duplicate them.

## Reader inventory

Major read consumers reviewed or discovered:

- `src/routes/tenant/radiology/orders.ts`
- `src/routes/tenant/radiology/reports.ts`
- `src/routes/tenant/radiology/pacs.ts`
- `src/routes/tenant/radiology/catalog.ts`
- `src/routes/tenant/patients-chart.ts`
- `src/routes/tenant/patients-timeline.ts`
- `src/routes/tenant/nursing/investigation-results.ts`
- `src/routes/tenant/doctors.ts`
- `src/lib/executive-inventory-kpis.ts`
- `src/routes/tenant/labMonitoring.ts`
- `src/lib/diagnostic-performer-reserve.ts`
- billing refund and cancellation services.

These readers often infer current acquisition/report state from mutable requisition/report rows. PACS readers infer image counts and mapping from the study cache. Provider promotion must be explicit; no reader is safe merely because it is read-only.

## Duplicate and projection classification

- `radiology_requisitions`: operational legacy compatibility source mixing request, acquisition, billing, cancellation, and projection state.
- `radiology_reports`: mutable operational report source, not version authority.
- `radiology_dicom_studies`: study/PACS compatibility cache and incomplete domain extension.
- `ris_study_reconciliation_queue`: workflow document.
- `radiology_report_templates`: rendering configuration.
- `radiology_film_usage` and film fields: workflow/billing projection.
- `invoice_items`: billing authority/projection, not imaging authority.
- report print/delivery fields: projection.
- R2 keys and URLs: storage references, not DICOM instance identity.
- audit logs: audit history, not the current clinical fact.

## Required authority split

CDB-126 must add nine imaging domain-extension table families keyed to existing Canonical identities:

1. `canonical_imaging_acquisitions` — one current acquisition/worklist aggregate linked to an exact service request/event.
2. `canonical_imaging_acquisition_status_events` — immutable scheduled, started, completed, cancelled, corrected, and entered-in-error lifecycle.
3. `canonical_imaging_studies` — exact Study Instance UID identity and current study/storage status.
4. `canonical_imaging_series` — exact Series Instance UID identity within one study.
5. `canonical_imaging_instances` — exact SOP Instance UID and SOP Class UID identity within one series.
6. `canonical_imaging_provenance_events` — immutable modality, AE, PACS endpoint, transfer, ingest, storage, collision, replacement, and error evidence.
7. `canonical_imaging_report_sets` — one current report aggregate linked to exact acquisition/study/request/patient/encounter.
8. `canonical_imaging_report_versions` — immutable complete findings/impression/report versions with content and signed hashes.
9. `canonical_imaging_report_status_events` — immutable draft, verified, final, published, corrected, retracted, and entered-in-error lifecycle.

`canonical_service_requests`, `canonical_service_events`, and `canonical_service_participants` remain the generic service intent, delivery, ordering, performing, reporting, and approving authorities. Patient links, encounters, practitioners, and service catalog remain reused identities.

## Identity policy

An exact reviewed mapping is mandatory for patient, encounter, service request/event, service, practitioner, acquisition, study, series, instance, report, and source/storage identities. Study Instance UID, Series Instance UID, and SOP Instance UID are exact DICOM identifiers when their source namespace and tenant ownership are validated. Accession, patient name, patient ID text, modality, study date, description, timestamp, procedure name, image count, R2 key, and similarity are not sufficient to establish identity by themselves.

A source collision, UID reuse, accession ambiguity, patient mismatch, modality mismatch, missing practitioner, missing series/instance evidence, or storage hash mismatch must create a deterministic non-PHI processing issue. It must never silently overwrite a Canonical fact.

## Safety conclusion

CDB-126A is design-only. No migration `0559`, Drizzle module, command module, provider, adapter, runtime route change, production query/mutation, production migration/backfill, local sync activation, push, integration, writer freeze, or retirement is authorised.

All current radiology, RIS, PACS, report, film, template, billing, and reconciliation sources remain active legacy compatibility or governed external sources until additive schema, atomic commands, bounded backfill, fixed reconciliation, disabled-safe provider, coverage, observation, rollback evidence, and exact owner authorisation are complete.
