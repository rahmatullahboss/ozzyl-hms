import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../src/types';
import labMachines, { isAnalyzerQcIdentifier, isAnalyzerQcResult } from '../src/routes/tenant/labMachines';
import { createMockDB } from './integration/helpers/mock-db';

function createApp(options: { qcValue?: string; controlConfigured?: boolean } = {}) {
  const qcValue = options.qcValue ?? '5.4';
  const controlConfigured = options.controlConfigured ?? true;
  const mock = createMockDB({
    queryOverride(sql) {
      const lower = sql.toLowerCase();
      if (lower.includes('from lab_machines')) {
        return { first: { id: 1 }, results: [], success: true, meta: {} };
      }
      if (lower.includes('insert into lab_machine_result_log')) {
        return { success: true, meta: { last_row_id: 88, changes: 1 } };
      }
      if (lower.includes('from lab_machine_test_map')) {
        return {
          first: {
            lab_test_id: 7,
            component_id: null,
            machine_unit: null,
            conversion_factor: 1,
            qualitative_map_json: null,
            normal_range: null,
            critical_low: null,
            critical_high: null,
            unit: 'mmol/L',
            code: 'GLU',
          },
          results: [],
          success: true,
          meta: {},
        };
      }
      if (lower.includes('from lab_qc_controls')) {
        return {
          first: controlConfigured ? { id: 5, control_code: 'QC-GLU-L1', control_name: 'Glucose Control L1' } : null,
          results: [],
          success: true,
          meta: {},
        };
      }
      if (lower.includes('from lab_qc_ranges')) {
        return {
          first: { id: 9, mean_value: 5, sd_value: 0.5, range_low: 3.5, range_high: 6.5, qc_level: 1 },
          results: [],
          success: true,
          meta: {},
        };
      }
      if (lower.includes('select result_value') && lower.includes('from lab_qc_results')) {
        return { results: [{ result_value: 5.1 }, { result_value: 4.9 }], success: true, meta: {} };
      }
      if (lower.includes('insert into lab_qc_results')) {
        return { success: true, meta: { last_row_id: 123, changes: 1 } };
      }
      if (lower.includes('insert into lis_unmatched_results')) {
        return { success: true, meta: { last_row_id: 124, changes: 1 } };
      }
      if (lower.includes('update lab_machine_result_log')) {
        return { success: true, meta: { changes: 1 } };
      }
      if (lower.includes('update lab_machines')) {
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
  return { app, mock, qcValue };
}

describe('lab machine analyzer QC/control detection', () => {
  it('detects analyzer QC/control identifiers before patient matching', () => {
    expect(isAnalyzerQcIdentifier('QC-GLU-L1')).toBe(true);
    expect(isAnalyzerQcIdentifier('CTRL_123')).toBe(true);
    expect(isAnalyzerQcIdentifier('SAMPLE-000123')).toBe(false);
    expect(isAnalyzerQcResult({ testCode: 'GLU', testName: 'Glucose', comments: 'Control run' }, {})).toBe(true);
    expect(isAnalyzerQcResult({ testCode: 'GLU', testName: 'Glucose' }, { barcode: 'BC-10' })).toBe(false);
  });

  it('routes analyzer QC results to existing lab_qc_results and skips patient result write', async () => {
    const { app, mock, qcValue } = createApp();
    const res = await app.request('/lab-machines/1/receive', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        barcode: 'QC-GLU-L1',
        results: [{ testCode: 'GLU', testName: 'Glucose Control L1', value: qcValue, resultStatus: 'F' }],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { outcomes: Array<{ action?: string; qcStatus?: string; qcResultId?: number }> };
    expect(body.outcomes[0]).toMatchObject({ action: 'qc_recorded', qcStatus: 'accepted', qcResultId: 123 });

    const qcInsert = mock.queries.find((q) => q.sql.includes('INSERT INTO lab_qc_results'));
    expect(qcInsert?.params).toContain(5);
    expect(qcInsert?.params).toContain(7);
    expect(qcInsert?.params).toContain(5.4);
    expect(qcInsert?.params).toContain('Recorded automatically from analyzer log #88');

    expect(mock.queries.some((q) => q.sql.includes('FROM lab_order_items loi'))).toBe(false);
    expect(mock.queries.some((q) => q.sql.includes('UPDATE lab_order_items SET'))).toBe(false);
    expect(mock.queries.some((q) => q.sql.includes('INSERT INTO lab_results'))).toBe(false);
  });

  it('routes unconfigured QC controls to review queue without patient matching', async () => {
    const { app, mock } = createApp({ controlConfigured: false });
    const res = await app.request('/lab-machines/1/receive', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        barcode: 'QC-UNKNOWN',
        results: [{ testCode: 'GLU', testName: 'Unknown QC', value: '5.0' }],
      }),
    });

    expect(res.status).toBe(200);
    expect(mock.queries.some((q) => q.sql.includes('INSERT INTO lis_unmatched_results') && q.params.includes('qc_control_not_configured'))).toBe(true);
    expect(mock.queries.some((q) => q.sql.includes('INSERT INTO lab_qc_results'))).toBe(false);
    expect(mock.queries.some((q) => q.sql.includes('FROM lab_order_items loi'))).toBe(false);
  });
});
