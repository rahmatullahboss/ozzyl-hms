# CDB-125A Lab Result and Specimen Authority Design

Status: design verified target, implementation not yet authorised
Date: 2026-07-28

## Purpose

Define one Canonical lab domain extension for specimen identity/custody, immutable result versions, observation components, verification/signature lifecycle, correction/retraction/entered-in-error evidence, and analyzer provenance. Generic order and delivery authority remains in `canonical_service_requests`, `canonical_service_events`, and `canonical_service_participants`.

## Non-goals

CDB-125 does not replace patient identity, encounter authority, practitioner identity, service catalog, service requests, service delivery events, analyzer network transport, report rendering, notification delivery, billing, or inventory. CDB-125A creates no migration, schema, command, provider, route, or production mutation.

## Core authority rules

1. Every lab specimen and result set belongs to one tenant and exact patient link.
2. Encounter, service request, service event, specimen, practitioner, service catalog, and analyzer references must be exact reviewed identities.
3. accession and barcode are identifiers, not patient or order identity proof.
4. Test name, machine code, accession, result value, timestamp, patient proximity, and request similarity never establish identity.
5. Specimen identity/custody authority is separate from result-content authority.
6. Report rendering and delivery are projections/workflows, not clinical result authority.
7. specimen custody events are append-only.
8. result observations are immutable within one exact version.
9. correction creates a replacement version.
10. entered-in-error and retraction never delete prior evidence.
11. signed content hash must equal the exact version content hash.
12. verification and validation require explicit practitioners.
13. analyzer evidence stores hashes and exact source identities, not unrestricted raw payload copies.
14. MAX(version) + 1 is not an acceptable concurrency contract.
15. numeric laboratory values use canonical decimal TEXT, never REAL authority.
16. Every command must be tenant-scoped, idempotent, replay-safe, and one D1 atomic batch.
17. Canonical outbox, command receipt, source mapping, compatibility statement, and domain facts commit or roll back together.
18. Legacy rows remain read-only during backfill.

## Existing authority reused

### Service intent and delivery

- `canonical_service_requests` owns the requested diagnostic service.
- `canonical_service_events` owns accepted/delivered/completed service occurrences.
- `canonical_service_participants` owns typed ordering, performing, reporting, and approving practitioner participation where applicable.

CDB-125 tables may reference exact request/event identifiers but may not duplicate quantities, request status, price, or billing state.

### Identity

- `canonical_tenant_patient_links` owns tenant patient linkage.
- `canonical_encounters` owns care encounter identity.
- `canonical_practitioners` owns clinical actors.
- `canonical_service_catalog_items` owns service identity.
- analyzer/machine identity remains legacy-governed initially and is linked through exact source mapping/evidence until a future equipment authority exists.

## Canonical table design

### 1. `canonical_lab_specimens`

Purpose: one current specimen identity and lifecycle pointer.

Required fields:

- tenant and specimen public ID;
- exact patient link and encounter;
- primary service request public ID;
- accession identifier type/value and barcode identifier type/value;
- specimen type and container code;
- parent specimen public ID for aliquot/derived specimen;
- current status, status version, and current status-event public ID;
- collected/received/rejected/disposed effective timestamps only as current projection fields;
- source evidence hash, request fingerprint, idempotency key, created/updated UTC.

Constraints:

- unique tenant specimen public ID;
- accession/barcode uniqueness only inside explicitly declared identifier namespace;
- parent specimen must be same tenant, patient, encounter, and must not self-reference;
- current status changes only through a matching status event and optimistic version increment;
- identity fields immutable after creation;
- delete restricted.

Statuses include `registered`, `collected`, `in_transit`, `received`, `processing`, `rejected`, `disposed`, `entered_in_error`.

### 2. `canonical_lab_specimen_service_items`

Purpose: exact many-to-many link between specimen and requested lab service items.

Required fields:

- tenant;
- link public ID;
- specimen public ID;
- canonical service request public ID;
- optional accepted/completed canonical service event public ID;
- exact service public ID snapshot/check;
- relationship role such as `primary`, `aliquot`, `reflex`, `repeat`;
- source evidence hash and UTC.

One legacy order item may map to one exact Canonical request. A specimen may serve several exact requests only through explicit rows. No test-name inference.

### 3. `canonical_lab_specimen_status_events`

Purpose: immutable custody and lifecycle history.

Fields:

- event public ID, specimen public ID, event version;
- from/to status and controlled event type;
- actor practitioner/user/system;
- occurred and recorded UTC;
- location/source identifier pairs;
- collection method, transport condition, rejection/disposal reason codes;
- evidence hash and created UTC.

Allowed event types include registered, collected, transferred, received, processing_started, rejected, aliquoted, disposed, entered_in_error. Events are immutable and undeletable. Event version is unique and contiguous per specimen. Current specimen status must match the latest accepted event.

### 4. `canonical_lab_result_sets`

Purpose: one result/report clinical aggregate linked to exact patient, encounter, request/event, and specimen scope.

Fields:

- result-set public ID;
- patient link and encounter;
- canonical service request public ID;
- optional completed service event public ID;
- specimen public ID;
- service public ID;
- current version public ID;
- current status and status version;
- creating practitioner/user/system;
- request fingerprint, source evidence, idempotency, timestamps.

One result set represents one exact requested service/specimen combination. Panels may contain multiple observations in a version. Result-set current fields are projections guarded by immutable version/status evidence.

### 5. `canonical_lab_result_versions`

Purpose: immutable complete content versions.

Fields:

- version public ID and result-set public ID;
- version number and optional superseded version public ID;
- version kind: draft, correction, amendment, retraction, entered_in_error;
- version status: draft, verified, validated, published, retracted, entered_in_error;
- content SHA-256 and optional signed content SHA-256;
- authoring, verifying, validating practitioners;
- authored, verified, validated, published, retracted UTC;
- correction/retraction/error reason code;
- source evidence and created UTC.

Rules:

- unique contiguous version number per result set;
- one direct replacement per superseded version unless an explicit branch-resolution design is later approved;
- `signed_content_sha256` equals `content_sha256` for verified/validated/published versions;
- verification and validation actors must be active exact practitioners;
- content and lineage immutable;
- terminal versions immutable and undeletable;
- a retraction/entered-in-error version points to an exact prior version and preserves prior content.

### 6. `canonical_lab_result_observations`

Purpose: immutable component observations belonging to one exact version.

Fields:

- observation public ID, result-set and version public IDs;
- deterministic sequence;
- service/test/component identity using Canonical service plus explicit lab component source identity;
- observation code/system/display snapshot;
- value type: decimal, text, coded, boolean, date-time, absent;
- value text and canonical decimal TEXT where applicable;
- unit code/system/display;
- reference low/high decimal TEXT, reference text, interpretation/abnormal/critical code;
- method code, specimen public ID;
- analyzer evidence public ID if machine-derived;
- observation status and reason when absent/retracted/error;
- source evidence and created UTC.

Rules:

- deterministic contiguous sequence per version;
- value-type-specific completeness checks;
- decimal grammar is plain exact decimal text with no exponent or locale formatting;
- no REAL authority;
- observation rows immutable and undeletable;
- analyzer evidence must be same tenant and exact linked source;
- critical interpretation is clinical evidence, not notification-delivery state.

### 7. `canonical_lab_result_status_events`

Purpose: immutable aggregate lifecycle and signature evidence.

Fields:

- event public ID, result-set/version public IDs, event version;
- from/to status;
- event type: draft_created, draft_replaced, verified, validation_failed, validated, published, corrected, retracted, entered_in_error;
- actor practitioner/user/system;
- signed content hash where signature is required;
- reason code and occurred UTC;
- source evidence and created UTC.

Rules:

- contiguous unique event version per result set;
- event version and current status must use optimistic concurrency;
- verified/validated/published events must reference the exact version and matching content hash;
- publication cannot modify content;
- retraction and error require reason and exact prior version;
- immutable and undeletable.

### 8. `canonical_lab_analyzer_evidence`

Purpose: immutable exact provenance for analyzer-origin observations.

Fields:

- analyzer evidence public ID;
- result-set/version/observation public IDs when accepted;
- source type and exact source public ID;
- ingestion message ID/source identity, inbox observation index, machine/bridge/log source IDs;
- protocol and payload SHA-256;
- QC state, validation state, match state, disposition;
- normalized conversion rule/factor represented as exact decimal TEXT;
- accepted/rejected/superseded actor and UTC;
- source evidence and created UTC.

Rules:

- one accepted Canonical observation per exact accepted source observation;
- payload identity collision creates processing issue, never silent overwrite;
- raw payload remains in governed LIS source; Canonical stores hashes and exact references;
- source identity, payload hash, machine, observation index, and accepted link immutable;
- no patient/name/time matching without exact mapping.

## Command boundary design

CDB-125C will implement thirteen commands, named in the implementation plan. Each command must read replay before mutable-state validation. Compatibility writes may be included as authoritative statements only when they share the same batch.

Specimen commands:

- register identity and initial event;
- collect;
- receive/transfer;
- reject;
- create aliquot/derived specimen.

Result commands:

- create and replace draft versions;
- verify exact version/content;
- validate and publish exact signed version;
- correct by replacement version;
- retract by replacement/status evidence;
- enter in error by replacement/status evidence;
- attach exact analyzer evidence.

No result command may update a prior version or observation. No specimen command may rewrite a prior custody event.

## Backfill identity policy

Backfill requires reviewed mappings for:

- legacy patient to patient link;
- visit/admission to encounter;
- lab order item to canonical service request;
- legacy test/service to Canonical service catalog;
- user/doctor to practitioner;
- specimen and result source identities;
- machine/inbox/log evidence.

Accession, barcode, order number, report ID, patient ID, test name, component name, result value, and timestamp may be included in source evidence but cannot independently establish Canonical identity.

Ambiguity creates deterministic non-PHI processing issues. Source tables remain unchanged. Second pass must create zero new business rows.

## Provider design

CDB-125E will use a disabled-safe `canonical_lab_result_specimen_provider_v1` with `legacy`, `shadow`, and `canonical` modes.

- absent/disabled/unsupported resolves to legacy;
- shadow preserves legacy-facing output and emits aggregate PHI-minimised parity;
- canonical requires exact source mappings and fails closed;
- specimen custody history, result version lineage, status/signature history, and analyzer provenance remain visible;
- report rendering may use a selected adapter but never becomes authority;
- default and rollback mode remain legacy;
- route activation remains zero until separately authorised observation.

## Reconciliation and readiness

The fixed twenty-eight checks are specified in the implementation plan. Readiness cannot be true if unknown writers/readers exist, route activation is nonzero, source fingerprint changes, foreign-key/integrity checks fail, critical issues remain, signature/content mismatch exists, version sequences have gaps, or second pass creates business rows.

## Production and retirement gates

Local schema/commands/backfill/provider readiness does not authorise production. Production migration, bounded backfill, shadow observation, rollback execution evidence, exact owner authorisation, route cutover, writer freeze, and legacy retirement remain separate blocked gates.

Never delete signed or retracted clinical evidence. Legacy report/result/specimen tables may become compatibility projections only after exact mapping, immutable migration, zero-variance reconciliation, provider observation, rollback proof, and explicit authorisation.
