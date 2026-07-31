/**
 * Auth helpers for real-DB integration tests.
 *
 * Generates valid JWTs using the same `hono/jwt` library as the production code.
 * JWT_SECRET must match what's in .dev.vars (default: hms-dev-test-secret-32chars-minimum).
 *
 * Tenant 100 = "City Care General Hospital" (demo-hospital)
 * Users seeded:
 *   userId: 101, role: hospital_admin
 *   userId: 103, role: reception
 *   userId: 102, role: laboratory
 *   userId: 104, role: pharmacist
 *   userId: 105, role: md
 *   userId: 107, role: accountant
 */

// JWT secret must match .dev.vars / wrangler dev
export const TEST_JWT_SECRET = process.env['TEST_JWT_SECRET'] ?? 'hms-dev-test-secret-32chars-minimum';

// Demo tenant (from seed_demo.sql)
export const DEMO_TENANT_ID = '100';

// Base URL — wrangler dev default port
export const BASE_URL = process.env['TEST_BASE_URL'] ?? 'http://localhost:8787';

/**
 * Generate a JWT token using Web Crypto API (edge-compatible, same as hono/jwt).
 * Signs with HS256.
 */
export async function generateToken(payload: {
  userId: string;
  role: string;
  tenantId?: string;
  permissions: string[];
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + 8 * 3600, // 8 hours
  };

  const encoder = new TextEncoder();
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const body = btoa(JSON.stringify(fullPayload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const signingInput = `${header}.${body}`;

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(TEST_JWT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(signingInput));
  const sig = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  return `${signingInput}.${sig}`;
}

/** Admin headers — full access */
export async function adminHeaders(): Promise<Record<string, string>> {
  const token = await generateToken({
    userId: '101',
    role: 'hospital_admin',
    tenantId: DEMO_TENANT_ID,
    permissions: ['*'],
  });
  return {
    'Authorization': `Bearer ${token}`,
    'X-Tenant-ID': DEMO_TENANT_ID,
    'Content-Type': 'application/json',
  };
}

/** Reception headers */
export async function receptionHeaders(): Promise<Record<string, string>> {
  const token = await generateToken({
    userId: '103',
    role: 'reception',
    tenantId: DEMO_TENANT_ID,
    permissions: ['patients:read', 'patients:write', 'billing:read', 'billing:write'],
  });
  return {
    'Authorization': `Bearer ${token}`,
    'X-Tenant-ID': DEMO_TENANT_ID,
    'Content-Type': 'application/json',
  };
}

/** Lab headers */
export async function labHeaders(): Promise<Record<string, string>> {
  const token = await generateToken({
    userId: '102',
    role: 'laboratory',
    tenantId: DEMO_TENANT_ID,
    permissions: ['lab:read', 'lab:write'],
  });
  return {
    'Authorization': `Bearer ${token}`,
    'X-Tenant-ID': DEMO_TENANT_ID,
    'Content-Type': 'application/json',
  };
}

/** Pharmacist headers */
export async function pharmacistHeaders(): Promise<Record<string, string>> {
  const token = await generateToken({
    userId: '104',
    role: 'pharmacist',
    tenantId: DEMO_TENANT_ID,
    permissions: ['pharmacy:read', 'pharmacy:write'],
  });
  return {
    'Authorization': `Bearer ${token}`,
    'X-Tenant-ID': DEMO_TENANT_ID,
    'Content-Type': 'application/json',
  };
}

/** Doctor (MD) headers */
export async function doctorHeaders(): Promise<Record<string, string>> {
  const token = await generateToken({
    userId: '105',
    role: 'md',
    tenantId: DEMO_TENANT_ID,
    permissions: ['prescriptions:read', 'prescriptions:write', 'visits:read'],
  });
  return {
    'Authorization': `Bearer ${token}`,
    'X-Tenant-ID': DEMO_TENANT_ID,
    'Content-Type': 'application/json',
  };
}

/** Accountant headers */
export async function accountantHeaders(): Promise<Record<string, string>> {
  const token = await generateToken({
    userId: '107',
    role: 'accountant',
    tenantId: DEMO_TENANT_ID,
    permissions: ['accounting:read', 'accounting:write'],
  });
  return {
    'Authorization': `Bearer ${token}`,
    'X-Tenant-ID': DEMO_TENANT_ID,
    'Content-Type': 'application/json',
  };
}

/** DIFFERENT tenant headers — for tenant isolation tests */
export async function wrongTenantHeaders(): Promise<Record<string, string>> {
  const token = await generateToken({
    userId: '999',
    role: 'hospital_admin',
    tenantId: '999', // Non-existent tenant
    permissions: ['*'],
  });
  return {
    'Authorization': `Bearer ${token}`,
    'X-Tenant-ID': '999',
    'Content-Type': 'application/json',
  };
}

/** No-auth headers — should always return 401 */
export function noAuthHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Tenant-ID': DEMO_TENANT_ID,
  };
}
