import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { describe, expect, it } from 'vitest';
import patientPortal from '../src/routes/tenant/patientPortal';
import { createMockDB } from './integration/helpers/mock-db';

function app(db: D1Database, patientId = '40', tenantId = 'tenant-1') {
  const instance = new Hono<any>();
  instance.use('*', async (c, next) => {
    c.env = { DB: db };
    c.set('role', 'patient');
    c.set('patientId', patientId);
    c.set('tenantId', tenantId);
    await next();
  });
  instance.route('/patient-portal', patientPortal);
  return instance;
}

const jwtKey = ['portal', 'notification', 'verification'].join('-');

function globalPatientApp(db: D1Database) {
  const instance = new Hono<any>();
  instance.use('*', async (c, next) => {
    c.env = { DB: db, JWT_SECRET: jwtKey };
    await next();
  });
  instance.route('/patient-portal', patientPortal);
  return instance;
}

function portalDb(options: { updateChanges?: number } = {}) {
  return createMockDB({
    queryOverride(sql) {
      if (sql.includes('SELECT id, category, title, message, link, metadata_json')) {
        return {
          results: [{
            id: 1,
            category: 'lab_result_retraction',
            title: 'Laboratory report withdrawn',
            message: 'Do not use the withdrawn report.',
            link: '/lab-results',
            metadata_json: '{"requestId":701}',
            is_read: 0,
            read_at: null,
            created_at: '2026-07-10 12:00:00',
          }],
        };
      }
      if (sql.includes('COUNT(*) AS total') && sql.includes('is_read = 0')) {
        return { first: { total: 1 } };
      }
      if (sql.includes('COUNT(*) AS total')) return { first: { total: 1 } };
      if (sql.includes('UPDATE patient_portal_notifications')) {
        return { success: true, meta: { changes: options.updateChanges ?? 1 } };
      }
      if (sql.includes('INSERT INTO patient_portal_audit')) {
        return { success: true, meta: { changes: 1 } };
      }
      return null;
    },
  });
}

describe('patient portal LIS retraction notifications', () => {
  it('lists only the authenticated tenant patient notifications and parses metadata', async () => {
    const mock = portalDb();
    const response = await app(mock.db).request('/patient-portal/notifications?unread=true&page=1&limit=10');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: 1, category: 'lab_result_retraction', metadata: { requestId: 701 } }],
      unreadCount: 1,
      pagination: { page: 1, limit: 10, total: 1 },
    });
    const list = mock.queries.find(query => query.sql.includes('SELECT id, category, title'));
    expect(list?.sql).toContain('WHERE tenant_id = ? AND patient_id = ? AND is_read = 0');
    expect(list?.params).toEqual(['tenant-1', '40', 10, 0]);
  });

  it('marks only the authenticated patient notification as read', async () => {
    const mock = portalDb();
    const response = await app(mock.db).request('/patient-portal/notifications/1/read', { method: 'PUT' });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    const update = mock.queries.find(query => query.sql.includes('UPDATE patient_portal_notifications'));
    expect(update?.sql).toContain('WHERE id = ? AND tenant_id = ? AND patient_id = ?');
    expect(update?.params).toEqual([1, 'tenant-1', '40']);
  });

  it('returns 404 when the notification does not belong to the patient', async () => {
    const mock = portalDb({ updateChanges: 0 });
    const response = await app(mock.db).request('/patient-portal/notifications/99/read', { method: 'PUT' });

    expect(response.status).toBe(404);
  });

  for (const blockedStatus of ['suspended', 'unexpected_legacy_state']) {
    it(`rejects a stale global token when DB auth status is ${blockedStatus}`, async () => {
      const mock = createMockDB({
        queryOverride(sql) {
          if (sql.includes('SELECT id, email, phone, uhid, auth_status')) {
            return {
              first: {
                id: 41,
                email: 'patient@example.com',
                phone: '01700000000',
                uhid: 'OZ-000041',
                auth_status: blockedStatus,
              },
              success: true,
              meta: {},
            };
          }
          return null;
        },
      });
      const token = await sign({
        userId: '41',
        role: 'patient',
        scope: 'global',
        exp: Math.floor(Date.now() / 1000) + 300,
      }, jwtKey);
      const response = await globalPatientApp(mock.db).request(
        '/patient-portal/notifications',
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'X-Tenant-ID': 'tenant-1',
          },
        },
      );

      expect(response.status).toBe(403);
    });
  }
});
