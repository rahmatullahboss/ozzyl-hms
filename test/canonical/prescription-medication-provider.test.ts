import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  PrescriptionMedicationProviderDatabase,
  PrescriptionMedicationProviderPreparedStatement,
} from '../../src/lib/canonical/prescription-medication-provider';
import {
  resolveMedicationOrderProjection,
  resolvePrescriptionDocumentProjection,
  resolvePrescriptionMedicationProviderMode,
} from '../../src/lib/canonical/prescription-medication-provider';
import {
  readMedicationOrderAdapter,
  readPrescriptionDocumentAdapter,
} from '../../src/lib/canonical/prescription-medication-read-adapters';
import type {
  PrescriptionMedicationBackfillDatabase,
  PrescriptionMedicationBackfillPreparedStatement,
} from '../../scripts/canonical/backfill-prescription-medication-intent';
import { backfillPrescriptionMedicationIntent } from '../../scripts/canonical/backfill-prescription-medication-intent';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements PrescriptionMedicationProviderPreparedStatement, PrescriptionMedicationBackfillPreparedStatement {
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
  db: PrescriptionMedicationProviderDatabase & PrescriptionMedicationBackfillDatabase;
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

  const db = {
    prepare(sql: string) {
      return new Statement(sqlite, sql);
    },
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

  seedIdentity(sqlite);
  seedLegacy(sqlite);
  return { sqlite, db };
}

function seedIdentity(sqlite: DatabaseSync): void {
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
}

function seedLegacy(sqlite: DatabaseSync): void {
  sqlite.prepare(`
    INSERT INTO prescriptions (
      id,tenant_id,patient_id,doctor_id,appointment_id,admission_id,completion_claim_id,
      status,is_locked,created_by,created_at,updated_at
    ) VALUES (501,'tenant-a',101,201,NULL,NULL,901,'final',1,901,
      '2026-07-27T08:30:00.000Z','2026-07-27T08:40:00.000Z')
  `).run();
  sqlite.prepare(`
    INSERT INTO prescription_items (
      id,prescription_id,medicine_name,dosage,frequency,duration,instructions,
      sort_order,quantity,dispensed_qty,medicine_id
    ) VALUES (601,501,'Sensitive medicine','1 tablet','BID','5 days','After food',1,10,0,1001)
  `).run();
  sqlite.prepare(`
    INSERT INTO consultation_completion_claims (
      id,tenant_id,appointment_id,patient_id,visit_id,doctor_id,encounter_id,status
    ) VALUES (901,'tenant-a',301,101,701,201,NULL,'completed')
  `).run();
  sqlite.prepare(`
    INSERT INTO cln_medication_orders (
      id,tenant_id,patient_id,visit_id,formulary_item_id,medication_name,generic_name,strength,
      dosage_form,dose,route,frequency,duration,instructions,priority,start_datetime,end_datetime,
      status,status_reason,idempotency_key,ordered_by,created_at
    ) VALUES (7011,'tenant-a',101,701,5001,'Standalone sensitive medication',NULL,'10 mg',
      'tablet','10 mg','Oral','OD','7 days','Protected CPOE text','urgent',
      '2026-07-27T10:00:00.000Z',NULL,'active',NULL,'legacy-cpoe-7011',901,
      '2026-07-27T09:55:00.000Z')
  `).run();
  sqlite.prepare(`INSERT INTO medication_orders VALUES (9001,'tenant-a',501)`).run();
  sqlite.prepare(`INSERT INTO pharmacy_prescriptions VALUES (9101,'tenant-a',101)`).run();
}

async function backfill(db: PrescriptionMedicationBackfillDatabase): Promise<void> {
  await backfillPrescriptionMedicationIntent(db, {
    tenantId: 'tenant-a',
    runPublicId: 'provider-backfill',
    nowUtc: '2026-07-27T11:00:00.000Z',
    maxSourceRecords: 20,
  });
}

function setMode(sqlite: DatabaseSync, mode: string, enabled = 1): void {
  sqlite.prepare(`
    INSERT INTO canonical_feature_flags (
      tenant_id,flag_key,domain,mode,is_enabled,created_at_utc,updated_at_utc
    ) VALUES ('tenant-a','canonical_prescription_medication_provider_v1',
      'prescription_medication_intent',?,?,
      '2026-07-27T00:00:00.000Z','2026-07-27T00:00:00.000Z')
  `).run(mode, enabled);
}

const evidence = {
  observedAtUtc: '2026-07-27T12:00:00.000Z',
  elapsedMs: 4,
  errorCount: 0,
  latencyBudgetMs: 100,
  acceptedExceptionIds: [] as string[],
};

describe('canonical prescription and medication provider', () => {
  it('defaults safely to legacy and honours only enabled shadow/canonical modes', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(resolvePrescriptionMedicationProviderMode(db, 'tenant-a')).resolves.toBe('legacy');
      setMode(sqlite, 'canonical', 0);
      await expect(resolvePrescriptionMedicationProviderMode(db, 'tenant-a')).resolves.toBe('legacy');
      sqlite.exec(`DELETE FROM canonical_feature_flags`);
      setMode(sqlite, 'disabled', 0);
      await expect(resolvePrescriptionMedicationProviderMode(db, 'tenant-a')).resolves.toBe('legacy');
      sqlite.exec(`DELETE FROM canonical_feature_flags`);
      setMode(sqlite, 'shadow');
      await expect(resolvePrescriptionMedicationProviderMode(db, 'tenant-a')).resolves.toBe('shadow');
      sqlite.exec(`UPDATE canonical_feature_flags SET mode='canonical'`);
      await expect(resolvePrescriptionMedicationProviderMode(db, 'tenant-a')).resolves.toBe('canonical');
    } finally {
      sqlite.close();
    }
  });

  it('legacy mode never resolves by medication text, numeric coincidence, or time proximity', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.prepare(`
        INSERT INTO canonical_medication_orders (
          tenant_id,medication_order_public_id,patient_link_public_id,encounter_public_id,
          prescribing_practitioner_public_id,prescription_public_id,prescription_version_public_id,
          medication_display,dose_text,route_code,frequency_code,priority,intended_start_utc,
          current_status,status_version,idempotency_key,request_fingerprint_sha256,
          source_evidence_sha256,created_at_utc,updated_at_utc
        ) VALUES ('tenant-a','unmapped-same-text','ptl-101','enc-701','prac-201',NULL,NULL,
          'Sensitive medicine','1 tablet','Oral','BID','routine','2026-07-27T08:30:00.000Z',
          'active',1,'unmapped-same-text',?,?,?,?)
      `).run('7'.repeat(64), '8'.repeat(64), '2026-07-27T11:00:00.000Z', '2026-07-27T11:00:00.000Z');

      const prescription = await resolvePrescriptionDocumentProjection(db, {
        tenantId: 'tenant-a',
        legacyPrescriptionId: 501,
      });
      expect(prescription.mode).toBe('legacy');
      expect(prescription.prescriptionPublicId).toBeNull();
      expect(prescription.patientLinkPublicId).toBe('ptl-101');
      expect(prescription.encounterPublicId).toBe('enc-701');

      const item = await resolveMedicationOrderProjection(db, {
        tenantId: 'tenant-a',
        sourceType: 'legacy_prescription_item',
        legacyId: 601,
      });
      expect(item.medicationOrderPublicId).toBeNull();
      expect(item.medicationDisplay).toBe('Sensitive medicine');
      await expect(resolveMedicationOrderProjection(db, {
        tenantId: 'tenant-a',
        sourceType: 'legacy_prescription_item',
        legacyId: 601,
        identitySensitive: true,
      })).rejects.toThrow(/explicit medication-order source mapping is required/);
    } finally {
      sqlite.close();
    }
  });

  it('shadow mode preserves legacy projections and emits PHI-minimised aggregate parity evidence', async () => {
    const { sqlite, db } = harness();
    try {
      await backfill(db);
      setMode(sqlite, 'shadow');

      const prescription = await readPrescriptionDocumentAdapter(db, {
        tenantId: 'tenant-a',
        legacyPrescriptionId: 501,
        identitySensitive: true,
      }, evidence);
      expect(prescription.projection).toMatchObject({
        mode: 'shadow',
        kind: 'prescription',
        patientLinkPublicId: 'ptl-101',
        encounterPublicId: 'enc-701',
        prescribingPractitionerPublicId: 'prac-201',
        currentStatus: 'final',
        parity: { ok: true },
      });
      expect(prescription.shadowEvidence).toMatchObject({
        provider: 'prescription_medication_intent',
        consumerId: 'cdb121e_prescription_detail',
        mode: 'shadow',
        mismatchCount: 0,
        criticalMismatchCount: 0,
        latencyWithinBudget: true,
      });

      const order = await readMedicationOrderAdapter(db, {
        tenantId: 'tenant-a',
        sourceType: 'legacy_cln_medication_order',
        legacyId: 7011,
        identitySensitive: true,
      }, evidence);
      expect(order.projection).toMatchObject({
        mode: 'shadow',
        kind: 'medication_order',
        prescriptionPublicId: null,
        medicationDisplay: 'Standalone sensitive medication',
        currentStatus: 'active',
        parity: { ok: true },
      });
      expect(order.shadowEvidence).toMatchObject({
        consumerId: 'cdb121e_medication_order_detail',
        mismatchCount: 0,
      });
      const aggregateJson = JSON.stringify([prescription.shadowEvidence, order.shadowEvidence]);
      for (const forbidden of [
        'Sensitive medicine',
        'Standalone sensitive medication',
        'After food',
        'Protected CPOE text',
        'ptl-101',
        'enc-701',
        'prac-201',
      ]) expect(aggregateJson).not.toContain(forbidden);
    } finally {
      sqlite.close();
    }
  });

  it('canonical mode returns separate canonical prescription and order shapes and fails closed on scope conflict', async () => {
    const { sqlite, db } = harness();
    try {
      await backfill(db);
      setMode(sqlite, 'canonical');

      const prescription = await resolvePrescriptionDocumentProjection(db, {
        tenantId: 'tenant-a',
        legacyPrescriptionId: 501,
        identitySensitive: true,
      });
      expect(prescription).toMatchObject({
        mode: 'canonical',
        kind: 'prescription',
        prescriptionPublicId: expect.stringMatching(/^rx_/),
        currentVersionPublicId: expect.stringMatching(/^rxver_/),
        currentStatus: 'final',
        orderCount: 1,
        safetyEventCount: 0,
      });
      expect(prescription).not.toHaveProperty('medicationDisplay');

      const order = await resolveMedicationOrderProjection(db, {
        tenantId: 'tenant-a',
        sourceType: 'legacy_prescription_item',
        legacyId: 601,
        identitySensitive: true,
      });
      expect(order).toMatchObject({
        mode: 'canonical',
        kind: 'medication_order',
        prescriptionPublicId: prescription.prescriptionPublicId,
        prescriptionVersionPublicId: prescription.currentVersionPublicId,
        medicationDisplay: 'Sensitive medicine',
        currentStatus: 'active',
      });
      expect(order).not.toHaveProperty('dispensedQty');
      expect(order).not.toHaveProperty('paymentStatus');
      expect(order).not.toHaveProperty('administrationStatus');

      sqlite.exec('PRAGMA foreign_keys = OFF');
      sqlite.prepare(`
        UPDATE canonical_medication_orders SET encounter_public_id='missing-encounter'
        WHERE prescription_public_id IS NOT NULL
      `).run();
      sqlite.exec('PRAGMA foreign_keys = ON');
      await expect(resolveMedicationOrderProjection(db, {
        tenantId: 'tenant-a',
        sourceType: 'legacy_prescription_item',
        legacyId: 601,
        identitySensitive: true,
      })).rejects.toThrow(/canonical medication-order scope conflicts with exact legacy evidence/);
    } finally {
      sqlite.close();
    }
  });
});
