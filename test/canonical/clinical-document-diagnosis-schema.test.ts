import { existsSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const migrationPath = 'migrations/0555_canonical_clinical_document_diagnosis.sql';
const schemaPath = 'src/db/schema/canonical/clinical-documents.ts';
const barrelPath = 'src/db/schema/canonical/index.ts';
const tables = [
  'canonical_clinical_document_attachments',
  'canonical_clinical_document_signatures',
  'canonical_clinical_document_versions',
  'canonical_clinical_documents',
  'canonical_diagnosis_assertions',
  'canonical_diagnosis_status_events',
];

function createDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const migration of [
    'migrations/0505_canonical_program_foundation.sql',
    'migrations/0506_canonical_practitioners.sql',
    'migrations/0507_canonical_encounters.sql',
    'migrations/0544_canonical_tenant_patient_links.sql',
    'migrations/0545_canonical_practitioner_operational_adoption.sql',
    'migrations/0548_canonical_encounter_admission_bed_convergence.sql',
    migrationPath,
  ]) db.exec(readFileSync(migration, 'utf8'));
  return db;
}

function seedDependencies(db: DatabaseSync): void {
  db.prepare(`
    INSERT INTO canonical_tenant_patient_links (
      tenant_id, patient_link_public_id, legacy_patient_id, link_status,
      verification_level, evidence_type, evidence_sha256, effective_from_utc, version
    ) VALUES ('tenant-a','patient-link-101',101,'unlinked','unverified','no_link_placeholder',?, ?,1)
  `).run('a'.repeat(64), '2026-07-28T08:00:00.000Z');

  db.prepare(`
    INSERT INTO canonical_practitioners (
      tenant_id, practitioner_public_id, practitioner_kind, display_name, status,
      version, source_evidence_sha256
    ) VALUES ('tenant-a','practitioner-101','internal','Doctor','active',1,?)
  `).run('b'.repeat(64));

  db.prepare(`
    INSERT INTO canonical_practitioners (
      tenant_id, practitioner_public_id, practitioner_kind, display_name, status,
      version, source_evidence_sha256
    ) VALUES ('tenant-a','practitioner-102','internal','Reviewer','active',1,?)
  `).run('c'.repeat(64));

  db.prepare(`
    INSERT INTO canonical_encounters (
      tenant_id, encounter_public_id, legacy_patient_id, patient_link_public_id,
      encounter_type, status, encounter_version, source_kind, started_at_utc,
      source_evidence_sha256
    ) VALUES ('tenant-a','encounter-101',101,'patient-link-101',
      'outpatient','in_progress',1,'runtime',?,?)
  `).run('2026-07-28T08:30:00.000Z', 'd'.repeat(64));
}

function insertDocument(db: DatabaseSync, overrides: Partial<Record<string, unknown>> = {}): void {
  const value = {
    tenantId: 'tenant-a',
    documentPublicId: 'document-101',
    patientLinkPublicId: 'patient-link-101',
    encounterPublicId: 'encounter-101',
    scopeKind: 'encounter',
    authoringPractitionerPublicId: 'practitioner-101',
    documentType: 'progress_note',
    currentVersionPublicId: null,
    currentStatus: 'draft',
    statusVersion: 1,
    confidentialityCode: 'normal',
    authoredAtUtc: '2026-07-28T09:00:00.000Z',
    finalizedAtUtc: null,
    enteredInErrorAtUtc: null,
    idempotencyKey: 'document-create-101',
    requestFingerprintSha256: 'e'.repeat(64),
    sourceEvidenceSha256: 'f'.repeat(64),
    ...overrides,
  };
  db.prepare(`
    INSERT INTO canonical_clinical_documents (
      tenant_id, document_public_id, patient_link_public_id, encounter_public_id,
      scope_kind, authoring_practitioner_public_id, document_type,
      current_version_public_id, current_status, status_version, confidentiality_code,
      authored_at_utc, finalized_at_utc, entered_in_error_at_utc,
      idempotency_key, request_fingerprint_sha256, source_evidence_sha256
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    value.tenantId, value.documentPublicId, value.patientLinkPublicId,
    value.encounterPublicId, value.scopeKind, value.authoringPractitionerPublicId,
    value.documentType, value.currentVersionPublicId, value.currentStatus,
    value.statusVersion, value.confidentialityCode, value.authoredAtUtc,
    value.finalizedAtUtc, value.enteredInErrorAtUtc, value.idempotencyKey,
    value.requestFingerprintSha256, value.sourceEvidenceSha256,
  );
}

function insertVersion(db: DatabaseSync, overrides: Partial<Record<string, unknown>> = {}): void {
  const value = {
    tenantId: 'tenant-a',
    versionPublicId: 'document-version-101-v1',
    documentPublicId: 'document-101',
    versionNumber: 1,
    supersedesVersionPublicId: null,
    versionKind: 'draft',
    contentFormat: 'plain_text',
    contentPayload: 'Protected clinical content',
    encryptedPayloadReference: null,
    encryptionKeyVersion: null,
    contentSha256: '1'.repeat(64),
    sectionManifestJson: null,
    authoringPractitionerPublicId: 'practitioner-101',
    actorUserPublicId: null,
    actorSystemKey: 'canonical.clinical.test',
    authoredAtUtc: '2026-07-28T09:00:00.000Z',
    finalizedAtUtc: null,
    sourceEvidenceSha256: '2'.repeat(64),
    ...overrides,
  };
  db.prepare(`
    INSERT INTO canonical_clinical_document_versions (
      tenant_id, version_public_id, document_public_id, version_number,
      supersedes_version_public_id, version_kind, content_format, content_payload,
      encrypted_payload_reference, encryption_key_version, content_sha256,
      section_manifest_json, authoring_practitioner_public_id, actor_user_public_id,
      actor_system_key, authored_at_utc, finalized_at_utc, source_evidence_sha256
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    value.tenantId, value.versionPublicId, value.documentPublicId, value.versionNumber,
    value.supersedesVersionPublicId, value.versionKind, value.contentFormat,
    value.contentPayload, value.encryptedPayloadReference, value.encryptionKeyVersion,
    value.contentSha256, value.sectionManifestJson, value.authoringPractitionerPublicId,
    value.actorUserPublicId, value.actorSystemKey, value.authoredAtUtc,
    value.finalizedAtUtc, value.sourceEvidenceSha256,
  );
}

function insertSignature(db: DatabaseSync, overrides: Partial<Record<string, unknown>> = {}): void {
  const value = {
    tenantId: 'tenant-a',
    signaturePublicId: 'signature-101',
    documentPublicId: 'document-101',
    versionPublicId: 'document-version-101-v1',
    signerPractitionerPublicId: 'practitioner-101',
    actorUserPublicId: null,
    signatureMethod: 'authenticated_attestation',
    signedContentSha256: '1'.repeat(64),
    attestationSha256: '3'.repeat(64),
    signingKeyReference: null,
    signedAtUtc: '2026-07-28T09:10:00.000Z',
    sourceEvidenceSha256: '4'.repeat(64),
    ...overrides,
  };
  db.prepare(`
    INSERT INTO canonical_clinical_document_signatures (
      tenant_id, signature_public_id, document_public_id, version_public_id,
      signer_practitioner_public_id, actor_user_public_id, signature_method,
      signed_content_sha256, attestation_sha256, signing_key_reference,
      signed_at_utc, source_evidence_sha256
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    value.tenantId, value.signaturePublicId, value.documentPublicId,
    value.versionPublicId, value.signerPractitionerPublicId, value.actorUserPublicId,
    value.signatureMethod, value.signedContentSha256, value.attestationSha256,
    value.signingKeyReference, value.signedAtUtc, value.sourceEvidenceSha256,
  );
}

function insertDiagnosis(db: DatabaseSync, overrides: Partial<Record<string, unknown>> = {}): void {
  const value = {
    tenantId: 'tenant-a',
    diagnosisPublicId: 'diagnosis-101',
    patientLinkPublicId: 'patient-link-101',
    encounterPublicId: 'encounter-101',
    assertingPractitionerPublicId: 'practitioner-101',
    supportingDocumentPublicId: 'document-101',
    supportingVersionPublicId: 'document-version-101-v1',
    codeSystem: 'icd10',
    codeSystemVersion: '2026',
    code: 'A00',
    displaySnapshot: 'Protected diagnosis display',
    codingPublicId: null,
    diagnosisRole: 'primary',
    certainty: 'confirmed',
    clinicalStatus: 'active',
    verificationStatus: 'verified',
    statusVersion: 1,
    assertedAtUtc: '2026-07-28T09:15:00.000Z',
    reviewedAtUtc: '2026-07-28T09:16:00.000Z',
    resolvedAtUtc: null,
    enteredInErrorAtUtc: null,
    idempotencyKey: 'diagnosis-create-101',
    requestFingerprintSha256: '5'.repeat(64),
    sourceEvidenceSha256: '6'.repeat(64),
    ...overrides,
  };
  db.prepare(`
    INSERT INTO canonical_diagnosis_assertions (
      tenant_id, diagnosis_public_id, patient_link_public_id, encounter_public_id,
      asserting_practitioner_public_id, supporting_document_public_id,
      supporting_version_public_id, code_system, code_system_version, code,
      display_snapshot, coding_public_id, diagnosis_role, certainty, clinical_status,
      verification_status, status_version, asserted_at_utc, reviewed_at_utc,
      resolved_at_utc, entered_in_error_at_utc, idempotency_key,
      request_fingerprint_sha256, source_evidence_sha256
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    value.tenantId, value.diagnosisPublicId, value.patientLinkPublicId,
    value.encounterPublicId, value.assertingPractitionerPublicId,
    value.supportingDocumentPublicId, value.supportingVersionPublicId,
    value.codeSystem, value.codeSystemVersion, value.code, value.displaySnapshot,
    value.codingPublicId, value.diagnosisRole, value.certainty, value.clinicalStatus,
    value.verificationStatus, value.statusVersion, value.assertedAtUtc,
    value.reviewedAtUtc, value.resolvedAtUtc, value.enteredInErrorAtUtc,
    value.idempotencyKey, value.requestFingerprintSha256, value.sourceEvidenceSha256,
  );
}

describe('canonical clinical document and diagnosis schema', () => {
  it('reserves migration 0555, a dedicated Drizzle module, and the canonical barrel export', () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(existsSync(schemaPath)).toBe(true);
    expect(existsSync(barrelPath)).toBe(true);
    if (!existsSync(schemaPath) || !existsSync(barrelPath)) return;
    const schema = readFileSync(schemaPath, 'utf8');
    const barrel = readFileSync(barrelPath, 'utf8');
    for (const table of tables) expect(schema).toContain(`'${table}'`);
    expect(barrel).toContain("export * from './clinical-documents';");
  });

  it('creates exactly six new table families and does not duplicate encounter addenda', () => {
    const db = createDatabase();
    try {
      const actual = (db.prepare(`
        SELECT name FROM sqlite_schema
        WHERE type='table' AND name IN (
          'canonical_clinical_documents',
          'canonical_clinical_document_versions',
          'canonical_clinical_document_signatures',
          'canonical_clinical_document_attachments',
          'canonical_diagnosis_assertions',
          'canonical_diagnosis_status_events'
        )
        ORDER BY name
      `).all() as Array<{ name: string }>).map((row) => row.name);
      expect(actual).toEqual(tables);
      const addendaCount = db.prepare(`
        SELECT COUNT(*) AS count FROM sqlite_schema
        WHERE type='table' AND name='canonical_encounter_addenda'
      `).get() as { count: number };
      expect(addendaCount.count).toBe(1);
    } finally {
      db.close();
    }
  });

  it('enforces document scope, immutable versions, current-version ownership, and signature hash parity', () => {
    const db = createDatabase();
    try {
      seedDependencies(db);
      insertDocument(db);
      insertVersion(db);
      expect(() => insertVersion(db, {
        versionPublicId: 'document-version-direct-final',
        versionNumber: 2,
        versionKind: 'final',
        finalizedAtUtc: '2026-07-28T09:05:00.000Z',
        contentSha256: '7'.repeat(64),
      })).toThrow(/must start as draft/i);
      db.prepare(`
        UPDATE canonical_clinical_documents
        SET current_version_public_id='document-version-101-v1'
        WHERE tenant_id='tenant-a' AND document_public_id='document-101'
      `).run();
      insertSignature(db);

      expect(() => insertDocument(db, {
        documentPublicId: 'document-bad-scope',
        idempotencyKey: 'document-bad-scope',
        scopeKind: 'patient',
        encounterPublicId: 'encounter-101',
      })).toThrow(/CHECK constraint failed/);
      expect(() => insertDocument(db, {
        documentPublicId: 'document-bad-hash',
        idempotencyKey: 'document-bad-hash',
        sourceEvidenceSha256: 'A'.repeat(64),
      })).toThrow(/CHECK constraint failed/);
      expect(() => insertVersion(db, {
        versionPublicId: 'document-version-bad-number',
        versionNumber: 1,
        contentSha256: '7'.repeat(64),
      })).toThrow(/UNIQUE constraint failed/);
      expect(() => insertSignature(db, {
        signaturePublicId: 'signature-bad-content',
        signerPractitionerPublicId: 'practitioner-102',
        signedContentSha256: '8'.repeat(64),
        attestationSha256: '9'.repeat(64),
      })).toThrow(/FOREIGN KEY constraint failed/);
      expect(() => db.prepare(`
        UPDATE canonical_clinical_document_versions
        SET content_payload='changed'
        WHERE tenant_id='tenant-a' AND version_public_id='document-version-101-v1'
      `).run()).toThrow(/immutable/i);
      expect(() => db.prepare(`
        DELETE FROM canonical_clinical_document_signatures
        WHERE tenant_id='tenant-a' AND signature_public_id='signature-101'
      `).run()).toThrow(/immutable/i);
    } finally {
      db.close();
    }
  });

  it('enforces attachment document/version/patient/encounter parity and no hard delete', () => {
    const db = createDatabase();
    try {
      seedDependencies(db);
      insertDocument(db);
      insertVersion(db);
      db.prepare(`
        INSERT INTO canonical_clinical_document_attachments (
          tenant_id, attachment_public_id, document_public_id, version_public_id,
          patient_link_public_id, encounter_public_id, attachment_type, body_part_code,
          storage_provider, object_reference, content_sha256, file_size_bytes, mime_type,
          original_filename, uploader_practitioner_public_id, uploader_user_public_id,
          uploader_system_key, lifecycle_status, source_evidence_sha256
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        'tenant-a','attachment-101','document-101','document-version-101-v1',
        'patient-link-101','encounter-101','clinical_image',null,'r2','opaque-object-ref',
        'a'.repeat(64),100,'image/png','display.png','practitioner-101',null,null,
        'active','b'.repeat(64),
      );
      expect(() => db.prepare(`
        INSERT INTO canonical_clinical_document_attachments (
          tenant_id, attachment_public_id, document_public_id, version_public_id,
          patient_link_public_id, encounter_public_id, attachment_type, storage_provider,
          object_reference, content_sha256, file_size_bytes, mime_type, lifecycle_status,
          source_evidence_sha256
        ) VALUES ('tenant-a','attachment-bad','document-101','document-version-101-v1',
          'patient-link-101',NULL,'clinical_image','r2','opaque-ref',?,1,'image/png','active',?)
      `).run('c'.repeat(64), 'd'.repeat(64))).toThrow(/FOREIGN KEY constraint failed|CHECK constraint failed/);
      expect(() => db.prepare(`
        DELETE FROM canonical_clinical_document_attachments
        WHERE tenant_id='tenant-a' AND attachment_public_id='attachment-101'
      `).run()).toThrow(/immutable|restricted/i);
    } finally {
      db.close();
    }
  });

  it('enforces coded diagnosis scope, supporting-version parity, event versions, and immutable event history', () => {
    const db = createDatabase();
    try {
      seedDependencies(db);
      insertDocument(db);
      insertVersion(db);
      insertDiagnosis(db);
      db.prepare(`
        INSERT INTO canonical_diagnosis_status_events (
          tenant_id,event_public_id,diagnosis_public_id,from_verification_status,
          to_verification_status,from_clinical_status,to_clinical_status,event_version,
          event_type,reason_code,actor_practitioner_public_id,actor_user_public_id,
          actor_system_key,occurred_at_utc,source_evidence_sha256
        ) VALUES ('tenant-a','diagnosis-event-101','diagnosis-101',NULL,'verified',NULL,
          'active',1,'asserted','initial','practitioner-101',NULL,NULL,?,?)
      `).run('2026-07-28T09:15:00.000Z', 'e'.repeat(64));

      expect(() => insertDiagnosis(db, {
        diagnosisPublicId: 'diagnosis-bad-code-system',
        idempotencyKey: 'diagnosis-bad-code-system',
        codeSystem: 'free_text',
      })).toThrow(/CHECK constraint failed/);
      expect(() => insertDiagnosis(db, {
        diagnosisPublicId: 'diagnosis-bad-support',
        idempotencyKey: 'diagnosis-bad-support',
        supportingVersionPublicId: 'missing-version',
      })).toThrow(/FOREIGN KEY constraint failed/);
      expect(() => db.prepare(`
        INSERT INTO canonical_diagnosis_status_events (
          tenant_id,event_public_id,diagnosis_public_id,to_verification_status,
          to_clinical_status,event_version,event_type,reason_code,
          actor_system_key,occurred_at_utc,source_evidence_sha256
        ) VALUES ('tenant-a','diagnosis-event-duplicate','diagnosis-101','verified',
          'active',1,'reviewed','duplicate','test',?,?)
      `).run('2026-07-28T09:16:00.000Z', 'f'.repeat(64))).toThrow(/UNIQUE constraint failed/);
      expect(() => db.prepare(`
        DELETE FROM canonical_diagnosis_status_events
        WHERE tenant_id='tenant-a' AND event_public_id='diagnosis-event-101'
      `).run()).toThrow(/immutable/i);
      expect(() => db.prepare(`
        DELETE FROM canonical_diagnosis_assertions
        WHERE tenant_id='tenant-a' AND diagnosis_public_id='diagnosis-101'
      `).run()).toThrow(/FOREIGN KEY constraint failed|restricted/i);
    } finally {
      db.close();
    }
  });
});
