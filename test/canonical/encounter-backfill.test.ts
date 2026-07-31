import { existsSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  backfillEncounters,
  type EncounterBackfillDatabase,
  type EncounterBackfillPreparedStatement,
} from '../../scripts/canonical/backfill-encounters';

type SqlValue = string | number | bigint | null | Uint8Array;

class SqliteStatement implements EncounterBackfillPreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    readonly sql: string,
    readonly params: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): SqliteStatement {
    return new SqliteStatement(
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

function createDatabase(sqlite: DatabaseSync): EncounterBackfillDatabase {
  return {
    prepare(sql: string) {
      return new SqliteStatement(sqlite, sql);
    },
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
}

function createFixture(): { sqlite: DatabaseSync; db: EncounterBackfillDatabase } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync('migrations/0505_canonical_program_foundation.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0506_canonical_practitioners.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0507_canonical_encounters.sql', 'utf8'));
  sqlite.exec(`
    CREATE TABLE appointments (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      doctor_id INTEGER,
      visit_type TEXT NOT NULL DEFAULT 'opd',
      status TEXT NOT NULL,
      appt_date TEXT,
      appt_time TEXT,
      checked_in_at TEXT,
      created_at TEXT
    );
    CREATE TABLE visits (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      doctor_id INTEGER,
      visit_type TEXT NOT NULL DEFAULT 'opd',
      admission_flag INTEGER NOT NULL DEFAULT 0,
      admission_no TEXT,
      visit_date TEXT,
      status TEXT,
      appointment_id INTEGER,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE consultations (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      doctor_id INTEGER NOT NULL,
      scheduled_at TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE encounters (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      visit_id INTEGER,
      appointment_id INTEGER,
      encounter_type TEXT,
      status TEXT,
      start_time TEXT,
      end_time TEXT,
      provider_id INTEGER,
      signed_snapshot TEXT,
      snapshot_hash TEXT,
      signed_at TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE encounter_addenda (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      encounter_id INTEGER NOT NULL,
      previous_snapshot_hash TEXT,
      addendum_hash TEXT,
      content TEXT,
      created_at TEXT
    );
    CREATE TABLE admissions (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      admission_no TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      bed_id INTEGER,
      doctor_id INTEGER,
      admission_type TEXT,
      admission_date TEXT NOT NULL,
      discharge_date TEXT,
      status TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE patient_bed_infos (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      admission_id INTEGER NOT NULL,
      bed_id INTEGER NOT NULL,
      started_on TEXT NOT NULL,
      ended_on TEXT,
      created_at TEXT
    );
  `);
  return { sqlite, db: createDatabase(sqlite) };
}

function count(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
}

function seedPractitioner(sqlite: DatabaseSync, tenantId: string, doctorId: number): string {
  const practitionerPublicId = `prc_${tenantId}_${doctorId}`;
  sqlite
    .prepare(
      `INSERT INTO canonical_practitioners (
         tenant_id, practitioner_public_id, practitioner_kind, display_name, status
       ) VALUES (?, ?, 'internal', ?, 'active')`,
    )
    .run(tenantId, practitionerPublicId, `Synthetic Practitioner ${doctorId}`);
  sqlite
    .prepare(
      `INSERT INTO canonical_source_mappings (
         tenant_id, entity_type, canonical_public_id, source_type,
         source_public_id, source_table, mapping_status, mapping_version,
         evidence_sha256
       ) VALUES (?, 'practitioner', ?, 'legacy_doctor', ?, 'doctors', 'mapped', 1, ?)`,
    )
    .run(tenantId, practitionerPublicId, String(doctorId), '0'.repeat(64));
  return practitionerPublicId;
}

describe('canonical encounter migration', () => {
  it('creates tenant-scoped encounter, participant, admission-link, and bed-stay tables', () => {
    expect(existsSync('migrations/0507_canonical_encounters.sql')).toBe(true);
    expect(existsSync('src/db/schema/canonical/clinical.ts')).toBe(true);

    const { sqlite } = createFixture();
    try {
      const tables = (
        sqlite
          .prepare(
            `SELECT name FROM sqlite_schema
             WHERE type='table' AND name IN (
               'canonical_encounters',
               'canonical_encounter_participants',
               'canonical_encounter_admission_links',
               'canonical_encounter_addenda',
               'canonical_bed_stays'
             ) ORDER BY name`,
          )
          .all() as Array<{ name: string }>
      ).map((row) => row.name);
      expect(tables).toEqual([
        'canonical_bed_stays',
        'canonical_encounter_addenda',
        'canonical_encounter_admission_links',
        'canonical_encounter_participants',
        'canonical_encounters',
      ]);
      for (const table of tables) {
        const tenant = sqlite
          .prepare(`PRAGMA table_info(${JSON.stringify(table)})`)
          .all()
          .find((column) => String(column.name) === 'tenant_id') as
          | { type: string; notnull: number }
          | undefined;
        expect(tenant).toMatchObject({ type: 'TEXT', notnull: 1 });
      }
    } finally {
      sqlite.close();
    }
  });
});

describe('canonical encounter backfill', () => {
  it('creates one encounter for an exact appointment/visit pair, excludes no-show planning, and creates walk-in care', async () => {
    const { sqlite, db } = createFixture();
    seedPractitioner(sqlite, '1', 1);
    sqlite.exec(`
      INSERT INTO appointments (id, tenant_id, patient_id, doctor_id, status, appt_date, checked_in_at)
      VALUES
        (1, '1', 10, 1, 'checked_in', '2026-07-01', '2026-07-01T09:00:00Z'),
        (2, '1', 11, 1, 'no_show', '2026-07-01', NULL);
      INSERT INTO visits (
        id, tenant_id, patient_id, doctor_id, visit_type, status,
        appointment_id, visit_date, created_at
      ) VALUES
        (1, '1', 10, 1, 'opd', 'concluded', 1, '2026-07-01T09:05:00Z', '2026-07-01T09:05:00Z'),
        (2, '1', 12, 1, 'opd', 'initiated', NULL, '2026-07-01T10:00:00Z', '2026-07-01T10:00:00Z');
    `);
    try {
      const result = await backfillEncounters(db, {
        tenantId: '1',
        runPublicId: 'run-visit-sources',
        nowUtc: '2026-07-14T00:00:00.000Z',
      });

      expect(result.completed).toBe(true);
      expect(count(sqlite, 'canonical_encounters')).toBe(2);
      expect(count(sqlite, 'canonical_encounter_participants')).toBe(2);
      expect(
        sqlite
          .prepare(
            `SELECT COUNT(*) AS count FROM canonical_source_mappings
             WHERE entity_type='encounter' AND mapping_status='mapped'`,
          )
          .get(),
      ).toEqual({ count: 3 });
      expect(
        sqlite
          .prepare(
            `SELECT mapping_status FROM canonical_source_mappings
             WHERE entity_type='encounter' AND source_type='legacy_appointment'
               AND source_public_id='2'`,
          )
          .get(),
      ).toEqual({ mapping_status: 'rejected' });
    } finally {
      sqlite.close();
    }
  });

  it('reuses one exact visit for a completed consultation, creates standalone teleconsultation, and rejects multiple candidates', async () => {
    const { sqlite, db } = createFixture();
    seedPractitioner(sqlite, '1', 1);
    sqlite.exec(`
      INSERT INTO visits (id, tenant_id, patient_id, doctor_id, visit_type, status, visit_date, created_at)
      VALUES
        (1, '1', 10, 1, 'opd', 'concluded', '2026-07-01T09:00:00Z', '2026-07-01T09:00:00Z'),
        (2, '1', 20, 1, 'opd', 'initiated', '2026-07-01T11:00:00Z', '2026-07-01T11:00:00Z'),
        (3, '1', 20, 1, 'opd', 'initiated', '2026-07-01T11:30:00Z', '2026-07-01T11:30:00Z');
      INSERT INTO consultations (id, tenant_id, patient_id, doctor_id, scheduled_at, status)
      VALUES
        (1, '1', 10, 1, '2026-07-01T09:30:00Z', 'completed'),
        (2, '1', 30, 1, '2026-07-01T12:00:00Z', 'completed'),
        (3, '1', 20, 1, '2026-07-01T11:15:00Z', 'completed'),
        (4, '1', 40, 1, '2026-07-01T13:00:00Z', 'scheduled');
    `);
    try {
      await backfillEncounters(db, {
        tenantId: '1',
        runPublicId: 'run-consultations',
        nowUtc: '2026-07-14T00:00:00.000Z',
      });

      expect(count(sqlite, 'canonical_encounters')).toBe(4);
      expect(
        sqlite
          .prepare(
            `SELECT mapping_status, canonical_public_id FROM canonical_source_mappings
             WHERE entity_type='encounter' AND source_type='legacy_consultation'
               AND source_public_id='1'`,
          )
          .get(),
      ).toMatchObject({ mapping_status: 'mapped' });
      expect(
        sqlite
          .prepare(
            `SELECT mapping_status FROM canonical_source_mappings
             WHERE entity_type='encounter' AND source_type='legacy_consultation'
               AND source_public_id='3'`,
          )
          .get(),
      ).toEqual({ mapping_status: 'ambiguous' });
      expect(
        sqlite
          .prepare(
            `SELECT mapping_status FROM canonical_source_mappings
             WHERE entity_type='encounter' AND source_type='legacy_consultation'
               AND source_public_id='4'`,
          )
          .get(),
      ).toEqual({ mapping_status: 'rejected' });
      expect(
        sqlite
          .prepare(
            `SELECT issue_code FROM canonical_processing_issues
             WHERE issue_code='ENCOUNTER_CONSULTATION_MULTIPLE_VISITS'`,
          )
          .get(),
      ).toEqual({ issue_code: 'ENCOUNTER_CONSULTATION_MULTIPLE_VISITS' });
    } finally {
      sqlite.close();
    }
  });

  it('uses explicit admission numbers only, never proximity, and creates ordered bed stays', async () => {
    const { sqlite, db } = createFixture();
    seedPractitioner(sqlite, '1', 1);
    sqlite.exec(`
      INSERT INTO visits (
        id, tenant_id, patient_id, doctor_id, visit_type, admission_flag,
        admission_no, status, visit_date, created_at
      ) VALUES
        (1, '1', 10, 1, 'ipd', 1, 'ADM-1', 'initiated', '2026-07-01T09:00:00Z', '2026-07-01T09:00:00Z'),
        (2, '1', 20, 1, 'opd', 0, NULL, 'concluded', '2026-07-01T10:00:00Z', '2026-07-01T10:00:00Z');
      INSERT INTO admissions (
        id, tenant_id, admission_no, patient_id, doctor_id,
        admission_date, discharge_date, status
      ) VALUES
        (1, '1', 'ADM-1', 10, 1, '2026-07-01T09:05:00Z', NULL, 'admitted'),
        (2, '1', 'ADM-2', 20, 1, '2026-07-01T10:15:00Z', NULL, 'admitted');
      INSERT INTO patient_bed_infos (
        id, tenant_id, patient_id, admission_id, bed_id, started_on, ended_on
      ) VALUES
        (1, '1', 10, 1, 100, '2026-07-01T09:10:00Z', '2026-07-02T09:00:00Z'),
        (2, '1', 10, 1, 101, '2026-07-02T09:00:00Z', NULL);
    `);
    try {
      await backfillEncounters(db, {
        tenantId: '1',
        runPublicId: 'run-admissions',
        nowUtc: '2026-07-14T00:00:00.000Z',
      });

      expect(count(sqlite, 'canonical_encounters')).toBe(3);
      expect(count(sqlite, 'canonical_encounter_admission_links')).toBe(2);
      expect(count(sqlite, 'canonical_bed_stays')).toBe(2);
      const visitEncounter = sqlite
        .prepare(
          `SELECT canonical_public_id FROM canonical_source_mappings
           WHERE entity_type='encounter' AND source_type='legacy_visit'
             AND source_public_id='1'`,
        )
        .get() as { canonical_public_id: string };
      const admissionEncounter = sqlite
        .prepare(
          `SELECT canonical_public_id FROM canonical_source_mappings
           WHERE entity_type='encounter' AND source_type='legacy_admission'
             AND source_public_id='1'`,
        )
        .get() as { canonical_public_id: string };
      expect(admissionEncounter.canonical_public_id).toBe(visitEncounter.canonical_public_id);

      const nearbyVisitEncounter = sqlite
        .prepare(
          `SELECT canonical_public_id FROM canonical_source_mappings
           WHERE entity_type='encounter' AND source_type='legacy_visit'
             AND source_public_id='2'`,
        )
        .get() as { canonical_public_id: string };
      const nearbyAdmissionEncounter = sqlite
        .prepare(
          `SELECT canonical_public_id FROM canonical_source_mappings
           WHERE entity_type='encounter' AND source_type='legacy_admission'
             AND source_public_id='2'`,
        )
        .get() as { canonical_public_id: string };
      expect(nearbyAdmissionEncounter.canonical_public_id).not.toBe(nearbyVisitEncounter.canonical_public_id);
      expect(
        sqlite
          .prepare(
            `SELECT issue_code FROM canonical_processing_issues
             WHERE issue_code='ENCOUNTER_ADMISSION_NEARBY_VISIT_UNRESOLVED'`,
          )
          .get(),
      ).toEqual({ issue_code: 'ENCOUNTER_ADMISSION_NEARBY_VISIT_UNRESOLVED' });
    } finally {
      sqlite.close();
    }
  });

  it('preserves a signed legacy encounter as hashes and timestamps without copying snapshot text', async () => {
    const { sqlite, db } = createFixture();
    seedPractitioner(sqlite, '1', 1);
    sqlite.exec(`
      INSERT INTO visits (id, tenant_id, patient_id, doctor_id, status, visit_date, created_at)
      VALUES (1, '1', 10, 1, 'concluded', '2026-07-01T09:00:00Z', '2026-07-01T09:00:00Z');
      INSERT INTO encounters (
        id, tenant_id, patient_id, visit_id, encounter_type, status,
        start_time, end_time, provider_id, signed_snapshot, signed_at
      ) VALUES (
        1, '1', 10, 1, 'outpatient', 'completed',
        '2026-07-01T09:00:00Z', '2026-07-01T09:30:00Z', 1,
        'SENSITIVE SIGNED CLINICAL SNAPSHOT', '2026-07-01T09:35:00Z'
      );
      INSERT INTO encounter_addenda (
        id, tenant_id, encounter_id, previous_snapshot_hash, addendum_hash,
        content, created_at
      ) VALUES (
        1, '1', 1, '${'b'.repeat(64)}', '${'c'.repeat(64)}',
        'SENSITIVE CLINICAL ADDENDUM', '2026-07-01T10:00:00Z'
      );
    `);
    try {
      await backfillEncounters(db, {
        tenantId: '1',
        runPublicId: 'run-signed',
        nowUtc: '2026-07-14T00:00:00.000Z',
      });

      const row = sqlite
        .prepare(
          `SELECT signed_snapshot_sha256, signed_at_utc
           FROM canonical_encounters`,
        )
        .get() as { signed_snapshot_sha256: string; signed_at_utc: string };
      expect(row.signed_snapshot_sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(row.signed_at_utc).toBe('2026-07-01T09:35:00.000Z');
      const serialized = JSON.stringify(
        sqlite.prepare(`SELECT * FROM canonical_encounters`).all(),
      );
      expect(serialized).not.toContain('SENSITIVE SIGNED CLINICAL SNAPSHOT');
      expect(
        sqlite
          .prepare(
            `SELECT previous_snapshot_sha256, addendum_sha256
             FROM canonical_encounter_addenda`,
          )
          .get(),
      ).toEqual({
        previous_snapshot_sha256: 'b'.repeat(64),
        addendum_sha256: 'c'.repeat(64),
      });
    } finally {
      sqlite.close();
    }
  });

  it('isolates identical source IDs by tenant and records missing practitioner mappings', async () => {
    const { sqlite, db } = createFixture();
    seedPractitioner(sqlite, '1', 1);
    sqlite.exec(`
      INSERT INTO visits (id, tenant_id, patient_id, doctor_id, status, visit_date, created_at)
      VALUES
        (1, '1', 10, 1, 'initiated', '2026-07-01T09:00:00Z', '2026-07-01T09:00:00Z'),
        (2, '2', 20, 1, 'initiated', '2026-07-01T09:00:00Z', '2026-07-01T09:00:00Z');
    `);
    try {
      await backfillEncounters(db, {
        tenantId: '1',
        runPublicId: 'run-tenant-one',
        nowUtc: '2026-07-14T00:00:00.000Z',
      });
      await backfillEncounters(db, {
        tenantId: '2',
        runPublicId: 'run-tenant-two',
        nowUtc: '2026-07-14T00:01:00.000Z',
      });

      const encounterIds = sqlite
        .prepare(`SELECT encounter_public_id FROM canonical_encounters ORDER BY tenant_id`)
        .all() as Array<{ encounter_public_id: string }>;
      expect(encounterIds).toHaveLength(2);
      expect(encounterIds[0].encounter_public_id).not.toBe(encounterIds[1].encounter_public_id);
      expect(count(sqlite, 'canonical_encounter_participants')).toBe(1);
      expect(
        sqlite
          .prepare(
            `SELECT issue_code FROM canonical_processing_issues
             WHERE tenant_id='2' AND issue_code='ENCOUNTER_PRACTITIONER_MAPPING_MISSING'`,
          )
          .get(),
      ).toEqual({ issue_code: 'ENCOUNTER_PRACTITIONER_MAPPING_MISSING' });
    } finally {
      sqlite.close();
    }
  });

  it('rejects an invalid bed interval without aborting the admission backfill', async () => {
    const { sqlite, db } = createFixture();
    seedPractitioner(sqlite, '1', 1);
    sqlite.exec(`
      INSERT INTO admissions (
        id, tenant_id, admission_no, patient_id, doctor_id, admission_date, status
      ) VALUES (1, '1', 'ADM-1', 10, 1, '2026-07-01T09:00:00Z', 'admitted');
      INSERT INTO patient_bed_infos (
        id, tenant_id, patient_id, admission_id, bed_id, started_on, ended_on
      ) VALUES (1, '1', 10, 1, 100, '2026-07-02T09:00:00Z', '2026-07-01T09:00:00Z');
    `);
    try {
      const result = await backfillEncounters(db, {
        tenantId: '1',
        runPublicId: 'run-invalid-bed',
        nowUtc: '2026-07-14T00:00:00.000Z',
      });
      expect(result.completed).toBe(true);
      expect(count(sqlite, 'canonical_encounter_admission_links')).toBe(1);
      expect(count(sqlite, 'canonical_bed_stays')).toBe(0);
      expect(
        sqlite
          .prepare(
            `SELECT mapping_status FROM canonical_source_mappings
             WHERE entity_type='bed_stay' AND source_public_id='1'`,
          )
          .get(),
      ).toEqual({ mapping_status: 'ambiguous' });
      expect(
        sqlite
          .prepare(
            `SELECT issue_code FROM canonical_processing_issues
             WHERE issue_code='ENCOUNTER_BED_STAY_INVALID'`,
          )
          .get(),
      ).toEqual({ issue_code: 'ENCOUNTER_BED_STAY_INVALID' });
    } finally {
      sqlite.close();
    }
  });

  it('rolls back a failed source group, resumes checkpoints, and reruns without duplicates', async () => {
    const { sqlite, db } = createFixture();
    seedPractitioner(sqlite, '1', 1);
    sqlite.exec(`
      INSERT INTO visits (id, tenant_id, patient_id, doctor_id, status, visit_date, created_at)
      VALUES
        (1, '1', 10, 1, 'initiated', '2026-07-01T09:00:00Z', '2026-07-01T09:00:00Z'),
        (2, '1', 20, 1, 'initiated', '2026-07-01T10:00:00Z', '2026-07-01T10:00:00Z');
      CREATE TRIGGER fail_second_encounter
      BEFORE INSERT ON canonical_encounters
      WHEN NEW.legacy_patient_id = 20
      BEGIN
        SELECT RAISE(ABORT, 'synthetic encounter backfill failure');
      END;
    `);
    try {
      await expect(
        backfillEncounters(db, {
          tenantId: '1',
          runPublicId: 'run-resume',
          nowUtc: '2026-07-14T00:00:00.000Z',
        }),
      ).rejects.toThrow(/synthetic encounter backfill failure/);
      expect(count(sqlite, 'canonical_encounters')).toBe(1);
      expect(count(sqlite, 'canonical_source_mappings')).toBe(2);

      sqlite.exec(`DROP TRIGGER fail_second_encounter;`);
      const resumed = await backfillEncounters(db, {
        tenantId: '1',
        runPublicId: 'run-resume',
        nowUtc: '2026-07-14T00:01:00.000Z',
      });
      expect(resumed.completed).toBe(true);
      const before = {
        encounters: count(sqlite, 'canonical_encounters'),
        participants: count(sqlite, 'canonical_encounter_participants'),
        mappings: count(sqlite, 'canonical_source_mappings'),
      };

      const rerun = await backfillEncounters(db, {
        tenantId: '1',
        runPublicId: 'run-rerun',
        nowUtc: '2026-07-14T00:02:00.000Z',
      });
      expect(rerun.counts.encountersCreated).toBe(0);
      expect({
        encounters: count(sqlite, 'canonical_encounters'),
        participants: count(sqlite, 'canonical_encounter_participants'),
        mappings: count(sqlite, 'canonical_source_mappings'),
      }).toEqual(before);
    } finally {
      sqlite.close();
    }
  });
});
