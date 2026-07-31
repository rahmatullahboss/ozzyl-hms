import { describe, expect, it } from 'vitest';
import commissionRoutes from '../src/routes/tenant/commissions';
import marketingReferralRoutes from '../src/routes/tenant/marketingReferral';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

describe('agent and referral commission controls', () => {
  it('blocks non-finance users from legacy marketing and referral commission ledgers', async () => {
    const marketing = createTestApp({
      route: commissionRoutes,
      routePath: '/commissions',
      role: 'reception',
    });
    const referral = createTestApp({
      route: marketingReferralRoutes,
      routePath: '/marketing-referral',
      role: 'reception',
    });

    expect((await marketing.app.request('/commissions')).status).toBe(403);
    expect((await marketing.app.request('/commissions/summary')).status).toBe(403);
    expect((await referral.app.request('/marketing-referral/commissions')).status).toBe(403);
  });

  it('posts legacy marketing commission accruals and payouts through central accounting', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('select id, paid_status, commission_amount from commissions')) {
          return {
            first: { id: 23, paid_status: 'unpaid', commission_amount: 500 },
          };
        }
        if (normalized.includes('update commissions set paid_status')) {
          return {
            success: true,
            meta: { changes: 1, last_row_id: 0 },
          };
        }
        return null;
      },
    });
    const { app, mockDB: db } = createTestApp({
      route: commissionRoutes,
      routePath: '/commissions',
      role: 'accountant',
      tenantId: 'tenant-1',
      userId: 7,
      mockDB,
    });

    const createRes = await jsonRequest(app, '/commissions', {
      method: 'POST',
      body: {
        marketingPerson: 'Referral Agent',
        mobile: '01700000000',
        commissionAmount: 500,
        notes: 'OPD referral',
      },
    });
    expect(createRes.status).toBe(201);
    expect(db.queries.some((query) =>
      query.sql.includes('INSERT OR IGNORE INTO accounting_posting_events')
      && query.params.includes('agent_commission_accrued')
    )).toBe(true);

    const payRes = await jsonRequest(app, '/commissions/23/pay', {
      method: 'POST',
      body: { paidDate: '2026-05-12', paymentMode: 'cash', referenceNo: 'CASH-23' },
    });
    expect(payRes.status).toBe(200);
    expect(db.queries.some((query) =>
      query.sql.includes('INSERT OR IGNORE INTO accounting_posting_events')
      && query.params.includes('agent_commission_settled')
    )).toBe(true);
  });

  it('does not post a marketing commission payout when the row was already paid', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('select id, paid_status, commission_amount from commissions')) {
          return {
            first: { id: 23, paid_status: 'unpaid', commission_amount: 500 },
          };
        }
        if (normalized.includes('update commissions set paid_status')) {
          return {
            success: true,
            meta: { changes: 0, last_row_id: 0 },
          };
        }
        return null;
      },
    });
    const { app, mockDB: db } = createTestApp({
      route: commissionRoutes,
      routePath: '/commissions',
      role: 'accountant',
      tenantId: 'tenant-1',
      userId: 7,
      mockDB,
    });

    const payRes = await jsonRequest(app, '/commissions/23/pay', {
      method: 'POST',
      body: { paidDate: '2026-05-12', paymentMode: 'cash' },
    });

    expect(payRes.status).toBe(409);
    expect(db.queries.some((query) =>
      query.sql.includes('INSERT OR IGNORE INTO accounting_posting_events')
      && query.params.includes('agent_commission_settled')
    )).toBe(false);
  });

  it('accrues, pays, and cancels referral commissions without hard deleting financial rows', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from referralcommission')) {
          return {
            first: { CommissionId: 31, CommissionAmount: 700, Status: 'accrued' },
            results: [{ CommissionId: 31, CommissionAmount: 700, Status: 'accrued' }],
          };
        }
        if (normalized.includes('update referralcommission')) {
          return {
            success: true,
            meta: { changes: 1, last_row_id: 0 },
          };
        }
        return null;
      },
    });
    const { app, mockDB: db } = createTestApp({
      route: marketingReferralRoutes,
      routePath: '/marketing-referral',
      role: 'accountant',
      tenantId: 'tenant-1',
      userId: 7,
      mockDB,
    });

    const createRes = await jsonRequest(app, '/marketing-referral/commissions', {
      method: 'POST',
      body: {
        BillingTransactionId: 42,
        PartyId: 8,
        CommissionAmount: 700,
        Percentage: 10,
        BillAmount: 7000,
      },
    });
    expect(createRes.status).toBe(201);
    expect(db.queries.some((query) =>
      query.sql.includes('INSERT OR IGNORE INTO accounting_posting_events')
      && query.params.includes('agent_commission_accrued')
    )).toBe(true);

    const payRes = await jsonRequest(app, '/marketing-referral/commissions/31/pay', {
      method: 'POST',
      body: { PaidDate: '2026-05-12', PaymentMode: 'bank', PaymentReferenceNo: 'BANK-31' },
    });
    expect(payRes.status).toBe(200);
    expect(db.queries.some((query) =>
      query.sql.includes('INSERT OR IGNORE INTO accounting_posting_events')
      && query.params.includes('agent_commission_settled')
    )).toBe(true);

    const cancelRes = await app.request('/marketing-referral/commissions/31?reason=Wrong%20agent', {
      method: 'DELETE',
    });
    expect(cancelRes.status).toBe(200);
    expect(db.queries.some((query) => /DELETE\s+FROM\s+ReferralCommission/i.test(query.sql))).toBe(false);
    expect(db.queries.some((query) =>
      query.sql.includes('INSERT OR IGNORE INTO accounting_posting_events')
      && query.params.includes('agent_commission_cancelled')
    )).toBe(true);
  });
});
