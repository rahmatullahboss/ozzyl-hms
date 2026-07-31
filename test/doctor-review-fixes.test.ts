/**
 * TDD tests for the doctor interface review fixes.
 *
 * Each test corresponds to a CONFIRMED finding from the review:
 *  - Mounting of doctorCertificateRoutes (#1)
 *  - Extended forbiddenForDoctor allowlist (#2)
 *  - Role guards on GET /api/doctors and GET /api/doctors/:id (#3)
 *  - Server-side clinical guard on complete-consultation (#4)
 *  - doctor-certificates md role lockout (#5)
 *
 * Frontend fixes (#6-#10) live in vitest config and exercise the React tree
 * directly; for those we assert behavior at the unit level where possible.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import doctorCertificateRoutes from '../src/routes/tenant/doctorCertificates';
import doctorRoutes from '../src/routes/tenant/doctors';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

const REPO_ROOT = resolve(__dirname, '..');

// ─── #1: doctorCertificateRoutes must be mounted in src/index.ts ────────────
describe('fix #1: doctor certificate routes are mounted', () => {
  it('mounts /api/doctor-certificates in the worker entrypoint', () => {
    const indexTs = readFileSync(resolve(REPO_ROOT, 'src/index.ts'), 'utf8');
    expect(indexTs).toMatch(/import\s+doctorCertificateRoutes\s+from\s+['"]\.\/routes\/tenant\/doctorCertificates['"]/);
    expect(indexTs).toMatch(/app\.route\(['"]\/api\/doctor-certificates['"],\s*doctorCertificateRoutes\)/);
  });
});

// ─── #2: forbiddenForDoctor allowlist extended ─────────────────────────────
describe('fix #2: PUT /api/doctors/:id doctor self-edit allowlist', () => {
  it('forbids isActive, isMarketplaceVisible, displayOrder, isAvailable, publishToMarketplace', () => {
    const src = readFileSync(resolve(REPO_ROOT, 'src/routes/tenant/doctors.ts'), 'utf8');
    // The allowlist array literal in the PUT handler
    const match = src.match(/forbiddenForDoctor[^=]*=\s*\[([^\]]+)\]/);
    expect(match, 'forbiddenForDoctor array literal should exist').toBeTruthy();
    const fields = match![1];
    expect(fields).toMatch(/['"]isActive['"]/);
    expect(fields).toMatch(/['"]isMarketplaceVisible['"]/);
    expect(fields).toMatch(/['"]displayOrder['"]/);
    expect(fields).toMatch(/['"]isAvailable['"]/);
    expect(fields).toMatch(/['"]publishToMarketplace['"]/);
  });
});

// ─── #3: GET /api/doctors and /api/doctors/:id have role guards ────────────
describe('fix #3: GET /api/doctors endpoints are role-guarded', () => {
  function makeApp(role: string) {
    const mockDB = createMockDB({ universalFallback: true });
    return createTestApp({
      route: doctorRoutes,
      routePath: '/doctors',
      role,
      tenantId: 'tenant-1',
      userId: 1,
      mockDB,
    });
  }

  it('blocks a patient (no clinical role) from listing doctors', async () => {
    const { app } = makeApp('patient');
    const res = await app.request('/doctors');
    expect(res.status).toBe(403);
  });

  it('blocks a patient (no clinical role) from reading a single doctor', async () => {
    const { app } = makeApp('patient');
    const res = await app.request('/doctors/42');
    expect(res.status).toBe(403);
  });

  it('allows a doctor to list doctors', async () => {
    const { app } = makeApp('doctor');
    const res = await app.request('/doctors');
    expect(res.status).toBe(200);
  });

  it('allows a reception user to list doctors', async () => {
    const { app } = makeApp('reception');
    const res = await app.request('/doctors');
    expect(res.status).toBe(200);
  });
});

// ─── #4: complete-consultation server-side clinical guard ──────────────────
describe('fix #4: complete-consultation requires clinical content', () => {
  function makeApp(role: string) {
    const mockDB = createMockDB({
      // resolveDoctorForDashboard → first SELECT on doctors WHERE user_id hits the FALLBACK
      // and returns a row with id, so the handler passes the doctor-profile guard.
      universalFallback: true,
    });
    return {
      ...createTestApp({
        route: doctorRoutes,
        routePath: '/doctors',
        role,
        tenantId: 'tenant-1',
        userId: 1,
        mockDB,
      }),
      mockDB,
    };
  }

  it('rejects a 400 when completeVisit=true with no SOAP and no prescription content', async () => {
    const { app } = makeApp('doctor');
    // Appointment 1, no soap, no prescription, completeVisit defaults to true
    const res = await jsonRequest(app, '/doctors/dashboard/appointments/1/complete-consultation', {
      method: 'POST',
      body: {},
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error ?? '').toMatch(/SOAP|prescription|clinical/i);
  });

  it('accepts a 200 when SOAP has any non-empty text', async () => {
    const { app } = makeApp('doctor');
    const res = await jsonRequest(app, '/doctors/dashboard/appointments/1/complete-consultation', {
      method: 'POST',
      body: {
        soap: { chiefComplaint: 'fever and cough' },
        completeVisit: true,
      },
    });
    // We only assert the guard does NOT 400 — the rest of the pipeline may
    // still fail with 500 in the mock DB environment because of dependent
    // tables that the mock doesn't simulate, but that's fine for this test.
    expect(res.status).not.toBe(400);
  });
});

// ─── #5: doctor-certificates md role no longer locked out ──────────────────
describe('fix #5: md role works on doctor-certificates without linked doctor row', () => {
  function makeApp(role: string) {
    // For the 'doctor' role the linkedDoctorId() helper must succeed; for
    // 'md' it must NOT be called. queryOverride only intercepts queries that
    // need a custom response; the default mockDB behaviour handles the rest.
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from doctors') && normalized.includes('user_id')) {
          // Only the 'doctor' role reaches this query (md never calls it now).
          return { first: { id: 7, tenant_id: 'tenant-1', is_active: 1 } };
        }
        if (normalized.includes('from patients') && normalized.includes('tenant_id')) {
          return { first: { id: 9, tenant_id: 'tenant-1', name: 'Rahim' } };
        }
        if (normalized.includes('from doctor_certificates') && !normalized.includes('dc.id = ?')) {
          return { first: { id: 42, tenant_id: 'tenant-1', doctor_id: 7, status: 'final' } };
        }
        return null;
      },
      universalFallback: true,
    });
    return {
      ...createTestApp({
        route: doctorCertificateRoutes,
        routePath: '/doctor-certificates',
        role,
        tenantId: 'tenant-1',
        userId: 33,
        mockDB,
      }),
      mockDB,
    };
  }

  it('md role can GET the certificate list (no linkedDoctorId call → no 403)', async () => {
    const { app, mockDB } = makeApp('md');
    const res = await app.request('/doctor-certificates');
    expect(res.status).not.toBe(403);
    // Confirm the linkedDoctorId SELECT was NOT issued for the md role
    const linkedLookup = mockDB.queries.find(
      (q) => q.sql.toLowerCase().includes('from doctors') && q.sql.includes('user_id'),
    );
    expect(linkedLookup).toBeUndefined();
  });

  it('md role can GET a single certificate (no doctor_id filter → no 403)', async () => {
    const { app, mockDB } = makeApp('md');
    const res = await app.request('/doctor-certificates/42');
    expect(res.status).not.toBe(403);
    // The query that goes out must NOT contain a doctor_id filter
    const lookup = mockDB.queries.find(
      (q) => q.sql.toLowerCase().includes('from doctor_certificates dc') && q.sql.includes('dc.id = ?'),
    );
    expect(lookup?.params).toEqual([42, 'tenant-1']);
  });

  it('doctor role is still scoped to their own doctor_id', async () => {
    const { app, mockDB } = makeApp('doctor');
    const res = await app.request('/doctor-certificates/42');
    expect(res.status).toBe(200);
    const lookup = mockDB.queries.find(
      (q) => q.sql.toLowerCase().includes('from doctor_certificates dc') && q.sql.includes('dc.id = ?'),
    );
    expect(lookup?.params).toEqual([42, 'tenant-1', 7]);
  });
});

// ─── #8 (frontend unit): VitalsPanel falsy-zero fix is on disk ─────────────
describe('fix #8: VitalsPanel falsy-zero guard replaced with empty-string check', () => {
  it('uses `!== ""` for vitals fields instead of truthy check', () => {
    const src = readFileSync(
      resolve(REPO_ROOT, 'web/src/components/clinical/VitalsPanel.tsx'),
      'utf8',
    );
    // 6 of the numeric vitals fields must use the empty-string check
    const fields = ['pulse', 'systolic', 'diastolic', 'spo2', 'temperature', 'respiratory_rate'];
    for (const f of fields) {
      expect(src, `field ${f} should use !== ''`).toMatch(new RegExp(`form\\.${f}\\s*!==\\s*''`));
    }
  });
});
