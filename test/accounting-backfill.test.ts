import { describe, expect, it } from 'vitest';
import { backfillAccountingPostingEvents } from '../src/lib/accounting-backfill';
import { createMockDB } from './integration/helpers/mock-db';

describe('accounting posting backfill', () => {
  it('creates posting events for legacy operational finance sources', async () => {
    const { db, queries } = createMockDB();

    const result = await backfillAccountingPostingEvents(db, 'tenant-1', 'user-1');

    expect(result).toEqual({
      bills: 1,
      payments: 1,
      legacyBillPayments: 1,
      deposits: 1,
      depositAdjustments: 1,
      depositRefunds: 1,
      creditNotes: 1,
      supplierPayments: 1,
      settlementDiscounts: 1,
      doctorCommissions: 1,
    });

    const insertSql = queries
      .filter((query) => query.method === 'run')
      .map((query) => query.sql.replace(/\s+/g, ' '));

    expect(insertSql).toHaveLength(10);
    expect(insertSql.some((sql) => sql.includes("'billing:' || b.id || ':bill_created'"))).toBe(true);
    expect(insertSql.some((sql) => sql.includes("'payment:LEGACY-BILL-' || b.id || '-PAID:payment_received'"))).toBe(true);
    expect(insertSql.some((sql) => sql.includes("'patient_deposit:' || d.deposit_receipt_no || ':patient_deposit_received'"))).toBe(true);
    expect(insertSql.some((sql) => sql.includes("'settlement_discount:' || s.settlement_receipt_no || '-DISC-' || s.id"))).toBe(true);
    expect(insertSql.some((sql) => sql.includes("'doctor_commission_accrual:' || a.id || ':commission_accrued'"))).toBe(true);
  });

  it('does not backfill deposit deductions as cash or bank payments', async () => {
    const { db, queries } = createMockDB();

    await backfillAccountingPostingEvents(db, 'tenant-1', 'user-1');

    const paymentBackfillSql = queries
      .filter((query) => query.method === 'run')
      .map((query) => query.sql.replace(/\s+/g, ' '))
      .find((sql) => sql.includes("'payment:' || COALESCE(p.receipt_no"));

    expect(paymentBackfillSql).toContain("LOWER(COALESCE(p.payment_method, p.payment_type, '')) <> 'deposit'");
  });
});
