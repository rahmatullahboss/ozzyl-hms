import { describe, expect, test, vi, beforeEach } from 'vitest';
import { sign } from 'hono/jwt';
import wellnessRoutes from '../src/routes/wellness';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

const JWT_SECRET = 'test-secret-key-for-testing-only';

async function makePatientToken(patientId: number): Promise<string> {
  return sign({ userId: String(patientId), scope: 'global' }, JWT_SECRET);
}

const today = new Date().toISOString().slice(0, 10);

function yesterdayDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function twoDaysAgoDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 2);
  return d.toISOString().slice(0, 10);
}

function makeAuthHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe('GET /wellness/streaks', () => {
  test('rejects unauthenticated requests', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const res = await app.request('/wellness/streaks');
    expect(res.status).toBe(401);
  });

  test('returns streaks for authenticated patient', async () => {
    const mockDB = createMockDB({
      universalFallback: true,
      tables: {
        streaks: [
          { patient_id: 1, streak_type: 'daily_checkin', current_count: 5, longest_count: 12, last_logged_date: today },
          { patient_id: 1, streak_type: 'food_log', current_count: 3, longest_count: 7, last_logged_date: today },
        ],
      },
    });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await app.request('/wellness/streaks', {
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { streaks: any[] };
    expect(body.streaks).toBeDefined();
    expect(body.streaks.length).toBeGreaterThan(0);
  });
});

describe('POST /wellness/streaks/log', () => {
  test('rejects unauthenticated requests', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const res = await jsonRequest(app, '/wellness/streaks/log', {
      method: 'POST',
      body: { streak_type: 'daily_checkin' },
    });

    expect(res.status).toBe(401);
  });

  test('rejects invalid streak type', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/streaks/log', {
      method: 'POST',
      body: { streak_type: 'invalid_type' },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(400);
  });

  test('accepts valid streak types', async () => {
    const validTypes = ['daily_checkin', 'food_log', 'activity', 'sleep_log', 'medication', 'water'];
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);

    for (const streakType of validTypes) {
      mockDB.reset();
      const res = await jsonRequest(app, '/wellness/streaks/log', {
        method: 'POST',
        body: { streak_type: streakType },
        headers: makeAuthHeaders(token),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { streak: any };
      expect(body.streak.streak_type).toBe(streakType);
      expect(body.streak.current_count).toBeGreaterThanOrEqual(1);
      expect(body.streak.last_logged_date).toBe(today);
    }
  });

  test('creates new streak with count 1 on first log', async () => {
    const mockDB = createMockDB({ universalFallback: false });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/streaks/log', {
      method: 'POST',
      body: { streak_type: 'daily_checkin' },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { streak: any };
    expect(body.streak.current_count).toBe(1);
    expect(body.streak.longest_count).toBe(1);
    expect(body.streak.last_logged_date).toBe(today);
  });

  test('increments streak when logging on consecutive day', async () => {
    const yesterday = yesterdayDate();
    const mockDB = createMockDB({
      universalFallback: false,
      tables: {
        streaks: [
          { patient_id: 1, streak_type: 'daily_checkin', current_count: 4, longest_count: 10, last_logged_date: yesterday },
        ],
      },
    });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/streaks/log', {
      method: 'POST',
      body: { streak_type: 'daily_checkin' },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { streak: any };
    expect(body.streak.current_count).toBe(5);
    expect(body.streak.longest_count).toBe(10);
    expect(body.streak.last_logged_date).toBe(today);
  });

  test('updates longest_count when current streak exceeds it', async () => {
    const yesterday = yesterdayDate();
    const mockDB = createMockDB({
      universalFallback: false,
      tables: {
        streaks: [
          { patient_id: 1, streak_type: 'food_log', current_count: 9, longest_count: 9, last_logged_date: yesterday },
        ],
      },
    });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/streaks/log', {
      method: 'POST',
      body: { streak_type: 'food_log' },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { streak: any };
    expect(body.streak.current_count).toBe(10);
    expect(body.streak.longest_count).toBe(10);
  });

  test('resets streak to 1 when gap in logging (not consecutive)', async () => {
    const twoDaysAgo = twoDaysAgoDate();
    const mockDB = createMockDB({
      universalFallback: false,
      tables: {
        streaks: [
          { patient_id: 1, streak_type: 'activity', current_count: 7, longest_count: 14, last_logged_date: twoDaysAgo },
        ],
      },
    });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/streaks/log', {
      method: 'POST',
      body: { streak_type: 'activity' },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { streak: any };
    expect(body.streak.current_count).toBe(1);
    expect(body.streak.longest_count).toBe(14);
  });

  test('does not double-increment when already logged today', async () => {
    const mockDB = createMockDB({
      universalFallback: false,
      tables: {
        streaks: [
          { patient_id: 1, streak_type: 'water', current_count: 3, longest_count: 5, last_logged_date: today },
        ],
      },
    });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/streaks/log', {
      method: 'POST',
      body: { streak_type: 'water' },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { streak: any };
    expect(body.streak.current_count).toBe(3);
    expect(body.streak.longest_count).toBe(5);
  });
});
