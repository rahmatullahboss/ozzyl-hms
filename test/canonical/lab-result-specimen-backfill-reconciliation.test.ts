import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  LabResultSpecimenBackfillDatabase,
  LabResultSpecimenBackfillPreparedStatement,
} from '../../scripts/canonical/backfill-lab-result-specimen';
import { backfillLabResultSpecimen } from '../../scripts/canonical/backfill-lab-result-specimen';
import type {
  LabResultSpecimenReconciliationDatabase,
  LabResultSpecimenReconciliationPreparedStatement,
} from '../../scripts/canonical/reconcile-lab-result-specimen';
import { reconcileLabResultSpecimen } from '../../scripts/canonical/reconcile-lab-result-specimen';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements LabResultSpecimenBackfillPreparedStatement, LabResultSpecimenReconciliationPreparedStatement {
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
  db: LabResultSpecimenBackfillDatabase & LabResultSpecimenReconciliationDatabase;
} {
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
    'migrations/0558_canonical_lab_result_specimen.sql',
  ]) sqlite.exec(readFileSync(migration, 'utf8'));

  sqlite.exec(`
    CREATE TABLE lab_order_items (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      order_id INTEGER NOT NULL,
      patient_id INTEGER NOT NULL,
      visit_id INTEGER NOT NULL,
      test_id INTEGER NOT NULL,
      specimen_id INTEGER,
      accession_number TEXT,
      status TEXT,
      result TEXT,
      result_numeric TEXT,
      result_unit TEXT,
      result_status TEXT,
      abnormal_flag TEXT,
      completed_at TEXT,
      verified_by INTEGER,
      verified_at TEXT,
      machine_id INTEGER,
      machine_result_log_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE lab_specimens (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      order_id INTEGER NOT NULL,
      patient_id INTEGER NOT NULL,
      accession_number TEXT NOT NULL,
      barcode TEXT NOT NULL,
      specimen_type TEXT NOT NULL,
      container_type TEXT,
      collection_status TEXT NOT NULL,
      collected_by INTEGER,
      collected_at TEXT,
      received_by INTEGER,
      received_at TEXT,
      rejected_by INTEGER,
      rejected_at TEXT,
      rejection_reason TEXT,
      parent_specimen_id INTEGER,
      transport_condition TEXT,
      location_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE lab_specimen_items (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      specimen_id INTEGER NOT NULL,
      order_item_id INTEGER NOT NULL,
      test_id INTEGER NOT NULL,
      created_at TEXT
    );
    CREATE TABLE lab_specimen_events (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      specimen_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT NOT NULL,
      performed_by INTEGER,
      event_at TEXT,
      location_id INTEGER,
      transport_condition TEXT,
      reason_code TEXT,
      notes TEXT,
      metadata_json TEXT
    );
    CREATE TABLE lab_results (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      order_id INTEGER NOT NULL,
      order_item_id INTEGER NOT NULL,
      test_id INTEGER NOT NULL,
      patient_id INTEGER NOT NULL,
      visit_id INTEGER NOT NULL,
      specimen_id INTEGER NOT NULL,
      result_value TEXT,
      result_numeric TEXT,
      unit TEXT,
      reference_low TEXT,
      reference_high TEXT,
      reference_text TEXT,
      abnormal_flag TEXT,
      status TEXT NOT NULL,
      reported_by INTEGER NOT NULL,
      reported_at TEXT,
      verified_by INTEGER,
      verified_at TEXT,
      machine_id INTEGER,
      machine_result_log_id INTEGER,
      analyzer_inbox_id INTEGER,
      is_retracted INTEGER NOT NULL DEFAULT 0,
      retracted_at TEXT,
      retraction_reason TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE lab_reports (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      order_id INTEGER NOT NULL,
      order_item_id INTEGER NOT NULL,
      patient_id INTEGER NOT NULL,
      visit_id INTEGER NOT NULL,
      report_status TEXT NOT NULL,
      review_status TEXT,
      reviewer_id INTEGER,
      validator_id INTEGER,
      verified_at TEXT,
      validated_at TEXT,
      published_at TEXT,
      delivered_at TEXT,
      corrected_at TEXT,
      retracted_at TEXT,
      retraction_reason TEXT,
      report_version INTEGER NOT NULL DEFAULT 1,
      supersedes_report_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE lab_observation_audit (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      result_id INTEGER NOT NULL,
      order_item_id INTEGER NOT NULL,
      specimen_id INTEGER NOT NULL,
      version_no INTEGER NOT NULL,
      supersedes_observation_id INTEGER,
      value_text TEXT,
      value_numeric TEXT,
      unit TEXT,
      abnormal_flag TEXT,
      status TEXT,
      verified_by INTEGER,
      verified_at TEXT,
      correction_reason TEXT,
      analyzer_inbox_id INTEGER,
      machine_result_log_id INTEGER,
      created_at TEXT
    );
    CREATE TABLE lab_result_corrections (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      result_id INTEGER NOT NULL,
      reason TEXT NOT NULL,
      corrected_by INTEGER NOT NULL,
      corrected_at TEXT NOT NULL
    );
    CREATE TABLE lis_ingestion_messages (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      message_public_id TEXT NOT NULL,
      machine_id INTEGER,
      bridge_agent_id INTEGER,
      protocol TEXT,
      payload_sha256 TEXT NOT NULL,
      received_at TEXT NOT NULL
    );
    CREATE TABLE lis_analyzer_inbox (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      source_public_id TEXT NOT NULL,
      ingestion_message_id INTEGER NOT NULL,
      observation_index INTEGER NOT NULL,
      machine_id INTEGER,
      protocol TEXT,
      payload_sha256 TEXT NOT NULL,
      qc_state TEXT NOT NULL,
      validation_state TEXT NOT NULL,
      match_state TEXT NOT NULL,
      disposition TEXT NOT NULL,
      accepted_result_id INTEGER,
      conversion_factor TEXT,
      accepted_at TEXT,
      created_at TEXT
    );
    CREATE TABLE lis_unmatched_results (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      source_public_id TEXT NOT NULL,
      reason_code TEXT NOT NULL,
      created_at TEXT
    );
    CREATE TABLE lis_ingestion_collisions (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      source_public_id TEXT NOT NULL,
      reason_code TEXT NOT NULL,
      created_at TEXT
    );
    CREATE TABLE tests (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      lab_order_item_id INTEGER,
      result TEXT,
      status TEXT,
      updated_at TEXT
    );
    CREATE TABLE visit_services (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      visit_id INTEGER NOT NULL,
      source_type TEXT,
      source_id INTEGER,
      status TEXT,
      updated_at TEXT
    );
  `);

  const db = {
    prepare(sql: string) { return new Statement(sqlite, sql); },
    async batch(statements: LabResultSpecimenBackfillPreparedStatement[]) {
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
  ) VALUES ('tenant-a','patient-link-101',101,'unlinked','unverified','no_link_placeholder',?,?,1)`)
    .run('1'.repeat(64), '2026-07-28T00:00:00.000Z');
  sqlite.prepare(`INSERT INTO canonical_source_mappings (
    tenant_id,entity_type,canonical_public_id,source_type,source_public_id,source_table,
    mapping_status,mapping_version,evidence_sha256
  ) VALUES ('tenant-a','patient_link','patient-link-101','legacy_patient','101','patients','mapped',1,?)`)
    .run('2'.repeat(64));

  for (const [practitioner, userId, name, hash] of [
    ['practitioner-901', 901, 'Collector', '3'],
    ['practitioner-902', 902, 'Verifier', '4'],
    ['practitioner-903', 903, 'Validator', '5'],
  ] as const) {
    sqlite.prepare(`INSERT INTO canonical_practitioners (
      tenant_id,practitioner_public_id,practitioner_kind,display_name,status,version,source_evidence_sha256
    ) VALUES ('tenant-a',?,'internal',?,'active',1,?)`).run(practitioner, name, hash.repeat(64));
    sqlite.prepare(`INSERT INTO canonical_practitioner_user_links (
      tenant_id,practitioner_public_id,legacy_user_id,link_status,evidence_type
    ) VALUES ('tenant-a',?,?,'active','legacy_doctor_user_id')`).run(practitioner, userId);
  }

  sqlite.prepare(`INSERT INTO canonical_encounters (
    tenant_id,encounter_public_id,legacy_patient_id,patient_link_public_id,encounter_type,
    status,encounter_version,source_kind,started_at_utc,source_evidence_sha256
  ) VALUES ('tenant-a','encounter-701',101,'patient-link-101','outpatient','in_progress',1,'runtime',?,?)`)
    .run('2026-07-28T08:00:00.000Z', '6'.repeat(64));
  sqlite.prepare(`INSERT INTO canonical_source_mappings (
    tenant_id,entity_type,canonical_public_id,source_type,source_public_id,source_table,
    mapping_status,mapping_version,evidence_sha256
  ) VALUES ('tenant-a','encounter','encounter-701','legacy_visit','701','visits','mapped',1,?)`)
    .run('7'.repeat(64));

  sqlite.prepare(`INSERT INTO canonical_service_catalog_items (
    tenant_id,service_public_id,item_kind,canonical_code,display_name,unit_code,status,source_evidence_sha256
  ) VALUES ('tenant-a','service-lab-301','laboratory','LAB-HB','Haemoglobin','test','active',?)`)
    .run('8'.repeat(64));
  sqlite.prepare(`INSERT INTO canonical_service_requests (
    tenant_id,request_public_id,legacy_patient_id,encounter_public_id,service_public_id,status,
    requested_at_utc,source_evidence_sha256
  ) VALUES ('tenant-a','request-501',101,'encounter-701','service-lab-301','fulfilled',?,?)`)
    .run('2026-07-28T08:10:00.000Z', '9'.repeat(64));
  sqlite.prepare(`INSERT INTO canonical_service_events (
    tenant_id,event_public_id,request_public_id,encounter_public_id,service_public_id,event_type,
    status,occurred_at_utc,source_evidence_sha256
  ) VALUES ('tenant-a','event-501','request-501','encounter-701','service-lab-301','completed','posted',?,?)`)
    .run('2026-07-28T09:00:00.000Z', 'a'.repeat(64));
  sqlite.prepare(`INSERT INTO canonical_source_mappings (
    tenant_id,entity_type,canonical_public_id,source_type,source_public_id,source_table,
    mapping_status,mapping_version,evidence_sha256
  ) VALUES
    ('tenant-a','service_request','request-501','legacy_lab_order_item','501','lab_order_items','mapped',1,?),
    ('tenant-a','service_event','event-501','legacy_lab_order_item_event','501','lab_order_items','mapped',1,?)`)
    .run('b'.repeat(64), 'c'.repeat(64));
}

function seedLegacy(sqlite: DatabaseSync): void {
  sqlite.prepare(`INSERT INTO lab_order_items VALUES
    (501,'tenant-a',401,101,701,301,601,'ACC-601','completed','13.5','13.5','g/dL','published','normal','2026-07-28 10:00:00',902,'2026-07-28 10:05:00',11,21,1,'2026-07-28 08:15:00','2026-07-28 10:05:00'),
    (502,'tenant-a',402,101,701,302,NULL,'ACC-UNMAPPED','ordered',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,'2026-07-28 08:20:00',NULL)`)
    .run();
  sqlite.prepare(`INSERT INTO lab_specimens VALUES
    (601,'tenant-a',401,101,'ACC-601','BAR-601','blood','edta','received',901,'2026-07-28 09:00:00',901,'2026-07-28 09:15:00',NULL,NULL,NULL,NULL,'ambient_ok',77,1,'2026-07-28 08:50:00','2026-07-28 09:15:00')`)
    .run();
  sqlite.prepare(`INSERT INTO lab_specimen_items VALUES
    (611,'tenant-a',601,501,301,'2026-07-28 08:51:00')`)
    .run();
  sqlite.prepare(`INSERT INTO lab_specimen_events VALUES
    (621,'tenant-a',601,'collected','registered','collected',901,'2026-07-28 09:00:00',77,NULL,'collected','Sensitive collection note','{"patient":"private"}'),
    (622,'tenant-a',601,'received','collected','received',901,'2026-07-28 09:15:00',78,'ambient_ok','received','Sensitive receipt note','{"patient":"private"}')`)
    .run();
  sqlite.prepare(`INSERT INTO lab_results VALUES
    (801,'tenant-a',401,501,301,101,701,601,NULL,'13.50','g/dL','12.0','16.0',NULL,'normal','final',901,'2026-07-28 10:00:00',902,'2026-07-28 10:05:00',11,21,1101,0,NULL,NULL,'2026-07-28 10:00:00','2026-07-28 10:05:00')`)
    .run();
  sqlite.prepare(`INSERT INTO lab_reports VALUES
    (901,'tenant-a',401,501,101,701,'published','validated',902,903,'2026-07-28 10:05:00','2026-07-28 10:08:00','2026-07-28 10:10:00','2026-07-28 10:20:00',NULL,NULL,NULL,1,NULL,1,'2026-07-28 10:00:00','2026-07-28 10:20:00')`)
    .run();
  sqlite.prepare(`INSERT INTO lab_observation_audit VALUES
    (1001,'tenant-a',801,501,601,1,NULL,NULL,'13.50','g/dL','normal','final',902,'2026-07-28 10:05:00',NULL,1101,21,'2026-07-28 10:05:00')`)
    .run();
  sqlite.prepare(`INSERT INTO lab_result_corrections VALUES
    (1051,'tenant-a',9999,'Legacy correction without exact result','902','2026-07-28 10:30:00')`)
    .run();
  sqlite.prepare(`INSERT INTO lis_ingestion_messages VALUES
    (1091,'tenant-a','message-1091',11,31,'HL7','d'||substr('ddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',1,63),'2026-07-28 09:59:00')`)
    .run();
  sqlite.prepare(`UPDATE lis_ingestion_messages SET payload_sha256=? WHERE id=1091`).run('d'.repeat(64));
  sqlite.prepare(`INSERT INTO lis_analyzer_inbox VALUES
    (1101,'tenant-a','inbox-1101',1091,0,11,'HL7',?,'passed','passed','matched','accepted',801,'1.00','2026-07-28 10:00:00','2026-07-28 09:59:30')`)
    .run('d'.repeat(64));
  sqlite.prepare(`INSERT INTO lis_unmatched_results VALUES
    (1201,'tenant-a','unmatched-1201','no_exact_order_mapping','2026-07-28 11:00:00')`)
    .run();
  sqlite.prepare(`INSERT INTO lis_ingestion_collisions VALUES
    (1301,'tenant-a','collision-1301','payload_identity_collision','2026-07-28 11:05:00')`)
    .run();
  sqlite.prepare(`INSERT INTO tests VALUES
    (1401,'tenant-a',501,'13.5','completed','2026-07-28 10:05:00')`)
    .run();
  sqlite.prepare(`INSERT INTO visit_services VALUES
    (1501,'tenant-a',701,'lab_order_item',501,'completed','2026-07-28 10:05:00')`)
    .run();
}

function count(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
}

function sourceSnapshot(sqlite: DatabaseSync): string {
  const tables = [
    'lab_order_items','lab_specimens','lab_specimen_items','lab_specimen_events','lab_results',
    'lab_reports','lab_observation_audit','lab_result_corrections','lis_ingestion_messages',
    'lis_analyzer_inbox','lis_unmatched_results','lis_ingestion_collisions','tests','visit_services',
  ];
  return JSON.stringify(Object.fromEntries(tables.map((table) => [table, sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all()])));
}

describe('canonical lab result and specimen backfill and reconciliation', () => {
  it('runs ten bounded resumable partitions, preserves legacy sources, creates exact facts, and records non-PHI dispositions', async () => {
    const { sqlite, db } = harness();
    try {
      const before = sourceSnapshot(sqlite);
      const first = await backfillLabResultSpecimen(db, {
        tenantId: 'tenant-a', runPublicId: 'lab-backfill-1',
        nowUtc: '2026-07-28T12:00:00.000Z', maxSourceRecords: 3,
      });
      expect(first.completed).toBe(false);
      expect(first.counts.scanned).toBe(3);
      expect(first.counts.specimensCreated).toBe(1);
      expect(first.counts.issues).toBe(1);

      const second = await backfillLabResultSpecimen(db, {
        tenantId: 'tenant-a', runPublicId: 'lab-backfill-1',
        nowUtc: '2026-07-28T12:10:00.000Z', maxSourceRecords: 100,
      });
      expect(second.completed).toBe(true);
      expect(count(sqlite, 'canonical_backfill_checkpoints')).toBe(10);
      expect(count(sqlite, 'canonical_lab_specimens')).toBe(1);
      expect(count(sqlite, 'canonical_lab_specimen_service_items')).toBe(1);
      expect(count(sqlite, 'canonical_lab_specimen_status_events')).toBe(3);
      expect(count(sqlite, 'canonical_lab_result_sets')).toBe(1);
      expect(count(sqlite, 'canonical_lab_result_versions')).toBe(1);
      expect(count(sqlite, 'canonical_lab_result_observations')).toBe(1);
      expect(count(sqlite, 'canonical_lab_result_status_events')).toBe(4);
      expect(count(sqlite, 'canonical_lab_analyzer_evidence')).toBe(1);
      expect(sourceSnapshot(sqlite)).toBe(before);

      const result = sqlite.prepare(`SELECT current_status,status_version FROM canonical_lab_result_sets`).get();
      expect(result).toEqual({ current_status: 'published', status_version: 4 });
      const specimen = sqlite.prepare(`SELECT current_status,status_version FROM canonical_lab_specimens`).get();
      expect(specimen).toEqual({ current_status: 'received', status_version: 3 });

      const issues = sqlite.prepare(`SELECT issue_code,details_json FROM canonical_processing_issues
        WHERE entity_type='lab_result_specimen' ORDER BY issue_code`).all() as Array<{ issue_code: string; details_json: string }>;
      expect(issues.map((row) => row.issue_code)).toEqual(expect.arrayContaining([
        'LAB_REQUEST_MAPPING_MISSING',
        'LAB_RESULT_CORRECTION_REVIEW_REQUIRED',
        'LAB_UNMATCHED_ANALYZER_RESULT',
        'LAB_INGESTION_COLLISION',
        'LAB_MUTABLE_RESULT_CACHE_DISPOSITION',
        'LAB_REPORT_DELIVERY_PROJECTION_ONLY',
      ]));
      for (const issue of issues) {
        for (const forbidden of ['Sensitive', 'private', '13.5', 'blood', 'ACC-601', 'BAR-601']) {
          expect(issue.details_json).not.toContain(forbidden);
        }
      }

      const third = await backfillLabResultSpecimen(db, {
        tenantId: 'tenant-a', runPublicId: 'lab-backfill-1',
        nowUtc: '2026-07-28T12:20:00.000Z', maxSourceRecords: 100,
      });
      expect(third.completed).toBe(true);
      expect(third.counts).toMatchObject({
        specimensCreated: 0, specimenEventsCreated: 0, resultSetsCreated: 0,
        resultVersionsCreated: 0, observationsCreated: 0, resultStatusEventsCreated: 0,
        analyzerEvidenceCreated: 0, mappingsCreated: 0, issues: 0,
      });
    } finally { sqlite.close(); }
  });

  it('persists a passed fixed 28-check receipt and fails closed on source, FK, integrity, and second-pass evidence', async () => {
    const { sqlite, db } = harness();
    try {
      await backfillLabResultSpecimen(db, {
        tenantId: 'tenant-a', runPublicId: 'lab-backfill-reconcile',
        nowUtc: '2026-07-28T12:00:00.000Z', maxSourceRecords: 100,
      });
      const passed = await reconcileLabResultSpecimen(db, {
        tenantId: 'tenant-a', runPublicId: 'lab-reconcile-1',
        migrationRunPublicId: 'lab-backfill-reconcile', nowUtc: '2026-07-28T12:30:00.000Z',
        sourceFingerprintBefore: 'e'.repeat(64), sourceFingerprintAfter: 'e'.repeat(64),
        foreignKeyViolationCount: 0, integrityStatus: 'ok', secondPassNewBusinessRows: 0,
      });
      expect(passed).toMatchObject({ status: 'passed', scannedChecks: 28, matchedChecks: 28, mismatchChecks: 0 });
      expect(Object.keys(passed.checks)).toHaveLength(28);
      expect(Object.values(passed.checks).every((value) => value === 0)).toBe(true);
      expect(passed.evidenceSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(sqlite.prepare(`SELECT domain,reconciliation_type,status,scanned_count,matched_count,mismatch_count
        FROM canonical_reconciliation_runs WHERE run_public_id='lab-reconcile-1'`).get()).toEqual({
        domain: 'lab_result_specimen', reconciliation_type: 'backfill', status: 'passed',
        scanned_count: 28, matched_count: 28, mismatch_count: 0,
      });

      const failed = await reconcileLabResultSpecimen(db, {
        tenantId: 'tenant-a', runPublicId: 'lab-reconcile-2',
        migrationRunPublicId: 'lab-backfill-reconcile', nowUtc: '2026-07-28T12:35:00.000Z',
        sourceFingerprintBefore: 'f'.repeat(64), sourceFingerprintAfter: '0'.repeat(64),
        foreignKeyViolationCount: 1, integrityStatus: 'failed', secondPassNewBusinessRows: 1,
      });
      expect(failed.status).toBe('failed');
      expect(failed.checks.sourceFingerprintMismatch).toBe(1);
      expect(failed.checks.foreignKeyOrIntegrityFailure).toBe(2);
      expect(failed.checks.secondPassNewBusinessRows).toBe(1);
    } finally { sqlite.close(); }
  });
});
