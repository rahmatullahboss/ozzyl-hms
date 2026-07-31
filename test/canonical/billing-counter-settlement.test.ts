import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import { recordDeposit } from '../../src/lib/canonical/commands/apply-deposit';
import { buildLiveDepositProjection } from '../../src/lib/canonical/live-financial-projection';
import { projectBillingCounterSettlement } from '../../src/lib/canonical/billing-counter-settlement';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements CanonicalPreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
    private readonly params: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): Statement {
    return new Statement(
      this.database,
      this.sql,
      values.map((value) => value === undefined ? null : value) as SqlValue[],
    );
  }

  async run(): Promise<unknown> {
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
  for (const name of [
    '0505_canonical_program_foundation.sql',
    '0506_canonical_practitioners.sql',
    '0507_canonical_encounters.sql',
    '0508_canonical_service_catalog.sql',
    '0509_canonical_service_requests_events.sql',
    '0510_canonical_invoices.sql',
    '0511_canonical_payments.sql',
    '0512_canonical_adjustments.sql',
  ]) sqlite.exec(readFileSync(`migrations/${name}`, 'utf8'));

  const db: CanonicalBatchDatabase = {
    prepare(sql: string) {
      return new Statement(sqlite, sql);
    },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results: unknown[] = [];
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

function count(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as { count: number }).count);
}

function baseInput() {
  return {
    tenantId: '100',
    patientId: 101,
    invoiceNo: 'BC-INV-1',
    issuedAtUtc: '2026-07-20T08:00:00.000Z',
    items: [{
      sourceLineId: '1:test:55',
      lineType: 'other_adjustment' as const,
      adjustmentCode: 'LEGACY_TEST',
      quantity: 1,
      unitAmount: '100.00',
    }],
  };
}

async function seedDeposit(
  db: CanonicalBatchDatabase,
  input: { depositNo: string; amount: string; collectedAtUtc: string },
): Promise<void> {
  await recordDeposit(db, await buildLiveDepositProjection({
    tenantId: '100',
    depositNo: input.depositNo,
    patientId: 101,
    amount: input.amount,
    tenderType: 'cash',
    methodCode: 'cash',
    collectedAtUtc: input.collectedAtUtc,
  }));
}

describe('billing-counter canonical settlement projection', () => {
  it('projects an immediate payment against the newly issued canonical invoice', async () => {
    const { sqlite, db } = harness();
    try {
      const input = {
        ...baseInput(),
        payment: {
          receiptNo: 'RCP-1',
          amount: '40.00',
          paymentMethod: 'cash',
          collectorId: 7,
          counterId: 3,
          counterSessionId: 9,
          externalTransactionId: null,
        },
      };

      await projectBillingCounterSettlement(db, input);
      await projectBillingCounterSettlement(db, input);

      expect(sqlite.prepare(`
        SELECT subtotal_minor,adjustment_total_minor,total_minor,paid_minor,due_minor,net_due_minor
        FROM canonical_invoices WHERE invoice_number='BC-INV-1'
      `).get()).toEqual({
        subtotal_minor: 10000,
        adjustment_total_minor: 0,
        total_minor: 10000,
        paid_minor: 4000,
        due_minor: 6000,
        net_due_minor: 6000,
      });
      expect(count(sqlite, 'canonical_invoices')).toBe(1);
      expect(count(sqlite, 'canonical_payment_receipts')).toBe(1);
      expect(count(sqlite, 'canonical_payment_tenders')).toBe(1);
      expect(count(sqlite, 'canonical_payment_allocations')).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it('rejects paid strict execution before any canonical or authoritative write can partially commit', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(projectBillingCounterSettlement(db, {
        ...baseInput(),
        invoiceNo: 'BC-INV-STRICT',
        payment: {
          receiptNo: 'RCP-STRICT',
          amount: '40.00',
          paymentMethod: 'cash',
        },
      }, {
        authoritativeStatements: [db.prepare('SELECT 1')],
      })).rejects.toThrow(/non-blocking canonical shadow mode/i);

      expect(count(sqlite, 'canonical_invoices')).toBe(0);
      expect(count(sqlite, 'canonical_payment_receipts')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('applies a deposit deduction FIFO across available canonical deposits', async () => {
    const { sqlite, db } = harness();
    try {
      await seedDeposit(db, {
        depositNo: 'DEP-1',
        amount: '30.00',
        collectedAtUtc: '2026-07-19T05:00:00.000Z',
      });
      await seedDeposit(db, {
        depositNo: 'DEP-2',
        amount: '50.00',
        collectedAtUtc: '2026-07-19T06:00:00.000Z',
      });

      await projectBillingCounterSettlement(db, {
        ...baseInput(),
        invoiceNo: 'BC-INV-2',
        payment: {
          receiptNo: 'RCP-2',
          amount: '10.00',
          paymentMethod: 'cash',
          collectorId: 7,
          counterId: 3,
          counterSessionId: 9,
          externalTransactionId: null,
        },
        depositApplication: {
          applicationNo: 'DAD-1',
          amount: '60.00',
          appliedAtUtc: '2026-07-20T08:00:00.000Z',
        },
      });

      expect(sqlite.prepare(`
        SELECT paid_minor,due_minor,net_due_minor
        FROM canonical_invoices WHERE invoice_number='BC-INV-2'
      `).get()).toEqual({ paid_minor: 7000, due_minor: 3000, net_due_minor: 3000 });
      expect(sqlite.prepare(`
        SELECT deposit_number,available_minor
        FROM canonical_deposits ORDER BY received_at_utc,deposit_number
      `).all()).toEqual([
        { deposit_number: 'DEP-1', available_minor: 0 },
        { deposit_number: 'DEP-2', available_minor: 2000 },
      ]);
      expect(count(sqlite, 'canonical_deposit_applications')).toBe(2);
    } finally {
      sqlite.close();
    }
  });
});
