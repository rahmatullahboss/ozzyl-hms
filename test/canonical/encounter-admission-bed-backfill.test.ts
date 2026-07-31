import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  backfillEncounterAdmissionBedConvergence,
  type EncounterAdmissionBedBackfillDatabase,
  type EncounterAdmissionBedBackfillPreparedStatement,
} from '../../scripts/canonical/backfill-encounter-admission-bed-convergence';
import {
  backfillOptions as convergenceFixtureOptions,
  createConvergenceHarness,
  seedCleanConvergenceSource,
} from './fixtures/encounter-admission-bed-convergence-fixture';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements EncounterAdmissionBedBackfillPreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    readonly sql: string,
    readonly params: SqlValue[] = [],
    private readonly ambiguousPatientId: number | null = null,
  ) {}

  bind(...values: unknown[]): Statement {
    return new Statement(
      this.database,
      this.sql,
      values.map((value) => (value === undefined ? null : value)) as SqlValue[],
      this.ambiguousPatientId,
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
    const results = this.database.prepare(this.sql).all(...this.params) as T[];
    if (
      this.ambiguousPatientId != null
      && /FROM canonical_tenant_patient_links/i.test(this.sql)
      && this.params.some((value) => Number(value) === this.ambiguousPatientId)
      && results.length === 1
    ) {
      const duplicate = {
        ...(results[0] as Record<string, unknown>),
        patient_link_public_id: `${String((results[0] as Record<string, unknown>).patient_link_public_id)}-duplicate`,
      } as T;
      return { results: [...results, duplicate] };
    }
    return { results };
  }
}

function harness(input: {
  ambiguous?: boolean;
  maintenanceStay?: boolean;
  failAdmissionBatchOnce?: boolean;
} = {}): {
  sqlite: DatabaseSync;
  db: EncounterAdmissionBedBackfillDatabase;
} {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  for (const migration of [
    'migrations/0505_canonical_program_foundation.sql',
    'migrations/0506_canonical_practitioners.sql',
    'migrations/0507_canonical_encounters.sql',
    'migrations/0544_canonical_tenant_patient_links.sql',
    'migrations/0548_canonical_encounter_admission_bed_convergence.sql',
    'migrations/0571_canonical_admission_encounter_type_alignment.sql',
  ]) sqlite.exec(readFileSync(migration, 'utf8'));

  sqlite.exec(`
    CREATE TABLE admissions (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      admission_no TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      doctor_id INTEGER,
      bed_id INTEGER,
      admission_type TEXT,
      admission_source TEXT,
      admission_date TEXT NOT NULL,
      discharge_date TEXT,
      status TEXT NOT NULL
    );
    CREATE TABLE beds (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      ward_code TEXT,
      ward_name TEXT,
      floor TEXT,
      room TEXT,
      bed_no TEXT,
      bed_type TEXT,
      status TEXT NOT NULL,
      rate_per_day REAL
    );
    CREATE TABLE patient_bed_infos (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      admission_id INTEGER NOT NULL,
      bed_id INTEGER NOT NULL,
      started_on TEXT NOT NULL,
      ended_on TEXT,
      rate_per_day REAL,
      charge_amount REAL,
      is_billed INTEGER
    );
  `);

  sqlite.exec(`
    INSERT INTO canonical_tenant_patient_links (
      tenant_id,patient_link_public_id,legacy_patient_id,link_status,
      verification_level,evidence_type,evidence_sha256,effective_from_utc,version
    ) VALUES
      ('tenant-a','ptl-101',101,'unlinked','unverified','no_link_placeholder',
       '${'1'.repeat(64)}','2026-07-27T00:00:00.000Z',1),
      ('tenant-a','ptl-102-a',102,'${input.ambiguous ? 'rejected' : 'unlinked'}','unverified','no_link_placeholder',
       '${'2'.repeat(64)}','2026-07-27T00:00:00.000Z',1);

    ${input.ambiguous ? `INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES (
      'tenant-a','patient_link',NULL,'legacy_patient','102','patients','ambiguous',1,'${'3'.repeat(64)}'
    );` : ''}

    INSERT INTO canonical_encounters (
      tenant_id,encounter_public_id,legacy_patient_id,patient_link_public_id,
      encounter_type,status,encounter_version,source_kind,source_command_key,
      started_at_utc,source_evidence_sha256
    ) VALUES
      ('tenant-a','enc-adm-1',101,NULL,'inpatient','in_progress',1,'migration',NULL,
       '2026-07-27T08:00:00.000Z','${'4'.repeat(64)}'),
      ('tenant-a','enc-adm-2',102,NULL,'inpatient','in_progress',1,'migration',NULL,
       '2026-07-27T09:00:00.000Z','${'5'.repeat(64)}');

    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES
      ('tenant-a','encounter','enc-adm-1','legacy_admission','1','admissions','mapped',1,'${'4'.repeat(64)}'),
      ('tenant-a','encounter','enc-adm-2','legacy_admission','2','admissions','mapped',1,'${'5'.repeat(64)}');

    INSERT INTO canonical_encounter_admission_links (
      tenant_id,encounter_public_id,legacy_admission_id,admission_no,link_status,source_evidence_sha256
    ) VALUES
      ('tenant-a','enc-adm-1',1,'ADM-1','active','${'4'.repeat(64)}'),
      ('tenant-a','enc-adm-2',2,'ADM-2','active','${'5'.repeat(64)}');

    INSERT INTO admissions VALUES
      (1,'tenant-a','ADM-1',101,NULL,10,'inpatient','planned',
       '2026-07-27T08:00:00.000Z',NULL,'admitted'),
      (2,'tenant-a','ADM-2',102,NULL,11,'inpatient','emergency',
       '2026-07-27T09:00:00.000Z',NULL,'admitted');

    INSERT INTO beds VALUES
      (10,'tenant-a','WARD-A','Sensitive Ward A','1','101','A-01','general','occupied',2500.50),
      (11,'tenant-a','WARD-A','Sensitive Ward A','1','101','A-02','general',
       '${input.maintenanceStay ? 'maintenance' : 'occupied'}',3500.50);

    INSERT INTO patient_bed_infos VALUES
      (100,'tenant-a',101,1,10,'2026-07-27T08:00:00.000Z',NULL,2500.50,7500.00,1),
      (101,'tenant-a',102,2,11,'2026-07-27T09:00:00.000Z',NULL,3500.50,3500.00,0);
  `);

  let failAdmissionBatchOnce = input.failAdmissionBatchOnce ?? false;
  const db: EncounterAdmissionBedBackfillDatabase = {
    prepare(sql: string) {
      return new Statement(sqlite, sql);
    },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        if (
          failAdmissionBatchOnce
          && statements.some((statement) => /INSERT INTO canonical_admissions/i.test((statement as Statement).sql))
        ) {
          failAdmissionBatchOnce = false;
          throw new Error('synthetic admission batch failure');
        }
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
  return { sqlite, db };
}

function count(sqlite: DatabaseSync, table: string, tail = ''): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table} ${tail}`).get() as { count: number }).count);
}

const baseOptions = {
  tenantId: 'tenant-a',
  runPublicId: 'cdb-113e-backfill-test',
  timezone: 'Asia/Dhaka',
  nowUtc: '2026-07-27T01:30:00.000Z',
};

describe('encounter, admission, and bed convergence backfill', () => {
  it('hardens exact encounter identity and deterministically creates resources, admissions, events, and interval occupancy', async () => {
    const { sqlite, db } = harness();
    try {
      const result = await backfillEncounterAdmissionBedConvergence(db, baseOptions);
      expect(result.completed).toBe(true);
      expect(result.counts.scanned).toBeGreaterThanOrEqual(10);
      expect(result.counts.encountersHardened).toBe(2);
      expect(result.counts.locationsCreated).toBe(1);
      expect(result.counts.bedsCreated).toBe(2);
      expect(result.counts.admissionsCreated).toBe(2);
      expect(result.counts.eventsCreated).toBe(2);
      expect(result.counts.bedStaysCreated).toBe(2);
      expect(result.counts.issuesCreated).toBe(0);

      expect(sqlite.prepare(`
        SELECT patient_link_public_id,encounter_version,source_kind
        FROM canonical_encounters WHERE encounter_public_id='enc-adm-1'
      `).get()).toEqual({
        patient_link_public_id: 'ptl-101',
        encounter_version: 1,
        source_kind: 'backfill',
      });
      expect(count(sqlite, 'canonical_care_locations')).toBe(1);
      expect(count(sqlite, 'canonical_beds')).toBe(2);
      expect(count(sqlite, 'canonical_admissions')).toBe(2);
      expect(count(sqlite, 'canonical_admission_status_events')).toBe(2);
      expect(count(sqlite, 'canonical_bed_stays')).toBe(2);
      expect(sqlite.prepare(`
        SELECT admission_public_id,bed_public_id,patient_link_public_id,status,stay_version
        FROM canonical_bed_stays WHERE legacy_patient_bed_info_id=100
      `).get()).toMatchObject({
        admission_public_id: expect.stringMatching(/^admission_/),
        bed_public_id: expect.stringMatching(/^bed_/),
        patient_link_public_id: 'ptl-101',
        status: 'active',
        stay_version: 1,
      });
      const serialized = JSON.stringify(result);
      for (const forbidden of ['Sensitive Ward A', '2500.5', '3500.5', '7500', 'ADM-1']) {
        expect(serialized).not.toContain(forbidden);
      }
    } finally {
      sqlite.close();
    }
  });

  it('converges an exact emergency admission without retyping its emergency encounter', async () => {
    const { sqlite, db } = harness();
    sqlite.exec(`
      UPDATE canonical_encounters
      SET encounter_type='emergency',
          patient_link_public_id='ptl-102-a',
          source_kind='backfill'
      WHERE tenant_id='tenant-a' AND encounter_public_id='enc-adm-2';
      UPDATE admissions
      SET admission_type='emergency'
      WHERE tenant_id='tenant-a' AND id=2;
    `);
    const before = sqlite.prepare(`
      SELECT encounter_public_id,encounter_type,status,started_at_utc,source_evidence_sha256
      FROM canonical_encounters
      WHERE tenant_id='tenant-a' AND encounter_public_id='enc-adm-2'
    `).get();
    try {
      const result = await backfillEncounterAdmissionBedConvergence(db, {
        ...baseOptions,
        runPublicId: 'cdb-113e-emergency-admission',
      });
      expect(result.completed).toBe(true);
      expect(result.counts.issuesCreated).toBe(0);
      expect(sqlite.prepare(`
        SELECT admission_type,admission_source,current_status,encounter_public_id,patient_link_public_id
        FROM canonical_admissions
        WHERE tenant_id='tenant-a' AND admission_number='ADM-2'
      `).get()).toEqual({
        admission_type: 'emergency',
        admission_source: 'emergency',
        current_status: 'admitted',
        encounter_public_id: 'enc-adm-2',
        patient_link_public_id: 'ptl-102-a',
      });
      expect(sqlite.prepare(`
        SELECT encounter_public_id,encounter_type,status,started_at_utc,source_evidence_sha256
        FROM canonical_encounters
        WHERE tenant_id='tenant-a' AND encounter_public_id='enc-adm-2'
      `).get()).toEqual(before);
      expect(count(sqlite, 'canonical_processing_issues', `
        WHERE issue_code='CDB113E_ADMISSION_ENCOUNTER_NOT_INPATIENT'
      `)).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('synthesizes one deterministic inpatient encounter for a planned admission without a mapping', async () => {
    const { sqlite, db } = harness();
    sqlite.exec(`
      DELETE FROM canonical_encounter_admission_links
      WHERE tenant_id='tenant-a' AND legacy_admission_id=1;
      DELETE FROM canonical_source_mappings
      WHERE tenant_id='tenant-a' AND entity_type='encounter'
        AND source_type='legacy_admission' AND source_public_id='1';
      DELETE FROM canonical_encounters
      WHERE tenant_id='tenant-a' AND encounter_public_id='enc-adm-1';
    `);
    try {
      const first = await backfillEncounterAdmissionBedConvergence(db, {
        ...baseOptions,
        runPublicId: 'cdb-113e-synthesize-admission-encounter',
      });
      expect(first.completed).toBe(true);
      expect(first.counts.issuesCreated).toBe(0);
      expect(first.counts.encountersCreated).toBe(1);

      const mapping = sqlite.prepare(`
        SELECT canonical_public_id,mapping_status
        FROM canonical_source_mappings
        WHERE tenant_id='tenant-a' AND entity_type='encounter'
          AND source_type='legacy_admission' AND source_public_id='1'
      `).get() as { canonical_public_id: string; mapping_status: string };
      expect(mapping).toEqual({
        canonical_public_id: expect.stringMatching(/^encounter_[0-9A-Z]{26}$/),
        mapping_status: 'mapped',
      });
      expect(sqlite.prepare(`
        SELECT encounter_type,status,patient_link_public_id,source_kind,started_at_utc,ended_at_utc
        FROM canonical_encounters
        WHERE tenant_id='tenant-a' AND encounter_public_id=?
      `).get(mapping.canonical_public_id)).toEqual({
        encounter_type: 'inpatient',
        status: 'in_progress',
        patient_link_public_id: 'ptl-101',
        source_kind: 'backfill',
        started_at_utc: '2026-07-27T08:00:00.000Z',
        ended_at_utc: null,
      });
      expect(sqlite.prepare(`
        SELECT encounter_public_id,legacy_admission_id,admission_no,link_status
        FROM canonical_encounter_admission_links
        WHERE tenant_id='tenant-a' AND legacy_admission_id=1
      `).get()).toEqual({
        encounter_public_id: mapping.canonical_public_id,
        legacy_admission_id: 1,
        admission_no: 'ADM-1',
        link_status: 'active',
      });
      expect(count(sqlite, 'canonical_admissions', "WHERE admission_number='ADM-1'")).toBe(1);
      expect(count(sqlite, 'canonical_admission_status_events')).toBe(2);
      expect(count(sqlite, 'canonical_bed_stays', 'WHERE legacy_patient_bed_info_id=100')).toBe(1);

      const beforeReplay = {
        encounters: count(sqlite, 'canonical_encounters'),
        admissions: count(sqlite, 'canonical_admissions'),
        events: count(sqlite, 'canonical_admission_status_events'),
        stays: count(sqlite, 'canonical_bed_stays'),
        mappings: count(sqlite, 'canonical_source_mappings'),
      };
      const replay = await backfillEncounterAdmissionBedConvergence(db, {
        ...baseOptions,
        runPublicId: 'cdb-113e-synthesize-admission-encounter-replay',
        nowUtc: '2026-07-27T02:30:00.000Z',
      });
      expect(replay.completed).toBe(true);
      expect(replay.secondPassZeroNew).toBe(true);
      expect(replay.counts.encountersCreated).toBe(0);
      expect(replay.counts.created).toBe(0);
      expect({
        encounters: count(sqlite, 'canonical_encounters'),
        admissions: count(sqlite, 'canonical_admissions'),
        events: count(sqlite, 'canonical_admission_status_events'),
        stays: count(sqlite, 'canonical_bed_stays'),
        mappings: count(sqlite, 'canonical_source_mappings'),
      }).toEqual(beforeReplay);
    } finally {
      sqlite.close();
    }
  });

  it('keeps same-name wards distinct when explicit legacy ward identities differ', async () => {
    const { sqlite, db } = harness();
    sqlite.exec(`
      ALTER TABLE beds ADD COLUMN ward_id INTEGER;
      UPDATE beds SET ward_id=900 WHERE id IN (10,11);
      INSERT INTO beds (
        id,tenant_id,ward_code,ward_name,floor,room,bed_no,bed_type,status,rate_per_day,ward_id
      ) VALUES
        (12,'tenant-a','WARD-A','Sensitive Ward A',NULL,NULL,'A-03','general','available',1000,901),
        (13,'tenant-a','WARD-A','Sensitive Ward A',NULL,NULL,'A-04','general','available',1000,902);
    `);
    try {
      const result = await backfillEncounterAdmissionBedConvergence(db, {
        ...baseOptions,
        runPublicId: 'cdb-113e-explicit-ward-identity',
      });
      expect(result.completed).toBe(true);
      expect(result.counts.locationsCreated).toBe(3);
      expect(result.counts.bedsCreated).toBe(4);
      expect(count(sqlite, 'canonical_care_locations')).toBe(3);
      expect(count(sqlite, 'canonical_beds')).toBe(4);
      expect(sqlite.prepare(`
        SELECT COUNT(*) AS count
        FROM canonical_source_mappings m
        LEFT JOIN canonical_care_locations l
          ON l.tenant_id=m.tenant_id AND l.location_public_id=m.canonical_public_id
        WHERE m.tenant_id='tenant-a' AND m.entity_type='care_location'
          AND (m.mapping_status!='mapped' OR l.id IS NULL)
      `).get()).toEqual({ count: 0 });
      expect(sqlite.prepare(`
        SELECT COUNT(DISTINCT canonical_public_id) AS count
        FROM canonical_source_mappings
        WHERE tenant_id='tenant-a' AND entity_type='care_location'
      `).get()).toEqual({ count: 3 });
    } finally {
      sqlite.close();
    }
  });

  it('pauses at a bounded cursor, resumes all ordered partitions, and records migration-run-bound checkpoints', async () => {
    const { sqlite, db } = harness();
    try {
      const first = await backfillEncounterAdmissionBedConvergence(db, {
        ...baseOptions,
        runPublicId: 'cdb-113e-bounded',
        maxSourceRecords: 3,
      });
      expect(first.completed).toBe(false);
      expect(first.counts.scanned).toBe(3);
      expect(count(sqlite, 'canonical_backfill_checkpoints')).toBeGreaterThan(0);
      expect(count(sqlite, 'canonical_backfill_checkpoints', "WHERE status='paused'")).toBeGreaterThan(0);

      let latest = first;
      for (let pass = 0; pass < 10 && !latest.completed; pass += 1) {
        latest = await backfillEncounterAdmissionBedConvergence(db, {
          ...baseOptions,
          runPublicId: 'cdb-113e-bounded',
          maxSourceRecords: 3,
          nowUtc: `2026-07-27T01:${String(31 + pass).padStart(2, '0')}:00.000Z`,
        });
      }
      expect(latest.completed).toBe(true);
      expect(count(sqlite, 'canonical_backfill_checkpoints', "WHERE status='completed'")).toBe(6);
      const orphan = count(sqlite, 'canonical_backfill_checkpoints', `
        WHERE migration_run_id NOT IN (SELECT id FROM canonical_migration_runs)
      `);
      expect(orphan).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('classifies ambiguous identity and maintenance-bed occupancy as stable issues without guessing', async () => {
    const ambiguousHarness = harness({ ambiguous: true });
    try {
      const ambiguous = await backfillEncounterAdmissionBedConvergence(ambiguousHarness.db, {
        ...baseOptions,
        runPublicId: 'cdb-113e-ambiguous-identity',
      });
      expect(ambiguous.completed).toBe(true);
      expect(ambiguous.counts.issuesCreated).toBeGreaterThanOrEqual(1);
      expect(ambiguousHarness.sqlite.prepare(`
        SELECT patient_link_public_id FROM canonical_encounters WHERE encounter_public_id='enc-adm-2'
      `).get()).toEqual({ patient_link_public_id: null });
      expect(count(ambiguousHarness.sqlite, 'canonical_admissions', "WHERE encounter_public_id='enc-adm-2'")).toBe(0);
      const ambiguousCodes = (ambiguousHarness.sqlite.prepare(`
        SELECT issue_code FROM canonical_processing_issues
        WHERE tenant_id='tenant-a' AND issue_type='encounter_admission_bed_backfill'
        ORDER BY issue_code
      `).all() as Array<{ issue_code: string }>).map((row) => row.issue_code);
      expect(ambiguousCodes).toContain('CDB113E_PATIENT_LINK_AMBIGUOUS');
    } finally {
      ambiguousHarness.sqlite.close();
    }

    const maintenanceHarness = harness({ maintenanceStay: true });
    try {
      const maintenance = await backfillEncounterAdmissionBedConvergence(maintenanceHarness.db, {
        ...baseOptions,
        runPublicId: 'cdb-113e-maintenance-occupancy',
      });
      expect(maintenance.completed).toBe(true);
      expect(count(maintenanceHarness.sqlite, 'canonical_bed_stays', 'WHERE legacy_patient_bed_info_id=101')).toBe(0);
      const maintenanceCodes = (maintenanceHarness.sqlite.prepare(`
        SELECT issue_code FROM canonical_processing_issues
        WHERE tenant_id='tenant-a' AND issue_type='encounter_admission_bed_backfill'
        ORDER BY issue_code
      `).all() as Array<{ issue_code: string }>).map((row) => row.issue_code);
      expect(maintenanceCodes).toContain('CDB113E_MAINTENANCE_BED_OCCUPANCY');
    } finally {
      maintenanceHarness.sqlite.close();
    }
  });

  it('operationally adopts exact preexisting mapped stays instead of treating reviewed migration evidence as drift', async () => {
    const { sqlite, db } = harness();
    try {
      await backfillEncounterAdmissionBedConvergence(db, baseOptions);
      sqlite.exec(`
        UPDATE canonical_bed_stays
        SET admission_public_id=NULL,
            bed_public_id=NULL,
            patient_link_public_id=NULL,
            source_command_key=NULL,
            source_evidence_sha256='${'f'.repeat(64)}';
        UPDATE canonical_source_mappings
        SET evidence_sha256='${'f'.repeat(64)}'
        WHERE tenant_id='tenant-a'
          AND entity_type='bed_stay'
          AND source_type='legacy_patient_bed_info';
      `);

      const adopted = await backfillEncounterAdmissionBedConvergence(db, {
        ...baseOptions,
        runPublicId: 'cdb-113e-operational-stay-adoption',
        nowUtc: '2026-07-27T01:45:00.000Z',
      });
      expect(adopted.completed).toBe(true);
      expect(adopted.counts).toMatchObject({
        bedStaysCreated: 0,
        bedStaysUpdated: 2,
        issuesCreated: 0,
      });
      expect(count(sqlite, 'canonical_bed_stays')).toBe(2);
      expect(count(sqlite, 'canonical_bed_stays', `
        WHERE admission_public_id IS NULL
           OR bed_public_id IS NULL
           OR patient_link_public_id IS NULL
           OR status='invalid'
      `)).toBe(0);
      expect(count(sqlite, 'canonical_source_mappings', `
        WHERE entity_type='bed_stay'
          AND source_type='legacy_patient_bed_info'
          AND (mapping_status!='mapped' OR canonical_public_id IS NULL)
      `)).toBe(0);
      expect(count(sqlite, 'canonical_processing_issues', `
        WHERE issue_code='CDB113E_BED_STAY_SOURCE_EVIDENCE_DRIFT'
      `)).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('preserves a mapped historical stay as invalid and ambiguous when exact admission authority is unavailable', async () => {
    const { sqlite, db } = harness();
    try {
      await backfillEncounterAdmissionBedConvergence(db, baseOptions);
      const target = sqlite.prepare(`
        SELECT s.bed_stay_public_id,s.legacy_admission_id
        FROM canonical_bed_stays s
        WHERE s.legacy_patient_bed_info_id=101
      `).get() as { bed_stay_public_id: string; legacy_admission_id: number };
      sqlite.exec(`
        UPDATE canonical_bed_stays
        SET admission_public_id=NULL,
            bed_public_id=NULL,
            patient_link_public_id=NULL,
            source_command_key=NULL,
            source_evidence_sha256='${'e'.repeat(64)}'
        WHERE legacy_patient_bed_info_id=101;
        UPDATE canonical_encounters
        SET encounter_type='outpatient'
        WHERE encounter_public_id=(
          SELECT encounter_public_id FROM canonical_admissions
          WHERE admission_public_id=(
            SELECT canonical_public_id FROM canonical_source_mappings
            WHERE tenant_id='tenant-a' AND entity_type='admission'
              AND source_type='legacy_admission' AND source_public_id='2'
          )
        );
        DELETE FROM canonical_admission_status_events
        WHERE admission_public_id=(
          SELECT canonical_public_id FROM canonical_source_mappings
          WHERE tenant_id='tenant-a' AND entity_type='admission'
            AND source_type='legacy_admission' AND source_public_id='2'
        );
        DELETE FROM canonical_admissions
        WHERE admission_public_id=(
          SELECT canonical_public_id FROM canonical_source_mappings
          WHERE tenant_id='tenant-a' AND entity_type='admission'
            AND source_type='legacy_admission' AND source_public_id='2'
        );
        DELETE FROM canonical_source_mappings
        WHERE tenant_id='tenant-a' AND entity_type='admission'
          AND source_type='legacy_admission' AND source_public_id='2';
        UPDATE canonical_source_mappings
        SET evidence_sha256='${'e'.repeat(64)}'
        WHERE tenant_id='tenant-a' AND entity_type='bed_stay'
          AND source_type='legacy_patient_bed_info' AND source_public_id='101';
      `);

      const classified = await backfillEncounterAdmissionBedConvergence(db, {
        ...baseOptions,
        runPublicId: 'cdb-113e-historical-stay-disposition',
        nowUtc: '2026-07-27T01:50:00.000Z',
      });
      expect(classified.completed).toBe(true);
      expect(sqlite.prepare(`
        SELECT bed_stay_public_id,status,admission_public_id,bed_public_id,
               patient_link_public_id,close_reason
        FROM canonical_bed_stays
        WHERE legacy_patient_bed_info_id=101
      `).get()).toEqual({
        bed_stay_public_id: target.bed_stay_public_id,
        status: 'invalid',
        admission_public_id: null,
        bed_public_id: null,
        patient_link_public_id: null,
        close_reason: 'CDB113E_BED_STAY_ADMISSION_MAPPING_MISSING',
      });
      expect(sqlite.prepare(`
        SELECT canonical_public_id,mapping_status
        FROM canonical_source_mappings
        WHERE tenant_id='tenant-a' AND entity_type='bed_stay'
          AND source_type='legacy_patient_bed_info' AND source_public_id='101'
      `).get()).toEqual({ canonical_public_id: null, mapping_status: 'ambiguous' });
      expect(count(sqlite, 'canonical_processing_issues', `
        WHERE issue_code='CDB113E_BED_STAY_ADMISSION_MAPPING_MISSING'
          AND source_public_id='101' AND status='open'
      `)).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it('is second-pass safe and creates zero new canonical business rows', async () => {
    const { sqlite, db } = harness();
    try {
      await backfillEncounterAdmissionBedConvergence(db, baseOptions);
      const before = {
        locations: count(sqlite, 'canonical_care_locations'),
        beds: count(sqlite, 'canonical_beds'),
        admissions: count(sqlite, 'canonical_admissions'),
        events: count(sqlite, 'canonical_admission_status_events'),
        stays: count(sqlite, 'canonical_bed_stays'),
        mappings: count(sqlite, 'canonical_source_mappings'),
      };
      const second = await backfillEncounterAdmissionBedConvergence(db, {
        ...baseOptions,
        runPublicId: 'cdb-113e-second-pass',
        nowUtc: '2026-07-27T02:00:00.000Z',
      });
      expect(second.completed).toBe(true);
      expect(second.counts).toMatchObject({
        locationsCreated: 0,
        bedsCreated: 0,
        admissionsCreated: 0,
        eventsCreated: 0,
        bedStaysCreated: 0,
        mappingsCreated: 0,
      });
      expect({
        locations: count(sqlite, 'canonical_care_locations'),
        beds: count(sqlite, 'canonical_beds'),
        admissions: count(sqlite, 'canonical_admissions'),
        events: count(sqlite, 'canonical_admission_status_events'),
        stays: count(sqlite, 'canonical_bed_stays'),
        mappings: count(sqlite, 'canonical_source_mappings'),
      }).toEqual(before);
    } finally {
      sqlite.close();
    }
  });

  it('rolls back admission business rows, mappings, events, and checkpoint cursor together, then retries safely', async () => {
    const { sqlite, db } = harness({ failAdmissionBatchOnce: true });
    try {
      await expect(backfillEncounterAdmissionBedConvergence(db, {
        ...baseOptions,
        runPublicId: 'cdb-113e-rollback',
      })).rejects.toThrow(/synthetic admission batch failure/);
      expect(count(sqlite, 'canonical_admissions')).toBe(0);
      expect(count(sqlite, 'canonical_admission_status_events')).toBe(0);
      expect(count(sqlite, 'canonical_source_mappings', "WHERE entity_type='admission'")).toBe(0);
      expect(sqlite.prepare(`
        SELECT cursor_value,scanned_count,created_count,mapped_count
        FROM canonical_backfill_checkpoints
        WHERE entity_type='encounter_admission_bed' AND source_type='admission'
      `).get()).toEqual({
        cursor_value: null,
        scanned_count: 0,
        created_count: 0,
        mapped_count: 0,
      });

      const retried = await backfillEncounterAdmissionBedConvergence(db, {
        ...baseOptions,
        runPublicId: 'cdb-113e-rollback',
        nowUtc: '2026-07-27T10:05:00.000Z',
      });
      expect(retried.completed).toBe(true);
      expect(count(sqlite, 'canonical_admissions')).toBe(2);
      expect(count(sqlite, 'canonical_admission_status_events')).toBe(2);
      expect(count(sqlite, 'canonical_source_mappings', "WHERE entity_type='admission'")).toBe(2);
    } finally {
      sqlite.close();
    }
  });
});
