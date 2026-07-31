import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import labMachines from '../src/routes/tenant/labMachines';
import { createMockDB } from './integration/helpers/mock-db';

const acceptedResult = {
  inbox_id: 80,
  inbox_state_version: 2,
  inbox_disposition: 'accepted',
  accepted_by: 9,
  canonical_lab_result_id: 601,
  lab_result_id: 601,
  lab_result_status: 'final',
  lab_report_id: 501,
  lab_report_status: 'published',
  lab_order_item_id: 10,
  lab_order_id: 20,
  patient_id: 40,
  existing_open_request_id: null,
};

const requestRow = {
  id: 701,
  tenant_id: 'tenant-1',
  lis_analyzer_inbox_id: 80,
  lab_result_id: 601,
  lab_report_id: 501,
  lab_order_item_id: 10,
  lab_order_id: 20,
  patient_id: 40,
  requested_by: 15,
  requester_role: 'pathologist',
  reason_code: 'wrong_order',
  reason: 'Result was published against the wrong laboratory order.',
  notes: null,
  status: 'requested',
  state_version: 1,
  reviewed_by: null,
};

function app(db: D1Database, role = 'pathologist', userId = '15') {
  const instance = new Hono<any>();
  instance.use('*', async (c, next) => {
    c.env = { DB: db };
    c.set('tenantId', 'tenant-1');
    c.set('userId', userId);
    c.set('role', role);
    await next();
  });
  instance.route('/lab-machines', labMachines);
  return instance;
}

function routeDb(options: { finalStatus?: 'requested' | 'applied' | 'rejected' } = {}) {
  const finalStatus = options.finalStatus ?? 'requested';
  return createMockDB({
    queryOverride(sql) {
      if (sql.includes('existing_open_request_id')) return { first: acceptedResult };
      if (sql.includes('FROM lis_result_retraction_requests request') && sql.includes('ORDER BY request.created_at')) {
        return { results: [{ ...requestRow, patient_name: 'Patient One', order_no: 'ORD-20' }] };
      }
      if (sql.includes('FROM lis_result_retraction_requests request') && sql.includes('WHERE request.id = ?')) {
        if (sql.includes('request.status AS request_status')) return { first: requestRow };
        return {
          first: {
            ...requestRow,
            status: finalStatus,
            state_version: finalStatus === 'requested' ? 1 : 2,
            reviewed_by: finalStatus === 'requested' ? null : 16,
          },
        };
      }
      if (sql.includes('INSERT OR IGNORE INTO lis_result_retraction_requests')) {
        return { success: true, meta: { changes: 1, last_row_id: 701 } };
      }
      if (sql.includes('UPDATE lis_result_retraction_requests')) return { success: true, meta: { changes: 1 } };
      if (sql.includes('UPDATE lab_results')) return { success: true, meta: { changes: 1 } };
      if (sql.includes('UPDATE lab_order_items')) return { success: true, meta: { changes: 1 } };
      if (sql.includes('UPDATE lab_reports')) return { success: true, meta: { changes: 1 } };
      if (sql.includes('INSERT INTO lab_observation_audit')) return { success: true, meta: { changes: 1 } };
      if (sql.includes('INSERT INTO lis_result_retraction_notification_outbox')) return { success: true, meta: { changes: 1 } };
      return null;
    },
  });
}

describe('LIS result retraction routes', () => {
  it('lists tenant-scoped pending requests for governance reviewers', async () => {
    const mock = routeDb();
    const response = await app(mock.db).request('/lab-machines/retraction-requests?status=requested');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: [{ id: 701, status: 'requested' }] });
    const query = mock.queries.find(item => item.sql.includes('ORDER BY request.created_at'));
    expect(query?.sql).toContain('request.tenant_id = ?');
    expect(query?.params).toContain('tenant-1');
    expect(query?.params).toContain('requested');
  });

  it('blocks retraction access for non-governance roles before database access', async () => {
    const mock = routeDb();
    const response = await app(mock.db, 'lab_tech').request('/lab-machines/retraction-requests');

    expect(response.status).toBe(403);
    expect(mock.queries).toHaveLength(0);
  });

  it('creates a governed retraction request from accepted analyzer evidence', async () => {
    const mock = routeDb();
    const response = await app(mock.db).request('/lab-machines/inbox/80/retraction-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        expectedInboxVersion: 2,
        reasonCode: 'wrong_order',
        reason: 'Result was published against the wrong laboratory order.',
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      message: 'Result retraction requested',
      result: { requested: true, requestId: 701, inboxId: 80 },
    });
  });

  it('applies a pending request only through a different governance reviewer', async () => {
    const mock = routeDb({ finalStatus: 'applied' });
    const response = await app(mock.db, 'lab_supervisor', '16').request(
      '/lab-machines/retraction-requests/701/approve',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          expectedVersion: 1,
          reviewNotes: 'Verified against analyzer source, specimen, and patient order.',
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      message: 'Result retraction applied',
      result: { applied: true, requestId: 701, nextVersion: 2 },
    });
    expect(mock.batchCalls).toHaveLength(1);
  });

  it('rejects incomplete approval evidence before any retraction batch', async () => {
    const mock = routeDb({ finalStatus: 'applied' });
    const response = await app(mock.db, 'lab_supervisor', '16').request(
      '/lab-machines/retraction-requests/701/approve',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedVersion: 1, reviewNotes: 'ok' }),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'invalid_review_notes' });
    expect(mock.batchCalls).toHaveLength(0);
  });
});
