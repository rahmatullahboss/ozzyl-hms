/**
 * Auth Helper — Shared authentication utilities for E2E tests.
 *
 * Reads the JWT from the global setup file (written by global-setup.ts),
 * avoiding multiple logins and rate-limiting issues.
 *
 * Usage:
 *   import { loadAuth, authHeaders, BASE_URL } from '../helpers/auth-helper';
 *
 *   test.beforeAll(async () => {
 *     loadAuth();
 *   });
 *
 *   test('example', async ({ request }) => {
 *     const res = await request.get(`${BASE_URL}/api/patients`, {
 *       headers: authHeaders(),
 *     });
 *   });
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { APIRequestContext } from '@playwright/test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const BASE_URL =
  process.env['BASE_URL'] ||
  'https://hms-saas.rahmatullahzisan.workers.dev';

// ─── Auth state ────────────────────────────────────────────────────────────────

interface AuthState {
  token: string;
  slug: string;
  user: { id: number; email: string; name: string; role: string };
  hospital: { id: number; name: string; slug: string };
}

let cachedAuth: AuthState | null = null;

// Auth state file is written by global-setup.ts into test/e2e/
const AUTH_STATE_PATH = path.join(__dirname, '..', '.auth-state.json');

// ─── Load auth from disk (written by global-setup.ts) ──────────────────────────

/**
 * Loads the auth state from the global setup file.
 * Call this in test.beforeAll() — it reads from disk, not network.
 */
export function loadAuth(): AuthState {
  if (cachedAuth) return cachedAuth;

  // Try loading from disk
  try {
    const raw = fs.readFileSync(AUTH_STATE_PATH, 'utf-8');
    cachedAuth = JSON.parse(raw) as AuthState;
    return cachedAuth;
  } catch {
    // File not found
  }

  throw new Error(
    'Auth state file not found. Make sure global-setup.ts ran first.\n' +
    'Run: E2E_EMAIL=admin@demo-hospital.com E2E_PASSWORD=Demo@1234 npx playwright test --project=auth-smoke'
  );
}

/**
 * Falls back to network login if the file-based auth is not available.
 * Use this sparingly — the global-setup approach is preferred.
 */
export async function getAuthToken(request: APIRequestContext): Promise<AuthState> {
  // First try loading from disk
  try {
    return loadAuth();
  } catch {
    // Fall back to network login
  }

  if (cachedAuth) return cachedAuth;

  const email = process.env['E2E_EMAIL'];
  const password = process.env['E2E_PASSWORD'];

  if (!email || !password) {
    throw new Error(
      'E2E_EMAIL and E2E_PASSWORD environment variables are required.\n' +
      'Run: E2E_EMAIL=admin@demo-hospital.com E2E_PASSWORD=Demo@1234 npx playwright test --project=auth-smoke'
    );
  }

  const res = await request.post(`${BASE_URL}/api/auth/login-direct`, {
    data: { email, password },
    headers: { 'Content-Type': 'application/json' },
  });

  if (res.status() !== 200) {
    const body = await res.text();
    throw new Error(`Login failed (${res.status()}): ${body}`);
  }

  const body = await res.json() as AuthState;

  if (!body.token) {
    throw new Error('Login response missing token');
  }

  cachedAuth = body;
  return cachedAuth;
}

/**
 * Returns auth headers for authenticated API requests.
 * Accepts an optional AuthState override (for backward-compat with specs that pass `auth`).
 * If omitted, uses the globally cached auth state.
 */
export function authHeaders(_authOverride?: AuthState): Record<string, string> {
  // Always use cached auth from disk — the optional param is accepted for compat but ignored.
  const auth = cachedAuth ?? (() => { loadAuth(); return cachedAuth!; })();
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${auth.token}`,
    'X-Tenant-Slug': auth.slug,
  };
}

/**
 * Returns the cached auth state (token, user, hospital).
 */
export function getAuth(): AuthState {
  if (!cachedAuth) {
    loadAuth();
  }
  return cachedAuth!;
}

/**
 * Resets cached auth state. Useful for testing token expiry flows.
 */
export function resetAuth(): void {
  cachedAuth = null;
}
