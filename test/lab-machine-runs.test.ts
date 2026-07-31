import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../src/types';
import labMachines, { buildAnalyzerRunView, summarizeAnalyzerRunOutcomes } from '../src/routes/tenant/labMachines';
import { createMockDB } from './integration/helpers/mock-db';

function createApp() {
  const rows = [
    {
      id: 1,
      machine_id: 7,
      message_type: 'JSON',
      processing_status: 'completed',
      error_message: null,
      received_at: '2026-07-09 10:00:00',
      updated_at: '2026-07-09 10:01:00',
      parsed_data: JSON.stringify({ outcomes: [
        { matched: true, testCode: 'HGB', itemId: 11 },
        { matched: true, testCode: 'WBC', duplicate: true, action: 'skipped', itemId: 12 },
        { matched: false, testCode: 'PLT', reason: 'no_order_item' },
        { matched: true, testCode: 'GLU', action: 'qc_recorded', qcStatus: 'accepted' },
      ] }),
    },
    {
      id: 2,
      machine_id: 7,
      message_type: 'JSON_REPROCESS',
      processing_status: 'partial',
      error_message: null,
      received_at: '2026-07-09 10:05:00',
      updated_at: '2026-07-09 10:06:00',
      parsed_data: JSON.stringify({ reprocessedFromLogId: 1, outcomes: [
        { matched: true, testCode: 'PLT', action: 'corrected', itemId: 13 },
        { matched: false, testCode: 'ALT', validation: ['Out of range'] },
      ] }),
    },
  ];
  const mock = createMockDB({
    queryOverride(sql) {
      const lower = sql.toLowerCase();
      if (lower.includes('from lab_machine_result_log') && lower.includes('parsed_data') && lower.includes('limit')) {
        return { results: rows, success: true, meta: {} };
      }
      if (lower.includes('select count(*) as total from lab_machine_result_log')) {
        return { first: { total: rows.length }, results: [], success: true, meta: {} };
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

describe('lab machine analyzer run summaries', () => {
  it('summarizes analyzer run outcomes without a parallel run table', () => {
    expect(summarizeAnalyzerRunOutcomes([
      { matched: true },
      { matched: true, duplicate: true },
      { matched: false, reason: 'no_order_item' },
      { matched: true, action: 'corrected' },
      { matched: true, action: 'qc_recorded' },
      { matched: false, error: 'parse_error' },
    ])).toMatchObject({
      total_results: 6,
      matched: 4,
      unmatched: 2,
      processed: 3,
      blocked: 1,
      duplicate: 1,
      corrected: 1,
      qc: 1,
      errors: 1,
    });
  });

  it('builds a run view from existing parsed analyzer log data', () => {
    expect(buildAnalyzerRunView({
      id: 99,
      machine_id: 7,
      message_type: 'JSON_REPROCESS',
      processing_status: 'partial',
      parsed_data: JSON.stringify({ reprocessedFromLogId: 12, outcomes: [{ matched: true, action: 'qc_recorded' }] }),
      received_at: '2026-07-09 10:00:00',
    })).toMatchObject({
      run_id: 99,
      machine_id: 7,
      message_type: 'JSON_REPROCESS',
      processing_status: 'partial',
      reprocessed_from_log_id: 12,
      total_results: 1,
      matched: 1,
      qc: 1,
    });
  });

  it('exposes paginated analyzer run summaries through the machine API', async () => {
    const { app, mock } = createApp();
    const res = await app.request('/lab-machines/7/runs?page=1&limit=10');

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data).toHaveLength(2);
    expect(body.data[0]).toMatchObject({
      run_id: 1,
      total_results: 4,
      matched: 3,
      unmatched: 1,
      duplicate: 1,
      qc: 1,
      blocked: 1,
    });
    expect(body.data[1]).toMatchObject({
      run_id: 2,
      reprocessed_from_log_id: 1,
      total_results: 2,
      corrected: 1,
      blocked: 1,
    });
    expect(body.summary).toMatchObject({
      runs: 2,
      completed_runs: 1,
      partial_runs: 1,
      total_results: 6,
      matched: 4,
      unmatched: 2,
      duplicate: 1,
      corrected: 1,
      qc: 1,
      blocked: 2,
    });
    expect(body.pagination).toMatchObject({ page: 1, limit: 10, total: 2, totalPages: 1 });
    expect(mock.queries.some((q) => q.sql.includes('parsed_data') && q.sql.includes('FROM lab_machine_result_log'))).toBe(true);
  });
});
