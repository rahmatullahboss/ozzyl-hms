import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  PatientVitalMeasurementBackfillDatabase,
  PatientVitalMeasurementBackfillPreparedStatement,
} from '../../scripts/canonical/backfill-patient-vital-measurement';
import { backfillPatientVitalMeasurement } from '../../scripts/canonical/backfill-patient-vital-measurement';
import type {
  PatientVitalMeasurementReconciliationDatabase,
  PatientVitalMeasurementReconciliationPreparedStatement,
} from '../../scripts/canonical/reconcile-patient-vital-measurement';
import { reconcilePatientVitalMeasurement } from '../../scripts/canonical/reconcile-patient-vital-measurement';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements PatientVitalMeasurementBackfillPreparedStatement, PatientVitalMeasurementReconciliationPreparedStatement {
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
  db: PatientVitalMeasurementBackfillDatabase & PatientVitalMeasurementReconciliationDatabase;
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
    'migrations/0556_canonical_patient_vital_measurement.sql',
  ]) sqlite.exec(readFileSync(migration, 'utf8'));
  sqlite.exec(`
    CREATE TABLE patient_vitals (
      id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, patient_id INTEGER NOT NULL,
      admission_id INTEGER, systolic INTEGER, diastolic INTEGER, temperature REAL,
      heart_rate INTEGER, spo2 REAL, respiratory_rate INTEGER, weight REAL,
      notes TEXT, recorded_by TEXT, recorded_at TEXT, source TEXT
    );
    CREATE TABLE clinical_vitals (
      id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, patient_id INTEGER NOT NULL,
      visit_id INTEGER, temperature REAL, pulse INTEGER, blood_pressure_systolic INTEGER,
      blood_pressure_diastolic INTEGER, respiratory_rate INTEGER, spo2 REAL, weight REAL,
      height REAL, bmi REAL, pain_scale INTEGER, blood_sugar REAL, notes TEXT,
      taken_by INTEGER, taken_at TEXT, is_active INTEGER, source TEXT
    );
    CREATE TABLE global_patient_vitals (
      id INTEGER PRIMARY KEY, uhid TEXT, logged_on TEXT, patient_id INTEGER, logged_at TEXT,
      systolic INTEGER, diastolic INTEGER, heart_rate INTEGER, blood_sugar REAL,
      blood_sugar_context TEXT, weight_kg REAL, temperature_f REAL, spo2 REAL,
      notes TEXT, source TEXT, review_status TEXT, classification_json TEXT, alert_json TEXT,
      created_at TEXT, updated_at TEXT
    );
    CREATE TABLE nur_patient_monitoring (
      id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, patient_id INTEGER NOT NULL,
      visit_id INTEGER NOT NULL, temperature REAL, temperature_unit TEXT, pulse INTEGER,
      respiration INTEGER, bp_systolic INTEGER, bp_diastolic INTEGER, spo2 REAL,
      pain_scale INTEGER, remarks TEXT, recorded_on TEXT, is_active INTEGER,
      created_by INTEGER, created_at TEXT
    );
    CREATE TABLE vital_alerts (
      id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, patient_id INTEGER NOT NULL,
      vital_id INTEGER NOT NULL, rule_id INTEGER NOT NULL, vital_type TEXT NOT NULL,
      recorded_value REAL NOT NULL, severity TEXT NOT NULL, status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE wearable_samples (
      id INTEGER PRIMARY KEY, patient_id INTEGER NOT NULL, sample_type TEXT NOT NULL,
      value REAL NOT NULL, date TEXT, timestamp TEXT, device_name TEXT, platform TEXT
    );
  `);
  const db = {
    prepare(sql: string) { return new Statement(sqlite, sql); },
    async batch(statements: PatientVitalMeasurementBackfillPreparedStatement[]) {
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
  sqlite.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES
      ('tenant-a','patient_link','ptl-101','legacy_patient','101','patients','mapped',1,?),
      ('tenant-a','patient_link','ptl-101','global_patient_uhid','UHID-101','global_patient_identity','mapped',1,?)
  `).run('2'.repeat(64), '3'.repeat(64));
  sqlite.prepare(`
    INSERT INTO canonical_practitioners (
      tenant_id,practitioner_public_id,practitioner_kind,display_name,status,
      version,source_evidence_sha256
    ) VALUES ('tenant-a','prac-901','internal','Recorder','active',1,?)
  `).run('4'.repeat(64));
  sqlite.prepare(`
    INSERT INTO canonical_practitioner_user_links (
      tenant_id,practitioner_public_id,legacy_user_id,link_status,evidence_type
    ) VALUES ('tenant-a','prac-901',901,'active','legacy_doctor_user_id')
  `).run();
  for (const [encounterPublicId, legacyId, sourceType, started, hash] of [
    ['enc-701', 701, 'legacy_visit', '2026-07-28T08:00:00.000Z', '5'],
    ['enc-801', 801, 'legacy_admission', '2026-07-28T08:30:00.000Z', '6'],
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
    `).run(encounterPublicId, sourceType, String(legacyId), sourceType === 'legacy_visit' ? 'visits' : 'admissions', hash.repeat(64));
  }
}

function seedLegacy(sqlite: DatabaseSync): void {
  sqlite.prepare(`
    INSERT INTO patient_vitals VALUES
      (501,'tenant-a',101,801,120,80,37,80,98,18,72,'Sensitive note','901','2026-07-28T09:00:00.000Z','recorded'),
      (502,'tenant-a',101,999,130,85,38,90,95,20,70,'Unmapped encounter','901','2026-07-28T09:10:00.000Z','recorded')
  `).run();
  sqlite.prepare(`
    INSERT INTO clinical_vitals VALUES
      (601,'tenant-a',101,701,98.6,80,120,80,18,98,72,180,99,2,100,'Sensitive clinical note',901,
       '2026-07-28T09:00:00.000Z',1,'recorded')
  `).run();
  sqlite.prepare(`
    INSERT INTO global_patient_vitals VALUES
      (701,'UHID-101','2026-07-28',NULL,NULL,118,78,76,95,'fasting',NULL,NULL,NULL,'Patient note',
       'patient_reported','pending_review',NULL,NULL,'2026-07-28T10:00:00.000Z','2026-07-28T10:00:00.000Z'),
      (702,NULL,NULL,101,'2026-07-28T10:10:00.000Z',125,82,78,110,'random',71,99.1,97,'Wellness note',
       'patient_reported','pending_review','{"bp":"normal"}','{"severity":"info"}',
       '2026-07-28T10:10:00.000Z','2026-07-28T10:10:00.000Z')
  `).run();
  sqlite.prepare(`
    INSERT INTO nur_patient_monitoring VALUES
      (801,'tenant-a',101,701,99.1,'F',79,17,121,79,98,1,'Sensitive nursing remark',
       '2026-07-28T10:20:00.000Z',1,901,'2026-07-28T10:20:00.000Z')
  `).run();
  sqlite.prepare(`
    INSERT INTO vital_alerts VALUES
      (901,'tenant-a',101,501,1,'systolic',120,'warning','active','2026-07-28T09:00:01.000Z')
  `).run();
  sqlite.prepare(`
    INSERT INTO wearable_samples VALUES
      (1001,101,'heart_rate',77,'2026-07-28','2026-07-28T11:00:00.000Z','Private Watch','ios')
  `).run();
}

function count(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
}

function sourceSnapshot(sqlite: DatabaseSync): string {
  return JSON.stringify({
    patient: sqlite.prepare(`SELECT * FROM patient_vitals ORDER BY id`).all(),
    clinical: sqlite.prepare(`SELECT * FROM clinical_vitals ORDER BY id`).all(),
    global: sqlite.prepare(`SELECT * FROM global_patient_vitals ORDER BY id`).all(),
    nursing: sqlite.prepare(`SELECT * FROM nur_patient_monitoring ORDER BY id`).all(),
    alerts: sqlite.prepare(`SELECT * FROM vital_alerts ORDER BY id`).all(),
    wearable: sqlite.prepare(`SELECT * FROM wearable_samples ORDER BY id`).all(),
  });
}

describe('canonical patient vital measurement backfill and reconciliation', () => {
  it('runs nine bounded resumable partitions, migrates exact evidence, and records stable non-PHI issues', async () => {
    const { sqlite, db } = harness();
    try {
      const before = sourceSnapshot(sqlite);
      const first = await backfillPatientVitalMeasurement(db, {
        tenantId: 'tenant-a',
        runPublicId: 'vital-backfill-1',
        nowUtc: '2026-07-28T12:00:00.000Z',
        maxSourceRecords: 2,
      });
      expect(first.completed).toBe(false);
      expect(first.counts.scanned).toBe(2);
      expect(first.counts.observationSetsCreated).toBe(1);
      expect(first.counts.issues).toBe(1);

      const second = await backfillPatientVitalMeasurement(db, {
        tenantId: 'tenant-a',
        runPublicId: 'vital-backfill-1',
        nowUtc: '2026-07-28T12:05:00.000Z',
        maxSourceRecords: 100,
      });
      expect(second.completed).toBe(true);
      expect(second.counts.scanned).toBeGreaterThanOrEqual(7);
      expect(count(sqlite, 'canonical_vital_observation_sets')).toBe(5);
      expect(count(sqlite, 'canonical_vital_observation_components')).toBeGreaterThan(20);
      expect(count(sqlite, 'canonical_vital_observation_status_events')).toBe(5);
      expect(count(sqlite, 'canonical_backfill_checkpoints')).toBe(9);
      expect(sourceSnapshot(sqlite)).toBe(before);

      const issueRows = sqlite.prepare(`
        SELECT issue_code,source_type,source_public_id,details_json
        FROM canonical_processing_issues ORDER BY issue_code
      `).all() as Array<Record<string, unknown>>;
      expect(issueRows.map((row) => row.issue_code)).toEqual(expect.arrayContaining([
        'VITAL_ALERT_PROJECTION_RELINK_REQUIRED',
        'VITAL_DERIVED_BMI_MISMATCH',
        'VITAL_DEVICE_IDENTITY_UNRESOLVED',
        'VITAL_ENCOUNTER_MAPPING_MISSING',
      ]));
      for (const row of issueRows) {
        const details = String(row.details_json ?? '');
        for (const forbidden of ['Sensitive', 'Private Watch', 'Patient note', 'Wellness note']) {
          expect(details).not.toContain(forbidden);
        }
      }

      const third = await backfillPatientVitalMeasurement(db, {
        tenantId: 'tenant-a',
        runPublicId: 'vital-backfill-1',
        nowUtc: '2026-07-28T12:10:00.000Z',
        maxSourceRecords: 100,
      });
      expect(third.completed).toBe(true);
      expect(third.counts).toMatchObject({
        observationSetsCreated: 0,
        componentsCreated: 0,
        statusEventsCreated: 0,
        mappingsCreated: 0,
        issues: 0,
      });
      expect(count(sqlite, 'canonical_vital_observation_sets')).toBe(5);
    } finally {
      sqlite.close();
    }
  });

  it('persists a passed fixed 20-check receipt and fails closed on source/integrity evidence mismatch', async () => {
    const { sqlite, db } = harness();
    try {
      await backfillPatientVitalMeasurement(db, {
        tenantId: 'tenant-a',
        runPublicId: 'vital-backfill-reconcile',
        nowUtc: '2026-07-28T12:00:00.000Z',
        maxSourceRecords: 100,
      });
      const passed = await reconcilePatientVitalMeasurement(db, {
        tenantId: 'tenant-a',
        runPublicId: 'vital-reconcile-1',
        migrationRunPublicId: 'vital-backfill-reconcile',
        nowUtc: '2026-07-28T12:30:00.000Z',
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
        FROM canonical_reconciliation_runs WHERE run_public_id='vital-reconcile-1'
      `).get()).toEqual({
        domain: 'patient_vital_measurement',
        reconciliation_type: 'backfill',
        status: 'passed',
        scanned_count: 20,
        matched_count: 20,
        mismatch_count: 0,
      });

      const failed = await reconcilePatientVitalMeasurement(db, {
        tenantId: 'tenant-a',
        runPublicId: 'vital-reconcile-2',
        migrationRunPublicId: 'vital-backfill-reconcile',
        nowUtc: '2026-07-28T12:35:00.000Z',
        sourceFingerprintBefore: 'b'.repeat(64),
        sourceFingerprintAfter: 'c'.repeat(64),
        foreignKeyViolationCount: 1,
        integrityStatus: 'failed',
        secondPassNewBusinessRows: 1,
      });
      expect(failed.status).toBe('failed');
      expect(failed.mismatchChecks).toBeGreaterThanOrEqual(3);
      expect(failed.checks.sourceFingerprintMismatch).toBe(1);
      expect(failed.checks.foreignKeyViolations).toBe(1);
      expect(failed.checks.secondPassNewBusinessRows).toBe(1);
    } finally {
      sqlite.close();
    }
  });
});
