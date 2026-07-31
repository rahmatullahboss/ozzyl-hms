import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import { CanonicalIdempotencyConflictError } from '../../src/lib/canonical/idempotency';
import {
  buildPatientImportRouteContext,
  createImportedPatient,
} from '../../src/lib/canonical/patient-import-route-integration';

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
  sqlite.exec(readFileSync('migrations/0544_canonical_tenant_patient_links.sql', 'utf8'));
  sqlite.exec(`
    CREATE TABLE patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      father_husband TEXT NOT NULL,
      address TEXT NOT NULL,
      mobile TEXT,
      gender TEXT,
      date_of_birth TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      table_name TEXT NOT NULL,
      record_id TEXT,
      old_value TEXT,
      new_value TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL
    );
  `);
  sqlite.exec(readFileSync('migrations/0564_patient_import_route_identity.sql', 'utf8'));

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
  return { sqlite, db };
}

const row = {
  name: 'Imported Patient',
  mobile: '01700000001',
  fatherHusband: 'Guardian',
  address: 'Dhaka',
  gender: 'male',
  dateOfBirth: '1990-01-01',
};

describe('patient import route integration', () => {
  it('atomically creates the legacy patient, audit, unlinked Canonical relationship, mapping and outbox', async () => {
    const { sqlite, db } = harness();
    try {
      const context = await buildPatientImportRouteContext(db, {
        tenantId: 'tenant-a',
        sourcePublicId: 'patient-import:file-1:row-2',
        row,
      });
      const legacyInsert = db.prepare(`
        INSERT INTO patients (
          id,name,mobile,father_husband,address,gender,date_of_birth,tenant_id,canonical_source_key
        ) VALUES (?,?,?,?,?,?,?,?,?)
      `).bind(
        context.legacyPatientId,
        row.name,
        row.mobile,
        row.fatherHusband,
        row.address,
        row.gender,
        row.dateOfBirth,
        'tenant-a',
        context.sourcePublicId,
      );
      const audit = db.prepare(`
        INSERT INTO audit_logs (
          tenant_id,user_id,action,table_name,record_id,old_value,new_value,ip_address,user_agent,created_at
        ) VALUES ('tenant-a',42,'CREATE','patients',?,NULL,'{}',NULL,NULL,'2026-07-28T17:30:00.000Z')
      `).bind(context.sourcePublicId);

      await expect(createImportedPatient(db, context, {
        authoritativeStatements: [legacyInsert, audit],
        actorUserId: 42,
        occurredAtUtc: '2026-07-28T17:30:00.000Z',
        businessDate: '2026-07-28',
        idempotencyKey: 'route:patient-import:file-1:row-2',
      })).resolves.toMatchObject({ status: 'applied' });

      expect(sqlite.prepare(`
        SELECT id,canonical_source_key,name,mobile FROM patients
      `).get()).toEqual({
        id: context.legacyPatientId,
        canonical_source_key: context.sourcePublicId,
        name: row.name,
        mobile: row.mobile,
      });
      expect(sqlite.prepare(`
        SELECT legacy_patient_id,global_patient_uhid,link_status,verification_level,evidence_type
        FROM canonical_tenant_patient_links
      `).get()).toEqual({
        legacy_patient_id: context.legacyPatientId,
        global_patient_uhid: null,
        link_status: 'unlinked',
        verification_level: 'unverified',
        evidence_type: 'no_link_placeholder',
      });
      expect(sqlite.prepare(`
        SELECT source_type,source_public_id,mapping_status
        FROM canonical_source_mappings WHERE entity_type='patient_link'
      `).get()).toEqual({
        source_type: 'settings_patient_import',
        source_public_id: context.sourcePublicId,
        mapping_status: 'mapped',
      });
      expect(Number((sqlite.prepare(`SELECT COUNT(*) count FROM audit_logs`).get() as { count: number }).count)).toBe(1);
      expect(Number((sqlite.prepare(`SELECT COUNT(*) count FROM canonical_outbox_events`).get() as { count: number }).count)).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it('replays the exact imported row without duplicating data even when the retry timestamp changes', async () => {
    const { sqlite, db } = harness();
    try {
      const context = await buildPatientImportRouteContext(db, {
        tenantId: 'tenant-a',
        sourcePublicId: 'patient-import:file-2:row-2',
        row,
      });
      const statements = () => [db.prepare(`
        INSERT INTO patients (
          id,name,mobile,father_husband,address,gender,date_of_birth,tenant_id,canonical_source_key
        ) VALUES (?,?,?,?,?,?,?,?,?)
      `).bind(
        context.legacyPatientId, row.name, row.mobile, row.fatherHusband, row.address,
        row.gender, row.dateOfBirth, 'tenant-a', context.sourcePublicId,
      )];
      const execution = {
        authoritativeStatements: statements(),
        actorUserId: 42,
        occurredAtUtc: '2026-07-28T17:31:00.000Z',
        businessDate: '2026-07-28',
        idempotencyKey: 'route:patient-import:file-2:row-2',
      };
      await createImportedPatient(db, context, execution);
      await expect(createImportedPatient(db, context, {
        ...execution,
        authoritativeStatements: statements(),
        occurredAtUtc: '2026-07-28T17:32:00.000Z',
      })).resolves.toMatchObject({ status: 'replayed' });
      expect(Number((sqlite.prepare(`SELECT COUNT(*) count FROM patients`).get() as { count: number }).count)).toBe(1);
      expect(Number((sqlite.prepare(`SELECT COUNT(*) count FROM canonical_tenant_patient_links`).get() as { count: number }).count)).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it('does not silently merge a different import source that happens to share the same name and mobile', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.prepare(`
        INSERT INTO patients (id,tenant_id,name,father_husband,address,mobile,gender,canonical_source_key)
        VALUES (1,'tenant-a',?,?,?,?,?,'existing-source')
      `).run(row.name, row.fatherHusband, row.address, row.mobile, row.gender);
      const context = await buildPatientImportRouteContext(db, {
        tenantId: 'tenant-a',
        sourcePublicId: 'patient-import:file-3:row-2',
        row,
      });
      expect(context.legacyPatientId).toBe(2);
      expect(context.sourcePublicId).toBe('patient-import:file-3:row-2');
    } finally {
      sqlite.close();
    }
  });

  it('rejects changed semantic evidence under the same operation key', async () => {
    const { sqlite, db } = harness();
    try {
      const sourcePublicId = 'patient-import:file-4:row-2';
      const first = await buildPatientImportRouteContext(db, { tenantId: 'tenant-a', sourcePublicId, row });
      await createImportedPatient(db, first, {
        authoritativeStatements: [db.prepare(`
          INSERT INTO patients (
            id,name,mobile,father_husband,address,gender,date_of_birth,tenant_id,canonical_source_key
          ) VALUES (?,?,?,?,?,?,?,?,?)
        `).bind(
          first.legacyPatientId, row.name, row.mobile, row.fatherHusband, row.address,
          row.gender, row.dateOfBirth, 'tenant-a', sourcePublicId,
        )],
        actorUserId: 42,
        occurredAtUtc: '2026-07-28T17:33:00.000Z',
        businessDate: '2026-07-28',
        idempotencyKey: 'route:patient-import:file-4:row-2',
      });
      const changed = await buildPatientImportRouteContext(db, {
        tenantId: 'tenant-a',
        sourcePublicId,
        row: { ...row, address: 'Chattogram' },
      });
      await expect(createImportedPatient(db, changed, {
        authoritativeStatements: [],
        actorUserId: 42,
        occurredAtUtc: '2026-07-28T17:34:00.000Z',
        businessDate: '2026-07-28',
        idempotencyKey: 'route:patient-import:file-4:row-2',
      })).rejects.toBeInstanceOf(CanonicalIdempotencyConflictError);
    } finally {
      sqlite.close();
    }
  });

  it('rolls back the patient, relationship, mapping and outbox if audit compatibility fails', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.prepare(`
        CREATE UNIQUE INDEX uq_audit_marker ON audit_logs(tenant_id,record_id)
      `).run();
      sqlite.prepare(`
        INSERT INTO audit_logs (
          tenant_id,user_id,action,table_name,record_id,old_value,new_value,ip_address,user_agent,created_at
        ) VALUES ('tenant-a',42,'CREATE','patients','duplicate',NULL,'{}',NULL,NULL,'2026-07-28T17:35:00.000Z')
      `).run();
      const context = await buildPatientImportRouteContext(db, {
        tenantId: 'tenant-a',
        sourcePublicId: 'patient-import:file-5:row-2',
        row,
      });
      await expect(createImportedPatient(db, context, {
        authoritativeStatements: [
          db.prepare(`
            INSERT INTO patients (
              id,name,mobile,father_husband,address,gender,date_of_birth,tenant_id,canonical_source_key
            ) VALUES (?,?,?,?,?,?,?,?,?)
          `).bind(
            context.legacyPatientId, row.name, row.mobile, row.fatherHusband, row.address,
            row.gender, row.dateOfBirth, 'tenant-a', context.sourcePublicId,
          ),
          db.prepare(`
            INSERT INTO audit_logs (
              tenant_id,user_id,action,table_name,record_id,old_value,new_value,ip_address,user_agent,created_at
            ) VALUES ('tenant-a',42,'CREATE','patients','duplicate',NULL,'{}',NULL,NULL,'2026-07-28T17:35:00.000Z')
          `),
        ],
        actorUserId: 42,
        occurredAtUtc: '2026-07-28T17:35:00.000Z',
        businessDate: '2026-07-28',
        idempotencyKey: 'route:patient-import:file-5:row-2',
      })).rejects.toThrow();
      expect(Number((sqlite.prepare(`SELECT COUNT(*) count FROM patients`).get() as { count: number }).count)).toBe(0);
      expect(Number((sqlite.prepare(`SELECT COUNT(*) count FROM canonical_tenant_patient_links`).get() as { count: number }).count)).toBe(0);
      expect(Number((sqlite.prepare(`SELECT COUNT(*) count FROM canonical_source_mappings`).get() as { count: number }).count)).toBe(0);
      expect(Number((sqlite.prepare(`SELECT COUNT(*) count FROM canonical_outbox_events`).get() as { count: number }).count)).toBe(0);
    } finally {
      sqlite.close();
    }
  });
});
