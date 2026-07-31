import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  backfillAppointments,
  type AppointmentBackfillDatabase,
  type AppointmentBackfillPreparedStatement,
} from '../../scripts/canonical/backfill-appointments';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements AppointmentBackfillPreparedStatement {
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

function createDatabase(sqlite: DatabaseSync): AppointmentBackfillDatabase {
  return {
    prepare(sql: string) {
      return new Statement(sqlite, sql);
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

function fixture(): { sqlite: DatabaseSync; db: AppointmentBackfillDatabase } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  for (const migration of [
    'migrations/0505_canonical_program_foundation.sql',
    'migrations/0506_canonical_practitioners.sql',
    'migrations/0507_canonical_encounters.sql',
    'migrations/0508_canonical_service_catalog.sql',
    'migrations/0544_canonical_tenant_patient_links.sql',
    'migrations/0545_canonical_practitioner_operational_adoption.sql',
    'migrations/0546_canonical_appointment_authority.sql',
  ]) sqlite.exec(readFileSync(migration, 'utf8'));
  sqlite.exec(`
    CREATE TABLE appointments (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      doctor_id INTEGER,
      appt_date TEXT NOT NULL,
      appt_time TEXT,
      appointment_type TEXT,
      visit_type TEXT,
      source TEXT,
      token_no INTEGER,
      token_assignment_type TEXT,
      status TEXT NOT NULL,
      notes TEXT,
      billing_status TEXT,
      final_fee INTEGER
    );
    CREATE TABLE consultations (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      doctor_id INTEGER NOT NULL,
      scheduled_at TEXT NOT NULL,
      duration_min INTEGER NOT NULL,
      status TEXT NOT NULL,
      notes TEXT,
      room_url TEXT
    );
    CREATE TABLE visits (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      appointment_id INTEGER,
      patient_id INTEGER NOT NULL,
      doctor_id INTEGER,
      status TEXT NOT NULL
    );
  `);
  return { sqlite, db: createDatabase(sqlite) };
}

function seedIdentities(sqlite: DatabaseSync): void {
  sqlite.exec(`
    INSERT INTO canonical_tenant_patient_links (
      tenant_id,patient_link_public_id,legacy_patient_id,link_status,
      verification_level,evidence_type,evidence_sha256,effective_from_utc,version
    ) VALUES
      ('tenant-a','ptl-101',101,'unlinked','unverified','no_link_placeholder',
       '${'1'.repeat(64)}','2026-07-26T00:00:00.000Z',1),
      ('tenant-a','ptl-102',102,'unlinked','unverified','no_link_placeholder',
       '${'2'.repeat(64)}','2026-07-26T00:00:00.000Z',1);

    INSERT INTO canonical_practitioners (
      tenant_id,practitioner_public_id,practitioner_kind,display_name,status,version,source_evidence_sha256
    ) VALUES
      ('tenant-a','practitioner-201','internal','Doctor One','active',1,'${'3'.repeat(64)}'),
      ('tenant-a','practitioner-202','internal','Doctor Two','active',1,'${'4'.repeat(64)}');

    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES
      ('tenant-a','practitioner','practitioner-201','legacy_doctor','201','doctors','mapped',1,'${'3'.repeat(64)}'),
      ('tenant-a','practitioner','practitioner-202','legacy_doctor','202','doctors','mapped',1,'${'4'.repeat(64)}');
  `);
}

function seedEncounter(sqlite: DatabaseSync): void {
  sqlite.exec(`
    INSERT INTO canonical_encounters (
      tenant_id,encounter_public_id,legacy_patient_id,encounter_type,status,
      started_at_utc,source_evidence_sha256
    ) VALUES
      ('tenant-a','encounter-501',101,'outpatient','completed','2026-07-26T03:05:00.000Z','${'5'.repeat(64)}'),
      ('tenant-a','encounter-701',102,'teleconsultation','completed','2026-07-27T04:05:00.000Z','${'6'.repeat(64)}');

    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES
      ('tenant-a','encounter','encounter-501','legacy_visit','501','visits','mapped',1,'${'5'.repeat(64)}'),
      ('tenant-a','encounter','encounter-701','legacy_consultation','701','consultations','mapped',1,'${'6'.repeat(64)}');
  `);
}

function count(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
}

function canonicalCounts(sqlite: DatabaseSync) {
  return {
    appointments: count(sqlite, 'canonical_appointments'),
    events: count(sqlite, 'canonical_appointment_status_events'),
    links: count(sqlite, 'canonical_appointment_encounter_links'),
    appointmentMappings: Number((sqlite.prepare(`
      SELECT COUNT(*) AS count FROM canonical_source_mappings WHERE entity_type='appointment'
    `).get() as { count: number }).count),
    issues: Number((sqlite.prepare(`
      SELECT COUNT(*) AS count FROM canonical_processing_issues WHERE entity_type='appointment'
    `).get() as { count: number }).count),
  };
}

describe('canonical appointment backfill', () => {
  it('maps appointment and telemedicine intent with exact identities and encounter evidence only', async () => {
    const { sqlite, db } = fixture();
    seedIdentities(sqlite);
    seedEncounter(sqlite);
    sqlite.exec(`
      INSERT INTO appointments (
        id,tenant_id,patient_id,doctor_id,appt_date,appt_time,appointment_type,
        visit_type,source,token_no,token_assignment_type,status,notes,billing_status,final_fee
      ) VALUES
        (9001,'tenant-a',101,201,'2026-07-26','09:00','new_patient','opd',
         'marketplace',7,'auto','completed','Private note','paid',100000);
      INSERT INTO visits (id,tenant_id,appointment_id,patient_id,doctor_id,status)
      VALUES (501,'tenant-a',9001,101,201,'completed');
      INSERT INTO consultations (
        id,tenant_id,patient_id,doctor_id,scheduled_at,duration_min,status,notes,room_url
      ) VALUES
        (701,'tenant-a',102,202,'2026-07-27T10:00:00',30,'completed',
         'Private complaint','https://private-room.example');
    `);
    try {
      const result = await backfillAppointments(db, {
        tenantId: 'tenant-a',
        runPublicId: 'appointment-backfill-1',
        timezone: 'Asia/Dhaka',
        nowUtc: '2026-07-26T00:00:00.000Z',
      });
      expect(result).toEqual({
        completed: true,
        counts: { scanned: 2, created: 2, mapped: 2, linked: 2, skipped: 0, issues: 0 },
      });
      expect(sqlite.prepare(`
        SELECT appointment_public_id,patient_link_public_id,requested_practitioner_public_id,
               appointment_kind,modality,scheduling_channel,requested_start_utc,
               requested_end_utc,business_date,timezone,token_number,token_assignment_type,
               current_status,status_version
        FROM canonical_appointments ORDER BY requested_start_utc
      `).all()).toEqual([
        {
          appointment_public_id: expect.stringMatching(/^appt_[0-9A-HJKMNP-TV-Z]{26}$/),
          patient_link_public_id: 'ptl-101',
          requested_practitioner_public_id: 'practitioner-201',
          appointment_kind: 'new_patient',
          modality: 'in_person',
          scheduling_channel: 'marketplace',
          requested_start_utc: '2026-07-26T03:00:00.000Z',
          requested_end_utc: '2026-07-26T03:30:00.000Z',
          business_date: '2026-07-26',
          timezone: 'Asia/Dhaka',
          token_number: 7,
          token_assignment_type: 'auto',
          current_status: 'fulfilled',
          status_version: 1,
        },
        {
          appointment_public_id: expect.stringMatching(/^appt_[0-9A-HJKMNP-TV-Z]{26}$/),
          patient_link_public_id: 'ptl-102',
          requested_practitioner_public_id: 'practitioner-202',
          appointment_kind: 'telemedicine',
          modality: 'telemedicine',
          scheduling_channel: 'marketplace',
          requested_start_utc: '2026-07-27T04:00:00.000Z',
          requested_end_utc: '2026-07-27T04:30:00.000Z',
          business_date: '2026-07-27',
          timezone: 'Asia/Dhaka',
          token_number: null,
          token_assignment_type: 'none',
          current_status: 'fulfilled',
          status_version: 1,
        },
      ]);
      expect(sqlite.prepare(`
        SELECT a.current_status,l.encounter_public_id,l.link_type,l.link_status
        FROM canonical_appointments a
        JOIN canonical_appointment_encounter_links l
          ON l.tenant_id=a.tenant_id AND l.appointment_public_id=a.appointment_public_id
        ORDER BY l.encounter_public_id
      `).all()).toEqual([
        { current_status: 'fulfilled', encounter_public_id: 'encounter-501', link_type: 'fulfilled_by', link_status: 'active' },
        { current_status: 'fulfilled', encounter_public_id: 'encounter-701', link_type: 'fulfilled_by', link_status: 'active' },
      ]);
      expect(JSON.stringify(sqlite.prepare(`
        SELECT result_summary_json FROM canonical_migration_runs WHERE run_public_id='appointment-backfill-1'
      `).get())).not.toContain('Private');
      expect(JSON.stringify(sqlite.prepare(`
        SELECT result_summary_json FROM canonical_migration_runs WHERE run_public_id='appointment-backfill-1'
      `).get())).not.toContain('100000');
    } finally {
      sqlite.close();
    }
  });

  it('fails closed on missing identity mappings and keeps completed intent non-fulfilled without exact encounter evidence', async () => {
    const { sqlite, db } = fixture();
    seedIdentities(sqlite);
    sqlite.exec(`
      INSERT INTO appointments (
        id,tenant_id,patient_id,doctor_id,appt_date,appt_time,appointment_type,
        visit_type,source,token_no,token_assignment_type,status
      ) VALUES
        (9001,'tenant-a',999,201,'2026-07-26','09:00','new_patient','opd','reception',1,'auto','scheduled'),
        (9002,'tenant-a',101,999,'2026-07-26','10:00','new_patient','opd','reception',2,'auto','scheduled'),
        (9003,'tenant-a',101,201,'2026-07-26','11:00','new_patient','opd','reception',3,'auto','completed');
    `);
    try {
      const result = await backfillAppointments(db, {
        tenantId: 'tenant-a',
        runPublicId: 'appointment-backfill-issues',
        timezone: 'Asia/Dhaka',
        nowUtc: '2026-07-26T00:00:00.000Z',
      });
      expect(result.completed).toBe(true);
      expect(result.counts).toEqual({ scanned: 3, created: 1, mapped: 1, linked: 0, skipped: 0, issues: 3 });
      expect(sqlite.prepare(`
        SELECT current_status FROM canonical_appointments
      `).get()).toEqual({ current_status: 'checked_in' });
      expect(sqlite.prepare(`
        SELECT source_public_id,mapping_status,canonical_public_id
        FROM canonical_source_mappings
        WHERE entity_type='appointment'
        ORDER BY source_public_id
      `).all()).toEqual([
        { source_public_id: '9001', mapping_status: 'ambiguous', canonical_public_id: null },
        { source_public_id: '9002', mapping_status: 'ambiguous', canonical_public_id: null },
        { source_public_id: '9003', mapping_status: 'mapped', canonical_public_id: expect.any(String) },
      ]);
      expect(sqlite.prepare(`
        SELECT issue_code FROM canonical_processing_issues
        WHERE entity_type='appointment' ORDER BY issue_code
      `).all()).toEqual([
        { issue_code: 'APPOINTMENT_FULFILMENT_ENCOUNTER_MISSING' },
        { issue_code: 'APPOINTMENT_PATIENT_LINK_MISSING' },
        { issue_code: 'APPOINTMENT_PRACTITIONER_MAPPING_MISSING' },
      ]);
    } finally {
      sqlite.close();
    }
  });

  it('persists source-partition checkpoints and resumes a bounded run', async () => {
    const { sqlite, db } = fixture();
    seedIdentities(sqlite);
    sqlite.exec(`
      INSERT INTO appointments (
        id,tenant_id,patient_id,doctor_id,appt_date,appt_time,appointment_type,
        visit_type,source,token_no,token_assignment_type,status
      ) VALUES
        (1,'tenant-a',101,201,'2026-07-26','09:00','new_patient','opd','reception',1,'auto','scheduled'),
        (2,'tenant-a',102,202,'2026-07-26','10:00','new_patient','opd','reception',2,'auto','scheduled');
      INSERT INTO consultations (
        id,tenant_id,patient_id,doctor_id,scheduled_at,duration_min,status
      ) VALUES
        (3,'tenant-a',101,201,'2026-07-27T03:00:00.000Z',30,'scheduled');
    `);
    try {
      const partial = await backfillAppointments(db, {
        tenantId: 'tenant-a',
        runPublicId: 'appointment-backfill-partial',
        timezone: 'Asia/Dhaka',
        nowUtc: '2026-07-26T00:00:00.000Z',
        maxSourceRecords: 2,
      });
      expect(partial).toEqual({
        completed: false,
        counts: { scanned: 2, created: 2, mapped: 2, linked: 0, skipped: 0, issues: 0 },
      });
      expect(sqlite.prepare(`
        SELECT source_type,cursor_value,status
        FROM canonical_backfill_checkpoints ORDER BY source_type
      `).all()).toEqual([
        { source_type: 'legacy_appointment', cursor_value: '2', status: 'completed' },
      ]);

      const resumed = await backfillAppointments(db, {
        tenantId: 'tenant-a',
        runPublicId: 'appointment-backfill-partial',
        timezone: 'Asia/Dhaka',
        nowUtc: '2026-07-26T00:01:00.000Z',
        maxSourceRecords: 10,
      });
      expect(resumed).toEqual({
        completed: true,
        counts: { scanned: 1, created: 1, mapped: 1, linked: 0, skipped: 0, issues: 0 },
      });
      expect(canonicalCounts(sqlite)).toEqual({
        appointments: 3, events: 3, links: 0, appointmentMappings: 3, issues: 0,
      });
      expect(sqlite.prepare(`
        SELECT source_type,cursor_value,status
        FROM canonical_backfill_checkpoints ORDER BY source_type
      `).all()).toEqual([
        { source_type: 'legacy_appointment', cursor_value: '2', status: 'completed' },
        { source_type: 'legacy_consultation', cursor_value: '3', status: 'completed' },
      ]);
    } finally {
      sqlite.close();
    }
  });

  it('rolls back a failed source row, resumes from the last committed cursor, and reruns with zero new business rows', async () => {
    const { sqlite, db } = fixture();
    seedIdentities(sqlite);
    sqlite.exec(`
      INSERT INTO appointments (
        id,tenant_id,patient_id,doctor_id,appt_date,appt_time,appointment_type,
        visit_type,source,token_no,token_assignment_type,status
      ) VALUES
        (1,'tenant-a',101,201,'2026-07-26','09:00','new_patient','opd','reception',1,'auto','scheduled'),
        (2,'tenant-a',102,202,'2026-07-26','10:00','new_patient','opd','reception',2,'auto','scheduled');
      CREATE TRIGGER fail_second_appointment
      BEFORE INSERT ON canonical_appointments
      WHEN NEW.patient_link_public_id='ptl-102'
      BEGIN
        SELECT RAISE(ABORT, 'synthetic appointment backfill failure');
      END;
    `);
    try {
      await expect(backfillAppointments(db, {
        tenantId: 'tenant-a',
        runPublicId: 'appointment-backfill-resume',
        timezone: 'Asia/Dhaka',
        nowUtc: '2026-07-26T00:00:00.000Z',
      })).rejects.toThrow(/synthetic appointment backfill failure/);
      expect(canonicalCounts(sqlite)).toEqual({
        appointments: 1, events: 1, links: 0, appointmentMappings: 1, issues: 0,
      });
      expect(sqlite.prepare(`
        SELECT cursor_value,status FROM canonical_backfill_checkpoints
        WHERE source_type='legacy_appointment'
      `).get()).toEqual({ cursor_value: '1', status: 'running' });

      sqlite.exec(`DROP TRIGGER fail_second_appointment;`);
      const resumed = await backfillAppointments(db, {
        tenantId: 'tenant-a',
        runPublicId: 'appointment-backfill-resume',
        timezone: 'Asia/Dhaka',
        nowUtc: '2026-07-26T00:01:00.000Z',
      });
      expect(resumed.completed).toBe(true);
      const beforeSecondPass = canonicalCounts(sqlite);

      const secondPass = await backfillAppointments(db, {
        tenantId: 'tenant-a',
        runPublicId: 'appointment-backfill-second-pass',
        timezone: 'Asia/Dhaka',
        nowUtc: '2026-07-26T00:02:00.000Z',
      });
      expect(secondPass).toEqual({
        completed: true,
        counts: { scanned: 2, created: 0, mapped: 0, linked: 0, skipped: 2, issues: 0 },
      });
      expect(canonicalCounts(sqlite)).toEqual(beforeSecondPass);
    } finally {
      sqlite.close();
    }
  });
});
