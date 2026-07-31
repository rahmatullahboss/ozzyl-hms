import { describe, expect, it } from 'vitest';
import commissionRoutes from '../src/routes/tenant/commissions';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';
import { createMockDB } from './integration/helpers/mock-db';

describe('Commission settlement accounting', () => {
  it('records settlement through the central accounting posting engine', async () => {
    const mockDB = createMockDB({
      tables: {
        doctor_commission_accruals: [
          { id: 1, tenant_id: 'tenant-1', doctor_id: 10, commission_amount: 600, status: 'approved' },
          { id: 2, tenant_id: 'tenant-1', doctor_id: 10, commission_amount: 400, status: 'approved' },
        ],
        doctor_commission_settlements: [],
      },
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from doctor_commission_accruals a') && normalized.includes('as payable_amount')) {
          return {
            results: [
              { id: 1, doctor_id: 10, commission_amount: 600, payable_amount: 600, status: 'approved', bill_is_paid: 1 },
              { id: 2, doctor_id: 10, commission_amount: 400, payable_amount: 400, status: 'approved', bill_is_paid: 1 },
            ],
          };
        }
        if (normalized.includes('update doctor_commission_accruals')) {
          return {
            success: true,
            meta: { changes: 2, last_row_id: 0 },
          };
        }
        if (normalized.includes('select id from doctor_commission_settlements')) {
          return { first: { id: 91 } };
        }
        return null;
      },
    });
    const { app } = createTestApp({
      route: commissionRoutes,
      routePath: '/commissions',
      role: 'accountant',
      tenantId: 'tenant-1',
      userId: 7,
      mockDB,
    });

    const res = await jsonRequest(app, '/commissions/settle', {
      method: 'POST',
      body: {
        doctorId: 10,
        accrualIds: [1, 2],
        paymentMode: 'bank',
        referenceNo: 'BANK-001',
        settlementDate: '2026-05-08',
      },
    });

    expect(res.status).toBe(200);
    expect(mockDB.queries.some((query) =>
      query.sql.includes('INSERT OR IGNORE INTO accounting_posting_events')
      && query.params.includes('commission_settled')
    )).toBe(true);
    expect(mockDB.queries.some((query) => query.sql.includes('INSERT INTO journal_entries'))).toBe(false);
  });

  it('does not post a bulk settlement voucher when selected accruals were already claimed', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from doctor_commission_accruals a') && normalized.includes('as payable_amount')) {
          return {
            results: [
              { id: 1, doctor_id: 10, commission_amount: 600, status: 'accrued', bill_is_paid: 1 },
              { id: 2, doctor_id: 10, commission_amount: 400, status: 'approved', bill_is_paid: 1 },
            ],
          };
        }
        if (normalized.includes('update doctor_commission_accruals')) {
          return {
            success: true,
            meta: { changes: 0, last_row_id: 0 },
          };
        }
        return null;
      },
    });
    const { app } = createTestApp({
      route: commissionRoutes,
      routePath: '/commissions',
      role: 'accountant',
      tenantId: 'tenant-1',
      userId: 7,
      mockDB,
    });

    const res = await jsonRequest(app, '/commissions/settle', {
      method: 'POST',
      body: {
        doctorId: 10,
        accrualIds: [1, 2],
        paymentMode: 'bank',
        referenceNo: 'BANK-001',
        settlementDate: '2026-05-08',
      },
    });

    expect(res.status).toBe(409);
    expect(mockDB.queries.some((query) =>
      query.sql.includes('INSERT OR IGNORE INTO accounting_posting_events')
      && query.params.includes('commission_settled')
    )).toBe(false);
  });

  it('blocks doctor commission settlement while the source invoice still has due', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from doctor_commission_accruals a') && normalized.includes('as payable_amount')) {
          return {
            results: [
              { id: 1, doctor_id: 10, commission_amount: 600, status: 'accrued', bill_is_paid: 0 },
            ],
          };
        }
        return null;
      },
    });
    const { app } = createTestApp({
      route: commissionRoutes,
      routePath: '/commissions',
      role: 'accountant',
      tenantId: 'tenant-1',
      userId: 7,
      mockDB,
    });

    const res = await jsonRequest(app, '/commissions/settle', {
      method: 'POST',
      body: {
        doctorId: 10,
        accrualIds: [1],
        paymentMode: 'cash',
        settlementDate: '2026-05-08',
      },
    });

    expect(res.status).toBe(409);
    expect(mockDB.queries.some((query) => query.sql.toLowerCase().includes('update doctor_commission_accruals'))).toBe(false);
    expect(mockDB.queries.some((query) => query.sql.includes('INSERT OR IGNORE INTO accounting_posting_events'))).toBe(false);
  });
});
