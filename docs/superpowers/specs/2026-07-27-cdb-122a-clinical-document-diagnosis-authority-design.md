# CDB-122A Clinical Document and Diagnosis Canonical Authority Design

**Date:** 2026-07-27
**Checkpoint:** `CDB-122A-CLINICAL-DOCUMENT-DIAGNOSIS-AUTHORITY-DESIGN`
**Program:** HMS Canonical Data Architecture
**Production boundary:** repository-local design only; no production access or runtime cutover

## 1. Goal

Create one encounter-linked Canonical authority for authored clinical documents and coded diagnosis assertions while preserving immutable document versions, independently verifiable signatures, amendment/supersession history, attachment provenance, diagnosis review/lifecycle events, and exact patient/encounter/practitioner identity.

The design must not absorb encounter state, encounter-snapshot addenda, prescriptions, medication orders, diagnostic orders/results, observations/vitals, longitudinal problem lists, discharge workflow, medical-record filing, or finance.

## 2. Authority decomposition

CDB-122 implements two tightly linked but distinct aggregates:

1. **clinical document aggregate** — narrative or structured authored content, immutable versions, signatures, and attachments;
2. **diagnosis assertion aggregate** — typed/coded clinical assertions with review and status history.

A diagnosis assertion may cite an exact supporting clinical-document version. Narrative text never creates a diagnosis automatically.

Existing `canonical_encounter_addenda` remains the sole encounter-snapshot addendum authority. Clinical-document amendments are new immutable document versions, not copied encounter addenda.

## 3. Rejected approaches

### 3.1 Promote `clinical_notes` in place

Rejected. The table edits unsigned rows in place, stores signing as mutable columns, has no immutable version chain, uses legacy patient/visit/user IDs, and mixes free text with SOAP sections and follow-up fields.

### 3.2 Treat `FormSOAP` as the only document authority

Rejected. SOAP is one document type, not the complete clinical-document graph. It competes with `clinical_notes`, lacks signed immutable versions, and cannot safely own treatment plans, progress notes, attachments, or other documents.

### 3.3 Merge notes because their text or timestamps match

Rejected. Similar content can be intentionally copied, rendered from a template, or authored independently. Names, free-text similarity, code descriptions, numeric coincidence, file names, and timestamp proximity are never source identity.

### 3.4 Treat `final_diagnosis` as inherently final

Rejected. The table name does not prove review, signature, code-system identity, encounter scope, or lifecycle history. “Final” must be explicit evidence, not naming convention.

### 3.5 Derive diagnosis assertions from assessment/plan text

Rejected. Natural-language extraction may create suggestions for human review later, but it cannot write Canonical diagnosis authority.

### 3.6 Create a second Canonical encounter-addendum table

Rejected. `canonical_encounter_addenda` already owns encounter snapshot addendum evidence. CDB-122 links or references it when needed but does not duplicate it.

### 3.7 Treat file metadata as the clinical document itself

Rejected. `document_records` and `clinical_images` identify stored artifacts. The authoritative document/version and the attachment metadata are separate facts with independent hashes, provenance, retention, and lifecycle.

## 4. Target Canonical tables

### 4.1 `canonical_clinical_documents`

Current aggregate state for one authored clinical document.

Required fields:

- `tenant_id`;
- `document_public_id`;
- `patient_link_public_id`;
- optional `encounter_public_id` only for explicitly patient-level documents;
- `authoring_practitioner_public_id`;
- `document_type`;
- `current_version_public_id`;
- `current_status`;
- `status_version`;
- `confidentiality_code`;
- authored/finalized/entered-in-error timestamps;
- idempotency and request fingerprint;
- source evidence SHA-256;
- UTC audit timestamps.

Document-type vocabulary begins with:

- `progress_note`;
- `soap_note`;
- `consultation_note`;
- `doctor_round_note`;
- `treatment_plan`;
- `encounter_summary`;
- `discharge_summary`;
- `procedure_note`;
- `operative_note`;
- `referral_note`;
- `other`.

Status vocabulary:

- `draft`;
- `final`;
- `amended`;
- `retracted`;
- `entered_in_error`.

A current document row contains no unrestricted body text. It points to the current immutable version.

### 4.2 `canonical_clinical_document_versions`

Immutable authored content and version provenance.

Required fields:

- `version_public_id`;
- parent `document_public_id`;
- strictly positive `version_number`;
- optional `supersedes_version_public_id`;
- `version_kind` (`draft`, `final`, `amendment`, `retraction`, `entered_in_error`);
- `content_format` (`plain_text`, `soap_json`, `structured_json`, `markdown`, `html`, `fhir_composition_json`);
- canonical content/payload representation;
- `content_sha256`;
- optional `section_manifest_json` with controlled section names only;
- authoring practitioner and actor user/system identity;
- authored/finalized timestamps;
- source evidence SHA-256;
- creation timestamp.

Content storage rule:

- the version owns the exact content payload or an exact encrypted payload reference with digest and key version;
- aggregate outbox, reconciliation, logs, and readiness evidence contain only hashes/counts/statuses, never narrative content;
- a future encrypted object store may replace inline protected payload without changing public IDs or content hashes.

Signed/final/amendment versions are immutable. Draft replacement creates a new version rather than mutating a prior version.

### 4.3 `canonical_clinical_document_signatures`

Independent immutable signature evidence.

Required fields:

- `signature_public_id`;
- `document_public_id` and exact `version_public_id`;
- signer practitioner public ID;
- optional actor user public ID;
- signature method (`authenticated_attestation`, `digital_signature`, `imported_legacy_signature`, `system_seal`);
- signed content SHA-256;
- signature/attestation SHA-256;
- signing key/version or certificate reference when applicable;
- signed timestamp;
- source evidence SHA-256.

A final/amendment document version must have at least one valid signature row unless the document type explicitly permits an unsigned final system artifact. A signature can never be moved to a different version.

### 4.4 `canonical_clinical_document_attachments`

Attachment/file/image metadata linked to one document and optional exact version.

Required fields:

- `attachment_public_id`;
- document and optional version public IDs;
- patient link and optional encounter public IDs for parity enforcement;
- attachment type and optional body-part code;
- object-storage provider/key reference;
- content SHA-256;
- file size and MIME type;
- original filename as display metadata only;
- uploader practitioner/user/system identity;
- lifecycle status (`active`, `superseded`, `retracted`, `entered_in_error`);
- created/updated timestamps;
- source evidence SHA-256.

File bytes and object keys are prohibited from aggregate outbox/reconciliation evidence.

### 4.5 `canonical_diagnosis_assertions`

Current state for one encounter-linked diagnosis assertion.

Required fields:

- `diagnosis_public_id`;
- tenant, patient-link, and encounter public IDs;
- asserting practitioner public ID;
- optional supporting document/version public IDs;
- `code_system`;
- `code_system_version` when known;
- `code`;
- `display_snapshot`;
- optional coding/master public ID;
- `diagnosis_role` (`primary`, `secondary`, `admitting`, `discharge`, `differential`, `other`);
- `certainty` (`suspected`, `probable`, `confirmed`, `ruled_out`, `unknown`);
- `clinical_status` (`active`, `resolved`, `inactive`, `unknown`);
- `verification_status` (`unverified`, `provisional`, `verified`, `refuted`, `entered_in_error`);
- `status_version`;
- asserted/reviewed/resolved/entered-in-error timestamps;
- source/idempotency/evidence fields;
- UTC audit timestamps.

A diagnosis is identified by its public ID and exact source mapping, not by code or display text. The same code may be asserted multiple times in different encounters or by different evidence.

Longitudinal problem-list authority is not implemented by this table. A future problem aggregate may reference verified diagnosis assertions.

### 4.6 `canonical_diagnosis_status_events`

Immutable diagnosis lifecycle and review events.

Required fields:

- event public ID;
- diagnosis public ID;
- from/to verification and clinical statuses;
- event version;
- event type (`asserted`, `reviewed`, `confirmed`, `refuted`, `resolved`, `reopened`, `entered_in_error`);
- reason/evidence code;
- actor practitioner/user/system identity;
- occurred timestamp;
- source evidence SHA-256.

Every diagnosis current-state transition co-commits exactly one event.

### 4.7 Reused `canonical_encounter_addenda`

No new duplicate table is created. Legacy `encounter_addenda` remains mapped to the existing Canonical encounter-addendum authority. CDB-122 may add a typed optional link from a document/version to an encounter addendum only if it does not copy or re-own the addendum content/hash chain.

## 5. Referential and lifecycle rules

- Every document and diagnosis belongs to exactly one tenant.
- Every document and diagnosis references one exact Canonical tenant-patient link.
- Encounter-linked document types and all diagnosis assertions reference one exact Canonical encounter.
- Every author, signer, reviewer, and asserting practitioner is an exact Canonical practitioner.
- A document current-version pointer references a version of the same document.
- Version numbers are unique, contiguous, and strictly positive per document.
- A version that supersedes another version belongs to the same document.
- Final/amendment content hashes cannot change.
- Signature content hash equals the signed version content hash.
- An attachment linked to a version must belong to the same document/patient/encounter scope.
- A diagnosis supporting document/version belongs to the same patient and encounter.
- No cascade delete removes final/signed document versions, signatures, attachments, diagnosis events, or source mappings.
- Retraction and entered-in-error preserve history; hard delete is forbidden.
- A document amendment creates a new version and changes aggregate status to `amended`; it never edits the prior final version.
- Encounter addendum chains remain governed by `canonical_encounter_addenda`.

## 6. Command boundaries

### 6.1 `createCanonicalClinicalDocumentDraft`

- validates exact patient, encounter, and author practitioner scope;
- creates document header and immutable draft version;
- creates deterministic source mapping, PHI-minimised outbox, and batch assertions atomically;
- supports exact replay and rejects conflicting replay.

### 6.2 `replaceCanonicalClinicalDocumentDraft`

- requires expected aggregate version;
- accepts only a current draft;
- creates a new immutable draft version;
- marks the prior draft version as superseded through lineage, not deletion;
- updates current-version pointer atomically.

### 6.3 `signCanonicalClinicalDocument`

- requires exact expected version and content hash;
- validates active signer practitioner and signing authority;
- creates immutable signature evidence;
- finalizes the exact version and document atomically;
- identical replay succeeds before state-dependent validation.

### 6.4 `amendCanonicalClinicalDocument`

- requires a final/amended current version;
- creates a superseding amendment version and signature;
- preserves the original final version unchanged;
- records reason code and source evidence without copying narrative text into outbox evidence.

### 6.5 `enterCanonicalClinicalDocumentInError`

- never deletes content;
- requires expected aggregate version, reason code, actor authority, and occurred time;
- creates an entered-in-error version/event or typed terminal state while preserving signed history.

### 6.6 `attachCanonicalClinicalDocumentArtifact`

- validates exact document/version/patient/encounter scope;
- validates MIME, nonnegative size, content SHA-256, and object-storage provenance;
- creates attachment metadata and source mapping atomically;
- never logs or emits object key/file name as aggregate evidence.

### 6.7 `assertCanonicalDiagnosis`

- validates patient, encounter, practitioner, coding fields, and optional supporting document version;
- creates diagnosis current state plus initial `asserted` event;
- code descriptions are snapshots, not identity;
- cannot be created from unreviewed narrative extraction.

### 6.8 `reviewCanonicalDiagnosis`

- records reviewer practitioner, review outcome, evidence code, and immutable review event;
- may promote provisional to verified or refute/enter in error;
- uses optimistic version and exact replay.

### 6.9 `transitionCanonicalDiagnosis`

- handles resolve, reopen, refute, and entered-in-error transitions under an explicit matrix;
- co-commits current-state update and immutable event;
- never deletes a prior assertion/event.

## 7. Legacy source classification

### Document body sources

- `clinical_notes` — primary operational source;
- `FormSOAP` — duplicate SOAP source;
- `FormTreatmentPlan` — typed treatment-plan document source;
- selected signed legacy encounter snapshots — signed encounter-summary source;
- `consultations` free text — compatibility source requiring exact lineage and classification;
- discharge-summary text — separate document type, not diagnosis authority by itself.

### Diagnosis sources

- `ClinicalDiagnosis` — operational coded diagnosis source;
- `final_diagnosis` — duplicate operational diagnosis source;
- `visits` ICD fields — projection/compatibility source;
- discharge/admission diagnosis text — document/projection source unless exact diagnosis lineage exists.

### Attachment sources

- `document_records`;
- `clinical_images`;
- selected discharge/archive/medico-legal artifact metadata only when within scope and explicitly classified.

### Reused audit source

- `encounter_addenda` → existing `canonical_encounter_addenda`.

## 8. Backfill design

### 8.1 Partitions

1. clinical-note headers and exact patient/encounter/practitioner scope;
2. clinical-note immutable versions and signatures;
3. SOAP/treatment-plan document sources;
4. selected signed encounter snapshots;
5. attachment/image metadata;
6. `ClinicalDiagnosis` assertions/events;
7. `final_diagnosis` assertions/events;
8. projection/duplicate-source disposition;
9. persistent reconciliation;
10. second pass creates zero new business rows.

### 8.2 Deterministic source identity

Public IDs derive from tenant, entity type, exact source table, exact source row ID, source partition, and source evidence SHA-256. They never derive from patient/doctor names, note text, diagnosis display, file name, or timestamp alone.

### 8.3 Encounter resolution

Allowed exact evidence includes:

- Canonical mapping from legacy encounter;
- Canonical mapping from legacy visit;
- exact completion claim linked to a Canonical encounter;
- exact appointment→encounter link;
- exact admission→encounter link;
- exact source record already linked to a reviewed Canonical document/diagnosis mapping.

Zero or multiple valid candidates create stable processing issues. No best-effort selection is allowed.

### 8.4 Signature migration

A legacy row may be imported as signed only when all are present and internally consistent:

- signed/final status;
- signer mapped to an active practitioner;
- signed timestamp;
- exact immutable source content fingerprint;
- no evidence of post-sign edit;
- valid source snapshot/signature hash when the source provides one.

Otherwise preserve the source as draft/imported-unverified and create an issue. Never fabricate a signature.

### 8.5 Diagnosis migration

- preserve source assertion cardinality unless exact source mapping proves duplicates;
- require explicit code system and code when coded;
- preserve display snapshot independently;
- import review status only with exact reviewer/time evidence;
- soft-deleted/inactive rows become entered-in-error/inactive events, not missing rows;
- duplicate code/display values are not merge evidence.

### 8.6 Attachment migration

- verify object reference presence when required;
- compute/validate content hash outside aggregate evidence;
- map patient/encounter/document scope exactly;
- preserve MIME, size, body part, and source provenance;
- missing object or ambiguous document scope becomes a stable issue.

## 9. Persistent reconciliation

The fixed reconciliation set must cover at least:

1. document source coverage or stable issue;
2. version source coverage;
3. signature source coverage;
4. attachment source coverage;
5. diagnosis source coverage or stable issue;
6. patient-link references;
7. encounter references and patient parity;
8. author/signer/reviewer/asserting practitioner references;
9. current-version pointer parity;
10. version sequence and supersession continuity;
11. final/amendment signature/content-hash parity;
12. attachment document/version scope;
13. diagnosis document/encounter scope;
14. diagnosis latest-event/header parity;
15. diagnosis event sequence/transition validity;
16. encounter-addendum reuse without duplicate ownership;
17. source fingerprint immutability;
18. unresolved critical issue count;
19. foreign-key violations;
20. integrity status and second pass creates zero new business rows.

Reconciliation persists aggregate counts and SHA-256 evidence only. Narrative content, diagnosis notes, patient identifiers, file names, object keys, and attachment metadata are excluded.

## 10. Provider/read model design

Provider flag:

```text
canonical_clinical_document_diagnosis_provider_v1
```

Modes:

- `legacy` — current readers unchanged;
- `shadow` — legacy response unchanged while aggregate parity is measured;
- `canonical` — future authorized exact-mapping reads.

Missing, disabled, malformed, or unsupported configuration resolves to `legacy`.

Separate read adapters are required for:

- clinical document detail/version history;
- diagnosis assertion list/detail;
- attachment metadata;
- encounter document timeline.

No single generic “medical record” provider may collapse documents, diagnoses, prescriptions, observations, attachments, and encounter state into one authority.

## 11. Privacy, retention, and audit

- Clinical content and attachment metadata are PHI.
- Outbox/reconciliation/readiness evidence is PHI-minimised.
- Signed/final document content and signatures are retained immutably.
- Entered-in-error/retracted content remains auditable and hidden from normal active views.
- Every access and mutation boundary preserves tenant, role, practitioner, purpose, and audit context.
- Attachment object access requires separate authorization and short-lived retrieval capability.
- No raw content, diagnosis notes, object keys, or filenames are written to logs.
- Retention/archival is policy-driven and cannot delete signed legal history without explicit authorized disposition.

## 12. Serial checkpoint sequence

### CDB-122A — design

- audit sources/readers/writers;
- define boundaries, tables, commands, migration, reconciliation, provider, and safety contracts;
- no runtime implementation.

### CDB-122B — Canonical schema

- additive migration and Drizzle schema for six new table families;
- reuse existing Canonical encounter addenda;
- schema and governance tests.

### CDB-122C — commands

- implement document and diagnosis commands with idempotency, optimistic versions, immutable histories, exact scope validation, mappings, outbox, and rollback tests.

### CDB-122D — backfill and reconciliation

- bounded/resumable partitions;
- stable issues;
- persistent 20-check reconciliation;
- source immutability and zero-new-row second pass.

### CDB-122E — disabled providers and readiness

- disabled-safe providers;
- selected reader contracts;
- aggregate shadow evidence;
- local readiness true, production/retirement blocked;
- full authority completion receipt.

## 13. Completion criteria

Local CDB-122 completion requires:

- schema, commands, backfill, reconciliation, providers, adapters, and readiness tests pass;
- exact identity and source-mapping rules are enforced;
- signed history is immutable;
- encounter addenda are reused, not duplicated;
- no diagnosis is inferred from text;
- second pass creates zero new business rows;
- governance and TypeScript pass;
- production readiness remains false;
- provider flags remain disabled;
- live routes remain unchanged;
- no production query/mutation, sync activation, retirement, push, or CDB-to-main integration occurs.
