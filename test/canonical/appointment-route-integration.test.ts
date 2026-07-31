import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import { CanonicalIdempotencyConflictError } from '../../src/lib/canonical/idempotency';
import { createAppointmentIntent } from '../../src/lib/canonical/commands/manage-appointment';
import {
  buildAppointmentRouteContext,
  fulfilRouteAppointment,
  rescheduleRouteAppointment,
  transitionRouteAppointment,
} from '../../src/lib/canonical/appointment-route-integration';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements CanonicalPreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    readonly sql: string,
    readonly params: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): Statement {
    return new Statement(
      this.database,
      this.sql,
      values.map((value) => value === undefined ? null : value) as SqlValue[],
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

function harness(): { sqlite: DatabaseSync; db: CanonicalBatchDatabase } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
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
    CREATE TABLE doctors (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      canonical_source_key TEXT,
      name TEXT NOT NULL
    );
    CREATE TABLE appointments (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      doctor_id INTEGER,
      status TEXT NOT NULL,
      appt_date TEXT NOT NULL,
      appt_time TEXT,
      appointment_type TEXT,
      visit_type TEXT,
      source TEXT,
      token_no INTEGER,
      token_assignment_type TEXT,
      notes TEXT,
      updated_at TEXT
    );
    CREATE TABLE route_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      marker TEXT NOT NULL UNIQUE
    );
  `);
  sqlite.exec(readFileSync('migrations/0565_appointment_route_identity.sql', 'utf8'));

  const db: CanonicalBatchDatabase = {
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
  seed(sqlite);
  return { sqlite, db };
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
      tenant_id,practitioner_public_id,practitioner_kind,display_name,status,
      version,source_evidence_sha256
    ) VALUES
      ('tenant-a','practitioner-1','internal','Doctor One','active',1,?),
      ('tenant-a','practitioner-2','internal','Doctor Two','active',1,?)
  `).run('2'.repeat(64), '3'.repeat(64));
  sqlite.prepare(`INSERT INTO doctors (id,tenant_id,canonical_source_key,name) VALUES
    (1,'tenant-a','doctor-source-1','Doctor One'),
    (2,'tenant-a','doctor-source-2','Doctor Two')
  `).run();
  sqlite.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES
      ('tenant-a','practitioner','practitioner-1','legacy_doctor','doctor-source-1','doctors','mapped',1,?),
      ('tenant-a','practitioner','practitioner-2','legacy_doctor','doctor-source-2','doctors','mapped',1,?),
      ('tenant-a','encounter','encounter-501','legacy_visit','501','visits','mapped',1,?)
  `).run('4'.repeat(64), '5'.repeat(64), '6'.repeat(64));
  sqlite.prepare(`
    INSERT INTO canonical_encounters (
      tenant_id,encounter_public_id,legacy_patient_id,encounter_type,status,
      started_at_utc,source_evidence_sha256
    ) VALUES ('tenant-a','encounter-501',101,'outpatient','completed',?,?)
  `).run('2026-07-28T09:00:00.000Z', '7'.repeat(64));
  sqlite.prepare(`
    INSERT INTO appointments (
      id,tenant_id,patient_id,doctor_id,status,appt_date,appt_time,
      appointment_type,visit_type,source,token_no,token_assignment_type,notes
    ) VALUES (10,'tenant-a',101,1,'scheduled','2026-07-28','15:00',
      'new_patient','new_patient','reception',1,'auto','legacy note')
  `).run();
}

async function seedMappedAppointment(db: CanonicalBatchDatabase): Promise<void> {
  await createAppointmentIntent(db, {
    tenantId: 'tenant-a',
    appointmentPublicId: 'appointment-10',
    patientLinkPublicId: 'ptl-101',
    requestedPractitionerPublicId: 'practitioner-1',
    appointmentKind: 'new_patient',
    modality: 'in_person',
    schedulingChannel: 'reception',
    requestedStartUtc: '2026-07-28T09:00:00.000Z',
    requestedEndUtc: '2026-07-28T09:30:00.000Z',
    businessDate: '2026-07-28',
    timezone: 'Asia/Dhaka',
    tokenNumber: 1,
    tokenAssignmentType: 'auto',
    initialStatus: 'scheduled',
    sourceType: 'legacy_appointment',
    sourcePublicId: '10',
    sourceTable: 'appointments',
    sourceEvidenceSha256: '8'.repeat(64),
    actorSystemKey: 'canonical.appointment.test',
    idempotencyKey: 'seed-appointment-10',
    occurredAtUtc: '2026-07-28T08:00:00.000Z',
  });
}

describe('appointment route integration', () => {
  it('bootstraps an unmapped appointment and transitions legacy plus Canonical status atomically', async () => {
    const { sqlite, db } = harness();
    try {
      const context = await buildAppointmentRouteContext(db, {
        tenantId: 'tenant-a',
        legacyAppointmentId: 10,
      });
      expect(context.mapped).toBe(false);
      await expect(transitionRouteAppointment(db, context, {
        toStatus: 'checked_in',
        authoritativeStatements: [
          db.prepare(`UPDATE appointments SET status='checked_in',canonical_source_key=COALESCE(canonical_source_key,?) WHERE id=10 AND tenant_id='tenant-a'`)
            .bind(context.sourcePublicId),
          db.prepare(`INSERT INTO route_audit(marker) VALUES ('check-in-10')`),
        ],
        actorSystemKey: 'canonical.appointment.route',
        occurredAtUtc: '2026-07-28T09:00:00.000Z',
        businessDate: '2026-07-28',
        idempotencyKey: 'route:appointment:check-in:10',
        reasonCode: 'queue_check_in',
      })).resolves.toMatchObject({
        status: 'applied',
        result: { currentStatus: 'checked_in', statusVersion: 1 },
      });
      expect(sqlite.prepare(`SELECT status,canonical_source_key FROM appointments WHERE id=10`).get()).toEqual({
        status: 'checked_in',
        canonical_source_key: '10',
      });
      expect(sqlite.prepare(`SELECT current_status,status_version FROM canonical_appointments`).get()).toEqual({
        current_status: 'checked_in',
        status_version: 1,
      });
      expect(sqlite.prepare(`SELECT source_public_id,mapping_status FROM canonical_source_mappings WHERE entity_type='appointment'`).get()).toEqual({
        source_public_id: '10',
        mapping_status: 'mapped',
      });

      const replayContext = await buildAppointmentRouteContext(db, {
        tenantId: 'tenant-a',
        legacyAppointmentId: 10,
      });
      expect(replayContext.mapped).toBe(true);
      await expect(transitionRouteAppointment(db, replayContext, {
        toStatus: 'checked_in',
        authoritativeStatements: [],
        actorSystemKey: 'canonical.appointment.route',
        occurredAtUtc: '2026-07-28T09:05:00.000Z',
        businessDate: '2026-07-28',
        idempotencyKey: 'route:appointment:check-in:10',
        reasonCode: 'queue_check_in',
      })).resolves.toMatchObject({ status: 'replayed' });
      await expect(transitionRouteAppointment(db, replayContext, {
        toStatus: 'no_show',
        authoritativeStatements: [],
        actorSystemKey: 'canonical.appointment.route',
        occurredAtUtc: '2026-07-28T09:06:00.000Z',
        businessDate: '2026-07-28',
        idempotencyKey: 'route:appointment:check-in:10',
        reasonCode: 'queue_no_show',
      })).rejects.toBeInstanceOf(CanonicalIdempotencyConflictError);
    } finally {
      sqlite.close();
    }
  });

  it('fulfils a mapped appointment with exact encounter evidence in the same compatibility batch', async () => {
    const { sqlite, db } = harness();
    try {
      await seedMappedAppointment(db);
      const context = await buildAppointmentRouteContext(db, {
        tenantId: 'tenant-a',
        legacyAppointmentId: 10,
      });
      await fulfilRouteAppointment(db, context, {
        encounterPublicId: 'encounter-501',
        authoritativeStatements: [
          db.prepare(`UPDATE appointments SET status='completed' WHERE id=10 AND tenant_id='tenant-a'`),
          db.prepare(`INSERT INTO route_audit(marker) VALUES ('complete-10')`),
        ],
        actorSystemKey: 'canonical.appointment.route',
        occurredAtUtc: '2026-07-28T09:30:00.000Z',
        businessDate: '2026-07-28',
        idempotencyKey: 'route:appointment:complete:10',
        reasonCode: 'doctor_signed_encounter',
      });
      expect(sqlite.prepare(`SELECT status FROM appointments WHERE id=10`).get()).toEqual({ status: 'completed' });
      expect(sqlite.prepare(`SELECT current_status,status_version FROM canonical_appointments`).get()).toEqual({
        current_status: 'fulfilled',
        status_version: 2,
      });
      expect(sqlite.prepare(`SELECT encounter_public_id,link_status FROM canonical_appointment_encounter_links`).get()).toEqual({
        encounter_public_id: 'encounter-501',
        link_status: 'active',
      });
    } finally {
      sqlite.close();
    }
  });

  it('reassigns through immutable reschedule lineage and adopts a new exact source key', async () => {
    const { sqlite, db } = harness();
    try {
      await seedMappedAppointment(db);
      const context = await buildAppointmentRouteContext(db, {
        tenantId: 'tenant-a',
        legacyAppointmentId: 10,
      });
      await rescheduleRouteAppointment(db, context, {
        newSourcePublicId: 'appointment-route-reassign-10-v2',
        requestedPractitionerPublicId: 'practitioner-2',
        requestedStartUtc: context.requestedStartUtc,
        requestedEndUtc: context.requestedEndUtc,
        authoritativeStatements: [
          db.prepare(`UPDATE appointments SET doctor_id=2,canonical_source_key=? WHERE id=10 AND tenant_id='tenant-a'`)
            .bind('appointment-route-reassign-10-v2'),
          db.prepare(`INSERT INTO route_audit(marker) VALUES ('reassign-10')`),
        ],
        actorSystemKey: 'canonical.appointment.route',
        occurredAtUtc: '2026-07-28T08:30:00.000Z',
        businessDate: '2026-07-28',
        idempotencyKey: 'route:appointment:reassign:10:v2',
        reasonCode: 'doctor_reassigned',
      });
      expect(sqlite.prepare(`SELECT doctor_id,canonical_source_key FROM appointments WHERE id=10`).get()).toEqual({
        doctor_id: 2,
        canonical_source_key: 'appointment-route-reassign-10-v2',
      });
      expect(sqlite.prepare(`
        SELECT current_status,requested_practitioner_public_id,rescheduled_from_appointment_public_id
        FROM canonical_appointments ORDER BY id DESC LIMIT 1
      `).get()).toEqual({
        current_status: 'scheduled',
        requested_practitioner_public_id: 'practitioner-2',
        rescheduled_from_appointment_public_id: 'appointment-10',
      });
    } finally {
      sqlite.close();
    }
  });

  it('rolls back legacy, audit, Canonical, mapping and outbox facts when compatibility fails', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.prepare(`INSERT INTO route_audit(marker) VALUES ('duplicate')`).run();
      const context = await buildAppointmentRouteContext(db, {
        tenantId: 'tenant-a',
        legacyAppointmentId: 10,
      });
      await expect(transitionRouteAppointment(db, context, {
        toStatus: 'no_show',
        authoritativeStatements: [
          db.prepare(`UPDATE appointments SET status='no_show' WHERE id=10 AND tenant_id='tenant-a'`),
          db.prepare(`INSERT INTO route_audit(marker) VALUES ('duplicate')`),
        ],
        actorSystemKey: 'canonical.appointment.route',
        occurredAtUtc: '2026-07-28T09:00:00.000Z',
        businessDate: '2026-07-28',
        idempotencyKey: 'route:appointment:no-show:10',
        reasonCode: 'queue_no_show',
      })).rejects.toThrow();
      expect(sqlite.prepare(`SELECT status FROM appointments WHERE id=10`).get()).toEqual({ status: 'scheduled' });
      expect(Number((sqlite.prepare(`SELECT COUNT(*) count FROM canonical_appointments`).get() as { count: number }).count)).toBe(0);
      expect(Number((sqlite.prepare(`SELECT COUNT(*) count FROM canonical_source_mappings WHERE entity_type='appointment'`).get() as { count: number }).count)).toBe(0);
      expect(Number((sqlite.prepare(`SELECT COUNT(*) count FROM canonical_outbox_events`).get() as { count: number }).count)).toBe(0);
    } finally {
      sqlite.close();
    }
  });
});
