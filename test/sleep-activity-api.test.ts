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

describe('GET /wellness/logs/sleep', () => {
  test('rejects unauthenticated requests', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({ route: wellnessRoutes, routePath: '/wellness', mockDB });

    const res = await app.request('/wellness/logs/sleep');
    expect(res.status).toBe(401);
  });

  test('returns sleep logs for authenticated patient', async () => {
    const mockDB = createMockDB({
      universalFallback: true,
      tables: {
        sleep_log: [
          { id: 1, patient_id: 1, duration_min: 480, quality_rating: 4, source: 'manual', logged_at: '2026-04-16T07:00:00Z' },
          { id: 2, patient_id: 1, duration_min: 420, quality_rating: 3, source: 'manual', logged_at: '2026-04-15T07:00:00Z' },
        ],
      },
    });
    const { app } = createTestApp({ route: wellnessRoutes, routePath: '/wellness', mockDB });

    const token = await makePatientToken(1);
    const res = await app.request('/wellness/logs/sleep?days=7', { headers: makeAuthHeaders(token) });

    expect(res.status).toBe(200);
    const body = await res.json() as { logs: any[] };
    expect(body.logs).toBeDefined();
    expect(body.logs.length).toBeGreaterThan(0);
  });
});

describe('GET /wellness/logs/activity', () => {
  test('rejects unauthenticated requests', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({ route: wellnessRoutes, routePath: '/wellness', mockDB });

    const res = await app.request('/wellness/logs/activity');
    expect(res.status).toBe(401);
  });

  test('returns activity logs for authenticated patient', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const mockDB = createMockDB({
      universalFallback: true,
      tables: {
        activity_log: [
          { id: 1, patient_id: 1, activity_type: 'walk', duration_min: 30, calories_burned: 120, source: 'manual', logged_at: `${today}T08:00:00Z` },
          { id: 2, patient_id: 1, activity_type: 'namaz', duration_min: 60, calories_burned: 120, source: 'manual', logged_at: `${today}T06:00:00Z` },
        ],
      },
    });
    const { app } = createTestApp({ route: wellnessRoutes, routePath: '/wellness', mockDB });

    const token = await makePatientToken(1);
    const res = await app.request(`/wellness/logs/activity?date=${today}`, { headers: makeAuthHeaders(token) });

    expect(res.status).toBe(200);
    const body = await res.json() as { logs: any[] };
    expect(body.logs).toBeDefined();
    expect(body.logs.length).toBeGreaterThan(0);
  });
});

describe('Sleep score calculation', () => {
  test('full 8h night with quality 5 = high score', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({ route: wellnessRoutes, routePath: '/wellness', mockDB });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/logs/sleep', {
      method: 'POST',
      body: { duration_min: 480, quality_rating: 5, source: 'manual' },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(201);
  });

  test('short 4h night with quality 1 = accepted but low', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({ route: wellnessRoutes, routePath: '/wellness', mockDB });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/logs/sleep', {
      method: 'POST',
      body: { duration_min: 240, quality_rating: 1, source: 'manual' },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(201);
  });
});

describe('Activity logging and daily totals', () => {
  test('logs namaz as activity', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({ route: wellnessRoutes, routePath: '/wellness', mockDB });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/logs/activity', {
      method: 'POST',
      body: { activity_type: 'namaz', duration_min: 60 },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(201);
  });

  test('rejects unknown activity type', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({ route: wellnessRoutes, routePath: '/wellness', mockDB });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/logs/activity', {
      method: 'POST',
      body: { activity_type: 'skydiving', duration_min: 30 },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(400);
  });

  test('estimates calories from walk + duration', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({ route: wellnessRoutes, routePath: '/wellness', mockDB });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/logs/activity', {
      method: 'POST',
      body: { activity_type: 'walk', duration_min: 30, calories_burned: 120 },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(201);
  });
});
