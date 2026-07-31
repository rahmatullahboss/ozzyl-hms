import { describe, expect, it } from 'vitest';
import prescriptionsRoutes from '../src/routes/tenant/prescriptions';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

describe('prescription safety override audit', () => {
  const validOverride = {
    prescription_id: 1,
    patient_id: 10,
    doctor_id: 5,
    override_type: 'allergy' as const,
    allergen: 'Penicillin',
    severity: 'severe',
    reason: 'Patient has been desensitized and tolerates Penicillin under supervision',
  };

  it('POST /override-safety with valid reason succeeds', async () => {
    const mockDB = createMockDB({ universalFallback: true });

    const { app } = createTestApp({
      route: prescriptionsRoutes,
      routePath: '/api/prescriptions',
      role: 'doctor',
      mockDB,
    });

    const res = await jsonRequest(app, '/api/prescriptions/override-safety', {
      method: 'POST',
      body: validOverride,
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { success: boolean; override_id: number };
    expect(body.success).toBe(true);
    expect(body.override_id).toBeGreaterThan(0);
  });

  it('POST /override-safety with empty reason is rejected (400)', async () => {
    const mockDB = createMockDB({ universalFallback: true });

    const { app } = createTestApp({
      route: prescriptionsRoutes,
      routePath: '/api/prescriptions',
      role: 'doctor',
      mockDB,
    });

    const res = await jsonRequest(app, '/api/prescriptions/override-safety', {
      method: 'POST',
      body: { ...validOverride, reason: '' },
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { error: unknown };
    expect(body.error).toBeDefined();
    // Zod validation error contains structured issue data mentioning the field
    const errorStr = JSON.stringify(body.error);
    expect(errorStr.toLowerCase()).toContain('reason');
  });

  it('POST /override-safety with short reason (<10 chars) is rejected (400)', async () => {
    const mockDB = createMockDB({ universalFallback: true });

    const { app } = createTestApp({
      route: prescriptionsRoutes,
      routePath: '/api/prescriptions',
      role: 'doctor',
      mockDB,
    });

    const res = await jsonRequest(app, '/api/prescriptions/override-safety', {
      method: 'POST',
      body: { ...validOverride, reason: 'Too short' },
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { error: unknown };
    expect(body.error).toBeDefined();
    const errorStr = JSON.stringify(body.error);
    expect(errorStr.toLowerCase()).toContain('reason');
  });

  it('POST /override-safety stores correct allergen, severity, and type', async () => {
    let insertCaptured = false;
    let capturedParams: unknown[] = [];

    const mockDB = createMockDB({
      queryOverride(sql, params) {
        const lower = sql.toLowerCase();
        // Drizzle quotes table names: insert into "prescription_overrides"
        if (lower.includes('prescription_overrides') && lower.trimStart().startsWith('insert')) {
          insertCaptured = true;
          capturedParams = params;
          return null; // Let default handler process it
        }
        // Return prescription with patient_id for the ownership check
        if (lower.includes('from prescriptions') && lower.includes('patient_id')) {
          return { first: { id: 7, patient_id: 20, doctor_id: 3 }, results: [{ id: 7, patient_id: 20, doctor_id: 3 }] };
        }
        if (lower.includes('from doctors') && lower.includes('user_id')) {
          return { first: { id: 3 } };
        }
        return null;
      },
      universalFallback: true,
    });

    const { app } = createTestApp({
      route: prescriptionsRoutes,
      routePath: '/api/prescriptions',
      role: 'doctor',
      mockDB,
    });

    const override = {
      prescription_id: 7,
      patient_id: 20,
      doctor_id: 3,
      override_type: 'interaction',
      allergen: 'Warfarin',
      severity: 'major',
      reason: 'INR monitoring in place, benefit outweighs risk for this patient',
    };

    const res = await jsonRequest(app, '/api/prescriptions/override-safety', {
      method: 'POST',
      body: override,
    });

    expect(res.status).toBe(201);
    expect(insertCaptured).toBe(true);
    // Drizzle binds params in column order: prescriptionId, patientId, doctorId, overrideType, allergen, severity, reason, tenantId
    expect(capturedParams).toContain(7);
    expect(capturedParams).toContain(20);
    expect(capturedParams).toContain(3); // Linked prescribing doctor, not the user row or client field.
    expect(capturedParams).toContain('interaction');
    expect(capturedParams).toContain('Warfarin');
    expect(capturedParams).toContain('major');
  });

  it('GET /:id/overrides returns all overrides for prescription', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const lower = sql.toLowerCase();
	        if (lower.includes('from prescription_overrides')) {
          return {
            results: [
              {
                id: 1,
                prescription_id: 5,
                patient_id: 10,
                doctor_id: 3,
                override_type: 'allergy',
                allergen: 'Penicillin',
                severity: 'severe',
                reason: 'Desensitization protocol completed',
                tenant_id: 'tenant-1',
                created_at: '2026-05-26 10:00:00',
              },
              {
                id: 2,
                prescription_id: 5,
                patient_id: 10,
                doctor_id: 3,
                override_type: 'interaction',
                allergen: 'Warfarin',
                severity: 'major',
                reason: 'INR monitoring in place benefit outweighs risk',
                tenant_id: 'tenant-1',
                created_at: '2026-05-26 10:05:00',
              },
            ],
          };
	        }
	        if (lower.includes('from doctors') && lower.includes('user_id')) {
	          return { first: { id: 3 } };
	        }
	        if (lower.includes('from prescriptions')) {
	          return {
	            results: [{ id: 5, tenant_id: 'tenant-1', doctor_id: 3 }],
	            first: { id: 5, tenant_id: 'tenant-1', doctor_id: 3 },
	          };
	        }
        return null;
      },
    });

    const { app } = createTestApp({
      route: prescriptionsRoutes,
      routePath: '/api/prescriptions',
      role: 'doctor',
      mockDB,
    });

    const res = await jsonRequest(app, '/api/prescriptions/5/overrides');

    expect(res.status).toBe(200);
    const body = await res.json() as { overrides: Array<{ id: number; override_type: string }> };
    expect(body.overrides).toHaveLength(2);
    expect(body.overrides[0].override_type).toBe('allergy');
    expect(body.overrides[1].override_type).toBe('interaction');
  });

  it('different override types (allergy, interaction, duplicate) all work', async () => {
    const types = ['allergy', 'interaction', 'duplicate'] as const;
    const { app } = createTestApp({
      route: prescriptionsRoutes,
      routePath: '/api/prescriptions',
      role: 'doctor',
      mockDB: createMockDB({ universalFallback: true }),
    });

    for (const overrideType of types) {
      const res = await jsonRequest(app, '/api/prescriptions/override-safety', {
        method: 'POST',
        body: {
          ...validOverride,
          override_type: overrideType,
          reason: `Valid reason for ${overrideType} override that meets minimum length`,
        },
      });

      expect(res.status).toBe(201);
      const body = await res.json() as { success: boolean; override_id: number };
      expect(body.success).toBe(true);
      expect(body.override_id).toBeGreaterThan(0);
    }
  });

  it('POST /override-safety with non-existent prescription_id returns 404', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const lower = sql.toLowerCase();
        if (lower.includes('from prescriptions') && lower.includes('select')) {
          return { results: [] };
        }
        return null;
      },
    });

    const { app } = createTestApp({
      route: prescriptionsRoutes,
      routePath: '/api/prescriptions',
      role: 'doctor',
      mockDB,
    });

    const res = await jsonRequest(app, '/api/prescriptions/override-safety', {
      method: 'POST',
      body: { ...validOverride, prescription_id: 9999 },
    });

    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Prescription not found');
  });

  it('rejects an override attempt against another doctors prescription', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const lower = sql.toLowerCase();
        if (lower.includes('from prescriptions') && lower.includes('patient_id')) {
          return { first: { id: 7, patient_id: 20, doctor_id: 9 }, results: [{ id: 7, patient_id: 20, doctor_id: 9 }] };
        }
        if (lower.includes('from doctors') && lower.includes('user_id')) {
          return { first: { id: 3 } };
        }
        return null;
      },
      universalFallback: true,
    });
    const { app } = createTestApp({
      route: prescriptionsRoutes,
      routePath: '/api/prescriptions',
      role: 'doctor',
      mockDB,
    });

    const res = await jsonRequest(app, '/api/prescriptions/override-safety', {
      method: 'POST',
      body: { ...validOverride, prescription_id: 7 },
    });

    expect(res.status).toBe(403);
  });

  it('POST /override-safety with missing allergen is rejected (400)', async () => {
    const mockDB = createMockDB({ universalFallback: true });

    const { app } = createTestApp({
      route: prescriptionsRoutes,
      routePath: '/api/prescriptions',
      role: 'doctor',
      mockDB,
    });

    const res = await jsonRequest(app, '/api/prescriptions/override-safety', {
      method: 'POST',
      body: { ...validOverride, allergen: '' },
    });

    expect(res.status).toBe(400);
  });

  it('POST /override-safety with invalid override_type is rejected (400)', async () => {
    const mockDB = createMockDB({ universalFallback: true });

    const { app } = createTestApp({
      route: prescriptionsRoutes,
      routePath: '/api/prescriptions',
      role: 'doctor',
      mockDB,
    });

    const res = await jsonRequest(app, '/api/prescriptions/override-safety', {
      method: 'POST',
      body: { ...validOverride, override_type: 'invalid_type' },
    });

    expect(res.status).toBe(400);
  });

  it('GET /:id/overrides returns empty array when no overrides exist', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const lower = sql.toLowerCase();
	        if (lower.includes('from prescription_overrides')) {
	          return { results: [] };
	        }
	        if (lower.includes('from doctors') && lower.includes('user_id')) {
	          return { first: { id: 3 } };
	        }
	        if (lower.includes('from prescriptions')) {
	          return {
	            results: [{ id: 5, tenant_id: 'tenant-1', doctor_id: 3 }],
	            first: { id: 5, tenant_id: 'tenant-1', doctor_id: 3 },
	          };
	        }
        return null;
      },
    });

    const { app } = createTestApp({
      route: prescriptionsRoutes,
      routePath: '/api/prescriptions',
      role: 'doctor',
      mockDB,
    });

    const res = await jsonRequest(app, '/api/prescriptions/5/overrides');

    expect(res.status).toBe(200);
    const body = await res.json() as { overrides: unknown[] };
    expect(body.overrides).toEqual([]);
  });
});
