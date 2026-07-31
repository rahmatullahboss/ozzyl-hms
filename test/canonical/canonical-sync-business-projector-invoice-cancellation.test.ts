import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { CanonicalBatchDatabase, CanonicalPreparedStatement } from '../../src/lib/canonical/command-batch';
import { projectCanonicalSyncBusinessMutation } from '../../src/lib/canonical/local-sync-business-projector';

class Statement implements CanonicalPreparedStatement {
  constructor(private readonly sqlite: DatabaseSync, readonly sql: string, readonly params: SQLInputValue[] = []) {}
  bind(...params: unknown[]) { return new Statement(this.sqlite, this.sql, params.map((v) => v === undefined ? null : v) as SQLInputValue[]); }
  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes ?? 0), last_row_id: Number(result.lastInsertRowid ?? 0) } };
  }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.sqlite.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
}

function harness() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE canonical_invoices (
      tenant_id TEXT NOT NULL,invoice_public_id TEXT NOT NULL,total_minor INTEGER NOT NULL,
      status TEXT NOT NULL,cancelled_at_utc TEXT
    );
    CREATE TABLE canonical_compensation_accruals (
      tenant_id TEXT NOT NULL,accrual_public_id TEXT NOT NULL,invoice_public_id TEXT NOT NULL,
      practitioner_public_id TEXT
    );
    CREATE TABLE canonical_compensation_adjustments (
      tenant_id TEXT NOT NULL,adjustment_public_id TEXT NOT NULL,accrual_public_id TEXT NOT NULL,
      adjustment_type TEXT NOT NULL,reason_code TEXT NOT NULL,amount_minor INTEGER NOT NULL,
      accrual_adjusted_before_minor INTEGER NOT NULL,accrual_adjusted_after_minor INTEGER NOT NULL,
      accrual_settled_before_minor INTEGER NOT NULL,accrual_settled_after_minor INTEGER NOT NULL,
      accrual_payable_before_minor INTEGER NOT NULL,accrual_payable_after_minor INTEGER NOT NULL,
      occurred_at_utc TEXT NOT NULL,business_date TEXT NOT NULL,source_evidence_sha256 TEXT NOT NULL
    );
    INSERT INTO canonical_invoices VALUES ('100','invoice-1',900,'cancelled','2026-07-25T02:00:00Z');
    INSERT INTO canonical_compensation_accruals VALUES ('100','accrual-1','invoice-1','practitioner-1');
    INSERT INTO canonical_compensation_accruals VALUES ('100','accrual-2','invoice-1',NULL);
    INSERT INTO canonical_compensation_adjustments VALUES
      ('100','adjustment-1','accrual-1','service_cancellation','invoice_cancelled',100,
       0,100,0,0,100,0,'2026-07-25T02:00:00Z','2026-07-25','${'a'.repeat(64)}'),
      ('100','adjustment-2','accrual-2','service_cancellation','invoice_cancelled',50,
       10,60,0,0,50,0,'2026-07-25T02:00:00Z','2026-07-25','${'b'.repeat(64)}');
  `);
  const db: CanonicalBatchDatabase = {
    prepare(sql: string) { return new Statement(sqlite, sql); },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  return { sqlite, db };
}

function project(db: CanonicalBatchDatabase, overrides: Partial<Parameters<typeof projectCanonicalSyncBusinessMutation>[1]> = {}) {
  return projectCanonicalSyncBusinessMutation(db, {
    tenantId: '100', entityType: 'invoice', entityPublicId: 'invoice-1',
    eventType: 'canonical.invoice.cancelled', occurredAtUtc: '2026-07-25T02:00:00Z',
    event: {
      invoicePublicId: 'invoice-1', status: 'cancelled', totalMinor: 900,
      reversedCompensationMinor: 150, reversedCompensationCount: 2,
    },
    ...overrides,
  });
}

describe('canonical sync invoice cancellation projection', () => {
  it('projects exact immutable compensation cancellation facts in stable order', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(project(db)).resolves.toEqual({
        kind: 'invoice_cancelled', entityPublicId: 'invoice-1', totalMinor: 900,
        cancelledAtUtc: '2026-07-25T02:00:00Z',
        compensationAdjustments: [
          {
            adjustmentPublicId: 'adjustment-1', accrualPublicId: 'accrual-1',
            adjustmentType: 'service_cancellation', reasonCode: 'invoice_cancelled', amountMinor: 100,
            adjustedBeforeMinor: 0, adjustedAfterMinor: 100, settledBeforeMinor: 0,
            settledAfterMinor: 0, payableBeforeMinor: 100, payableAfterMinor: 0,
            statusBefore: 'accrued', statusAfter: 'reversed', occurredAtUtc: '2026-07-25T02:00:00Z',
            businessDate: '2026-07-25', sourceEvidenceSha256: 'a'.repeat(64),
          },
          {
            adjustmentPublicId: 'adjustment-2', accrualPublicId: 'accrual-2',
            adjustmentType: 'service_cancellation', reasonCode: 'invoice_cancelled', amountMinor: 50,
            adjustedBeforeMinor: 10, adjustedAfterMinor: 60, settledBeforeMinor: 0,
            settledAfterMinor: 0, payableBeforeMinor: 50, payableAfterMinor: 0,
            statusBefore: 'unassigned', statusAfter: 'reversed', occurredAtUtc: '2026-07-25T02:00:00Z',
            businessDate: '2026-07-25', sourceEvidenceSha256: 'b'.repeat(64),
          },
        ],
      });
    } finally { sqlite.close(); }
  });

  it('fails closed when event count/total or cancellation timestamp does not match source facts', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(project(db, { event: {
        invoicePublicId: 'invoice-1', status: 'cancelled', totalMinor: 900,
        reversedCompensationMinor: 149, reversedCompensationCount: 2,
      } })).rejects.toThrow(/compensation evidence/i);
      await expect(project(db, { occurredAtUtc: '2026-07-25T02:01:00Z' }))
        .rejects.toThrow(/cancellation evidence/i);
    } finally { sqlite.close(); }
  });

  it('supports cancellation without compensation only when event declares zero facts', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.prepare(`DELETE FROM canonical_compensation_adjustments`).run();
      await expect(project(db, { event: {
        invoicePublicId: 'invoice-1', status: 'cancelled', totalMinor: 900,
        reversedCompensationMinor: 0, reversedCompensationCount: 0,
      } })).resolves.toMatchObject({ compensationAdjustments: [] });
    } finally { sqlite.close(); }
  });
});
