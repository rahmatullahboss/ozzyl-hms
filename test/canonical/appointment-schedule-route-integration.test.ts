import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import { CanonicalIdempotencyConflictError } from '../../src/lib/canonical/idempotency';
import {
  buildAppointmentScheduleRouteContext,
  createAppointmentScheduleSourceKey,
  recordAppointmentScheduleExtension,
  type AppointmentScheduleSnapshot,
} from '../../src/lib/canonical/appointment-schedule-route-integration';

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
}

function harness(): { sqlite: DatabaseSync; db: CanonicalBatchDatabase } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const migration of [
    'migrations/0505_canonical_program_foundation.sql',
    'migrations/0506_canonical_practitioners.sql',
  ]) sqlite.exec(readFileSync(migration, 'utf8'));
  sqlite.exec(`
    CREATE TABLE doctors (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      canonical_source_key TEXT,
      name TEXT NOT NULL
    );
    CREATE TABLE doctor_schedules (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      doctor_id INTEGER NOT NULL,
      day_of_week TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      session_type TEXT NOT NULL,
      chamber TEXT,
      max_patients INTEGER NOT NULL,
      notes TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      marker TEXT NOT NULL UNIQUE
    );
  `);
  sqlite.exec(readFileSync('migrations/0566_appointment_schedule_route_identity.sql', 'utf8'));

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
    INSERT INTO doctors (id,tenant_id,canonical_source_key,name)
    VALUES (1,'tenant-a','doctor-source-1','Doctor One')
  `).run();
  sqlite.prepare(`
    INSERT INTO canonical_practitioners (
      tenant_id,practitioner_public_id,practitioner_kind,display_name,status
    ) VALUES ('tenant-a','practitioner-1','internal','Doctor One','active')
  `).run();
  sqlite.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES ('tenant-a','practitioner','practitioner-1','legacy_doctor',
      'doctor-source-1','doctors','mapped',1,?)
  `).run('2'.repeat(64));
}

function snapshot(overrides: Partial<AppointmentScheduleSnapshot> = {}): AppointmentScheduleSnapshot {
  return {
    doctorId: 1,
    dayOfWeek: 'mon',
    startTime: '09:00',
    endTime: '13:00',
    sessionType: 'morning',
    chamber: 'A-1',
    maxPatients: 20,
    notes: 'Morning OPD',
    isActive: true,
    ...overrides,
  };
}

function count(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
}

describe('appointment schedule route integration', () => {
  it('creates legacy schedule, audit, exact practitioner-linked mapping and outbox atomically', async () => {
    const { sqlite, db } = harness();
    try {
      const sourcePublicId = await createAppointmentScheduleSourceKey('tenant-a', 'create-schedule-10');
      const context = await buildAppointmentScheduleRouteContext(db, {
        tenantId: 'tenant-a',
        sourcePublicId,
        doctorId: 1,
      });
      expect(context).toMatchObject({
        mapped: false,
        mappingVersion: 0,
        practitionerPublicId: 'practitioner-1',
      });
      const input = {
        context,
        operation: 'create' as const,
        snapshot: snapshot(),
        authoritativeStatements: [
          db.prepare(`
            INSERT INTO doctor_schedules (
              id,tenant_id,doctor_id,day_of_week,start_time,end_time,session_type,
              chamber,max_patients,notes,is_active,canonical_source_key
            ) VALUES (10,'tenant-a',1,'mon','09:00','13:00','morning','A-1',20,'Morning OPD',1,?)
          `).bind(sourcePublicId),
          db.prepare(`INSERT INTO audit_logs(marker) VALUES ('schedule-create-10')`),
        ],
        actorUserPublicId: 'user-1',
        actorSystemKey: 'canonical.appointment.schedule-route',
        idempotencyKey: 'schedule-create-10',
        occurredAtUtc: '2026-07-29T01:00:00.000Z',
        businessDate: '2026-07-29',
      };
      await expect(recordAppointmentScheduleExtension(db, input)).resolves.toMatchObject({
        status: 'applied',
        result: { operation: 'create', mappingVersion: 1, status: 'active' },
      });
      expect(sqlite.prepare(`
        SELECT doctor_id,canonical_source_key,is_active FROM doctor_schedules WHERE id=10
      `).get()).toEqual({ doctor_id: 1, canonical_source_key: sourcePublicId, is_active: 1 });
      expect(sqlite.prepare(`
        SELECT entity_type,canonical_public_id,source_public_id,mapping_status,mapping_version
        FROM canonical_source_mappings
        WHERE entity_type='appointment_schedule_extension'
      `).get()).toEqual({
        entity_type: 'appointment_schedule_extension',
        canonical_public_id: context.extensionPublicId,
        source_public_id: sourcePublicId,
        mapping_status: 'mapped',
        mapping_version: 1,
      });
      expect(count(sqlite, 'audit_logs')).toBe(1);
      expect(count(sqlite, 'canonical_outbox_events')).toBe(1);

      const replayContext = await buildAppointmentScheduleRouteContext(db, {
        tenantId: 'tenant-a', sourcePublicId, doctorId: 1,
      });
      await expect(recordAppointmentScheduleExtension(db, {
        ...input,
        context: replayContext,
        authoritativeStatements: [],
        occurredAtUtc: '2026-07-29T01:05:00.000Z',
      })).resolves.toMatchObject({ status: 'replayed' });
      await expect(recordAppointmentScheduleExtension(db, {
        ...input,
        context: replayContext,
        authoritativeStatements: [],
        snapshot: snapshot({ maxPatients: 25 }),
      })).rejects.toBeInstanceOf(CanonicalIdempotencyConflictError);
    } finally {
      sqlite.close();
    }
  });

  it('updates then retires the same extension with immutable versioned evidence', async () => {
    const { sqlite, db } = harness();
    try {
      const sourcePublicId = await createAppointmentScheduleSourceKey('tenant-a', 'schedule-20');
      const createContext = await buildAppointmentScheduleRouteContext(db, {
        tenantId: 'tenant-a', sourcePublicId, doctorId: 1,
      });
      await recordAppointmentScheduleExtension(db, {
        context: createContext,
        operation: 'create',
        snapshot: snapshot(),
        authoritativeStatements: [
          db.prepare(`
            INSERT INTO doctor_schedules (
              id,tenant_id,doctor_id,day_of_week,start_time,end_time,session_type,
              chamber,max_patients,notes,is_active,canonical_source_key
            ) VALUES (20,'tenant-a',1,'mon','09:00','13:00','morning','A-1',20,'Morning OPD',1,?)
          `).bind(sourcePublicId),
        ],
        actorSystemKey: 'canonical.appointment.schedule-route',
        idempotencyKey: 'schedule-create-20',
        occurredAtUtc: '2026-07-29T01:00:00.000Z',
        businessDate: '2026-07-29',
      });

      const updateContext = await buildAppointmentScheduleRouteContext(db, {
        tenantId: 'tenant-a', sourcePublicId, doctorId: 1,
      });
      await recordAppointmentScheduleExtension(db, {
        context: updateContext,
        operation: 'update',
        snapshot: snapshot({ endTime: '14:00', maxPatients: 25 }),
        authoritativeStatements: [
          db.prepare(`UPDATE doctor_schedules SET end_time='14:00',max_patients=25 WHERE id=20`),
        ],
        actorSystemKey: 'canonical.appointment.schedule-route',
        idempotencyKey: 'schedule-update-20-v2',
        occurredAtUtc: '2026-07-29T01:10:00.000Z',
        businessDate: '2026-07-29',
      });

      const retireContext = await buildAppointmentScheduleRouteContext(db, {
        tenantId: 'tenant-a', sourcePublicId, doctorId: 1,
      });
      await recordAppointmentScheduleExtension(db, {
        context: retireContext,
        operation: 'retire',
        snapshot: snapshot({ endTime: '14:00', maxPatients: 25, isActive: false }),
        authoritativeStatements: [
          db.prepare(`UPDATE doctor_schedules SET is_active=0 WHERE id=20`),
        ],
        actorSystemKey: 'canonical.appointment.schedule-route',
        idempotencyKey: 'schedule-retire-20-v3',
        occurredAtUtc: '2026-07-29T01:20:00.000Z',
        businessDate: '2026-07-29',
      });

      expect(sqlite.prepare(`
        SELECT mapping_status,mapping_version FROM canonical_source_mappings
        WHERE entity_type='appointment_schedule_extension'
      `).get()).toEqual({ mapping_status: 'retired', mapping_version: 3 });
      expect(sqlite.prepare(`SELECT end_time,max_patients,is_active FROM doctor_schedules WHERE id=20`).get())
        .toEqual({ end_time: '14:00', max_patients: 25, is_active: 0 });
      expect(count(sqlite, 'canonical_outbox_events')).toBe(3);
    } finally {
      sqlite.close();
    }
  });

  it('rolls back legacy schedule, audit, mapping and outbox when compatibility fails', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.prepare(`INSERT INTO audit_logs(marker) VALUES ('duplicate')`).run();
      const sourcePublicId = await createAppointmentScheduleSourceKey('tenant-a', 'schedule-rollback');
      const context = await buildAppointmentScheduleRouteContext(db, {
        tenantId: 'tenant-a', sourcePublicId, doctorId: 1,
      });
      await expect(recordAppointmentScheduleExtension(db, {
        context,
        operation: 'create',
        snapshot: snapshot(),
        authoritativeStatements: [
          db.prepare(`
            INSERT INTO doctor_schedules (
              id,tenant_id,doctor_id,day_of_week,start_time,end_time,session_type,
              chamber,max_patients,notes,is_active,canonical_source_key
            ) VALUES (30,'tenant-a',1,'mon','09:00','13:00','morning','A-1',20,'Morning OPD',1,?)
          `).bind(sourcePublicId),
          db.prepare(`INSERT INTO audit_logs(marker) VALUES ('duplicate')`),
        ],
        actorSystemKey: 'canonical.appointment.schedule-route',
        idempotencyKey: 'schedule-rollback',
        occurredAtUtc: '2026-07-29T01:00:00.000Z',
        businessDate: '2026-07-29',
      })).rejects.toThrow();
      expect(count(sqlite, 'doctor_schedules')).toBe(0);
      expect(Number((sqlite.prepare(`
        SELECT COUNT(*) AS count FROM canonical_source_mappings
        WHERE entity_type='appointment_schedule_extension'
      `).get() as { count: number }).count)).toBe(0);
      expect(count(sqlite, 'canonical_outbox_events')).toBe(0);
    } finally {
      sqlite.close();
    }
  });
});
