import { describe, expect, it } from 'vitest';
import otRoutes from '../../src/routes/tenant/ot';
import { createTestApp, jsonRequest } from '../integration/helpers/test-app';

/**
 * Tests for OT Report endpoints.
 *
 * Per docs/ot-blueptint.md §25:
 *   GET /api/ot/reports/daily?date=2026-06-05
 *   GET /api/ot/reports/financial?from=2026-06-01&to=2026-06-30
 *   GET /api/ot/reports/inventory?from=2026-06-01&to=2026-06-30
 *   GET /api/ot/reports/utilization?from=2026-06-01&to=2026-06-30
 */

function makeApp(opts: {
  queryOverride?: (sql: string, params: unknown[]) => { results: unknown[]; first: unknown; success: boolean; meta: Record<string, unknown> } | null;
} = {}) {
  const calls: { sql: string; params: unknown[] }[] = [];
  return {
    calls,
    ...createTestApp({
      route: otRoutes,
      routePath: '/ot',
      role: 'hospital_admin',
      tenantId: '1',
      userId: 1,
      queryOverride(sql, params) {
        const s = sql.toLowerCase();
        calls.push({ sql, params: params as unknown[] });
        if (opts.queryOverride) {
          const result = opts.queryOverride(sql, params);
          if (result) return result;
        }
        // Default: return empty results for any query
        return { first: null, results: [], success: true, meta: {} };
      },
    }),
  };
}

describe('GET /api/ot/reports/daily', () => {
  it('returns 200 with daily report structure', async () => {
    const { app } = makeApp({
      queryOverride(sql) {
        const s = sql.toLowerCase();
        if (s.includes('count(*) as total')) return { first: { total: 5 }, results: [{ total: 5 }], success: true, meta: {} };
        if (s.includes('count(*) as count')) return { first: { count: 3 }, results: [{ count: 3 }], success: true, meta: {} };
        if (s.includes('room_name')) return { first: null, results: [{ room_name: 'OT-1', bookings: 2, utilization_pct: 40 }], success: true, meta: {} };
        if (s.includes('surgeon_name')) return { first: null, results: [{ surgeon_name: 'Dr. A', cases: 2 }], success: true, meta: {} };
        if (s.includes('surgery_type')) return { first: null, results: [{ surgery_type: 'Appendectomy', cases: 1 }], success: true, meta: {} };
        return null;
      },
    });
    const res = await jsonRequest(app, '/ot/reports/daily?date=2026-06-05');
    expect(res.status).toBe(200);
    const body = await res.json() as { report: { date: string; total_scheduled: number; completed: number } };
    expect(body.report.date).toBe('2026-06-05');
    expect(body.report.total_scheduled).toBe(5);
  });

  it('rejects missing date with 400', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/reports/daily');
    expect(res.status).toBe(400);
  });
});

describe('GET /api/ot/reports/financial', () => {
  it('returns 200 with financial report structure', async () => {
    const { app } = makeApp({
      queryOverride(sql) {
        const s = sql.toLowerCase();
        if (s.includes('gross_amount')) return { first: { total_revenue: 500000, total_discount: 25000, net_revenue: 475000 }, results: [], success: true, meta: {} };
        if (s.includes('charge_head')) return { first: null, results: [{ charge_head: 'surgery', total: 300000 }], success: true, meta: {} };
        if (s.includes('commission_amount') && s.includes('chief_surgeon')) return { first: { total: 45000 }, results: [], success: true, meta: {} };
        if (s.includes('commission_amount') && s.includes('anesthetist')) return { first: { total: 20000 }, results: [], success: true, meta: {} };
        return null;
      },
    });
    const res = await jsonRequest(app, '/ot/reports/financial?from=2026-06-01&to=2026-06-30');
    expect(res.status).toBe(200);
    const body = await res.json() as { report: { total_revenue: number; surgery_charges: number } };
    expect(body.report.total_revenue).toBe(500000);
    expect(body.report.surgery_charges).toBe(300000);
  });

  it('rejects missing from/to with 400', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/reports/financial?from=2026-06-01');
    expect(res.status).toBe(400);
  });
});

describe('GET /api/ot/reports/inventory', () => {
  it('returns 200 with inventory report structure', async () => {
    const { app } = makeApp({
      queryOverride(sql) {
        const s = sql.toLowerCase();
        if (s.includes('total_items')) return { first: { total_items: 50, total_value: 75000 }, results: [], success: true, meta: {} };
        if (s.includes('source')) return { first: null, results: [{ source: 'ot_sub_store', items: 30, value: 45000 }], success: true, meta: {} };
        if (s.includes('charge_head')) return { first: null, results: [{ charge_head: 'consumables', items: 25, value: 25000 }], success: true, meta: {} };
        if (s.includes('wasted')) return { first: { items: 3, value: 2500 }, results: [], success: true, meta: {} };
        if (s.includes('returned')) return { first: { items: 5, value: 5000 }, results: [], success: true, meta: {} };
        return null;
      },
    });
    const res = await jsonRequest(app, '/ot/reports/inventory?from=2026-06-01&to=2026-06-30');
    expect(res.status).toBe(200);
    const body = await res.json() as { report: { total_items_used: number; total_value: number } };
    expect(body.report.total_items_used).toBe(50);
  });
});

describe('GET /api/ot/reports/utilization', () => {
  it('returns 200 with utilization report structure', async () => {
    const { app } = makeApp({
      queryOverride(sql) {
        const s = sql.toLowerCase();
        if (s.includes('room_name') && s.includes('total_bookings')) return { first: null, results: [{ room_name: 'OT-1', total_bookings: 20, avg_duration_min: 90, utilization_pct: 75 }], success: true, meta: {} };
        if (s.includes('actual_end') && s.includes('actual_start')) return { first: { avg_duration: 95 }, results: [], success: true, meta: {} };
        if (s.includes('cleaning_duration')) return { first: { avg_duration: 35 }, results: [], success: true, meta: {} };
        if (s.includes('reason')) return { first: null, results: [], success: true, meta: {} };
        return null;
      },
    });
    const res = await jsonRequest(app, '/ot/reports/utilization?from=2026-06-01&to=2026-06-30');
    expect(res.status).toBe(200);
    const body = await res.json() as { report: { room_utilization: Array<{ room_name: string }>; avg_surgery_duration_min: number } };
    expect(body.report.room_utilization.length).toBe(1);
    expect(body.report.avg_surgery_duration_min).toBe(95);
  });
});
