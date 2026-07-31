import { describe, expect, it } from 'vitest';
import doctorRoutes from '../src/routes/tenant/doctors';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp } from './integration/helpers/test-app';

describe('name-based doctor fallback is removed', () => {
  it('returns 404 when only name match would have succeeded (no user_id, no staff link)', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const s = sql.toLowerCase();
        // user_id direct match — nothing
        if (s.includes('from doctors') && s.includes('user_id')) {
          return { first: null };
        }
        // staff join — nothing
        if (s.includes('from staff')) {
          return { first: null };
        }
        // users table returns a name — previously used for fallback
        if (s.includes('from users')) {
          return { first: { name: 'Dr Matchable' } };
        }
        // name-based doctor lookup — would have found a match
        if (s.includes('from doctors') && s.includes('where name')) {
          return { first: { id: 5, name: 'Dr Matchable', specialty: 'Cardiology', department: 'Medicine', qualifications: 'MBBS', consultation_fee: 500 } };
        }
        return null;
      },
    });

    const { app } = createTestApp({
      route: doctorRoutes,
      routePath: '/doctors',
      role: 'doctor',
      tenantId: 'tenant-1',
      userId: 999,
      mockDB,
    });

    const res = await app.request('/doctors/dashboard');
    // After removal: must be 404, NOT 200
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error', 'No doctor profile linked');
  });

  it('never queries users table for name-based matching', async () => {
    const queriedTables: string[] = [];
    const mockDB = createMockDB({
      queryOverride(sql) {
        const s = sql.toLowerCase();
        if (s.includes('from doctors') && s.includes('user_id')) {
          queriedTables.push('doctors:user_id');
          return { first: null };
        }
        if (s.includes('from staff')) {
          queriedTables.push('staff');
          return { first: null };
        }
        if (s.includes('from users')) {
          queriedTables.push('users');
          return { first: { name: 'Dr Someone' } };
        }
        if (s.includes('from doctors') && s.includes('where name')) {
          queriedTables.push('doctors:name');
          return { first: null };
        }
        return null;
      },
    });

    const { app } = createTestApp({
      route: doctorRoutes,
      routePath: '/doctors',
      role: 'doctor',
      tenantId: 'tenant-1',
      userId: 999,
      mockDB,
    });

    await app.request('/doctors/dashboard');
    // After removal: should NOT query users table or doctors-by-name
    expect(queriedTables).not.toContain('users');
    expect(queriedTables).not.toContain('doctors:name');
  });

  it('still resolves doctor via user_id direct match', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const s = sql.toLowerCase();
        if (s.includes('from doctors') && s.includes('user_id')) {
          return { first: { id: 5, name: 'Dr Direct', specialty: 'Cardiology', department: 'Medicine', qualifications: 'MBBS', consultation_fee: 500 } };
        }
        return null;
      },
    });

    const { app } = createTestApp({
      route: doctorRoutes,
      routePath: '/doctors',
      role: 'doctor',
      tenantId: 'tenant-1',
      userId: 42,
      mockDB,
    });

    const res = await app.request('/doctors/dashboard');
    expect(res.status).toBe(200);
  });

  it('still resolves doctor via staff.doctor_id link', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const s = sql.toLowerCase();
        if (s.includes('from doctors') && s.includes('user_id')) {
          return { first: null };
        }
        if (s.includes('from staff')) {
          return { first: { id: 7, name: 'Dr ViaStaff', specialty: 'Surgery', department: 'Surgery', qualifications: 'MBBS, FCPS', consultation_fee: 800 } };
        }
        return null;
      },
    });

    const { app } = createTestApp({
      route: doctorRoutes,
      routePath: '/doctors',
      role: 'doctor',
      tenantId: 'tenant-1',
      userId: 42,
      mockDB,
    });

    const res = await app.request('/doctors/dashboard');
    expect(res.status).toBe(200);
  });
});
