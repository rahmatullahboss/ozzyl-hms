import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../src/types';
import { sha256Hex } from '../src/lib/lis-ingestion';
import labMachines from '../src/routes/tenant/labMachines';
import { createMockDB } from './integration/helpers/mock-db';

const payload = {
  barcode: 'BC-10',
  results: [{ testCode: 'MTB', value: 'POS', resultStatus: 'F', comments: 'Analyzer final' }],
};
const rawPayload = JSON.stringify(payload);

function createApp(existingIngestion: Record<string, unknown> | null = null) {
  const mock = createMockDB({
    queryOverride(sql) {
      const lower = sql.toLowerCase();
      if (lower.includes('select id, machine_id, raw_message, message_type, parsed_data') && lower.includes('from lab_machine_result_log')) {
        return {
          first: {
            id: 12,
            machine_id: 1,
            raw_message: rawPayload,
            message_type: 'JSON',
            parsed_data: rawPayload,
          },
        };
      }
      if (lower.includes('from lis_ingestion_messages')) {
        return { first: existingIngestion };
      }
      if (lower.includes('insert into lis_ingestion_messages')) {
        return { success: true, meta: { last_row_id: 70, changes: 1 } };
      }
      if (lower.includes('insert into lab_machine_result_log')) {
        return { success: true, meta: { last_row_id: 99, changes: 1 } };
      }
      if (lower.includes('from lab_machine_test_map')) {
        return {
          first: {
            lab_test_id: 7,
            component_id: null,
            machine_unit: null,
            conversion_factor: 1,
            qualitative_map_json: JSON.stringify({ POS: 'Positive' }),
            normal_range: null,
            critical_low: null,
            critical_high: null,
            unit: null,
            code: 'MTB',
          },
        };
      }
      if (lower.includes('from lab_order_items loi') && lower.includes('join lab_orders lo')) {
        const candidate = {
          id: 10,
          lab_order_id: 20,
          specimen_id: 30,
          patient_id: 40,
        };
        return { first: candidate, results: [candidate] };
      }
      if (lower.includes('from lab_qc_ranges') && lower.includes('count(*)')) {
        return { first: { total: 1 } };
      }
      if (lower.includes('from lab_calibrations')) {
        return { first: { total: 0 } };
      }
      if (lower.includes('from lab_qc_results')) {
        return { first: { is_out_of_range: 0, westgard_violations: '[]', created_at: new Date().toISOString() } };
      }
      if (lower.includes('from lab_validation_rules')) {
        return { results: [] };
      }
      if (lower.includes('insert into lis_analyzer_inbox')) {
        return { success: true, meta: { last_row_id: 80, changes: 1 } };
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

function hasCanonicalWrite(queries: Array<{ sql: string }>) {
  return queries.some(({ sql }) => {
    const lower = sql.toLowerCase();
    return lower.includes('update lab_order_items set')
      || lower.includes('insert into lab_results')
      || lower.includes('insert into lab_observation_audit');
  });
}

describe('lab machine result log reprocessing', () => {
  it('stages a stored JSON analyzer log through the safety inbox', async () => {
    const { app, mock } = createApp();
    const response = await app.request('/lab-machines/1/logs/12/reprocess', { method: 'POST' });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      message: 'Result log staged again',
      disposition: 'staged',
      originalLogId: 12,
      reprocessLogId: 99,
      messageId: 70,
      outcomes: [{
        staged: true,
        matched: true,
        disposition: 'review_required',
        inboxId: 80,
      }],
    });

    const reprocessInsert = mock.queries.find((query) => query.sql.includes('INSERT INTO lab_machine_result_log'));
    expect(reprocessInsert?.params).toContain('JSON_REPROCESS');
    expect(reprocessInsert?.params).toContain('Reprocess requested from log #12');
    expect(mock.queries.some((query) => query.sql.includes('INSERT INTO lis_ingestion_messages'))).toBe(true);
    expect(mock.queries.some((query) => query.sql.includes('INSERT INTO lis_analyzer_inbox'))).toBe(true);
    expect(hasCanonicalWrite(mock.queries)).toBe(false);
  });

  it('returns the prior staged disposition when the same stored log is reprocessed again', async () => {
    const payloadHash = await sha256Hex(rawPayload);
    const { app, mock } = createApp({
      id: 70,
      payload_sha256: payloadHash,
      status: 'completed',
      outcome_json: JSON.stringify({ outcomes: [{ disposition: 'review_required', inboxId: 80 }] }),
    });
    const response = await app.request('/lab-machines/1/logs/12/reprocess', { method: 'POST' });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      message: 'Result log already staged',
      disposition: 'duplicate',
      originalLogId: 12,
      messageId: 70,
    });
    expect(mock.queries.some((query) => query.sql.includes('INSERT INTO lis_analyzer_inbox'))).toBe(false);
    expect(hasCanonicalWrite(mock.queries)).toBe(false);
  });
});
