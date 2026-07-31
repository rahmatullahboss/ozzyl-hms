import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types';
import { createMockDB } from '../helpers/mock-db';

const passwordModule = vi.hoisted(() => ({
  verifyPassword: vi.fn<(password: string, storedHash: string | null | undefined) => Promise<boolean>>(),
  hashPassword: vi.fn<(password: string) => Promise<string>>(),
  isLegacyBcryptHash: vi.fn<(storedHash: string | null | undefined) => boolean>(),
}));

vi.mock('../../../src/lib/password', () => passwordModule);

import loginDirect from '../../../src/routes/login-direct';

const LOGIN_VALUE = '[REDACTED_SECRET]';

function createApp(users: Array<Record<string, unknown>>) {
  const mock = createMockDB({
    universalFallback: false,
    queryOverride(sql) {
      if (sql.includes('FROM users u') && sql.includes('JOIN tenants t')) {
        return { results: users, success: true, meta: {} };
      }
      return null;
    },
  });

  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.env = {
      DB: mock.db,
      KV: {
        get: async () => null,
        put: async () => {},
        delete: async () => {},
        list: async () => ({ keys: [], list_complete: true, cacheStatus: null }),
      } as unknown as KVNamespace,
      JWT_SECRET: '[REDACTED_SECRET]',
      ENVIRONMENT: 'development',
    } as Env;
    await next();
  });
  app.route('/auth/login-direct', loginDirect);

  return { app, mock };
}

function requestLogin(app: Hono, body: Record<string, unknown>) {
  return app.request('/auth/login-direct', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function user(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    email: 'staff@test.com',
    password_hash: 'hash-one',
    name: 'Staff',
    role: 'doctor',
    tenant_id: 1,
    hospital_name: 'Hospital One',
    slug: 'one',
    tenant_status: 'active',
    ...overrides,
  };
}

describe('login-direct CPU hardening', () => {
  beforeEach(() => {
    passwordModule.verifyPassword.mockReset();
    passwordModule.hashPassword.mockReset();
    passwordModule.isLegacyBcryptHash.mockReset();
    passwordModule.hashPassword.mockResolvedValue('upgraded-hash');
    passwordModule.isLegacyBcryptHash.mockReturnValue(false);
  });

  it('does not verify the selected multi-tenant password twice', async () => {
    passwordModule.verifyPassword.mockImplementation(async (_password, storedHash) => storedHash === 'hash-two');
    const { app } = createApp([
      user({ id: 1, tenant_id: 1, password_hash: 'hash-one', slug: 'one' }),
      user({ id: 2, tenant_id: 2, password_hash: 'hash-two', slug: 'two', hospital_name: 'Hospital Two' }),
    ]);

    const response = await requestLogin(app, {
      email: 'staff@test.com',
      password: LOGIN_VALUE,
    });

    expect(response.status).toBe(200);
    expect(passwordModule.verifyPassword).toHaveBeenCalledTimes(2);
    expect(passwordModule.verifyPassword).toHaveBeenNthCalledWith(1, LOGIN_VALUE, 'hash-one');
    expect(passwordModule.verifyPassword).toHaveBeenNthCalledWith(2, LOGIN_VALUE, 'hash-two');
  });

  it('upgrades a successfully verified legacy bcrypt hash to PBKDF2', async () => {
    const legacyHash = 'legacy-bcrypt-hash';
    const upgradedHash = 'upgraded-hash';
    passwordModule.verifyPassword.mockResolvedValue(true);
    passwordModule.hashPassword.mockResolvedValue(upgradedHash);
    passwordModule.isLegacyBcryptHash.mockImplementation((storedHash) => storedHash === legacyHash);
    const { app, mock } = createApp([
      user({ id: 7, tenant_id: 4, password_hash: legacyHash, slug: 'legacy-hospital' }),
    ]);

    const response = await requestLogin(app, {
      email: 'staff@test.com',
      password: LOGIN_VALUE,
    });

    expect(response.status).toBe(200);
    expect(passwordModule.hashPassword).toHaveBeenCalledOnce();
    expect(passwordModule.hashPassword).toHaveBeenCalledWith(LOGIN_VALUE);

    const migrationQuery = mock.queries.find((query) =>
      query.method === 'run'
      && query.sql.includes('UPDATE users')
      && query.sql.includes('SET password_hash = ?'),
    );
    expect(migrationQuery?.params.slice(0, 3)).toEqual([upgradedHash, 7, 4]);
    expect(migrationQuery?.params[3]).toBe(legacyHash);
  });
});
