import { describe, expect, it } from 'vitest';
import dashboardRoutes from '../../../src/routes/tenant/dashboard';
import { createTestApp } from '../helpers/test-app';

/**
 * Coverage for the new ?date=YYYY-MM-DD query param on GET /api/dashboard/stats.
 * When omitted or empty, the endpoint must default to today (GMT+6) and remain
 * backward-compatible with every existing caller.
 */
describe('admin dashboard — /stats ?date= filter', () => {
  // Capture every value the endpoint binds to the "today / reportDate" param.
  // The mock returns these as observable evidence that the date flowed through.
  const capturedDates: string[] = [];

  function makeApp(role: 'hospital_admin' | 'md' = 'hospital_admin') {
    capturedDates.length = 0;
    return createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role,
      tenantId: 'tenant-1',
      queryOverride: (sql, params) => {
        const lower = sql.toLowerCase();
        // Capture any date-shaped binding the SQL receives.
        if (Array.isArray(params)) {
          for (const p of params) {
            if (typeof p === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p)) {
              capturedDates.push(p);
            }
          }
        }
        // Return empty rows for all queries so we only assert the date flow.
        if (lower.includes('from audit_logs')) {
          return { results: [] };
        }
        if (lower.includes('from bill_items') && lower.includes('group by item_category')) {
          return { results: [] };
        }
        return { results: [] };
      },
    });
  }

  it('defaults to today (GMT+6) when no date param is provided', async () => {
    const { app } = makeApp();
    const res = await app.request('/dashboard/stats');
    expect(res.status).toBe(200);
    // The endpoint must bind at least one date-shaped param. We don't pin the
    // exact value (server clock varies) — only that every captured date is a
    // valid YYYY-MM-DD and the SQL received *some* date.
    expect(capturedDates.length).toBeGreaterThan(0);
    for (const d of capturedDates) {
      expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('accepts a custom date and threads it through every "today"-keyed query', async () => {
    const { app } = makeApp();
    const custom = '2026-01-15';
    const res = await app.request(`/dashboard/stats?date=${custom}`);
    expect(res.status).toBe(200);
    // The picked date must be among the bound params (the "today" key for
    // today's KPIs). Other derived dates (monthStart, lastMonth, weekStart…)
    // will also appear — those are correctly derived from `custom`, not from
    // the server's "today" clock. We assert the picked date was used as the
    // anchor by checking that one of the unique dates is `custom` itself.
    const uniqueDates = Array.from(new Set(capturedDates));
    expect(uniqueDates).toContain(custom);
    // Server-clock "today" must NOT appear as a binding when a custom date is
    // requested. The mock's behavior can't tell us server time, but we *can*
    // confirm `custom` is the anchor by checking that the 7-days-ago date
    // (derived from `today`) equals `custom - 6 days` rather than a clock value.
    const expectedSevenDaysAgo = '2026-01-09';
    expect(uniqueDates).toContain(expectedSevenDaysAgo);
  });

  it('treats an empty date param the same as no param (defaults to today)', async () => {
    const { app } = makeApp();
    const res = await app.request('/dashboard/stats?date=');
    expect(res.status).toBe(200);
    // Every captured date must be YYYY-MM-DD shaped. We don't pin the value
    // because the server clock varies — but no capture should be empty or
    // malformed, which would indicate the empty string was passed through.
    for (const d of capturedDates) {
      expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(capturedDates.length).toBeGreaterThan(0);
  });

  it('rejects malformed date param with 400', async () => {
    const { app } = makeApp();
    const res = await app.request('/dashboard/stats?date=not-a-date');
    expect(res.status).toBe(400);
    const body = await res.json() as { error?: string };
    expect(body.error).toMatch(/date/i);
  });

  it('rejects partial date param (month only) with 400', async () => {
    const { app } = makeApp();
    const res = await app.request('/dashboard/stats?date=2026-01');
    expect(res.status).toBe(400);
  });

  it('MD role can call /stats?date= (RBAC unchanged)', async () => {
    const { app } = makeApp('md');
    const res = await app.request('/dashboard/stats?date=2026-01-15');
    expect(res.status).toBe(200);
  });
});
