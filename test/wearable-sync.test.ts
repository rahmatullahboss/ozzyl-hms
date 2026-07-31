import { describe, it, expect } from 'vitest';
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

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 3 — Tasks 4-5: Wearable Sync API (TDD)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── POST /wellness/sync/wearable — Bulk wearable data sync ────────────────

describe('POST /wellness/sync/wearable', () => {
  it('rejects unauthenticated requests', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const res = await jsonRequest(app, '/wellness/sync/wearable', {
      method: 'POST',
      body: { samples: [] },
    });

    expect(res.status).toBe(401);
  });

  it('accepts valid wearable payload with multiple sample types', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/sync/wearable', {
      method: 'POST',
      body: {
        device_name: 'Apple Watch Series 9',
        platform: 'ios',
        samples: [
          { type: 'steps', value: 8500, date: '2026-04-17', timestamp: '2026-04-17T18:00:00Z' },
          { type: 'heart_rate', value: 72, date: '2026-04-17', timestamp: '2026-04-17T18:00:00Z' },
          { type: 'sleep_minutes', value: 420, date: '2026-04-17', timestamp: '2026-04-17T06:00:00Z' },
          { type: 'spo2', value: 98, date: '2026-04-17', timestamp: '2026-04-17T18:00:00Z' },
          { type: 'active_calories', value: 350, date: '2026-04-17', timestamp: '2026-04-17T18:00:00Z' },
        ],
      },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.synced).toBe(5);
  });

  it('accepts Android Health Connect payload', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/sync/wearable', {
      method: 'POST',
      body: {
        device_name: 'Samsung Galaxy Watch 6',
        platform: 'android',
        samples: [
          { type: 'steps', value: 6200, date: '2026-04-17', timestamp: '2026-04-17T17:00:00Z' },
          { type: 'heart_rate', value: 80, date: '2026-04-17', timestamp: '2026-04-17T17:00:00Z' },
          { type: 'exercise_minutes', value: 45, date: '2026-04-17', timestamp: '2026-04-17T17:00:00Z' },
        ],
      },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.synced).toBe(3);
  });

  it('rejects empty samples array', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/sync/wearable', {
      method: 'POST',
      body: { samples: [] },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(400);
  });

  it('rejects invalid sample type', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/sync/wearable', {
      method: 'POST',
      body: {
        samples: [
          { type: 'invalid_type', value: 100, date: '2026-04-17', timestamp: '2026-04-17T18:00:00Z' },
        ],
      },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(400);
  });

  it('rejects negative values', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/wellness/sync/wearable', {
      method: 'POST',
      body: {
        samples: [
          { type: 'steps', value: -100, date: '2026-04-17', timestamp: '2026-04-17T18:00:00Z' },
        ],
      },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(400);
  });

  it('limits batch size to 500 samples', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const tooMany = Array.from({ length: 501 }, (_, i) => ({
      type: 'steps' as const,
      value: i + 1,
      date: '2026-04-17',
      timestamp: '2026-04-17T18:00:00Z',
    }));

    const res = await jsonRequest(app, '/wellness/sync/wearable', {
      method: 'POST',
      body: { samples: tooMany },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/500|limit|batch/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 3 — Task 6: Activity Rings — Daily Totals API (TDD)
// ═══════════════════════════════════════════════════════════════════════════════

describe('GET /wellness/daily-totals', () => {
  it('rejects unauthenticated requests', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const res = await app.request('/wellness/daily-totals');
    expect(res.status).toBe(401);
  });

  it('returns daily totals with ring data for today by default', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await app.request('/wellness/daily-totals', {
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    // Should have ring data structure
    expect(body.rings).toBeDefined();
    expect(body.rings.move).toBeDefined();
    expect(body.rings.exercise).toBeDefined();
    expect(body.rings.stand).toBeDefined();
    // Each ring has current + goal
    expect(body.rings.move).toHaveProperty('current');
    expect(body.rings.move).toHaveProperty('goal');
    expect(body.rings.exercise).toHaveProperty('current');
    expect(body.rings.exercise).toHaveProperty('goal');
  });

  it('accepts optional date parameter', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await app.request('/wellness/daily-totals?date=2026-04-16', {
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.date).toBe('2026-04-16');
  });

  it('returns additional summary fields (steps, water, sleep)', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: wellnessRoutes,
      routePath: '/wellness',
      mockDB,
    });

    const token = await makePatientToken(1);
    const res = await app.request('/wellness/daily-totals', {
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body).toHaveProperty('steps');
    expect(body).toHaveProperty('water_ml');
    expect(body).toHaveProperty('sleep_min');
    expect(body).toHaveProperty('heart_rate_avg');
  });
});
