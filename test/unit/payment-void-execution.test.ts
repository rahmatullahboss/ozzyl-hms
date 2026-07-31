import { describe, expect, it } from 'vitest';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../../src/types';
import { executePaymentVoidReversal } from '../../src/lib/payment-void-execution';
import { createMockDB } from '../integration/helpers/mock-db';

function paymentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 83,
    bill_id: 12,
    amount: 700,
    payment_type: 'current',
    receipt_no: 'RCP-000083',
    payment_method: 'cash',
    received_by: 77,
    counter_id: 3,
    counter_session_id: 9,
    tenant_id: 'tenant-1',
    patient_id: 55,
    paid: 700,
    total: 700,
    status: 'paid',
    ...overrides,
  };
}

function envFor(tables: Record<string, Record<string, unknown>[]>) {
  const mockDB = createMockDB({ tables });
  return {
    env: { DB: mockDB.db } as Env,
    mockDB,
  };
}

describe('executePaymentVoidReversal', () => {
  it('reverses the payment and attributes drawer accountability to the original receiver', async () => {
    const { env, mockDB } = envFor({
      payments: [paymentRow()],
      bills: [{ id: 12, tenant_id: 'tenant-1', paid: 700, total: 700, status: 'paid' }],
      billing_deposits: [],
      diagnostic_performer_reserves: [],
      doctor_commission_accruals: [],
    });

    const result = await executePaymentVoidReversal(env, {
      tenantId: 'tenant-1',
      paymentId: 83,
      actorUserId: 3,
      reason: 'Wrongly marked as paid',
      cashOnly: true,
    });

    expect(result).toMatchObject({
      billId: 12,
      originalAmount: 700,
      originalReceivedBy: 77,
      newPaid: 0,
      due: 700,
      status: 'open',
      executionMode: 'legacy',
    });
    expect(mockDB.queries.some((query) =>
      query.sql.includes('INSERT INTO payments') && query.params.includes(-700)
    )).toBe(true);
    expect(mockDB.queries.some((query) =>
      query.sql.includes('INSERT INTO emp_cash_transactions')
      && query.sql.includes("'SalesReturn'")
      && query.params[1] === 77
      && query.params.includes(700)
    )).toBe(true);
  });

  it('preserves due-collection classification on the negative reversal row', async () => {
    const { env, mockDB } = envFor({
      payments: [paymentRow({ payment_type: 'due' })],
      bills: [{ id: 12, tenant_id: 'tenant-1', paid: 700, total: 700, status: 'paid' }],
      billing_deposits: [],
      diagnostic_performer_reserves: [],
      doctor_commission_accruals: [],
    });

    await executePaymentVoidReversal(env, {
      tenantId: 'tenant-1',
      paymentId: 83,
      actorUserId: 3,
      reason: 'Due collection was entered against the wrong bill',
      cashOnly: true,
    });

    const reversalInsert = mockDB.queries.find((query) =>
      query.sql.includes('INSERT INTO payments') && query.params.includes(-700)
    );
    expect(reversalInsert?.params).toContain('due');
    expect(reversalInsert?.params).toContain('reverse-payment-83');
  });

  it('reopens a diagnostic or service bill as due and reduces its cash collection', async () => {
    const { env, mockDB } = envFor({
      payments: [paymentRow({
        bill_id: 21,
        amount: 1200,
        receipt_no: 'RCP-TEST-001',
        paid: 1200,
        total: 1200,
      })],
      bills: [{
        id: 21,
        tenant_id: 'tenant-1',
        patient_id: 55,
        paid: 1200,
        due: 0,
        total: 1200,
        status: 'paid',
        test_bill: 1,
        bill_type: 'diagnostic',
      }],
      billing_deposits: [],
      diagnostic_performer_reserves: [],
      doctor_commission_accruals: [],
    });

    const result = await executePaymentVoidReversal(env, {
      tenantId: 'tenant-1',
      paymentId: 83,
      actorUserId: 3,
      reason: 'Diagnostic payment collected by mistake',
      cashOnly: true,
    });

    expect(result).toMatchObject({
      billId: 21,
      originalAmount: 1200,
      newPaid: 0,
      due: 1200,
      status: 'open',
    });
    expect(mockDB.queries.some((query) =>
      query.sql.includes('UPDATE bills SET paid = ?')
      && query.params.includes(0)
      && query.params.includes(1200)
      && query.params.includes('open')
    )).toBe(true);
    expect(mockDB.queries.some((query) =>
      query.sql.includes("'SalesReturn'")
      && query.params.includes(1200)
    )).toBe(true);
  });

  it('places caller-supplied operational statements in the same authoritative batch', async () => {
    const { env, mockDB } = envFor({
      payments: [paymentRow()],
      bills: [{ id: 12, tenant_id: 'tenant-1', paid: 700, total: 700, status: 'paid' }],
      billing_deposits: [],
      diagnostic_performer_reserves: [],
      doctor_commission_accruals: [],
    });
    const approvalInsert = env.DB.prepare('INSERT INTO approval_requests (tenant_id) VALUES (?)').bind('tenant-1');

    await executePaymentVoidReversal(env, {
      tenantId: 'tenant-1',
      paymentId: 83,
      actorUserId: 3,
      reason: 'Wrongly marked as paid',
      cashOnly: true,
      additionalAuthoritativeStatements: () => [approvalInsert],
    });

    expect(mockDB.batchCalls[0]?.[0]).toContain('INSERT INTO approval_requests');
    expect(mockDB.batchCalls[0]?.some((sql) => sql.includes('INSERT INTO payments'))).toBe(true);
  });

  it('blocks reversal when linked doctor compensation is already paid', async () => {
    const { env } = envFor({
      payments: [paymentRow()],
      bills: [{ id: 12, tenant_id: 'tenant-1', paid: 700, total: 700, status: 'paid' }],
      billing_deposits: [],
      diagnostic_performer_reserves: [],
      doctor_commission_accruals: [{ id: 91, tenant_id: 'tenant-1', bill_id: 12, status: 'paid' }],
    });

    await expect(executePaymentVoidReversal(env, {
      tenantId: 'tenant-1',
      paymentId: 83,
      actorUserId: 3,
      reason: 'Wrongly marked as paid',
      cashOnly: true,
    })).rejects.toMatchObject<Partial<HTTPException>>({ status: 409 });
  });

  it('rejects non-cash receipts from the executed-pending path', async () => {
    const { env } = envFor({
      payments: [paymentRow({ payment_method: 'card' })],
      bills: [{ id: 12, tenant_id: 'tenant-1', paid: 700, total: 700, status: 'paid' }],
      billing_deposits: [],
      diagnostic_performer_reserves: [],
      doctor_commission_accruals: [],
    });

    await expect(executePaymentVoidReversal(env, {
      tenantId: 'tenant-1',
      paymentId: 83,
      actorUserId: 3,
      reason: 'Wrongly marked as paid',
      cashOnly: true,
    })).rejects.toMatchObject<Partial<HTTPException>>({ status: 409 });
  });
});
