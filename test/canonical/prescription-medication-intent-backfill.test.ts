import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  PrescriptionMedicationBackfillDatabase,
  PrescriptionMedicationBackfillPreparedStatement,
} from '../../scripts/canonical/backfill-prescription-medication-intent';
import { backfillPrescriptionMedicationIntent } from '../../scripts/canonical/backfill-prescription-medication-intent';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements PrescriptionMedicationBackfillPreparedStatement {
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
    return { success: true, meta: { changes: Number(result.changes ?? 0), last_row_id: Number(result.lastInsertRowid ?? 0) } };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return { results: this.database.prepare(this.sql).all(...this.params) as T[] };
  }
}

function harness(): { sqlite: DatabaseSync; db: PrescriptionMedicationBackfillDatabase } {
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
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      doctor_id INTEGER,
      appointment_id INTEGER,
      admission_id INTEGER,
      completion_claim_id INTEGER,
      status TEXT NOT NULL,
      is_locked INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE prescription_items (
      id INTEGER PRIMARY KEY,
      prescription_id INTEGER NOT NULL,
      medicine_name TEXT NOT NULL,
      dosage TEXT,
      frequency TEXT,
      duration TEXT,
      instructions TEXT,
      sort_order INTEGER,
      quantity INTEGER,
      dispensed_qty INTEGER,
      medicine_id INTEGER
    );
    CREATE TABLE consultation_completion_claims (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      appointment_id INTEGER NOT NULL,
      patient_id INTEGER NOT NULL,
      visit_id INTEGER NOT NULL,
      doctor_id INTEGER NOT NULL,
      encounter_id INTEGER,
      status TEXT NOT NULL
    );
    CREATE TABLE prescription_versions (
      id INTEGER PRIMARY KEY,
      prescription_id INTEGER NOT NULL,
      version_number INTEGER NOT NULL,
      snapshot TEXT NOT NULL,
      edited_by TEXT NOT NULL,
      edit_reason TEXT,
      tenant_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE prescription_overrides (
      id INTEGER PRIMARY KEY,
      prescription_id INTEGER NOT NULL,
      patient_id INTEGER NOT NULL,
      doctor_id INTEGER NOT NULL,
      override_type TEXT NOT NULL,
      allergen TEXT NOT NULL,
      severity TEXT,
      reason TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE prescription_safety_checks (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      prescription_id INTEGER,
      patient_id INTEGER NOT NULL,
      medication_name TEXT NOT NULL,
      generic_name TEXT,
      check_type TEXT NOT NULL,
      has_warnings INTEGER,
      warning_count INTEGER,
      warnings_json TEXT,
      action_taken TEXT,
      override_reason TEXT,
      checked_by INTEGER NOT NULL,
      checked_at TEXT NOT NULL
    );
    CREATE TABLE cln_medication_orders (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      visit_id INTEGER NOT NULL,
      formulary_item_id INTEGER,
      medication_name TEXT NOT NULL,
      generic_name TEXT,
      strength TEXT,
      dosage_form TEXT,
      dose TEXT NOT NULL,
      route TEXT NOT NULL,
      frequency TEXT NOT NULL,
      duration TEXT,
      instructions TEXT,
      priority TEXT NOT NULL,
      start_datetime TEXT NOT NULL,
      end_datetime TEXT,
      status TEXT NOT NULL,
      status_reason TEXT,
      idempotency_key TEXT,
      ordered_by INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE medication_orders (id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, prescription_id INTEGER);
    CREATE TABLE pharmacy_prescriptions (id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, patient_id INTEGER);
  `);

  const db: PrescriptionMedicationBackfillDatabase = {
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
  for (const [id, publicId] of [[701, 'enc-701'], [702, 'enc-702']] as const) {
    sqlite.prepare(`
      INSERT INTO canonical_encounters (
        tenant_id,encounter_public_id,legacy_patient_id,patient_link_public_id,
        encounter_type,status,encounter_version,source_kind,started_at_utc,source_evidence_sha256
      ) VALUES ('tenant-a',?,101,'ptl-101','outpatient','in_progress',1,'runtime',?,?)
    `).run(publicId, `2026-07-27T0${id === 701 ? '8' : '9'}:00:00.000Z`, String(id === 701 ? 3 : 4).repeat(64));
  }
  const mapping = sqlite.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES ('tenant-a',?,?,?,?,?,'mapped',1,?)
  `);
  mapping.run('patient_link', 'ptl-101', 'legacy_patient', '101', 'patients', '5'.repeat(64));
  mapping.run('practitioner', 'prac-201', 'legacy_doctor', '201', 'doctors', '6'.repeat(64));
  mapping.run('encounter', 'enc-701', 'legacy_visit', '701', 'visits', '7'.repeat(64));
  mapping.run('encounter', 'enc-702', 'legacy_encounter', '702', 'encounters', '8'.repeat(64));
}

function seedLegacy(sqlite: DatabaseSync): void {
  const prescription = sqlite.prepare(`
    INSERT INTO prescriptions (
      id,tenant_id,patient_id,doctor_id,appointment_id,admission_id,completion_claim_id,
      status,is_locked,created_by,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  prescription.run(501, 'tenant-a', 101, 201, null, null, 901, 'final', 1, 901,
    '2026-07-27T08:30:00.000Z', '2026-07-27T08:40:00.000Z');
  prescription.run(502, 'tenant-a', 101, 201, null, null, 902, 'draft', 0, 901,
    '2026-07-27T09:00:00.000Z', '2026-07-27T09:05:00.000Z');
  sqlite.prepare(`
    INSERT INTO consultation_completion_claims
      (id,tenant_id,appointment_id,patient_id,visit_id,doctor_id,encounter_id,status)
    VALUES (901,'tenant-a',301,101,701,201,NULL,'completed'),
           (902,'tenant-a',302,101,701,201,702,'completed')
  `).run();
  sqlite.prepare(`
    INSERT INTO prescription_items
      (id,prescription_id,medicine_name,dosage,frequency,duration,instructions,sort_order,quantity,dispensed_qty,medicine_id)
    VALUES (601,501,'Sensitive medicine','1 tablet','BID','5 days','After food',1,10,0,1001),
           (602,502,'Other sensitive medicine','5 ml','TID','3 days','Protected text',1,1,0,NULL)
  `).run();
  sqlite.prepare(`
    INSERT INTO prescription_overrides
      (id,prescription_id,patient_id,doctor_id,override_type,allergen,severity,reason,tenant_id,created_at)
    VALUES (801,501,101,201,'allergy','Protected allergen','high','Reviewed reason','tenant-a','2026-07-27T08:35:00.000Z')
  `).run();
  sqlite.prepare(`
    INSERT INTO prescription_safety_checks
      (id,tenant_id,prescription_id,patient_id,medication_name,generic_name,check_type,
       has_warnings,warning_count,warnings_json,action_taken,override_reason,checked_by,checked_at)
    VALUES (811,'tenant-a',501,101,'Sensitive medicine',NULL,'interaction',0,0,'[]','reviewed',NULL,901,'2026-07-27T08:34:00.000Z')
  `).run();
  sqlite.prepare(`
    INSERT INTO cln_medication_orders (
      id,tenant_id,patient_id,visit_id,formulary_item_id,medication_name,generic_name,strength,
      dosage_form,dose,route,frequency,duration,instructions,priority,start_datetime,end_datetime,
      status,status_reason,idempotency_key,ordered_by,created_at
    ) VALUES (7011,'tenant-a',101,701,5001,'Standalone sensitive medication',NULL,'10 mg',
      'tablet','10 mg','Oral','OD','7 days','Protected CPOE text','urgent',
      '2026-07-27T10:00:00.000Z',NULL,'active',NULL,'legacy-cpoe-7011',901,'2026-07-27T09:55:00.000Z')
  `).run();
  sqlite.prepare(`INSERT INTO medication_orders VALUES (9001,'tenant-a',501)`).run();
  sqlite.prepare(`INSERT INTO pharmacy_prescriptions VALUES (9101,'tenant-a',101)`).run();
}

function count(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
}

function sourceSnapshot(sqlite: DatabaseSync): string {
  return JSON.stringify({
    prescriptions: sqlite.prepare(`SELECT * FROM prescriptions ORDER BY id`).all(),
    items: sqlite.prepare(`SELECT * FROM prescription_items ORDER BY id`).all(),
    claims: sqlite.prepare(`SELECT * FROM consultation_completion_claims ORDER BY id`).all(),
    cpoe: sqlite.prepare(`SELECT * FROM cln_medication_orders ORDER BY id`).all(),
    commercial: sqlite.prepare(`SELECT * FROM medication_orders ORDER BY id`).all(),
    pharmacy: sqlite.prepare(`SELECT * FROM pharmacy_prescriptions ORDER BY id`).all(),
  });
}

describe('canonical prescription and medication-intent backfill', () => {
  it('is bounded and resumable, migrates exact prescription/CPOE evidence, and excludes commercial/pharmacy workflow', async () => {
    const { sqlite, db } = harness();
    try {
      const before = sourceSnapshot(sqlite);
      const first = await backfillPrescriptionMedicationIntent(db, {
        tenantId: 'tenant-a',
        runPublicId: 'rx-backfill-run-1',
        nowUtc: '2026-07-27T11:00:00.000Z',
        maxSourceRecords: 1,
      });
      expect(first.completed).toBe(false);
      expect(first.counts).toMatchObject({ scanned: 1, prescriptionsCreated: 1, issues: 0 });
      expect(count(sqlite, 'canonical_prescriptions')).toBe(1);
      expect(count(sqlite, 'canonical_medication_orders')).toBe(1);

      const second = await backfillPrescriptionMedicationIntent(db, {
        tenantId: 'tenant-a',
        runPublicId: 'rx-backfill-run-1',
        nowUtc: '2026-07-27T11:05:00.000Z',
        maxSourceRecords: 20,
      });
      expect(second.completed).toBe(true);
      expect(second.counts).toMatchObject({
        scanned: 2,
        prescriptionsCreated: 0,
        standaloneOrdersCreated: 1,
        issues: 1,
      });

      expect(count(sqlite, 'canonical_prescriptions')).toBe(1);
      expect(count(sqlite, 'canonical_prescription_versions')).toBe(1);
      expect(count(sqlite, 'canonical_medication_orders')).toBe(2);
      expect(count(sqlite, 'canonical_medication_order_status_events')).toBe(2);
      expect(count(sqlite, 'canonical_prescription_safety_events')).toBe(2);
      expect(count(sqlite, 'canonical_processing_issues')).toBe(1);
      expect(count(sqlite, 'canonical_source_mappings')).toBe(10);

      expect(sqlite.prepare(`
        SELECT current_status,status_version,patient_link_public_id,encounter_public_id,
               prescribing_practitioner_public_id
        FROM canonical_prescriptions
      `).get()).toEqual({
        current_status: 'final',
        status_version: 1,
        patient_link_public_id: 'ptl-101',
        encounter_public_id: 'enc-701',
        prescribing_practitioner_public_id: 'prac-201',
      });
      expect(sqlite.prepare(`
        SELECT version_status,signed_snapshot_sha256 FROM canonical_prescription_versions
      `).get()).toEqual({
        version_status: 'final',
        signed_snapshot_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
      const orderScopes = sqlite.prepare(`
        SELECT prescription_public_id,current_status FROM canonical_medication_orders
        ORDER BY prescription_public_id IS NULL, medication_order_public_id
      `).all() as Array<{ prescription_public_id: string | null; current_status: string }>;
      expect(orderScopes).toHaveLength(2);
      expect(orderScopes[0]).toMatchObject({ current_status: 'active' });
      expect(orderScopes[0].prescription_public_id).toMatch(/^rx_[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(orderScopes[1]).toEqual({ prescription_public_id: null, current_status: 'active' });
      expect(sqlite.prepare(`
        SELECT issue_code,entity_type,source_type,source_public_id,occurrence_count,details_json
        FROM canonical_processing_issues
      `).get()).toMatchObject({
        issue_code: 'RX_ENCOUNTER_EVIDENCE_AMBIGUOUS',
        entity_type: 'prescription',
        source_type: 'legacy_prescription',
        source_public_id: '502',
        occurrence_count: 1,
      });
      const details = String((sqlite.prepare(`SELECT details_json FROM canonical_processing_issues`).get() as { details_json: string }).details_json);
      for (const forbidden of ['Sensitive medicine', 'Other sensitive medicine', 'Protected text']) {
        expect(details).not.toContain(forbidden);
      }
      expect(count(sqlite, 'medication_orders')).toBe(1);
      expect(count(sqlite, 'pharmacy_prescriptions')).toBe(1);
      expect(sourceSnapshot(sqlite)).toBe(before);
    } finally {
      sqlite.close();
    }
  });

  it('creates zero new business rows on a second run and keeps ambiguity issue identity stable', async () => {
    const { sqlite, db } = harness();
    try {
      await backfillPrescriptionMedicationIntent(db, {
        tenantId: 'tenant-a',
        runPublicId: 'rx-backfill-first-pass',
        nowUtc: '2026-07-27T11:00:00.000Z',
        maxSourceRecords: 20,
      });
      const before = {
        prescriptions: count(sqlite, 'canonical_prescriptions'),
        versions: count(sqlite, 'canonical_prescription_versions'),
        orders: count(sqlite, 'canonical_medication_orders'),
        events: count(sqlite, 'canonical_medication_order_status_events'),
        safety: count(sqlite, 'canonical_prescription_safety_events'),
        mappings: count(sqlite, 'canonical_source_mappings'),
        issues: count(sqlite, 'canonical_processing_issues'),
        issueId: (sqlite.prepare(`SELECT issue_public_id FROM canonical_processing_issues`).get() as { issue_public_id: string }).issue_public_id,
      };
      const second = await backfillPrescriptionMedicationIntent(db, {
        tenantId: 'tenant-a',
        runPublicId: 'rx-backfill-second-pass',
        nowUtc: '2026-07-27T12:00:00.000Z',
        maxSourceRecords: 20,
      });
      expect(second.completed).toBe(true);
      expect(second.counts).toMatchObject({
        prescriptionsCreated: 0,
        versionsCreated: 0,
        medicationOrdersCreated: 0,
        standaloneOrdersCreated: 0,
        safetyEventsCreated: 0,
        mappingsCreated: 0,
      });
      expect({
        prescriptions: count(sqlite, 'canonical_prescriptions'),
        versions: count(sqlite, 'canonical_prescription_versions'),
        orders: count(sqlite, 'canonical_medication_orders'),
        events: count(sqlite, 'canonical_medication_order_status_events'),
        safety: count(sqlite, 'canonical_prescription_safety_events'),
        mappings: count(sqlite, 'canonical_source_mappings'),
        issues: count(sqlite, 'canonical_processing_issues'),
        issueId: (sqlite.prepare(`SELECT issue_public_id FROM canonical_processing_issues`).get() as { issue_public_id: string }).issue_public_id,
      }).toEqual(before);
      expect((sqlite.prepare(`SELECT occurrence_count FROM canonical_processing_issues`).get() as { occurrence_count: number }).occurrence_count).toBeGreaterThanOrEqual(2);
    } finally {
      sqlite.close();
    }
  });
});
