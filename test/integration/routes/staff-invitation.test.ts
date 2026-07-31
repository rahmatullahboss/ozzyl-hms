import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import { createMockDB } from '../helpers/mock-db';
import staffRoutes from '../../../src/routes/tenant/staff';
import doctorRoutes from '../../../src/routes/tenant/doctors';
import invitationRoutes from '../../../src/routes/tenant/invitations';
import publicInviteRoutes from '../../../src/routes/public-invite';

const T = 1; // tenant id used in fixtures

describe('Staff invitation linking', () => {
  let mock: ReturnType<typeof createMockDB>;

  beforeEach(() => { mock = createMockDB(); });

  it('POST /api/staff/:id/invite creates invitation with staff_id', async () => {
    mock = createMockDB({
      tables: {
        staff: [{ id: 42, name: 'Alice Nurse', email: 'a@x.io',
                  position: 'Nurse', status: 'active', user_id: null, tenant_id: T }],
        tenants: [{ id: T, subdomain: 'demo' }],
      },
    });
    const { app } = createTestApp({
      route: staffRoutes, routePath: '/api/staff',
      role: 'hospital_admin', tenantId: String(T), userId: 7,
      mockDB: mock,
    });
    const res = await jsonRequest(app, '/api/staff/42/invite', { method: 'POST', body: { email: 'a@x.io' } });
    expect(res.status).toBe(201);
    const body = await res.json() as { invite: { staffId: number; role: string; inviteLink: string } };
    expect(body.invite.staffId).toBe(42);
    expect(body.invite.role).toBe('nurse');
    expect(body.invite.inviteLink).toMatch(/^\/h\/demo\/accept-invite\?token=/);
    // Recorded INSERT into invitations with staff_id
    const insert = mock.queries.find(q => /INSERT INTO invitations/i.test(q.sql));
    expect(insert).toBeTruthy();
    expect(insert!.sql).toMatch(/staff_id/);
    expect(insert!.params).toContain(42);
  });

  it('POST /api/invite/:token/accept links staff.user_id to new user', async () => {
    // The handler queries WHERE i.token IN (?, ?) with (rawToken, sha256(rawToken)).
    // Set token to the raw token used in the URL so the mock IN-filter matches.
    mock = createMockDB({
      tables: {
        invitations: [{ id: 9, tenant_id: T, email: 's@x.io',
                        role: 'nurse', token: 'raw-token',
                        accepted_at: null, revoked_at: null,
                        expires_at: new Date(Date.now() + 86400000).toISOString(),
                        doctor_id: null, staff_id: 42 }],
        staff: [{ id: 42, tenant_id: T, user_id: null }],
      },
    });
    const { app } = createTestApp({
      route: publicInviteRoutes, routePath: '/api/invite',
      mockDB: mock,
    });
    const res = await jsonRequest(app, `/api/invite/raw-token/accept`, {
      method: 'POST', body: { name: 'Staffer', password: 'Strong1Pass' },
    });
    expect(res.status).toBe(201);
    const linkUpdate = mock.queries.find(q => /UPDATE staff SET user_id/i.test(q.sql));
    expect(linkUpdate).toBeTruthy();
    expect(linkUpdate!.sql).toMatch(/tenant_id/);
    expect(linkUpdate!.sql).toMatch(/user_id IS NULL/);
  });

  it('rejects accepting a legacy invitation that would create hospital_admin access', async () => {
    mock = createMockDB({
      tables: {
        invitations: [{
          id: 10,
          tenant_id: T,
          email: 'legacy-admin@example.com',
          role: 'hospital_admin',
          token: 'legacy',
          accepted_at: null,
          revoked_at: null,
          expires_at: new Date(Date.now() + 86400000).toISOString(),
          doctor_id: null,
          staff_id: null,
        }],
        users: [],
      },
    });
    const { app } = createTestApp({
      route: publicInviteRoutes,
      routePath: '/api/invite',
      mockDB: mock,
    });

    const res = await jsonRequest(app, '/api/invite/legacy/accept', {
      method: 'POST',
      body: { name: 'Legacy Admin', password: 'Strong1Pass' },
    });

    expect(res.status).toBe(403);
    expect(mock.queries.some((query) => query.sql.includes('INSERT INTO users'))).toBe(false);
  });

  it('POST /api/staff/:id/invite rejects duplicate pending invite (same email)', async () => {
    mock = createMockDB({
      tables: {
        staff: [{ id: 42, name: 'A', email: 'dup@x.io',
                  position: 'Nurse', status: 'active', user_id: null, tenant_id: T }],
        tenants: [{ id: T, subdomain: 'demo' }],
      },
      queryOverride: (sql) => {
        if (/FROM invitations/i.test(sql) && /accepted_at IS NULL/i.test(sql) && /email = \?|staff_id = \?/i.test(sql)) {
          return { first: { id: 7 } };
        }
        return null;
      },
    });
    const { app } = createTestApp({
      route: staffRoutes, routePath: '/api/staff',
      role: 'hospital_admin', tenantId: String(T),
      mockDB: mock,
    });
    const res = await jsonRequest(app, '/api/staff/42/invite', { method: 'POST', body: { email: 'dup@x.io' } });
    expect(res.status).toBe(409);
  });

  it('POST /api/staff/:id/invite rejects duplicate pending invite (same staff_id)', async () => {
    mock = createMockDB({
      tables: {
        staff: [{ id: 42, name: 'A', email: 'other@x.io',
                  position: 'Nurse', status: 'active', user_id: null, tenant_id: T }],
        tenants: [{ id: T, subdomain: 'demo' }],
      },
      queryOverride: (sql) => {
        if (/FROM invitations/i.test(sql) && /accepted_at IS NULL/i.test(sql) && /email = \?|staff_id = \?/i.test(sql)) {
          return { first: { id: 8 } };
        }
        return null;
      },
    });
    const { app } = createTestApp({
      route: staffRoutes, routePath: '/api/staff',
      role: 'hospital_admin', tenantId: String(T),
      mockDB: mock,
    });
    const res = await jsonRequest(app, '/api/staff/42/invite', { method: 'POST', body: { email: 'other@x.io' } });
    expect(res.status).toBe(409);
  });

  it('POST /api/staff/:id/invite rejects when staff already linked', async () => {
    mock = createMockDB({
      tables: {
        staff: [{ id: 42, name: 'A', email: 'linked@x.io',
                  position: 'Nurse', status: 'active', user_id: 7, tenant_id: T }],
        tenants: [{ id: T, subdomain: 'demo' }],
      },
    });
    const { app } = createTestApp({
      route: staffRoutes, routePath: '/api/staff',
      role: 'hospital_admin', tenantId: String(T),
      mockDB: mock,
    });
    const res = await jsonRequest(app, '/api/staff/42/invite', { method: 'POST', body: { email: 'linked@x.io' } });
    expect(res.status).toBe(409);
  });

  it('schema: doctor flow still works, mutual exclusion enforced (regression)', async () => {
    const { createInvitationSchema } = await import('../../../src/schemas/invitation');
    const ok = createInvitationSchema.safeParse({ email: 'd@x.io', role: 'doctor', doctorId: 5 });
    expect(ok.success).toBe(true);
    const both = createInvitationSchema.safeParse({ email: 'd@x.io', role: 'doctor', doctorId: 5, staffId: 9 });
    expect(both.success).toBe(false);
    const nurseNoStaff = createInvitationSchema.safeParse({ email: 'n@x.io', role: 'nurse' });
    expect(nurseNoStaff.success).toBe(true);
    const managerNoStaff = createInvitationSchema.safeParse({ email: 'm@x.io', role: 'manager' });
    expect(managerNoStaff.success).toBe(true);
    const ownerInvite = createInvitationSchema.safeParse({ email: 'owner@x.io', role: 'hospital_admin' });
    expect(ownerInvite.success).toBe(false);
  });

  it('allows delegated management staff with staff:write to list invitations', async () => {
    const { app } = createTestApp({
      route: invitationRoutes,
      routePath: '/api/invitations',
      role: 'md',
      tenantId: String(T),
      tables: { invitations: [] },
    });

    const res = await app.request('/api/invitations');
    expect(res.status).toBe(200);
  });

  it('blocks staff without staff:write from invitation management', async () => {
    const { app } = createTestApp({
      route: invitationRoutes,
      routePath: '/api/invitations',
      role: 'reception',
      tenantId: String(T),
    });

    const res = await app.request('/api/invitations');
    expect(res.status).toBe(403);
  });

  it('blocks the staff-profile invite path from assigning privileged management roles without roles:manage', async () => {
    const { app } = createTestApp({
      route: staffRoutes,
      routePath: '/api/staff',
      role: 'md',
      tenantId: String(T),
      userId: 7,
      tables: {
        staff: [{
          id: 42,
          name: 'Operations Director',
          email: 'director@example.com',
          position: 'Director',
          status: 'active',
          user_id: null,
          tenant_id: T,
        }],
        users: [],
        invitations: [],
        tenants: [{ id: T, subdomain: 'demo', name: 'Demo Hospital' }],
      },
    });

    const res = await jsonRequest(app, '/api/staff/42/invite', {
      method: 'POST',
      body: {},
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining('roles:manage'),
    });
  });

  it('never allows the staff-profile invite path to create another hospital_admin', async () => {
    const { app } = createTestApp({
      route: staffRoutes,
      routePath: '/api/staff',
      role: 'hospital_admin',
      tenantId: String(T),
      userId: 7,
      tables: {
        staff: [{
          id: 42,
          name: 'Admin Staff',
          email: 'admin@example.com',
          position: 'Hospital Admin',
          status: 'active',
          user_id: null,
          tenant_id: T,
        }],
      },
    });

    const res = await jsonRequest(app, '/api/staff/42/invite', {
      method: 'POST',
      body: { role: 'hospital_admin' },
    });

    expect(res.status).toBe(400);
  });

  it('allows a delegated staff manager with staff:write to invite a doctor profile', async () => {
    const { app } = createTestApp({
      route: doctorRoutes,
      routePath: '/api/doctors',
      role: 'md',
      tenantId: String(T),
      userId: 7,
      tables: {
        doctors: [{ id: 5, name: 'Dr. Ayesha', email: 'doctor@example.com', user_id: null, tenant_id: T }],
        users: [],
        invitations: [],
        tenants: [{ id: T, subdomain: 'demo', name: 'Demo Hospital' }],
      },
    });

    const res = await jsonRequest(app, '/api/doctors/5/invite', {
      method: 'POST',
      body: {},
    });

    expect(res.status).toBe(201);
  });

  it('does not expose stored invitation token hashes in the invitation list', async () => {
    const { app } = createTestApp({
      route: invitationRoutes,
      routePath: '/api/invitations',
      role: 'hospital_admin',
      tenantId: String(T),
      queryOverride: (sql) => {
        if (sql.includes('FROM invitations i')) {
          return {
            results: [{
              id: 9,
              email: 'pending@example.com',
              role: 'nurse',
              expires_at: new Date(Date.now() + 86400000).toISOString(),
              accepted_at: null,
              revoked_at: null,
              created_at: new Date().toISOString(),
              doctor_id: null,
              doctor_name: null,
              token: '[REDACTED_SECRET]',
              invited_by_name: 'Hospital Admin',
            }],
          };
        }
        return null;
      },
    });

    const res = await app.request('/api/invitations');
    const body = await res.json() as { invitations: Array<Record<string, unknown>> };

    expect(res.status).toBe(200);
    expect(body.invitations[0]).not.toHaveProperty('token');
  });

  it('blocks delegated staff managers from inviting privileged management roles without roles:manage', async () => {
    const { app } = createTestApp({
      route: invitationRoutes,
      routePath: '/api/invitations',
      role: 'md',
      tenantId: String(T),
      userId: 7,
      tables: {
        users: [],
        invitations: [],
        tenants: [{ id: T, subdomain: 'demo', name: 'Demo Hospital' }],
      },
    });

    const res = await jsonRequest(app, '/api/invitations', {
      method: 'POST',
      body: { email: 'director@example.com', role: 'director' },
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining('roles:manage'),
    });
  });

  it('still lets delegated staff managers invite operational roles and records the invitation audit', async () => {
    const { app, mockDB } = createTestApp({
      route: invitationRoutes,
      routePath: '/api/invitations',
      role: 'md',
      tenantId: String(T),
      userId: 7,
      tables: {
        users: [],
        invitations: [],
        tenants: [{ id: T, subdomain: 'demo', name: 'Demo Hospital' }],
      },
    });

    const res = await jsonRequest(app, '/api/invitations', {
      method: 'POST',
      body: { email: 'nurse@example.com', role: 'nurse' },
    });

    expect(res.status).toBe(201);
    expect(mockDB.queries.some((query) => query.sql.includes('INSERT INTO audit_logs'))).toBe(true);
    const pendingInviteQuery = mockDB.queries.find((query) => query.sql.includes('SELECT id FROM invitations WHERE email'));
    expect(pendingInviteQuery?.sql).toContain('datetime(expires_at) > datetime');
  });
});
