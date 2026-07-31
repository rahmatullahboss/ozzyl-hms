import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import labMachines from '../src/routes/tenant/labMachines';
import { createMockDB } from './integration/helpers/mock-db';

function app(db: D1Database, role = 'hospital_admin', userId = '16') {
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

function routeDb() {
  return createMockDB({
    queryOverride(sql) {
      if (sql.includes('FROM lis_result_retraction_notification_outbox outbox') && sql.includes('delivery_total')) {
        return {
          results: [{
            id: 801,
            status: 'failed',
            delivery_total: 4,
            delivery_sent: 3,
            delivery_failed: 1,
            patient_name: 'Patient One',
            order_no: 'ORD-20',
          }],
        };
      }
      if (sql.includes('FROM lis_result_retraction_notification_deliveries delivery')) {
        return {
          results: [{ id: 901, channel: 'portal', status: 'failed', recipient_id: 40 }],
        };
      }
      if (sql.includes('UPDATE lis_result_retraction_notification_deliveries')) {
        return { success: true, meta: { changes: 1 } };
      }
      if (sql.includes('UPDATE lis_result_retraction_notification_outbox')) {
        return { success: true, meta: { changes: 1 } };
      }
      return null;
    },
  });
}

describe('LIS retraction notification monitoring routes', () => {
  it('lists tenant-scoped outbox events with delivery aggregates and details', async () => {
    const mock = routeDb();
    const response = await app(mock.db).request(
      '/lab-machines/retraction-notification-outbox?machineId=4&status=failed&includeDeliveries=true',
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: 801, status: 'failed', delivery_failed: 1 }],
      deliveries: [{ id: 901, channel: 'portal', status: 'failed' }],
    });
    const list = mock.queries.find(query => query.sql.includes('delivery_total'));
    expect(list?.sql).toContain('outbox.tenant_id = ?');
    expect(list?.params).toContain('tenant-1');
    expect(list?.params).toContain('failed');
    expect(list?.params).toContain(4);
    const deliveries = mock.queries.find(query =>
      query.sql.includes('SELECT\n        delivery.id')
      && query.sql.includes('FROM lis_result_retraction_notification_deliveries delivery'),
    );
    expect(deliveries?.sql).toContain('delivery.tenant_id = ?');
  });

  it('blocks non-governance roles before querying notification evidence', async () => {
    const mock = routeDb();
    const response = await app(mock.db, 'lab_tech').request(
      '/lab-machines/retraction-notification-outbox',
    );

    expect(response.status).toBe(403);
    expect(mock.queries).toHaveLength(0);
  });

  it('resets terminal failed deliveries and records accountable manual retry evidence atomically', async () => {
    const mock = routeDb();
    const response = await app(mock.db).request(
      '/lab-machines/retraction-notification-outbox/801/retry',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'Portal provider recovered after incident review.' }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      message: 'Retraction notification retry queued',
      outboxId: 801,
    });
    expect(mock.batchCalls).toHaveLength(1);
    const batch = mock.batchCalls[0].join('\n');
    expect(batch).toContain("SET status = 'pending'");
    expect(batch).toContain('manual_retry_count = manual_retry_count + 1');
    expect(batch).toContain('last_manual_retry_by');
    expect(batch).toContain('last_manual_retry_reason');
    expect(mock.queries.flatMap(query => query.params)).toContain('Portal provider recovered after incident review.');
  });

  it('requires an accountable retry reason before any batch write', async () => {
    const mock = routeDb();
    const response = await app(mock.db).request(
      '/lab-machines/retraction-notification-outbox/801/retry',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'retry' }),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'invalid_retry_reason' });
    expect(mock.batchCalls).toHaveLength(0);
  });

  it('wires the scheduled worker and patient portal surfaces', async () => {
    const scheduled = await import('../src/scheduled?raw');
    const portal = await import('../src/routes/tenant/patientPortal?raw');
    const labMachinesSource = await import('../src/routes/tenant/labMachines?raw');
    expect(scheduled.default).toContain('dispatchLisRetractionNotifications(env.DB)');
    expect(scheduled.default).toContain('ctx.waitUntil');
    expect(labMachinesSource.default.match(/c\.executionCtx\.waitUntil\(/g)?.length).toBeGreaterThanOrEqual(2);
    expect(labMachinesSource.default.match(/dispatchLisRetractionNotifications\(c\.env\.DB\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(portal.default).toContain("patientPortalRoutes.get('/notifications'");
    expect(portal.default).toContain("patientPortalRoutes.put('/notifications/:id/read'");
    expect(portal.default).toContain('WHERE tenant_id = ? AND patient_id = ?');
  });
});
