import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  MedicationAdministrationBackfillDatabase,
  MedicationAdministrationBackfillPreparedStatement,
} from '../../scripts/canonical/backfill-medication-administration';
import { backfillMedicationAdministration } from '../../scripts/canonical/backfill-medication-administration';
import type {
  MedicationAdministrationReconciliationDatabase,
  MedicationAdministrationReconciliationPreparedStatement,
} from '../../scripts/canonical/reconcile-medication-administration';
import { reconcileMedicationAdministration } from '../../scripts/canonical/reconcile-medication-administration';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements MedicationAdministrationBackfillPreparedStatement, MedicationAdministrationReconciliationPreparedStatement {
  constructor(private readonly database: DatabaseSync, readonly sql: string, readonly params: SqlValue[] = []) {}

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

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return { results: this.database.prepare(this.sql).all(...this.params) as T[] };
  }
}

function harness(): {
  sqlite: DatabaseSync;
  db: MedicationAdministrationBackfillDatabase & MedicationAdministrationReconciliationDatabase;
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
    'migrations/0557_canonical_medication_administration.sql',
  ]) sqlite.exec(readFileSync(migration, 'utf8'));

  sqlite.exec(`
    CREATE TABLE nur_medication_admin (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      visit_id INTEGER NOT NULL,
      medication_name TEXT NOT NULL,
      dose TEXT,
      route TEXT,
      frequency TEXT,
      administered_on TEXT,
      administered_by INTEGER,
      remarks TEXT,
      status TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER,
      created_at TEXT,
      updated_by INTEGER,
      updated_at TEXT,
      order_id INTEGER,
      formulary_item_id INTEGER,
      generic_name TEXT,
      strength TEXT,
      scheduled_time TEXT,
      actual_time TEXT,
      reason_not_given TEXT,
      barcode_scanned INTEGER DEFAULT 0
    );

    CREATE TABLE cln_medication_reconciliation (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      visit_id INTEGER NOT NULL,
      reconciliation_type TEXT NOT NULL,
      status TEXT NOT NULL,
      performed_by INTEGER NOT NULL,
      completed_at TEXT,
      notes TEXT,
      is_active INTEGER DEFAULT 1,
      created_by INTEGER,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE cln_medication_reconciliation_items (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      reconciliation_id INTEGER NOT NULL,
      medication_name TEXT NOT NULL,
      generic_name TEXT,
      dose TEXT,
      route TEXT,
      frequency TEXT,
      source TEXT,
      action TEXT NOT NULL,
      action_reason TEXT,
      new_dose TEXT,
      new_route TEXT,
      new_frequency TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT
    );
  `);

  const db = {
    prepare(sql: string) { return new Statement(sqlite, sql); },
    async batch(statements: MedicationAdministrationBackfillPreparedStatement[]) {
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
    ) VALUES ('tenant-a','patient-link-101',101,'unlinked','unverified',
              'no_link_placeholder',?,?,1)
  `).run('1'.repeat(64), '2026-07-28T00:00:00.000Z');

  sqlite.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES ('tenant-a','patient_link','patient-link-101','legacy_patient','101',
              'patients','mapped',1,?)
  `).run('2'.repeat(64));

  for (const [practitioner, userId, name, hash] of [
    ['practitioner-901', 901, 'Prescriber', '3'],
    ['practitioner-902', 902, 'Administering nurse', '4'],
    ['practitioner-903', 903, 'Reconciliation clinician', '5'],
  ] as const) {
    sqlite.prepare(`
      INSERT INTO canonical_practitioners (
        tenant_id,practitioner_public_id,practitioner_kind,display_name,status,
        version,source_evidence_sha256
      ) VALUES ('tenant-a',?,'internal',?,'active',1,?)
    `).run(practitioner, name, hash.repeat(64));
    sqlite.prepare(`
      INSERT INTO canonical_practitioner_user_links (
        tenant_id,practitioner_public_id,legacy_user_id,link_status,evidence_type
      ) VALUES ('tenant-a',?,?,'active','legacy_doctor_user_id')
    `).run(practitioner, userId);
  }

  sqlite.prepare(`
    INSERT INTO canonical_encounters (
      tenant_id,encounter_public_id,legacy_patient_id,patient_link_public_id,
      encounter_type,status,encounter_version,source_kind,started_at_utc,source_evidence_sha256
    ) VALUES ('tenant-a','encounter-701',101,'patient-link-101','inpatient',
              'in_progress',1,'runtime',?,?)
  `).run('2026-07-28T08:00:00.000Z', '6'.repeat(64));
  sqlite.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES ('tenant-a','encounter','encounter-701','legacy_visit','701',
              'visits','mapped',1,?)
  `).run('7'.repeat(64));

  sqlite.prepare(`
    INSERT INTO canonical_medication_orders (
      tenant_id,medication_order_public_id,patient_link_public_id,encounter_public_id,
      prescribing_practitioner_public_id,medication_display,dose_text,route_code,
      frequency_code,priority,intended_start_utc,current_status,status_version,
      idempotency_key,request_fingerprint_sha256,source_evidence_sha256
    ) VALUES ('tenant-a','med-order-1001','patient-link-101','encounter-701',
              'practitioner-901','Ceftriaxone','1 g','IV','OD','routine',?,
              'active',2,'seed-med-order-1001',?,?)
  `).run('2026-07-28T08:30:00.000Z', '8'.repeat(64), '9'.repeat(64));
  sqlite.prepare(`
    INSERT INTO canonical_medication_order_status_events (
      tenant_id,event_public_id,medication_order_public_id,from_status,to_status,
      event_version,reason_code,actor_practitioner_public_id,actor_system_key,
      idempotency_key,source_evidence_sha256,occurred_at_utc
    ) VALUES
      ('tenant-a','med-order-1001-v1','med-order-1001',NULL,'draft',1,'created',
       'practitioner-901','backfill.test','med-order-1001-v1',?,?),
      ('tenant-a','med-order-1001-v2','med-order-1001','draft','active',2,'activated',
       'practitioner-901','backfill.test','med-order-1001-v2',?,?)
  `).run(
    'a'.repeat(64), '2026-07-28T08:30:00.000Z',
    'b'.repeat(64), '2026-07-28T08:31:00.000Z',
  );
  sqlite.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES ('tenant-a','medication_order','med-order-1001',
              'legacy_cln_medication_order','1001','cln_medication_orders','mapped',1,?)
  `).run('c'.repeat(64));
}

function seedLegacy(sqlite: DatabaseSync): void {
  sqlite.prepare(`
    INSERT INTO nur_medication_admin VALUES
      (501,'tenant-a',101,701,'Ceftriaxone','1 g','IV','OD',
       '2026-07-28 09:03:00',902,'Sensitive administration remark','given',1,902,
       '2026-07-28 08:55:00',NULL,NULL,1001,NULL,'ceftriaxone','1 g',
       '2026-07-28 09:00:00','2026-07-28 09:03:00',NULL,1),
      (502,'tenant-a',101,701,'Ceftriaxone',NULL,NULL,'OD',
       '2026-07-28 10:00:00',902,'Patient confidential refusal','refused',1,902,
       '2026-07-28 09:55:00',NULL,NULL,1001,NULL,'ceftriaxone','1 g',
       '2026-07-28 10:00:00','2026-07-28 10:00:00','patient_refused',0),
      (503,'tenant-a',101,701,'Unknown medicine','1 tablet','Oral','BD',
       '2026-07-28 11:00:00',902,'Unmapped order','given',1,902,
       '2026-07-28 10:55:00',NULL,NULL,9999,NULL,NULL,NULL,
       '2026-07-28 11:00:00','2026-07-28 11:00:00',NULL,0),
      (504,'tenant-a',101,701,'Ceftriaxone','1 g','IV','OD',
       NULL,NULL,'Future scheduled projection','scheduled',1,902,
       '2026-07-28 11:55:00',NULL,NULL,1001,NULL,'ceftriaxone','1 g',
       '2026-07-28 12:00:00',NULL,NULL,0),
      (505,'tenant-a',101,701,'Ceftriaxone','one vial','IV','OD',
       '2026-07-28 13:00:00',902,'Ambiguous dose','given',1,902,
       '2026-07-28 12:55:00',NULL,NULL,1001,NULL,'ceftriaxone','1 g',
       '2026-07-28 13:00:00','2026-07-28 13:00:00',NULL,0),
      (506,'tenant-a',101,701,'Ceftriaxone','1 g','IV','OD',
       '2026-07-28 14:00:00',902,'Inactive edited evidence','given',0,902,
       '2026-07-28 13:55:00',903,'2026-07-28 14:05:00',1001,NULL,'ceftriaxone','1 g',
       '2026-07-28 14:00:00','2026-07-28 14:00:00',NULL,0)
  `).run();

  sqlite.prepare(`
    INSERT INTO cln_medication_reconciliation VALUES
      (701,'tenant-a',101,701,'admission','in_progress',903,NULL,
       'Sensitive admission note',1,903,'2026-07-28 15:00:00',NULL),
      (702,'tenant-a',101,701,'discharge','completed',903,'2026-07-28 16:30:00',
       'Sensitive discharge note',1,903,'2026-07-28 16:00:00','2026-07-28 16:30:00'),
      (703,'tenant-a',101,701,'transfer','cancelled',903,'2026-07-28 17:10:00',
       'Cancelled private note',1,903,'2026-07-28 17:00:00','2026-07-28 17:10:00')
  `).run();

  sqlite.prepare(`
    INSERT INTO cln_medication_reconciliation_items VALUES
      (801,'tenant-a',701,'Ceftriaxone','ceftriaxone','1 g','IV','OD','inpatient',
       'continue','continue_treatment',NULL,NULL,NULL,1,'2026-07-28 15:01:00'),
      (802,'tenant-a',702,'Ceftriaxone','ceftriaxone','1 g','IV','OD','inpatient',
       'modify','reduce_dose','500 mg','IV','OD',1,'2026-07-28 16:01:00'),
      (803,'tenant-a',703,'Paracetamol','paracetamol','500 mg','Oral','PRN','home',
       'add','patient_reported','500 mg','Oral','PRN',1,'2026-07-28 17:01:00'),
      (899,'tenant-a',999,'Orphan medicine',NULL,NULL,NULL,NULL,'unknown',
       'continue','orphan_item',NULL,NULL,NULL,1,'2026-07-28 18:00:00')
  `).run();
}

function count(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
}

function sourceSnapshot(sqlite: DatabaseSync): string {
  return JSON.stringify({
    mar: sqlite.prepare(`SELECT * FROM nur_medication_admin ORDER BY id`).all(),
    reconciliations: sqlite.prepare(`SELECT * FROM cln_medication_reconciliation ORDER BY id`).all(),
    items: sqlite.prepare(`SELECT * FROM cln_medication_reconciliation_items ORDER BY id`).all(),
  });
}

describe('canonical medication administration backfill and reconciliation', () => {
  it('runs eight bounded resumable partitions, preserves sources, creates only exact facts, and records stable non-PHI dispositions', async () => {
    const { sqlite, db } = harness();
    try {
      const before = sourceSnapshot(sqlite);
      const first = await backfillMedicationAdministration(db, {
        tenantId: 'tenant-a',
        runPublicId: 'med-admin-backfill-1',
        nowUtc: '2026-07-28T18:30:00.000Z',
        maxSourceRecords: 3,
      });
      expect(first.completed).toBe(false);
      expect(first.counts.scanned).toBe(3);
      expect(first.counts.administrationEventsCreated).toBe(2);
      expect(first.counts.issues).toBe(1);

      const second = await backfillMedicationAdministration(db, {
        tenantId: 'tenant-a',
        runPublicId: 'med-admin-backfill-1',
        nowUtc: '2026-07-28T18:35:00.000Z',
        maxSourceRecords: 100,
      });
      expect(second.completed).toBe(true);
      expect(second.counts.scanned).toBeGreaterThanOrEqual(10);
      expect(count(sqlite, 'canonical_backfill_checkpoints')).toBe(8);
      expect(count(sqlite, 'canonical_medication_administration_events')).toBe(2);
      expect(count(sqlite, 'canonical_medication_reconciliations')).toBe(3);
      expect(count(sqlite, 'canonical_medication_reconciliation_versions')).toBe(3);
      expect(count(sqlite, 'canonical_medication_reconciliation_items')).toBe(3);
      expect(count(sqlite, 'canonical_medication_reconciliation_status_events')).toBe(5);
      expect(sourceSnapshot(sqlite)).toBe(before);

      const statusRows = sqlite.prepare(`
        SELECT current_status,COUNT(*) AS count
        FROM canonical_medication_reconciliations
        GROUP BY current_status ORDER BY current_status
      `).all();
      expect(statusRows).toEqual([
        { current_status: 'cancelled', count: 1 },
        { current_status: 'draft', count: 1 },
        { current_status: 'final', count: 1 },
      ]);

      const issueRows = sqlite.prepare(`
        SELECT issue_code,source_type,source_public_id,details_json
        FROM canonical_processing_issues
        WHERE entity_type='medication_administration_reconciliation'
        ORDER BY issue_code,source_public_id
      `).all() as Array<Record<string, unknown>>;
      expect(issueRows.map((row) => row.issue_code)).toEqual(expect.arrayContaining([
        'MAR_CANONICAL_ORDER_MAPPING_MISSING',
        'MAR_DOSE_PARSE_AMBIGUOUS',
        'MAR_SCHEDULE_PROJECTION_ONLY',
        'MAR_MUTABLE_HISTORY_REVIEW_REQUIRED',
        'MEDICATION_RECONCILIATION_ORPHAN_ITEM',
        'MEDICATION_RECONCILIATION_INTENT_REQUIRES_EXPLICIT_COMMAND',
      ]));
      for (const row of issueRows) {
        const details = String(row.details_json ?? '');
        for (const forbidden of [
          'Sensitive', 'Patient confidential', 'Unknown medicine', 'Future scheduled',
          'Ceftriaxone', 'Paracetamol', 'Orphan medicine',
        ]) expect(details).not.toContain(forbidden);
      }

      const third = await backfillMedicationAdministration(db, {
        tenantId: 'tenant-a',
        runPublicId: 'med-admin-backfill-1',
        nowUtc: '2026-07-28T18:40:00.000Z',
        maxSourceRecords: 100,
      });
      expect(third.completed).toBe(true);
      expect(third.counts).toMatchObject({
        administrationEventsCreated: 0,
        reconciliationsCreated: 0,
        reconciliationVersionsCreated: 0,
        reconciliationItemsCreated: 0,
        reconciliationStatusEventsCreated: 0,
        mappingsCreated: 0,
        issues: 0,
      });
    } finally {
      sqlite.close();
    }
  });

  it('persists a passed fixed 22-check receipt and fails closed on fingerprints, foreign keys, integrity, and second-pass evidence', async () => {
    const { sqlite, db } = harness();
    try {
      await backfillMedicationAdministration(db, {
        tenantId: 'tenant-a',
        runPublicId: 'med-admin-backfill-reconcile',
        nowUtc: '2026-07-28T18:30:00.000Z',
        maxSourceRecords: 100,
      });

      const passed = await reconcileMedicationAdministration(db, {
        tenantId: 'tenant-a',
        runPublicId: 'med-admin-reconcile-1',
        migrationRunPublicId: 'med-admin-backfill-reconcile',
        nowUtc: '2026-07-28T19:00:00.000Z',
        sourceFingerprintBefore: 'd'.repeat(64),
        sourceFingerprintAfter: 'd'.repeat(64),
        foreignKeyViolationCount: 0,
        integrityStatus: 'ok',
        secondPassNewBusinessRows: 0,
      });
      expect(passed).toMatchObject({
        status: 'passed',
        scannedChecks: 22,
        matchedChecks: 22,
        mismatchChecks: 0,
      });
      expect(Object.values(passed.checks).every((value) => value === 0)).toBe(true);
      expect(passed.evidenceSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(sqlite.prepare(`
        SELECT domain,reconciliation_type,status,scanned_count,matched_count,mismatch_count
        FROM canonical_reconciliation_runs
        WHERE run_public_id='med-admin-reconcile-1'
      `).get()).toEqual({
        domain: 'medication_administration_reconciliation',
        reconciliation_type: 'backfill',
        status: 'passed',
        scanned_count: 22,
        matched_count: 22,
        mismatch_count: 0,
      });

      const failed = await reconcileMedicationAdministration(db, {
        tenantId: 'tenant-a',
        runPublicId: 'med-admin-reconcile-2',
        migrationRunPublicId: 'med-admin-backfill-reconcile',
        nowUtc: '2026-07-28T19:05:00.000Z',
        sourceFingerprintBefore: 'e'.repeat(64),
        sourceFingerprintAfter: 'f'.repeat(64),
        foreignKeyViolationCount: 1,
        integrityStatus: 'failed',
        secondPassNewBusinessRows: 1,
      });
      expect(failed.status).toBe('failed');
      expect(failed.mismatchChecks).toBeGreaterThanOrEqual(4);
      expect(failed.checks.sourceFingerprintMismatch).toBe(1);
      expect(failed.checks.foreignKeyViolations).toBe(1);
      expect(failed.checks.integrityFailure).toBe(1);
      expect(failed.checks.secondPassNewBusinessRows).toBe(1);
    } finally {
      sqlite.close();
    }
  });
});
