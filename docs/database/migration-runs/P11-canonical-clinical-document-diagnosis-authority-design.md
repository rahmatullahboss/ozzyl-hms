# P11 Canonical Clinical Document and Diagnosis Authority Design

**Checkpoint:** `CDB-122A-CLINICAL-DOCUMENT-DIAGNOSIS-AUTHORITY-DESIGN-VERIFIED`
**Date:** 2026-07-27
**Branch:** `program/cdb-main-continuous-20260725`
**Previous checkpoint:** `CDB-121E-CANONICAL-PRESCRIPTION-MEDICATION-AUTHORITY-VERIFIED`
**Next checkpoint:** `CDB-122B-CANONICAL-CLINICAL-DOCUMENT-DIAGNOSIS-SCHEMA`

## Result

The repository now has a reviewed design and execution plan for one encounter-linked Canonical clinical-document authority and one linked diagnosis-assertion authority.

Design artifacts:

```text
docs/database/audits/2026-07-27-clinical-document-diagnosis-authority-audit.md
docs/superpowers/specs/2026-07-27-cdb-122a-clinical-document-diagnosis-authority-design.md
docs/superpowers/plans/2026-07-27-cdb-122-clinical-document-diagnosis-authority.md
```

## Reviewed source families

The audit classifies:

- `clinical_notes` as the primary operational note source;
- `FormSOAP` as a competing SOAP-document source;
- `FormTreatmentPlan` as a structured treatment-plan document source;
- selected signed legacy encounter snapshots as encounter-summary document sources;
- `consultations` text as compatibility evidence only;
- `ClinicalDiagnosis` and `final_diagnosis` as competing diagnosis authorities;
- visit/discharge diagnosis fields as projections/document content unless exact lineage exists;
- `document_records` and `clinical_images` as attachment metadata sources;
- `medical_records` as an MRD filing/workflow container, not document-body authority;
- problem lists, screenings, observations/vitals, prescriptions/orders, diagnostic results, discharge workflow, legal certificates, and finance as separate authorities.

Existing `canonical_encounter_addenda` remains the sole encounter-snapshot addendum authority. CDB-122 does not design a duplicate addendum table.

## Target Canonical tables

```text
canonical_clinical_documents
canonical_clinical_document_versions
canonical_clinical_document_signatures
canonical_clinical_document_attachments
canonical_diagnosis_assertions
canonical_diagnosis_status_events
canonical_encounter_addenda   # existing and reused
```

Clinical documents own current state, immutable versions, independently verifiable signatures, and attachment metadata. Diagnosis assertions own coded/typed diagnosis facts and immutable status/review events. A diagnosis may reference an exact supporting document version; narrative text never creates diagnosis authority automatically.

## Planned commands

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

## Core safety rules

- Exact tenant patient-link, encounter, practitioner, source-table, and source-row evidence is mandatory.
- Names, phone numbers, narrative similarity, diagnosis display similarity, file names, numeric coincidence, and timestamp proximity are not identity or merge evidence.
- Signed/final document versions and signatures are immutable.
- Amendments create new superseding versions.
- Retraction and entered-in-error preserve history; hard delete is forbidden.
- Attachments own metadata/content hash and object provenance, not document body.
- Encounter addenda are reused, not duplicated.
- Diagnosis assertions are not inferred from assessment, plan, consultation, prescription, or discharge text.
- PHI is excluded from outbox, reconciliation, logs, receipts, and readiness evidence.

## Serial program

```text
CDB-122A design
CDB-122B schema
CDB-122C commands
CDB-122D bounded backfill and persistent reconciliation
CDB-122E disabled providers and local readiness
```

The planned backfill uses ten bounded/resumable partitions. The planned reconciliation uses 20 fixed aggregate checks and requires source immutability, encounter-addendum non-duplication, integrity `ok`, zero foreign-key violations, and a second pass that creates zero new business rows.

## Design verification

```text
design_runtime_files_created: 0
schema_migrations_created: 0
production_rows_written: 0
production_query_performed: false
production_mutation_performed: false
production_migration_applied: false
production_backfill_applied: false
provider_flag_enabled: false
route_changed: false
traffic_changed: false
deployment_performed: false
local_sync_activated: false
legacy_history_retired: false
remote_database_deleted: false
push_performed: false
cdb_to_main_integration_performed: false
```

## Exact next action

Implement `CDB-122B-CANONICAL-CLINICAL-DOCUMENT-DIAGNOSIS-SCHEMA` using TDD. Revalidate the next migration number after the latest main merge, then add one additive D1/SQLite migration and a dedicated Canonical Drizzle module for the six new table families. Reuse the existing `canonical_encounter_addenda`, enforce exact tenant-scoped references, immutable version/signature history, diagnosis events, attachment scope, controlled vocabularies, SHA-256 rules, and restricted deletion. Do not implement runtime commands, backfill, provider activation, or production changes in the schema checkpoint.
