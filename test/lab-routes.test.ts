import { describe, it, expect } from 'vitest';
import labComponents from '../src/routes/tenant/labComponents';
import labBarcode from '../src/routes/tenant/labBarcode';
import labValidationRoutes from '../src/routes/tenant/labValidation';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

describe('Lab Components', () => {
  it('GET / returns components list', async () => {
    const { app } = createTestApp({
      route: labComponents,
      routePath: '/lab-components',
      role: 'hospital_admin',
      universalFallback: true,
    });
    const res = await app.request('/lab-components');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body).toHaveProperty('data');
  });

  it('GET / with test_id filter', async () => {
    const { app } = createTestApp({
      route: labComponents,
      routePath: '/lab-components',
      role: 'hospital_admin',
      universalFallback: true,
    });
    const res = await app.request('/lab-components?test_id=1');
    expect(res.status).toBe(200);
  });

  it('POST / creates component', async () => {
    const { app } = createTestApp({
      route: labComponents,
      routePath: '/lab-components',
      role: 'hospital_admin',
      universalFallback: true,
    });
    const res = await jsonRequest(app, '/lab-components', {
      method: 'POST',
      body: {
        lab_test_id: 1,
        component_name: 'Hemoglobin',
        unit: 'g/dL',
        value_type: 'numeric',
      },
    });
    expect(res.status).toBe(201);
  });

  it('POST / with missing required fields → 400', async () => {
    const { app } = createTestApp({
      route: labComponents,
      routePath: '/lab-components',
      role: 'hospital_admin',
      universalFallback: true,
    });
    const res = await jsonRequest(app, '/lab-components', {
      method: 'POST',
      body: { lab_test_id: 1 },
    });
    expect(res.status).toBe(400);
  });

  it('PUT /:id updates component', async () => {
    const { app } = createTestApp({
      route: labComponents,
      routePath: '/lab-components',
      role: 'hospital_admin',
      universalFallback: true,
    });
    const res = await jsonRequest(app, '/lab-components/1', {
      method: 'PUT',
      body: { component_name: 'Updated Hemoglobin' },
    });
    expect(res.status).toBe(200);
  });

  it('DELETE /:id soft deletes', async () => {
    const { app } = createTestApp({
      route: labComponents,
      routePath: '/lab-components',
      role: 'hospital_admin',
      universalFallback: true,
    });
    const res = await app.request('/lab-components/1', { method: 'DELETE' });
    expect(res.status).toBe(200);
  });

  it('DELETE /:id with invalid id → 400', async () => {
    const { app } = createTestApp({
      route: labComponents,
      routePath: '/lab-components',
      role: 'hospital_admin',
      universalFallback: true,
    });
    const res = await app.request('/lab-components/abc', { method: 'DELETE' });
    expect(res.status).toBe(400);
  });
});

describe('Lab Barcode', () => {
  it('GET /generate/:id returns response', async () => {
    const { app } = createTestApp({
      route: labBarcode,
      routePath: '/lab-barcode',
      role: 'hospital_admin',
      universalFallback: true,
    });
    const res = await app.request('/lab-barcode/generate/1');
    expect([200, 404]).toContain(res.status);
  });
});

describe('Lab Validation', () => {
  it('GET /rules returns rules', async () => {
    const { app } = createTestApp({
      route: labValidationRoutes,
      routePath: '/lab-validation',
      role: 'hospital_admin',
      universalFallback: true,
    });
    const res = await app.request('/lab-validation/rules');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body).toHaveProperty('data');
  });

  it('GET /rules with lab_test_id filter', async () => {
    const { app } = createTestApp({
      route: labValidationRoutes,
      routePath: '/lab-validation',
      role: 'hospital_admin',
      universalFallback: true,
    });
    const res = await app.request('/lab-validation/rules?lab_test_id=1');
    expect(res.status).toBe(200);
  });

  it('POST /rules creates rule', async () => {
    const { app } = createTestApp({
      route: labValidationRoutes,
      routePath: '/lab-validation',
      role: 'hospital_admin',
      universalFallback: true,
    });
    const res = await jsonRequest(app, '/lab-validation/rules', {
      method: 'POST',
      body: {
        lab_test_id: 1,
        component_id: 1,
        rule_type: 'range',
        rule_config: { min: 10, max: 20 },
        error_message: 'Value out of range',
        is_blocking: true,
      },
    });
    expect(res.status).toBe(201);
  });

  it('POST /validate validates result', async () => {
    const { app } = createTestApp({
      route: labValidationRoutes,
      routePath: '/lab-validation',
      role: 'hospital_admin',
      universalFallback: true,
    });
    const res = await jsonRequest(app, '/lab-validation/validate', {
      method: 'POST',
      body: {
        lab_test_id: 1,
        component_id: 1,
        result_value: '15',
        result_numeric: 15,
      },
    });
    expect(res.status).toBe(200);
  });
});

describe('Lab Routes - Role Guards', () => {
  it('rejects unauthorized role for lab components', async () => {
    const { app } = createTestApp({
      route: labComponents,
      routePath: '/lab-components',
      role: 'reception',
      universalFallback: true,
    });
    const res = await app.request('/lab-components');
    expect(res.status).toBe(403);
  });

  it('rejects unauthorized role for lab validation', async () => {
    const { app } = createTestApp({
      route: labValidationRoutes,
      routePath: '/lab-validation',
      role: 'reception',
      universalFallback: true,
    });
    const res = await app.request('/lab-validation/rules');
    expect(res.status).toBe(403);
  });
});
