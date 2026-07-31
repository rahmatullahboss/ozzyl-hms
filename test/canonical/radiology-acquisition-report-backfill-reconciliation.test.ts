import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { CanonicalBatchDatabase, CanonicalPreparedStatement } from '../../src/lib/canonical/command-batch';
import {
  backfillCanonicalRadiologyAcquisitionReport,
  type RadiologyAcquisitionReportBackfillDatabase,
} from '../../scripts/canonical/backfill-radiology-acquisition-report';
import {
  reconcileCanonicalRadiologyAcquisitionReport,
  type RadiologyAcquisitionReportReconciliationDatabase,
} from '../../scripts/canonical/reconcile-radiology-acquisition-report';

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
  db: RadiologyAcquisitionReportBackfillDatabase & RadiologyAcquisitionReportReconciliationDatabase;
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
    'migrations/0559_canonical_radiology_acquisition_report.sql',
  ]) sqlite.exec(readFileSync(migration, 'utf8'));

  sqlite.exec(`
    CREATE TABLE radiology_requisitions (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      visit_id INTEGER,
      admission_id INTEGER,
      imaging_type_id INTEGER,
      imaging_type_name TEXT,
      imaging_item_id INTEGER,
      imaging_item_name TEXT,
      procedure_code TEXT,
      prescriber_id INTEGER,
      prescriber_name TEXT,
      imaging_date TEXT,
      requisition_remarks TEXT,
      urgency TEXT,
      ward_name TEXT,
      has_insurance INTEGER,
      order_status TEXT,
      is_report_saved INTEGER,
      is_scanned INTEGER,
      scanned_by TEXT,
      scanned_on TEXT,
      scan_remarks TEXT,
      film_type_id INTEGER,
      film_quantity INTEGER,
      is_active INTEGER,
      cancel_remarks TEXT,
      created_by TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE radiology_reports (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      requisition_id INTEGER NOT NULL,
      patient_id INTEGER NOT NULL,
      visit_id INTEGER,
      imaging_type_id INTEGER,
      imaging_type_name TEXT,
      imaging_item_id INTEGER,
      imaging_item_name TEXT,
      prescriber_id INTEGER,
      prescriber_name TEXT,
      performer_id INTEGER,
      performer_name TEXT,
      template_id INTEGER,
      report_text TEXT,
      indication TEXT,
      radiology_number TEXT,
      image_name TEXT,
      image_key TEXT,
      patient_study_id INTEGER,
      signatories TEXT,
      order_status TEXT,
      is_active INTEGER,
      created_by TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE radiology_dicom_studies (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER,
      patient_name TEXT,
      study_instance_uid TEXT NOT NULL,
      sop_class_uid TEXT,
      study_date TEXT,
      modality TEXT,
      study_description TEXT,
      requisition_id INTEGER,
      is_mapped INTEGER,
      series_count INTEGER,
      image_count INTEGER,
      is_active INTEGER,
      updated_at TEXT,
      r2_key TEXT,
      source_ae_title TEXT,
      created_at TEXT
    );
    CREATE TABLE ris_study_reconciliation_queue (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      requisition_id INTEGER,
      dicom_study_id INTEGER,
      accession_no TEXT,
      study_instance_uid TEXT,
      patient_id INTEGER,
      patient_name TEXT,
      modality TEXT,
      issue_type TEXT NOT NULL,
      status TEXT NOT NULL,
      suggested_match_json TEXT,
      resolved_by INTEGER,
      resolved_at TEXT,
      resolution_notes TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE radiology_film_usage (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      requisition_id INTEGER,
      film_type_id INTEGER,
      quantity INTEGER,
      created_at TEXT
    );
    CREATE TABLE radiology_report_templates (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT,
      created_at TEXT
    );
    CREATE TABLE invoice_items (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      item_type TEXT,
      reference_id INTEGER,
      created_at TEXT
    );
  `);

  const db: RadiologyAcquisitionReportBackfillDatabase & RadiologyAcquisitionReportReconciliationDatabase = {
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

function seedCanonical(sqlite: DatabaseSync): void {
  sqlite.prepare(`INSERT INTO canonical_tenant_patient_links (
    tenant_id,patient_link_public_id,legacy_patient_id,link_status,verification_level,
    evidence_type,evidence_sha256,effective_from_utc,version
  ) VALUES ('tenant-a','patient-link-101',101,'unlinked','unverified','no_link_placeholder',?, '2026-07-28T00:00:00.000Z',1)`)
    .run('1'.repeat(64));

  for (const [practitioner, name, legacyUser, hash] of [
    ['practitioner-performer', 'Radiologist', 9001, '2'],
    ['practitioner-prescriber', 'Prescriber', 9002, '3'],
  ] as const) {
    sqlite.prepare(`INSERT INTO canonical_practitioners (
      tenant_id,practitioner_public_id,practitioner_kind,display_name,status,version,source_evidence_sha256
    ) VALUES ('tenant-a',?,'internal',?,'active',1,?)`).run(practitioner, name, hash.repeat(64));
    sqlite.prepare(`INSERT INTO canonical_practitioner_user_links (
      tenant_id,practitioner_public_id,legacy_user_id,link_status,evidence_type
    ) VALUES ('tenant-a',?,?,'active','approved_manual')`).run(practitioner, legacyUser);
  }

  sqlite.prepare(`INSERT INTO canonical_encounters (
    tenant_id,encounter_public_id,legacy_patient_id,patient_link_public_id,
    encounter_type,status,encounter_version,source_kind,started_at_utc,source_evidence_sha256
  ) VALUES ('tenant-a','encounter-101',101,'patient-link-101','outpatient','in_progress',1,'runtime','2026-07-28T08:00:00.000Z',?)`)
    .run('4'.repeat(64));

  sqlite.prepare(`INSERT INTO canonical_service_catalog_items (
    tenant_id,service_public_id,item_kind,canonical_code,display_name,unit_code,status,source_evidence_sha256
  ) VALUES ('tenant-a','service-img-101','radiology','IMG-CXR','Chest X-ray','study','active',?)`)
    .run('5'.repeat(64));

  sqlite.prepare(`INSERT INTO canonical_service_requests (
    tenant_id,request_public_id,legacy_patient_id,encounter_public_id,service_public_id,
    status,requested_at_utc,source_evidence_sha256
  ) VALUES ('tenant-a','request-101',101,'encounter-101','service-img-101','fulfilled','2026-07-28T08:10:00.000Z',?)`)
    .run('6'.repeat(64));
  sqlite.prepare(`INSERT INTO canonical_service_events (
    tenant_id,event_public_id,request_public_id,encounter_public_id,service_public_id,
    event_type,status,occurred_at_utc,source_evidence_sha256
  ) VALUES ('tenant-a','event-101','request-101','encounter-101','service-img-101','completed','posted','2026-07-28T09:10:00.000Z',?)`)
    .run('7'.repeat(64));

  const mappings = [
    ['encounter', 'encounter-101', 'legacy_visit', '11', 'visits'],
    ['service_request', 'request-101', 'legacy_radiology_requisition', '501', 'radiology_requisitions'],
    ['service_event', 'event-101', 'legacy_radiology_requisition_event', '501', 'radiology_requisitions'],
    ['service_catalog', 'service-img-101', 'legacy_radiology_imaging_item', '77', 'radiology_imaging_items'],
    ['practitioner', 'practitioner-performer', 'legacy_doctor', '9001', 'doctors'],
    ['practitioner', 'practitioner-prescriber', 'legacy_doctor', '9002', 'doctors'],
  ] as const;
  for (const [entityType, canonicalId, sourceType, sourceId, sourceTable] of mappings) {
    sqlite.prepare(`INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,source_table,
      mapping_status,mapping_version,evidence_sha256,created_at_utc,updated_at_utc
    ) VALUES ('tenant-a',?,?,?,?,?,'mapped',1,?,'2026-07-28T00:00:00.000Z','2026-07-28T00:00:00.000Z')`)
      .run(entityType, canonicalId, sourceType, sourceId, sourceTable, '8'.repeat(64));
  }
}

function seedLegacy(sqlite: DatabaseSync): void {
  sqlite.prepare(`INSERT INTO radiology_requisitions VALUES (
    501,'tenant-a',101,11,NULL,1,'X-Ray',77,'Chest X-ray','CR',9002,'Prescriber',
    '2026-07-28','Cough','normal',NULL,0,'reported',1,1,'9001','2026-07-28 09:00:00',
    'Completed',NULL,NULL,1,NULL,'9002','2026-07-28 08:10:00','2026-07-28 09:15:00'
  )`).run();
  sqlite.prepare(`INSERT INTO radiology_dicom_studies VALUES (
    701,'tenant-a',101,'Patient Name','1.2.840.113619.2.55.3.701','1.2.840.10008.5.1.4.1.1.1',
    '2026-07-28','CR','PA chest',501,1,2,5,1,'2026-07-28 09:08:00',
    'dicom/701/study.dcm','MODALITY_AE','2026-07-28 09:01:00'
  )`).run();
  sqlite.prepare(`INSERT INTO radiology_reports VALUES (
    901,'tenant-a',501,101,11,1,'X-Ray',77,'Chest X-ray',9002,'Prescriber',9001,'Radiologist',
    NULL,'No focal opacity. No acute cardiopulmonary abnormality.','Cough','RAD-901',NULL,NULL,701,
    '[{"practitioner":"9001","role":"radiologist"}]','final',1,'9001','2026-07-28 10:00:00','2026-07-28 10:15:00'
  )`).run();
  sqlite.prepare(`INSERT INTO ris_study_reconciliation_queue VALUES (
    1001,'tenant-a',501,701,'ACC-501','1.2.840.113619.2.55.3.701',101,'Patient Name','CR',
    'suggested_match_only','open','{"score":0.91}',NULL,NULL,NULL,'2026-07-28 09:05:00','2026-07-28 09:05:00'
  )`).run();
  sqlite.prepare(`INSERT INTO radiology_film_usage VALUES (1101,'tenant-a',501,1,2,'2026-07-28 10:30:00')`).run();
  sqlite.prepare(`INSERT INTO radiology_report_templates VALUES (1201,'tenant-a','Chest template','2026-07-28 07:00:00')`).run();
  sqlite.prepare(`INSERT INTO invoice_items VALUES (1301,'tenant-a','radiology',501,'2026-07-28 08:20:00')`).run();
}

function count(sqlite: DatabaseSync, table: string, where = ''): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table} ${where}`).get() as { count: number }).count);
}

function legacyFingerprint(sqlite: DatabaseSync): string {
  const rows = {
    requisitions: sqlite.prepare(`SELECT * FROM radiology_requisitions ORDER BY id`).all(),
    reports: sqlite.prepare(`SELECT * FROM radiology_reports ORDER BY id`).all(),
    studies: sqlite.prepare(`SELECT * FROM radiology_dicom_studies ORDER BY id`).all(),
    queue: sqlite.prepare(`SELECT * FROM ris_study_reconciliation_queue ORDER BY id`).all(),
    films: sqlite.prepare(`SELECT * FROM radiology_film_usage ORDER BY id`).all(),
    templates: sqlite.prepare(`SELECT * FROM radiology_report_templates ORDER BY id`).all(),
    invoiceItems: sqlite.prepare(`SELECT * FROM invoice_items ORDER BY id`).all(),
  };
  return JSON.stringify(rows);
}

async function completeBackfill(db: RadiologyAcquisitionReportBackfillDatabase, maxSourceRecords = 2) {
  let last = await backfillCanonicalRadiologyAcquisitionReport(db, {
    tenantId: 'tenant-a',
    runPublicId: 'radiology-backfill-001',
    nowUtc: '2026-07-28T12:00:00.000Z',
    maxSourceRecords,
  });
  for (let attempt = 0; !last.completed && attempt < 30; attempt += 1) {
    last = await backfillCanonicalRadiologyAcquisitionReport(db, {
      tenantId: 'tenant-a',
      runPublicId: 'radiology-backfill-001',
      nowUtc: '2026-07-28T12:00:00.000Z',
      maxSourceRecords,
    });
  }
  expect(last.completed).toBe(true);
  return last;
}

describe('canonical radiology acquisition/report bounded backfill and reconciliation', () => {
  it('runs ten durable bounded partitions, preserves sources, reconstructs exact facts, emits deterministic issues, and has a zero-row second pass', async () => {
    const { sqlite, db } = harness();
    try {
      const before = legacyFingerprint(sqlite);
      const first = await backfillCanonicalRadiologyAcquisitionReport(db, {
        tenantId: 'tenant-a',
        runPublicId: 'radiology-backfill-001',
        nowUtc: '2026-07-28T12:00:00.000Z',
        maxSourceRecords: 2,
      });
      expect(first.completed).toBe(false);
      const completed = await completeBackfill(db, 2);
      expect(completed.completed).toBe(true);
      expect(legacyFingerprint(sqlite)).toBe(before);

      expect(count(sqlite, 'canonical_backfill_checkpoints', `WHERE tenant_id='tenant-a'`)).toBe(10);
      expect(count(sqlite, 'canonical_backfill_checkpoints', `WHERE tenant_id='tenant-a' AND status='completed'`)).toBe(10);
      expect(count(sqlite, 'canonical_imaging_acquisitions')).toBe(1);
      expect(count(sqlite, 'canonical_imaging_acquisition_status_events')).toBe(3);
      expect(sqlite.prepare(`SELECT current_status,status_version FROM canonical_imaging_acquisitions`).get())
        .toEqual({ current_status: 'completed', status_version: 3 });
      expect(count(sqlite, 'canonical_imaging_studies')).toBe(1);
      expect(count(sqlite, 'canonical_imaging_series')).toBe(0);
      expect(count(sqlite, 'canonical_imaging_instances')).toBe(0);
      expect(count(sqlite, 'canonical_imaging_provenance_events')).toBe(1);
      expect(count(sqlite, 'canonical_imaging_report_sets')).toBe(1);
      expect(count(sqlite, 'canonical_imaging_report_versions')).toBe(1);
      expect(count(sqlite, 'canonical_imaging_report_status_events')).toBe(4);
      expect(sqlite.prepare(`SELECT current_status,status_version FROM canonical_imaging_report_sets`).get())
        .toEqual({ current_status: 'published', status_version: 4 });

      const issueCodes = (sqlite.prepare(`SELECT issue_code FROM canonical_processing_issues ORDER BY issue_code`).all() as { issue_code: string }[])
        .map((row) => row.issue_code);
      expect(issueCodes).toContain('RAD_DICOM_HIERARCHY_NOT_EXACT');
      expect(issueCodes).toContain('RAD_STORAGE_IDENTITY_INCOMPLETE');
      expect(issueCodes).toContain('RAD_RIS_RECONCILIATION_UNRESOLVED');
      const issueRows = sqlite.prepare(`SELECT summary,details_json,entity_public_id FROM canonical_processing_issues`).all() as Array<Record<string, unknown>>;
      expect(JSON.stringify(issueRows)).not.toContain('Patient Name');
      expect(JSON.stringify(issueRows)).not.toContain('No focal opacity');

      const second = await backfillCanonicalRadiologyAcquisitionReport(db, {
        tenantId: 'tenant-a',
        runPublicId: 'radiology-backfill-001',
        nowUtc: '2026-07-28T12:05:00.000Z',
        maxSourceRecords: 100,
      });
      expect(second.completed).toBe(true);
      expect(second.counts.acquisitionsCreated).toBe(0);
      expect(second.counts.studiesCreated).toBe(0);
      expect(second.counts.provenanceEventsCreated).toBe(0);
      expect(second.counts.reportSetsCreated).toBe(0);
      expect(second.counts.reportVersionsCreated).toBe(0);
      expect(second.counts.mappingsCreated).toBe(0);
      expect(second.counts.issuesCreated).toBe(0);
      expect(legacyFingerprint(sqlite)).toBe(before);
    } finally {
      sqlite.close();
    }
  });

  it('persists and replays one fixed thirty-check reconciliation receipt with fingerprint, integrity, and second-pass evidence', async () => {
    const { sqlite, db } = harness();
    try {
      await completeBackfill(db, 100);
      const input = {
        tenantId: 'tenant-a',
        runPublicId: 'radiology-reconcile-001',
        migrationRunPublicId: 'radiology-backfill-001',
        nowUtc: '2026-07-28T12:10:00.000Z',
        sourceFingerprintBefore: 'a'.repeat(64),
        sourceFingerprintAfter: 'a'.repeat(64),
        foreignKeyViolationCount: 0,
        integrityStatus: 'ok' as const,
        secondPassNewBusinessRows: 0,
      };
      const first = await reconcileCanonicalRadiologyAcquisitionReport(db, input);
      const second = await reconcileCanonicalRadiologyAcquisitionReport(db, input);
      expect(first).toEqual(second);
      expect(first.status).toBe('passed');
      expect(first.scannedChecks).toBe(30);
      expect(first.matchedChecks).toBe(30);
      expect(first.mismatchChecks).toBe(0);
      expect(Object.keys(first.checks)).toHaveLength(30);
      expect(Object.values(first.checks).every((value) => value === 0)).toBe(true);
      expect(first.evidenceSha256).toMatch(/^[0-9a-f]{64}$/);

      const persisted = sqlite.prepare(`SELECT status,scanned_count,matched_count,mismatch_count,result_summary_json FROM canonical_reconciliation_runs WHERE tenant_id='tenant-a' AND run_public_id='radiology-reconcile-001'`).get() as {
        status: string;
        scanned_count: number;
        matched_count: number;
        mismatch_count: number;
        result_summary_json: string;
      };
      expect(persisted.status).toBe('passed');
      expect(persisted.scanned_count).toBe(30);
      expect(persisted.matched_count).toBe(30);
      expect(persisted.mismatch_count).toBe(0);
      const summary = JSON.parse(persisted.result_summary_json) as { namedChecks: string[]; sourceFingerprints: unknown; integrity: unknown; secondPass: unknown };
      expect(summary.namedChecks).toHaveLength(30);
      expect(summary.sourceFingerprints).toBeTruthy();
      expect(summary.integrity).toBeTruthy();
      expect(summary.secondPass).toBeTruthy();
      expect(count(sqlite, 'canonical_reconciliation_runs')).toBe(1);
    } finally {
      sqlite.close();
    }
  });
});
