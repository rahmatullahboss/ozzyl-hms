import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  allocateDoctorCommissionRecoveries,
  prepareDoctorCommissionRecoveryStatements,
} from '../../src/lib/doctor-commission-recovery';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement {
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

function harness() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE doctor_commission_settlements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      doctor_id INTEGER NOT NULL,
      idempotency_key TEXT,
      UNIQUE (tenant_id, idempotency_key)
    );
    CREATE TABLE doctor_commission_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      doctor_id INTEGER NOT NULL,
      adjustment_type TEXT NOT NULL,
      amount REAL NOT NULL,
      status TEXT NOT NULL,
      settlement_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE doctor_commission_adjustment_applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      adjustment_id INTEGER NOT NULL,
      settlement_id INTEGER NOT NULL,
      amount REAL NOT NULL CHECK (amount > 0),
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tenant_id, adjustment_id, settlement_id)
    );
  `);
  const db = {
    prepare(sql: string) {
      return new Statement(sqlite, sql);
    },
  } as unknown as D1Database;
  return { sqlite, db };
}

async function runBatch(sqlite: DatabaseSync, statements: D1PreparedStatement[]) {
  sqlite.exec('BEGIN IMMEDIATE');
  try {
    for (const statement of statements) await statement.run();
    sqlite.exec('COMMIT');
  } catch (error) {
    sqlite.exec('ROLLBACK');
    throw error;
  }
}

describe('doctor commission recovery allocation', () => {
  it('allocates oldest recovery obligations first', () => {
    expect(allocateDoctorCommissionRecoveries([
      { adjustmentId: 1, outstandingAmount: 10 },
      { adjustmentId: 2, outstandingAmount: 20 },
    ], 15)).toEqual({
      applications: [
        { adjustmentId: 1, amount: 10 },
        { adjustmentId: 2, amount: 5 },
      ],
      totalDeduction: 15,
    });
  });

  it('normalises money and ignores unusable limits', () => {
    expect(allocateDoctorCommissionRecoveries([
      { adjustmentId: 1, outstandingAmount: 10.005 },
    ], 10.004)).toEqual({
      applications: [{ adjustmentId: 1, amount: 10 }],
      totalDeduction: 10,
    });
    expect(allocateDoctorCommissionRecoveries([{ adjustmentId: 1, outstandingAmount: 10 }], 0))
      .toEqual({ applications: [], totalDeduction: 0 });
  });

  it('prepares exact applications and projects adjustment status', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec(`
        INSERT INTO doctor_commission_settlements (tenant_id,doctor_id,idempotency_key)
        VALUES ('102',134,'settlement-1');
        INSERT INTO doctor_commission_adjustments
          (tenant_id,doctor_id,adjustment_type,amount,status,created_at,updated_at)
        VALUES
          ('102',134,'clawback',10,'outstanding','2026-07-20 10:00:00','2026-07-20 10:00:00'),
          ('102',134,'clawback',20,'outstanding','2026-07-21 10:00:00','2026-07-21 10:00:00');
      `);

      const prepared = await prepareDoctorCommissionRecoveryStatements(db, {
        tenantId: '102',
        doctorId: 134,
        settlementIdempotencyKey: 'settlement-1',
        maxDeduction: 15,
        createdBy: 9,
      });

      expect(prepared.totalDeduction).toBe(15);
      expect(prepared.applications).toEqual([
        { adjustmentId: 1, amount: 10 },
        { adjustmentId: 2, amount: 5 },
      ]);

      await runBatch(sqlite, prepared.statements);

      expect(sqlite.prepare(`
        SELECT adjustment_id,amount FROM doctor_commission_adjustment_applications ORDER BY adjustment_id
      `).all()).toEqual([
        { adjustment_id: 1, amount: 10 },
        { adjustment_id: 2, amount: 5 },
      ]);
      expect(sqlite.prepare(`SELECT id,status,settlement_id FROM doctor_commission_adjustments ORDER BY id`).all())
        .toEqual([
          { id: 1, status: 'applied', settlement_id: 1 },
          { id: 2, status: 'outstanding', settlement_id: 1 },
        ]);
    } finally {
      sqlite.close();
    }
  });

  it('fails closed when a prepared recovery balance becomes stale', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec(`
        INSERT INTO doctor_commission_settlements (tenant_id,doctor_id,idempotency_key)
        VALUES ('102',134,'settlement-stale'), ('102',134,'settlement-other');
        INSERT INTO doctor_commission_adjustments
          (tenant_id,doctor_id,adjustment_type,amount,status,created_at,updated_at)
        VALUES ('102',134,'clawback',10,'outstanding','2026-07-20 10:00:00','2026-07-20 10:00:00');
      `);
      const prepared = await prepareDoctorCommissionRecoveryStatements(db, {
        tenantId: '102',
        doctorId: 134,
        settlementIdempotencyKey: 'settlement-stale',
        maxDeduction: 10,
        createdBy: 9,
      });
      sqlite.exec(`
        INSERT INTO doctor_commission_adjustment_applications
          (tenant_id,adjustment_id,settlement_id,amount,created_by)
        VALUES ('102',1,2,10,8);
      `);

      await expect(runBatch(sqlite, prepared.statements)).rejects.toThrow();
      expect(sqlite.prepare(`
        SELECT COUNT(*) AS count FROM doctor_commission_adjustment_applications WHERE settlement_id=1
      `).get()).toEqual({ count: 0 });
    } finally {
      sqlite.close();
    }
  });
});
