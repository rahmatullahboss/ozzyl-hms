import { describe, expect, it } from 'vitest';
import empCashRoutes from '../../../src/routes/tenant/empCash';
import { createTestApp, jsonRequest } from '../helpers/test-app';

describe('cashier wise employee cash reports', () => {
  it('requires a finance or cashier-facing role before listing cash transactions', async () => {
    const { app, mockDB } = createTestApp({
      route: empCashRoutes,
      routePath: '/emp-cash',
      role: 'nurse',
      tenantId: 'tenant-1',
    });

    const res = await jsonRequest(app, '/emp-cash?date=2026-05-10');

    expect(res.status).toBe(403);
    expect(mockDB.queries.some((q) => q.sql.includes('emp_cash_transactions'))).toBe(false);
  });

  it('blocks a receptionist from listing another cashier cash transactions', async () => {
    const { app, mockDB } = createTestApp({
      route: empCashRoutes,
      routePath: '/emp-cash',
      role: 'receptionist',
      userId: 7,
      tenantId: 'tenant-1',
    });

    const res = await jsonRequest(app, '/emp-cash?date=2026-05-10&employee_id=8');
    const body = await res.json() as { error?: string };

    expect(res.status).toBe(403);
    expect(body.error).toMatch(/own cash/i);
    expect(mockDB.queries.some((q) => q.sql.includes('emp_cash_transactions'))).toBe(false);
  });

  it('scopes receptionist cashier summary to their own employee cash rows', async () => {
    const { app, mockDB } = createTestApp({
      route: empCashRoutes,
      routePath: '/emp-cash',
      role: 'receptionist',
      userId: 7,
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        if (sql.includes('GROUP BY ect.employee_id')) {
          return { results: [{ employee_id: 7, employee_name: 'Receptionist', total_in: 100, total_out: 0, net: 100 }] };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/emp-cash/summary?date=2026-05-10');

    expect(res.status).toBe(200);
    const summaryQuery = mockDB.queries.find((q) => q.sql.includes('GROUP BY ect.employee_id'));
    expect(summaryQuery?.sql).toMatch(/ect\.employee_id = \?/);
    expect(summaryQuery?.params).toContain(7);
  });

  it('keeps non-cash deposit adjustments out of cashier net cash summary', async () => {
    const { app, mockDB } = createTestApp({
      route: empCashRoutes,
      routePath: '/emp-cash',
      role: 'accountant',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        if (sql.includes('GROUP BY ect.employee_id')) {
          return { results: [{ employee_id: 1, employee_name: 'Cashier', total_in: 1000, total_out: 200, net: 800 }] };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/emp-cash/summary?date=2026-05-10');

    expect(res.status).toBe(200);
    const summaryQuery = mockDB.queries.find((q) => q.sql.includes('GROUP BY ect.employee_id'));
    expect(summaryQuery?.sql).toContain('SalesReturn');
    expect(summaryQuery?.sql).toContain('ReturnDeposit');
    expect(summaryQuery?.sql).toContain('CashDiscountGiven');
    expect(summaryQuery?.sql).not.toContain('DepositDeduct');
  });

  it('rejects invalid cashier report dates before querying cash rows', async () => {
    const { app, mockDB } = createTestApp({
      route: empCashRoutes,
      routePath: '/emp-cash',
      role: 'accountant',
      tenantId: 'tenant-1',
    });

    const res = await jsonRequest(app, '/emp-cash?date=2026-02-31');
    const body = await res.json() as { error?: string };

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/valid date/i);
    expect(mockDB.queries.some((q) => q.sql.includes('emp_cash_transactions'))).toBe(false);
  });
});
