import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type {
  EncounterAdmissionBedBackfillDatabase,
  EncounterAdmissionBedBackfillPreparedStatement,
} from '../../../scripts/canonical/backfill-encounter-admission-bed-convergence';

type SqlValue = string | number | bigint | null | Uint8Array;

class ConvergenceStatement implements EncounterAdmissionBedBackfillPreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    readonly sql: string,
    readonly params: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): ConvergenceStatement {
    return new ConvergenceStatement(
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

export function createConvergenceHarness(options: { failAdmissionBatchOnce?: boolean } = {}): {
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
  ]) sqlite.exec(readFileSync(migration, 'utf8'));
  sqlite.exec(`
    CREATE TABLE encounters (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      provider_id INTEGER,
      encounter_type TEXT NOT NULL,
      status TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT
    );
    CREATE TABLE beds (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      ward_code TEXT NOT NULL,
      bed_no TEXT NOT NULL,
      bed_type TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE admissions (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      admission_no TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      encounter_id INTEGER,
      bed_id INTEGER,
      admission_type TEXT NOT NULL,
      admission_source TEXT NOT NULL,
      admitted_at_utc TEXT NOT NULL,
      discharged_at_utc TEXT,
      status TEXT NOT NULL
    );
    CREATE TABLE patient_bed_infos (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      admission_id INTEGER NOT NULL,
      bed_id INTEGER NOT NULL,
      started_at_utc TEXT NOT NULL,
      ended_at_utc TEXT,
      status TEXT NOT NULL
    );
  `);

  let failAdmissionBatchOnce = options.failAdmissionBatchOnce === true;
  const db: EncounterAdmissionBedBackfillDatabase = {
    prepare(sql: string) {
      return new ConvergenceStatement(sqlite, sql);
    },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = [];
        for (let index = 0; index < statements.length; index += 1) {
          results.push(await statements[index].run());
          if (
            failAdmissionBatchOnce
            && statements.some((statement) => /INSERT INTO canonical_admissions/i.test(String(statement.sql ?? '')))
            && index === 0
          ) {
            failAdmissionBatchOnce = false;
            throw new Error('synthetic admission batch failure');
          }
        }
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

export function seedCleanConvergenceSource(sqlite: DatabaseSync): void {
  sqlite.exec(`
    INSERT INTO canonical_tenant_patient_links (
      tenant_id,patient_link_public_id,legacy_patient_id,link_status,
      verification_level,evidence_type,evidence_sha256,effective_from_utc,version
    ) VALUES ('tenant-a','ptl-101',101,'unlinked','unverified','no_link_placeholder',
      '${'1'.repeat(64)}','2026-07-27T00:00:00.000Z',1);

    INSERT INTO encounters VALUES (
      11,'tenant-a',101,NULL,'inpatient','in_progress',
      '2026-07-27T08:00:00.000Z',NULL
    );
    INSERT INTO canonical_encounters (
      tenant_id,encounter_public_id,legacy_patient_id,patient_link_public_id,
      encounter_type,status,encounter_version,care_location_public_id,source_kind,
      source_command_key,started_at_utc,ended_at_utc,source_evidence_sha256
    ) VALUES (
      'tenant-a','encounter-11',101,NULL,'inpatient','in_progress',1,NULL,
      'migration','seed-encounter-11','2026-07-27T08:00:00.000Z',NULL,'${'2'.repeat(64)}'
    );
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES ('tenant-a','encounter','encounter-11','legacy_encounter','11',
      'encounters','mapped',1,'${'2'.repeat(64)}');

    INSERT INTO beds VALUES (31,'tenant-a','WARD-A','A-01','general','occupied');
    INSERT INTO admissions VALUES (
      21,'tenant-a','ADM-21',101,11,31,'inpatient','planned',
      '2026-07-27T08:30:00.000Z',NULL,'admitted'
    );
    INSERT INTO patient_bed_infos VALUES (
      41,'tenant-a',101,21,31,'2026-07-27T08:30:00.000Z',NULL,'active'
    );
  `);
}

export const backfillOptions = {
  tenantId: 'tenant-a',
  runPublicId: 'run-encounter-admission-bed-1',
  nowUtc: '2026-07-27T10:00:00.000Z',
};
