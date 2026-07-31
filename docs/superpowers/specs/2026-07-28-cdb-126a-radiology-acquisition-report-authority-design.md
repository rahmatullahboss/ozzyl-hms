# CDB-126A Radiology Acquisition and Report Authority Design

Status: design-verified target after contract completion; implementation not yet authorised
Date: 2026-07-28

## Purpose

Define one Canonical radiology domain extension for imaging acquisition/worklist state, DICOM study/series/instance identity, immutable modality/PACS/storage provenance, and immutable report versions with practitioner signatures, corrections, retractions, and entered-in-error history. Existing `canonical_service_requests`, `canonical_service_events`, and `canonical_service_participants` remain the authorities for requested service work, delivered service events, and ordering/performing/reporting/approving practitioner participation.

## Non-goals

CDB-126 does not create another radiology-order authority, service catalog, price, invoice, payment, patient, encounter, practitioner, device inventory, object-storage engine, PACS server, DICOM viewer, report renderer, print workflow, film inventory, or notification-delivery authority. CDB-126A creates no migration, schema module, command module, provider, adapter, route change, production query, or production mutation.

## Core authority rules

1. Every acquisition belongs to one tenant, one exact patient link, one exact encounter, one exact service request, and one exact imaging service.
2. A completed acquisition may reference one exact posted Canonical service event; completion does not create a second service-delivery authority.
3. Ordering, performing, reporting, verifying, and approving practitioners resolve through exact Canonical practitioner identities and typed participant roles.
4. Acquisition/worklist status is separate from service-request status, billing status, report status, and PACS storage status.
5. Study, series, and instance are separate DICOM identity levels.
6. Study Instance UID, Series Instance UID, and SOP Instance UID must be exact values in explicit UID namespaces and tenant scope.
7. accession is an identifier and review aid, not patient, request, study, series, instance, or report identity proof by itself.
8. Patient name, patient ID text, procedure name, modality, description, timestamp, image count, R2 key, and similarity never establish identity.
9. Raw DICOM pixel data remains in governed PACS/object storage. Canonical stores exact identifiers, hashes, source/storage references, and provenance only.
10. Acquisition status events, provenance events, report versions, and report status events are immutable and undeletable.
11. Repeated DICOM forwarding never overwrites accepted instance or storage evidence; duplicate, replacement, and collision are explicit dispositions.
12. A report update creates a complete replacement version; it never overwrites a prior clinical text version.
13. correction creates a complete replacement version and exact supersession lineage.
14. retraction and entered-in-error preserve every prior report version and signature.
15. Verification/finalisation/publication bind one exact active practitioner and signed content SHA-256 to one exact immutable version.
16. report rendering and delivery are projections and never rewrite clinical content.
17. Every command is tenant-scoped, idempotent, replay-safe, and committed in one D1 batch.
18. Replay is read before mutable current-state validation.
19. Source mapping, compatibility statements, Canonical facts, command receipt, and PHI-minimised outbox commit or roll back together.
20. Legacy sources remain read-only during backfill.

## Existing authority reused

### Service request, delivery, and participants

- `canonical_service_requests` owns the ordered/planned imaging service.
- `canonical_service_events` owns accepted/delivered/completed service occurrences.
- `canonical_service_participants` owns typed ordering, performing, reporting, and approving practitioner relationships when an exact request or event exists.

CDB-126 tables may reference exact request/event identifiers but may not duplicate requested quantity, fulfilled quantity, service price, invoice status, payment status, or accounting state.

### Identity

- `canonical_tenant_patient_links` owns the tenant-patient relationship.
- `canonical_encounters` owns the care encounter.
- `canonical_practitioners` owns clinical actors.
- `canonical_service_catalog_items` owns the imaging service.

Modality/device/PACS endpoint identity remains source-governed initially. Canonical provenance stores exact source identities and hashes until a future equipment/network authority is approved.

## Nine Canonical table families

### 1. `canonical_imaging_acquisitions`

Purpose: one current imaging acquisition/worklist aggregate linked to the existing service request.

Required fields:

- tenant and acquisition public ID;
- exact patient link and encounter;
- exact service request and service public IDs;
- optional completed service event public ID;
- accession namespace/value;
- modality code and optional body-site/procedure snapshots;
- current status, status version, and current status-event public ID;
- scheduling/requested, started, completed, cancelled, and entered-in-error current projection timestamps;
- performing practitioner current pointer where exact;
- source evidence SHA-256, request fingerprint, idempotency key, actor, created/updated UTC.

Controlled statuses include `scheduled`, `ready`, `in_progress`, `completed`, `cancelled`, and `entered_in_error`.

Constraints:

- unique tenant/acquisition public ID;
- accession uniqueness only inside an explicit namespace;
- exact patient/encounter/request/service consistency;
- optional service event must belong to the same request, encounter, and service;
- current status changes only through matching immutable event and optimistic status-version increment;
- identity and request scope immutable;
- hard delete restricted.

### 2. `canonical_imaging_acquisition_status_events`

Purpose: immutable worklist/acquisition lifecycle.

Fields:

- event public ID, acquisition public ID, event version;
- from/to status and controlled event type;
- performing/recording practitioner, user, or system actor;
- modality/device/PACS source identity pairs where relevant;
- occurred/recorded UTC;
- reason code, source evidence SHA-256, created UTC.

Event types include `registered`, `ready`, `started`, `completed`, `cancelled`, `corrected`, and `entered_in_error`.

Rules:

- event version unique and contiguous per acquisition;
- first event registers the acquisition;
- current acquisition status must match the latest accepted event;
- completed requires an exact performer and posted service event or a deterministic issue during backfill;
- cancellation/error requires a reason;
- prior events are immutable and undeletable.

### 3. `canonical_imaging_studies`

Purpose: exact DICOM Study Instance UID identity and study-level current status/storage projection.

Fields:

- study public ID;
- acquisition, patient link, encounter, request, service public IDs;
- Study Instance UID namespace/value;
- accession namespace/value snapshot/check;
- modality code and study date/time;
- current status and status version;
- current accepted provenance event public ID;
- series/instance count projections;
- source evidence, request fingerprint, idempotency key, created/updated UTC.

Rules:

- Study Instance UID is unique per tenant and declared UID namespace;
- study must be same patient/encounter/request/service as acquisition;
- accession mismatch never remaps automatically;
- modality mismatch creates a processing issue;
- current counts are projections derived from series/instance authority;
- identity and UID immutable;
- hard delete restricted; replacement/error uses provenance/status evidence.

### 4. `canonical_imaging_series`

Purpose: exact DICOM Series Instance UID identity within one study.

Fields:

- series public ID, study public ID;
- Series Instance UID namespace/value;
- series number as canonical integer/text snapshot;
- modality, body part, protocol name, laterality, description snapshots;
- current status, instance-count projection;
- source evidence and created/updated UTC.

Rules:

- unique Series Instance UID in tenant namespace;
- same acquisition/patient/request scope inherited through study;
- series number and description do not establish identity;
- identity/UID immutable;
- no hard delete; entered-in-error is explicit.

### 5. `canonical_imaging_instances`

Purpose: exact SOP Instance UID and SOP Class UID identity within one series.

Fields:

- instance public ID, study and series public IDs;
- SOP Instance UID namespace/value;
- SOP Class UID;
- instance number, frame count, transfer syntax UID;
- object content SHA-256, byte size;
- accepted storage provider/source type/public ID, object key/reference, storage generation/version;
- current disposition: staged, accepted, duplicate, replaced, rejected, collision, retracted, entered_in_error;
- source evidence and created UTC.

Rules:

- one exact SOP Instance UID per tenant namespace and study hierarchy;
- SOP Class UID belongs at instance level;
- accepted content SHA-256 and storage reference are immutable;
- same SOP Instance UID plus same content hash may be idempotent duplicate evidence;
- same SOP Instance UID plus different content hash is a collision or explicit replacement workflow, never silent overwrite;
- raw DICOM pixel data is not stored in this table;
- hard delete restricted.

### 6. `canonical_imaging_provenance_events`

Purpose: immutable source, transfer, ingest, mapping, storage, collision, replacement, retraction, and error evidence.

Fields:

- provenance event public ID;
- optional acquisition/study/series/instance public IDs with exact same-scope checks;
- event version within the relevant scope;
- event type and disposition;
- modality/device source type/public ID;
- source AE title, called AE title;
- PACS endpoint source type/public ID;
- bridge/agent/log/message source identity pairs;
- protocol, transfer syntax, payload/object SHA-256, storage provider/key/generation;
- actor, occurred/recorded UTC, reason code, source evidence, created UTC.

Event types include worklist_sent, acquisition_started, acquisition_completed, dicom_received, instance_staged, instance_accepted, duplicate_detected, collision_detected, mapped, stored, storage_verified, replaced, retracted, and entered_in_error.

Rules:

- source type/public ID pairs are exact and immutable;
- source AE title and PACS endpoint are provenance, not patient identity proof;
- one accepted provenance link per exact accepted source object/version;
- payload/object hash mismatch creates deterministic issue;
- raw payload and patient-name data are excluded from Canonical outbox/readiness receipts;
- events immutable and undeletable.

### 7. `canonical_imaging_report_sets`

Purpose: one current radiology report aggregate linked to exact acquisition/study/request/patient/encounter.

Fields:

- report-set public ID;
- patient link, encounter, request, service, acquisition, and study public IDs;
- current report-version public ID;
- current status and status version;
- authoring/reporting practitioner current pointer;
- report/radiology-number identifier namespace/value;
- source evidence, request fingerprint, idempotency key, created/updated UTC.

Statuses include `draft`, `verified`, `final`, `published`, `retracted`, and `entered_in_error`.

Rules:

- exact same-scope acquisition/study/request consistency;
- current version/status are guarded projections;
- report/radiology number is an identifier, not report-content authority;
- identity and scope immutable;
- hard delete restricted.

### 8. `canonical_imaging_report_versions`

Purpose: immutable complete report versions.

Fields:

- version public ID, report-set public ID, version number;
- optional superseded version public ID;
- version kind: draft, amendment, correction, retraction, entered_in_error;
- version status;
- complete findings, impression, indication, recommendations, technique, comparison, and structured-content representation or canonical JSON;
- content SHA-256 and signed content SHA-256;
- authoring, verifying, finalising/approving practitioner public IDs;
- authored, verified, finalised, published, retracted UTC;
- correction/retraction/error reason;
- source evidence and created UTC.

Rules:

- unique contiguous version number per report set;
- one direct replacement per superseded version unless later branch-resolution design is approved;
- correction creates a complete replacement version;
- verification/finalisation/publication references exact immutable content;
- signed content SHA-256 equals content SHA-256 for signed states;
- exact active practitioners required;
- prior content, lineage, signatures, and reasons immutable;
- retraction and entered-in-error preserve prior versions;
- hard delete restricted.

### 9. `canonical_imaging_report_status_events`

Purpose: immutable report lifecycle and signature evidence.

Fields:

- event public ID, report-set/version public IDs, event version;
- from/to status and event type;
- actor practitioner/user/system;
- signed content SHA-256 where required;
- reason code, occurred UTC, source evidence, created UTC.

Event types include `draft_created`, `draft_replaced`, `verified`, `finalised`, `published`, `corrected`, `retracted`, and `entered_in_error`.

Rules:

- contiguous event version per report set;
- current report status/version must match the latest event;
- verified/final/published require exact practitioner and matching signed hash;
- correction switches current pointer to a complete replacement version;
- publication/delivery never changes report content;
- immutable and undeletable.

## Exact identity and mapping policy

Backfill and commands require exact reviewed mappings for:

- legacy patient to patient link;
- visit/admission to encounter;
- requisition to canonical service request and optional event;
- imaging item/procedure to Canonical service;
- users/doctors to practitioners;
- requisition to acquisition;
- DICOM source row/message to study, series, and instance;
- report row/version to report set/version;
- modality, AE, PACS endpoint, bridge, storage object, and transfer source identities.

The following may be stored as evidence or used for review but cannot independently establish identity: accession, patient name, patient ID text, procedure name, modality, study description, study date, timestamp, image count, R2 key, report number, signatories JSON, report text similarity, or suggested-match score.

## Sixteen command boundaries

The implementation checkpoint will provide sixteen commands:

1. register acquisition;
2. start acquisition;
3. complete acquisition;
4. cancel acquisition;
5. enter acquisition in error;
6. register study;
7. register series;
8. register instance;
9. record provenance/transfer/storage evidence;
10. create report draft;
11. replace report draft;
12. verify report version;
13. finalise and publish report version;
14. correct report version;
15. retract report version;
16. enter report in error.

Every command normalises exact identifiers, UTC, actors, hashes, statuses, and controlled codes; calculates deterministic IDs for explicit sources; reads replay before state validation; rejects changed fingerprints; validates same-scope ownership; writes compatibility statements, Canonical facts, source mappings, command receipt, and PHI-minimised outbox in one D1 batch; and rolls back fully on failure.

## Backfill design

Ten persistent bounded/resumable partitions will process exact order mappings, acquisition state, DICOM study identity, missing series/instance disposition, provenance/storage evidence, report versions, signatures/status, corrections/deletions, RIS reconciliation issues, and duplicate/projection surfaces. Legacy sources are read-only. Ambiguous evidence creates deterministic non-PHI processing issues. Second completed pass creates zero new business rows.

A study-only legacy row may create an exact study only when patient, encounter, request, acquisition, service, Study Instance UID, and source evidence are exact. It must not invent series or SOP instances from image/series counters. Missing hierarchy becomes an explicit disposition issue.

## Provider design

A later disabled-safe provider `canonical_radiology_acquisition_report_provider_v1` will support `legacy`, `shadow`, and `canonical` modes. Default and rollback mode remain `legacy`. Canonical and identity-sensitive reads require exact mapping and fail closed. Shadow mode preserves legacy-facing output and emits aggregate PHI-minimised parity only.

Canonical acquisition projections expose current state and full status history. Canonical study projections expose exact study/series/instance hierarchy and provenance without raw pixel data. Canonical report projections expose complete version lineage, signed status history, corrections, retractions, and entered-in-error evidence. Report rendering and delivery are projections.

## Reconciliation and readiness

The fixed thirty checks are specified in the implementation plan. Readiness cannot be true if unknown writers/readers exist, route activation is nonzero, exact mapping is optional, raw payload or PHI appears in evidence, UID/content collisions are unresolved, current pointers or sequences disagree, signed-content parity fails, source fingerprints change, foreign-key/integrity checks fail, critical issues remain, or second pass creates business rows.

## Production and retirement gates

Local implementation does not authorise production. Production migration, bounded backfill, shadow observation, rollback execution evidence, exact owner authorisation, route cutover, writer freeze, and legacy retirement remain separate blocked gates.

Never delete signed reports, DICOM UID history, accepted storage provenance, corrections, retractions, or entered-in-error evidence. Legacy requisition/report/study tables may become compatibility projections only after exact mapping, immutable migration, zero-variance reconciliation, provider observation, rollback proof, and explicit authorisation.
