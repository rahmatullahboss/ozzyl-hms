import { describe, expect, it } from 'vitest';
import { applyLegacyReceivableAdjustment } from '../../src/services/billing/receivableAdjustment/legacyCreditNote';
import {
  baseAdjustmentInput,
  createReceivableAdjustmentHarness,
  seedLegacyBill,
} from './receivable-adjustment-harness';

function scalar(sqlite: ReturnType<typeof createReceivableAdjustmentHarness>['sqlite'], sql: string): number {
  return Number((sqlite.prepare(sql).get() as { value: number }).value);
}

describe('legacy receivable adjustment', () => {
  it('creates an approved zero-cash credit note and atomically reduces invoice total and due', async () => {
    const { db, sqlite } = createReceivableAdjustmentHarness();
    seedLegacyBill(sqlite);

    const result = await applyLegacyReceivableAdjustment(baseAdjustmentInput(db) as never);

    expect(result).toMatchObject({
      authorityMode: 'legacy',
      previousDueMinor: 8000,
      newDueMinor: 5000,
      appliedAmountMinor: 3000,
      currencyCode: 'BDT',
      legacyCreditNoteId: expect.any(Number),
    });
    expect(sqlite.prepare(`
      SELECT total, paid, due, status
      FROM bills WHERE tenant_id='tenant-a' AND id=77
    `).get()).toEqual({ total: 70, paid: 20, due: 50, status: 'partially_paid' });
    expect(sqlite.prepare(`
      SELECT total_amount, refund_amount, payment_mode, status, approved_by
      FROM billing_credit_notes WHERE tenant_id='tenant-a' AND bill_id=77
    `).get()).toEqual({
      total_amount: 30,
      refund_amount: 0,
      payment_mode: 'write_off',
      status: 'approved',
      approved_by: 12,
    });

    const posting = sqlite.prepare(`
      SELECT event_type, payload_json
      FROM accounting_posting_events
      WHERE tenant_id='tenant-a'
    `).get() as { event_type: string; payload_json: string };
    expect(posting.event_type).toBe('credit_note_issued');
    expect(JSON.parse(posting.payload_json)).toMatchObject({
      total: 30,
      receivableReduction: 30,
      cashRefund: 0,
      paymentMethod: 'write_off',
      sourceType: 'receivable_write_off',
      sourceRequestId: 9001,
    });
    expect(scalar(sqlite, `SELECT COUNT(*) value FROM audit_logs WHERE action='APPROVE'`)).toBe(1);
    expect(scalar(sqlite, `SELECT COUNT(*) value FROM income WHERE amount=-30`)).toBe(1);
  });

  it('supports a full due adjustment without reducing paid money', async () => {
    const { db, sqlite } = createReceivableAdjustmentHarness();
    seedLegacyBill(sqlite);

    const result = await applyLegacyReceivableAdjustment(baseAdjustmentInput(db, {
      amountMinor: 8000,
      idempotencyKey: 'receivable-write-off:9002',
      sourceRequestId: 9002,
    }) as never);

    expect(result).toMatchObject({ previousDueMinor: 8000, newDueMinor: 0 });
    expect(sqlite.prepare(`
      SELECT total, paid, due, status FROM bills WHERE tenant_id='tenant-a' AND id=77
    `).get()).toEqual({ total: 20, paid: 20, due: 0, status: 'paid' });
  });

  it('rejects paid performer payouts and source-request replays with changed money', async () => {
    const paidReserve = createReceivableAdjustmentHarness();
    seedLegacyBill(paidReserve.sqlite);
    paidReserve.sqlite.prepare(`
      INSERT INTO diagnostic_performer_reserves (tenant_id, bill_id, status)
      VALUES ('tenant-a', 77, 'paid')
    `).run();
    await expect(applyLegacyReceivableAdjustment(baseAdjustmentInput(paidReserve.db) as never))
      .rejects.toThrow(/paid performer payout|reverse.*payout/i);
    expect(scalar(paidReserve.sqlite, 'SELECT COUNT(*) value FROM billing_credit_notes')).toBe(0);

    const replay = createReceivableAdjustmentHarness();
    seedLegacyBill(replay.sqlite);
    await applyLegacyReceivableAdjustment(baseAdjustmentInput(replay.db) as never);
    await expect(applyLegacyReceivableAdjustment(baseAdjustmentInput(replay.db, {
      amountMinor: 2000,
      idempotencyKey: 'receivable-write-off:changed',
    }) as never)).rejects.toThrow(/does not match|conflict|different/i);
    expect(scalar(replay.sqlite, 'SELECT COUNT(*) value FROM billing_credit_notes')).toBe(1);
  });

  it('rolls back every evidence write when the invoice changes before the guarded batch', async () => {
    const harness = createReceivableAdjustmentHarness();
    seedLegacyBill(harness.sqlite);
    harness.beforeBatch = () => {
      harness.sqlite.prepare(`
        UPDATE bills SET due=70, total=90
        WHERE tenant_id='tenant-a' AND id=77
      `).run();
      harness.beforeBatch = undefined;
    };

    await expect(applyLegacyReceivableAdjustment(baseAdjustmentInput(harness.db) as never))
      .rejects.toThrow(/constraint|concurrent|guard/i);
    expect(scalar(harness.sqlite, 'SELECT COUNT(*) value FROM billing_credit_notes')).toBe(0);
    expect(scalar(harness.sqlite, 'SELECT COUNT(*) value FROM accounting_posting_events')).toBe(0);
    expect(scalar(harness.sqlite, 'SELECT COUNT(*) value FROM audit_logs')).toBe(0);
    expect(scalar(harness.sqlite, 'SELECT COUNT(*) value FROM income')).toBe(0);
  });

  it('rejects over-due, terminal, currency, and cross-tenant adjustments without evidence writes', async () => {
    const overDue = createReceivableAdjustmentHarness();
    seedLegacyBill(overDue.sqlite);
    await expect(applyLegacyReceivableAdjustment(baseAdjustmentInput(overDue.db, {
      amountMinor: 8001,
    }) as never)).rejects.toThrow(/exceeds.*due/i);

    const terminal = createReceivableAdjustmentHarness();
    seedLegacyBill(terminal.sqlite, { status: 'cancelled' });
    await expect(applyLegacyReceivableAdjustment(baseAdjustmentInput(terminal.db) as never))
      .rejects.toThrow(/not open|terminal|cancel/i);

    const currency = createReceivableAdjustmentHarness();
    seedLegacyBill(currency.sqlite);
    await expect(applyLegacyReceivableAdjustment(baseAdjustmentInput(currency.db, {
      currencyCode: 'USD',
    }) as never)).rejects.toThrow(/currency/i);

    const tenant = createReceivableAdjustmentHarness();
    seedLegacyBill(tenant.sqlite, { tenantId: 'tenant-b' });
    await expect(applyLegacyReceivableAdjustment(baseAdjustmentInput(tenant.db) as never))
      .rejects.toThrow(/not found/i);

    for (const current of [overDue, terminal, currency, tenant]) {
      expect(scalar(current.sqlite, 'SELECT COUNT(*) value FROM billing_credit_notes')).toBe(0);
      expect(scalar(current.sqlite, 'SELECT COUNT(*) value FROM accounting_posting_events')).toBe(0);
      expect(scalar(current.sqlite, 'SELECT COUNT(*) value FROM audit_logs')).toBe(0);
    }
  });
});
