import { describe, expect, it } from 'vitest';
import fiscalYearRoutes from '../../../src/routes/tenant/fiscalYears';
import { createTestApp } from '../helpers/test-app';

describe('fiscal year accounting period locks', () => {
  it('closes a fiscal year and creates monthly accounting period locks', async () => {
    const { app, mockDB } = createTestApp({
      route: fiscalYearRoutes,
      routePath: '/fiscal-years',
      role: 'director',
      tables: {
        fiscal_years: [{
          id: 3,
          tenant_id: 'tenant-1',
          fiscal_year_name: 'FY 2026',
          start_date: '2026-01-01',
          end_date: '2026-03-31',
          is_closed: 0,
        }],
      },
    });

    const res = await app.request('/fiscal-years/3/close', { method: 'PUT' });
    const body = await res.json() as { periodsClosed?: string[] };

    expect(res.status).toBe(200);
    expect(body.periodsClosed).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(mockDB.queries.some((q) => /UPDATE fiscal_years SET is_closed = 1/i.test(q.sql))).toBe(true);
    expect(mockDB.queries.filter((q) => /INSERT OR IGNORE INTO accounting_period_closes/i.test(q.sql))).toHaveLength(3);
    expect(mockDB.queries.some((q) => /INSERT INTO accounting_audit_logs/i.test(q.sql) && /'close'/.test(q.sql))).toBe(true);
  });

  it('reopens a closed fiscal year and unlocks non-audited accounting periods', async () => {
    const { app, mockDB } = createTestApp({
      route: fiscalYearRoutes,
      routePath: '/fiscal-years',
      role: 'director',
      tables: {
        fiscal_years: [{
          id: 4,
          tenant_id: 'tenant-1',
          fiscal_year_name: 'FY 2026',
          start_date: '2026-04-01',
          end_date: '2026-06-30',
          is_closed: 1,
        }],
      },
    });

    const res = await app.request('/fiscal-years/4/reopen', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ remark: 'Correction before final audit' }),
    });
    const body = await res.json() as { periodsReopened?: string[] };

    expect(res.status).toBe(200);
    expect(body.periodsReopened).toEqual(['2026-04', '2026-05', '2026-06']);
    expect(mockDB.queries.some((q) => /UPDATE fiscal_years\s+SET is_closed = 0/i.test(q.sql))).toBe(true);
    expect(mockDB.queries.some((q) => /UPDATE accounting_period_closes\s+SET status = 'open'/i.test(q.sql))).toBe(true);
    expect(mockDB.queries.some((q) => /INSERT INTO accounting_audit_logs/i.test(q.sql) && /'update'/.test(q.sql))).toBe(true);
  });

  it('blocks reopening a fiscal year that contains audited periods', async () => {
    const { app, mockDB } = createTestApp({
      route: fiscalYearRoutes,
      routePath: '/fiscal-years',
      role: 'director',
      tables: {
        fiscal_years: [{
          id: 5,
          tenant_id: 'tenant-1',
          fiscal_year_name: 'FY 2026',
          start_date: '2026-07-01',
          end_date: '2026-09-30',
          is_closed: 1,
        }],
        accounting_period_closes: [{
          id: 10,
          tenant_id: 'tenant-1',
          fiscal_year_id: 5,
          period_name: '2026-08',
          status: 'audited',
        }],
      },
    });

    const res = await app.request('/fiscal-years/5/reopen', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ remark: 'Attempt audited reopen' }),
    });
    const body = await res.json() as { error?: string };

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/audited accounting period 2026-08/i);
    expect(mockDB.queries.some((q) => /UPDATE fiscal_years\s+SET is_closed = 0/i.test(q.sql))).toBe(false);
  });
});
