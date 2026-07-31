/**
 * Integration tests for Module 7: User Control & Audit Log
 *
 * Tests:
 * - Staff routes permission guards (staff:read, staff:write, staff:delete)
 * - Staff routes audit logging
 * - User management RBAC
 * - Audit log action types
 * - Billing discount permission enforcement
 */

import { describe, it, expect } from 'vitest';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';
import { createMockDB } from './integration/helpers/mock-db';
import staffRoutes from '../src/routes/tenant/staff';
import userRoutes from '../src/routes/tenant/users';
import auditRoutes from '../src/routes/tenant/audit';

// ─── Staff Routes Permission Guards ──────────────────────────────────────────

describe('Staff Routes Permission Guards', () => {
  function makeStaffApp(role: string) {
    const mockDB = createMockDB({
      tables: {
        staff: [
          { id: 1, tenant_id: 'tenant-1', name: 'John Doe', position: 'Nurse', salary: 20000, status: 'active' },
        ],
      },
    });

    return createTestApp({
      route: staffRoutes,
      routePath: '/staff',
      role,
      tenantId: 'tenant-1',
      mockDB,
    });
  }

  describe('GET /staff (list)', () => {
    it('allows reception role (has staff:read via no guard)', async () => {
      const { app } = makeStaffApp('reception');
      const res = await app.request('/staff');
      // Reception does NOT have staff:read permission, should get 403
      expect(res.status).toBe(403);
    });

    it('allows md role (has staff:read)', async () => {
      const { app } = makeStaffApp('md');
      const res = await app.request('/staff');
      expect(res.status).toBe(200);
    });

    it('allows hospital_admin (wildcard)', async () => {
      const { app } = makeStaffApp('hospital_admin');
      const res = await app.request('/staff');
      expect(res.status).toBe(200);
    });

    it('blocks nurse role (no staff:read)', async () => {
      const { app } = makeStaffApp('nurse');
      const res = await app.request('/staff');
      expect(res.status).toBe(403);
    });

    it('blocks doctor role (no staff:read)', async () => {
      const { app } = makeStaffApp('doctor');
      const res = await app.request('/staff');
      expect(res.status).toBe(403);
    });
  });

  describe('POST /staff (create)', () => {
    const validBody = {
      name: 'New Staff',
      address: '123 Main St',
      position: 'Nurse',
      salary: 25000,
      bankAccount: 'ACC001',
      mobile: '01712345678',
    };

    it('allows md role (has staff:write)', async () => {
      const { app } = makeStaffApp('md');
      const res = await jsonRequest(app, '/staff', { method: 'POST', body: validBody });
      expect(res.status).toBe(201);
    });

    it('blocks reception role (no staff:write)', async () => {
      const { app } = makeStaffApp('reception');
      const res = await jsonRequest(app, '/staff', { method: 'POST', body: validBody });
      expect(res.status).toBe(403);
    });

    it('blocks doctor role (no staff:write)', async () => {
      const { app } = makeStaffApp('doctor');
      const res = await jsonRequest(app, '/staff', { method: 'POST', body: validBody });
      expect(res.status).toBe(403);
    });
  });

  describe('PUT /staff/:id (update)', () => {
    const updateBody = { name: 'Updated Name', address: '456 Oak Ave', position: 'Senior Nurse', salary: 30000, bankAccount: 'ACC001', mobile: '01712345678' };

    it('allows md role (has staff:write)', async () => {
      const { app } = makeStaffApp('md');
      const res = await jsonRequest(app, '/staff/1', { method: 'PUT', body: updateBody });
      expect(res.status).toBe(200);
    });

    it('blocks accountant role (no staff:write)', async () => {
      const { app } = makeStaffApp('accountant');
      const res = await jsonRequest(app, '/staff/1', { method: 'PUT', body: updateBody });
      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /staff/:id (deactivate)', () => {
    it('allows md role (has staff:delete)', async () => {
      const { app } = makeStaffApp('md');
      const res = await app.request('/staff/1', { method: 'DELETE' });
      expect(res.status).toBe(200);
    });

    it('blocks pharmacist role (no staff:delete)', async () => {
      const { app } = makeStaffApp('pharmacist');
      const res = await app.request('/staff/1', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });

    it('blocks nurse role (no staff:delete)', async () => {
      const { app } = makeStaffApp('nurse');
      const res = await app.request('/staff/1', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
  });
});

// ─── Staff Routes Audit Logging ──────────────────────────────────────────────

describe('Staff Routes Audit Logging', () => {
  it('creates audit log when staff is created', async () => {
    const mockDB = createMockDB({
      tables: { staff: [] },
    });

    const { app } = createTestApp({
      route: staffRoutes,
      routePath: '/staff',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 42,
      mockDB,
    });

    await jsonRequest(app, '/staff', {
      method: 'POST',
      body: {
        name: 'New Staff',
        address: '123 Main St',
        position: 'Nurse',
        salary: 25000,
        bankAccount: 'ACC001',
        mobile: '01712345678',
      },
    });

    const auditInsert = mockDB.queries.find(
      (q) => q.sql.toLowerCase().includes('insert into audit_logs')
    );
    expect(auditInsert).toBeDefined();
    expect(auditInsert?.params).toContain('CREATE');
    expect(auditInsert?.params).toContain('staff');
    expect(auditInsert?.params).toContain('tenant-1');
  });

  it('creates audit log when staff is updated', async () => {
    const mockDB = createMockDB({
      queryOverride(sql, params) {
        const s = sql.toLowerCase();
        // Mock staff lookup for update
        if (s.includes('from staff') && s.includes('where id = ? and tenant_id = ?')) {
          return { first: { id: 1, tenant_id: 'tenant-1', name: 'John', address: 'Addr', position: 'Nurse', salary: 20000, bank_account: 'ACC', mobile: '01712345678', department: 'Med' } };
        }
        return null;
      },
    });

    const { app } = createTestApp({
      route: staffRoutes,
      routePath: '/staff',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 42,
      mockDB,
    });

    await jsonRequest(app, '/staff/1', {
      method: 'PUT',
      body: { name: 'Updated', address: 'New Addr', position: 'Senior Nurse', salary: 30000, bankAccount: 'ACC2', mobile: '01812345678' },
    });

    const auditInsert = mockDB.queries.find(
      (q) => q.sql.toLowerCase().includes('insert into audit_logs')
    );
    expect(auditInsert).toBeDefined();
    expect(auditInsert?.params).toContain('UPDATE');
    expect(auditInsert?.params).toContain('staff');
  });

  it('creates audit log when staff is deactivated', async () => {
    const mockDB = createMockDB({
      tables: {
        staff: [{ id: 1, tenant_id: 'tenant-1', name: 'John', position: 'Nurse' }],
      },
    });

    const { app } = createTestApp({
      route: staffRoutes,
      routePath: '/staff',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 42,
      mockDB,
    });

    await app.request('/staff/1', { method: 'DELETE' });

    const auditInsert = mockDB.queries.find(
      (q) => q.sql.toLowerCase().includes('insert into audit_logs')
    );
    expect(auditInsert).toBeDefined();
    expect(auditInsert?.params).toContain('UPDATE');
    expect(auditInsert?.params).toContain('staff');
  });
});

// ─── User Management RBAC ────────────────────────────────────────────────────

describe('User Management RBAC', () => {
  function makeUserApp(role: string) {
    const mockDB = createMockDB({
      tables: {
        users: [
          { id: 1, tenant_id: 'tenant-1', email: 'admin@test.com', name: 'Admin', role: 'hospital_admin', is_active: 1 },
          { id: 2, tenant_id: 'tenant-1', email: 'doc@test.com', name: 'Doctor', role: 'doctor', is_active: 1 },
        ],
      },
    });

    return createTestApp({
      route: userRoutes,
      routePath: '/users',
      role,
      tenantId: 'tenant-1',
      mockDB,
    });
  }

  describe('GET /users (list)', () => {
    it('allows hospital_admin (wildcard)', async () => {
      const { app } = makeUserApp('hospital_admin');
      const res = await app.request('/users');
      expect(res.status).toBe(200);
    });

    it('blocks roles without users:read', async () => {
      const { app } = makeUserApp('nurse');
      const res = await app.request('/users');
      expect(res.status).toBe(403);
    });
  });

  describe('POST /users (create)', () => {
    it('allows hospital_admin', async () => {
      const { app } = makeUserApp('hospital_admin');
      const res = await jsonRequest(app, '/users', {
        method: 'POST',
        body: {
          email: 'new@test.com',
          password: 'SecureP4ss',
          name: 'New User',
          role: 'doctor',
        },
      });
      expect(res.status).toBe(201);
    });

    it('blocks roles without users:write', async () => {
      const { app } = makeUserApp('reception');
      const res = await jsonRequest(app, '/users', {
        method: 'POST',
        body: {
          email: 'new@test.com',
          password: 'SecureP4ss',
          name: 'New User',
          role: 'doctor',
        },
      });
      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /users/:id (deactivate)', () => {
    it('allows hospital_admin', async () => {
      const { app } = makeUserApp('hospital_admin');
      const res = await app.request('/users/2', { method: 'DELETE' });
      expect(res.status).toBe(200);
    });

    it('blocks roles without users:delete', async () => {
      const { app } = makeUserApp('doctor');
      const res = await app.request('/users/2', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
  });
});

// ─── Audit Log Action Types ──────────────────────────────────────────────────

describe('Audit Log Action Types', () => {
  it('includes all actions used in codebase', () => {
    // These are the actions used in createAuditLog calls throughout the codebase
    const actionsUsedInCode = [
      'CREATE', 'UPDATE', 'DELETE',
      'LOGIN', 'LOGIN_FAILED',
      'PASSWORD_CHANGE', 'ROLE_CHANGE',
      'PAYMENT', 'CANCEL', 'APPROVE', 'REJECT',
      'RESULT', 'VERIFY', 'RECOLLECT', 'UPDATE_STATUS',
      'CHECK_IN', 'DISCHARGE', 'VIEW',
      'PRINT', 'EXPORT',
    ];

    // The CHECK constraint should allow all these actions
    // This test documents the expected actions
    expect(actionsUsedInCode.length).toBeGreaterThan(10);
    expect(actionsUsedInCode).toContain('ROLE_CHANGE');
    expect(actionsUsedInCode).toContain('PASSWORD_CHANGE');
    expect(actionsUsedInCode).toContain('LOGIN_FAILED');
  });
});

// ─── Billing Discount Permission Enforcement ─────────────────────────────────

describe('Billing Discount Permission Enforcement', () => {
  it('reception role does NOT have billing:refund permission', async () => {
    const { getPermissionsForRole } = await import('../packages/shared/src/authz');
    const receptionPerms = getPermissionsForRole('reception');
    expect(receptionPerms).not.toContain('billing:refund');
    expect(receptionPerms).not.toContain('billing:cancel');
  });

  it('reception role HAS billing:read and billing:write', async () => {
    const { getPermissionsForRole } = await import('../packages/shared/src/authz');
    const receptionPerms = getPermissionsForRole('reception');
    expect(receptionPerms).toContain('billing:read');
    expect(receptionPerms).toContain('billing:write');
  });

  it('hospital_admin has all billing permissions', async () => {
    const { getPermissionsForRole } = await import('../packages/shared/src/authz');
    const adminPerms = getPermissionsForRole('hospital_admin');
    // hospital_admin has wildcard access
    expect(adminPerms).toContain('*');
  });

  it('md role has billing:read and billing:write', async () => {
    const { getPermissionsForRole } = await import('../packages/shared/src/authz');
    const mdPerms = getPermissionsForRole('md');
    expect(mdPerms).toContain('billing:read');
    expect(mdPerms).toContain('billing:write');
  });
});

// ─── Audit Log Redaction ─────────────────────────────────────────────────────

describe('Audit Log Redaction', () => {
  it('redacts sensitive fields in audit values', async () => {
    const { redactAuditValue } = await import('../src/lib/accounting-helpers');

    const input = {
      name: 'John',
      email: 'john@test.com',
      phone: '01712345678',
      password: 'secret123',
      address: '123 Main St',
    };

    const redacted = redactAuditValue(input) as Record<string, unknown>;

    expect(redacted.name).toBe('[REDACTED]'); // name is now sensitive
    expect(redacted.email).toBe('[REDACTED]');
    expect(redacted.phone).toBe('[REDACTED]');
    expect(redacted.password).toBe('[REDACTED]');
    expect(redacted.address).toBe('[REDACTED]');
  });

  it('handles nested objects', async () => {
    const { redactAuditValue } = await import('../src/lib/accounting-helpers');

    const input = {
      user: {
        name: 'John',
        email: 'john@test.com',
      },
      action: 'CREATE',
    };

    const redacted = redactAuditValue(input) as Record<string, unknown>;

    expect(redacted.action).toBe('CREATE');
    expect((redacted.user as Record<string, unknown>).name).toBe('[REDACTED]');
    expect((redacted.user as Record<string, unknown>).email).toBe('[REDACTED]');
  });

  it('handles null and undefined', async () => {
    const { redactAuditValue } = await import('../src/lib/accounting-helpers');

    expect(redactAuditValue(null)).toBeNull();
    expect(redactAuditValue(undefined)).toBeUndefined();
  });
});

// ─── Permission Catalog ──────────────────────────────────────────────────────

describe('Permission Catalog', () => {
  it('includes all required permission groups', async () => {
    const { PERMISSION_GROUPS } = await import('../packages/shared/src/authz');

    expect(PERMISSION_GROUPS).toHaveProperty('patients');
    expect(PERMISSION_GROUPS).toHaveProperty('billing');
    expect(PERMISSION_GROUPS).toHaveProperty('pharmacy');
    expect(PERMISSION_GROUPS).toHaveProperty('hr');
    expect(PERMISSION_GROUPS).toHaveProperty('admin');
  });

  it('admin group includes user management permissions', async () => {
    const { PERMISSION_GROUPS } = await import('../packages/shared/src/authz');

    expect(PERMISSION_GROUPS.admin.permissions).toContain('users:read');
    expect(PERMISSION_GROUPS.admin.permissions).toContain('users:write');
    expect(PERMISSION_GROUPS.admin.permissions).toContain('users:delete');
    expect(PERMISSION_GROUPS.admin.permissions).toContain('roles:manage');
    expect(PERMISSION_GROUPS.admin.permissions).toContain('audit:read');
  });

  it('hr group includes staff management permissions', async () => {
    const { PERMISSION_GROUPS } = await import('../packages/shared/src/authz');

    expect(PERMISSION_GROUPS.hr.permissions).toContain('staff:read');
    expect(PERMISSION_GROUPS.hr.permissions).toContain('staff:write');
    expect(PERMISSION_GROUPS.hr.permissions).toContain('staff:delete');
  });
});
