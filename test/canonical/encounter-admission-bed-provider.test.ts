import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  resolveEncounterDetail,
  resolveEncounterProjection,
  resolveEncounterProviderMode,
  type EncounterProviderDatabase,
  type EncounterProviderPreparedStatement,
} from '../../src/lib/canonical/encounter-provider';
import {
  resolveActiveAdmissionsForLegacyPatients,
  resolveAdmissionBedProjection,
  resolveAdmissionBedProviderMode,
  resolveAdmissionDetail,
  resolveCurrentBedOccupancy,
  type AdmissionBedProviderDatabase,
  type AdmissionBedProviderPreparedStatement,
} from '../../src/lib/canonical/admission-bed-provider';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements EncounterProviderPreparedStatement, AdmissionBedProviderPreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
    private readonly params: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): Statement {
    return new Statement(
      this.database,
      this.sql,
      values.map((value) => (value === undefined ? null : value)) as SqlValue[],
    );
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
  encounterDb: EncounterProviderDatabase;
  admissionDb: AdmissionBedProviderDatabase;
} {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  for (const migration of [
    'migrations/0505_canonical_program_foundation.sql',
    'migrations/0506_canonical_practitioners.sql',
    'migrations/0507_canonical_encounters.sql',
    'migrations/0544_canonical_tenant_patient_links.sql',
    'migrations/0548_canonical_encounter_admission_bed_convergence.sql',
  ]) sqlite.exec(readFileSync(migration, 'utf8'));
  sqlite.exec(`
    CREATE TABLE encounters (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      provider_id INTEGER,
      doctor_id INTEGER,
      encounter_type TEXT NOT NULL,
      status TEXT NOT NULL,
      start_time TEXT,
      started_at_utc TEXT,
      end_time TEXT,
      ended_at_utc TEXT,
      signed_snapshot TEXT,
      signed_at TEXT,
      addendum_count INTEGER DEFAULT 0
    );
    CREATE TABLE visits (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      doctor_id INTEGER,
      visit_type TEXT NOT NULL,
      status TEXT NOT NULL,
      visit_date TEXT,
      created_at TEXT
    );
    CREATE TABLE admissions (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      admission_no TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      encounter_id INTEGER,
      bed_id INTEGER,
      admission_type TEXT NOT NULL,
      admission_source TEXT,
      admission_date TEXT,
      admitted_at_utc TEXT,
      discharge_date TEXT,
      discharged_at_utc TEXT,
      status TEXT NOT NULL,
      provisional_diagnosis TEXT,
      admission_fee INTEGER,
      care_of_phone TEXT
    );
    CREATE TABLE beds (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      status TEXT NOT NULL,
      ward_name TEXT,
      ward_code TEXT,
      bed_number TEXT,
      bed_no TEXT,
      rate_per_day REAL
    );
    CREATE TABLE patient_bed_infos (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      admission_id INTEGER NOT NULL,
      bed_id INTEGER NOT NULL,
      started_on TEXT,
      started_at_utc TEXT,
      ended_on TEXT,
      ended_at_utc TEXT,
      status TEXT,
      rate_per_day REAL,
      charge_amount REAL,
      is_billed INTEGER
    );
  `);
  const db = {
    prepare(sql: string) {
      return new Statement(sqlite, sql);
    },
  };
  return { sqlite, encounterDb: db, admissionDb: db };
}

function setFlag(sqlite: DatabaseSync, flagKey: string, mode: string, enabled = 1): void {
  sqlite.prepare(`
    INSERT INTO canonical_feature_flags (
      tenant_id,flag_key,domain,mode,is_enabled,created_at_utc,updated_at_utc
    ) VALUES ('tenant-a',?,?,?,?,'2026-07-27T00:00:00.000Z','2026-07-27T00:00:00.000Z')
    ON CONFLICT(tenant_id,flag_key)
    DO UPDATE SET mode=excluded.mode,is_enabled=excluded.is_enabled
  `).run(flagKey, flagKey.includes('encounter') ? 'encounter' : 'admission_bed', mode, enabled);
}

function seedIdentity(sqlite: DatabaseSync): void {
  sqlite.exec(`
    INSERT INTO canonical_tenant_patient_links (
      tenant_id,patient_link_public_id,legacy_patient_id,link_status,
      verification_level,evidence_type,evidence_sha256,effective_from_utc,version
    ) VALUES ('tenant-a','ptl-101',101,'unlinked','unverified','no_link_placeholder',
      '${'1'.repeat(64)}','2026-07-27T00:00:00.000Z',1);
    INSERT INTO canonical_practitioners (
      tenant_id,practitioner_public_id,practitioner_kind,display_name,status
    ) VALUES ('tenant-a','practitioner-201','internal','Sensitive Practitioner','active');
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES ('tenant-a','practitioner','practitioner-201','legacy_doctor','201',
      'doctors','mapped',1,'${'2'.repeat(64)}');
  `);
}

function seedEncounter(sqlite: DatabaseSync): void {
  sqlite.exec(`
    INSERT INTO encounters (
      id,tenant_id,patient_id,provider_id,doctor_id,encounter_type,status,
      start_time,started_at_utc,end_time,ended_at_utc,signed_snapshot,signed_at,addendum_count
    ) VALUES (
      11,'tenant-a',101,201,201,'inpatient','in_progress',
      '2026-07-27T08:00:00.000Z','2026-07-27T08:00:00.000Z',NULL,NULL,NULL,NULL,0
    );
    INSERT INTO canonical_care_locations (
      tenant_id,location_public_id,location_kind,location_code,display_name,
      operational_status,timezone,version,source_evidence_sha256
    ) VALUES ('tenant-a','location-ward-a','ward','WARD-A','Canonical Ward A',
      'active','Asia/Dhaka',1,'${'3'.repeat(64)}');
    INSERT INTO canonical_encounters (
      tenant_id,encounter_public_id,legacy_patient_id,patient_link_public_id,
      encounter_type,status,encounter_version,care_location_public_id,source_kind,
      source_command_key,started_at_utc,ended_at_utc,source_evidence_sha256
    ) VALUES (
      'tenant-a','encounter-11',101,'ptl-101','inpatient','in_progress',3,
      'location-ward-a','backfill','encounter-provider-11',
      '2026-07-27T08:00:00.000Z',NULL,'${'4'.repeat(64)}'
    );
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES ('tenant-a','encounter','encounter-11','legacy_encounter','11',
      'encounters','mapped',1,'${'4'.repeat(64)}');
    INSERT INTO canonical_encounter_participants (
      tenant_id,encounter_public_id,practitioner_public_id,participant_role,evidence_type
    ) VALUES ('tenant-a','encounter-11','practitioner-201','treating','legacy_encounter_provider');
  `);
}

function seedAdmission(sqlite: DatabaseSync): void {
  sqlite.exec(`
    INSERT INTO admissions (
      id,tenant_id,admission_no,patient_id,encounter_id,bed_id,admission_type,
      admission_source,admission_date,admitted_at_utc,discharge_date,discharged_at_utc,
      status,provisional_diagnosis,admission_fee,care_of_phone
    ) VALUES (
      21,'tenant-a','ADM-21',101,11,31,'planned','planned',
      '2026-07-27T08:30:00.000Z','2026-07-27T08:30:00.000Z',NULL,NULL,
      'admitted','Sensitive condition',50000,'01700000000'
    );
    INSERT INTO beds (
      id,tenant_id,status,ward_name,ward_code,bed_number,bed_no,rate_per_day
    ) VALUES (31,'tenant-a','occupied','Sensitive Ward','WARD-A','A-01','A-01',2500.50);
    INSERT INTO patient_bed_infos (
      id,tenant_id,patient_id,admission_id,bed_id,
      started_on,started_at_utc,ended_on,ended_at_utc,status,
      rate_per_day,charge_amount,is_billed
    ) VALUES (
      41,'tenant-a',101,21,31,
      '2026-07-27T08:30:00.000Z','2026-07-27T08:30:00.000Z',NULL,NULL,'active',
      2500.50,7500.00,1
    );
    INSERT INTO canonical_beds (
      tenant_id,bed_public_id,location_public_id,bed_code,bed_class,
      operational_status,version,source_evidence_sha256
    ) VALUES ('tenant-a','bed-31','location-ward-a','A-01','general','active',1,'${'5'.repeat(64)}');
    INSERT INTO canonical_admissions (
      tenant_id,admission_public_id,encounter_public_id,patient_link_public_id,
      admission_number,admission_type,admission_source,current_status,status_version,
      admitted_at_utc,reason_code,idempotency_key,request_fingerprint_sha256,
      source_evidence_sha256
    ) VALUES ('tenant-a','admission-21','encounter-11','ptl-101','ADM-21',
      'inpatient','planned','admitted',1,'2026-07-27T08:30:00.000Z','planned_admission',
      'admit-21','${'6'.repeat(64)}','${'6'.repeat(64)}');
    INSERT INTO canonical_admission_status_events (
      tenant_id,event_public_id,admission_public_id,event_type,from_status,to_status,
      sequence,reason_code,actor_system_key,idempotency_key,source_evidence_sha256,
      occurred_at_utc
    ) VALUES ('tenant-a','admission-event-21','admission-21','admitted',NULL,'admitted',
      1,'planned_admission','provider.test','admission-event-21','${'7'.repeat(64)}',
      '2026-07-27T08:30:00.000Z');
    INSERT INTO canonical_bed_stays (
      tenant_id,bed_stay_public_id,encounter_public_id,legacy_patient_bed_info_id,
      legacy_admission_id,legacy_bed_id,admission_public_id,bed_public_id,
      patient_link_public_id,started_at_utc,status,stay_version,movement_reason,
      source_evidence_sha256
    ) VALUES ('tenant-a','stay-41','encounter-11',41,21,31,'admission-21','bed-31',
      'ptl-101','2026-07-27T08:30:00.000Z','active',1,'admission','${'8'.repeat(64)}');
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES
      ('tenant-a','admission','admission-21','legacy_admission','21','admissions','mapped',1,'${'6'.repeat(64)}'),
      ('tenant-a','bed','bed-31','legacy_bed','31','beds','mapped',1,'${'8'.repeat(64)}'),
      ('tenant-a','bed_stay','stay-41','legacy_patient_bed_info','41','patient_bed_infos','mapped',1,'${'8'.repeat(64)}');
  `);
}

describe('encounter and admission/bed providers', () => {
  it('defaults missing, disabled, and unsupported flags to legacy', async () => {
    const empty = new DatabaseSync(':memory:');
    try {
      const db = { prepare: (sql: string) => new Statement(empty, sql) };
      await expect(resolveEncounterProviderMode(db, 'tenant-a')).resolves.toBe('legacy');
      await expect(resolveAdmissionBedProviderMode(db, 'tenant-a')).resolves.toBe('legacy');
    } finally {
      empty.close();
    }

    const { sqlite, encounterDb, admissionDb } = harness();
    try {
      setFlag(sqlite, 'canonical_encounter_provider_v1', 'canonical', 0);
      setFlag(sqlite, 'canonical_admission_bed_provider_v1', 'legacy', 1);
      await expect(resolveEncounterProviderMode(encounterDb, 'tenant-a')).resolves.toBe('legacy');
      await expect(resolveAdmissionBedProviderMode(admissionDb, 'tenant-a')).resolves.toBe('legacy');
      setFlag(sqlite, 'canonical_encounter_provider_v1', 'shadow', 1);
      setFlag(sqlite, 'canonical_admission_bed_provider_v1', 'canonical', 1);
      await expect(resolveEncounterProviderMode(encounterDb, 'tenant-a')).resolves.toBe('shadow');
      await expect(resolveAdmissionBedProviderMode(admissionDb, 'tenant-a')).resolves.toBe('canonical');
    } finally {
      sqlite.close();
    }
  });

  it('finds active admissions through the admission provider in legacy and canonical modes', async () => {
    const { sqlite, admissionDb } = harness();
    try {
      seedIdentity(sqlite);
      seedEncounter(sqlite);
      seedAdmission(sqlite);

      const legacy = await resolveActiveAdmissionsForLegacyPatients(admissionDb, 'tenant-a', [101, 999]);
      expect(legacy.get(101)).toMatchObject({
        mode: 'legacy',
        legacyAdmissionId: 21,
        admissionNumber: 'ADM-21',
        currentStatus: 'admitted',
      });
      expect(legacy.has(999)).toBe(false);

      setFlag(sqlite, 'canonical_admission_bed_provider_v1', 'canonical');
      const canonical = await resolveActiveAdmissionsForLegacyPatients(admissionDb, 'tenant-a', [101]);
      expect(canonical.get(101)).toEqual({
        mode: 'canonical',
        legacyAdmissionId: 21,
        admissionPublicId: 'admission-21',
        admissionNumber: 'ADM-21',
        currentStatus: 'admitted',
      });
    } finally {
      sqlite.close();
    }
  });

  it('keeps encounter legacy mode safe and rejects identity-sensitive reads without exact mapping', async () => {
    const { sqlite, encounterDb } = harness();
    try {
      seedIdentity(sqlite);
      sqlite.exec(`
        INSERT INTO encounters (
          id,tenant_id,patient_id,provider_id,doctor_id,encounter_type,status,
          start_time,started_at_utc,end_time,ended_at_utc,signed_snapshot,signed_at,addendum_count
        ) VALUES (
          11,'tenant-a',101,201,201,'inpatient','in_progress',
          '2026-07-27T08:00:00.000Z','2026-07-27T08:00:00.000Z',NULL,NULL,NULL,NULL,0
        );
      `);
      const projection = await resolveEncounterProjection(encounterDb, {
        tenantId: 'tenant-a', sourceType: 'legacy_encounter', legacyId: 11,
      });
      expect(projection.mode).toBe('legacy');
      expect(projection.encounterPublicId).toBeNull();
      expect(projection.status).toBe('in_progress');
      expect(JSON.stringify(projection)).not.toContain('Sensitive Practitioner');
      await expect(resolveEncounterDetail(encounterDb, {
        tenantId: 'tenant-a', sourceType: 'legacy_encounter', legacyId: 11,
        identitySensitive: true,
      })).rejects.toThrow(/explicit encounter/i);
    } finally {
      sqlite.close();
    }
  });

  it('shadow-compares encounter authority and canonical mode returns exact mapped facts', async () => {
    const { sqlite, encounterDb } = harness();
    try {
      seedIdentity(sqlite);
      seedEncounter(sqlite);
      setFlag(sqlite, 'canonical_encounter_provider_v1', 'shadow');
      const shadow = await resolveEncounterProjection(encounterDb, {
        tenantId: 'tenant-a', sourceType: 'legacy_encounter', legacyId: 11,
        identitySensitive: true,
      });
      expect(shadow.mode).toBe('shadow');
      expect(shadow.parity).toEqual({
        ok: true,
        mapping: true,
        patientLink: true,
        practitioner: true,
        type: true,
        status: true,
        interval: true,
        participants: true,
        careLocation: true,
      });
      expect(shadow.participants).toEqual([{ practitionerPublicId: 'practitioner-201', role: 'treating' }]);

      setFlag(sqlite, 'canonical_encounter_provider_v1', 'canonical');
      const canonical = await resolveEncounterDetail(encounterDb, {
        tenantId: 'tenant-a', sourceType: 'legacy_encounter', legacyId: 11,
        identitySensitive: true,
      });
      expect(canonical).toMatchObject({
        mode: 'canonical', encounterPublicId: 'encounter-11', patientLinkPublicId: 'ptl-101',
        encounterType: 'inpatient', status: 'in_progress', version: 3,
        careLocationPublicId: 'location-ward-a',
      });
    } finally {
      sqlite.close();
    }
  });

  it('normalizes legacy visit initiated status and Asia/Dhaka timestamps like the encounter backfill', async () => {
    const { sqlite, encounterDb } = harness();
    try {
      seedIdentity(sqlite);
      sqlite.exec(`
        INSERT INTO visits (
          id,tenant_id,patient_id,doctor_id,visit_type,status,visit_date,created_at
        ) VALUES (12,'tenant-a',101,201,'opd','initiated','2026-07-27 14:00:00','2026-07-27 14:00:00');
        INSERT INTO canonical_encounters (
          tenant_id,encounter_public_id,legacy_patient_id,patient_link_public_id,
          encounter_type,status,encounter_version,care_location_public_id,source_kind,
          source_command_key,started_at_utc,ended_at_utc,source_evidence_sha256
        ) VALUES (
          'tenant-a','encounter-12',101,'ptl-101','outpatient','in_progress',1,NULL,
          'backfill','encounter-provider-12','2026-07-27T08:00:00.000Z',NULL,'${'9'.repeat(64)}'
        );
        INSERT INTO canonical_source_mappings (
          tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
          source_table,mapping_status,mapping_version,evidence_sha256
        ) VALUES ('tenant-a','encounter','encounter-12','legacy_visit','12',
          'visits','mapped',1,'${'9'.repeat(64)}');
        INSERT INTO canonical_encounter_participants (
          tenant_id,encounter_public_id,practitioner_public_id,participant_role,evidence_type
        ) VALUES ('tenant-a','encounter-12','practitioner-201','treating','legacy_visit_doctor');
      `);
      setFlag(sqlite, 'canonical_encounter_provider_v1', 'shadow');

      const projection = await resolveEncounterProjection(encounterDb, {
        tenantId: 'tenant-a', sourceType: 'legacy_visit', legacyId: 12,
        identitySensitive: true,
      });

      expect(projection.currentStatus).toBe('in_progress');
      expect(projection.startedAtUtc).toBe('2026-07-27T08:00:00.000Z');
      expect(projection.parity?.status).toBe(true);
      expect(projection.parity?.interval).toBe(true);
      expect(projection.parity?.ok).toBe(true);
    } finally {
      sqlite.close();
    }
  });

  it('treats an absent optional Canonical care location as matching legacy sources without location evidence', async () => {
    const { sqlite, encounterDb } = harness();
    try {
      seedIdentity(sqlite);
      seedEncounter(sqlite);
      sqlite.prepare(`
        UPDATE canonical_encounters
        SET care_location_public_id=NULL
        WHERE tenant_id='tenant-a' AND encounter_public_id='encounter-11'
      `).run();
      setFlag(sqlite, 'canonical_encounter_provider_v1', 'shadow');

      const projection = await resolveEncounterProjection(encounterDb, {
        tenantId: 'tenant-a', sourceType: 'legacy_encounter', legacyId: 11,
        identitySensitive: true,
      });

      expect(projection.parity?.careLocation).toBe(true);
      expect(projection.parity?.ok).toBe(true);
    } finally {
      sqlite.close();
    }
  });

  it('fails canonical encounter mode closed when critical patient evidence is missing', async () => {
    const { sqlite, encounterDb } = harness();
    try {
      seedIdentity(sqlite);
      seedEncounter(sqlite);
      setFlag(sqlite, 'canonical_encounter_provider_v1', 'canonical');
      sqlite.prepare(`
        UPDATE canonical_tenant_patient_links
        SET link_status='retired',effective_to_utc='2026-07-27T09:00:00.000Z'
      `).run();
      await expect(resolveEncounterProjection(encounterDb, {
        tenantId: 'tenant-a', sourceType: 'legacy_encounter', legacyId: 11,
      })).rejects.toThrow(/patient/i);
    } finally {
      sqlite.close();
    }
  });

  it('shadow-compares admission lifecycle and derived occupancy without sensitive or financial state', async () => {
    const { sqlite, admissionDb } = harness();
    try {
      seedIdentity(sqlite);
      seedEncounter(sqlite);
      seedAdmission(sqlite);
      setFlag(sqlite, 'canonical_admission_bed_provider_v1', 'shadow');
      const projection = await resolveAdmissionBedProjection(admissionDb, {
        tenantId: 'tenant-a', sourceType: 'legacy_admission', legacyAdmissionId: 21, identitySensitive: true,
      });
      expect(projection.mode).toBe('shadow');
      expect(projection).toMatchObject({
        admissionPublicId: 'admission-21', encounterPublicId: 'encounter-11',
        patientLinkPublicId: 'ptl-101', admissionNumber: 'ADM-21',
        admissionType: 'inpatient', admissionSource: 'planned',
        status: 'admitted', version: 1, latestEventStatus: 'admitted',
        currentBedStayPublicId: 'stay-41', currentBedPublicId: 'bed-31',
        currentLocationPublicId: 'location-ward-a',
      });
      expect(projection.parity).toEqual({
        ok: true,
        mapping: true,
        patientLink: true,
        identity: true,
        lifecycle: true,
        latestEvent: true,
        openStayCardinality: true,
        bedMapping: true,
        derivedOccupancy: true,
        bedOperationalState: true,
      });
      expect(JSON.stringify(projection)).not.toMatch(
        /Sensitive condition|01700000000|50000|2500\.5|7500|Sensitive Ward/i,
      );
      await expect(resolveAdmissionDetail(admissionDb, {
        tenantId: 'tenant-a', sourceType: 'legacy_admission', legacyAdmissionId: 21, identitySensitive: true,
      })).resolves.toMatchObject({ admissionPublicId: 'admission-21' });
      await expect(resolveCurrentBedOccupancy(admissionDb, {
        tenantId: 'tenant-a', sourceType: 'legacy_admission', legacyAdmissionId: 21, identitySensitive: true,
      })).resolves.toMatchObject({ currentBedPublicId: 'bed-31' });
    } finally {
      sqlite.close();
    }
  });

  it('canonical admission mode fails closed on missing admission or bed mappings', async () => {
    const { sqlite, admissionDb } = harness();
    try {
      seedIdentity(sqlite);
      seedEncounter(sqlite);
      seedAdmission(sqlite);
      setFlag(sqlite, 'canonical_admission_bed_provider_v1', 'canonical');
      sqlite.prepare(`DELETE FROM canonical_source_mappings WHERE entity_type='admission'`).run();
      await expect(resolveAdmissionBedProjection(admissionDb, {
        tenantId: 'tenant-a', sourceType: 'legacy_admission', legacyAdmissionId: 21,
      })).rejects.toThrow(/admission mapping/i);
      sqlite.prepare(`
        INSERT INTO canonical_source_mappings (
          tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
          source_table,mapping_status,mapping_version,evidence_sha256
        ) VALUES ('tenant-a','admission','admission-21','legacy_admission','21',
          'admissions','mapped',1,?)
      `).run('6'.repeat(64));
      sqlite.prepare(`DELETE FROM canonical_source_mappings WHERE entity_type='bed'`).run();
      await expect(resolveAdmissionBedProjection(admissionDb, {
        tenantId: 'tenant-a', sourceType: 'legacy_admission', legacyAdmissionId: 21,
      })).rejects.toThrow(/bed mapping/i);
    } finally {
      sqlite.close();
    }
  });

  it('provider code excludes diagnosis, money, personal contact, copied labels, and billing state', () => {
    const source = [
      readFileSync('src/lib/canonical/encounter-provider.ts', 'utf8'),
      readFileSync('src/lib/canonical/admission-bed-provider.ts', 'utf8'),
    ].join('\n');
    for (const forbidden of [
      'provisional_diagnosis', 'admission_fee', 'care_of_phone', 'rate_per_day',
      'charge_amount', 'is_billed', 'ward_name', 'bed_number',
    ]) expect(source).not.toContain(forbidden);
  });
});
