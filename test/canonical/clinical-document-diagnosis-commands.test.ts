import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { CanonicalBatchDatabase, CanonicalPreparedStatement } from '../../src/lib/canonical/command-batch';
import { CanonicalIdempotencyConflictError } from '../../src/lib/canonical/idempotency';
import {
  amendCanonicalClinicalDocument,
  assertCanonicalDiagnosis,
  attachCanonicalClinicalDocumentArtifact,
  createCanonicalClinicalDocumentDraft,
  enterCanonicalClinicalDocumentInError,
  replaceCanonicalClinicalDocumentDraft,
  reviewCanonicalDiagnosis,
  signCanonicalClinicalDocument,
  transitionCanonicalDiagnosis,
  type CreateCanonicalClinicalDocumentDraftInput,
} from '../../src/lib/canonical/commands/manage-clinical-document-diagnosis';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements CanonicalPreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    readonly sql: string,
    readonly params: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): Statement {
    return new Statement(
      this.database,
      this.sql,
      values.map((value) => (value === undefined ? null : value)) as SqlValue[],
    );
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.params);
    return {
      success: true,
      meta: {
        changes: Number(result.changes ?? 0),
        last_row_id: Number(result.lastInsertRowid ?? 0),
      },
    };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
}

function harness(): { sqlite: DatabaseSync; db: CanonicalBatchDatabase } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  for (const migration of [
    'migrations/0505_canonical_program_foundation.sql',
    'migrations/0506_canonical_practitioners.sql',
    'migrations/0507_canonical_encounters.sql',
    'migrations/0544_canonical_tenant_patient_links.sql',
    'migrations/0545_canonical_practitioner_operational_adoption.sql',
    'migrations/0548_canonical_encounter_admission_bed_convergence.sql',
    'migrations/0555_canonical_clinical_document_diagnosis.sql',
  ]) sqlite.exec(readFileSync(migration, 'utf8'));
  sqlite.exec(`
    CREATE TABLE legacy_clinical_compat (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      marker TEXT NOT NULL UNIQUE
    )
  `);
  const db: CanonicalBatchDatabase = {
    prepare(sql: string) {
      return new Statement(sqlite, sql);
    },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  seedDependencies(sqlite);
  return { sqlite, db };
}

function seedDependencies(sqlite: DatabaseSync): void {
  sqlite.prepare(`
    INSERT INTO canonical_tenant_patient_links (
      tenant_id,patient_link_public_id,legacy_patient_id,link_status,
      verification_level,evidence_type,evidence_sha256,effective_from_utc,version
    ) VALUES ('tenant-a','patient-link-101',101,'unlinked','unverified',
              'no_link_placeholder',?,?,1)
  `).run('1'.repeat(64), '2026-07-28T08:00:00.000Z');
  for (const [id, name, hash] of [
    ['practitioner-101', 'Author', '2'],
    ['practitioner-102', 'Signer', '3'],
    ['practitioner-103', 'Reviewer', '4'],
  ]) {
    sqlite.prepare(`
      INSERT INTO canonical_practitioners (
        tenant_id,practitioner_public_id,practitioner_kind,display_name,status,
        version,source_evidence_sha256
      ) VALUES ('tenant-a',?,'internal',?,'active',1,?)
    `).run(id, name, hash.repeat(64));
  }
  sqlite.prepare(`
    INSERT INTO canonical_encounters (
      tenant_id,encounter_public_id,legacy_patient_id,patient_link_public_id,
      encounter_type,status,encounter_version,source_kind,started_at_utc,source_evidence_sha256
    ) VALUES ('tenant-a','encounter-101',101,'patient-link-101',
              'outpatient','in_progress',1,'runtime',?,?)
  `).run('2026-07-28T08:30:00.000Z', '5'.repeat(64));
}

function createInput(
  overrides: Partial<CreateCanonicalClinicalDocumentDraftInput> = {},
): CreateCanonicalClinicalDocumentDraftInput {
  return {
    tenantId: 'tenant-a',
    documentPublicId: 'document-101',
    versionPublicId: 'document-version-101-v1',
    patientLinkPublicId: 'patient-link-101',
    encounterPublicId: 'encounter-101',
    scopeKind: 'encounter',
    authoringPractitionerPublicId: 'practitioner-101',
    documentType: 'progress_note',
    confidentialityCode: 'normal',
    contentFormat: 'plain_text',
    contentPayload: 'Sensitive clinical narrative',
    contentSha256: '6'.repeat(64),
    authoredAtUtc: '2026-07-28T09:00:00.000Z',
    sourceType: 'clinical_note',
    sourcePublicId: '501',
    sourceTable: 'clinical_notes',
    sourceEvidenceSha256: '7'.repeat(64),
    actorSystemKey: 'canonical.clinical.test',
    idempotencyKey: 'clinical-document-create-101',
    eventPublicId: 'clinical-document-outbox-create-101',
    occurredAtUtc: '2026-07-28T09:00:00.000Z',
    businessDate: '2026-07-28',
    ...overrides,
  };
}

function count(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
}

async function createDraft(db: CanonicalBatchDatabase): Promise<void> {
  await createCanonicalClinicalDocumentDraft(db, createInput());
}

async function signDraft(db: CanonicalBatchDatabase): Promise<void> {
  await createDraft(db);
  await signCanonicalClinicalDocument(db, {
    tenantId: 'tenant-a',
    documentPublicId: 'document-101',
    expectedVersion: 1,
    versionPublicId: 'document-version-101-v1',
    signerPractitionerPublicId: 'practitioner-102',
    signaturePublicId: 'signature-101-v1',
    signatureMethod: 'authenticated_attestation',
    signedContentSha256: '6'.repeat(64),
    attestationSha256: '8'.repeat(64),
    sourceType: 'clinical_note_signature',
    sourcePublicId: '501:signature',
    sourceTable: 'clinical_notes',
    sourceEvidenceSha256: '9'.repeat(64),
    actorSystemKey: 'canonical.clinical.test',
    idempotencyKey: 'clinical-document-sign-101',
    eventPublicId: 'clinical-document-outbox-sign-101',
    occurredAtUtc: '2026-07-28T09:10:00.000Z',
    businessDate: '2026-07-28',
  });
}

describe('canonical clinical document and diagnosis commands', () => {
  it('atomically creates a document draft, immutable version, source mappings, compatibility write, and PHI-minimised outbox', async () => {
    const { sqlite, db } = harness();
    try {
      const compatibility = db.prepare(`INSERT INTO legacy_clinical_compat(marker) VALUES (?)`)
        .bind('clinical-note-501');
      await expect(createCanonicalClinicalDocumentDraft(db, createInput(), {
        authoritativeStatements: [compatibility],
      })).resolves.toEqual({
        status: 'applied',
        result: {
          documentPublicId: 'document-101',
          currentVersionPublicId: 'document-version-101-v1',
          currentStatus: 'draft',
          statusVersion: 1,
        },
      });

      expect(count(sqlite, 'canonical_clinical_documents')).toBe(1);
      expect(count(sqlite, 'canonical_clinical_document_versions')).toBe(1);
      expect(count(sqlite, 'canonical_source_mappings')).toBe(2);
      expect(count(sqlite, 'legacy_clinical_compat')).toBe(1);
      expect(sqlite.prepare(`
        SELECT patient_link_public_id,encounter_public_id,authoring_practitioner_public_id,
               current_version_public_id,current_status,status_version
        FROM canonical_clinical_documents
      `).get()).toEqual({
        patient_link_public_id: 'patient-link-101',
        encounter_public_id: 'encounter-101',
        authoring_practitioner_public_id: 'practitioner-101',
        current_version_public_id: 'document-version-101-v1',
        current_status: 'draft',
        status_version: 1,
      });
      const outbox = sqlite.prepare(`SELECT event_type,payload_json FROM canonical_outbox_events`).get() as Record<string, string>;
      expect(outbox.event_type).toBe('canonical.clinical-document.draft-created');
      for (const forbidden of [
        'Sensitive clinical narrative', 'patient-link-101', 'encounter-101',
        'practitioner-101', 'clinical_notes', '501',
      ]) expect(outbox.payload_json).not.toContain(forbidden);
    } finally {
      sqlite.close();
    }
  });

  it('uses deterministic IDs, replays identical create requests, rejects conflicting replay, and rolls back authoritative writes', async () => {
    const { sqlite, db } = harness();
    try {
      const deterministic = createInput({
        documentPublicId: undefined,
        versionPublicId: undefined,
        eventPublicId: undefined,
      });
      const first = await createCanonicalClinicalDocumentDraft(db, deterministic);
      const second = await createCanonicalClinicalDocumentDraft(db, deterministic);
      expect(first.status).toBe('applied');
      expect(second).toEqual({ status: 'replayed', result: first.result });
      expect(first.result.documentPublicId).toMatch(/^cldoc_/);
      expect(first.result.currentVersionPublicId).toMatch(/^cldver_/);
      await expect(createCanonicalClinicalDocumentDraft(db, {
        ...deterministic,
        contentSha256: 'a'.repeat(64),
      })).rejects.toBeInstanceOf(CanonicalIdempotencyConflictError);

      const rollback = harness();
      try {
        const compatibility = rollback.db.prepare(`INSERT INTO legacy_clinical_compat(marker) VALUES (?)`)
          .bind('must-rollback');
        await expect(createCanonicalClinicalDocumentDraft(rollback.db, createInput({
          idempotencyKey: 'clinical-document-create-rollback',
          eventPublicId: 'clinical-document-outbox-create-rollback',
        }), {
          authoritativeStatements: [compatibility, rollback.db.prepare('INSERT INTO missing_table(x) VALUES (1)')],
        })).rejects.toThrow();
        expect(count(rollback.sqlite, 'canonical_clinical_documents')).toBe(0);
        expect(count(rollback.sqlite, 'canonical_outbox_events')).toBe(0);
        expect(count(rollback.sqlite, 'legacy_clinical_compat')).toBe(0);
      } finally {
        rollback.sqlite.close();
      }
    } finally {
      sqlite.close();
    }
  });

  it('replaces a draft with a new immutable version and enforces optimistic versioning', async () => {
    const { sqlite, db } = harness();
    try {
      await createDraft(db);
      await expect(replaceCanonicalClinicalDocumentDraft(db, {
        tenantId: 'tenant-a',
        documentPublicId: 'document-101',
        expectedVersion: 1,
        versionPublicId: 'document-version-101-v2',
        contentFormat: 'plain_text',
        contentPayload: 'Updated sensitive narrative',
        contentSha256: 'a'.repeat(64),
        sourceType: 'clinical_note',
        sourcePublicId: '501:v2',
        sourceTable: 'clinical_notes',
        sourceEvidenceSha256: 'b'.repeat(64),
        actorSystemKey: 'canonical.clinical.test',
        idempotencyKey: 'clinical-document-replace-101',
        eventPublicId: 'clinical-document-outbox-replace-101',
        occurredAtUtc: '2026-07-28T09:05:00.000Z',
        businessDate: '2026-07-28',
      })).resolves.toMatchObject({
        status: 'applied',
        result: {
          currentVersionPublicId: 'document-version-101-v2',
          currentStatus: 'draft',
          statusVersion: 2,
        },
      });
      expect(count(sqlite, 'canonical_clinical_document_versions')).toBe(2);
      expect(sqlite.prepare(`
        SELECT version_number,supersedes_version_public_id,version_kind
        FROM canonical_clinical_document_versions ORDER BY version_number
      `).all()).toEqual([
        { version_number: 1, supersedes_version_public_id: null, version_kind: 'draft' },
        { version_number: 2, supersedes_version_public_id: 'document-version-101-v1', version_kind: 'draft' },
      ]);
      await expect(replaceCanonicalClinicalDocumentDraft(db, {
        tenantId: 'tenant-a',
        documentPublicId: 'document-101',
        expectedVersion: 1,
        contentFormat: 'plain_text',
        contentPayload: 'Conflict',
        contentSha256: 'c'.repeat(64),
        sourceType: 'clinical_note',
        sourcePublicId: '501:v3',
        sourceTable: 'clinical_notes',
        sourceEvidenceSha256: 'd'.repeat(64),
        actorSystemKey: 'canonical.clinical.test',
        idempotencyKey: 'clinical-document-replace-conflict',
        occurredAtUtc: '2026-07-28T09:06:00.000Z',
        businessDate: '2026-07-28',
      })).rejects.toThrow(/version conflict/i);
    } finally {
      sqlite.close();
    }
  });

  it('signs the exact draft version, preserves content hash parity, and supports replay before state validation', async () => {
    const { sqlite, db } = harness();
    try {
      await createDraft(db);
      const input = {
        tenantId: 'tenant-a',
        documentPublicId: 'document-101',
        expectedVersion: 1,
        versionPublicId: 'document-version-101-v1',
        signerPractitionerPublicId: 'practitioner-102',
        signaturePublicId: 'signature-101-v1',
        signatureMethod: 'authenticated_attestation' as const,
        signedContentSha256: '6'.repeat(64),
        attestationSha256: '8'.repeat(64),
        sourceType: 'clinical_note_signature',
        sourcePublicId: '501:signature',
        sourceTable: 'clinical_notes',
        sourceEvidenceSha256: '9'.repeat(64),
        actorSystemKey: 'canonical.clinical.test',
        idempotencyKey: 'clinical-document-sign-101',
        eventPublicId: 'clinical-document-outbox-sign-101',
        occurredAtUtc: '2026-07-28T09:10:00.000Z',
        businessDate: '2026-07-28',
      };
      const first = await signCanonicalClinicalDocument(db, input);
      const replay = await signCanonicalClinicalDocument(db, input);
      expect(first).toMatchObject({ status: 'applied', result: { currentStatus: 'final', statusVersion: 2 } });
      expect(replay).toEqual({ status: 'replayed', result: first.result });
      expect(count(sqlite, 'canonical_clinical_document_signatures')).toBe(1);
      expect(sqlite.prepare(`
        SELECT current_status,status_version,finalized_at_utc FROM canonical_clinical_documents
      `).get()).toEqual({
        current_status: 'final',
        status_version: 2,
        finalized_at_utc: '2026-07-28T09:10:00.000Z',
      });
      expect(sqlite.prepare(`
        SELECT version_kind,finalized_at_utc FROM canonical_clinical_document_versions
      `).get()).toEqual({ version_kind: 'final', finalized_at_utc: '2026-07-28T09:10:00.000Z' });
    } finally {
      sqlite.close();
    }
  });

  it('amends a final document with a signed superseding version and enters it in error without deleting history', async () => {
    const { sqlite, db } = harness();
    try {
      await signDraft(db);
      await expect(amendCanonicalClinicalDocument(db, {
        tenantId: 'tenant-a',
        documentPublicId: 'document-101',
        expectedVersion: 2,
        versionPublicId: 'document-version-101-v2',
        signaturePublicId: 'signature-101-v2',
        signerPractitionerPublicId: 'practitioner-102',
        signatureMethod: 'authenticated_attestation',
        contentFormat: 'plain_text',
        contentPayload: 'Amended sensitive narrative',
        contentSha256: 'a'.repeat(64),
        attestationSha256: 'b'.repeat(64),
        sourceType: 'clinical_note_amendment',
        sourcePublicId: '501:amendment:1',
        sourceTable: 'clinical_notes',
        sourceEvidenceSha256: 'c'.repeat(64),
        actorSystemKey: 'canonical.clinical.test',
        idempotencyKey: 'clinical-document-amend-101',
        eventPublicId: 'clinical-document-outbox-amend-101',
        occurredAtUtc: '2026-07-28T09:20:00.000Z',
        businessDate: '2026-07-28',
      })).resolves.toMatchObject({ status: 'applied', result: { currentStatus: 'amended', statusVersion: 3 } });
      expect(count(sqlite, 'canonical_clinical_document_versions')).toBe(2);
      expect(count(sqlite, 'canonical_clinical_document_signatures')).toBe(2);

      await expect(enterCanonicalClinicalDocumentInError(db, {
        tenantId: 'tenant-a',
        documentPublicId: 'document-101',
        expectedVersion: 3,
        reasonCode: 'wrong_patient_context',
        actorPractitionerPublicId: 'practitioner-103',
        actorSystemKey: 'canonical.clinical.test',
        sourceEvidenceSha256: 'd'.repeat(64),
        idempotencyKey: 'clinical-document-error-101',
        eventPublicId: 'clinical-document-outbox-error-101',
        occurredAtUtc: '2026-07-28T09:30:00.000Z',
        businessDate: '2026-07-28',
      })).resolves.toMatchObject({ status: 'applied', result: { currentStatus: 'entered_in_error', statusVersion: 4 } });
      expect(count(sqlite, 'canonical_clinical_document_versions')).toBe(2);
      expect(count(sqlite, 'canonical_clinical_document_signatures')).toBe(2);
    } finally {
      sqlite.close();
    }
  });

  it('attaches exact scoped artifact metadata without exposing object references in outbox', async () => {
    const { sqlite, db } = harness();
    try {
      await createDraft(db);
      await expect(attachCanonicalClinicalDocumentArtifact(db, {
        tenantId: 'tenant-a',
        documentPublicId: 'document-101',
        versionPublicId: 'document-version-101-v1',
        attachmentPublicId: 'attachment-101',
        attachmentType: 'clinical_image',
        bodyPartCode: 'CHEST',
        storageProvider: 'r2',
        objectReference: 'private/object/key',
        contentSha256: 'e'.repeat(64),
        fileSizeBytes: 1024,
        mimeType: 'image/png',
        originalFilename: 'sensitive-name.png',
        uploaderPractitionerPublicId: 'practitioner-101',
        sourceType: 'clinical_image',
        sourcePublicId: '701',
        sourceTable: 'clinical_images',
        sourceEvidenceSha256: 'f'.repeat(64),
        actorSystemKey: 'canonical.clinical.test',
        idempotencyKey: 'clinical-document-attachment-101',
        eventPublicId: 'clinical-document-outbox-attachment-101',
        occurredAtUtc: '2026-07-28T09:04:00.000Z',
        businessDate: '2026-07-28',
      })).resolves.toMatchObject({ status: 'applied', result: { attachmentPublicId: 'attachment-101' } });
      expect(count(sqlite, 'canonical_clinical_document_attachments')).toBe(1);
      const outbox = sqlite.prepare(`
        SELECT payload_json FROM canonical_outbox_events
        WHERE idempotency_key='clinical-document-attachment-101'
      `).get() as { payload_json: string };
      expect(outbox.payload_json).not.toContain('private/object/key');
      expect(outbox.payload_json).not.toContain('sensitive-name.png');
    } finally {
      sqlite.close();
    }
  });

  it('asserts, reviews, resolves, and replays diagnosis lifecycle with immutable event versions', async () => {
    const { sqlite, db } = harness();
    try {
      await createDraft(db);
      const asserted = await assertCanonicalDiagnosis(db, {
        tenantId: 'tenant-a',
        diagnosisPublicId: 'diagnosis-101',
        diagnosisEventPublicId: 'diagnosis-event-101-v1',
        patientLinkPublicId: 'patient-link-101',
        encounterPublicId: 'encounter-101',
        assertingPractitionerPublicId: 'practitioner-101',
        supportingDocumentPublicId: 'document-101',
        supportingVersionPublicId: 'document-version-101-v1',
        codeSystem: 'icd10',
        codeSystemVersion: '2026',
        code: 'A00',
        displaySnapshot: 'Sensitive diagnosis display',
        diagnosisRole: 'primary',
        certainty: 'probable',
        clinicalStatus: 'active',
        verificationStatus: 'provisional',
        sourceType: 'clinical_diagnosis',
        sourcePublicId: '801',
        sourceTable: 'ClinicalDiagnosis',
        sourceEvidenceSha256: 'a'.repeat(64),
        actorSystemKey: 'canonical.clinical.test',
        idempotencyKey: 'diagnosis-assert-101',
        eventPublicId: 'diagnosis-outbox-assert-101',
        occurredAtUtc: '2026-07-28T09:15:00.000Z',
        businessDate: '2026-07-28',
      });
      expect(asserted).toMatchObject({ status: 'applied', result: { verificationStatus: 'provisional', statusVersion: 1 } });
      expect(count(sqlite, 'canonical_diagnosis_status_events')).toBe(1);

      const reviewInput = {
        tenantId: 'tenant-a',
        diagnosisPublicId: 'diagnosis-101',
        diagnosisEventPublicId: 'diagnosis-event-101-v2',
        expectedVersion: 1,
        reviewerPractitionerPublicId: 'practitioner-103',
        toVerificationStatus: 'verified' as const,
        reasonCode: 'clinician_review',
        sourceEvidenceSha256: 'b'.repeat(64),
        actorSystemKey: 'canonical.clinical.test',
        idempotencyKey: 'diagnosis-review-101',
        eventPublicId: 'diagnosis-outbox-review-101',
        occurredAtUtc: '2026-07-28T09:20:00.000Z',
        businessDate: '2026-07-28',
      };
      const reviewed = await reviewCanonicalDiagnosis(db, reviewInput);
      const replay = await reviewCanonicalDiagnosis(db, reviewInput);
      expect(reviewed).toMatchObject({ status: 'applied', result: { verificationStatus: 'verified', statusVersion: 2 } });
      expect(replay).toEqual({ status: 'replayed', result: reviewed.result });

      await expect(transitionCanonicalDiagnosis(db, {
        tenantId: 'tenant-a',
        diagnosisPublicId: 'diagnosis-101',
        diagnosisEventPublicId: 'diagnosis-event-101-v3',
        expectedVersion: 2,
        toClinicalStatus: 'resolved',
        toVerificationStatus: 'verified',
        eventType: 'resolved',
        reasonCode: 'condition_resolved',
        actorPractitionerPublicId: 'practitioner-103',
        sourceEvidenceSha256: 'c'.repeat(64),
        actorSystemKey: 'canonical.clinical.test',
        idempotencyKey: 'diagnosis-resolve-101',
        eventPublicId: 'diagnosis-outbox-resolve-101',
        occurredAtUtc: '2026-07-28T09:30:00.000Z',
        businessDate: '2026-07-28',
      })).resolves.toMatchObject({ status: 'applied', result: { clinicalStatus: 'resolved', statusVersion: 3 } });

      expect(sqlite.prepare(`
        SELECT event_version,event_type,to_verification_status,to_clinical_status
        FROM canonical_diagnosis_status_events ORDER BY event_version
      `).all()).toEqual([
        { event_version: 1, event_type: 'asserted', to_verification_status: 'provisional', to_clinical_status: 'active' },
        { event_version: 2, event_type: 'reviewed', to_verification_status: 'verified', to_clinical_status: 'active' },
        { event_version: 3, event_type: 'resolved', to_verification_status: 'verified', to_clinical_status: 'resolved' },
      ]);
      const outbox = sqlite.prepare(`
        SELECT payload_json FROM canonical_outbox_events WHERE idempotency_key='diagnosis-assert-101'
      `).get() as { payload_json: string };
      expect(outbox.payload_json).not.toContain('Sensitive diagnosis display');
      expect(outbox.payload_json).not.toContain('patient-link-101');
    } finally {
      sqlite.close();
    }
  });
});
