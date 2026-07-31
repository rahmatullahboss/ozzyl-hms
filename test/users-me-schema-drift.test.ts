/**
 * Regression test for the /api/users/me 500 caused by missing
 * `photo_url` / `mobile` columns on the `users` table.
 *
 * Migration 0346 adds the columns. The route should also degrade
 * gracefully (return 200 with photo_url=null) if a tenant DB still
 * hasn't run the migration, so the profile page never throws.
 *
 * See: src/routes/tenant/users.ts GET /me handler.
 */

import { describe, it, expect } from 'vitest';
import { createTestApp } from './integration/helpers/test-app';
import userRoutes from '../src/routes/tenant/users';

const TENANT_ID = 'tenant-1';

describe('GET /api/users/me — schema-drift safety', () => {
  it('returns 200 with photo_url when the users table has photo_url', async () => {
    const { app } = createTestApp({
      route: userRoutes,
      routePath: '/users',
      role: 'hospital_admin',
      tenantId: TENANT_ID,
      tables: {
        users: [
          {
            id: 1,
            tenant_id: TENANT_ID,
            email: 'admin@hospital.com',
            name: 'Admin User',
            role: 'hospital_admin',
            phone: '01700000000',
            username: 'admin',
            department: 'Ops',
            is_active: 1,
            created_at: '2026-01-01 00:00:00',
          },
        ],
      },
    });

    const res = await app.request('/users/me');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.email).toBe('admin@hospital.com');
    expect(body.name).toBe('Admin User');
    expect(body.photo_url).toBeNull();
  });

  it('falls back to base columns and still returns 200 when photo_url is missing', async () => {
    // Simulate the prod-DB schema where `photo_url` and `mobile`
    // were never added. First SELECT throws, fallback SELECT works.
    let callCount = 0;
    const { app } = createTestApp({
      route: userRoutes,
      routePath: '/users',
      role: 'hospital_admin',
      tenantId: TENANT_ID,
      queryOverride: (sql, _params) => {
        callCount++;
        if (callCount === 1 && /photo_url/.test(sql)) {
          throw new Error('D1 SQL_ERROR: no such column: photo_url');
        }
        // Fallback query (or any later query) returns the row
        if (/FROM users/i.test(sql)) {
          return {
            first: {
              id: 1,
              tenant_id: TENANT_ID,
              email: 'admin@hospital.com',
              name: 'Admin User',
              role: 'hospital_admin',
              phone: '01700000000',
              username: 'admin',
              department: 'Ops',
              is_active: 1,
              created_at: '2026-01-01 00:00:00',
            },
          };
        }
        return null;
      },
    });

    const res = await app.request('/users/me');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.email).toBe('admin@hospital.com');
    expect(body.photo_url).toBeNull();
  });

  it('returns 404 when the user is genuinely missing', async () => {
    const { app } = createTestApp({
      route: userRoutes,
      routePath: '/users',
      role: 'hospital_admin',
      tenantId: TENANT_ID,
      tables: { users: [] },
    });

    const res = await app.request('/users/me');
    expect(res.status).toBe(404);
  });
});
