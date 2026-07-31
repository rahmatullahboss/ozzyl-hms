# Clinical Document and Diagnosis Authority Audit

**Date:** 2026-07-27
**Checkpoint:** `CDB-122A-CLINICAL-DOCUMENT-DIAGNOSIS-AUTHORITY-DESIGN`
**Scope:** repository-local design evidence only
**Production mutation:** none

## 1. Audit goal

Inventory every repository source that currently writes, stores, signs, amends, attaches, codes, or reads encounter-linked clinical documentation and diagnosis facts. The audit distinguishes clinical-document content from encounter state, prescription/order intent, diagnostic orders/results, observations, longitudinal problem lists, discharge workflow, medical-record filing, and finance.

## 2. Current source families

### 2.1 `clinical_notes`

Current operational note authority with:

- tenant, patient, and optional visit identity;
- note type, title, full content, chief complaint, SOAP-like sections, assessment, plan, and follow-up;
- template and performer references;
- mutable draft fields;
- `is_signed`, `signed_by`, and `signed_at`;
- soft-delete through `is_active`.

Direct/runtime writers include:

- `src/routes/tenant/clinical/notes.ts`;
- `src/lib/ipd-doctor-rounds.ts`.

Readers include:

- `src/routes/tenant/clinical/notes.ts`;
- `src/routes/tenant/clinical/encounters.ts`;
- `src/routes/tenant/patients-chart.ts`;
- `src/routes/tenant/ipdDoctorRounds.ts`;
- `src/lib/ipd-doctor-rounds.ts`;
- `src/routes/sync.ts`.

Observed risks:

- unsigned drafts are edited in place and no immutable version history exists;
- signing locks the row but does not persist an independently verifiable signed content digest;
- signed-note deletion is prohibited, but unsigned soft deletion has no typed entered-in-error lifecycle;
- patient/visit/performer references remain legacy numeric IDs;
- the same clinical content may also appear in SOAP, consultation, encounter snapshot, or round records.

### 2.2 `FormSOAP`

Legacy SOAP-document authority with patient, encounter, chief complaint, subjective, objective, assessment, plan, creator, creation time, and later `completion_claim_id` evidence.

Writers/readers include:

- `src/routes/tenant/doctors.ts`;
- `src/routes/tenant/clinical/assessments.ts`;
- `src/routes/tenant/patients-chart.ts`;
- `src/routes/tenant/patients-timeline.ts`.

Observed risks:

- competes with `clinical_notes` SOAP fields;
- no immutable version/signature model;
- encounter identity may be a legacy encounter or visit-style numeric reference;
- doctor completion flows may update existing rows under completion-claim logic.

### 2.3 `consultations`

Mixed scheduling and free-text compatibility source with notes, prescription text, chief complaint, and follow-up date. It is not a safe general clinical-document authority because it also represents appointment-like workflow and lacks immutable document/signature semantics.

Disposition: preserve as compatibility evidence; migrate only when exact tenant/patient/practitioner/encounter mappings and a reviewed source-document classification exist. Never infer a document by text or timestamp similarity.

### 2.4 Legacy `encounters` signed snapshot

The legacy encounter row may contain reason/chief complaint, SOAP reference, prescription reference, order references, `signed_snapshot`, `snapshot_hash`, signer, signed time, signature version, and addendum count.

Disposition:

- encounter status and participant facts remain owned by the existing Canonical encounter authority;
- a signed encounter snapshot may become one clinical-document source when exact encounter and signer evidence exists;
- the encounter row itself must not become a second general document table.

### 2.5 `encounter_addenda` and `canonical_encounter_addenda`

`encounter_addenda` preserves author, reason, content, previous snapshot hash, addendum hash, and creation time. The repository already has `canonical_encounter_addenda` linked to `canonical_encounters`.

Disposition:

- retain `canonical_encounter_addenda` as the sole encounter-snapshot addendum authority;
- do not create a duplicate Canonical document-addendum table for the same legacy rows;
- document amendments use immutable document versions;
- future links may associate an encounter addendum with a clinical-document version without copying addendum authority.

### 2.6 `ClinicalDiagnosis`

Operational per-visit diagnosis authority with:

- patient and visit identity;
- ICD-10 ID/code/description and ICD-11 extensions;
- diagnosis type (`primary`, `secondary`, `admitting`, `discharge`);
- notes, active state, source, review status, reviewer, review time, and review notes;
- completion-claim usage in doctor workflows.

Writers include:

- `src/routes/tenant/clinical/diagnosis.ts`;
- `src/routes/tenant/doctors.ts`.

Readers include:

- `src/routes/tenant/clinical/diagnosis.ts`;
- `src/routes/tenant/patients-chart.ts`;
- `src/routes/tenant/healthRecord.ts`;
- `src/routes/tenant/patients-summary.ts`;
- `src/lib/health-summary.ts`;
- `src/lib/ot-programmatic-overview.ts`;
- `src/lib/family-risk.ts`.

Observed risks:

- updates and soft deletes mutate current rows without immutable assertion events;
- code system/version identity is incomplete and descriptions can act as accidental identity;
- review lifecycle is stored as mutable columns;
- patient/visit/creator/reviewer are legacy numeric/string identities.

### 2.7 `final_diagnosis`

A second operational diagnosis authority used by medical-record, nursing, portal, timeline, chart, health-summary, OT, and family-risk consumers. It links optional ICD-10 master ID plus ICD-11 code/title, primary flag, notes, source, active state, and medical-record/visit references.

Writers include:

- `src/routes/tenant/medicalRecords.ts`;
- `src/routes/tenant/nursing/index.ts`;
- `src/routes/tenant/nursing/opd.ts`.

Readers include:

- `src/routes/tenant/medicalRecords.ts`;
- `src/routes/tenant/patientPortal.ts`;
- `src/routes/tenant/patients-chart.ts`;
- `src/routes/tenant/nursing/investigation-results.ts`;
- `src/routes/tenant/nursing/clinical-summary.ts`;
- `src/lib/health-summary.ts`;
- `src/lib/ot-programmatic-overview.ts`;
- `src/lib/family-risk.ts`.

Observed risks:

- duplicates `ClinicalDiagnosis` without deterministic cross-source identity;
- “final” naming does not guarantee reviewed/signed status;
- soft delete removes the active projection without an immutable entered-in-error event;
- medical-record and visit references do not establish one exact Canonical encounter.

### 2.8 Diagnosis projections on `visits`, discharge records, and summaries

`visits` contains ICD-10/ICD-11 code and description snapshots. Discharge summaries and admission/discharge workflow contain provisional/final diagnosis text. These are projections or document fields, not independent diagnosis identity.

Disposition:

- map only when exact source lineage points to a Canonical diagnosis assertion;
- otherwise preserve as document text/projection and create a stable reconciliation issue;
- never merge diagnoses because code text or description appears equal.

### 2.9 `document_records`

File metadata source with patient/medical-record, document type/title/description, object key, filename, size, MIME type, uploader, active state, and timestamps. Writers include medical-record and patient-portal routes.

Disposition:

- treat as attachment/file metadata, not signed clinical-document body authority;
- require content SHA-256, exact patient/encounter/document scope, uploader identity, MIME/size validation, retention state, and object-store provenance;
- no file bytes or object keys may appear in aggregate reconciliation/outbox evidence.

### 2.10 `clinical_images`

Clinical attachment/image source with patient/visit, image type/title/description, object key, filename, size, MIME type, body part, uploader, and active state.

Disposition: converge to the same Canonical attachment metadata authority, while body-part and image-type fields remain typed clinical metadata. Soft deletion must become entered-in-error/retired lifecycle, not destructive deletion.

### 2.11 `medical_records`

MRD file/case container used for file number, visit/admission linkage, discharge classification, legal/administrative workflow, chart completion, and related artifacts.

Disposition: do not promote as clinical-document content authority. It may link Canonical documents and attachments to an MRD case/file, but filing workflow remains separate.

### 2.12 `FormTreatmentPlan`

Structured treatment-plan document containing presenting issues, history, medications, diagnosis text, treatment received, and follow-up recommendation.

Disposition: eligible as a clinical-document type only when exact patient/encounter/author evidence exists. Medication and diagnosis strings remain document content and do not create prescription or diagnosis authority automatically.

### 2.13 Explicitly separate future authorities

The following do not become general clinical documents merely because they can be rendered as text:

- `CLN_ProblemList` and `ProblemEncounterLink` — longitudinal problem-list authority;
- `FormPHQ9`, `FormGAD7`, glucose and other assessments — questionnaire/observation authority;
- patient vitals and monitoring — observation/vital authority;
- prescription and medication orders — completed CDB-121 authority;
- laboratory/radiology orders and results — diagnostic order/result authority;
- discharge workflow, birth/death certificates, medico-legal files — separate legal/workflow document domains;
- billing, payment, claims, reporting, and analytics projections — consumers only.

## 3. Identity and provenance findings

Every safe migration or command requires:

- exact tenant identity;
- exact Canonical tenant-patient link;
- exact Canonical encounter when the source is encounter-linked;
- exact author/signing/reviewing practitioner identity;
- exact source-table and source-row mapping;
- exact source content fingerprint;
- UTC authored, signed, reviewed, amended, or entered-in-error timestamps.

Names, phone numbers, free-text similarity, code description similarity, numeric coincidence across unrelated tables, file names, and timestamp proximity are not identity evidence.

## 4. Target authority recommendation

Create six new Canonical table families and reuse the existing encounter-addendum authority:

```text
canonical_clinical_documents
canonical_clinical_document_versions
canonical_clinical_document_signatures
canonical_clinical_document_attachments
canonical_diagnosis_assertions
canonical_diagnosis_status_events
canonical_encounter_addenda   # existing, reused
```

Clinical document versions own immutable content/payload provenance. Diagnosis assertions are typed clinical facts linked to patient, encounter, asserting practitioner, and optionally the exact supporting document version. They are not derived automatically from narrative text.

## 5. Required command boundaries

```text
createCanonicalClinicalDocumentDraft
replaceCanonicalClinicalDocumentDraft
signCanonicalClinicalDocument
amendCanonicalClinicalDocument
enterCanonicalClinicalDocumentInError
attachCanonicalClinicalDocumentArtifact
assertCanonicalDiagnosis
reviewCanonicalDiagnosis
transitionCanonicalDiagnosis
```

## 6. Migration and reconciliation risks

High-risk cases that must become stable processing issues:

- one source row resolves to multiple exact encounters;
- signer/author/reviewer cannot be mapped to an active practitioner;
- signed content changes after signature time;
- legacy content/hash mismatch;
- diagnosis code ID conflicts with code/code-system evidence;
- identical text exists in multiple source tables without deterministic lineage;
- an attachment belongs to a patient but no exact encounter/document scope is known;
- “final diagnosis” rows lack final/review evidence;
- a signed note was soft-deleted or edited after signing;
- source version order or addendum hash chain is invalid.

## 7. Production and protected-core boundary

This audit performs no production access or mutation. Clinical document and diagnosis workflows are development-only unless proven otherwise. Any source shared with protected Reception, deployed billing, setup/master data, or doctor-commission behavior must remain compatibility-protected. Design completion does not authorize production migration/backfill, provider activation, live route cutover, sync activation, or legacy retirement.
