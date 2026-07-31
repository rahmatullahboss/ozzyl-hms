import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../src/types';
import labMachines from '../src/routes/tenant/labMachines';
import { createMockDB } from './integration/helpers/mock-db';

function createApp(rule: { rule_type: string; is_blocking: number; error_message: string; rule_config: string }) {
  const mock = createMockDB({
    queryOverride(sql, method) {
      const lower = sql.toLowerCase();
      if (lower.includes('from lab_machines')) {
        return { first: { id: 1 }, results: [], success: true, meta: {} };
      }
      if (lower.includes('insert into lab_machine_result_log') && method === 'run') {
        return { success: true, meta: { last_row_id: 44, changes: 1 } };
      }
      if (lower.includes('from lab_machine_test_map')) {
        return {
          first: {
            lab_test_id: 7,
            component_id: null,
            machine_unit: 'mg/dL',
            conversion_factor: 1,
            normal_range: '70-110',
            critical_low: 30,
            critical_high: 500,
            unit: 'mg/dL',
            code: 'GLU',
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
        return { first: { total: 1 }, results: [], success: true, meta: {} };
      }
      if (lower.includes('from lab_calibrations')) {
        return { first: { total: 0 }, results: [], success: true, meta: {} };
      }
      if (lower.includes('from lab_qc_results')) {
        return {
          first: { result_value: 100, is_out_of_range: 0, westgard_violations: '[]', created_at: new Date().toISOString() },
          results: [],
          success: true,
          meta: {},
        };
      }
      if (lower.includes('select id, result, result_numeric') && lower.includes('from lab_order_items')) {
        return { first: { id: 10, result: null, result_numeric: null, machine_result_log_id: null, status: 'pending' }, results: [], success: true, meta: {} };
      }
      if (lower.includes('from lab_validation_rules')) {
        return { results: [rule], success: true, meta: {} };
      }
      if (lower.includes('from lab_inventory_policy')) {
        return { first: null, results: [], success: true, meta: {} };
      }
      if (lower.includes('insert into lis_unmatched_results') && method === 'run') {
        return { success: true, meta: { changes: 1 } };
      }
      if (lower.includes('update lab_machine_result_log') && method === 'run') {
        return { success: true, meta: { changes: 1 } };
      }
      if (lower.includes('update lab_machines') && method === 'run') {
        return { success: true, meta: { changes: 1 } };
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

describe('machine analyzer result validation gate', () => {
  it('stages blocking validation failures with patient context without writing the result', async () => {
    const { app, mock } = createApp({
      rule_type: 'range',
      is_blocking: 1,
      error_message: 'Glucose outside instrument validation range',
      rule_config: JSON.stringify({ min: 70, max: 110 }),
    });

    const res = await app.request('/lab-machines/1/receive', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        barcode: 'BC-10',
        results: [{ testCode: 'GLU', value: '999', units: 'mg/dL', resultStatus: 'F' }],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { outcomes: Array<{ reason?: string; validation?: string[]; disposition?: string }> };
    expect(body.outcomes[0]).toMatchObject({
      reason: 'validation_blocked',
      disposition: 'validation_blocked',
      validation: ['Glucose outside instrument validation range'],
    });
    const inboxInsert = mock.queries.find((q) => q.sql.includes('INSERT INTO lis_analyzer_inbox'));
    expect(inboxInsert?.params).toContain('fail');
    expect(inboxInsert?.params).toContain('validation_blocked');
    expect(inboxInsert?.params.some((param) => String(param).includes('Glucose outside instrument validation range'))).toBe(true);
    expect(mock.queries.some((q) => q.sql.includes('INSERT INTO lis_unmatched_results'))).toBe(false);
    expect(mock.queries.some((q) => q.sql.includes('UPDATE lab_order_items SET'))).toBe(false);
  });

  it('preserves non-blocking validation warnings in the staged inbox observation', async () => {
    const { app, mock } = createApp({
      rule_type: 'range',
      is_blocking: 0,
      error_message: 'Glucose warning threshold exceeded',
      rule_config: JSON.stringify({ min: 70, max: 110 }),
    });

    const res = await app.request('/lab-machines/1/receive', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        barcode: 'BC-10',
        results: [{ testCode: 'GLU', value: '125', units: 'mg/dL', resultStatus: 'F', comments: 'Analyzer final' }],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { outcomes: Array<{ validationWarnings?: string[]; disposition?: string }> };
    expect(body.outcomes[0]).toMatchObject({
      disposition: 'review_required',
      validationWarnings: ['Glucose warning threshold exceeded'],
    });
    const inboxInsert = mock.queries.find((q) => q.sql.includes('INSERT INTO lis_analyzer_inbox'));
    expect(inboxInsert?.params).toContain('pass');
    expect(inboxInsert?.params).toContain('review_required');
    expect(inboxInsert?.params.some((param) => String(param).includes('Glucose warning threshold exceeded'))).toBe(true);
    expect(mock.queries.some((q) => q.sql.includes('UPDATE lab_order_items SET'))).toBe(false);
  });
});
