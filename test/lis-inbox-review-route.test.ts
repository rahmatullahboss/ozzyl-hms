import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import labMachines from '../src/routes/tenant/labMachines';
import { createMockDB } from './integration/helpers/mock-db';

function createApp(db: D1Database, role = 'pathologist', userId = '15') {
  const app = new Hono<any>();
  app.use('*', async (c, next) => {
    c.env = { DB: db };
    c.set('tenantId', 'tenant-1');
    c.set('userId', userId);
    c.set('role', role);
    await next();
  });
  app.route('/lab-machines', labMachines);
  return app;
}

const listRow = {
  id: 80,
  state_version: 3,
  disposition: 'review_required',
  match_state: 'exact',
  qc_state: 'pass',
  validation_state: 'pass',
  critical_flag: 0,
  normalized_value: '14.2',
  normalized_units: 'g/dL',
  normalized_interpretation: 'normal',
  normalized_result_status: 'final',
  machine_test_code: 'HGB',
  machine_test_name: 'Hemoglobin',
  machine_id: 7,
  machine_name: 'CBC Analyzer',
  patient_id: 40,
  patient_name: 'Patient One',
  patient_code: 'P-40',
  lab_order_id: 20,
  order_no: 'ORD-20',
  lab_order_item_id: 10,
  test_name: 'Hemoglobin',
  test_code: 'HGB',
  created_at: '2026-07-10 08:00:00',
};

function listDb() {
  return createMockDB({
    queryOverride(sql) {
      if (sql.includes('GROUP BY inbox.disposition')) {
        return { results: [{ disposition: 'review_required', total: 1, critical: 0 }] };
      }
      if (sql.includes('COUNT(*) AS total')) return { first: { total: 1 } };
      if (sql.includes('FROM lis_analyzer_inbox inbox') && sql.includes('LIMIT ? OFFSET ?')) {
        return { results: [listRow] };
      }
      return null;
    },
  });
}

describe('LIS analyzer inbox review routes', () => {
  it('returns a tenant-scoped, filterable reviewer queue with pagination and summary', async () => {
    const mock = listDb();
    const response = await createApp(mock.db).request(
      '/lab-machines/inbox?machineId=7&disposition=review_required&critical=false&q=Patient&page=2&limit=10',
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [listRow],
      pagination: { page: 2, limit: 10, total: 1, totalPages: 1 },
      summary: { review_required: { total: 1, critical: 0 } },
    });

    const queueQuery = mock.queries.find(query => query.sql.includes('LIMIT ? OFFSET ?'));
    expect(queueQuery?.sql).toContain('inbox.tenant_id = ?');
    expect(queueQuery?.sql).toContain('inbox.machine_id = ?');
    expect(queueQuery?.sql).toContain('inbox.disposition = ?');
    expect(queueQuery?.params).toContain('tenant-1');
    expect(queueQuery?.params).toContain(7);
    expect(queueQuery?.params).toContain('review_required');
    expect(queueQuery?.params).toContain(0);
    expect(queueQuery?.params.slice(-2)).toEqual([10, 10]);
  });

  it('allows laboratory staff to view the queue but not make a final decision', async () => {
    const mock = listDb();
    const response = await createApp(mock.db, 'lab_tech').request('/lab-machines/inbox?machineId=7');
    expect(response.status).toBe(200);

    const rejectResponse = await createApp(mock.db, 'lab_tech').request('/lab-machines/inbox/80/reject', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedVersion: 3, reason: 'Wrong patient assignment.' }),
    });
    expect(rejectResponse.status).toBe(403);
  });

  it('returns parsed evidence detail without exposing the full raw transport payload', async () => {
    const mock = createMockDB({
      queryOverride(sql) {
        if (sql.includes('FROM lis_analyzer_inbox inbox') && sql.includes('WHERE inbox.id = ?')) {
          return {
            first: {
              ...listRow,
              ingestion_status: 'completed',
              protocol: 'hl7',
              source_message_id: 'MSG-1',
              delivery_id: 'delivery-1',
              payload_sha256: 'hash-1',
              candidate_metadata_json: '{"candidateCount":1}',
              validation_details_json: '{"warnings":["delta"]}',
              qc_details_json: '{"latestStatus":"passed"}',
              source_payload_json: '{"observationIndex":0}',
              raw_payload: 'SHOULD_NOT_LEAK',
            },
          };
        }
        return null;
      },
    });

    const response = await createApp(mock.db).request('/lab-machines/inbox/80');
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.data.candidate_metadata).toEqual({ candidateCount: 1 });
    expect(body.data.validation_details).toEqual({ warnings: ['delta'] });
    expect(body.data.qc_details).toEqual({ latestStatus: 'passed' });
    expect(body.data.source_payload).toEqual({ observationIndex: 0 });
    expect(body.data.raw_payload).toBeUndefined();
  });

  it('returns 404 when the inbox evidence does not exist in the tenant', async () => {
    const mock = createMockDB({ queryOverride: () => ({ first: null }) });
    const response = await createApp(mock.db).request('/lab-machines/inbox/999');
    expect(response.status).toBe(404);
  });

  it('rejects a staged observation through the governed review service', async () => {
    const mock = createMockDB({
      queryOverride(sql) {
        if (sql.includes('FROM lis_analyzer_inbox') && sql.includes('SELECT')) {
          return { first: { ...listRow, staged_by: 9 } };
        }
        if (sql.includes('UPDATE lis_analyzer_inbox')) {
          return { success: true, meta: { changes: 1 } };
        }
        return null;
      },
    });

    const response = await createApp(mock.db).request('/lab-machines/inbox/80/reject', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        expectedVersion: 3,
        reason: 'Analyzer sample was assigned to the wrong patient.',
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      message: 'Analyzer result rejected',
      result: { rejected: true, inboxId: 80, nextVersion: 4 },
    });
  });
});
