import { describe, expect, test } from 'vitest';
import { sign } from 'hono/jwt';
import wellnessRoutes from '../src/routes/wellness';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

const JWT_SECRET = 'test-secret-key-for-testing-only';

async function makePatientToken(patientId: number): Promise<string> {
  return sign({ userId: String(patientId), scope: 'global' }, JWT_SECRET);
}

function makeAuthHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe('POST /wellness/vitals — extended vitals with classification', () => {
  test('accepts BP with normal classification', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({ route: wellnessRoutes, routePath: '/wellness', mockDB });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/vitals', {
      method: 'POST',
      body: { systolic: 120, diastolic: 80 },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { success: boolean; classification: any; alert: any };
    expect(body.success).toBe(true);
    expect(body.classification.bp).toBe('normal');
    expect(body.alert).toBeNull();
  });

  test('classifies elevated BP', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({ route: wellnessRoutes, routePath: '/wellness', mockDB });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/vitals', {
      method: 'POST',
      body: { systolic: 135, diastolic: 85 },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { classification: any };
    expect(body.classification.bp).toBe('elevated');
  });

  test('classifies high BP (stage 1)', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({ route: wellnessRoutes, routePath: '/wellness', mockDB });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/vitals', {
      method: 'POST',
      body: { systolic: 145, diastolic: 95 },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { classification: any };
    expect(body.classification.bp).toBe('high_stage1');
  });

  test('triggers hypertensive crisis alert for BP > 180/120', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({ route: wellnessRoutes, routePath: '/wellness', mockDB });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/vitals', {
      method: 'POST',
      body: { systolic: 190, diastolic: 125 },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { alert: any };
    expect(body.alert).not.toBeNull();
    expect(body.alert.severity).toBe('critical');
    expect(body.alert.type).toBe('hypertensive_crisis');
    expect(body.alert.disclaimer).toBeDefined();
  });

  test('accepts blood sugar with classification', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({ route: wellnessRoutes, routePath: '/wellness', mockDB });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/vitals', {
      method: 'POST',
      body: { blood_sugar: 5.5, blood_sugar_context: 'fasting' },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { classification: any };
    expect(body.classification.blood_sugar).toBe('normal');
  });

  test('triggers high sugar alert for glucose > 300', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({ route: wellnessRoutes, routePath: '/wellness', mockDB });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/vitals', {
      method: 'POST',
      body: { blood_sugar: 22, blood_sugar_context: 'random' },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { alert: any };
    expect(body.alert).not.toBeNull();
    expect(body.alert.type).toBe('high_blood_sugar');
  });

  test('accepts weight_kg', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({ route: wellnessRoutes, routePath: '/wellness', mockDB });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/vitals', {
      method: 'POST',
      body: { weight_kg: 70.5 },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { classification: any };
    expect(body.classification.weight).toBeDefined();
  });

  test('accepts spo2 with classification', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({ route: wellnessRoutes, routePath: '/wellness', mockDB });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/vitals', {
      method: 'POST',
      body: { spo2: 98 },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { classification: any };
    expect(body.classification.spo2).toBe('normal');
  });

  test('triggers low oxygen alert for SpO2 < 92', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({ route: wellnessRoutes, routePath: '/wellness', mockDB });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/vitals', {
      method: 'POST',
      body: { spo2: 88 },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { alert: any };
    expect(body.alert).not.toBeNull();
    expect(body.alert.type).toBe('low_oxygen');
    expect(body.alert.severity).toBe('critical');
  });

  test('accepts temperature_f', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({ route: wellnessRoutes, routePath: '/wellness', mockDB });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/vitals', {
      method: 'POST',
      body: { temperature_f: 98.6 },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { classification: any };
    expect(body.classification.temperature).toBe('normal');
  });

  test('classifies fever for temp > 100.4', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({ route: wellnessRoutes, routePath: '/wellness', mockDB });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/vitals', {
      method: 'POST',
      body: { temperature_f: 102 },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { classification: any };
    expect(body.classification.temperature).toBe('fever');
  });

  test('rejects unauthenticated requests', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({ route: wellnessRoutes, routePath: '/wellness', mockDB });

    const res = await jsonRequest(app, '/wellness/vitals', {
      method: 'POST',
      body: { systolic: 120, diastolic: 80 },
    });

    expect(res.status).toBe(401);
  });

  test('rejects out-of-range SpO2', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({ route: wellnessRoutes, routePath: '/wellness', mockDB });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/vitals', {
      method: 'POST',
      body: { spo2: 150 },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(400);
  });

  test('alert always includes safety disclaimer', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({ route: wellnessRoutes, routePath: '/wellness', mockDB });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/vitals', {
      method: 'POST',
      body: { systolic: 200, diastolic: 130 },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { alert: any };
    expect(body.alert.disclaimer).toContain('not a diagnosis');
  });
});
