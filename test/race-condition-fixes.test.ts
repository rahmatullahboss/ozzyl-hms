import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import tenantAuthRoutes from '../src/routes/tenant/auth';
import billingRoutes from '../src/routes/tenant/billing';
import type { Env, Variables } from '../src/types';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';
import { hashSync } from 'bcryptjs';

// ─── Race Condition Fix Tests ───────────────────────────────────────────────
// Verifies atomic guard clauses prevent concurrent overpayment and lockout bypass.

describe('Race Condition Fixes', () => {
  const passwordHash = hashSync('Password123', 10);

  describe('Login lockout race condition (auth.ts)', () => {
    it('locks account when attempts reach MAX_LOGIN_ATTEMPTS', async () => {
      const { app, mockDB } = createTestApp({
        route: tenantAuthRoutes,
        routePath: '/auth',
        tenantId: 'tenant-1',
        tables: {
          users: [{
            id: 1, email: 'test@test.com', password_hash: passwordHash,
            name: 'Test User', role: 'receptionist', is_active: 1,
            mfa_enabled: 0, login_attempts: 19, locked_until: null,
            tenant_id: 'tenant-1',
          }],
          tenants: [{ id: 1, name: 'Test Hospital', subdomain: 'test', tenant_id: 'tenant-1' }],
        },
        queryOverride(sql) {
          const s = sql.toLowerCase();
          // Return updated login_attempts after atomic increment
          if (s.includes('select login_attempts from users') && s.includes('where id')) {
            return { first: { login_attempts: 20 } };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/auth/login', {
        method: 'POST',
        body: { email: 'test@test.com', password: 'WrongPassword' },
      });

      expect(res.status).toBe(423);
      const body = await res.json() as { error: string };
      expect(body.error).toContain('locked');
    });

    it('returns attempts remaining when below lockout threshold', async () => {
      const { app } = createTestApp({
        route: tenantAuthRoutes,
        routePath: '/auth',
        tenantId: 'tenant-1',
        tables: {
          users: [{
            id: 1, email: 'test@test.com', password_hash: passwordHash,
            name: 'Test User', role: 'receptionist', is_active: 1,
            mfa_enabled: 0, login_attempts: 2, locked_until: null,
            tenant_id: 'tenant-1',
          }],
          tenants: [{ id: 1, name: 'Test Hospital', subdomain: 'test', tenant_id: 'tenant-1' }],
        },
      });

      const res = await jsonRequest(app, '/auth/login', {
        method: 'POST',
        body: { email: 'test@test.com', password: 'WrongPassword' },
      });

      expect(res.status).toBe(401);
      const body = await res.json() as { error: string; attempts_remaining: number };
      expect(body.error).toBe('Invalid credentials');
      expect(body.attempts_remaining).toBeGreaterThanOrEqual(0);
    });

    it('uses atomic UPDATE with login_attempts < MAX guard in WHERE clause', async () => {
      const { app, mockDB } = createTestApp({
        route: tenantAuthRoutes,
        routePath: '/auth',
        tenantId: 'tenant-1',
        tables: {
          users: [{
            id: 1, email: 'test@test.com', password_hash: passwordHash,
            name: 'Test User', role: 'receptionist', is_active: 1,
            mfa_enabled: 0, login_attempts: 2, locked_until: null,
            tenant_id: 'tenant-1',
          }],
          tenants: [{ id: 1, name: 'Test Hospital', subdomain: 'test', tenant_id: 'tenant-1' }],
        },
      });

      await jsonRequest(app, '/auth/login', {
        method: 'POST',
        body: { email: 'test@test.com', password: 'WrongPassword' },
      });

      // Verify the UPDATE uses the atomic increment-and-check pattern
      const lockoutUpdate = mockDB.queries.find(
        q => q.method === 'run' && q.sql.toUpperCase().includes('LOGIN_ATTEMPTS = LOGIN_ATTEMPTS + 1')
      );
      expect(lockoutUpdate).toBeDefined();
      expect(lockoutUpdate!.sql).toMatch(/login_attempts\s*<\s*\?/i);
    });

    it('allows login after lockout expires', async () => {
      const pastExpiry = new Date(Date.now() - 60000).toISOString();
      const { app } = createTestApp({
        route: tenantAuthRoutes,
        routePath: '/auth',
        tenantId: 'tenant-1',
        tables: {
          users: [{
            id: 1, email: 'test@test.com', password_hash: passwordHash,
            name: 'Test User', role: 'receptionist', is_active: 1,
            mfa_enabled: 0, login_attempts: 20, locked_until: pastExpiry,
            tenant_id: 'tenant-1',
          }],
          tenants: [{ id: 1, name: 'Test Hospital', subdomain: 'test', tenant_id: 'tenant-1' }],
        },
      });

      const res = await jsonRequest(app, '/auth/login', {
        method: 'POST',
        body: { email: 'test@test.com', password: 'Password123' },
      });

      // Should not be locked — lock has expired
      expect(res.status).not.toBe(423);
    });
  });

  describe('Payment race condition (billing.ts)', () => {
    const billTable = {
      id: 10, tenant_id: 'tenant-1', total: 1000, paid: 500, due: 500,
      status: 'partially_paid', patient_id: 1, bill_no: 'B001', bill_id: 10,
      test_bill: 500, doctor_visit_bill: 300, admission_bill: 200,
      operation_bill: 0, medicine_bill: 0, created_at: '2025-01-01',
    };

    it('uses an atomic outstanding guard and re-reads the bill payment state', async () => {
      const { app, mockDB } = createTestApp({
        route: billingRoutes,
        routePath: '/billing',
        role: 'reception',
        tenantId: 'tenant-1',
        userId: 1,
        tables: {
          bills: [billTable],
          billing_counter_sessions: [{
            id: 1, tenant_id: 'tenant-1', counter_id: 1, employee_id: 1,
            status: 'active', opened_at: '2025-01-01 09:00:00', workstation_id: 'test-workstation',
            counter_name: 'Main Counter', counter_code: 'C001', counter_type: 'billing', opening_cash: 0,
          }],
          billing_counters: [{
            id: 1, tenant_id: 'tenant-1', name: 'Main Counter',
            code: 'C001', type: 'billing', is_active: 1,
          }],
          accounting_periods: [{
            id: 1, tenant_id: 'tenant-1', period_date: '2025-01-01',
            status: 'open',
          }],
        },
        queryOverride: (sql) => {
          const normalized = sql.replace(/\s+/g, ' ').toLowerCase();
          if (normalized.startsWith('update "bills" set "paid"')) {
            return { success: true, meta: { changes: 1 } };
          }
          if (normalized.includes('select "paid", "due", "total", "discount", "status" from "bills"')) {
            return { results: [{ paid: 700, due: 300, total: 1000, discount: 0, status: 'partially_paid' }] };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/billing/pay', {
        method: 'POST',
        headers: { 'X-HMS-Workstation-ID': 'test-workstation' },
        body: { billId: 10, amount: 200, type: 'current', paymentMethod: 'cash' },
      });

      expect(res.status).toBe(200);

      const guardedPaymentInsert = mockDB.queries.find(
        q => q.sql.toLowerCase().includes('insert into payments')
          && q.sql.toLowerCase().includes('from bills')
      );
      expect(guardedPaymentInsert?.sql).toContain('COALESCE');
      expect(guardedPaymentInsert?.sql).toContain('>=');

      const billUpdate = mockDB.queries.find(
        q => q.sql.toLowerCase().includes('update bills')
          && q.sql.toLowerCase().includes('exists')
      );
      expect(billUpdate).toBeDefined();

      const reRead = mockDB.queries.find(
        q => q.sql.toLowerCase().includes('select paid, due, status from bills')
      );
      expect(reRead).toBeDefined();
    });
  });
});
