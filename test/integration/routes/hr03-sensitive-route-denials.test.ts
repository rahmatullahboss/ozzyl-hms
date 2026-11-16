import { describe, expect, it } from 'vitest';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import { createMockDB } from '../helpers/mock-db';
import staffRoutes from '../../../src/routes/tenant/staff';

describe('HR-03 staff route negative authorization', () => {
  it('rejects salary report/history and full bank disclosure to operational-only staff', async () => {
    const mockDB = createMockDB();
    const { app } = createTestApp({
      route: staffRoutes, routePath: '/api/staff', role: 'nurse', tenantId: '102', userId: 17, mockDB,
    });
    const paths = ['/api/staff/salary-report', '/api/staff/42/salary', '/api/staff/42/bank-account'];
    for (const path of paths) {
      const result = await app.request(path);
      expect(result.status, path).toBe(403);
    }
  });

  it('rejects malformed direct IDs rather than coercing them to another employee', async () => {
    const { app } = createTestApp({
      route: staffRoutes, routePath: '/api/staff',
      role: 'hospital_admin', tenantId: '102', userId: 1, mockDB: createMockDB(),
    });
    for (const id of ['0x10', '1e2', '01', '0', '-4', 'Infinity']) {
      const result = await app.request(`/api/staff/${id}`);
      expect(result.status, id).toBe(400);
    }
  });

  it('blocks unauthorized staff bank-account writes before persistence', async () => {
    const mockDB = createMockDB();
    const { app } = createTestApp({
      route: staffRoutes, routePath: '/api/staff', role: 'nurse', tenantId: '102', userId: 17, mockDB,
    });
    const result = await jsonRequest(app, '/api/staff/42', {
      method: 'PUT', body: { bankAccount: 'BD-UNAUTHORIZED' },
    });
    expect(result.status).toBe(403);
    expect(mockDB.queries.some((q) => /UPDATE staff SET/i.test(q.sql))).toBe(false);
  });
});
