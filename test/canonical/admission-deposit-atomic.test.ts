import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import { recordDeposit } from '../../src/lib/canonical/commands/apply-deposit';
import {
  prepareClearFinancialBatchAssertions,
  prepareFinancialBatchAssertion,
} from '../../src/lib/canonical/financial-batch-assertion';
import { buildLiveDepositProjection } from '../../src/lib/canonical/live-financial-projection';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements CanonicalPreparedStatement {
  constructor(
    private readonly sqlite: DatabaseSync,
    readonly sql: string,
    readonly params: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): Statement {
    return new Statement(
      this.sqlite,
      this.sql,
      values.map((value) => value === undefined ? null : value) as SqlValue[],
    );
  }

  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.params);
    return {
      success: true,
      meta: {
        changes: Number(result.changes ?? 0),
        last_row_id: Number(result.lastInsertRowid ?? 0),
      },
    };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.sqlite.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
}

const CANONICAL_MIGRATIONS = [
  '0505_canonical_program_foundation.sql',
  '0506_canonical_practitioners.sql',
  '0507_canonical_encounters.sql',
  '0508_canonical_service_catalog.sql',
  '0509_canonical_service_requests_events.sql',
  '0510_canonical_invoices.sql',
  '0511_canonical_payments.sql',
  '0512_canonical_adjustments.sql',
  '0513_canonical_practitioner_compensation.sql',
  '0514_canonical_inventory_links.sql',
  '0515_canonical_accounting_outbox.sql',
  '0532_canonical_financial_batch_assertions.sql',
] as const;

function harness() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const migration of CANONICAL_MIGRATIONS) {
    sqlite.exec(readFileSync(`migrations/${migration}`, 'utf8'));
  }
  sqlite.exec(`
    CREATE TABLE admissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      admission_no TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      bed_id INTEGER,
      status TEXT NOT NULL DEFAULT 'admitted',
      UNIQUE(tenant_id, admission_no)
    );
    CREATE TABLE beds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      bed_number TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'available'
    );
    CREATE TABLE patient_bed_infos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      admission_id INTEGER NOT NULL,
      bed_id INTEGER NOT NULL
    );
    CREATE TABLE billing_deposits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      admission_id INTEGER NOT NULL,
      deposit_receipt_no TEXT NOT NULL,
      amount REAL NOT NULL
    );
  `);
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

function count(sqlite: DatabaseSync, table: string, where = ''): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table} ${where}`).get() as { count: number }).count);
}

async function depositInput(depositNo: string) {
  return buildLiveDepositProjection({
    tenantId: '100',
    depositNo,
    patientId: 101,
    amount: 300,
    tenderType: 'cash',
    methodCode: 'cash',
    collectedAtUtc: '2026-07-23T10:00:00.000Z',
  });
}

function authoritativeStatements(
  db: CanonicalBatchDatabase,
  input: { admissionNo: string; depositNo: string; bedId: number },
): CanonicalPreparedStatement[] {
  const operationKey = `${input.admissionNo}:${input.depositNo}`;
  return [
    db.prepare(`
      INSERT INTO admissions (tenant_id,admission_no,patient_id,bed_id)
      SELECT '100',?,101,?
      WHERE NOT EXISTS (
        SELECT 1 FROM admissions
        WHERE tenant_id='100' AND patient_id=101 AND status='admitted'
      )
      AND EXISTS (
        SELECT 1 FROM beds
        WHERE tenant_id='100' AND id=? AND status='available'
      )
    `).bind(input.admissionNo, input.bedId, input.bedId),
    prepareFinancialBatchAssertion(db, {
      tenantId: '100',
      operationKey,
      stepKey: 'admission_insert',
      expectedChanges: 1,
    }),
    db.prepare(`
      UPDATE beds SET status='occupied'
      WHERE tenant_id='100' AND id=? AND status='available'
        AND EXISTS (
          SELECT 1 FROM admissions
          WHERE tenant_id='100' AND admission_no=? AND bed_id=beds.id
        )
    `).bind(input.bedId, input.admissionNo),
    prepareFinancialBatchAssertion(db, {
      tenantId: '100',
      operationKey,
      stepKey: 'bed_update',
      expectedChanges: 1,
    }),
    db.prepare(`
      INSERT INTO patient_bed_infos (tenant_id,patient_id,admission_id,bed_id)
      SELECT tenant_id,patient_id,id,bed_id
      FROM admissions
      WHERE tenant_id='100' AND admission_no=?
    `).bind(input.admissionNo),
    prepareFinancialBatchAssertion(db, {
      tenantId: '100',
      operationKey,
      stepKey: 'bed_history_insert',
      expectedChanges: 1,
    }),
    db.prepare(`
      INSERT INTO billing_deposits (
        tenant_id,patient_id,admission_id,deposit_receipt_no,amount
      )
      SELECT tenant_id,patient_id,id,?,300
      FROM admissions
      WHERE tenant_id='100' AND admission_no=?
    `).bind(input.depositNo, input.admissionNo),
    prepareFinancialBatchAssertion(db, {
      tenantId: '100',
      operationKey,
      stepKey: 'deposit_insert',
      expectedChanges: 1,
    }),
    prepareClearFinancialBatchAssertions(db, '100', operationKey),
  ];
}

function expectNoCanonicalDepositState(sqlite: DatabaseSync): void {
  expect(count(sqlite, 'canonical_payment_receipts')).toBe(0);
  expect(count(sqlite, 'canonical_payment_tenders')).toBe(0);
  expect(count(sqlite, 'canonical_deposits')).toBe(0);
  expect(count(sqlite, 'canonical_source_mappings')).toBe(0);
  expect(count(sqlite, 'canonical_outbox_events')).toBe(0);
  expect(count(sqlite, 'canonical_financial_batch_assertions')).toBe(0);
}

describe('atomic canonical admission deposit command composition', () => {
  it('commits admission, bed, legacy deposit and canonical deposit in one batch', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec(`INSERT INTO beds (tenant_id,bed_number,status) VALUES ('100','B-1','available')`);
      const input = await depositInput('DEP-1');

      const result = await recordDeposit(db, input, {
        authoritativeStatements: authoritativeStatements(db, {
          admissionNo: 'ADM-1',
          depositNo: 'DEP-1',
          bedId: 1,
        }),
      });

      expect(result).toMatchObject({ status: 'applied' });
      expect(count(sqlite, 'admissions')).toBe(1);
      expect(count(sqlite, 'beds', `WHERE status='occupied'`)).toBe(1);
      expect(count(sqlite, 'patient_bed_infos')).toBe(1);
      expect(count(sqlite, 'billing_deposits')).toBe(1);
      expect(count(sqlite, 'canonical_payment_receipts')).toBe(1);
      expect(count(sqlite, 'canonical_payment_tenders')).toBe(1);
      expect(count(sqlite, 'canonical_deposits')).toBe(1);
      expect(count(sqlite, 'canonical_source_mappings')).toBe(2);
      expect(count(sqlite, 'canonical_outbox_events')).toBe(1);
      expect(count(sqlite, 'canonical_financial_batch_assertions')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('rolls back all attempted legacy and canonical state when the patient is already admitted', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec(`
        INSERT INTO beds (tenant_id,bed_number,status) VALUES ('100','B-1','available');
        INSERT INTO admissions (tenant_id,admission_no,patient_id,status)
        VALUES ('100','ADM-EXISTING',101,'admitted');
      `);
      const input = await depositInput('DEP-2');

      await expect(recordDeposit(db, input, {
        authoritativeStatements: authoritativeStatements(db, {
          admissionNo: 'ADM-2',
          depositNo: 'DEP-2',
          bedId: 1,
        }),
      })).rejects.toThrow();

      expect(count(sqlite, 'admissions')).toBe(1);
      expect(count(sqlite, 'admissions', `WHERE admission_no='ADM-2'`)).toBe(0);
      expect(count(sqlite, 'billing_deposits')).toBe(0);
      expect(count(sqlite, 'patient_bed_infos')).toBe(0);
      expect(count(sqlite, 'beds', `WHERE status='available'`)).toBe(1);
      expectNoCanonicalDepositState(sqlite);
    } finally {
      sqlite.close();
    }
  });

  it('rolls back all attempted legacy and canonical state when the bed is no longer available', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec(`INSERT INTO beds (tenant_id,bed_number,status) VALUES ('100','B-1','occupied')`);
      const input = await depositInput('DEP-3');

      await expect(recordDeposit(db, input, {
        authoritativeStatements: authoritativeStatements(db, {
          admissionNo: 'ADM-3',
          depositNo: 'DEP-3',
          bedId: 1,
        }),
      })).rejects.toThrow();

      expect(count(sqlite, 'admissions')).toBe(0);
      expect(count(sqlite, 'billing_deposits')).toBe(0);
      expect(count(sqlite, 'patient_bed_infos')).toBe(0);
      expect(count(sqlite, 'beds', `WHERE status='occupied'`)).toBe(1);
      expectNoCanonicalDepositState(sqlite);
    } finally {
      sqlite.close();
    }
  });
});
