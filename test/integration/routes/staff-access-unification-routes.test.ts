import { describe, expect, it } from 'vitest';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import { createMockDB } from '../helpers/mock-db';
import staffRoutes from '../../../src/routes/tenant/staff';
import invitationRoutes from '../../../src/routes/tenant/invitations';

const T = '1';

describe('Staff access unification routes', () => {
  it('POST /api/staff creates staff without mandatory bank account and persists optional profile fields', async () => {
    const mock = createMockDB();
    const { app } = createTestApp({
      route: staffRoutes,
      routePath: '/api/staff',
      role: 'hospital_admin',
      tenantId: T,
      userId: 7,
      mockDB: mock,
    });

    const res = await jsonRequest(app, '/api/staff', {
      method: 'POST',
      body: {
        name: 'Rahim Manager',
        position: 'Manager',
        email: 'rahim@example.com',
        emergencyContact: '01711111111',
        bloodGroup: 'O+',
        category: 'manager',
        biometricDeviceId: 'BIO-01',
        shiftType: 'night',
      },
    });

    expect(res.status).toBe(201);
    const insert = mock.queries.find((q) => /INSERT INTO staff/i.test(q.sql));
    expect(insert).toBeTruthy();
    expect(insert!.sql).toContain('emergency_contact');
    expect(insert!.sql).toContain('blood_group');
    expect(insert!.sql).toContain('biometric_device_id');
    expect(insert!.params).toContain(''); // bank_account DB compatibility fallback
    expect(insert!.params).toContain('01711111111');
    expect(insert!.params).toContain('O+');
    expect(insert!.params).toContain('BIO-01');
  });

  it('PUT /api/staff/:id updates optional profile fields after initial onboarding', async () => {
    const mock = createMockDB({
      tables: {
        staff: [{
          id: 42,
          tenant_id: T,
          name: 'Rahim Manager',
          address: '',
          position: 'Manager',
          salary: 0,
          bank_account: '',
          mobile: '',
          department: null,
          email: 'rahim@example.com',
          date_of_birth: null,
          gender: null,
          salutation: null,
          emergency_contact: null,
          blood_group: null,
          category: null,
          biometric_device_id: null,
          shift_type: null,
        }],
      },
    });
    const { app } = createTestApp({
      route: staffRoutes,
      routePath: '/api/staff',
      role: 'hospital_admin',
      tenantId: T,
      userId: 7,
      mockDB: mock,
    });

    const res = await jsonRequest(app, '/api/staff/42', {
      method: 'PUT',
      body: {
        emergencyContact: '01822222222',
        bloodGroup: 'AB+',
        category: 'director',
        biometricDeviceId: 'BIO-42',
        shiftType: 'day',
      },
    });

    expect(res.status).toBe(200);
    const update = mock.queries.find((q) => /UPDATE staff SET/i.test(q.sql));
    expect(update).toBeTruthy();
    expect(update!.sql).toContain('emergency_contact');
    expect(update!.sql).toContain('shift_type');
    expect(update!.params).toContain('01822222222');
    expect(update!.params).toContain('AB+');
    expect(update!.params).toContain('BIO-42');
  });

  it('POST /api/staff/:id/invite uses selected role instead of position mapping', async () => {
    const mock = createMockDB({
      tables: {
        staff: [{ id: 42, tenant_id: T, name: 'Small Hospital Director', email: 'd@example.com', position: 'Receptionist', status: 'active', user_id: null }],
        tenants: [{ id: T, subdomain: 'demo' }],
      },
    });
    const { app } = createTestApp({
      route: staffRoutes,
      routePath: '/api/staff',
      role: 'hospital_admin',
      tenantId: T,
      userId: 7,
      mockDB: mock,
    });

    const res = await jsonRequest(app, '/api/staff/42/invite', {
      method: 'POST',
      body: { email: 'd@example.com', role: 'director' },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { invite: { role: string; staffId: number } };
    expect(body.invite.role).toBe('director');
    expect(body.invite.staffId).toBe(42);
  });

  it('POST /api/staff/:id/invite rejects invalid selected staff role', async () => {
    const mock = createMockDB({
      tables: {
        staff: [{ id: 42, tenant_id: T, name: 'Invalid Role Staff', email: 'x@example.com', position: 'Manager', status: 'active', user_id: null }],
      },
    });
    const { app } = createTestApp({
      route: staffRoutes,
      routePath: '/api/staff',
      role: 'hospital_admin',
      tenantId: T,
      mockDB: mock,
    });

    const res = await jsonRequest(app, '/api/staff/42/invite', {
      method: 'POST',
      body: { email: 'x@example.com', role: 'doctor' },
    });

    expect(res.status).toBe(400);
  });

  it('POST /api/invitations/:id/resend preserves staff_id for staff invitations', async () => {
    const mock = createMockDB({
      tables: {
        invitations: [{ id: 9, tenant_id: T, email: 'staff@example.com', role: 'manager', doctor_id: null, staff_id: 42, accepted_at: null, revoked_at: null }],
        tenants: [{ id: T, subdomain: 'demo' }],
      },
    });
    const { app } = createTestApp({
      route: invitationRoutes,
      routePath: '/api/invitations',
      role: 'hospital_admin',
      tenantId: T,
      userId: 7,
      mockDB: mock,
    });

    const res = await jsonRequest(app, '/api/invitations/9/resend', { method: 'POST', body: {} });

    expect(res.status).toBe(200);
    const insert = mock.queries.find((q) => /INSERT INTO invitations/i.test(q.sql));
    expect(insert).toBeTruthy();
    expect(insert!.sql).toContain('staff_id');
    expect(insert!.params).toContain(42);
  });
});
