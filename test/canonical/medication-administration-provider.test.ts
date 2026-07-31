import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  MedicationAdministrationProviderDatabase,
  MedicationAdministrationProviderPreparedStatement,
} from '../../src/lib/canonical/medication-administration-provider';
import {
  resolveMedicationAdministrationProjection,
  resolveMedicationAdministrationProviderMode,
} from '../../src/lib/canonical/medication-administration-provider';
import {
  readMedicationAdministrationDetailAdapter,
  readMedicationReconciliationSummaryAdapter,
} from '../../src/lib/canonical/medication-administration-read-adapters';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements MedicationAdministrationProviderPreparedStatement {
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

function harness(): { sqlite: DatabaseSync; db: MedicationAdministrationProviderDatabase } {
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
      id INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,patient_id INTEGER NOT NULL,
      visit_id INTEGER NOT NULL,status TEXT,dose TEXT,route TEXT,administered_on TEXT,
      actual_time TEXT,administered_by INTEGER,reason_not_given TEXT
    );
    CREATE TABLE cln_medication_reconciliation (
      id INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,patient_id INTEGER NOT NULL,
      visit_id INTEGER NOT NULL,status TEXT,performed_by INTEGER,completed_at TEXT,created_at TEXT
    );
    CREATE TABLE cln_medication_reconciliation_items (
      id INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,reconciliation_id INTEGER NOT NULL,
      is_active INTEGER DEFAULT 1
    );
  `);
  seed(sqlite);
  return { sqlite, db: { prepare(sql: string) { return new Statement(sqlite, sql); } } };
}

function seed(sqlite: DatabaseSync): void {
  sqlite.prepare(`
    INSERT INTO canonical_tenant_patient_links (
      tenant_id,patient_link_public_id,legacy_patient_id,link_status,
      verification_level,evidence_type,evidence_sha256,effective_from_utc,version
    ) VALUES ('tenant-a','patient-link-101',101,'unlinked','unverified',
              'no_link_placeholder',?,?,1)
  `).run('1'.repeat(64), '2026-07-28T00:00:00.000Z');
  for (const [practitioner, userId, name, hash] of [
    ['practitioner-901', 901, 'Prescriber', '2'],
    ['practitioner-902', 902, 'Nurse', '3'],
    ['practitioner-903', 903, 'Reviewer', '4'],
  ] as const) {
    sqlite.prepare(`
      INSERT INTO canonical_practitioners (
        tenant_id,practitioner_public_id,practitioner_kind,display_name,status,version,source_evidence_sha256
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
  `).run('2026-07-28T08:00:00.000Z', '5'.repeat(64));
  const mapping = sqlite.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES ('tenant-a',?,?,?,?,?,'mapped',1,?)
  `);
  mapping.run('patient_link','patient-link-101','legacy_patient','101','patients','6'.repeat(64));
  mapping.run('encounter','encounter-701','legacy_visit','701','visits','7'.repeat(64));

  sqlite.prepare(`
    INSERT INTO canonical_medication_orders (
      tenant_id,medication_order_public_id,patient_link_public_id,encounter_public_id,
      prescribing_practitioner_public_id,medication_display,dose_text,route_code,
      frequency_code,priority,intended_start_utc,current_status,status_version,
      idempotency_key,request_fingerprint_sha256,source_evidence_sha256
    ) VALUES ('tenant-a','med-order-1001','patient-link-101','encounter-701',
              'practitioner-901','Ceftriaxone','1 g','IV','OD','routine',?,
              'active',2,'provider-order',?,?)
  `).run('2026-07-28T08:30:00.000Z', '8'.repeat(64), '9'.repeat(64));
  sqlite.prepare(`
    INSERT INTO canonical_medication_order_status_events (
      tenant_id,event_public_id,medication_order_public_id,from_status,to_status,event_version,
      reason_code,actor_practitioner_public_id,actor_system_key,idempotency_key,
      source_evidence_sha256,occurred_at_utc
    ) VALUES
      ('tenant-a','med-order-v1','med-order-1001',NULL,'draft',1,'created','practitioner-901',
       'provider.test','provider-order-v1',?,?),
      ('tenant-a','med-order-v2','med-order-1001','draft','active',2,'activated','practitioner-901',
       'provider.test','provider-order-v2',?,?)
  `).run('a'.repeat(64),'2026-07-28T08:30:00.000Z','b'.repeat(64),'2026-07-28T08:31:00.000Z');

  sqlite.prepare(`
    INSERT INTO nur_medication_admin VALUES
      (501,'tenant-a',101,701,'given','1 g','IV','2026-07-28 09:03:00',
       '2026-07-28 09:03:00',902,NULL),
      (502,'tenant-a',101,701,'given','2 g','IV','2026-07-28 10:03:00',
       '2026-07-28 10:03:00',902,NULL)
  `).run();
  sqlite.prepare(`
    INSERT INTO canonical_medication_administration_events (
      tenant_id,administration_event_public_id,event_kind,medication_order_public_id,
      medication_order_status_version,patient_link_public_id,encounter_public_id,
      administering_practitioner_public_id,actor_system_key,scheduled_at_utc,
      occurred_at_utc,recorded_at_utc,outcome_code,administered_dose_value_decimal,
      administered_dose_unit_code,route_code,supersedes_administration_event_public_id,
      idempotency_key,request_fingerprint_sha256,source_evidence_sha256,created_at_utc
    ) VALUES
      ('tenant-a','administration-501','administration','med-order-1001',2,
       'patient-link-101','encounter-701','practitioner-902','provider.test',
       '2026-07-28T09:00:00.000Z','2026-07-28T09:03:00.000Z','2026-07-28T09:04:00.000Z',
       'given','1','g','IV',NULL,'provider-admin-501',?,?,?),
      ('tenant-a','administration-501-correction','correction','med-order-1001',2,
       'patient-link-101','encounter-701','practitioner-902','provider.test',
       '2026-07-28T09:00:00.000Z','2026-07-28T09:03:00.000Z','2026-07-28T09:10:00.000Z',
       'partially_given','0.5','g','IV','administration-501','provider-admin-501-correction',?,?,?)
  `).run(
    'c'.repeat(64),'d'.repeat(64),'2026-07-28T09:04:00.000Z',
    'e'.repeat(64),'f'.repeat(64),'2026-07-28T09:10:00.000Z',
  );
  mapping.run(
    'medication_administration_event','administration-501','legacy_nur_medication_admin','501',
    'nur_medication_admin','0'.repeat(64),
  );

  sqlite.prepare(`
    INSERT INTO cln_medication_reconciliation VALUES
      (701,'tenant-a',101,701,'in_progress',903,NULL,'2026-07-28 11:00:00'),
      (702,'tenant-a',101,701,'in_progress',903,NULL,'2026-07-28 12:00:00')
  `).run();
  sqlite.prepare(`INSERT INTO cln_medication_reconciliation_items VALUES (801,'tenant-a',701,1)`).run();
  sqlite.prepare(`
    INSERT INTO canonical_medication_reconciliations (
      tenant_id,reconciliation_public_id,patient_link_public_id,encounter_public_id,
      reconciliation_type,current_version_public_id,current_status,status_version,
      creating_practitioner_public_id,actor_system_key,idempotency_key,
      request_fingerprint_sha256,source_evidence_sha256,created_at_utc,updated_at_utc
    ) VALUES ('tenant-a','reconciliation-701','patient-link-101','encounter-701',
              'admission',NULL,'draft',1,'practitioner-903','provider.test',
              'provider-recon-701',?,?,?,?)
  `).run('1'.repeat(64),'2'.repeat(64),'2026-07-28T11:00:00.000Z','2026-07-28T11:00:00.000Z');
  sqlite.prepare(`
    INSERT INTO canonical_medication_reconciliation_versions (
      tenant_id,version_public_id,reconciliation_public_id,version_number,version_status,
      source_summary_sha256,content_sha256,authoring_practitioner_public_id,
      actor_system_key,authored_at_utc,source_evidence_sha256,created_at_utc
    ) VALUES ('tenant-a','reconciliation-701-v1','reconciliation-701',1,'draft',
              ?,?,'practitioner-903','provider.test',?,?,?)
  `).run('3'.repeat(64),'4'.repeat(64),'2026-07-28T11:00:00.000Z','5'.repeat(64),'2026-07-28T11:00:00.000Z');
  sqlite.prepare(`
    INSERT INTO canonical_medication_reconciliation_items (
      tenant_id,item_public_id,reconciliation_public_id,version_public_id,item_sequence,
      source_kind,decision_code,medication_description_snapshot,reason_code,
      source_evidence_sha256,created_at_utc
    ) VALUES ('tenant-a','reconciliation-item-701','reconciliation-701','reconciliation-701-v1',
              1,'inpatient','continue','Ceftriaxone','continue',?,?)
  `).run('6'.repeat(64),'2026-07-28T11:00:00.000Z');
  sqlite.prepare(`
    INSERT INTO canonical_medication_reconciliation_status_events (
      tenant_id,event_public_id,reconciliation_public_id,version_public_id,from_status,to_status,
      event_version,event_type,reason_code,actor_practitioner_public_id,actor_system_key,
      occurred_at_utc,source_evidence_sha256,created_at_utc
    ) VALUES ('tenant-a','reconciliation-event-701','reconciliation-701','reconciliation-701-v1',
              NULL,'draft',1,'draft_created','created','practitioner-903','provider.test',?,?,?)
  `).run('2026-07-28T11:00:00.000Z','7'.repeat(64),'2026-07-28T11:00:00.000Z');
  sqlite.prepare(`
    UPDATE canonical_medication_reconciliations
    SET current_version_public_id='reconciliation-701-v1'
    WHERE reconciliation_public_id='reconciliation-701'
  `).run();
  mapping.run(
    'medication_reconciliation','reconciliation-701','legacy_cln_medication_reconciliation','701',
    'cln_medication_reconciliation','8'.repeat(64),
  );
}

function setMode(sqlite: DatabaseSync, mode: string, enabled = 1): void {
  sqlite.prepare(`
    INSERT INTO canonical_feature_flags (
      tenant_id,flag_key,domain,mode,is_enabled,created_at_utc,updated_at_utc
    ) VALUES ('tenant-a','canonical_medication_administration_provider_v1',
              'medication_administration',?,?,?,?)
  `).run(mode, enabled, '2026-07-28T00:00:00.000Z', '2026-07-28T00:00:00.000Z');
}

const evidence = {
  observedAtUtc: '2026-07-28T13:00:00.000Z',
  elapsedMs: 4,
  errorCount: 0,
  latencyBudgetMs: 100,
  acceptedExceptionIds: [] as string[],
};

describe('canonical medication administration provider', () => {
  it('defaults safely to legacy and honours only enabled shadow/canonical modes', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(resolveMedicationAdministrationProviderMode(db, 'tenant-a')).resolves.toBe('legacy');
      setMode(sqlite, 'canonical', 0);
      await expect(resolveMedicationAdministrationProviderMode(db, 'tenant-a')).resolves.toBe('legacy');
      sqlite.exec('DELETE FROM canonical_feature_flags');
      setMode(sqlite, 'shadow');
      await expect(resolveMedicationAdministrationProviderMode(db, 'tenant-a')).resolves.toBe('shadow');
      sqlite.exec(`UPDATE canonical_feature_flags SET mode='canonical'`);
      await expect(resolveMedicationAdministrationProviderMode(db, 'tenant-a')).resolves.toBe('canonical');
    } finally { sqlite.close(); }
  });

  it('legacy mode preserves unmapped MAR output and identity-sensitive reads require exact mapping', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(resolveMedicationAdministrationProjection(db, {
        tenantId: 'tenant-a', sourceType: 'legacy_nur_medication_admin', legacyId: 502,
      })).resolves.toMatchObject({
        mode: 'legacy', kind: 'administration', canonicalPublicId: null,
        status: 'given', doseValueDecimal: '2', doseUnitCode: 'g', routeCode: 'IV',
      });
      await expect(resolveMedicationAdministrationProjection(db, {
        tenantId: 'tenant-a', sourceType: 'legacy_nur_medication_admin', legacyId: 502,
        identitySensitive: true,
      })).rejects.toThrow(/explicit medication administration source mapping is required/i);
    } finally { sqlite.close(); }
  });

  it('shadow mode preserves legacy-facing MAR output and emits aggregate PHI-minimised parity', async () => {
    const { sqlite, db } = harness();
    try {
      setMode(sqlite, 'shadow');
      const result = await readMedicationAdministrationDetailAdapter(db, {
        tenantId: 'tenant-a', sourceType: 'legacy_nur_medication_admin', legacyId: 501,
      }, evidence);
      expect(result.projection).toMatchObject({
        mode: 'shadow', canonicalPublicId: 'administration-501', status: 'given',
        doseValueDecimal: '1', routeCode: 'IV',
        parity: { mapping: true, patientLink: true, encounter: true, practitioner: true,
          status: false, clinicalShape: false, historyVisible: true },
      });
      expect(result.shadowEvidence).toMatchObject({
        provider: 'medication_administration', consumerId: 'cdb124e_mar_detail', mode: 'shadow',
        comparisonCount: 8,
      });
      const json = JSON.stringify(result.shadowEvidence);
      for (const forbidden of [
        'patient-link-101','encounter-701','practitioner-902','administration-501',
        '501','Ceftriaxone','1 g','0.5',
      ]) expect(json).not.toContain(forbidden);
    } finally { sqlite.close(); }
  });

  it('canonical mode requires exact mapping and exposes the latest immutable correction chain', async () => {
    const { sqlite, db } = harness();
    try {
      setMode(sqlite, 'canonical');
      await expect(resolveMedicationAdministrationProjection(db, {
        tenantId: 'tenant-a', sourceType: 'legacy_nur_medication_admin', legacyId: 501,
      })).resolves.toMatchObject({
        mode: 'canonical', kind: 'administration', canonicalPublicId: 'administration-501',
        status: 'partially_given', outcomeCode: 'partially_given', doseValueDecimal: '0.5',
        historyCount: 2,
      });
      await expect(resolveMedicationAdministrationProjection(db, {
        tenantId: 'tenant-a', sourceType: 'legacy_nur_medication_admin', legacyId: 502,
      })).rejects.toThrow(/canonical medication administration mapping is required/i);
    } finally { sqlite.close(); }
  });

  it('the reconciliation adapter uses the same boundary and exposes current version/status history', async () => {
    const { sqlite, db } = harness();
    try {
      setMode(sqlite, 'canonical');
      const result = await readMedicationReconciliationSummaryAdapter(db, {
        tenantId: 'tenant-a', sourceType: 'legacy_cln_medication_reconciliation', legacyId: 701,
      }, evidence);
      expect(result.projection).toMatchObject({
        mode: 'canonical', kind: 'reconciliation', canonicalPublicId: 'reconciliation-701',
        status: 'draft', statusVersion: 1, itemCount: 1, historyCount: 1,
      });
      expect(result.shadowEvidence).toBeNull();
      expect(result.rollbackMode).toBe('legacy');
      await expect(resolveMedicationAdministrationProjection(db, {
        tenantId: 'tenant-a', sourceType: 'legacy_cln_medication_reconciliation', legacyId: 702,
      })).rejects.toThrow(/canonical medication administration mapping is required/i);
    } finally { sqlite.close(); }
  });
});
