import { describe, expect, it } from 'vitest';
import labRoutes from '../../../src/routes/tenant/lab';
import { createTestApp, jsonRequest } from '../helpers/test-app';

const TENANT_ID = 'tenant-1';

function closedPeriodRow(periodName: string) {
  return {
    id: 1,
    tenant_id: TENANT_ID,
    fiscal_year_id: 1,
    period_name: periodName,
    status: 'closed',
  };
}

function labQueryOverride(sql: string) {
  const normalized = sql.replace(/\s+/g, ' ').toLowerCase();

  if (normalized.includes('from lab_test_catalog') && normalized.includes('where id = ?')) {
    return {
      first: {
        id: 10,
        name: 'CBC',
        price: 600,
        category: 'blood',
        test_type: 'single',
      },
    };
  }

  return null;
}

describe('Lab order billing accounting', () => {
  it('posts a bill-created accounting event for lab order auto-bills', async () => {
    const { app, mockDB } = createTestApp({
      route: labRoutes,
      routePath: '/lab',
      role: 'laboratory',
      tenantId: TENANT_ID,
      queryOverride: labQueryOverride,
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/lab/orders', {
      method: 'POST',
      body: {
        patientId: 1,
        visitId: 11,
        orderDate: '2026-05-10',
        items: [{ labTestId: 10, discount: 0 }],
      },
    });

    expect(res.status).toBe(201);
    expect(mockDB.queries.some((query) =>
      query.sql.includes('INSERT OR IGNORE INTO accounting_posting_events')
      && query.params.includes('billing')
      && query.params.includes('bill_created')
    )).toBe(true);
  });

  it('blocks lab order bill creation in closed accounting periods', async () => {
    const { app, mockDB } = createTestApp({
      route: labRoutes,
      routePath: '/lab',
      role: 'laboratory',
      tenantId: TENANT_ID,
      tables: {
        patients: [{ id: 1, tenant_id: TENANT_ID, name: 'Patient One' }],
        accounting_period_closes: [closedPeriodRow('2026-05')],
      },
      queryOverride: labQueryOverride,
      universalFallback: false,
    });

    const res = await jsonRequest(app, '/lab/orders', {
      method: 'POST',
      body: {
        patientId: 1,
        orderDate: '2026-05-10',
        items: [{ labTestId: 10, discount: 0 }],
      },
    });

    expect(res.status).toBe(409);
    expect(mockDB.queries.some((query) =>
      query.method === 'all' && query.sql.toLowerCase().includes('insert into "bills"')
    )).toBe(false);
  });

  it('posts a bill-created accounting event for extended lab order auto-bills', async () => {
    const { app, mockDB } = createTestApp({
      route: labRoutes,
      routePath: '/lab',
      role: 'laboratory',
      tenantId: TENANT_ID,
      queryOverride: labQueryOverride,
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/lab/orders/extended', {
      method: 'POST',
      body: {
        patientId: 1,
        visitId: 11,
        orderDate: '2026-05-10',
        priority: 'routine',
        items: [{ labTestId: 10, discount: 0 }],
      },
    });

    expect(res.status).toBe(201);
    expect(mockDB.queries.some((query) =>
      query.sql.includes('INSERT OR IGNORE INTO accounting_posting_events')
      && query.params.includes('billing')
      && query.params.includes('bill_created')
    )).toBe(true);
  });

  it('blocks extended lab order bill creation in closed accounting periods', async () => {
    const { app, mockDB } = createTestApp({
      route: labRoutes,
      routePath: '/lab',
      role: 'laboratory',
      tenantId: TENANT_ID,
      tables: {
        patients: [{ id: 1, tenant_id: TENANT_ID, name: 'Patient One' }],
        accounting_period_closes: [closedPeriodRow('2026-05')],
      },
      queryOverride: labQueryOverride,
      universalFallback: false,
    });

    const res = await jsonRequest(app, '/lab/orders/extended', {
      method: 'POST',
      body: {
        patientId: 1,
        orderDate: '2026-05-10',
        priority: 'routine',
        items: [{ labTestId: 10, discount: 0 }],
      },
    });

    expect(res.status).toBe(409);
    expect(mockDB.queries.some((query) =>
      query.method === 'all' && query.sql.toLowerCase().includes('insert into "bills"')
    )).toBe(false);
  });
});
