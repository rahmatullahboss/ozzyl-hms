import { describe, it, expect } from 'vitest';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';
import { createMockDB } from './integration/helpers/mock-db';
import adviceTemplateRoutes from '../src/routes/tenant/advice-templates';

// ─── Advice Templates API ───────────────────────────────────────────────────
// Feature: Predefined advice templates for quick prescription writing
// Endpoints: GET/POST/DELETE /api/advice-templates
//
// TDD RED: These tests validate the route handler logic.

describe('Advice Templates API', () => {

  // ─── GET /api/advice-templates ──────────────────────────────────────────
  it('should return advice templates for a tenant', async () => {
    const mockDB = createMockDB({
      universalFallback: true,
      tables: {
        advice_templates: [
          { id: 1, tenant_id: 'tenant-1', doctor_id: null, content: 'বেশি পানি পান করুন', category: 'general', language: 'bn', sort_order: 0, is_active: 1 },
          { id: 2, tenant_id: 'tenant-1', doctor_id: null, content: '৭ দিন পর follow-up করুন', category: 'follow-up', language: 'bn', sort_order: 1, is_active: 1 },
        ],
      },
    });
    const { app } = createTestApp({
      route: adviceTemplateRoutes,
      routePath: '/api/advice-templates',
      role: 'doctor',
      mockDB,
    });

    const res = await jsonRequest(app, '/api/advice-templates');
    expect(res.status).toBe(200);

    const body = await res.json() as { templates: unknown[] };
    expect(body.templates).toBeDefined();
    expect(Array.isArray(body.templates)).toBe(true);
  });

  it('should filter by category', async () => {
    const mockDB = createMockDB({
      universalFallback: true,
      tables: {
        advice_templates: [
          { id: 1, tenant_id: 'tenant-1', content: 'Test', category: 'general', is_active: 1 },
        ],
      },
    });
    const { app } = createTestApp({
      route: adviceTemplateRoutes,
      routePath: '/api/advice-templates',
      role: 'doctor',
      mockDB,
    });

    const res = await jsonRequest(app, '/api/advice-templates?category=general');
    expect(res.status).toBe(200);
  });

  // ─── POST /api/advice-templates ─────────────────────────────────────────
  it('should create an advice template', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: adviceTemplateRoutes,
      routePath: '/api/advice-templates',
      role: 'hospital_admin',
      mockDB,
    });

    const res = await jsonRequest(app, '/api/advice-templates', {
      method: 'POST',
      body: {
        content: 'ঠান্ডা খাবার এড়িয়ে চলুন',
        category: 'diet',
        language: 'bn',
      },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { id: number; message: string };
    expect(body.id).toBeDefined();
    expect(body.message).toBe('Advice template created');
  });

  it('should reject create without content', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: adviceTemplateRoutes,
      routePath: '/api/advice-templates',
      role: 'hospital_admin',
      mockDB,
    });

    const res = await jsonRequest(app, '/api/advice-templates', {
      method: 'POST',
      body: { category: 'general' },
    });

    expect(res.status).toBe(400);
  });

  // ─── DELETE /api/advice-templates/:id ───────────────────────────────────
  it('should delete an advice template', async () => {
    const mockDB = createMockDB({
      universalFallback: true,
      tables: {
        advice_templates: [
          { id: 1, tenant_id: 'tenant-1', content: 'Test', is_active: 1 },
        ],
      },
    });
    const { app } = createTestApp({
      route: adviceTemplateRoutes,
      routePath: '/api/advice-templates',
      role: 'hospital_admin',
      mockDB,
    });

    const res = await jsonRequest(app, '/api/advice-templates/1', {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { message: string };
    expect(body.message).toBe('Advice template deleted');
  });
});
