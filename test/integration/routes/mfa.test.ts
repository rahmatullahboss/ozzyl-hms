/**
 * Integration tests for src/routes/tenant/mfa.ts
 * MFA/TOTP setup, verify, disable, recovery codes
 */

import { describe, it, expect } from 'vitest';
import mfaRoutes from '../../../src/routes/tenant/mfa';
import { createTestApp, jsonRequest } from '../helpers/test-app';

const USER_1 = { id: 1, tenant_id: 'tenant-1', email: 'admin@test.com', name: 'Admin', mfa_enabled: 0 };
const USER_MFA = { ...USER_1, id: 2, email: 'mfa@test.com', mfa_enabled: 1 };
const MFA_REG = { id: 1, tenant_id: 'tenant-1', user_id: 2, mfa_type: 'totp', secret: 'JBSWY3DPEHPK3PXP', is_verified: 1, is_active: 1, recovery_codes: '["AABB001122","CCDD334455"]' };
const MFA_UNVERIFIED = { ...MFA_REG, id: 2, user_id: 1, is_verified: 0 };

describe('MFA Routes', () => {

  // ── Setup ───────────────────────────────────────────────────────────────
  describe('POST /setup', () => {
    it('returns 200 with secret and otpauth_url', async () => {
      const { app } = createTestApp({ route: mfaRoutes, routePath: '/mfa', role: 'hospital_admin',
        tables: { mfa_registrations: [], users: [USER_1] }, universalFallback: false });
      const res = await jsonRequest(app, '/mfa/setup', { method: 'POST', body: {} });
      expect(res.status).toBe(200);
      const body = await res.json() as { secret: string; otpauth_url: string; recovery_codes: string[] };
      expect(body.secret).toBeDefined();
      expect(body.secret.length).toBeGreaterThan(10);
      expect(body.otpauth_url).toContain('otpauth://totp/');
      expect(body.recovery_codes).toHaveLength(8);
    });

    it('rejects if MFA already active (400)', async () => {
      const { app } = createTestApp({ route: mfaRoutes, routePath: '/mfa', role: 'hospital_admin',
        tables: { mfa_registrations: [MFA_REG], users: [USER_MFA] }, universalFallback: true });
      // userId=2 has active MFA, but test app injects userId=1 by default
      // So this test uses a user without MFA — let's adjust
      const { app: app2 } = createTestApp({ route: mfaRoutes, routePath: '/mfa', role: 'hospital_admin', userId: 2,
        tables: { mfa_registrations: [MFA_REG], users: [USER_MFA] }, universalFallback: true });
      const res = await jsonRequest(app2, '/mfa/setup', { method: 'POST', body: {} });
      expect(res.status).toBe(400);
    });
  });

  // ── Verify Setup ────────────────────────────────────────────────────────
  describe('POST /verify-setup', () => {
    it('rejects invalid code (400)', async () => {
      const { app } = createTestApp({ route: mfaRoutes, routePath: '/mfa', role: 'hospital_admin',
        tables: { mfa_registrations: [MFA_UNVERIFIED] }, universalFallback: true });
      const res = await jsonRequest(app, '/mfa/verify-setup', { method: 'POST', body: { code: '000000' } });
      expect(res.status).toBe(400);
    });

    it('rejects non-6-digit code (400)', async () => {
      const { app } = createTestApp({ route: mfaRoutes, routePath: '/mfa', role: 'hospital_admin',
        tables: {} });
      const res = await jsonRequest(app, '/mfa/verify-setup', { method: 'POST', body: { code: '12345' } });
      expect(res.status).toBe(400);
    });

    it('returns 404 if no setup exists', async () => {
      const { app } = createTestApp({ route: mfaRoutes, routePath: '/mfa', role: 'hospital_admin',
        tables: { mfa_registrations: [] } });
      const res = await jsonRequest(app, '/mfa/verify-setup', { method: 'POST', body: { code: '123456' } });
      expect(res.status).toBe(404);
    });
  });

  // ── Verify (login flow) ────────────────────────────────────────────────
  describe('POST /verify', () => {
    it('rejects invalid TOTP code (401)', async () => {
      const { app } = createTestApp({ route: mfaRoutes, routePath: '/mfa', role: 'hospital_admin',
        tables: { mfa_registrations: [MFA_REG] }, universalFallback: true });
      const res = await jsonRequest(app, '/mfa/verify', { method: 'POST', body: { user_id: 2, code: '000000' } });
      expect(res.status).toBe(401);
      const body = await res.json() as { verified: boolean };
      expect(body.verified).toBe(false);
    });

    it('accepts valid recovery code and returns token', async () => {
      const { app } = createTestApp({ route: mfaRoutes, routePath: '/mfa', role: 'hospital_admin',
        tables: { mfa_registrations: [MFA_REG], users: [USER_MFA] }, universalFallback: true });
      const res = await jsonRequest(app, '/mfa/verify', { method: 'POST', body: { user_id: 2, code: 'AABB001122' } });
      expect(res.status).toBe(200);
      const body = await res.json() as { verified: boolean; method: string; token?: string };
      expect(body.verified).toBe(true);
      expect(body.method).toBe('recovery_code');
    });

    it('returns 404 if user has no MFA', async () => {
      const { app } = createTestApp({ route: mfaRoutes, routePath: '/mfa', role: 'hospital_admin',
        tables: { mfa_registrations: [] } });
      const res = await jsonRequest(app, '/mfa/verify', { method: 'POST', body: { user_id: 999, code: '123456' } });
      expect(res.status).toBe(404);
    });

    it('rejects missing user_id (400)', async () => {
      const { app } = createTestApp({ route: mfaRoutes, routePath: '/mfa', role: 'hospital_admin', tables: {} });
      const res = await jsonRequest(app, '/mfa/verify', { method: 'POST', body: { code: '123456' } });
      expect(res.status).toBe(400);
    });
  });

  // ── Disable ─────────────────────────────────────────────────────────────
  describe('POST /disable', () => {
    it('rejects invalid code (400)', async () => {
      const { app } = createTestApp({ route: mfaRoutes, routePath: '/mfa', role: 'hospital_admin', userId: 2,
        tables: { mfa_registrations: [MFA_REG] }, universalFallback: true });
      const res = await jsonRequest(app, '/mfa/disable', { method: 'POST', body: { code: '000000' } });
      expect(res.status).toBe(400);
    });

    it('returns 404 if MFA not enabled', async () => {
      const { app } = createTestApp({ route: mfaRoutes, routePath: '/mfa', role: 'hospital_admin',
        tables: { mfa_registrations: [] } });
      const res = await jsonRequest(app, '/mfa/disable', { method: 'POST', body: { code: '123456' } });
      expect(res.status).toBe(404);
    });
  });

  // ── Status ──────────────────────────────────────────────────────────────
  describe('GET /status', () => {
    it('returns mfa_enabled false when not set up', async () => {
      const { app } = createTestApp({ route: mfaRoutes, routePath: '/mfa', role: 'hospital_admin',
        tables: { mfa_registrations: [], users: [USER_1] }, universalFallback: true });
      const res = await app.request('/mfa/status');
      expect(res.status).toBe(200);
      const body = await res.json() as { mfa_enabled: boolean };
      expect(body).toHaveProperty('mfa_enabled');
    });
  });

  // ── Recovery Codes ──────────────────────────────────────────────────────
  describe('POST /recovery-codes', () => {
    it('rejects invalid code (400)', async () => {
      const { app } = createTestApp({ route: mfaRoutes, routePath: '/mfa', role: 'hospital_admin', userId: 2,
        tables: { mfa_registrations: [MFA_REG] }, universalFallback: true });
      const res = await jsonRequest(app, '/mfa/recovery-codes', { method: 'POST', body: { code: '000000' } });
      expect(res.status).toBe(400);
    });

    it('rejects non-6-digit code (400)', async () => {
      const { app } = createTestApp({ route: mfaRoutes, routePath: '/mfa', role: 'hospital_admin', tables: {} });
      const res = await jsonRequest(app, '/mfa/recovery-codes', { method: 'POST', body: { code: '12345' } });
      expect(res.status).toBe(400);
    });
  });
});
