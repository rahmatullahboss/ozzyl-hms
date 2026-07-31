import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  PatientVitalMeasurementProviderDatabase,
  PatientVitalMeasurementProviderPreparedStatement,
} from '../../src/lib/canonical/patient-vital-measurement-provider';
import {
  resolvePatientVitalMeasurementProviderMode,
  resolveVitalObservationProjection,
} from '../../src/lib/canonical/patient-vital-measurement-provider';
import {
  readVitalObservationDetailAdapter,
  readVitalObservationTimelineAdapter,
} from '../../src/lib/canonical/patient-vital-measurement-read-adapters';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements PatientVitalMeasurementProviderPreparedStatement {
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

function harness(): { sqlite: DatabaseSync; db: PatientVitalMeasurementProviderDatabase } {
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
      id INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,patient_id INTEGER NOT NULL,
      admission_id INTEGER,systolic INTEGER,diastolic INTEGER,temperature REAL,
      heart_rate INTEGER,spo2 REAL,respiratory_rate INTEGER,weight REAL,
      notes TEXT,recorded_by TEXT,recorded_at TEXT,source TEXT
    );
    CREATE TABLE clinical_vitals (
      id INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,patient_id INTEGER NOT NULL,
      visit_id INTEGER,temperature REAL,pulse INTEGER,blood_pressure_systolic INTEGER,
      blood_pressure_diastolic INTEGER,respiratory_rate INTEGER,spo2 REAL,weight REAL,
      height REAL,bmi REAL,pain_scale INTEGER,blood_sugar REAL,notes TEXT,taken_by INTEGER,
      taken_at TEXT,is_active INTEGER,source TEXT
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
    ) VALUES ('tenant-a','ptl-101',101,'unlinked','unverified','no_link_placeholder',?,?,1)
  `).run('1'.repeat(64), '2026-07-28T00:00:00.000Z');
  sqlite.prepare(`
    INSERT INTO canonical_practitioners (
      tenant_id,practitioner_public_id,practitioner_kind,display_name,status,version,source_evidence_sha256
    ) VALUES ('tenant-a','prac-901','internal','Recorder','active',1,?)
  `).run('2'.repeat(64));
  sqlite.prepare(`
    INSERT INTO canonical_practitioner_user_links (
      tenant_id,practitioner_public_id,legacy_user_id,link_status,evidence_type
    ) VALUES ('tenant-a','prac-901',901,'active','legacy_doctor_user_id')
  `).run();
  sqlite.prepare(`
    INSERT INTO canonical_encounters (
      tenant_id,encounter_public_id,legacy_patient_id,patient_link_public_id,
      encounter_type,status,encounter_version,source_kind,started_at_utc,source_evidence_sha256
    ) VALUES ('tenant-a','enc-801',101,'ptl-101','inpatient','in_progress',1,'runtime',?,?)
  `).run('2026-07-28T08:00:00.000Z', '3'.repeat(64));
  const identityMapping = sqlite.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES ('tenant-a',?,?,?,?,?,'mapped',1,?)
  `);
  identityMapping.run('patient_link','ptl-101','legacy_patient','101','patients','b'.repeat(64));
  identityMapping.run('encounter','enc-801','legacy_admission','801','admissions','c'.repeat(64));
  sqlite.prepare(`
    INSERT INTO patient_vitals VALUES
      (501,'tenant-a',101,801,120,80,37,80,98,18,72,'Legacy sensitive note','901',
       '2026-07-28T09:00:00.000Z','recorded'),
      (502,'tenant-a',101,801,130,85,38,90,95,20,70,'Unmapped sensitive note','901',
       '2026-07-28T09:10:00.000Z','recorded')
  `).run();
  sqlite.prepare(`
    INSERT INTO canonical_vital_observation_sets (
      tenant_id,observation_set_public_id,patient_link_public_id,encounter_public_id,
      practitioner_public_id,source_kind,effective_at_utc,recorded_at_utc,review_status,
      status_version,actor_system_key,idempotency_key,request_fingerprint_sha256,
      source_evidence_sha256,created_at_utc,updated_at_utc
    ) VALUES ('tenant-a','vital-set-501','ptl-101','enc-801','prac-901','legacy_backfill',
              '2026-07-28T09:00:00.000Z','2026-07-28T09:00:00.000Z','pending_review',1,
              'provider.test','seed-vital-501',?,?,?,?)
  `).run('4'.repeat(64), '5'.repeat(64), '2026-07-28T10:00:00.000Z', '2026-07-28T10:00:00.000Z');
  const insertComponent = sqlite.prepare(`
    INSERT INTO canonical_vital_observation_components (
      tenant_id,component_public_id,observation_set_public_id,component_sequence,
      measurement_code,numeric_value,canonical_unit_code,is_derived,
      source_evidence_sha256,created_at_utc
    ) VALUES ('tenant-a',?,?,?,?,?,?,0,?,?)
  `);
  insertComponent.run('cmp-sys','vital-set-501',1,'blood_pressure_systolic',121,'mm[Hg]','6'.repeat(64),'2026-07-28T10:00:00.000Z');
  insertComponent.run('cmp-dia','vital-set-501',2,'blood_pressure_diastolic',79,'mm[Hg]','7'.repeat(64),'2026-07-28T10:00:00.000Z');
  insertComponent.run('cmp-temp','vital-set-501',3,'body_temperature',37.2,'Cel','8'.repeat(64),'2026-07-28T10:00:00.000Z');
  insertComponent.run('cmp-heart','vital-set-501',4,'heart_rate',80,'/min','d'.repeat(64),'2026-07-28T10:00:00.000Z');
  insertComponent.run('cmp-spo2','vital-set-501',5,'oxygen_saturation',98,'%','e'.repeat(64),'2026-07-28T10:00:00.000Z');
  insertComponent.run('cmp-resp','vital-set-501',6,'respiratory_rate',18,'/min','f'.repeat(64),'2026-07-28T10:00:00.000Z');
  insertComponent.run('cmp-weight','vital-set-501',7,'body_weight',72,'kg','0'.repeat(64),'2026-07-28T10:00:00.000Z');
  sqlite.prepare(`
    INSERT INTO canonical_vital_observation_status_events (
      tenant_id,event_public_id,observation_set_public_id,from_review_status,to_review_status,
      event_version,event_type,reason_code,actor_system_key,occurred_at_utc,
      source_evidence_sha256,created_at_utc
    ) VALUES ('tenant-a','evt-recorded-501','vital-set-501',NULL,'pending_review',1,
              'recorded','recorded','provider.test',?,?,?)
  `).run('2026-07-28T10:00:00.000Z','9'.repeat(64),'2026-07-28T10:00:00.000Z');
  sqlite.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES ('tenant-a','vital_observation_set','vital-set-501','legacy_patient_vitals','501',
              'patient_vitals','mapped',1,?)
  `).run('a'.repeat(64));
}

function setMode(sqlite: DatabaseSync, mode: string, enabled = 1): void {
  sqlite.prepare(`
    INSERT INTO canonical_feature_flags (
      tenant_id,flag_key,domain,mode,is_enabled,created_at_utc,updated_at_utc
    ) VALUES ('tenant-a','canonical_patient_vital_measurement_provider_v1',
              'patient_vital_measurement',?,?,?,?)
  `).run(mode, enabled, '2026-07-28T00:00:00.000Z', '2026-07-28T00:00:00.000Z');
}

const evidence = {
  observedAtUtc: '2026-07-28T12:00:00.000Z',
  elapsedMs: 3,
  errorCount: 0,
  latencyBudgetMs: 100,
  acceptedExceptionIds: [] as string[],
};

describe('canonical patient vital measurement provider', () => {
  it('defaults safely to legacy and honours only enabled shadow/canonical modes', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(resolvePatientVitalMeasurementProviderMode(db, 'tenant-a')).resolves.toBe('legacy');
      setMode(sqlite, 'canonical', 0);
      await expect(resolvePatientVitalMeasurementProviderMode(db, 'tenant-a')).resolves.toBe('legacy');
      sqlite.exec('DELETE FROM canonical_feature_flags');
      setMode(sqlite, 'shadow');
      await expect(resolvePatientVitalMeasurementProviderMode(db, 'tenant-a')).resolves.toBe('shadow');
      sqlite.exec(`UPDATE canonical_feature_flags SET mode='canonical'`);
      await expect(resolvePatientVitalMeasurementProviderMode(db, 'tenant-a')).resolves.toBe('canonical');
    } finally { sqlite.close(); }
  });

  it('legacy mode preserves unmapped source data and identity-sensitive reads require exact mapping', async () => {
    const { sqlite, db } = harness();
    try {
      const projection = await resolveVitalObservationProjection(db, {
        tenantId: 'tenant-a', sourceType: 'legacy_patient_vitals', legacyId: 502,
      });
      expect(projection).toMatchObject({
        mode: 'legacy', observationSetPublicId: null, reviewStatus: 'legacy',
        components: expect.arrayContaining([
          expect.objectContaining({ measurementCode: 'blood_pressure_systolic', numericValue: 130 }),
        ]),
      });
      await expect(resolveVitalObservationProjection(db, {
        tenantId: 'tenant-a', sourceType: 'legacy_patient_vitals', legacyId: 502, identitySensitive: true,
      })).rejects.toThrow(/explicit vital-observation source mapping is required/i);
    } finally { sqlite.close(); }
  });

  it('shadow mode preserves legacy values and emits aggregate PHI-minimised parity', async () => {
    const { sqlite, db } = harness();
    try {
      setMode(sqlite, 'shadow');
      const result = await readVitalObservationDetailAdapter(db, {
        tenantId: 'tenant-a', sourceType: 'legacy_patient_vitals', legacyId: 501,
      }, evidence);
      expect(result.projection).toMatchObject({
        mode: 'shadow', observationSetPublicId: 'vital-set-501',
        components: expect.arrayContaining([
          expect.objectContaining({ measurementCode: 'blood_pressure_systolic', numericValue: 120 }),
        ]),
        parity: { mapping: true, patientLink: true, encounter: true, practitioner: true, componentCodes: true, componentValues: false },
      });
      expect(result.shadowEvidence).toMatchObject({
        provider: 'patient_vital_measurement',
        consumerId: 'cdb123e_vital_observation_detail',
        mode: 'shadow',
      });
      const json = JSON.stringify(result.shadowEvidence);
      for (const forbidden of ['ptl-101','enc-801','prac-901','501','120','Legacy sensitive note']) {
        expect(json).not.toContain(forbidden);
      }
    } finally { sqlite.close(); }
  });

  it('canonical mode requires exact mapping and returns canonical components', async () => {
    const { sqlite, db } = harness();
    try {
      setMode(sqlite, 'canonical');
      await expect(resolveVitalObservationProjection(db, {
        tenantId: 'tenant-a', sourceType: 'legacy_patient_vitals', legacyId: 501,
      })).resolves.toMatchObject({
        mode: 'canonical', observationSetPublicId: 'vital-set-501', patientLinkPublicId: 'ptl-101',
        encounterPublicId: 'enc-801', practitionerPublicId: 'prac-901', reviewStatus: 'pending_review',
        components: expect.arrayContaining([
          expect.objectContaining({ measurementCode: 'body_temperature', numericValue: 37.2, unitCode: 'Cel' }),
        ]),
      });
      await expect(resolveVitalObservationProjection(db, {
        tenantId: 'tenant-a', sourceType: 'legacy_patient_vitals', legacyId: 502,
      })).rejects.toThrow(/canonical vital observation mapping is required/i);
    } finally { sqlite.close(); }
  });

  it('the second selected adapter uses the same disabled-safe provider and PHI-minimised evidence', async () => {
    const { sqlite, db } = harness();
    try {
      setMode(sqlite, 'shadow');
      const result = await readVitalObservationTimelineAdapter(db, {
        tenantId: 'tenant-a', sourceType: 'legacy_patient_vitals', legacyId: 501,
      }, evidence);
      expect(result.shadowEvidence).toMatchObject({
        consumerId: 'cdb123e_vital_observation_timeline', comparisonCount: 7,
      });
      expect(result.rollbackMode).toBe('legacy');
    } finally { sqlite.close(); }
  });
});
