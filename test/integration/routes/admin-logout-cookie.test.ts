/**
 * Integration tests for admin logout cookie clearing.
 *
 * Logout must clear the admin_token cookie so the browser no longer sends
 * the JWT on subsequent requests, even if a script tries to forge one.
 *
 * These tests exercise the REAL /api/admin/logout endpoint in the production
 * admin route file, not a stub.
 */

import { describe, it, expect } from 'vitest';
import adminRoute from '../../../src/routes/admin/index';
import { createTestApp } from '../helpers/test-app';
import { createMockDB, createMockKV } from '../helpers/mock-db';

describe('POST /api/admin/logout — cookie clearing', () => {
  function makeApp() {
    const mockDB = createMockDB({ tables: {} });
    const mockKV = createMockKV();
    return createTestApp({
      route: adminRoute,
      routePath: '/api/admin',
      role: undefined, // logout should work without auth too
      tenantId: 'tenant-1',
      mockDB,
      mockKV,
    });
  }

  it('clears the admin_token cookie via Set-Cookie with Max-Age=0', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/admin/logout', { method: 'POST' });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') || '';
    expect(setCookie).toMatch(/admin_token=/);
    // Max-Age=0 tells the browser to delete the cookie immediately
    expect(setCookie).toMatch(/Max-Age=0/i);
  });

  it('clears the cookie with the same path scope it was set with', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/admin/logout', { method: 'POST' });
    const setCookie = res.headers.get('set-cookie') || '';
    expect(setCookie).toMatch(/Path=\//i);
  });

  it('is callable without an existing session (idempotent)', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/admin/logout', { method: 'POST' });
    // Logout without a session still returns 200 — clearing a non-existent
    // cookie is a no-op for the browser, so we should never 401 on logout.
    expect(res.status).toBe(200);
  });
});
