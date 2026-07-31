# CDB-122 Clinical Document and Diagnosis Canonical Authority Plan

**Date:** 2026-07-27
**Program:** HMS Canonical Data Architecture
**Execution mode:** serial local checkpoints; production and live-route mutation prohibited

## Objective

Implement the design in `docs/superpowers/specs/2026-07-27-cdb-122a-clinical-document-diagnosis-authority-design.md` without creating competing encounter, prescription, observation, problem-list, discharge, filing, or finance authorities.

## Invariants for every checkpoint

- Use exact tenant-scoped patient-link, encounter, practitioner, source-table, and source-row evidence.
- Names, phone numbers, document text, diagnosis descriptions, file names, numeric coincidence, and timestamp proximity are never identity or merge evidence.
- Preserve signed/final history immutably.
- Draft replacement and amendments create new versions.
- Reuse `canonical_encounter_addenda`; never duplicate encounter-addendum authority.
- Diagnosis assertions are typed facts and are never inferred automatically from document narrative.
- Attachments remain metadata/content-hash authority separate from document body.
- Outbox, reconciliation, logs, receipts, and readiness evidence remain PHI-minimised.
- No hard delete of signed documents, signatures, attachments, diagnosis assertions, or events.
- Do not query/mutate production, deploy, activate flags, connect routes, activate sync, retire history, push, or integrate CDB into `main`.

## CDB-122A — Design and audit

### Deliverables

- `docs/database/audits/2026-07-27-clinical-document-diagnosis-authority-audit.md`
- `docs/superpowers/specs/2026-07-27-cdb-122a-clinical-document-diagnosis-authority-design.md`
- this plan
- `docs/database/migration-runs/P11-canonical-clinical-document-diagnosis-authority-design.md`
- `test/canonical/clinical-document-diagnosis-authority-design-contract.test.ts`
- authority-matrix/tracker/control-center/handoff updates

### Verification

- design contract tests;
- Canonical authority/governance checks;
- TypeScript;
- worktree policy;
- no runtime implementation.

### Completion checkpoint

`CDB-122A-CLINICAL-DOCUMENT-DIAGNOSIS-AUTHORITY-DESIGN-VERIFIED`

### Next checkpoint

`CDB-122B-CANONICAL-CLINICAL-DOCUMENT-DIAGNOSIS-SCHEMA`

## CDB-122B — Canonical schema

### Migration

Create one additive D1/SQLite migration, expected next migration number after repository revalidation, containing:

```text
canonical_clinical_documents
canonical_clinical_document_versions
canonical_clinical_document_signatures
canonical_clinical_document_attachments
canonical_diagnosis_assertions
canonical_diagnosis_status_events
```

Do not create a duplicate encounter-addendum table.

### Drizzle module

Add a dedicated Canonical clinical-document/diagnosis schema module and export it from the Canonical schema index.

### Required database rules

- tenant-scoped composite foreign keys to patient links, encounters, practitioners, documents, versions, and diagnoses;
- exact current-version ownership;
- immutable final/amendment version rules;
- unique version numbers and status-event versions;
- signature digest/content-hash parity fields;
- attachment scope parity and content-hash/MIME/size validation;
- code-system/code requirements;
- controlled document/status/diagnosis vocabularies;
- lower-case SHA-256 checks;
- no cascade delete of legal history;
- no foreign key that transfers encounter-addendum ownership.

### TDD

Write failing schema tests first. Prove:

- all six tables/indexes/constraints exist;
- invalid cross-tenant or cross-document references fail;
- invalid status/code/hash values fail;
- signed/final history cannot be cascade-deleted;
- `canonical_encounter_addenda` remains the existing authority;
- D1/SQLite compatibility and Drizzle exports.

### Completion checkpoint

`CDB-122B-CANONICAL-CLINICAL-DOCUMENT-DIAGNOSIS-SCHEMA-VERIFIED`

## CDB-122C — Commands

### Command module

Implement:

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

### Command behavior

- deterministic IDs when not supplied;
- exact replay before state-dependent validation;
- conflicting replay rejection;
- exact active patient/encounter/practitioner scope;
- optimistic aggregate/status versions;
- immutable final/amendment versions and signatures;
- explicit diagnosis lifecycle events;
- exact supporting-document scope for diagnoses;
- attachment content-hash/object provenance checks;
- atomic business rows, source mappings, PHI-minimised outbox, and batch assertions;
- rollback of every statement on any failure.

### Prohibited command behavior

- editing a signed/final version;
- deleting signed history;
- deriving a diagnosis from text;
- recording encounter status, prescription/order, observation/vital, result, problem-list, discharge, billing, or payment facts;
- copying object keys, filenames, or clinical content into outbox payloads.

### Completion checkpoint

`CDB-122C-CANONICAL-CLINICAL-DOCUMENT-DIAGNOSIS-COMMANDS-VERIFIED`

## CDB-122D — Bounded backfill and persistent reconciliation

### Backfill partitions

1. `clinical_notes` document headers;
2. `clinical_notes` versions/signatures;
3. `FormSOAP` documents;
4. `FormTreatmentPlan` documents;
5. selected signed legacy encounter snapshots;
6. `document_records` attachments;
7. `clinical_images` attachments;
8. `ClinicalDiagnosis` assertions/events;
9. `final_diagnosis` assertions/events;
10. projection/duplicate-source disposition.

Every partition uses a persistent migration run, checkpoint cursor, caller-supplied source limit, stable source fingerprint, deterministic IDs, and atomic per-source-row batches.

### Stable issues

Create deterministic issues for:

- missing/ambiguous encounter;
- missing/inactive author/signer/reviewer/asserting practitioner;
- signature/content mismatch;
- post-sign source mutation;
- invalid diagnosis code-system evidence;
- duplicate-looking text/code without exact lineage;
- attachment object/hash/scope problems;
- invalid version/addendum chain;
- patient/encounter mismatch.

Repeated execution reuses issue identity and increments occurrence count.

### Persistent reconciliation

Implement the 20 fixed checks from the design and persist one aggregate `canonical_reconciliation_runs` receipt. Include source fingerprint before/after, foreign-key violations, integrity status, unresolved critical issues, encounter-addendum non-duplication, and second-pass new business rows.

### Required proofs

- source rows unchanged;
- source fingerprints unchanged;
- no fabricated signatures;
- no diagnosis text inference;
- no duplicate encounter-addendum authority;
- commercial/workflow tables unchanged;
- integrity `ok`;
- FK violations 0;
- second pass creates zero new business rows.

### Completion checkpoint

`CDB-122D-CANONICAL-CLINICAL-DOCUMENT-DIAGNOSIS-BACKFILL-RECONCILIATION-VERIFIED`

## CDB-122E — Disabled providers and local readiness

### Provider flag

```text
canonical_clinical_document_diagnosis_provider_v1
```

Missing, disabled, malformed, or unsupported configuration resolves to `legacy`.

### Provider/adapters

Implement separate providers/adapters for:

- clinical document detail and immutable version history;
- diagnosis assertion list/detail;
- attachment metadata;
- encounter document timeline.

Canonical mode requires explicit source mapping plus exact patient/encounter/practitioner scope. Shadow mode returns the legacy response unchanged and emits aggregate counts/hash/latency/error evidence only.

### Reader inventory

Inventory and assign every reviewed reader, including clinical notes, doctor completion, patient chart/timeline/portal, health record/summary, MRD, nursing, OT, family-risk, sync, and encounter summary consumers. Unknown assignments must be zero before local readiness passes.

### Readiness gate

Local readiness requires:

- schema, commands, backfill, reconciliation, provider, adapters, and tests present;
- provider disabled by default;
- selected readers have local contracts;
- unknown assignments 0;
- production observation absent;
- route cutover false;
- production readiness false;
- legacy retirement blocked.

### Final completion checkpoint

`CDB-122E-CANONICAL-CLINICAL-DOCUMENT-DIAGNOSIS-AUTHORITY-VERIFIED`

## Verification cadence

At each checkpoint:

1. run focused TDD tests;
2. run TypeScript;
3. regenerate access and identity/episode registries when source readers/writers change;
4. run `pnpm canonical:check`;
5. run continuity contracts;
6. run complete Canonical suite at authority completion;
7. run local-sync and legacy-retirement readiness at authority completion;
8. run worktree policy and `git diff --check`;
9. create one clean checkpoint commit;
10. continue immediately to the next safe local checkpoint.

## Production gate

CDB-122 design and local implementation do not authorize:

- production query or mutation;
- migration/backfill against production;
- provider/feature-flag activation;
- live route or traffic changes;
- deployment;
- local sync activation;
- production shadow observation;
- deletion/retirement of legacy clinical history;
- remote database deletion;
- push or CDB-to-main integration.

Any future production stage requires a separately scoped, exact authorization bound to migration hashes, scripts, tenant scope, backups, observation thresholds, rollback, and stop conditions.
