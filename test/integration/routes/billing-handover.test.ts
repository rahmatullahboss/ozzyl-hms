import { describe, expect, it } from 'vitest';
import billingHandoverRoutes from '../../../src/routes/tenant/billingHandover';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import { TENANT_1 } from '../helpers/fixtures';

const HANDOVER = {
  id: 9,
  tenant_id: TENANT_1.id,
  handover_type: 'cashier',
  handover_by: 1,
  handover_to: 2,
  handover_amount: 1500,
  due_amount: 0,
  status: 'pending',
};

describe('Billing handover routes', () => {
  it('limits non-supervisor handover list queries to the current user', async () => {
    const { app, mockDB } = createTestApp({
      route: billingHandoverRoutes,
      routePath: '/billing-handover',
      role: 'reception',
      userId: 1,
      tenantId: TENANT_1.id,
      tables: { billing_handovers: [HANDOVER] },
    });

    const res = await jsonRequest(app, '/billing-handover');

    expect(res.status).toBe(200);
    const listQuery = mockDB.queries.find((q) => q.sql.toLowerCase().includes('from billing_handovers h'));
    expect(listQuery?.sql).toMatch(/handover_by = \? OR h\.handover_to = \?/i);
    expect(listQuery?.params).toEqual([TENANT_1.id, 1, 1]);
  });

  it('blocks non-supervisor staff from querying another staff member pending handovers', async () => {
    const { app } = createTestApp({
      route: billingHandoverRoutes,
      routePath: '/billing-handover',
      role: 'reception',
      userId: 1,
      tenantId: TENANT_1.id,
    });

    const res = await jsonRequest(app, '/billing-handover/pending/2');

    expect(res.status).toBe(403);
  });

  it('blocks non-recipient staff from receiving another user handover', async () => {
    const { app, mockDB } = createTestApp({
      route: billingHandoverRoutes,
      routePath: '/billing-handover',
      role: 'reception',
      userId: 1,
      tenantId: TENANT_1.id,
      queryOverride(sql) {
        if (sql.toLowerCase().includes('from billing_handovers') && sql.toLowerCase().includes('where id = ?')) {
          return { first: HANDOVER, results: [HANDOVER] };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/billing-handover/9/receive', {
      method: 'PUT',
      body: { remarks: 'Trying direct API call' },
    });

    expect(res.status).toBe(403);
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().startsWith('update billing_handovers'))).toBe(false);
  });

  it('audits created handovers', async () => {
    const { app, mockDB } = createTestApp({
      route: billingHandoverRoutes,
      routePath: '/billing-handover',
      role: 'hospital_admin',
      userId: 1,
      tenantId: TENANT_1.id,
    });

    const res = await jsonRequest(app, '/billing-handover', {
      method: 'POST',
      body: {
        handover_to: 2,
        handover_amount: 1500,
        due_amount: 200,
        handover_type: 'user',
        remarks: 'End of shift',
      },
    });

    expect(res.status).toBe(201);
    const handoverInsert = mockDB.queries.find((q) => q.sql.toLowerCase().includes('insert into billing_handovers'));
    expect(handoverInsert?.params).toContain('partial');
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into audit_logs'))).toBe(true);
  });

  it('audits authorized handover receipt and posts the cash transfer event', async () => {
    const { app, mockDB } = createTestApp({
      route: billingHandoverRoutes,
      routePath: '/billing-handover',
      role: 'reception',
      userId: 2,
      tenantId: TENANT_1.id,
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from billing_handovers') && normalized.includes('where id = ?')) {
          return { first: HANDOVER, results: [HANDOVER] };
        }
        if (normalized.trim().startsWith('update billing_handovers')) {
          return { success: true, meta: { changes: 1 } };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/billing-handover/9/receive', {
      method: 'PUT',
      body: { remarks: 'Received and counted' },
    });

    expect(res.status).toBe(200);
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into audit_logs'))).toBe(true);
    const postingEvent = mockDB.queries.find((q) => q.sql.toLowerCase().includes('insert or ignore into accounting_posting_events'));
    expect(postingEvent?.params).toContain('cash_handover');
    expect(postingEvent?.params).toContain('billing_handover');
  });
});
