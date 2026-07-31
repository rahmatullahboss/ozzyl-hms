/**
 * Integration tests for the Remote Control admin endpoints.
 *
 * These tests define the contract for three real backend actions:
 *   - POST /api/admin/remote/maintenance  — toggle platform-wide maintenance mode
 *   - POST /api/admin/remote/broadcast    — send an in-app broadcast to one or all tenants
 *   - POST /api/admin/remote/revoke-sessions — log out all admin sessions
 *
 * All three require super_admin role.
 *
 * Danger buttons (emergency shutdown, force password reset) are NOT
 * implemented as live endpoints — they remain labeled "(demo)" in the UI
 * because they would cause immediate, irreversible impact on production.
 */

import { describe, it, expect } from 'vitest';
import adminRoute from '../../../src/routes/admin/index';
import { createTestApp } from '../helpers/test-app';
import { createMockDB, createMockKV } from '../helpers/mock-db';

function makeApp() {
  return createTestApp({
    route: adminRoute,
    routePath: '/api/admin',
    role: 'super_admin',
    tenantId: 'tenant-1',
    mockDB: createMockDB({ tables: {} }),
    mockKV: createMockKV(),
  });
}

describe('Remote Control — maintenance mode', () => {
  it('enables maintenance mode (returns enabled: true)', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/admin/remote/maintenance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { enabled: boolean };
    expect(body.enabled).toBe(true);
  });

  it('disables maintenance mode (returns enabled: false)', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/admin/remote/maintenance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { enabled: boolean };
    expect(body.enabled).toBe(false);
  });

  it('rejects invalid payload (missing enabled field)', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/admin/remote/maintenance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('rejects non-super_admin callers (RBAC)', async () => {
    const { app } = createTestApp({
      route: adminRoute,
      routePath: '/api/admin',
      role: 'hospital_admin', // not super_admin
      tenantId: 'tenant-1',
      mockDB: createMockDB({ tables: {} }),
      mockKV: createMockKV(),
    });
    const res = await app.request('/api/admin/remote/maintenance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.status).toBe(403);
  });
});

describe('Remote Control — broadcast', () => {
  it('sends a broadcast to all tenants (target: "all")', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/admin/remote/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target: 'all',
        message: 'Scheduled maintenance at 23:00 GMT',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sent: number; target: string };
    expect(body.target).toBe('all');
    expect(body.sent).toBeGreaterThanOrEqual(0);
  });

  it('sends a broadcast to a single tenant (target: numeric tenant_id)', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/admin/remote/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target: 42,
        message: 'Your account has a new feature',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sent: number };
    expect(body.sent).toBe(1);
  });

  it('rejects an empty message (sending blank broadcasts is a UX bug)', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/admin/remote/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'all', message: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a missing target (sending broadcasts requires an audience)', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/admin/remote/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('Remote Control — revoke sessions', () => {
  it('returns the number of sessions revoked (≥ 0)', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/admin/remote/revoke-sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { revoked: number };
    expect(body.revoked).toBeGreaterThanOrEqual(0);
  });

  it('optionally accepts a scope (only admins, or all users)', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/admin/remote/revoke-sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'admins' }),
    });
    expect(res.status).toBe(200);
  });

  it('rejects an invalid scope (e.g. "everyone" is not a valid value)', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/admin/remote/revoke-sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'everyone' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects non-super_admin callers (RBAC)', async () => {
    const { app } = createTestApp({
      route: adminRoute,
      routePath: '/api/admin',
      role: 'doctor',
      tenantId: 'tenant-1',
      mockDB: createMockDB({ tables: {} }),
      mockKV: createMockKV(),
    });
    const res = await app.request('/api/admin/remote/revoke-sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
  });
});
