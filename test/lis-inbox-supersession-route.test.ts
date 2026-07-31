import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import labMachines from '../src/routes/tenant/labMachines';
import { createMockDB } from './integration/helpers/mock-db';

const source = {
  id: 80,
  tenant_id: 'tenant-1',
  ingestion_message_id: 70,
  observation_index: 0,
  machine_id: 1,
  machine_test_code: 'HGB',
  machine_test_name: 'Hemoglobin',
  lab_order_item_id: 10,
  patient_id: 40,
  specimen_id: 30,
  lab_test_id: 7,
  raw_value: '14.2',
  normalized_value: '14.2',
  normalized_numeric: 14.2,
  normalized_units: 'g/dL',
  normalized_result_status: 'final',
  normalized_interpretation: 'normal',
  critical_flag: 0,
  qc_state: 'pass',
  validation_state: 'pass',
  disposition: 'rejected',
  state_version: 2,
  source_payload_json: '{}',
  staged_by: 9,
  successor_id: null,
  applied_retraction_request_id: null,
};

const target = {
  id: 11,
  tenant_id: 'tenant-1',
  lab_order_id: 21,
  lab_test_id: 7,
  specimen_id: 31,
  status: 'processing',
  patient_id: 40,
  order_no: 'ORD-21',
  test_name: 'Hemoglobin',
  test_code: 'HGB',
  patient_name: 'Patient One',
  patient_code: 'P-40',
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

function supersessionDb(options: { source?: Record<string, unknown> | null } = {}) {
  const sourceRow = options.source === undefined ? source : options.source;
  return createMockDB({
    queryOverride(sql) {
      if (sql.includes('successor.id AS successor_id')) return { first: sourceRow };
      if (
        (sql.includes('FROM lab_order_items target_item') || sql.includes('JOIN lab_order_items target_item'))
        && sql.includes('target_test.name AS test_name')
      ) {
        if (sql.includes('LIMIT 20')) return { results: [target] };
        return { first: target };
      }
      if (sql.includes('WHERE successor.supersedes_inbox_id = ?')) {
        return { first: { id: 81, state_version: 1, disposition: 'review_required' } };
      }
      if (sql.includes('INSERT OR IGNORE INTO lis_inbox_supersession_commands')) {
        return { success: true, meta: { changes: 1, last_row_id: 501 } };
      }
      if (sql.includes('INSERT INTO lis_analyzer_inbox')) {
        return { success: true, meta: { changes: 1, last_row_id: 81 } };
      }
      if (sql.includes('UPDATE lis_analyzer_inbox')) return { success: true, meta: { changes: 1 } };
      if (sql.includes('UPDATE lis_inbox_supersession_commands')) return { success: true, meta: { changes: 1 } };
      return null;
    },
  });
}

describe('LIS analyzer inbox supersession routes', () => {
  it('returns same-test, tenant-scoped target order items for clinical reviewers', async () => {
    const mock = supersessionDb();
    const response = await app(mock.db).request('/lab-machines/inbox/80/targets?q=ORD-21');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: [target] });

    const targetQuery = mock.queries.find(query => query.sql.includes('LIMIT 20'));
    expect(targetQuery?.sql).toContain('target_item.tenant_id = ?');
    expect(targetQuery?.sql).toContain("COALESCE(target_item.status, 'pending') NOT IN");
    expect(targetQuery?.sql).toContain('(source.lab_test_id IS NULL OR target_item.lab_test_id = source.lab_test_id)');
    expect(targetQuery?.params).toContain('tenant-1');
    expect(targetQuery?.params).toContain('%ORD-21%');
  });

  it('limits an accepted result to its current order item because retraction is not implemented', async () => {
    const mock = supersessionDb({ source: { ...source, disposition: 'accepted' } });
    const response = await app(mock.db).request('/lab-machines/inbox/80/targets');

    expect(response.status).toBe(200);
    const targetQuery = mock.queries.find(query => query.sql.includes('LIMIT 20'));
    expect(targetQuery?.sql).toContain("source.disposition <> 'accepted'");
    expect(targetQuery?.sql).toContain("applied_retraction.status = 'applied'");
  });

  it('does not expose target search to non-clinical reviewer roles', async () => {
    const mock = supersessionDb();
    const response = await app(mock.db, 'hospital_admin').request('/lab-machines/inbox/80/targets');

    expect(response.status).toBe(403);
    expect(mock.queries).toHaveLength(0);
  });

  it('creates a governed superseding review row', async () => {
    const mock = supersessionDb();
    const response = await app(mock.db).request('/lab-machines/inbox/80/supersede', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        expectedVersion: 2,
        targetLabOrderItemId: 11,
        reason: 'The analyzer observation belongs to order ORD-21.',
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      message: 'Superseding analyzer review created',
      result: {
        created: true,
        sourceInboxId: 80,
        inboxId: 81,
        stateVersion: 1,
        disposition: 'review_required',
      },
    });
    expect(mock.batchCalls).toHaveLength(1);
  });

  it('returns validation errors and does not run a batch for incomplete requests', async () => {
    const mock = supersessionDb();
    const response = await app(mock.db).request('/lab-machines/inbox/80/supersede', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedVersion: 2, targetLabOrderItemId: 11, reason: 'bad' }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'invalid_supersession_reason' });
    expect(mock.batchCalls).toHaveLength(0);
  });
});
