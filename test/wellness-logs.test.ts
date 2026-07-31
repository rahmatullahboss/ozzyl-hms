import { describe, expect, test, beforeEach } from 'vitest';
import { sign } from 'hono/jwt';
import wellnessRoutes from '../src/routes/wellness';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

const JWT_SECRET = 'test-secret-key-for-testing-only';

async function makePatientToken(patientId: number): Promise<string> {
  return sign({ userId: String(patientId), scope: 'global', role: 'patient' }, JWT_SECRET);
}

function makeAuthHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe('POST /wellness/logs/mood', () => {
  test('rejects unauthenticated requests', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const res = await jsonRequest(app, '/wellness/logs/mood', {
      method: 'POST',
      body: { mood: 'good', energy_level: 7 },
    });

    expect(res.status).toBe(401);
  });

  test('accepts valid mood log', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/logs/mood', {
      method: 'POST',
      body: { mood: 'good', energy_level: 7 },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { success: boolean; id: number };
    expect(body.success).toBe(true);
    expect(body.id).toBeDefined();
  });

  test('rejects invalid mood value', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/logs/mood', {
      method: 'POST',
      body: { mood: 'invalid_mood' },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(400);
  });

  test('rejects energy_level out of range', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/logs/mood', {
      method: 'POST',
      body: { mood: 'good', energy_level: 15 },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(400);
  });
});

describe('POST /wellness/logs/sleep', () => {
  test('accepts valid sleep log', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/logs/sleep', {
      method: 'POST',
      body: { duration_min: 480, quality_rating: 4, source: 'manual' },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { success: boolean; id: number };
    expect(body.success).toBe(true);
  });

  test('rejects invalid quality_rating', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/logs/sleep', {
      method: 'POST',
      body: { duration_min: 480, quality_rating: 10 },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(400);
  });

  test('rejects invalid source', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/logs/sleep', {
      method: 'POST',
      body: { duration_min: 480, source: 'auto' },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(400);
  });
});

describe('POST /wellness/logs/activity', () => {
  test('accepts valid activity log', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/logs/activity', {
      method: 'POST',
      body: { activity_type: 'walk', duration_min: 30 },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { success: boolean; id: number };
    expect(body.success).toBe(true);
  });

  test('rejects invalid activity_type', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/logs/activity', {
      method: 'POST',
      body: { activity_type: 'skydiving', duration_min: 30 },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(400);
  });

  test('rejects missing duration_min', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/logs/activity', {
      method: 'POST',
      body: { activity_type: 'walk' },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(400);
  });
});

describe('POST /wellness/logs/water', () => {
  test('accepts valid water log', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/logs/water', {
      method: 'POST',
      body: { amount_ml: 250 },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { success: boolean; id: number };
    expect(body.success).toBe(true);
  });

  test('rejects missing amount_ml', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/logs/water', {
      method: 'POST',
      body: {},
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(400);
  });

  test('rejects negative amount_ml', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/logs/water', {
      method: 'POST',
      body: { amount_ml: -100 },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(400);
  });
});

describe('POST /wellness/logs/symptom', () => {
  test('accepts valid symptom log', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/logs/symptom', {
      method: 'POST',
      body: { symptom: 'Headache', severity: 5 },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { success: boolean; id: number };
    expect(body.success).toBe(true);
  });

  test('rejects missing symptom', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/logs/symptom', {
      method: 'POST',
      body: { severity: 5 },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(400);
  });

  test('rejects severity out of range', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/logs/symptom', {
      method: 'POST',
      body: { symptom: 'Headache', severity: 15 },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(400);
  });
});

describe('POST /wellness/logs/batch — daily check-in writes all normalized logs', () => {
  test('writes mood, sleep, activity, water logs from single check-in', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/logs/batch', {
      method: 'POST',
      body: {
        mood: 'good',
        energy_level: 7,
        sleep_hours: 7.5,
        sleep_quality: 4,
        exercise_minutes: 30,
        exercise_type: 'walk',
        water_glasses: 8,
        notes: 'Feeling great today',
      },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { success: boolean; logs_created: number };
    expect(body.success).toBe(true);
    expect(body.logs_created).toBeGreaterThanOrEqual(4);
  });

  test('works with partial data (only mood + energy)', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/logs/batch', {
      method: 'POST',
      body: {
        mood: 'okay',
        energy_level: 5,
      },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { success: boolean; logs_created: number };
    expect(body.success).toBe(true);
    expect(body.logs_created).toBeGreaterThanOrEqual(1);
  });

  test('also logs daily_checkin streak', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/logs/batch', {
      method: 'POST',
      body: {
        mood: 'great',
        energy_level: 8,
        sleep_hours: 8,
        water_glasses: 6,
      },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { success: boolean; streak: any };
    expect(body.streak).toBeDefined();
    expect(body.streak.streak_type).toBe('daily_checkin');
  });

  test('rejects unauthenticated requests', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const res = await jsonRequest(app, '/wellness/logs/batch', {
      method: 'POST',
      body: { mood: 'good' },
    });

    expect(res.status).toBe(401);
  });
});
