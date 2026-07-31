import { describe, expect, it } from 'vitest';
import auditRoutes from '../../../src/routes/tenant/audit';
import { createTestApp } from '../helpers/test-app';

describe('audit log route security', () => {
  it('allows accountant audit readers through audit:read permission', async () => {
    const { app } = createTestApp({
      route: auditRoutes as any,
      routePath: '/audit',
      role: 'accountant',
      tenantId: 'tenant-1',
      tables: {
        audit_logs: [{ id: 1, tenant_id: 'tenant-1', user_id: 4, action: 'CREATE', table_name: 'bills', record_id: 7, created_at: '2026-05-13' }],
        users: [{ id: 4, tenant_id: 'tenant-1', name: 'Accountant', role: 'accountant' }],
      },
    });

    const res = await app.request('/audit/logs');

    expect(res.status).toBe(200);
  });

  it('rejects inverted audit date ranges before querying', async () => {
    const { app, mockDB } = createTestApp({
      route: auditRoutes as any,
      routePath: '/audit',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      tables: { audit_logs: [] },
    });

    const res = await app.request('/audit/logs?startDate=2026-05-14&endDate=2026-05-13');

    expect(res.status).toBe(400);
    expect(mockDB.queries.some((q) => q.sql.includes('FROM audit_logs'))).toBe(false);
  });

  it('caps audit list limits to a bounded page size', async () => {
    const { app, mockDB } = createTestApp({
      route: auditRoutes as any,
      routePath: '/audit',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      tables: { audit_logs: [] },
    });

    const res = await app.request('/audit/logs?limit=5000');

    expect(res.status).toBe(200);
    const auditQuery = mockDB.queries.find((q) => q.sql.includes('FROM audit_logs'));
    expect(auditQuery?.params.at(-1)).toBe(200);
  });

  it('rejects invalid audit limit values before querying', async () => {
    const { app, mockDB } = createTestApp({
      route: auditRoutes as any,
      routePath: '/audit',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      tables: { audit_logs: [] },
    });

    const res = await app.request('/audit/logs?limit=abc');

    expect(res.status).toBe(400);
    expect(mockDB.queries.some((q) => q.sql.includes('FROM audit_logs'))).toBe(false);
  });

  it('creates an audit trail when audit logs are viewed', async () => {
    const { app, mockDB } = createTestApp({
      route: auditRoutes as any,
      routePath: '/audit',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 5,
      tables: {
        audit_logs: [{ id: 1, tenant_id: 'tenant-1', user_id: 4, action: 'CREATE', table_name: 'bills', record_id: 7, created_at: '2026-05-13' }],
        users: [{ id: 4, tenant_id: 'tenant-1', name: 'Admin', role: 'hospital_admin' }],
      },
    });

    await app.request('/audit/logs');

    const viewAudit = mockDB.queries.find(
      (q) => q.sql.includes('INSERT INTO audit_logs') && q.params?.includes('VIEW')
    );
    expect(viewAudit).toBeDefined();
  });

  it('creates an audit trail when audit logs are exported', async () => {
    const { app, mockDB } = createTestApp({
      route: auditRoutes as any,
      routePath: '/audit',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 5,
      tables: {
        audit_logs: [],
      },
    });

    await app.request('/audit/export');

    const exportAudit = mockDB.queries.find(
      (q) => q.sql.includes('INSERT INTO audit_logs') && q.params?.includes('EXPORT')
    );
    expect(exportAudit).toBeDefined();
  });
});
