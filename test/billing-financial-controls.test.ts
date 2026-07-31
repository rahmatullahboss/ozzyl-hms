import { describe, expect, it } from 'vitest';
import billingCancellationRoutes from '../src/routes/tenant/billingCancellation';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';
import { createMockDB } from './integration/helpers/mock-db';

describe('Billing financial controls', () => {
  it('blocks invoice item cancellation after any payment is received', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();

        if (lower.includes('from invoice_items') && lower.includes('join bills')) {
          return {
            first: {
              id: 10,
              bill_id: 99,
              status: 'active',
              bill_paid: 100,
              bill_status: 'partially_paid',
            },
          };
        }

        return null;
      },
      universalFallback: false,
    });

    const { app } = createTestApp({
      route: billingCancellationRoutes,
      routePath: '/billing-cancellation',
      role: 'accountant',
      mockDB,
    });

    const res = await jsonRequest(app, '/billing-cancellation/item', {
      method: 'PUT',
      body: {
        invoice_item_id: 10,
        reason: 'Wrong service selected',
      },
    });

    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Use credit note instead');

    const itemUpdate = mockDB.queries.find((query) =>
      query.method === 'run' && query.sql.toLowerCase().includes('update invoice_items')
    );
    expect(itemUpdate).toBeUndefined();
  });

  it('records cancellation reversals instead of deleting income rows', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();

        if (lower.includes('from bills')) {
          return {
            first: {
              id: 99,
              status: 'open',
              paid: 0,
              total: 500,
            },
          };
        }

        return null;
      },
      universalFallback: false,
    });

    const { app } = createTestApp({
      route: billingCancellationRoutes,
      routePath: '/billing-cancellation',
      role: 'accountant',
      mockDB,
    });

    const res = await jsonRequest(app, '/billing-cancellation/bill/99', {
      method: 'PUT',
      body: {
        reason: 'Duplicate invoice',
      },
    });

    expect(res.status).toBe(200);
    expect(mockDB.queries.some((query) => query.sql.toLowerCase().includes('delete from income'))).toBe(false);
    expect(mockDB.queries.some((query) => query.sql.toLowerCase().includes('insert into income'))).toBe(true);
    expect(mockDB.queries.some((query) =>
      query.sql.includes('INSERT OR IGNORE INTO accounting_posting_events')
      && query.params.includes('bill_cancelled')
    )).toBe(true);
  });
});
