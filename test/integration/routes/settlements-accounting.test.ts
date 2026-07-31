import { describe, expect, it } from 'vitest';
import settlementRoutes from '../../../src/routes/tenant/settlements';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import { ACTIVE_BILLING_COUNTER_TABLES } from '../helpers/fixtures';

describe('settlement accounting', () => {
  it('posts cash, deposit, and discount settlement components through central accounting events', async () => {
    const { app, mockDB } = createTestApp({
      route: settlementRoutes,
      routePath: '/settlements',
      role: 'accountant',
      tables: {
        ...ACTIVE_BILLING_COUNTER_TABLES,
        bills: [{ id: 10, tenant_id: 'tenant-1', patient_id: 7, total: 1000, paid: 200 }],
        patients: [{ id: 7, tenant_id: 'tenant-1', name: 'Patient' }],
        billing_deposits: [{ tenant_id: 'tenant-1', patient_id: 7, transaction_type: 'deposit', amount: 300, is_active: 1 }],
      },
    });

    const res = await jsonRequest(app, '/settlements', {
      method: 'POST',
      body: {
        patient_id: 7,
        bill_ids: [10],
        paid_amount: 400,
        deposit_deducted: 300,
        discount_amount: 100,
        discount_by_name: 'Director',
        payment_mode: 'cash',
      },
    });

    expect(res.status).toBe(201);
    expect(mockDB.queries.some((q) =>
      q.sql.includes('INSERT INTO payments')
      && q.params.includes('cash')
      && q.sql.includes('counter_session_id')
    )).toBe(true);
    expect(mockDB.queries.some((q) =>
      q.sql.includes('INSERT OR IGNORE INTO accounting_posting_events')
      && q.params.includes('payment_received')
    )).toBe(true);
    expect(mockDB.queries.some((q) =>
      q.sql.includes('INSERT OR IGNORE INTO accounting_posting_events')
      && q.params.includes('patient_deposit_adjusted')
    )).toBe(true);
    expect(mockDB.queries.some((q) =>
      q.sql.includes('INSERT OR IGNORE INTO accounting_posting_events')
      && q.params.includes('settlement_discount')
    )).toBe(true);
  });
});
