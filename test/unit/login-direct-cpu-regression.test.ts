import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../../src/types';

const mocks = vi.hoisted(() => ({
  users: [] as Array<Record<string, unknown>>,
  verifyPassword: vi.fn<(password: string, storedHash: string | null | undefined) => Promise<boolean>>(),
  resolveUserPermissions: vi.fn(async () => ['dashboard.view']),
  generateToken: vi.fn(async () => 'test-token'),
  createAuditLog: vi.fn(async () => undefined),
  setStaffSessionCookie: vi.fn(),
}));

vi.mock('../../src/db', () => ({
  getDb: () => ({
    $client: {
      prepare: () => ({
        bind: () => ({
          all: async () => ({ results: mocks.users }),
        }),
      }),
    },
  }),
}));

vi.mock('../../src/lib/password', () => ({
  hashPassword: async () => 'unused-hash',
  isLegacyBcryptHash: () => false,
  verifyPassword: mocks.verifyPassword,
}));

vi.mock('../../src/middleware/auth', () => ({
  generateToken: mocks.generateToken,
}));

vi.mock('../../src/middleware/rbac', () => ({
  resolveUserPermissions: mocks.resolveUserPermissions,
}));

vi.mock('../../src/middleware/rate-limit', () => ({
  loginRateLimit: async (_c: unknown, next: () => Promise<void>) => next(),
  getAccountLockoutState: async () => ({
    attempts: 0,
    locked: false,
    retryAfterSeconds: 0,
  }),
  recordFailedLoginAttempt: async () => ({
    attempts: 1,
    locked: false,
    retryAfterSeconds: 0,
  }),
  clearAccountLockout: async () => undefined,
}));

vi.mock('../../src/lib/accounting-helpers', () => ({
  createAuditLog: mocks.createAuditLog,
}));

vi.mock('../../src/lib/staff-session-cookie', () => ({
  setStaffSessionCookie: mocks.setStaffSessionCookie,
}));

import loginDirectRoutes, {
  findPasswordMatchingUsers,
} from '../../src/routes/login-direct';

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    email: 'staff@example.com',
    password_hash: 'shared-hash',
    name: 'Staff User',
    role: 'receptionist',
    tenant_id: 100,
    hospital_name: 'Hospital A',
    slug: 'hospital-a',
    tenant_status: 'active',
    ...overrides,
  };
}

function buildApp() {
  const app = new Hono<{ Bindings: Env }>();

  app.use('*', async (c, next) => {
    c.env = {
      DB: {} as D1Database,
      KV: {} as KVNamespace,
      JWT_SECRET: 'test-secret',
    } as Env;
    await next();
  });

  app.route('/api/auth/login-direct', loginDirectRoutes);
  return app;
}

async function postLogin(app: ReturnType<typeof buildApp>) {
  return app.request('/api/auth/login-direct', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'staff@example.com',
      password: 'correct-password',
    }),
  });
}

describe('direct login CPU regression', () => {
  beforeEach(() => {
    mocks.users = [];
    mocks.verifyPassword.mockReset();
    mocks.resolveUserPermissions.mockClear();
    mocks.generateToken.mockClear();
    mocks.createAuditLog.mockClear();
    mocks.setStaffSessionCookie.mockClear();
  });

  it('verifies a shared hash once for multiple hospital rows', async () => {
    const users = [
      makeUser({ id: 1, tenant_id: 100 }),
      makeUser({ id: 2, tenant_id: 200, hospital_name: 'Hospital B', slug: 'hospital-b' }),
    ];
    const verifier = vi.fn(async () => true);

    const matchingUsers = await findPasswordMatchingUsers(
      users,
      'correct-password',
      verifier,
    );

    expect(matchingUsers).toEqual(users);
    expect(verifier).toHaveBeenCalledTimes(1);
    expect(verifier).toHaveBeenCalledWith('correct-password', 'shared-hash');
  });

  it('does not verify the single matched user a second time', async () => {
    mocks.users = [
      makeUser({ id: 1, tenant_id: 100, password_hash: 'hash-a' }),
      makeUser({
        id: 2,
        tenant_id: 200,
        hospital_name: 'Hospital B',
        slug: 'hospital-b',
        password_hash: 'hash-b',
      }),
    ];
    mocks.verifyPassword.mockImplementation(async (_password, hash) => hash === 'hash-a');

    const response = await postLogin(buildApp());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      token: 'test-token',
      slug: 'hospital-a',
      user: { id: 1 },
    });
    expect(mocks.verifyPassword).toHaveBeenCalledTimes(2);
    expect(mocks.verifyPassword).toHaveBeenNthCalledWith(1, 'correct-password', 'hash-a');
    expect(mocks.verifyPassword).toHaveBeenNthCalledWith(2, 'correct-password', 'hash-b');
  });

  it('returns the hospital picker while verifying duplicate hashes only once', async () => {
    mocks.users = [
      makeUser({ id: 1, tenant_id: 100 }),
      makeUser({ id: 2, tenant_id: 200, hospital_name: 'Hospital B', slug: 'hospital-b' }),
    ];
    mocks.verifyPassword.mockResolvedValue(true);

    const response = await postLogin(buildApp());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      requireHospitalSelection: true,
      hospitals: [
        { tenantId: 100, slug: 'hospital-a' },
        { tenantId: 200, slug: 'hospital-b' },
      ],
    });
    expect(mocks.verifyPassword).toHaveBeenCalledTimes(1);
  });
});
