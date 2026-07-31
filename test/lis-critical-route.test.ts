import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { Env, Variables } from '../src/types';
import labMachines from '../src/routes/tenant/labMachines';
import { createMockDB } from './integration/helpers/mock-db';

function createApp(role: string, status = 'delivered') {
  const mock = createMockDB({
    queryOverride(sql) {
      const lower = sql.toLowerCase();
      if (lower.includes('from lis_critical_event_outbox') && lower.includes('limit 1')) {
        return {
          first: {
            id: 901,
            tenant_id: 'tenant-1',
            lis_analyzer_inbox_id: 80,
            status,
            acknowledgement_deadline: '2026-07-10T08:15:00.000Z',
            acknowledged_by: null,
            acknowledged_at: null,
          },
        };
      }
      if (lower.includes('update lis_critical_event_outbox')) {
        return { meta: { changes: 1 } };
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
      KV: {} as KVNamespace,
      UPLOADS: {} as R2Bucket,
      ASSETS: {} as Fetcher,
      JWT_SECRET: 'test-' + 'jwt',
      ENVIRONMENT: 'development',
      ALLOWED_ORIGINS: '',
    } as Env;
    await next();
  });
  app.route('/lab-machines', labMachines);
  app.onError((error, c) => c.json({ error: error.message }, (error as any).status ?? 500));
  return { app, mock };
}

describe('critical LIS event acknowledgement route', () => {
  it('lets an accountable doctor acknowledge a critical result', async () => {
    const { app, mock } = createApp('doctor');
    const response = await app.request('/lab-machines/critical-events/901/acknowledge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note: 'Patient care team informed' }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      message: 'Critical result acknowledged',
      result: {
        acknowledged: true,
        eventId: 901,
        inboxId: 80,
        previousStatus: 'delivered',
      },
    });
    expect(mock.queries.some(({ sql }) => sql.includes("status = 'acknowledged'"))).toBe(true);
  });

  it('rejects a non-accountable role', async () => {
    const { app, mock } = createApp('reception');
    const response = await app.request('/lab-machines/critical-events/901/acknowledge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note: 'Seen' }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'forbidden' });
    expect(mock.queries).toHaveLength(0);
  });

  it('returns a conflict when the event is already closed', async () => {
    const { app } = createApp('pathologist', 'acknowledged');
    const response = await app.request('/lab-machines/critical-events/901/acknowledge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'already_closed' });
  });
});
