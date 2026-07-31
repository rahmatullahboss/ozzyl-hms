import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { createDeterministicSourceId } from '../../src/lib/canonical/source-mapping';
import type {
  ClinicalDocumentDiagnosisBackfillDatabase,
  ClinicalDocumentDiagnosisBackfillPreparedStatement,
} from '../../scripts/canonical/backfill-clinical-document-diagnosis';
import { backfillClinicalDocumentDiagnosis } from '../../scripts/canonical/backfill-clinical-document-diagnosis';
import type {
  ClinicalDocumentDiagnosisReconciliationDatabase,
  ClinicalDocumentDiagnosisReconciliationPreparedStatement,
} from '../../scripts/canonical/reconcile-clinical-document-diagnosis';
import { reconcileClinicalDocumentDiagnosis } from '../../scripts/canonical/reconcile-clinical-document-diagnosis';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements ClinicalDocumentDiagnosisBackfillPreparedStatement, ClinicalDocumentDiagnosisReconciliationPreparedStatement {
  constructor(private readonly database: DatabaseSync, readonly sql: string, readonly params: SqlValue[] = []) {}
  bind(...values: unknown[]): Statement {
    return new Statement(this.database, this.sql, values.map((value) => (value === undefined ? null : value)) as SqlValue[]);
  }
  async run() {
    const result = this.database.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes ?? 0), last_row_id: Number(result.lastInsertRowid ?? 0) } };
  }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return { results: this.database.prepare(this.sql).all(...this.params) as T[] };
  }
}

function harness(): {
  sqlite: DatabaseSync;
  db: ClinicalDocumentDiagnosisBackfillDatabase & ClinicalDocumentDiagnosisReconciliationDatabase;
} {
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
    CREATE TABLE clinical_notes (
      id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, patient_id INTEGER NOT NULL,
      visit_id INTEGER, note_type TEXT NOT NULL, title TEXT, content TEXT NOT NULL,
      chief_complaint TEXT, subjective TEXT, objective TEXT, assessment TEXT, plan TEXT,
      follow_up TEXT, follow_up_unit TEXT, performer_id INTEGER, is_signed INTEGER,
      signed_by INTEGER, signed_at TEXT, is_active INTEGER, created_by INTEGER,
      created_at TEXT, updated_at TEXT
    );
    CREATE TABLE FormSOAP (
      SOAPId INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, PatientId INTEGER NOT NULL,
      EncounterId INTEGER, ChiefComplaint TEXT, Subjective TEXT, Objective TEXT,
      Assessment TEXT, Plan TEXT, CreatedById TEXT, CreatedAt TEXT
    );
    CREATE TABLE FormTreatmentPlan (
      TreatmentPlanId INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, PatientId INTEGER NOT NULL,
      EncounterId INTEGER, PresentingIssues TEXT, PatientHistory TEXT, Medications TEXT,
      AnyOtherRelevantInformation TEXT, Diagnosis TEXT, TreatmentReceived TEXT,
      RecommendationForFollowUp TEXT, CreatedById TEXT, CreatedAt TEXT
    );
    CREATE TABLE encounters (
      id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, patient_id INTEGER NOT NULL,
      visit_id INTEGER, provider_id INTEGER, signed_snapshot TEXT, snapshot_hash TEXT,
      signed_by INTEGER, signed_at TEXT, signature_version INTEGER, is_active INTEGER,
      created_at TEXT, updated_at TEXT
    );
    CREATE TABLE document_records (
      id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, patient_id INTEGER NOT NULL,
      medical_record_id INTEGER, document_type TEXT NOT NULL, title TEXT NOT NULL,
      description TEXT, file_key TEXT, file_name TEXT, file_size INTEGER, mime_type TEXT,
      uploaded_by TEXT, is_active INTEGER, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE clinical_images (
      id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, patient_id INTEGER NOT NULL,
      visit_id INTEGER, image_type TEXT NOT NULL, title TEXT NOT NULL, description TEXT,
      file_key TEXT NOT NULL, file_name TEXT, file_size INTEGER, mime_type TEXT,
      body_part TEXT, is_active INTEGER, uploaded_by INTEGER, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE ClinicalDiagnosis (
      DiagnosisId INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, PatientId INTEGER NOT NULL,
      PatientVisitId INTEGER, ICD10ID INTEGER, ICD10Code TEXT, ICD10Description TEXT NOT NULL,
      icd11_code TEXT, icd11_title TEXT, DiagnosisType TEXT, Notes TEXT, IsActive INTEGER,
      CreatedBy TEXT, CreatedOn TEXT, ModifiedBy TEXT, ModifiedOn TEXT, review_status TEXT,
      reviewed_by TEXT, reviewed_at TEXT, review_notes TEXT, source TEXT,
      completion_claim_id INTEGER
    );
    CREATE TABLE final_diagnosis (
      id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, patient_id INTEGER NOT NULL,
      visit_id INTEGER, medical_record_id INTEGER, icd10_id INTEGER, icd11_code TEXT,
      icd11_title TEXT, is_primary INTEGER, notes TEXT, source TEXT, is_active INTEGER,
      created_by TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE icd10_codes (
      id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, code TEXT NOT NULL,
      description TEXT NOT NULL, is_active INTEGER
    );
    CREATE TABLE visits (
      id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, patient_id INTEGER NOT NULL,
      icd10_code TEXT, icd10_description TEXT, icd11_code TEXT, icd11_title TEXT
    );
    CREATE TABLE medical_records (
      id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, patient_id INTEGER NOT NULL,
      visit_id INTEGER
    );
  `);
  const db = {
    prepare(sql: string) { return new Statement(sqlite, sql); },
    async batch(statements: ClinicalDocumentDiagnosisBackfillPreparedStatement[]) {
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
  seedCanonical(sqlite);
  seedLegacy(sqlite);
  return { sqlite, db };
}

function seedCanonical(sqlite: DatabaseSync): void {
  sqlite.prepare(`
    INSERT INTO canonical_tenant_patient_links (
      tenant_id,patient_link_public_id,legacy_patient_id,link_status,
      verification_level,evidence_type,evidence_sha256,effective_from_utc,version
    ) VALUES ('tenant-a','ptl-101',101,'unlinked','unverified','no_link_placeholder',?,?,1)
  `).run('1'.repeat(64), '2026-07-28T00:00:00.000Z');
  for (const [practitionerId, legacyUserId, name, hash] of [
    ['prac-901', 901, 'Author', '2'],
    ['prac-902', 902, 'Signer', '3'],
    ['prac-903', 903, 'Reviewer', '4'],
  ] as const) {
    sqlite.prepare(`
      INSERT INTO canonical_practitioners (
        tenant_id,practitioner_public_id,practitioner_kind,display_name,status,version,source_evidence_sha256
      ) VALUES ('tenant-a',?,'internal',?,'active',1,?)
    `).run(practitionerId, name, hash.repeat(64));
    sqlite.prepare(`
      INSERT INTO canonical_practitioner_user_links (
        tenant_id,practitioner_public_id,legacy_user_id,link_status,evidence_type
      ) VALUES ('tenant-a',?,?,'active','legacy_doctor_user_id')
    `).run(practitionerId, legacyUserId);
  }
  for (const [encounterPublicId, legacyId, sourceType, started, hash] of [
    ['enc-701', 701, 'legacy_visit', '2026-07-28T08:00:00.000Z', '5'],
    ['enc-801', 801, 'legacy_encounter', '2026-07-28T08:30:00.000Z', '6'],
  ] as const) {
    sqlite.prepare(`
      INSERT INTO canonical_encounters (
        tenant_id,encounter_public_id,legacy_patient_id,patient_link_public_id,
        encounter_type,status,encounter_version,source_kind,started_at_utc,source_evidence_sha256
      ) VALUES ('tenant-a',?,101,'ptl-101','outpatient','in_progress',1,'runtime',?,?)
    `).run(encounterPublicId, started, hash.repeat(64));
    sqlite.prepare(`
      INSERT INTO canonical_source_mappings (
        tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
        source_table,mapping_status,mapping_version,evidence_sha256
      ) VALUES ('tenant-a','encounter',?,?,?,?,'mapped',1,?)
    `).run(encounterPublicId, sourceType, String(legacyId), sourceType === 'legacy_visit' ? 'visits' : 'encounters', hash.repeat(64));
  }
  sqlite.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES ('tenant-a','patient_link','ptl-101','legacy_patient','101','patients','mapped',1,?)
  `).run('7'.repeat(64));
}

function seedLegacy(sqlite: DatabaseSync): void {
  sqlite.prepare(`
    INSERT INTO clinical_notes VALUES
      (501,'tenant-a',101,701,'progress','Visit note','Sensitive note content',NULL,NULL,NULL,NULL,NULL,NULL,NULL,901,1,902,
       '2026-07-28T09:10:00.000Z',1,901,'2026-07-28T09:00:00.000Z','2026-07-28T09:10:00.000Z'),
      (502,'tenant-a',101,NULL,'progress','Ambiguous note','Do not migrate',NULL,NULL,NULL,NULL,NULL,NULL,NULL,999,0,NULL,
       NULL,1,999,'2026-07-28T09:20:00.000Z','2026-07-28T09:20:00.000Z')
  `).run();
  sqlite.prepare(`
    INSERT INTO FormSOAP VALUES
      (601,'tenant-a',101,801,'Complaint','Subjective','Objective','Assessment','Plan','901','2026-07-28T09:30:00.000Z')
  `).run();
  sqlite.prepare(`
    INSERT INTO FormTreatmentPlan VALUES
      (701,'tenant-a',101,801,'Issues','History','Medication text','Other','Diagnosis text','Treatment','Follow up','901','2026-07-28T09:40:00.000Z')
  `).run();
  sqlite.prepare(`
    INSERT INTO encounters VALUES
      (801,'tenant-a',101,701,901,'Signed encounter snapshot',?,902,'2026-07-28T09:50:00.000Z',1,1,
       '2026-07-28T08:30:00.000Z','2026-07-28T09:50:00.000Z')
  `).run('8'.repeat(64));
  sqlite.prepare(`
    INSERT INTO document_records VALUES
      (801,'tenant-a',101,NULL,'external_report','External report','Sensitive description','private/doc-key','sensitive.pdf',200,
       'application/pdf','901',1,'2026-07-28T10:00:00.000Z','2026-07-28T10:00:00.000Z')
  `).run();
  sqlite.prepare(`
    INSERT INTO clinical_images VALUES
      (901,'tenant-a',101,701,'clinical_image','Image','Sensitive image description','private/image-key','sensitive.png',100,
       'image/png','CHEST',1,901,'2026-07-28T10:05:00.000Z','2026-07-28T10:05:00.000Z')
  `).run();
  sqlite.prepare(`
    INSERT INTO ClinicalDiagnosis VALUES
      (1001,'tenant-a',101,701,10,'A00','Sensitive diagnosis',NULL,NULL,'primary',NULL,1,'901',
       '2026-07-28T10:10:00.000Z',NULL,NULL,'verified','903','2026-07-28T10:12:00.000Z',NULL,'clinician',NULL)
  `).run();
  sqlite.prepare(`INSERT INTO icd10_codes VALUES (10,'tenant-a','B00','Sensitive final diagnosis',1)`).run();
  sqlite.prepare(`
    INSERT INTO final_diagnosis VALUES
      (1101,'tenant-a',101,701,NULL,10,NULL,NULL,1,NULL,'clinician',1,'901',
       '2026-07-28T10:20:00.000Z','2026-07-28T10:20:00.000Z')
  `).run();
  sqlite.prepare(`
    INSERT INTO visits VALUES (701,'tenant-a',101,'A00','Sensitive projection',NULL,NULL)
  `).run();
}

function count(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
}

function sourceSnapshot(sqlite: DatabaseSync): string {
  return JSON.stringify({
    notes: sqlite.prepare(`SELECT * FROM clinical_notes ORDER BY id`).all(),
    soap: sqlite.prepare(`SELECT * FROM FormSOAP ORDER BY SOAPId`).all(),
    plan: sqlite.prepare(`SELECT * FROM FormTreatmentPlan ORDER BY TreatmentPlanId`).all(),
    encounters: sqlite.prepare(`SELECT * FROM encounters ORDER BY id`).all(),
    docs: sqlite.prepare(`SELECT * FROM document_records ORDER BY id`).all(),
    images: sqlite.prepare(`SELECT * FROM clinical_images ORDER BY id`).all(),
    diagnoses: sqlite.prepare(`SELECT * FROM ClinicalDiagnosis ORDER BY DiagnosisId`).all(),
    finalDiagnoses: sqlite.prepare(`SELECT * FROM final_diagnosis ORDER BY id`).all(),
    projections: sqlite.prepare(`SELECT * FROM visits ORDER BY id`).all(),
  });
}

async function seedAttachmentParentMapping(sqlite: DatabaseSync): Promise<void> {
  const documentPublicId = await createDeterministicSourceId('cldoc', 'tenant-a', 'legacy_clinical_note', '501');
  sqlite.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES ('tenant-a','clinical_attachment_parent',?,'legacy_clinical_image','901',
              'clinical_images','mapped',1,?)
  `).run(documentPublicId, '9'.repeat(64));
}

describe('canonical clinical document and diagnosis backfill/reconciliation', () => {
  it('runs ten bounded resumable partitions, migrates exact evidence, and records stable non-PHI issues', async () => {
    const { sqlite, db } = harness();
    try {
      await seedAttachmentParentMapping(sqlite);
      const before = sourceSnapshot(sqlite);
      const first = await backfillClinicalDocumentDiagnosis(db, {
        tenantId: 'tenant-a',
        runPublicId: 'clinical-backfill-1',
        nowUtc: '2026-07-28T11:00:00.000Z',
        maxSourceRecords: 2,
      });
      expect(first.completed).toBe(false);
      expect(first.counts.scanned).toBe(2);
      expect(first.counts.documentsCreated).toBe(1);
      expect(first.counts.issues).toBe(1);

      const second = await backfillClinicalDocumentDiagnosis(db, {
        tenantId: 'tenant-a',
        runPublicId: 'clinical-backfill-1',
        nowUtc: '2026-07-28T11:05:00.000Z',
        maxSourceRecords: 100,
      });
      expect(second.completed).toBe(true);
      expect(second.counts.scanned).toBeGreaterThanOrEqual(8);
      expect(count(sqlite, 'canonical_clinical_documents')).toBe(4);
      expect(count(sqlite, 'canonical_clinical_document_versions')).toBe(4);
      expect(count(sqlite, 'canonical_clinical_document_signatures')).toBe(2);
      expect(count(sqlite, 'canonical_clinical_document_attachments')).toBe(1);
      expect(count(sqlite, 'canonical_diagnosis_assertions')).toBe(1);
      expect(count(sqlite, 'canonical_diagnosis_status_events')).toBe(1);
      expect(count(sqlite, 'canonical_processing_issues')).toBe(4);
      expect(count(sqlite, 'canonical_backfill_checkpoints')).toBe(10);
      expect(sourceSnapshot(sqlite)).toBe(before);

      const issueRows = sqlite.prepare(`
        SELECT issue_code,source_type,source_public_id,occurrence_count,details_json
        FROM canonical_processing_issues ORDER BY issue_code
      `).all() as Array<Record<string, unknown>>;
      expect(issueRows.map((row) => row.issue_code)).toEqual([
        'CLINICAL_ATTACHMENT_SCOPE_MISSING',
        'CLINICAL_DOCUMENT_SCOPE_UNRESOLVED',
        'CLINICAL_FINAL_DIAGNOSIS_UNVERIFIED',
        'CLINICAL_PROJECTION_NOT_AUTHORITY',
      ]);
      for (const row of issueRows) {
        const details = String(row.details_json ?? '');
        for (const forbidden of ['Sensitive', 'private/', 'sensitive.pdf', 'sensitive.png']) {
          expect(details).not.toContain(forbidden);
        }
      }

      const third = await backfillClinicalDocumentDiagnosis(db, {
        tenantId: 'tenant-a',
        runPublicId: 'clinical-backfill-1',
        nowUtc: '2026-07-28T11:10:00.000Z',
        maxSourceRecords: 100,
      });
      expect(third.completed).toBe(true);
      expect(third.counts).toMatchObject({ documentsCreated: 0, versionsCreated: 0, issues: 0 });
      expect(count(sqlite, 'canonical_clinical_documents')).toBe(4);
    } finally {
      sqlite.close();
    }
  });

  it('persists a passed 20-check receipt and fails closed on scope/source/integrity evidence', async () => {
    const { sqlite, db } = harness();
    try {
      await seedAttachmentParentMapping(sqlite);
      await backfillClinicalDocumentDiagnosis(db, {
        tenantId: 'tenant-a', runPublicId: 'clinical-backfill-reconcile',
        nowUtc: '2026-07-28T11:00:00.000Z', maxSourceRecords: 100,
      });
      const passed = await reconcileClinicalDocumentDiagnosis(db, {
        tenantId: 'tenant-a',
        runPublicId: 'clinical-reconcile-1',
        migrationRunPublicId: 'clinical-backfill-reconcile',
        nowUtc: '2026-07-28T11:30:00.000Z',
        sourceFingerprintBefore: 'a'.repeat(64),
        sourceFingerprintAfter: 'a'.repeat(64),
        foreignKeyViolationCount: 0,
        integrityStatus: 'ok',
        secondPassNewBusinessRows: 0,
      });
      expect(passed).toMatchObject({ status: 'passed', scannedChecks: 20, matchedChecks: 20, mismatchChecks: 0 });
      expect(Object.values(passed.checks).every((value) => value === 0)).toBe(true);
      expect(passed.evidenceSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(sqlite.prepare(`
        SELECT domain,reconciliation_type,status,scanned_count,matched_count,mismatch_count
        FROM canonical_reconciliation_runs
      `).get()).toEqual({
        domain: 'clinical_document_diagnosis',
        reconciliation_type: 'backfill',
        status: 'passed',
        scanned_count: 20,
        matched_count: 20,
        mismatch_count: 0,
      });

      sqlite.exec('PRAGMA foreign_keys = OFF');
      sqlite.prepare(`UPDATE canonical_diagnosis_assertions SET encounter_public_id='missing-encounter'`).run();
      sqlite.exec('PRAGMA foreign_keys = ON');
      const failed = await reconcileClinicalDocumentDiagnosis(db, {
        tenantId: 'tenant-a',
        runPublicId: 'clinical-reconcile-2',
        migrationRunPublicId: 'clinical-backfill-reconcile',
        nowUtc: '2026-07-28T12:00:00.000Z',
        sourceFingerprintBefore: 'a'.repeat(64),
        sourceFingerprintAfter: 'b'.repeat(64),
        foreignKeyViolationCount: 1,
        integrityStatus: 'corrupt',
        secondPassNewBusinessRows: 1,
      });
      expect(failed.status).toBe('failed');
      expect(failed.checks).toMatchObject({
        diagnosisEncounterScopeMismatchCount: 1,
        sourceFingerprintMismatchCount: 1,
        foreignKeyViolationCount: 1,
        integrityFailureCount: 1,
        secondPassNewBusinessRowCount: 1,
      });
      expect(failed.mismatchChecks).toBeGreaterThanOrEqual(5);
    } finally {
      sqlite.close();
    }
  });
});
