/**
 * Cross-Tenant Data Isolation Tests
 *
 * Verifies that:
 * 1. Tenant A cannot see Tenant B's data via API queries
 * 2. JWT tenantId must match the middleware-resolved tenantId
 * 3. requireTenantId() blocks requests with no tenant context
 * 4. Route handlers filter all queries by tenant_id
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { tenantMiddleware } from '../../../src/middleware/tenant';
import { authMiddleware, generateToken } from '../../../src/middleware/auth';
import {
  TENANT_1, TENANT_2,
  PATIENT_1, PATIENT_2, PATIENT_TENANT_2,
  ADMIN_USER, DOCTOR_1,
  BILL_1,
} from '../helpers/fixtures';
import { createMockDB, createMockKV } from '../helpers/mock-db';
import type { Env, Variables } from '../../../src/types';

// ─── Shared setup ────────────────────────────────────────────────────────────

const JWT_SECRET = 'test-secret-for-tenant-isolation';

/** Build a full app with tenant + auth middleware and minimal route handlers */
function buildIsolationApp(
  tables: Record<string, Record<string, unknown>[]>,
) {
  const { db, queries } = createMockDB({ tables });
  const { kv } = createMockKV();

  const app = new Hono<{ Bindings: Env; Variables: Variables }>();

  // Inject env
  app.use('*', async (c, next) => {
    c.env = { DB: db, KV: kv, JWT_SECRET, ENVIRONMENT: 'development' } as unknown as Env;
    await next();
  });

  // Tenant + auth middleware (same order as production index.ts)
  app.use('/api/*', tenantMiddleware);
  app.use('/api/*', authMiddleware);

  // ─── Minimal patient list route (mirrors real patients.ts) ──────────
  app.get('/api/patients', async (c) => {
    const tenantId = c.get('tenantId');
    if (!tenantId) return c.json({ error: 'Tenant context required' }, 403);

    const { results } = await c.env.DB.prepare(
      'SELECT * FROM patients WHERE tenant_id = ?'
    ).bind(tenantId).all();

    return c.json({ patients: results });
  });

  // ─── Minimal single patient route ────────────────────────────────────
  app.get('/api/patients/:id', async (c) => {
    const tenantId = c.get('tenantId');
    if (!tenantId) return c.json({ error: 'Tenant context required' }, 403);

    const id = c.req.param('id');
    const patient = await c.env.DB.prepare(
      'SELECT * FROM patients WHERE id = ? AND tenant_id = ?'
    ).bind(id, tenantId).first();

    if (!patient) return c.json({ error: 'Patient not found' }, 404);
    return c.json({ patient });
  });

  // ─── Error handler ───────────────────────────────────────────────────
  app.onError((err, c) =>
    c.json({ error: err.message }, (err as { status?: number }).status ?? 500)
  );

  return { app, queries };
}

// ─── Test data ───────────────────────────────────────────────────────────────

// Admin user from Tenant 2 (for cross-tenant attack tests)
const ADMIN_TENANT_2 = {
  id: 10,
  tenant_id: TENANT_2.id,
  name: 'Admin Greenlife',
  email: 'admin@greenlife.com',
  role: 'hospital_admin',
  is_active: 1,
};

const DOCTOR_TENANT_2 = {
  id: 15,
  tenant_id: TENANT_2.id,
  name: 'Dr. Greenlife',
  specialty: 'Surgery',
  is_active: 1,
};

const BILL_TENANT_2 = {
  id: 50,
  tenant_id: TENANT_2.id,
  invoice_no: 'INV-000050',
  patient_id: PATIENT_TENANT_2.id,
  total: 3000,
  paid: 0,
  due: 3000,
  status: 'open',
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Cross-Tenant Data Isolation', () => {
  const tables = {
    tenants: [TENANT_1, TENANT_2] as unknown as Record<string, unknown>[],
    patients: [PATIENT_1, PATIENT_2, PATIENT_TENANT_2] as unknown as Record<string, unknown>[],
    users: [ADMIN_USER, ADMIN_TENANT_2] as unknown as Record<string, unknown>[],
    doctors: [DOCTOR_1, DOCTOR_TENANT_2] as unknown as Record<string, unknown>[],
    bills: [BILL_1, BILL_TENANT_2] as unknown as Record<string, unknown>[],
  };

  // ─── 1. Tenant A sees only its own data ──────────────────────────────

  describe('Tenant A sees only its own data', () => {
    it('GET /api/patients returns only Tenant 1 patients', async () => {
      const { app } = buildIsolationApp(tables);
      const token = await generateToken(
        { userId: String(ADMIN_USER.id), role: ADMIN_USER.role, tenantId: TENANT_1.id, permissions: [] },
        JWT_SECRET,
      );

      const res = await app.request('http://localhost/api/patients', {
        headers: {
          'X-Tenant-ID': TENANT_1.id,
          Authorization: `Bearer ${token}`,
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { patients: Array<{ tenant_id: string }> };
      expect(body.patients.length).toBeGreaterThan(0);
      // Every returned patient must belong to Tenant 1
      for (const patient of body.patients) {
        expect(patient.tenant_id).toBe(TENANT_1.id);
      }
    });

    it('GET /api/patients returns only Tenant 2 patients for Tenant 2 user', async () => {
      const { app } = buildIsolationApp(tables);
      const token = await generateToken(
        { userId: String(ADMIN_TENANT_2.id), role: ADMIN_TENANT_2.role, tenantId: TENANT_2.id, permissions: [] },
        JWT_SECRET,
      );

      const res = await app.request('http://localhost/api/patients', {
        headers: {
          'X-Tenant-ID': TENANT_2.id,
          Authorization: `Bearer ${token}`,
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { patients: Array<{ tenant_id: string; id: number }> };
      expect(body.patients.length).toBeGreaterThan(0);
      for (const patient of body.patients) {
        expect(patient.tenant_id).toBe(TENANT_2.id);
      }
      // Specifically, should NOT contain Tenant 1 patients
      const t1Ids = [PATIENT_1.id, PATIENT_2.id];
      for (const patient of body.patients) {
        expect(t1Ids).not.toContain(patient.id);
      }
    });
  });

  // ─── 2. Tenant A cannot access Tenant B's individual records ──────────

  describe('Tenant A cannot access Tenant B records', () => {
    it('GET /api/patients/:id returns 404 for other tenant patient', async () => {
      const { app } = buildIsolationApp(tables);
      const token = await generateToken(
        { userId: String(ADMIN_USER.id), role: ADMIN_USER.role, tenantId: TENANT_1.id, permissions: [] },
        JWT_SECRET,
      );

      // Try to access patient belonging to Tenant 2
      const res = await app.request(`http://localhost/api/patients/${PATIENT_TENANT_2.id}`, {
        headers: {
          'X-Tenant-ID': TENANT_1.id,
          Authorization: `Bearer ${token}`,
        },
      });

      expect(res.status).toBe(404);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/not found/i);
    });
  });

  // ─── 3. JWT tenant mismatch ───────────────────────────────────────────

  describe('JWT tenant mismatch detection', () => {
    it('returns 403 when JWT tenantId differs from subdomain tenant', async () => {
      const { app } = buildIsolationApp(tables);

      // JWT says Tenant 2, but request targets Tenant 1 via X-Tenant-ID
      const token = await generateToken(
        { userId: String(ADMIN_TENANT_2.id), role: ADMIN_TENANT_2.role, tenantId: TENANT_2.id, permissions: [] },
        JWT_SECRET,
      );

      const res = await app.request('http://localhost/api/patients', {
        headers: {
          'X-Tenant-ID': TENANT_1.id,  // Middleware resolves Tenant 1
          Authorization: `Bearer ${token}`,  // JWT claims Tenant 2
        },
      });

      expect(res.status).toBe(403);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/mismatch/i);
    });

    it('returns 403 when JWT tenantId differs from subdomain-header tenant', async () => {
      const { app } = buildIsolationApp(tables);

      // JWT says Tenant 1, but subdomain header says Tenant 2
      const token = await generateToken(
        { userId: String(ADMIN_USER.id), role: ADMIN_USER.role, tenantId: TENANT_1.id, permissions: [] },
        JWT_SECRET,
      );

      const res = await app.request('http://localhost/api/patients', {
        headers: {
          'X-Tenant-Subdomain': TENANT_2.subdomain,  // Middleware resolves Tenant 2 via DB lookup
          Authorization: `Bearer ${token}`,  // JWT claims Tenant 1
        },
      });

      expect(res.status).toBe(403);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/mismatch/i);
    });
  });

  // ─── 4. No tenant context ─────────────────────────────────────────────

  describe('Missing tenant context', () => {
    it('returns 403 when no tenant identifier is provided', async () => {
      const { app } = buildIsolationApp(tables);

      // Generate JWT without tenantId
      const token = await generateToken(
        { userId: String(ADMIN_USER.id), role: ADMIN_USER.role, permissions: [] },
        JWT_SECRET,
      );

      const res = await app.request('http://localhost/api/patients', {
        headers: {
          // No X-Tenant-ID, no subdomain
          Authorization: `Bearer ${token}`,
        },
      });

      // Should be 403 because requireTenantId equivalent check in the route
      expect(res.status).toBe(403);
    });
  });

  // ─── 5. SQL queries always include tenant_id ──────────────────────────

  describe('SQL queries include tenant_id filtering', () => {
    it('patient list query binds the correct tenantId', async () => {
      const { app, queries } = buildIsolationApp(tables);
      const token = await generateToken(
        { userId: String(ADMIN_USER.id), role: ADMIN_USER.role, tenantId: TENANT_1.id, permissions: [] },
        JWT_SECRET,
      );

      await app.request('http://localhost/api/patients', {
        headers: {
          'X-Tenant-ID': TENANT_1.id,
          Authorization: `Bearer ${token}`,
        },
      });

      // Find the patient list query
      const patientQuery = queries.find(
        (q) => q.sql.includes('patients') && q.sql.includes('tenant_id'),
      );
      expect(patientQuery).toBeDefined();
      expect(patientQuery!.params).toContain(TENANT_1.id);
    });

    it('single patient query binds both id and tenantId', async () => {
      const { app, queries } = buildIsolationApp(tables);
      const token = await generateToken(
        { userId: String(ADMIN_USER.id), role: ADMIN_USER.role, tenantId: TENANT_1.id, permissions: [] },
        JWT_SECRET,
      );

      await app.request(`http://localhost/api/patients/${PATIENT_1.id}`, {
        headers: {
          'X-Tenant-ID': TENANT_1.id,
          Authorization: `Bearer ${token}`,
        },
      });

      const patientQuery = queries.find(
        (q) => q.sql.includes('patients') && q.sql.includes('tenant_id') && q.method === 'first',
      );
      expect(patientQuery).toBeDefined();
      expect(patientQuery!.params).toContain(String(PATIENT_1.id));
      expect(patientQuery!.params).toContain(TENANT_1.id);
    });
  });
});
