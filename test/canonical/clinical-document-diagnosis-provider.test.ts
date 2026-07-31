import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  ClinicalDocumentDiagnosisProviderDatabase,
  ClinicalDocumentDiagnosisProviderPreparedStatement,
} from '../../src/lib/canonical/clinical-document-diagnosis-provider';
import {
  resolveClinicalDiagnosisProjection,
  resolveClinicalDocumentDiagnosisProviderMode,
  resolveClinicalDocumentProjection,
} from '../../src/lib/canonical/clinical-document-diagnosis-provider';
import {
  readClinicalDiagnosisAdapter,
  readClinicalDocumentAdapter,
} from '../../src/lib/canonical/clinical-document-diagnosis-read-adapters';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements ClinicalDocumentDiagnosisProviderPreparedStatement {
  constructor(private readonly database: DatabaseSync, readonly sql: string, readonly params: SqlValue[] = []) {}
  bind(...values: unknown[]): Statement {
    return new Statement(this.database, this.sql, values.map((value) => (value === undefined ? null : value)) as SqlValue[]);
  }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return { results: this.database.prepare(this.sql).all(...this.params) as T[] };
  }
}

function harness(): { sqlite: DatabaseSync; db: ClinicalDocumentDiagnosisProviderDatabase } {
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
      id INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,patient_id INTEGER NOT NULL,
      visit_id INTEGER,note_type TEXT NOT NULL,content TEXT NOT NULL,performer_id INTEGER,
      is_signed INTEGER,signed_by INTEGER,signed_at TEXT,is_active INTEGER,created_by INTEGER,
      created_at TEXT,updated_at TEXT
    );
    CREATE TABLE ClinicalDiagnosis (
      DiagnosisId INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,PatientId INTEGER NOT NULL,
      PatientVisitId INTEGER,ICD10Code TEXT,ICD10Description TEXT NOT NULL,icd11_code TEXT,
      icd11_title TEXT,DiagnosisType TEXT,IsActive INTEGER,CreatedBy TEXT,CreatedOn TEXT,
      ModifiedOn TEXT,review_status TEXT,reviewed_by TEXT,reviewed_at TEXT
    );
  `);
  seed(sqlite);
  return {
    sqlite,
    db: { prepare(sql: string) { return new Statement(sqlite, sql); } },
  };
}

function seed(sqlite: DatabaseSync): void {
  sqlite.prepare(`
    INSERT INTO canonical_tenant_patient_links (
      tenant_id,patient_link_public_id,legacy_patient_id,link_status,
      verification_level,evidence_type,evidence_sha256,effective_from_utc,version
    ) VALUES ('tenant-a','ptl-101',101,'unlinked','unverified','no_link_placeholder',?,?,1)
  `).run('1'.repeat(64), '2026-07-28T00:00:00.000Z');
  for (const [id, legacyUserId, name, hash] of [
    ['prac-901', 901, 'Author', '2'],
    ['prac-902', 902, 'Signer', '3'],
    ['prac-903', 903, 'Reviewer', '4'],
  ] as const) {
    sqlite.prepare(`
      INSERT INTO canonical_practitioners (
        tenant_id,practitioner_public_id,practitioner_kind,display_name,status,version,source_evidence_sha256
      ) VALUES ('tenant-a',?,'internal',?,'active',1,?)
    `).run(id, name, hash.repeat(64));
    sqlite.prepare(`
      INSERT INTO canonical_practitioner_user_links (
        tenant_id,practitioner_public_id,legacy_user_id,link_status,evidence_type
      ) VALUES ('tenant-a',?,?,'active','legacy_doctor_user_id')
    `).run(id, legacyUserId);
  }
  sqlite.prepare(`
    INSERT INTO canonical_encounters (
      tenant_id,encounter_public_id,legacy_patient_id,patient_link_public_id,
      encounter_type,status,encounter_version,source_kind,started_at_utc,source_evidence_sha256
    ) VALUES ('tenant-a','enc-701',101,'ptl-101','outpatient','in_progress',1,'runtime',?,?)
  `).run('2026-07-28T08:00:00.000Z', '5'.repeat(64));
  const mapping = sqlite.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES ('tenant-a',?,?,?,?,?,'mapped',1,?)
  `);
  mapping.run('patient_link', 'ptl-101', 'legacy_patient', '101', 'patients', '6'.repeat(64));
  mapping.run('encounter', 'enc-701', 'legacy_visit', '701', 'visits', '7'.repeat(64));
  sqlite.prepare(`
    INSERT INTO clinical_notes VALUES
      (501,'tenant-a',101,701,'progress','Legacy sensitive note',901,1,902,
       '2026-07-28T09:10:00.000Z',1,901,'2026-07-28T09:00:00.000Z','2026-07-28T09:10:00.000Z'),
      (502,'tenant-a',101,701,'progress','Unmapped sensitive note',901,0,NULL,NULL,1,901,
       '2026-07-28T09:20:00.000Z','2026-07-28T09:20:00.000Z')
  `).run();
  sqlite.prepare(`
    INSERT INTO ClinicalDiagnosis VALUES
      (801,'tenant-a',101,701,'A00','Legacy sensitive diagnosis',NULL,NULL,'primary',1,
       '901','2026-07-28T09:30:00.000Z','2026-07-28T09:31:00.000Z','verified','903',
       '2026-07-28T09:31:00.000Z')
  `).run();

  sqlite.prepare(`
    INSERT INTO canonical_clinical_documents (
      tenant_id,document_public_id,patient_link_public_id,encounter_public_id,scope_kind,
      authoring_practitioner_public_id,document_type,current_version_public_id,current_status,
      status_version,confidentiality_code,authored_at_utc,finalized_at_utc,idempotency_key,
      request_fingerprint_sha256,source_evidence_sha256
    ) VALUES ('tenant-a','doc-501','ptl-101','enc-701','encounter','prac-901','progress_note',
              NULL,'draft',1,'normal','2026-07-28T09:00:00.000Z',NULL,'seed-doc-501',?,?)
  `).run('8'.repeat(64), '9'.repeat(64));
  sqlite.prepare(`
    INSERT INTO canonical_clinical_document_versions (
      tenant_id,version_public_id,document_public_id,version_number,version_kind,
      content_format,content_payload,content_sha256,authoring_practitioner_public_id,
      actor_system_key,authored_at_utc,source_evidence_sha256
    ) VALUES ('tenant-a','docver-501','doc-501',1,'draft','plain_text',
              'Canonical sensitive note',?,'prac-901','provider.test',?,?)
  `).run('a'.repeat(64), '2026-07-28T09:00:00.000Z', 'b'.repeat(64));
  sqlite.prepare(`UPDATE canonical_clinical_documents SET current_version_public_id='docver-501'`).run();
  mapping.run('clinical_document', 'doc-501', 'legacy_clinical_note', '501', 'clinical_notes', 'c'.repeat(64));

  sqlite.prepare(`
    INSERT INTO canonical_diagnosis_assertions (
      tenant_id,diagnosis_public_id,patient_link_public_id,encounter_public_id,
      asserting_practitioner_public_id,code_system,code,display_snapshot,diagnosis_role,
      certainty,clinical_status,verification_status,status_version,asserted_at_utc,reviewed_at_utc,
      idempotency_key,request_fingerprint_sha256,source_evidence_sha256
    ) VALUES ('tenant-a','diag-801','ptl-101','enc-701','prac-901','icd10','A00',
              'Canonical sensitive diagnosis','primary','confirmed','active','verified',1,
              '2026-07-28T09:30:00.000Z','2026-07-28T09:31:00.000Z','seed-diag-801',?,?)
  `).run('d'.repeat(64), 'e'.repeat(64));
  mapping.run('diagnosis_assertion', 'diag-801', 'legacy_clinical_diagnosis', '801', 'ClinicalDiagnosis', 'f'.repeat(64));
}

function setMode(sqlite: DatabaseSync, mode: string, enabled = 1): void {
  sqlite.prepare(`
    INSERT INTO canonical_feature_flags (
      tenant_id,flag_key,domain,mode,is_enabled,created_at_utc,updated_at_utc
    ) VALUES ('tenant-a','canonical_clinical_document_diagnosis_provider_v1',
              'clinical_document_diagnosis',?,?,?,?)
  `).run(mode, enabled, '2026-07-28T00:00:00.000Z', '2026-07-28T00:00:00.000Z');
}

const evidence = {
  observedAtUtc: '2026-07-28T12:00:00.000Z',
  elapsedMs: 4,
  errorCount: 0,
  latencyBudgetMs: 100,
  acceptedExceptionIds: [] as string[],
};

describe('canonical clinical document and diagnosis provider', () => {
  it('defaults safely to legacy and honours only enabled shadow/canonical modes', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(resolveClinicalDocumentDiagnosisProviderMode(db, 'tenant-a')).resolves.toBe('legacy');
      setMode(sqlite, 'canonical', 0);
      await expect(resolveClinicalDocumentDiagnosisProviderMode(db, 'tenant-a')).resolves.toBe('legacy');
      sqlite.exec('DELETE FROM canonical_feature_flags');
      setMode(sqlite, 'shadow');
      await expect(resolveClinicalDocumentDiagnosisProviderMode(db, 'tenant-a')).resolves.toBe('shadow');
      sqlite.exec(`UPDATE canonical_feature_flags SET mode='canonical'`);
      await expect(resolveClinicalDocumentDiagnosisProviderMode(db, 'tenant-a')).resolves.toBe('canonical');
    } finally { sqlite.close(); }
  });

  it('legacy mode never resolves by text, numeric coincidence, or time proximity', async () => {
    const { sqlite, db } = harness();
    try {
      const document = await resolveClinicalDocumentProjection(db, {
        tenantId: 'tenant-a', sourceType: 'legacy_clinical_note', legacyId: 502,
      });
      expect(document).toMatchObject({ mode: 'legacy', documentPublicId: null, contentPayload: 'Unmapped sensitive note' });
      await expect(resolveClinicalDocumentProjection(db, {
        tenantId: 'tenant-a', sourceType: 'legacy_clinical_note', legacyId: 502, identitySensitive: true,
      })).rejects.toThrow(/explicit clinical-document source mapping is required/i);
    } finally { sqlite.close(); }
  });

  it('shadow mode preserves legacy data and emits aggregate parity without PHI', async () => {
    const { sqlite, db } = harness();
    try {
      setMode(sqlite, 'shadow');
      const result = await readClinicalDocumentAdapter(db, {
        tenantId: 'tenant-a', sourceType: 'legacy_clinical_note', legacyId: 501,
      }, evidence);
      expect(result.projection).toMatchObject({
        mode: 'shadow', documentPublicId: 'doc-501', contentPayload: 'Legacy sensitive note',
        parity: { ok: false, mapping: true, patientLink: true, encounter: true, practitioner: true },
      });
      expect(result.shadowEvidence).toMatchObject({
        provider: 'clinical_document_diagnosis', consumerId: 'cdb122e_clinical_document_detail', mode: 'shadow',
      });
      const evidenceJson = JSON.stringify(result.shadowEvidence);
      for (const forbidden of ['Legacy sensitive note', 'ptl-101', 'enc-701', 'prac-901', '501']) {
        expect(evidenceJson).not.toContain(forbidden);
      }
    } finally { sqlite.close(); }
  });

  it('canonical mode requires exact mappings and reads exact canonical document and diagnosis facts', async () => {
    const { sqlite, db } = harness();
    try {
      setMode(sqlite, 'canonical');
      await expect(resolveClinicalDocumentProjection(db, {
        tenantId: 'tenant-a', sourceType: 'legacy_clinical_note', legacyId: 501,
      })).resolves.toMatchObject({
        mode: 'canonical', documentPublicId: 'doc-501', currentVersionPublicId: 'docver-501',
        contentPayload: 'Canonical sensitive note', patientLinkPublicId: 'ptl-101', encounterPublicId: 'enc-701',
      });
      await expect(resolveClinicalDiagnosisProjection(db, {
        tenantId: 'tenant-a', sourceType: 'legacy_clinical_diagnosis', legacyId: 801,
      })).resolves.toMatchObject({
        mode: 'canonical', diagnosisPublicId: 'diag-801', codeSystem: 'icd10', code: 'A00',
        displaySnapshot: 'Canonical sensitive diagnosis', verificationStatus: 'verified',
      });
      await expect(resolveClinicalDocumentProjection(db, {
        tenantId: 'tenant-a', sourceType: 'legacy_clinical_note', legacyId: 502,
      })).rejects.toThrow(/canonical clinical document mapping is required/i);
    } finally { sqlite.close(); }
  });

  it('diagnosis shadow adapter preserves legacy projection and produces PHI-minimised evidence', async () => {
    const { sqlite, db } = harness();
    try {
      setMode(sqlite, 'shadow');
      const result = await readClinicalDiagnosisAdapter(db, {
        tenantId: 'tenant-a', sourceType: 'legacy_clinical_diagnosis', legacyId: 801,
      }, evidence);
      expect(result.projection).toMatchObject({
        mode: 'shadow', diagnosisPublicId: 'diag-801', displaySnapshot: 'Legacy sensitive diagnosis',
        parity: { mapping: true, patientLink: true, encounter: true, practitioner: true, code: true },
      });
      const evidenceJson = JSON.stringify(result.shadowEvidence);
      expect(evidenceJson).not.toContain('Legacy sensitive diagnosis');
      expect(evidenceJson).not.toContain('ptl-101');
    } finally { sqlite.close(); }
  });
});
