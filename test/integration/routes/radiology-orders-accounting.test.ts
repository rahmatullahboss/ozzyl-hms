import { describe, expect, it } from 'vitest';
import radiologyOrders from '../../../src/routes/tenant/radiology/orders';
import { createTestApp, jsonRequest } from '../helpers/test-app';

const TENANT_ID = 'tenant-1';

function radiologyQueryOverride(sql: string) {
  const normalized = sql.replace(/\s+/g, ' ').toLowerCase();

  if (normalized.includes('from radiology_imaging_items') && (normalized.includes('where id = ?') || normalized.includes('where i.id = ?'))) {
    return {
      first: {
        id: 10,
        imaging_type_id: 2,
        imaging_type_name: 'X-Ray',
        name: 'Chest X-Ray',
        procedure_code: 'CXR',
        price: 12,
        billing_service_item_id: 901,
      },
    };
  }

  if (normalized.includes('from radiology_imaging_types') && normalized.includes('where id = ?')) {
    return { first: { id: 2, name: 'X-Ray' } };
  }

  return null;
}

describe('Radiology order billing accounting', () => {
  it('posts a bill-created accounting event for auto-created radiology bills', async () => {
    const { app, mockDB } = createTestApp({
      route: radiologyOrders,
      routePath: '/radiology/orders',
      role: 'doctor',
      tenantId: TENANT_ID,
      queryOverride: radiologyQueryOverride,
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/radiology/orders', {
      method: 'POST',
      body: {
        patient_id: 1,
        visit_id: 11,
        imaging_item_id: 10,
        imaging_date: '2026-05-10',
        urgency: 'urgent',
      },
    });

    expect(res.status).toBe(201);
    expect(mockDB.queries.some((query) =>
      query.sql.includes('INSERT OR IGNORE INTO accounting_posting_events')
      && query.params.includes('billing')
      && query.params.includes('bill_created')
    )).toBe(true);
  });

  it('blocks radiology bill creation in closed accounting periods', async () => {
    const { app, mockDB } = createTestApp({
      route: radiologyOrders,
      routePath: '/radiology/orders',
      role: 'doctor',
      tenantId: TENANT_ID,
      tables: {
        patients: [{ id: 1, tenant_id: TENANT_ID }],
        visits: [{ id: 11, tenant_id: TENANT_ID, patient_id: 1 }],
        accounting_period_closes: [{
          tenant_id: TENANT_ID,
          period_name: '2026-05',
          status: 'closed',
        }],
      },
      queryOverride: radiologyQueryOverride,
      universalFallback: false,
    });

    const res = await jsonRequest(app, '/radiology/orders', {
      method: 'POST',
      body: {
        patient_id: 1,
        visit_id: 11,
        imaging_item_id: 10,
        imaging_date: '2026-05-10',
      },
    });

    expect(res.status).toBe(409);
    expect(mockDB.queries.some((query) =>
      query.method === 'run' && query.sql.toLowerCase().includes('insert into bills')
    )).toBe(false);
  });
});
