import { describe, it, expect } from 'vitest';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';
import { createMockDB } from './integration/helpers/mock-db';
import doseTemplateRoutes from '../src/routes/tenant/dose-templates';

// ─── Dose Templates API ─────────────────────────────────────────────────────
// Feature: Doctor-specific dose templates for quick prescription writing
// Endpoints: GET/POST/PUT/DELETE /api/dose-templates
//
// TDD RED: These tests validate the route handler logic.

describe('Dose Templates API', () => {

  // ─── GET /api/dose-templates ─────────────────────────────────────────────
  it('should return 400 when doctorId is missing', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: doseTemplateRoutes,
      routePath: '/api/dose-templates',
      role: 'doctor',
      mockDB,
    });

    const res = await jsonRequest(app, '/api/dose-templates');
    expect(res.status).toBe(400);
  });

  it('should return dose templates for a doctor', async () => {
    const mockDB = createMockDB({
      universalFallback: true,
      tables: {
        prescription_dose_templates: [
          { id: 1, tenant_id: 'tenant-1', doctor_id: 1, name: 'Fever Regimen', frequency: '1+1+1', duration: '5 Days', instructions: 'After Meal', is_default: 1, sort_order: 0 },
          { id: 2, tenant_id: 'tenant-1', doctor_id: 1, name: 'Mild Pain', frequency: '1+0+1', duration: '3 Days', instructions: 'After Meal', is_default: 0, sort_order: 1 },
        ],
      },
    });
    const { app } = createTestApp({
      route: doseTemplateRoutes,
      routePath: '/api/dose-templates',
      role: 'doctor',
      mockDB,
    });

    const res = await jsonRequest(app, '/api/dose-templates?doctorId=1');
    expect(res.status).toBe(200);

    const body = await res.json() as { templates: unknown[] };
    expect(body.templates).toBeDefined();
    expect(Array.isArray(body.templates)).toBe(true);
  });

  // ─── POST /api/dose-templates ────────────────────────────────────────────
  it('should create a dose template', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: doseTemplateRoutes,
      routePath: '/api/dose-templates',
      role: 'doctor',
      mockDB,
    });

    const res = await jsonRequest(app, '/api/dose-templates', {
      method: 'POST',
      body: {
        doctorId: 1,
        name: 'Common Cold',
        frequency: '1+0+1',
        duration: '7 Days',
        instructions: 'After Meal',
      },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { id: number; message: string };
    expect(body.id).toBeDefined();
    expect(body.message).toBe('Dose template created');
  });

  it('should reject create without name', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: doseTemplateRoutes,
      routePath: '/api/dose-templates',
      role: 'doctor',
      mockDB,
    });

    const res = await jsonRequest(app, '/api/dose-templates', {
      method: 'POST',
      body: {
        doctorId: 1,
        frequency: '1+1+1',
      },
    });

    expect(res.status).toBe(400);
  });

  // ─── DELETE /api/dose-templates/:id ──────────────────────────────────────
  it('should delete a dose template', async () => {
    const mockDB = createMockDB({
      universalFallback: true,
      tables: {
        prescription_dose_templates: [
          { id: 1, tenant_id: 'tenant-1', doctor_id: 1, name: 'Test', is_active: 1 },
        ],
      },
    });
    const { app } = createTestApp({
      route: doseTemplateRoutes,
      routePath: '/api/dose-templates',
      role: 'doctor',
      mockDB,
    });

    const res = await jsonRequest(app, '/api/dose-templates/1', {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { message: string };
    expect(body.message).toBe('Dose template deleted');
  });
});
