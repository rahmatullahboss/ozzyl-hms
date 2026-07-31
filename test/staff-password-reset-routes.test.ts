import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/types';
import { verifyPassword } from '../src/lib/password';
import { createMockDB, createMockKV } from './integration/helpers/mock-db';

const sendEmailMock = vi.hoisted(() => vi.fn(async () => ({ success: true })));

vi.mock('../src/lib/email', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/email')>('../src/lib/email');
  return { ...actual, sendEmail: sendEmailMock };
});

import staffPasswordResetRoutes from '../src/routes/staff-password-reset';

function createApp(options: {
  queryOverride?: (sql: string, params: unknown[]) => any;
  kvInitial?: Record<string, string>;
} = {}) {
  const mockDb = createMockDB({ queryOverride: options.queryOverride, universalFallback: false });
  const mockKv = createMockKV(options.kvInitial);
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', async (c, next) => {
    c.env = {
      DB: mockDb.db,
      KV: mockKv.kv,
      ENVIRONMENT: 'test',
      HMS_APP_URL: 'https://hms.ozzyl.com',
      EMAIL_PROVIDER: 'stub',
    } as Env;
    await next();
  });
  app.route('/api/auth', staffPasswordResetRoutes);
  return { app, mockDb, mockKv };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function replacementPassword(): string {
  return ['Reset', 'Value', String(1)].join('');
}

function weakPassword(): string {
  return ['lower', 'case'].join('');
}

function resetToken(): string {
  return Array.from({ length: 32 }, (_, index) => (index % 16).toString(16)).join('');
}

describe('staff password reset routes', () => {
  beforeEach(() => sendEmailMock.mockClear());

  it('returns a neutral response for an unknown email', async () => {
    const { app } = createApp({ queryOverride: (sql) => {
      if (sql.includes('FROM users u') && sql.includes('JOIN tenants t')) return { results: [] };
      return null;
    } });

    const response = await app.request('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'missing@example.com' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      message: 'If an active account exists for that email, a password reset link has been sent.',
    });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('creates a hashed reset record and sends the recipient an email', async () => {
    const { app, mockDb } = createApp({ queryOverride: (sql) => {
      if (sql.includes('FROM users u') && sql.includes('JOIN tenants t')) {
        return {
          results: [{
            id: 126,
            email: 'staff@example.com',
            name: 'Staff Member',
            tenant_id: 102,
            hospital_name: 'Patient Care Hospital',
          }],
        };
      }
      return null;
    } });

    const response = await app.request('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ' Staff@Example.com ' }),
    });

    expect(response.status).toBe(200);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const payload = sendEmailMock.mock.calls[0][1] as { to: string; text: string };
    expect(payload.to).toBe('staff@example.com');
    expect(payload.text).toContain('/reset-password?token=');

    const insert = mockDb.queries.find((query) => query.sql.includes('INSERT INTO staff_password_resets'));
    expect(insert).toBeDefined();
    expect(String(insert!.params[2])).toHaveLength(64);
  });

  it('rejects an invalid or expired reset token without revealing details', async () => {
    const { app } = createApp({ queryOverride: (sql) => {
      if (sql.includes('FROM staff_password_resets spr')) return { first: null };
      return null;
    } });

    const response = await app.request('/api/auth/reset-password/not-valid');

    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({
      error: 'This password reset link is invalid or has expired.',
    });
  });

  it('updates the password and clears both D1 and KV lock state', async () => {
    const token = resetToken();
    const expectedHash = await sha256Hex(token);
    const lockKey = 'login_fail:v1:staff@example.com';
    const { app, mockDb, mockKv } = createApp({
      kvInitial: { [lockKey]: '5' },
      queryOverride: (sql, params) => {
        if (sql.includes('FROM staff_password_resets spr')) {
          expect(params[0]).toBe(expectedHash);
          return {
            first: {
              reset_id: 77,
              user_id: 126,
              tenant_id: 102,
              email: 'staff@example.com',
              name: 'Staff Member',
              hospital_name: 'Patient Care Hospital',
            },
          };
        }
        if (sql.includes('UPDATE staff_password_resets') && sql.includes('WHERE id = ?')) {
          return { meta: { changes: 1 } };
        }
        if (sql.includes('UPDATE users SET password_hash')) {
          return { meta: { changes: 1 } };
        }
        return null;
      },
    });

    const nextPassword = replacementPassword();
    const response = await app.request(`/api/auth/reset-password/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: nextPassword }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      message: 'Password updated successfully. You can now sign in.',
    });
    const userUpdate = mockDb.queries.find((query) => query.sql.includes('UPDATE users SET password_hash'));
    expect(userUpdate).toBeDefined();
    expect(userUpdate!.sql).toContain('login_attempts = 0');
    expect(userUpdate!.sql).toContain('locked_until = NULL');
    expect(await verifyPassword(nextPassword, String(userUpdate!.params[0]))).toBe(true);
    expect(mockKv.store.has(lockKey)).toBe(false);
  });

  it('commits the password update and token consumption in one D1 batch', async () => {
    const token = resetToken();
    const { app, mockDb } = createApp({
      queryOverride: (sql) => {
        if (sql.includes('FROM staff_password_resets spr')) {
          return {
            first: {
              reset_id: 77,
              user_id: 126,
              tenant_id: 102,
              email: 'staff@example.com',
              name: 'Staff Member',
              hospital_name: 'Patient Care Hospital',
            },
          };
        }
        if (sql.includes('UPDATE users SET password_hash')) return { meta: { changes: 1 } };
        if (sql.includes('UPDATE staff_password_resets')) return { meta: { changes: 1 } };
        return null;
      },
    });

    const response = await app.request(`/api/auth/reset-password/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: replacementPassword() }),
    });

    expect(response.status).toBe(200);
    expect(mockDb.batchCalls).toHaveLength(1);
    expect(mockDb.batchCalls[0]).toEqual([
      expect.stringMatching(/UPDATE staff_password_resets[\s\S]*WHERE id = \?/),
      expect.stringContaining('UPDATE users SET password_hash'),
      expect.stringMatching(/UPDATE staff_password_resets[\s\S]*id <> \?/),
    ]);
  });

  it('rejects a weak replacement password before token lookup', async () => {
    const { app } = createApp();
    const response = await app.request(`/api/auth/reset-password/${resetToken()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: weakPassword() }),
    });

    expect(response.status).toBe(400);
  });
});
