import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { Env, Variables } from '../src/types';
import labMachines from '../src/routes/tenant/labMachines';
import { createMockDB } from './integration/helpers/mock-db';

const stagedInbox = {
  id: 80,
  tenant_id: 'tenant-1',
  state_version: 1,
  disposition: 'review_required',
  match_state: 'exact',
  qc_state: 'pass',
  validation_state: 'pass',
  ingestion_status: 'completed',
  lab_order_item_id: 10,
  lab_order_id: 20,
  patient_id: 40,
  specimen_id: 30,
  lab_test_id: 7,
  component_id: null,
  normalized_value: '14.2',
  normalized_numeric: 14.2,
  normalized_units: 'g/dL',
  selected_reference_range: '12-16',
  normalized_interpretation: 'normal',
  critical_flag: 0,
  normalized_result_status: 'final',
  machine_id: 1,
  machine_result_log_id: 99,
  machine_test_code: 'HGB',
  machine_test_name: 'Hemoglobin',
  staged_by: 9,
  existing_result: null,
  existing_result_status: null,
};

function createApp(role: string) {
  const mock = createMockDB({
    queryOverride(sql) {
      const lower = sql.toLowerCase();
      if (lower.includes('from lis_analyzer_inbox') && lower.includes('join lab_order_items')) {
        return { first: stagedInbox };
      }
      if (lower.includes('insert into lis_result_acceptance_commands')) {
        return { meta: { changes: 1, last_row_id: 501 } };
      }
      return null;
    },
  });
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.set('tenantId', 'tenant-1');
    c.set('userId', '15');
    c.set('role', role as any);
    c.env = {
      DB: mock.db,
      KV: { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [] }) } as any,
      ENVIRONMENT: 'development',
      UPLOADS: { put: async () => ({}), get: async () => null, delete: async () => {} } as any,
    } as any;
    await next();
  });
  app.route('/lab-machines', labMachines);
  app.onError((error, c) => c.json({ error: error.message, code: (error as any).code }, (error as any).status ?? 500));
  return { app, mock };
}

describe('LIS analyzer inbox acceptance route', () => {
  it('allows a governance reviewer to atomically accept a staged result', async () => {
    const { app, mock } = createApp('pathologist');
    const response = await app.request('/lab-machines/inbox/80/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedVersion: 1 }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      message: 'Analyzer result accepted',
      result: {
        accepted: true,
        inboxId: 80,
        labOrderItemId: 10,
        nextVersion: 2,
      },
    });
    expect(mock.batchCalls).toHaveLength(1);
  });

  it('rejects a lab technician from accepting staged analyzer results', async () => {
    const { app, mock } = createApp('lab_tech');
    const response = await app.request('/lab-machines/inbox/80/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedVersion: 1 }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'forbidden' });
    expect(mock.batchCalls).toHaveLength(0);
  });

  it('requires an optimistic expectedVersion', async () => {
    const { app, mock } = createApp('pathologist');
    const response = await app.request('/lab-machines/inbox/80/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
    expect(mock.batchCalls).toHaveLength(0);
  });
});
