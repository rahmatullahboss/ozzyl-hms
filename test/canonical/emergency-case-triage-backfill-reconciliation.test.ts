import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { CanonicalPreparedStatement } from '../../src/lib/canonical/command-batch';
import {
  backfillCanonicalEmergencyCaseTriage,
  type EmergencyCaseTriageBackfillDatabase,
} from '../../scripts/canonical/backfill-emergency-case-triage';
import {
  EMERGENCY_RECONCILIATION_CHECK_NAMES,
  reconcileCanonicalEmergencyCaseTriage,
  type EmergencyCaseTriageReconciliationDatabase,
} from '../../scripts/canonical/reconcile-emergency-case-triage';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements CanonicalPreparedStatement {
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

interface Harness {
  sqlite: DatabaseSync;
  db: EmergencyCaseTriageBackfillDatabase & EmergencyCaseTriageReconciliationDatabase;
}

function harness(): Harness {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  for (const migration of [
    'migrations/0505_canonical_program_foundation.sql',
    'migrations/0506_canonical_practitioners.sql',
    'migrations/0507_canonical_encounters.sql',
    'migrations/0508_canonical_service_catalog.sql',
    'migrations/0509_canonical_service_requests_events.sql',
    'migrations/0544_canonical_tenant_patient_links.sql',
    'migrations/0545_canonical_practitioner_operational_adoption.sql',
    'migrations/0548_canonical_encounter_admission_bed_convergence.sql',
    'migrations/0555_canonical_clinical_document_diagnosis.sql',
    'migrations/0556_canonical_patient_vital_measurement.sql',
    'migrations/0560_canonical_emergency_case_triage.sql',
  ]) sqlite.exec(readFileSync(migration, 'utf8'));
  sqlite.exec(`
    CREATE TABLE patients (id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL);
    CREATE TABLE visits (id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL);
  `);
  sqlite.exec(readFileSync('migrations/0032_emergency.sql', 'utf8'));

  const db: EmergencyCaseTriageBackfillDatabase & EmergencyCaseTriageReconciliationDatabase = {
    prepare(sql: string) { return new Statement(sqlite, sql); },
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
  seedCanonical(sqlite);
  seedLegacy(sqlite);
  return { sqlite, db };
}

function insertMapping(
  sqlite: DatabaseSync,
  input: {
    entityType: string;
    canonicalPublicId: string;
    sourceType: string;
    sourcePublicId: string;
    sourceTable: string;
    hash?: string;
  },
): void {
  sqlite.prepare(`INSERT INTO canonical_source_mappings (
    tenant_id,entity_type,canonical_public_id,source_type,source_public_id,source_table,
    mapping_status,mapping_version,evidence_sha256,created_at_utc,updated_at_utc
  ) VALUES ('tenant-a',?,?,?,?,?,'mapped',1,?,'2026-07-28T00:00:00.000Z','2026-07-28T00:00:00.000Z')`)
    .run(
      input.entityType,
      input.canonicalPublicId,
      input.sourceType,
      input.sourcePublicId,
      input.sourceTable,
      (input.hash ?? '8').repeat(64),
    );
}

function seedCanonical(sqlite: DatabaseSync): void {
  for (const [patientLink, patientId, hash] of [
    ['patient-link-101', 101, '1'],
    ['patient-link-202', 202, '2'],
    ['patient-link-303', 303, '3'],
  ] as const) {
    sqlite.prepare(`INSERT INTO canonical_tenant_patient_links (
      tenant_id,patient_link_public_id,legacy_patient_id,link_status,verification_level,
      evidence_type,evidence_sha256,effective_from_utc,version
    ) VALUES ('tenant-a',?,?,'unlinked','unverified','no_link_placeholder',?,'2026-07-28T00:00:00.000Z',1)`)
      .run(patientLink, patientId, hash.repeat(64));
  }
  for (const [practitioner, displayName, legacyUser, hash] of [
    ['practitioner-triage', 'Triage Nurse', 10, '4'],
    ['practitioner-emergency', 'Emergency Physician', 11, '5'],
  ] as const) {
    sqlite.prepare(`INSERT INTO canonical_practitioners (
      tenant_id,practitioner_public_id,practitioner_kind,display_name,status,version,source_evidence_sha256
    ) VALUES ('tenant-a',?,'internal',?,'active',1,?)`).run(practitioner, displayName, hash.repeat(64));
    insertMapping(sqlite, {
      entityType: 'practitioner',
      canonicalPublicId: practitioner,
      sourceType: 'legacy_user',
      sourcePublicId: String(legacyUser),
      sourceTable: 'users',
      hash,
    });
  }
  for (const [encounter, patientId, patientLink, sourceVisit, hash] of [
    ['encounter-er-101', 101, 'patient-link-101', 501, '6'],
    ['encounter-er-202', 202, 'patient-link-202', 502, '7'],
    ['encounter-er-303', 303, 'patient-link-303', 503, '8'],
  ] as const) {
    sqlite.prepare(`INSERT INTO canonical_encounters (
      tenant_id,encounter_public_id,legacy_patient_id,patient_link_public_id,encounter_type,status,
      encounter_version,source_kind,started_at_utc,source_evidence_sha256
    ) VALUES ('tenant-a',?,?,?,'emergency','in_progress',1,'runtime','2026-07-28T08:00:00.000Z',?)`)
      .run(encounter, patientId, patientLink, hash.repeat(64));
    insertMapping(sqlite, {
      entityType: 'encounter',
      canonicalPublicId: encounter,
      sourceType: 'legacy_visit',
      sourcePublicId: String(sourceVisit),
      sourceTable: 'visits',
      hash,
    });
  }
  sqlite.prepare(`INSERT INTO canonical_encounters (
    tenant_id,encounter_public_id,legacy_patient_id,patient_link_public_id,encounter_type,status,
    encounter_version,source_kind,started_at_utc,source_evidence_sha256
  ) VALUES ('tenant-a','encounter-ipd-101',101,'patient-link-101','inpatient','in_progress',1,
    'runtime','2026-07-28T10:00:00.000Z',?)`).run('9'.repeat(64));
  sqlite.prepare(`INSERT INTO canonical_admissions (
    tenant_id,admission_public_id,encounter_public_id,patient_link_public_id,admission_number,
    admission_type,admission_source,current_status,status_version,admitted_at_utc,
    idempotency_key,request_fingerprint_sha256,source_evidence_sha256
  ) VALUES ('tenant-a','admission-101','encounter-ipd-101','patient-link-101','ADM-101',
    'emergency','emergency','admitted',1,'2026-07-28T10:00:00.000Z','seed-admission-101',?,?)`)
    .run('a'.repeat(64), 'a'.repeat(64));
  insertMapping(sqlite, {
    entityType: 'admission',
    canonicalPublicId: 'admission-101',
    sourceType: 'legacy_er_patient_admission',
    sourcePublicId: '1',
    sourceTable: 'admissions',
    hash: 'a',
  });
  createSignedDischargeDocument(sqlite, {
    documentPublicId: 'document-discharge-202',
    versionPublicId: 'document-discharge-202-v1',
    patientLinkPublicId: 'patient-link-202',
    encounterPublicId: 'encounter-er-202',
    contentSha256: 'b'.repeat(64),
  });
  insertMapping(sqlite, {
    entityType: 'clinical_document_version',
    canonicalPublicId: 'document-discharge-202-v1',
    sourceType: 'legacy_er_discharge_summary',
    sourcePublicId: '902',
    sourceTable: 'er_discharge_summaries',
    hash: 'b',
  });
}

function createSignedDischargeDocument(sqlite: DatabaseSync, input: {
  documentPublicId: string;
  versionPublicId: string;
  patientLinkPublicId: string;
  encounterPublicId: string;
  contentSha256: string;
}): void {
  sqlite.prepare(`INSERT INTO canonical_clinical_documents (
    tenant_id,document_public_id,patient_link_public_id,encounter_public_id,scope_kind,
    authoring_practitioner_public_id,document_type,current_status,status_version,confidentiality_code,
    authored_at_utc,idempotency_key,request_fingerprint_sha256,source_evidence_sha256
  ) VALUES ('tenant-a',?,?,?,'encounter','practitioner-emergency','discharge_summary','draft',1,'normal',
    '2026-07-28T11:00:00.000Z',?,?,?)`).run(
      input.documentPublicId,
      input.patientLinkPublicId,
      input.encounterPublicId,
      `seed-${input.documentPublicId}`,
      input.contentSha256,
      input.contentSha256,
    );
  sqlite.prepare(`INSERT INTO canonical_clinical_document_versions (
    tenant_id,version_public_id,document_public_id,version_number,version_kind,content_format,content_payload,
    content_sha256,authoring_practitioner_public_id,actor_system_key,authored_at_utc,
    source_evidence_sha256,created_at_utc
  ) VALUES ('tenant-a',?,?,1,'draft','plain_text','Signed emergency discharge summary',?,
    'practitioner-emergency','canonical.emergency.backfill.test','2026-07-28T11:00:00.000Z',?,
    '2026-07-28T11:00:00.000Z')`).run(
      input.versionPublicId,
      input.documentPublicId,
      input.contentSha256,
      input.contentSha256,
    );
  sqlite.prepare(`INSERT INTO canonical_clinical_document_signatures (
    tenant_id,signature_public_id,document_public_id,version_public_id,signer_practitioner_public_id,
    signature_method,signed_content_sha256,attestation_sha256,signed_at_utc,
    source_evidence_sha256,created_at_utc
  ) VALUES ('tenant-a',?,?,?,?, 'authenticated_attestation',?,?,
    '2026-07-28T11:05:00.000Z',?,'2026-07-28T11:05:00.000Z')`).run(
      `signature-${input.versionPublicId}`,
      input.documentPublicId,
      input.versionPublicId,
      'practitioner-emergency',
      input.contentSha256,
      input.contentSha256,
      input.contentSha256,
    );
  sqlite.prepare(`UPDATE canonical_clinical_document_versions
    SET version_kind='final',finalized_at_utc='2026-07-28T11:05:00.000Z'
    WHERE tenant_id='tenant-a' AND version_public_id=?`).run(input.versionPublicId);
  sqlite.prepare(`UPDATE canonical_clinical_documents
    SET current_version_public_id=?,current_status='final',finalized_at_utc='2026-07-28T11:05:00.000Z',
      updated_at_utc='2026-07-28T11:05:00.000Z'
    WHERE tenant_id='tenant-a' AND document_public_id=?`).run(input.versionPublicId, input.documentPublicId);
}

function seedLegacy(sqlite: DatabaseSync): void {
  for (const [patientId, visitId] of [[101, 501], [202, 502], [303, 503]] as const) {
    sqlite.prepare(`INSERT INTO patients(id,tenant_id) VALUES (?,'tenant-a')`).run(patientId);
    sqlite.prepare(`INSERT INTO visits(id,tenant_id) VALUES (?,'tenant-a')`).run(visitId);
  }
  sqlite.prepare(`INSERT INTO er_mode_of_arrival(id,tenant_id,name,is_active,created_at)
    VALUES (1,'tenant-a','Ambulance',1,'2026-07-28 07:00:00')`).run();
  const insert = sqlite.prepare(`INSERT INTO er_patients (
    id,tenant_id,er_patient_number,patient_id,visit_id,discharge_summary_id,visit_datetime,
    first_name,last_name,contact_no,referred_by,referred_to,case_type,condition_on_arrival,
    brought_by,relation_with_patient,mode_of_arrival_id,er_status,triage_code,triaged_by,
    triaged_on,is_active,finalized_status,finalized_remarks,finalized_by,finalized_on,
    is_police_case,created_by,created_at,updated_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  insert.run(
    1, 'tenant-a', 'ER-001', 101, 501, null, '2026-07-28 08:00:00',
    'Admitted', 'Patient', '01700000001', 'Clinic', 'Emergency', 'animal_bite', 'critical',
    'ambulance', 'relative', 1, 'finalized', 'red', 10,
    '2026-07-28 08:05:00', 1, 'admitted', 'Admitted to IPD', 11, '2026-07-28 10:00:00',
    0, 11, '2026-07-28 08:01:00', '2026-07-28 10:00:00',
  );
  insert.run(
    2, 'tenant-a', 'ER-002', 202, 502, 902, '2026-07-28 08:10:00',
    'Discharged', 'Patient', '01700000002', null, null, 'medical', 'stable',
    'self', 'self', null, 'finalized', 'yellow', 10,
    '2026-07-28 08:15:00', 1, 'discharged', 'Stable at discharge', 11, '2026-07-28 11:10:00',
    0, 11, '2026-07-28 08:11:00', '2026-07-28 11:10:00',
  );
  insert.run(
    3, 'tenant-a', 'ER-003', 303, 503, null, '2026-07-28 08:20:00',
    'Transfer', 'Patient', '01700000003', null, 'External hospital', 'medical', 'serious',
    'ambulance', 'relative', 1, 'finalized', 'green', 10,
    '2026-07-28 08:25:00', 1, 'transferred', 'Transfer requested', 11, '2026-07-28 12:00:00',
    0, 11, '2026-07-28 08:21:00', '2026-07-28 12:00:00',
  );
  insert.run(
    4, 'tenant-a', 'ER-004', null, null, null, '2026-07-28 08:30:00',
    'Unmapped', 'Patient', '01700000004', null, null, 'unknown', 'unknown',
    'unknown', 'unknown', null, 'new', null, null,
    null, 1, null, null, null, null,
    0, 11, '2026-07-28 08:31:00', '2026-07-28 08:31:00',
  );
  sqlite.prepare(`INSERT INTO er_patient_cases (
    id,tenant_id,er_patient_id,main_case,sub_case,other_case_details,biting_site,
    datetime_of_bite,biting_animal,first_aid,is_active,created_by,created_at,updated_at
  ) VALUES (101,'tenant-a',1,1,2,'Dog bite',3,'2026-07-28 07:30:00',4,5,1,11,
    '2026-07-28 08:02:00','2026-07-28 08:02:00')`).run();
  sqlite.prepare(`INSERT INTO er_patient_cases (
    id,tenant_id,er_patient_id,main_case,sub_case,other_case_details,is_active,created_by,created_at,updated_at
  ) VALUES (102,'tenant-a',2,99,1,'Unreviewed code',1,11,
    '2026-07-28 08:12:00','2026-07-28 08:12:00')`).run();
  sqlite.prepare(`INSERT INTO er_discharge_summaries (
    id,tenant_id,patient_id,visit_id,discharge_type,chief_complaints,treatment_in_er,
    investigations,advice_on_discharge,on_examination,provisional_diagnosis,doctor_name,
    medical_officer,created_by,created_at,updated_at
  ) VALUES (902,'tenant-a',202,502,'normal','Fever','Supportive care','CBC','Review if worse',
    'Stable','Viral fever','Emergency Physician','Medical Officer',11,
    '2026-07-28 11:00:00','2026-07-28 11:05:00')`).run();
  sqlite.prepare(`INSERT INTO er_file_uploads (
    id,tenant_id,er_patient_id,patient_id,file_type,file_name,display_name,file_url,is_active,created_by,created_at
  ) VALUES (1001,'tenant-a',1,101,'consent','consent.pdf','Consent','r2://private/consent.pdf',1,11,
    '2026-07-28 08:03:00')`).run();
}

function count(sqlite: DatabaseSync, table: string, where = ''): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table} ${where}`).get() as { count: number }).count);
}

function legacySnapshot(sqlite: DatabaseSync): string {
  return JSON.stringify({
    arrivals: sqlite.prepare(`SELECT * FROM er_mode_of_arrival ORDER BY id`).all(),
    patients: sqlite.prepare(`SELECT * FROM er_patients ORDER BY id`).all(),
    cases: sqlite.prepare(`SELECT * FROM er_patient_cases ORDER BY id`).all(),
    summaries: sqlite.prepare(`SELECT * FROM er_discharge_summaries ORDER BY id`).all(),
    files: sqlite.prepare(`SELECT * FROM er_file_uploads ORDER BY id`).all(),
    visits: sqlite.prepare(`SELECT * FROM visits ORDER BY id`).all(),
  });
}

async function completeBackfill(db: EmergencyCaseTriageBackfillDatabase, maxSourceRecords = 3) {
  let last = await backfillCanonicalEmergencyCaseTriage(db, {
    tenantId: 'tenant-a',
    runPublicId: 'emergency-backfill-001',
    nowUtc: '2026-07-28T13:00:00.000Z',
    maxSourceRecords,
  });
  for (let attempt = 0; !last.completed && attempt < 80; attempt += 1) {
    last = await backfillCanonicalEmergencyCaseTriage(db, {
      tenantId: 'tenant-a',
      runPublicId: 'emergency-backfill-001',
      nowUtc: '2026-07-28T13:00:00.000Z',
      maxSourceRecords,
    });
  }
  expect(last.completed).toBe(true);
  return last;
}

describe('canonical emergency case/triage bounded backfill and reconciliation', () => {
  it('runs eight durable bounded partitions, preserves sources, writes exact facts/issues, and has a zero-row second pass', async () => {
    const { sqlite, db } = harness();
    try {
      const before = legacySnapshot(sqlite);
      const first = await backfillCanonicalEmergencyCaseTriage(db, {
        tenantId: 'tenant-a',
        runPublicId: 'emergency-backfill-001',
        nowUtc: '2026-07-28T13:00:00.000Z',
        maxSourceRecords: 3,
      });
      expect(first.completed).toBe(false);
      await completeBackfill(db, 3);
      expect(legacySnapshot(sqlite)).toBe(before);
      expect(count(sqlite, 'canonical_backfill_checkpoints')).toBe(8);
      expect(count(sqlite, 'canonical_backfill_checkpoints', `WHERE status='completed'`)).toBe(8);
      expect(count(sqlite, 'canonical_emergency_cases')).toBe(3);
      expect(count(sqlite, 'canonical_emergency_arrival_assessments')).toBe(3);
      expect(count(sqlite, 'canonical_emergency_triage_assessments')).toBe(3);
      expect(count(sqlite, 'canonical_emergency_case_classifications')).toBe(1);
      expect(count(sqlite, 'canonical_emergency_disposition_events')).toBe(2);
      expect(sqlite.prepare(`SELECT current_status,status_version FROM canonical_emergency_cases
        ORDER BY emergency_number_value`).all()).toEqual([
          { current_status: 'admitted', status_version: 5 },
          { current_status: 'discharged', status_version: 5 },
          { current_status: 'disposition_pending', status_version: 4 },
        ]);
      const issueCodes = (sqlite.prepare(`SELECT issue_code FROM canonical_processing_issues ORDER BY issue_code`).all() as { issue_code: string }[])
        .map((row) => row.issue_code);
      expect(issueCodes).toEqual(expect.arrayContaining([
        'ER_ATTACHMENT_MAPPING_MISSING',
        'ER_CLASSIFICATION_CODE_UNREVIEWED',
        'ER_ENCOUNTER_SCOPE_UNRESOLVED',
        'ER_PATIENT_SCOPE_UNRESOLVED',
        'ER_STALE_EMERGENCY_VISITS_PROJECTION',
        'ER_TRANSFER_DESTINATION_UNRESOLVED',
      ]));
      const issueEvidence = JSON.stringify(sqlite.prepare(`SELECT summary,details_json,entity_public_id
        FROM canonical_processing_issues ORDER BY issue_code`).all());
      for (const forbidden of [
        'Admitted Patient', 'Discharged Patient', '01700000001', '01700000002',
        'Dog bite', 'r2://private/consent.pdf', 'Stable at discharge',
      ]) expect(issueEvidence).not.toContain(forbidden);

      const second = await backfillCanonicalEmergencyCaseTriage(db, {
        tenantId: 'tenant-a',
        runPublicId: 'emergency-backfill-001',
        nowUtc: '2026-07-28T13:05:00.000Z',
        maxSourceRecords: 100,
      });
      expect(second.completed).toBe(true);
      expect(second.counts.casesCreated).toBe(0);
      expect(second.counts.arrivalAssessmentsCreated).toBe(0);
      expect(second.counts.statusEventsCreated).toBe(0);
      expect(second.counts.triageAssessmentsCreated).toBe(0);
      expect(second.counts.classificationsCreated).toBe(0);
      expect(second.counts.dispositionsCreated).toBe(0);
      expect(second.counts.mappingsCreated).toBe(0);
      expect(second.counts.issuesCreated).toBe(0);
      expect(legacySnapshot(sqlite)).toBe(before);
    } finally {
      sqlite.close();
    }
  });

  it('persists, replays, and fails closed one fixed twenty-four-check reconciliation receipt', async () => {
    const { sqlite, db } = harness();
    try {
      await completeBackfill(db, 100);
      const sourceSnapshot = legacySnapshot(sqlite);
      const foreignKeyViolationCount = sqlite.prepare('PRAGMA foreign_key_check').all().length;
      const integrityStatus = String((sqlite.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check) === 'ok'
        ? 'ok' as const
        : 'failed' as const;
      const input = {
        tenantId: 'tenant-a',
        runPublicId: 'emergency-reconcile-001',
        migrationRunPublicId: 'emergency-backfill-001',
        nowUtc: '2026-07-28T13:10:00.000Z',
        sourceFingerprintBefore: 'c'.repeat(64),
        sourceFingerprintAfter: 'c'.repeat(64),
        foreignKeyViolationCount,
        integrityStatus,
        secondPassNewBusinessRows: 0,
      };
      const first = await reconcileCanonicalEmergencyCaseTriage(db, input);
      const replay = await reconcileCanonicalEmergencyCaseTriage(db, input);
      expect(first).toEqual(replay);
      expect(first.status).toBe('passed');
      expect(first.scannedChecks).toBe(24);
      expect(first.matchedChecks).toBe(24);
      expect(first.mismatchChecks).toBe(0);
      expect(Object.keys(first.checks)).toHaveLength(24);
      expect(Object.values(first.checks).every((value) => value === 0)).toBe(true);
      expect(EMERGENCY_RECONCILIATION_CHECK_NAMES).toHaveLength(24);
      expect(first.evidenceSha256).toMatch(/^[0-9a-f]{64}$/);
      const persisted = sqlite.prepare(`SELECT status,scanned_count,matched_count,mismatch_count,result_summary_json
        FROM canonical_reconciliation_runs WHERE tenant_id='tenant-a' AND run_public_id='emergency-reconcile-001'`).get() as {
          status: string;
          scanned_count: number;
          matched_count: number;
          mismatch_count: number;
          result_summary_json: string;
        };
      expect(persisted).toMatchObject({ status: 'passed', scanned_count: 24, matched_count: 24, mismatch_count: 0 });
      const summary = JSON.parse(persisted.result_summary_json) as {
        namedChecks: string[];
        sourceFingerprints: unknown;
        integrity: { unresolvedCriticalIssues: number };
        secondPass: unknown;
      };
      expect(summary.namedChecks).toHaveLength(24);
      expect(summary.sourceFingerprints).toBeTruthy();
      expect(summary.integrity.unresolvedCriticalIssues).toBe(0);
      expect(summary.secondPass).toBeTruthy();
      expect(legacySnapshot(sqlite)).toBe(sourceSnapshot);

      const failed = await reconcileCanonicalEmergencyCaseTriage(db, {
        ...input,
        runPublicId: 'emergency-reconcile-failed',
        sourceFingerprintAfter: 'd'.repeat(64),
        secondPassNewBusinessRows: 1,
      });
      expect(failed.status).toBe('failed');
      expect(failed.mismatchChecks).toBe(2);
      expect(failed.checks.sourceFingerprintParity).toBe(1);
      expect(failed.checks.secondPassNewBusinessRows).toBe(1);
      expect(count(sqlite, 'canonical_reconciliation_runs')).toBe(2);
    } finally {
      sqlite.close();
    }
  });
});
