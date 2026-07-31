# P11 Canonical Clinical Document and Diagnosis Authority Receipt

**Checkpoint:** `CDB-122E-CANONICAL-CLINICAL-DOCUMENT-DIAGNOSIS-AUTHORITY-VERIFIED`

**Date:** 2026-07-28

**Status:** completed and verified locally; uncommitted because the active connector exposes no Git commit action

## Implemented authority

- Migration `0555_canonical_clinical_document_diagnosis.sql` creates six additive Canonical table families.
- Existing `canonical_encounter_addenda` remains the sole encounter-addendum authority.
- Clinical document versions, signatures and diagnosis lifecycle events are immutable history.
- Clinical document versions must start as drafts and can become final/amendment only through a matching signature hash.
- Exact tenant, patient-link, encounter and practitioner scope is enforced.
- Narrative similarity, numeric coincidence and time proximity are never identity proof.
- Attachment storage references remain metadata and require exact document/version scope.
- Diagnosis assertions require coded evidence and immutable status events.

## Canonical tables

1. `canonical_clinical_documents`
2. `canonical_clinical_document_versions`
3. `canonical_clinical_document_signatures`
4. `canonical_clinical_document_attachments`
5. `canonical_diagnosis_assertions`
6. `canonical_diagnosis_status_events`

## Commands

1. `createCanonicalClinicalDocumentDraft`
2. `replaceCanonicalClinicalDocumentDraft`
3. `signCanonicalClinicalDocument`
4. `amendCanonicalClinicalDocument`
5. `enterCanonicalClinicalDocumentInError`
6. `attachCanonicalClinicalDocumentArtifact`
7. `assertCanonicalDiagnosis`
8. `reviewCanonicalDiagnosis`
9. `transitionCanonicalDiagnosis`

All commands use deterministic identity, tenant-scoped idempotency, replay-before-state-validation, optimistic versioning, source mappings, atomic authoritative statements, durable outbox intent and PHI-minimised event payloads.

## Backfill and reconciliation

The bounded backfill uses ten persistent resumable partitions:

1. clinical note headers;
2. clinical note versions/signatures;
3. SOAP documents;
4. treatment-plan documents;
5. signed encounter snapshots;
6. document-record attachment disposition;
7. clinical-image attachments;
8. clinical diagnosis assertions;
9. final-diagnosis disposition;
10. duplicate projection disposition.

Ambiguous source rows become deterministic non-PHI processing issues. Source tables remain read-only.

The reconciliation receipt contains exactly twenty fail-closed checks covering source identity, patient/encounter/practitioner scope, current-version ownership, signatures, hashes, attachments, diagnoses, event sequence, duplicate addendum authority, critical issues, source fingerprint, foreign keys, integrity and second-pass idempotency.

## Provider and readiness

- Flag: `canonical_clinical_document_diagnosis_provider_v1`
- Supported modes: `legacy`, `shadow`, `canonical`
- Enabled by default: no
- Default mode: `legacy`
- Rollback mode: `legacy`
- Selected library adapters: 2
- Reviewed reader assignments: 4
- Runtime route activations: 0
- Unknown reader assignments: 0
- Shadow evidence is aggregate-only and PHI-minimised.
- Canonical mode fails closed without exact source mappings.

## Verification

- CDB-122 focused and governance suite: 9 files, 45 tests passed.
- TypeScript: `pnpm exec tsc --noEmit` passed.
- Migration build: `pnpm build:migrations` passed with 490 migrations.
- Readiness validator: local ready, production not ready.
- SQLite experimental warnings only; no test failures.

## External gates and prohibited actions

- Production migration/backfill: not performed.
- Production query/mutation: not performed.
- Provider enablement or route cutover: not performed.
- Production observation: absent.
- Owner production authorization: absent.
- Legacy retirement: not approved.
- Local sync activation: not performed.
- Push: not performed.
- CDB-to-main integration: not performed.

Production activation and legacy retirement remain blocked external gates. Local implementation completion does not authorize either action.
