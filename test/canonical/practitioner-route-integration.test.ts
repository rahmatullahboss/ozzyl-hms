import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import { CanonicalIdempotencyConflictError } from '../../src/lib/canonical/idempotency';
import {
  buildPractitionerRouteContext,
  createRoutePractitioner,
  practitionerIdentityChanged,
  updateRoutePractitioner,
  type LegacyDoctorPractitionerSnapshot,
} from '../../src/lib/canonical/practitioner-route-integration';

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
  sqlite.exec(readFileSync('migrations/0505_canonical_program_foundation.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0506_canonical_practitioners.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0545_canonical_practitioner_operational_adoption.sql', 'utf8'));
  sqlite.exec(`
    CREATE TABLE doctors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      specialty TEXT,
      department TEXT,
      bmdc_reg_no TEXT,
      user_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE route_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      marker TEXT NOT NULL UNIQUE
    );
  `);
  sqlite.exec(readFileSync('migrations/0563_practitioner_route_identity.sql', 'utf8'));

  const db: CanonicalBatchDatabase = {
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
  return { sqlite, db };
}

const snapshot: LegacyDoctorPractitionerSnapshot = {
  name: 'Dr Example',
  specialty: 'Cardiology',
  department: 'Medicine',
  bmdcRegNo: 'A-101',
  userId: 501,
  isActive: true,
};

function count(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as { count: number }).count);
}

describe('practitioner route integration', () => {
  it('treats a display-only doctor name change as a Canonical projection change', () => {
    expect(practitionerIdentityChanged(snapshot, {
      ...snapshot,
      name: 'DR EXAMPLE',
    })).toBe(true);
  });

  it('updates classification display without creating a second normalized identity', async () => {
    const { sqlite, db } = harness();
    try {
      const sourcePublicId = 'docsrc_route_display';
      const original = await buildPractitionerRouteContext(db, {
        tenantId: 'tenant-a',
        sourcePublicId,
        snapshot,
      });
      await createRoutePractitioner(db, original, {
        authoritativeStatements: [
          db.prepare(`
            INSERT INTO doctors (
              tenant_id,name,specialty,department,bmdc_reg_no,user_id,is_active,canonical_source_key
            ) VALUES (?,?,?,?,?,?,?,?)
          `).bind(
            'tenant-a', snapshot.name, snapshot.specialty, snapshot.department,
            snapshot.bmdcRegNo, snapshot.userId, 1, sourcePublicId,
          ),
          db.prepare(`INSERT INTO route_audit(marker) VALUES (?)`).bind('create-display'),
        ],
        occurredAtUtc: '2026-07-28T14:00:00.000Z',
        businessDate: '2026-07-28',
        idempotencyKey: 'route:doctor:create:display',
      });
      const nextSnapshot = { ...snapshot, specialty: 'CARDIOLOGY', department: 'MEDICINE' };
      const next = await buildPractitionerRouteContext(db, {
        tenantId: 'tenant-a',
        sourcePublicId,
        snapshot: nextSnapshot,
      });
      await updateRoutePractitioner(db, original, next, {
        authoritativeStatements: [
          db.prepare(`UPDATE doctors SET specialty=?,department=? WHERE canonical_source_key=?`)
            .bind(nextSnapshot.specialty, nextSnapshot.department, sourcePublicId),
          db.prepare(`INSERT INTO route_audit(marker) VALUES (?)`).bind('update-display'),
        ],
        occurredAtUtc: '2026-07-28T14:05:00.000Z',
        businessDate: '2026-07-28',
        idempotencyKey: 'route:doctor:update:display',
      });
      expect(sqlite.prepare(`
        SELECT normalized_key,display_text,is_primary FROM canonical_practitioner_specialties
      `).all()).toEqual([{ normalized_key: 'cardiology', display_text: 'CARDIOLOGY', is_primary: 1 }]);
      expect(sqlite.prepare(`
        SELECT normalized_key,display_text,is_primary FROM canonical_practitioner_departments
      `).all()).toEqual([{ normalized_key: 'medicine', display_text: 'MEDICINE', is_primary: 1 }]);
    } finally {
      sqlite.close();
    }
  });

  it('atomically creates the legacy doctor, audit, Canonical identity, account link, mapping and outbox with replay protection', async () => {
    const { sqlite, db } = harness();
    try {
      const context = await buildPractitionerRouteContext(db, {
        tenantId: 'tenant-a',
        sourcePublicId: 'docsrc_route_101',
        snapshot,
      });
      const execution = {
        authoritativeStatements: [
          db.prepare(`
            INSERT INTO doctors (
              tenant_id,name,specialty,department,bmdc_reg_no,user_id,is_active,canonical_source_key
            ) VALUES (?,?,?,?,?,?,?,?)
          `).bind(
            'tenant-a', snapshot.name, snapshot.specialty, snapshot.department,
            snapshot.bmdcRegNo, snapshot.userId, 1, 'docsrc_route_101',
          ),
          db.prepare(`INSERT INTO route_audit(marker) VALUES (?)`).bind('create-101'),
        ],
        occurredAtUtc: '2026-07-28T15:00:00.000Z',
        businessDate: '2026-07-28',
        idempotencyKey: 'route:doctor:create:101',
      };

      await expect(createRoutePractitioner(db, context, execution)).resolves.toMatchObject({
        status: 'applied',
        result: { status: 'active', version: 1 },
      });
      expect(count(sqlite, 'doctors')).toBe(1);
      expect(count(sqlite, 'route_audit')).toBe(1);
      expect(count(sqlite, 'canonical_practitioners')).toBe(1);
      expect(count(sqlite, 'canonical_practitioner_user_links')).toBe(1);
      expect(count(sqlite, 'canonical_practitioner_identifiers')).toBe(1);
      expect(count(sqlite, 'canonical_practitioner_specialties')).toBe(1);
      expect(count(sqlite, 'canonical_practitioner_departments')).toBe(1);
      expect(count(sqlite, 'canonical_source_mappings')).toBe(1);
      expect(count(sqlite, 'canonical_outbox_events')).toBe(1);

      await expect(createRoutePractitioner(db, context, {
        ...execution,
        occurredAtUtc: '2026-07-28T15:05:00.000Z',
      })).resolves.toMatchObject({
        status: 'replayed',
        result: { status: 'active', version: 1 },
      });
      expect(count(sqlite, 'doctors')).toBe(1);
      expect(count(sqlite, 'route_audit')).toBe(1);
      expect(count(sqlite, 'canonical_outbox_events')).toBe(1);

      const changedContext = await buildPractitionerRouteContext(db, {
        tenantId: 'tenant-a',
        sourcePublicId: 'docsrc_route_101',
        snapshot: { ...snapshot, name: 'Dr Changed' },
      });
      await expect(createRoutePractitioner(db, changedContext, execution))
        .rejects.toBeInstanceOf(CanonicalIdempotencyConflictError);
    } finally {
      sqlite.close();
    }
  });

  it('updates exact identity evidence and retires the linked account when the doctor is deactivated', async () => {
    const { sqlite, db } = harness();
    try {
      const sourcePublicId = 'docsrc_route_202';
      const original = await buildPractitionerRouteContext(db, {
        tenantId: 'tenant-a',
        sourcePublicId,
        snapshot,
      });
      await createRoutePractitioner(db, original, {
        authoritativeStatements: [
          db.prepare(`
            INSERT INTO doctors (
              tenant_id,name,specialty,department,bmdc_reg_no,user_id,is_active,canonical_source_key
            ) VALUES (?,?,?,?,?,?,?,?)
          `).bind(
            'tenant-a', snapshot.name, snapshot.specialty, snapshot.department,
            snapshot.bmdcRegNo, snapshot.userId, 1, sourcePublicId,
          ),
          db.prepare(`INSERT INTO route_audit(marker) VALUES (?)`).bind('create-202'),
        ],
        occurredAtUtc: '2026-07-28T15:10:00.000Z',
        businessDate: '2026-07-28',
        idempotencyKey: 'route:doctor:create:202',
      });

      const editedSnapshot: LegacyDoctorPractitionerSnapshot = {
        ...snapshot,
        name: 'Dr Example Updated',
        specialty: 'Neurology',
        department: 'Neuroscience',
        bmdcRegNo: 'B-202',
      };
      const edited = await buildPractitionerRouteContext(db, {
        tenantId: 'tenant-a',
        sourcePublicId,
        snapshot: editedSnapshot,
      });
      await updateRoutePractitioner(db, original, edited, {
        authoritativeStatements: [
          db.prepare(`
            UPDATE doctors
            SET name=?,specialty=?,department=?,bmdc_reg_no=?
            WHERE tenant_id=? AND canonical_source_key=?
          `).bind(
            editedSnapshot.name, editedSnapshot.specialty, editedSnapshot.department,
            editedSnapshot.bmdcRegNo, 'tenant-a', sourcePublicId,
          ),
          db.prepare(`INSERT INTO route_audit(marker) VALUES (?)`).bind('update-202'),
        ],
        occurredAtUtc: '2026-07-28T15:20:00.000Z',
        businessDate: '2026-07-28',
        idempotencyKey: 'route:doctor:update:202',
      });

      expect(sqlite.prepare(`
        SELECT display_name,status,version FROM canonical_practitioners
      `).get()).toEqual({
        display_name: 'Dr Example Updated',
        status: 'active',
        version: 2,
      });
      expect(sqlite.prepare(`
        SELECT normalized_value,verification_status
        FROM canonical_practitioner_identifiers ORDER BY id
      `).all()).toEqual([
        { normalized_value: 'A101', verification_status: 'retired' },
        { normalized_value: 'B202', verification_status: 'unverified' },
      ]);
      expect(sqlite.prepare(`
        SELECT normalized_key,is_primary FROM canonical_practitioner_specialties ORDER BY id
      `).all()).toEqual([
        { normalized_key: 'cardiology', is_primary: 0 },
        { normalized_key: 'neurology', is_primary: 1 },
      ]);
      expect(sqlite.prepare(`
        SELECT normalized_key,is_primary FROM canonical_practitioner_departments ORDER BY id
      `).all()).toEqual([
        { normalized_key: 'medicine', is_primary: 0 },
        { normalized_key: 'neuroscience', is_primary: 1 },
      ]);

      const inactiveSnapshot = { ...editedSnapshot, isActive: false };
      const inactive = await buildPractitionerRouteContext(db, {
        tenantId: 'tenant-a',
        sourcePublicId,
        snapshot: inactiveSnapshot,
      });
      await updateRoutePractitioner(db, edited, inactive, {
        authoritativeStatements: [
          db.prepare(`
            UPDATE doctors SET is_active=0
            WHERE tenant_id=? AND canonical_source_key=?
          `).bind('tenant-a', sourcePublicId),
          db.prepare(`INSERT INTO route_audit(marker) VALUES (?)`).bind('deactivate-202'),
        ],
        occurredAtUtc: '2026-07-28T15:30:00.000Z',
        businessDate: '2026-07-28',
        idempotencyKey: 'route:doctor:deactivate:202',
      });

      expect(sqlite.prepare(`
        SELECT status,version FROM canonical_practitioners
      `).get()).toEqual({ status: 'inactive', version: 3 });
      expect(sqlite.prepare(`
        SELECT link_status FROM canonical_practitioner_user_links
      `).get()).toEqual({ link_status: 'retired' });
      expect(sqlite.prepare(`
        SELECT is_active FROM doctors WHERE canonical_source_key=?
      `).get(sourcePublicId)).toEqual({ is_active: 0 });
      expect(count(sqlite, 'route_audit')).toBe(3);
      expect(count(sqlite, 'canonical_outbox_events')).toBe(3);
    } finally {
      sqlite.close();
    }
  });

  it('bootstraps an existing unmapped doctor from its exact source id in the same update batch', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.prepare(`
        INSERT INTO doctors (id,tenant_id,name,specialty,department,bmdc_reg_no,user_id,is_active)
        VALUES (5,'tenant-a','Dr Legacy','Surgery','Surgical','L-5',NULL,1)
      `).run();
      const currentSnapshot: LegacyDoctorPractitionerSnapshot = {
        name: 'Dr Legacy',
        specialty: 'Surgery',
        department: 'Surgical',
        bmdcRegNo: 'L-5',
        userId: null,
        isActive: true,
      };
      const nextSnapshot = { ...currentSnapshot, name: 'Dr Legacy Updated' };
      const current = await buildPractitionerRouteContext(db, {
        tenantId: 'tenant-a',
        sourcePublicId: '5',
        snapshot: currentSnapshot,
      });
      const next = await buildPractitionerRouteContext(db, {
        tenantId: 'tenant-a',
        sourcePublicId: '5',
        snapshot: nextSnapshot,
      });
      await updateRoutePractitioner(db, current, next, {
        authoritativeStatements: [
          db.prepare(`
            UPDATE doctors SET name=?,canonical_source_key=COALESCE(canonical_source_key,?)
            WHERE tenant_id=? AND id=5
          `).bind(nextSnapshot.name, '5', 'tenant-a'),
          db.prepare(`INSERT INTO route_audit(marker) VALUES (?)`).bind('bootstrap-5'),
        ],
        occurredAtUtc: '2026-07-28T15:40:00.000Z',
        businessDate: '2026-07-28',
        idempotencyKey: 'route:doctor:bootstrap:5',
      });

      expect(sqlite.prepare(`
        SELECT display_name,status,version FROM canonical_practitioners
      `).get()).toEqual({
        display_name: 'Dr Legacy Updated',
        status: 'active',
        version: 1,
      });
      expect(sqlite.prepare(`
        SELECT source_public_id,mapping_status FROM canonical_source_mappings
      `).get()).toEqual({ source_public_id: '5', mapping_status: 'mapped' });
      expect(sqlite.prepare(`SELECT canonical_source_key,name FROM doctors WHERE id=5`).get()).toEqual({
        canonical_source_key: '5',
        name: 'Dr Legacy Updated',
      });
    } finally {
      sqlite.close();
    }
  });

  it('rolls back every legacy, audit, Canonical, mapping and outbox statement on failure', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.prepare(`INSERT INTO route_audit(marker) VALUES ('duplicate')`).run();
      const context = await buildPractitionerRouteContext(db, {
        tenantId: 'tenant-a',
        sourcePublicId: 'docsrc_route_rollback',
        snapshot,
      });
      await expect(createRoutePractitioner(db, context, {
        authoritativeStatements: [
          db.prepare(`
            INSERT INTO doctors (
              tenant_id,name,specialty,department,bmdc_reg_no,user_id,is_active,canonical_source_key
            ) VALUES (?,?,?,?,?,?,?,?)
          `).bind(
            'tenant-a', snapshot.name, snapshot.specialty, snapshot.department,
            snapshot.bmdcRegNo, snapshot.userId, 1, 'docsrc_route_rollback',
          ),
          db.prepare(`INSERT INTO route_audit(marker) VALUES ('duplicate')`),
        ],
        occurredAtUtc: '2026-07-28T15:50:00.000Z',
        businessDate: '2026-07-28',
        idempotencyKey: 'route:doctor:create:rollback',
      })).rejects.toThrow();

      expect(count(sqlite, 'doctors')).toBe(0);
      expect(count(sqlite, 'route_audit')).toBe(1);
      expect(count(sqlite, 'canonical_practitioners')).toBe(0);
      expect(count(sqlite, 'canonical_source_mappings')).toBe(0);
      expect(count(sqlite, 'canonical_outbox_events')).toBe(0);
    } finally {
      sqlite.close();
    }
  });
});
