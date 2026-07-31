import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../src/types';
import labMachines, { normalizeQualitativeResult } from '../src/routes/tenant/labMachines';
import { createMockDB } from './integration/helpers/mock-db';

function createApp() {
  const mock = createMockDB({
    queryOverride(sql) {
      const lower = sql.toLowerCase();
      if (lower.includes('from lab_machines')) {
        return { first: { id: 1 }, results: [], success: true, meta: {} };
      }
      if (lower.includes('insert into lab_machine_result_log')) {
        return { success: true, meta: { last_row_id: 44, changes: 1 } };
      }
      if (lower.includes('from lab_machine_test_map')) {
        return {
          first: {
            lab_test_id: 7,
            component_id: null,
            machine_unit: null,
            conversion_factor: 1,
            qualitative_map_json: JSON.stringify({ POS: 'Positive', Detected: 'Positive', NEG: 'Negative' }),
            normal_range: null,
            critical_low: null,
            critical_high: null,
            unit: null,
            code: 'MTB',
          },
          results: [],
          success: true,
          meta: {},
        };
      }
      if (lower.includes('from lab_order_items loi') && lower.includes('join lab_orders lo')) {
        const candidate = {
          id: 10,
          lab_order_id: 20,
          specimen_id: 30,
          patient_id: 40,
          bill_id: 77,
          bill_status: 'paid',
          bill_total: 500,
          bill_paid: 500,
        };
        return {
          first: candidate,
          results: [candidate],
          success: true,
          meta: {},
        };
      }
      if (lower.includes('from lab_qc_ranges')) {
        return { first: { total: 0 }, results: [], success: true, meta: {} };
      }
      if (lower.includes('select id, result, result_numeric') && lower.includes('from lab_order_items')) {
        return { first: { id: 10, result: null, result_numeric: null, machine_result_log_id: null, status: 'pending' }, results: [], success: true, meta: {} };
      }
      if (lower.includes('from lab_validation_rules')) {
        return { results: [], success: true, meta: {} };
      }
      if (lower.includes('from lab_inventory_policy')) {
        return { first: null, results: [], success: true, meta: {} };
      }
      if (lower.includes('select id from lab_reports')) {
        return { first: { id: 55 }, results: [], success: true, meta: {} };
      }
      if (lower.includes('insert into lab_results')) {
        return { success: true, meta: { last_row_id: 66, changes: 1 } };
      }
      if (lower.includes('count(*) as cnt')) {
        return { results: [{ cnt: 0 }], success: true, meta: {} };
      }
      return null;
    },
  });

  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.set('tenantId', '1');
    c.set('userId', '9');
    c.set('role', 'lab_tech' as any);
    c.env = {
      DB: mock.db,
      KV: { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [] }) } as any,
      ENVIRONMENT: 'development',
      UPLOADS: { put: async () => ({}), get: async () => null, delete: async () => {} } as any,
    } as any;
    await next();
  });
  app.route('/lab-machines', labMachines);
  app.onError((err, c) => c.json({ error: err.message }, (err as any).status ?? 500));
  return { app, mock };
}

describe('lab machine qualitative result mapping', () => {
  it('normalizes analyzer qualitative aliases case-insensitively', () => {
    expect(normalizeQualitativeResult('pos', JSON.stringify({ POS: 'Positive' }))).toEqual({ value: 'Positive', mapped: true, source: 'POS' });
    expect(normalizeQualitativeResult('Unknown', JSON.stringify({ POS: 'Positive' }))).toEqual({ value: 'Unknown', mapped: false });
    expect(normalizeQualitativeResult('POS', 'not-json')).toEqual({ value: 'POS', mapped: false });
  });

  it('stages raw and canonical qualitative values without writing canonical results', async () => {
    const { app, mock } = createApp();
    const res = await app.request('/lab-machines/1/receive', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        barcode: 'BC-10',
        results: [{ testCode: 'MTB', value: 'POS', resultStatus: 'F', comments: 'Analyzer final' }],
      }),
    });

    expect(res.status).toBe(200);
    const inboxInsert = mock.queries.find((q) => q.sql.includes('INSERT INTO lis_analyzer_inbox'));
    expect(inboxInsert?.params).toContain('POS');
    expect(inboxInsert?.params).toContain('Positive');
    expect(inboxInsert?.params.some((param) => String(param).includes('Analyzer final'))).toBe(true);
    expect(mock.queries.some((q) => q.sql.includes('UPDATE lab_order_items SET'))).toBe(false);
    expect(mock.queries.some((q) => q.sql.includes('INSERT INTO lab_results'))).toBe(false);
  });
});
