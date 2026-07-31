import { describe, expect, test } from 'vitest';
import { sign } from 'hono/jwt';
import patientPortalRoutes from '../src/routes/tenant/patientPortal'; // Or another appropriate router
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

const JWT_SECRET = 'test-secret-key-for-testing-only';

async function makePatientToken(patientId: number): Promise<string> {
  return sign({ userId: String(patientId), patientId: String(patientId), scope: 'global', role: 'patient' }, JWT_SECRET);
}

function makeAuthHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe('Patient Food Diary API — global patient-owned PHR data', () => {
  test('GET /patient-portal/food-diary returns 404/empty initially', async () => {
    // Food diary is patient-owned PHR/wellness data, so no tenant header is required.
    const mockDB = createMockDB({ universalFallback: true });

    const { app } = createTestApp({
      route: patientPortalRoutes, // Assuming we put it in patient portal
      routePath: '/patient-portal',
      mockDB,
    });

    const token = await makePatientToken(1);
    
    const res = await jsonRequest(app, '/patient-portal/food-diary?date=2026-04-19', {
      method: 'GET',
      headers: makeAuthHeaders(token),
    });

    // We expect this to fail with 404 until implemented, but once implemented it should be 200
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body).toHaveProperty('logs');
    expect(body).toHaveProperty('summary');
  });

  test('POST /patient-portal/food-diary logs a food item', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: patientPortalRoutes,
      routePath: '/patient-portal',
      mockDB,
    });

    const token = await makePatientToken(1);
    const payload = {
      meal_type: 'lunch',
      food_name: 'Rice and Chicken',
      calories: 450,
      logged_at: '2026-04-19T13:00:00Z',
    };

    const res = await jsonRequest(app, '/patient-portal/food-diary', {
      method: 'POST',
      body: payload,
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
  });
});
