/**
 * Test app factory for integration tests.
 *
 * Creates an isolated Hono app with mocked Cloudflare bindings
 * so route handlers can be tested without a real Worker or database.
 *
 * Based on the existing pattern in test/payments.test.ts (lines 272-301).
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types';
import { createMockDB, createMockKV, type MockDB, type MockKV, type MockDBOptions } from './mock-db';

export interface TestAppOptions {
  /** The Hono router to mount (e.g. `import admissionsRoutes from 'src/routes/tenant/admissions'`) */
  route: Hono<{ Bindings: Env; Variables: Variables }>;
  /** Path prefix to mount the route at (e.g. '/admissions') */
  routePath: string;
  /** Role to inject into context (e.g. 'hospital_admin') */
  role?: string;
  /** Tenant ID to inject (defaults to 'tenant-1') */
  tenantId?: string;
  /** User ID to inject (defaults to 1) */
  userId?: number;
  /** Permission keys to inject into context. */
  permissions?: string[];
  /** Pre-built MockDB. If not provided, a fresh empty mock is created. */
  mockDB?: MockDB;
  /** Pre-built MockKV. If not provided, a fresh empty mock is created. */
  mockKV?: MockKV;
  /** Table data shorthand — creates a new MockDB with these tables when mockDB is not specified */
  tables?: MockDBOptions['tables'];
  /** Optional SQL-level override hook for the generated MockDB */
  queryOverride?: MockDBOptions['queryOverride'];
  /** When true, .first() never returns null — forces handlers past 'not found' guards for JOIN queries */
  universalFallback?: boolean;
  /** JWT secret for auth tests (defaults to 'test-secret') */
  jwtSecret?: string;
  /** Extra env variables to merge into c.env */
  extraEnv?: Partial<Env>;
}

export interface TestApp {
  /** The configured Hono app — call `.request(path, init)` on it */
  app: Hono<{ Bindings: Env; Variables: Variables }>;
  /** The mock DB used (for asserting queries) */
  mockDB: MockDB;
  /** The mock KV used (for asserting stored values) */
  mockKV: MockKV;
}

/**
 * Create an isolated test app with mocked Cloudflare bindings.
 *
 * @example
 * const { app, mockDB } = createTestApp({
 *   route: admissionsRoute,
 *   routePath: '/admissions',
 *   role: 'hospital_admin',
 *   tenantId: 'hospital-abc',
 *   tables: {
 *     admissions: [{ id: 1, tenant_id: 'hospital-abc', status: 'admitted' }],
 *   },
 * });
 *
 * const res = await app.request('/admissions', { method: 'GET' });
 * expect(res.status).toBe(200);
 */
export function createTestApp(options: TestAppOptions): TestApp {
  const {
    route,
    routePath,
    role,
    tenantId = 'tenant-1',
    userId = 1,
    permissions = [],
    jwtSecret = 'test-secret-key-for-testing-only',
    extraEnv = {},
  } = options;

  // Build or reuse mock DB
  const mockDB = options.mockDB ?? createMockDB({
    tables: options.tables ?? {},
    queryOverride: options.queryOverride,
    universalFallback: options.universalFallback,
  });
  const mockKV = options.mockKV ?? createMockKV();

  const app = new Hono<{ Bindings: Env; Variables: Variables }>();

  // ─── Context injection middleware ─────────────────────────────────────────
  app.use('*', async (c, next) => {
    // Inject tenant context
    c.set('tenantId', tenantId as string);
    // Inject auth context
    c.set('userId', String(userId));
    c.set('permissions', permissions);
    if (role) {
      c.set('role', role as Variables['role']);
    }

    // Inject environment bindings
    c.env = {
      DB: mockDB.db,
      KV: mockKV.kv,
      JWT_SECRET: jwtSecret,
      ENVIRONMENT: 'test',
      ...extraEnv,
    } as unknown as Env;

    await next();
  });

  // Mount the route under test
  app.route(routePath, route);

  // ─── Global error handler — always return JSON ──────────────────────────
  // Without this, HTTPException returns plain text which causes SyntaxError
  // when tests try to parse the body as JSON.
  app.onError((err, c) => {
    const status = (err as { status?: number }).status ?? 500;
    const message = err.message || 'Internal Server Error';
    return c.json({ error: message }, status as Parameters<typeof c.json>[1]);
  });

  return { app, mockDB, mockKV };
}

/**
 * Make a JSON request to a test app.
 * Convenience wrapper over app.request() that sets Content-Type automatically.
 */
export async function jsonRequest(
  app: Hono<{ Bindings: Env; Variables: Variables }>,
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<Response> {
  const { method = 'GET', body, headers = {} } = options;
  const init: RequestInit = { method, headers: { ...headers } };

  if (body !== undefined) {
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  return app.request(path, init);
}

/**
 * Create a test app with NO role set (simulates unauthenticated or no-role context).
 */
export function createTestAppNoRole(
  options: Omit<TestAppOptions, 'role'>,
): TestApp {
  return createTestApp({ ...options, role: undefined });
}
