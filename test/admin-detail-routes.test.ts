import { describe, it, expect } from 'vitest';
import adminRoute from '../src/routes/admin/withActionCenterCollections';
import { createTestApp, createTestAppNoRole } from './integration/helpers/test-app';

const TENANT_ID = 'tenant-1';

function makeApp() {
  return createTestApp({
    route: adminRoute,
    routePath: '/admin',
    role: 'hospital_admin',
    tenantId: TENANT_ID,
    universalFallback: true,
    queryOverride: (sql) => {
      if (sql.includes('COUNT(*) AS "totalInvoices"') && sql.includes('COUNT(DISTINCT currency_code) AS "currencyCount"')) {
        return {
          results: [{
            totalInvoices: 1,
            followupDue: 0,
            currentCount: 1,
            days30Count: 0,
            days60Count: 0,
            days90PlusCount: 0,
            currencyCount: 1,
            shadowMismatchCount: 0,
          }],
        };
      }
      if (sql.includes('currency_code AS "currencyCode"') && sql.includes('GROUP BY currency_code')) {
        return {
          results: [{
            currencyCode: 'BDT',
            totalInvoices: 1,
            totalDueMinor: 50000,
            currentMinor: 50000,
            days30Minor: 0,
            days60Minor: 0,
            days90PlusMinor: 0,
            promisedAmountMinor: 0,
            disputedAmountMinor: 0,
          }],
        };
      }
      if (sql.includes('source_key AS "sourceKey"') && sql.includes('FROM filtered')) {
        return { results: [] };
      }
      return null;
    },
  });
}

describe('Admin Hospital Profile — /api/admin/hospital-profile', () => {
  it('returns 200 with profile object', async () => {
    const { app } = makeApp();
    const res = await app.request('/admin/hospital-profile');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('profile');
  });
});

describe('Admin Approval Policies — /api/admin/approval-policies', () => {
  it('returns 200 with policies array', async () => {
    const { app } = makeApp();
    const res = await app.request('/admin/approval-policies');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('policies');
    expect(Array.isArray(body.policies)).toBe(true);
  });
});

describe('Admin Escalation Rules — /api/admin/escalation-rules', () => {
  it('returns 200 with rules array', async () => {
    const { app } = makeApp();
    const res = await app.request('/admin/escalation-rules');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('rules');
    expect(Array.isArray(body.rules)).toBe(true);
  });
});

describe('Admin Notification Rules — /api/admin/notifications/rules', () => {
  it('returns 200 with rules array', async () => {
    const { app } = makeApp();
    const res = await app.request('/admin/notifications/rules');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('rules');
    expect(Array.isArray(body.rules)).toBe(true);
  });
});

describe('Admin Due Receivables — /api/admin/due-receivables', () => {
  it('returns 200 with receivables array + summary', async () => {
    const { app } = makeApp();
    const res = await app.request('/admin/due-receivables');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('receivables');
    expect(Array.isArray(body.receivables)).toBe(true);
    const summary = body.summary as Record<string, unknown>;
    expect(summary).toHaveProperty('totalDue');
  });
});

describe('Admin Inventory Alerts — /api/admin/inventory/alerts', () => {
  it('returns 200 with alerts array + summary', async () => {
    const { app } = makeApp();
    const res = await app.request('/admin/inventory/alerts');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('alerts');
    expect(Array.isArray(body.alerts)).toBe(true);
  });
});

describe('Admin Collection Followups — /api/admin/collection-followups', () => {
  it('returns 200 with followups array', async () => {
    const { app } = makeApp();
    const res = await app.request('/admin/collection-followups');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('followups');
    expect(Array.isArray(body.followups)).toBe(true);
  });
});

describe('Admin Patient Record Access — /api/admin/patient-record-access', () => {
  it('returns 200 with access array + summary', async () => {
    const { app } = makeApp();
    const res = await app.request('/admin/patient-record-access');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('access');
    expect(Array.isArray(body.access)).toBe(true);
  });
});

describe('Admin Doctor Payout — /api/admin/doctor-payout/:id', () => {
  it('returns 200 with payout object for a doctor', async () => {
    const { app } = makeApp();
    const res = await app.request('/admin/doctor-payout/1');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('doctor');
    expect(body).toHaveProperty('earnings');
  });
});

describe('Admin Refund Detail — /api/admin/refunds/:id', () => {
  it('returns 200 with refund object', async () => {
    const { app } = makeApp();
    const res = await app.request('/admin/refunds/1');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('refund');
  });
});

describe('Admin Expense Detail — /api/admin/expenses/:id', () => {
  it('returns 200 with expense object', async () => {
    const { app } = makeApp();
    const res = await app.request('/admin/expenses/1');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('expense');
  });
});

describe('Admin Cash Drawer Detail — /api/admin/cash-drawers/:id', () => {
  it('returns 200 with drawer + transactions + handover', async () => {
    const { app } = makeApp();
    const res = await app.request('/admin/cash-drawers/1');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('summary');
    expect(body).toHaveProperty('transactions');
    expect(body).toHaveProperty('handoverHistory');
  });
});

describe('Admin Shift Handover Detail — /api/admin/shift-handover/:id', () => {
  it('returns 200 with handover object', async () => {
    const { app } = makeApp();
    const res = await app.request('/admin/shift-handover/1');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('handover');
  });
});

describe('Admin Detail Routes — empty-data path (no rows for tenant)', () => {
  it('GET /admin/refunds/1 returns 200 with refund key (mock fallback may return row)', async () => {
    const { app } = createTestApp({
      route: adminRoute,
      routePath: '/admin',
      role: 'hospital_admin',
      tenantId: 'empty-tenant',
      universalFallback: true,
    });
    const res = await app.request('/admin/refunds/1');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('refund');
  });

  it('GET /admin/expenses/1 returns 200 with expense key (mock fallback may return row)', async () => {
    const { app } = createTestApp({
      route: adminRoute,
      routePath: '/admin',
      role: 'hospital_admin',
      tenantId: 'empty-tenant',
      universalFallback: true,
    });
    const res = await app.request('/admin/expenses/1');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('expense');
  });

  it('GET /admin/doctor-payout/1 returns 200 with doctor + earnings keys (mock fallback may return row)', async () => {
    const { app } = createTestApp({
      route: adminRoute,
      routePath: '/admin',
      role: 'hospital_admin',
      tenantId: 'empty-tenant',
      universalFallback: true,
    });
    const res = await app.request('/admin/doctor-payout/1');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('doctor');
    expect(Array.isArray(body.earnings)).toBe(true);
  });
});

describe('Admin Detail Routes — invalid ID format (returns 400)', () => {
  it('GET /admin/refunds/abc returns 400 (non-numeric :id rejected)', async () => {
    const { app } = makeApp();
    const res = await app.request('/admin/refunds/abc');
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('error', 'Invalid id');
  });

  it('GET /admin/expenses/abc returns 400 (non-numeric :id rejected)', async () => {
    const { app } = makeApp();
    const res = await app.request('/admin/expenses/abc');
    expect(res.status).toBe(400);
  });

  it('GET /admin/doctor-payout/xyz returns 400 (non-numeric :id rejected)', async () => {
    const { app } = makeApp();
    const res = await app.request('/admin/doctor-payout/xyz');
    expect(res.status).toBe(400);
  });

  it('GET /admin/cash-drawers/-1 returns 400 (signed :id rejected)', async () => {
    const { app } = makeApp();
    const res = await app.request('/admin/cash-drawers/-1');
    expect(res.status).toBe(400);
  });
});

describe('Admin Detail Routes — tenant auth boundary', () => {
  it('GET /admin/cash-drawers/1 returns 401/403 when no tenant is set', async () => {
    const { app } = createTestAppNoRole({
      route: adminRoute,
      routePath: '/admin',
      tenantId: '',
    });
    const res = await app.request('/admin/cash-drawers/1');
    expect([401, 403]).toContain(res.status);
  });
});
