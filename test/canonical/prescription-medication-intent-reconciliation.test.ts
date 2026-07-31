import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  PrescriptionMedicationReconciliationDatabase,
  PrescriptionMedicationReconciliationPreparedStatement,
} from '../../scripts/canonical/reconcile-prescription-medication-intent';
import { reconcilePrescriptionMedicationIntent } from '../../scripts/canonical/reconcile-prescription-medication-intent';
import type {
  PrescriptionMedicationBackfillDatabase,
  PrescriptionMedicationBackfillPreparedStatement,
} from '../../scripts/canonical/backfill-prescription-medication-intent';
import { backfillPrescriptionMedicationIntent } from '../../scripts/canonical/backfill-prescription-medication-intent';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements PrescriptionMedicationBackfillPreparedStatement, PrescriptionMedicationReconciliationPreparedStatement {
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
  db: PrescriptionMedicationBackfillDatabase & PrescriptionMedicationReconciliationDatabase;
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
    'migrations/0554_canonical_prescription_medication_intent.sql',
  ]) sqlite.exec(readFileSync(migration, 'utf8'));
  sqlite.exec(`
    CREATE TABLE prescriptions (
      id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, patient_id INTEGER NOT NULL,
      doctor_id INTEGER, appointment_id INTEGER, admission_id INTEGER,
      completion_claim_id INTEGER, status TEXT NOT NULL, is_locked INTEGER NOT NULL,
      created_by INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE prescription_items (
      id INTEGER PRIMARY KEY, prescription_id INTEGER NOT NULL, medicine_name TEXT NOT NULL,
      dosage TEXT, frequency TEXT, duration TEXT, instructions TEXT, sort_order INTEGER,
      quantity INTEGER, dispensed_qty INTEGER, medicine_id INTEGER
    );
    CREATE TABLE consultation_completion_claims (
      id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, appointment_id INTEGER NOT NULL,
      patient_id INTEGER NOT NULL, visit_id INTEGER NOT NULL, doctor_id INTEGER NOT NULL,
      encounter_id INTEGER, status TEXT NOT NULL
    );
    CREATE TABLE prescription_versions (
      id INTEGER PRIMARY KEY, prescription_id INTEGER NOT NULL, version_number INTEGER NOT NULL,
      snapshot TEXT NOT NULL, edited_by TEXT NOT NULL, edit_reason TEXT, tenant_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE prescription_overrides (
      id INTEGER PRIMARY KEY, prescription_id INTEGER NOT NULL, patient_id INTEGER NOT NULL,
      doctor_id INTEGER NOT NULL, override_type TEXT NOT NULL, allergen TEXT NOT NULL,
      severity TEXT, reason TEXT NOT NULL, tenant_id TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE prescription_safety_checks (
      id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, prescription_id INTEGER,
      patient_id INTEGER NOT NULL, medication_name TEXT NOT NULL, generic_name TEXT,
      check_type TEXT NOT NULL, has_warnings INTEGER, warning_count INTEGER,
      warnings_json TEXT, action_taken TEXT, override_reason TEXT, checked_by INTEGER NOT NULL,
      checked_at TEXT NOT NULL
    );
    CREATE TABLE cln_medication_orders (
      id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, patient_id INTEGER NOT NULL,
      visit_id INTEGER NOT NULL, formulary_item_id INTEGER, medication_name TEXT NOT NULL,
      generic_name TEXT, strength TEXT, dosage_form TEXT, dose TEXT NOT NULL, route TEXT NOT NULL,
      frequency TEXT NOT NULL, duration TEXT, instructions TEXT, priority TEXT NOT NULL,
      start_datetime TEXT NOT NULL, end_datetime TEXT, status TEXT NOT NULL, status_reason TEXT,
      idempotency_key TEXT, ordered_by INTEGER NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE medication_orders (id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, prescription_id INTEGER);
    CREATE TABLE pharmacy_prescriptions (id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, patient_id INTEGER);
  `);
  const db = {
    prepare(sql: string) { return new Statement(sqlite, sql); },
    async batch(statements: PrescriptionMedicationBackfillPreparedStatement[]) {
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
  seed(sqlite);
  return { sqlite, db };
}

function seed(sqlite: DatabaseSync): void {
  sqlite.prepare(`
    INSERT INTO canonical_tenant_patient_links (
      tenant_id,patient_link_public_id,legacy_patient_id,link_status,
      verification_level,evidence_type,evidence_sha256,effective_from_utc,version
    ) VALUES ('tenant-a','ptl-101',101,'unlinked','unverified','no_link_placeholder',?,?,1)
  `).run('1'.repeat(64), '2026-07-27T00:00:00.000Z');
  sqlite.prepare(`
    INSERT INTO canonical_practitioners (
      tenant_id,practitioner_public_id,practitioner_kind,display_name,status,version,source_evidence_sha256
    ) VALUES ('tenant-a','prac-201','internal','Doctor','active',1,?)
  `).run('2'.repeat(64));
  sqlite.prepare(`
    INSERT INTO canonical_practitioner_user_links (
      tenant_id,practitioner_public_id,legacy_user_id,link_status,evidence_type
    ) VALUES ('tenant-a','prac-201',901,'active','legacy_doctor_user_id')
  `).run();
  sqlite.prepare(`
    INSERT INTO canonical_encounters (
      tenant_id,encounter_public_id,legacy_patient_id,patient_link_public_id,
      encounter_type,status,encounter_version,source_kind,started_at_utc,source_evidence_sha256
    ) VALUES ('tenant-a','enc-701',101,'ptl-101','outpatient','in_progress',1,'runtime',?,?)
  `).run('2026-07-27T08:00:00.000Z', '3'.repeat(64));
  const mapping = sqlite.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES ('tenant-a',?,?,?,?,?,'mapped',1,?)
  `);
  mapping.run('patient_link', 'ptl-101', 'legacy_patient', '101', 'patients', '4'.repeat(64));
  mapping.run('practitioner', 'prac-201', 'legacy_doctor', '201', 'doctors', '5'.repeat(64));
  mapping.run('encounter', 'enc-701', 'legacy_visit', '701', 'visits', '6'.repeat(64));
  sqlite.prepare(`
    INSERT INTO prescriptions VALUES (
      501,'tenant-a',101,201,NULL,NULL,901,'final',1,901,
      '2026-07-27T08:30:00.000Z','2026-07-27T08:40:00.000Z'
    )
  `).run();
  sqlite.prepare(`
    INSERT INTO prescription_items VALUES (
      601,501,'Sensitive medicine','1 tablet','BID','5 days','Protected',1,10,0,1001
    )
  `).run();
  sqlite.prepare(`
    INSERT INTO consultation_completion_claims VALUES (
      901,'tenant-a',301,101,701,201,NULL,'completed'
    )
  `).run();
  sqlite.prepare(`
    INSERT INTO cln_medication_orders VALUES (
      7011,'tenant-a',101,701,5001,'Standalone medication',NULL,'10 mg','tablet',
      '10 mg','Oral','OD','7 days','Protected','routine','2026-07-27T10:00:00.000Z',
      NULL,'active',NULL,'legacy-cpoe-7011',901,'2026-07-27T09:55:00.000Z'
    )
  `).run();
}

function count(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
}

describe('canonical prescription and medication-intent reconciliation', () => {
  it('persists a passed 16-check aggregate receipt after an exact backfill', async () => {
    const { sqlite, db } = harness();
    try {
      await backfillPrescriptionMedicationIntent(db, {
        tenantId: 'tenant-a',
        runPublicId: 'rx-backfill-for-reconcile',
        nowUtc: '2026-07-27T11:00:00.000Z',
        maxSourceRecords: 20,
      });
      const result = await reconcilePrescriptionMedicationIntent(db, {
        tenantId: 'tenant-a',
        runPublicId: 'rx-reconciliation-1',
        migrationRunPublicId: 'rx-backfill-for-reconcile',
        nowUtc: '2026-07-27T11:30:00.000Z',
        sourceFingerprintBefore: 'a'.repeat(64),
        sourceFingerprintAfter: 'a'.repeat(64),
        foreignKeyViolationCount: 0,
        integrityStatus: 'ok',
        secondPassNewBusinessRows: 0,
      });
      expect(result).toMatchObject({ status: 'passed', scannedChecks: 16, matchedChecks: 16, mismatchChecks: 0 });
      expect(result.evidenceSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(Object.values(result.checks).every((value) => value === 0)).toBe(true);
      expect(count(sqlite, 'canonical_reconciliation_runs')).toBe(1);
      expect(sqlite.prepare(`
        SELECT domain,reconciliation_type,status,scanned_count,matched_count,mismatch_count,
               exception_count,evidence_sha256,result_summary_json
        FROM canonical_reconciliation_runs
      `).get()).toMatchObject({
        domain: 'prescription_medication_intent',
        reconciliation_type: 'backfill',
        status: 'passed',
        scanned_count: 16,
        matched_count: 16,
        mismatch_count: 0,
        exception_count: 0,
        evidence_sha256: result.evidenceSha256,
      });
      const summary = String((sqlite.prepare(`SELECT result_summary_json FROM canonical_reconciliation_runs`).get() as { result_summary_json: string }).result_summary_json);
      for (const forbidden of ['Sensitive medicine', 'Standalone medication', 'Protected']) expect(summary).not.toContain(forbidden);
    } finally {
      sqlite.close();
    }
  });

  it('fails closed and persists aggregate mismatch evidence for orphan scope and source mutation', async () => {
    const { sqlite, db } = harness();
    try {
      await backfillPrescriptionMedicationIntent(db, {
        tenantId: 'tenant-a',
        runPublicId: 'rx-backfill-for-failure',
        nowUtc: '2026-07-27T11:00:00.000Z',
        maxSourceRecords: 20,
      });
      sqlite.exec('PRAGMA foreign_keys = OFF');
      sqlite.prepare(`
        UPDATE canonical_medication_orders SET encounter_public_id='missing-encounter'
        WHERE prescription_public_id IS NOT NULL
      `).run();
      sqlite.exec('PRAGMA foreign_keys = ON');
      const result = await reconcilePrescriptionMedicationIntent(db, {
        tenantId: 'tenant-a',
        runPublicId: 'rx-reconciliation-failed',
        migrationRunPublicId: 'rx-backfill-for-failure',
        nowUtc: '2026-07-27T12:00:00.000Z',
        sourceFingerprintBefore: 'a'.repeat(64),
        sourceFingerprintAfter: 'b'.repeat(64),
        foreignKeyViolationCount: 1,
        integrityStatus: 'ok',
        secondPassNewBusinessRows: 1,
      });
      expect(result.status).toBe('failed');
      expect(result.mismatchChecks).toBeGreaterThanOrEqual(4);
      expect(result.checks).toMatchObject({
        encounterReferenceMismatchCount: 1,
        sourceFingerprintMismatchCount: 1,
        foreignKeyViolationCount: 1,
        secondPassNewBusinessRowCount: 1,
      });
      expect(sqlite.prepare(`SELECT status,mismatch_count FROM canonical_reconciliation_runs`).get()).toMatchObject({
        status: 'failed',
        mismatch_count: result.mismatchChecks,
      });
    } finally {
      sqlite.close();
    }
  });
});
